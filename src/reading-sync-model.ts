import type {
  AnnotationDocuments,
  BookState,
  Bookmark,
  ReaderHighlight,
  ReadingPosition,
  ReadingStats,
} from "./types";
import { ANNOTATION_FOLDER } from "./annotation-documents";
import { isValidCfi, normalizeVaultPath } from "./utils";

/**
 * Cross-device reading sync model.
 *
 * Every device writes only its own sync file, so file-level conflicts cannot happen. Each file
 * holds that device's view of the merged state. Merging is commutative, associative, and
 * idempotent, so every device converges no matter the order in which files arrive:
 * - highlights and bookmarks: last-writer-wins per id, with deletion tombstones
 * - position and completion: last-writer-wins by timestamp
 * - reading time: one grow-only counter per device, summed
 * - last opened/read and furthest progress: maximum
 * - annotation document paths: the book note beats a generated Notes file, which beats an old two-file pair; then the earliest created wins
 */

export const SYNC_FORMAT = "omni-book-reader-mod-sync";
export const SYNC_VERSION = 1;

export type SyncedHighlight = Omit<ReaderHighlight, "stale">;
export type SyncedBookmark = Omit<Bookmark, "stale">;

export type SyncEntry<T> = { value: T; updatedAt: number } | { deletedAt: number };

export interface SyncedCompletion {
  completedAt: number | null;
  updatedAt: number;
}

export interface SyncedBook {
  position?: ReadingPosition;
  highlights: Record<string, SyncEntry<SyncedHighlight>>;
  bookmarks: Record<string, SyncEntry<SyncedBookmark>>;
  readingMsByDevice: Record<string, number>;
  lastOpenedAt: number;
  lastReadAt: number;
  furthestFraction: number;
  completion?: SyncedCompletion;
  annotationDocuments?: AnnotationDocuments;
}

export interface SyncDocument {
  format: typeof SYNC_FORMAT;
  version: typeof SYNC_VERSION;
  deviceId: string;
  updatedAt: number;
  books: Record<string, SyncedBook>;
}

/** What changed in a book's local state after applying synced data. */
export interface AppliedBookChange {
  path: string;
  /** Highlights that were removed or replaced (their previous values). */
  removedHighlights: ReaderHighlight[];
  /** Highlights that were added or replaced (their new values). */
  addedHighlights: ReaderHighlight[];
  bookmarksChanged: boolean;
  positionChanged: boolean;
  statsChanged: boolean;
}

const finite = (value: unknown, fallback = 0): number =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** JSON with sorted keys, so equal data always serializes identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (!isRecord(item)) return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
  });
}

export function emptySyncedBook(): SyncedBook {
  return { highlights: {}, bookmarks: {}, readingMsByDevice: {}, lastOpenedAt: 0, lastReadAt: 0, furthestFraction: 0 };
}

export function createSyncDocument(deviceId: string): SyncDocument {
  return { format: SYNC_FORMAT, version: SYNC_VERSION, deviceId, updatedAt: 0, books: {} };
}

function syncedHighlight(highlight: ReaderHighlight): SyncedHighlight {
  const { stale: _stale, ...value } = highlight;
  return value;
}

function syncedBookmark(bookmark: Bookmark): SyncedBookmark {
  const { stale: _stale, ...value } = bookmark;
  return value;
}

function entryTime(entry: SyncEntry<unknown>): number {
  return "deletedAt" in entry ? entry.deletedAt : entry.updatedAt;
}

/** Deterministic winner between two entries for the same id. Ties prefer deletion, then the larger value. */
function newerEntry<T>(left: SyncEntry<T>, right: SyncEntry<T>): SyncEntry<T> {
  const leftTime = entryTime(left);
  const rightTime = entryTime(right);
  if (leftTime !== rightTime) return leftTime > rightTime ? left : right;
  const leftDeleted = "deletedAt" in left;
  const rightDeleted = "deletedAt" in right;
  if (leftDeleted !== rightDeleted) return leftDeleted ? left : right;
  return canonicalJson(left) >= canonicalJson(right) ? left : right;
}

function newerPosition(left?: ReadingPosition, right?: ReadingPosition): ReadingPosition | undefined {
  if (!left || !right) return left ?? right;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right;
  return left.cfi >= right.cfi ? left : right;
}

function newerCompletion(left?: SyncedCompletion, right?: SyncedCompletion): SyncedCompletion | undefined {
  if (!left || !right) return left ?? right;
  if (left.updatedAt !== right.updatedAt) return left.updatedAt > right.updatedAt ? left : right;
  return (left.completedAt ?? 0) >= (right.completedAt ?? 0) ? left : right;
}

function earlierDocuments(left?: AnnotationDocuments, right?: AnnotationDocuments): AnnotationDocuments | undefined {
  if (!left || !right) return left ?? right;
  // Newest layout wins: the book note itself, then a single generated Notes file, then the old two-file pair.
  const layout = (documents: AnnotationDocuments): string => {
    if (documents.highlightPath !== documents.notePath) return "2";
    return documents.highlightPath.startsWith(`${ANNOTATION_FOLDER}/`) ? "1" : "0";
  };
  const key = (documents: AnnotationDocuments): string => [
    layout(documents),
    documents.createdDate || "9999-99-99",
    documents.highlightPath,
  ].join("\n");
  const leftKey = key(left);
  const rightKey = key(right);
  return leftKey <= rightKey ? left : right;
}

function mergeEntries<T>(left: Record<string, SyncEntry<T>>, right: Record<string, SyncEntry<T>>): Record<string, SyncEntry<T>> {
  const merged: Record<string, SyncEntry<T>> = { ...left };
  for (const [id, entry] of Object.entries(right)) {
    const existing = merged[id];
    merged[id] = existing ? newerEntry(existing, entry) : entry;
  }
  return merged;
}

export function mergeSyncedBooks(left: SyncedBook, right: SyncedBook): SyncedBook {
  const readingMsByDevice = { ...left.readingMsByDevice };
  for (const [device, ms] of Object.entries(right.readingMsByDevice)) {
    readingMsByDevice[device] = Math.max(readingMsByDevice[device] ?? 0, ms);
  }
  const position = newerPosition(left.position, right.position);
  const completion = newerCompletion(left.completion, right.completion);
  const annotationDocuments = earlierDocuments(left.annotationDocuments, right.annotationDocuments);
  return {
    ...(position ? { position } : {}),
    highlights: mergeEntries(left.highlights, right.highlights),
    bookmarks: mergeEntries(left.bookmarks, right.bookmarks),
    readingMsByDevice,
    lastOpenedAt: Math.max(left.lastOpenedAt, right.lastOpenedAt),
    lastReadAt: Math.max(left.lastReadAt, right.lastReadAt),
    furthestFraction: Math.max(left.furthestFraction, right.furthestFraction),
    ...(completion ? { completion } : {}),
    ...(annotationDocuments ? { annotationDocuments } : {}),
  };
}

/** Merges `incoming` into `target.books` in place. Returns the paths whose synced data changed. */
export function mergeSyncDocumentInto(target: SyncDocument, incoming: SyncDocument): string[] {
  const changed: string[] = [];
  for (const [path, book] of Object.entries(incoming.books)) {
    const existing = target.books[path];
    const merged = existing ? mergeSyncedBooks(existing, book) : book;
    if (!existing || canonicalJson(existing) !== canonicalJson(merged)) {
      target.books[path] = merged;
      changed.push(path);
    }
  }
  return changed;
}

function fingerprint(value: unknown): string {
  return canonicalJson(value);
}

/**
 * Records local edits into the sync document by comparing the local book state with what the
 * sync document last said about it. Anything the document does not yet know is a local change.
 *
 * `firstImport` is true the first time this device ever syncs. Its local data has no sync history
 * then, so nothing missing locally counts as a deletion, and differing copies are merged by their
 * own edit times instead of "now". A device holding older copies of the same annotations therefore
 * cannot delete or override newer data that other devices already synced.
 */
export function recordLocalBook(
  doc: SyncDocument,
  path: string,
  state: BookState,
  deviceId: string,
  now: number,
  firstImport = false,
): boolean {
  const known = doc.books[path];
  const book = known ? structuredClone(known) : emptySyncedBook();

  const localHighlights = new Map(state.highlights.map((item) => [item.id, syncedHighlight(item)]));
  for (const [id, value] of localHighlights) {
    const entry = book.highlights[id];
    const current = entry && "value" in entry ? entry.value : undefined;
    if (current && fingerprint(current) === fingerprint(value)) continue;
    const local: SyncEntry<SyncedHighlight> = firstImport
      ? { value, updatedAt: Math.max(value.createdAt, value.noteUpdatedAt ?? 0) }
      : { value, updatedAt: now };
    book.highlights[id] = firstImport && entry ? newerEntry(entry, local) : local;
  }

  const localBookmarks = new Map(state.bookmarks.map((item) => [item.id, syncedBookmark(item)]));
  for (const [id, value] of localBookmarks) {
    const entry = book.bookmarks[id];
    const current = entry && "value" in entry ? entry.value : undefined;
    if (current && fingerprint(current) === fingerprint(value)) continue;
    const local: SyncEntry<SyncedBookmark> = { value, updatedAt: firstImport ? value.createdAt : now };
    book.bookmarks[id] = firstImport && entry ? newerEntry(entry, local) : local;
  }

  if (!firstImport) {
    for (const [id, entry] of Object.entries(book.highlights)) {
      if ("value" in entry && !localHighlights.has(id)) book.highlights[id] = { deletedAt: now };
    }
    for (const [id, entry] of Object.entries(book.bookmarks)) {
      if ("value" in entry && !localBookmarks.has(id)) book.bookmarks[id] = { deletedAt: now };
    }
  }

  book.position = newerPosition(book.position, state.position);

  const stats = state.readingStats;
  if (stats) {
    const othersMs = Object.entries(book.readingMsByDevice)
      .filter(([device]) => device !== deviceId)
      .reduce((sum, [, ms]) => sum + ms, 0);
    const knownTotal = othersMs + (book.readingMsByDevice[deviceId] ?? 0);
    if (stats.totalReadingMs > knownTotal) {
      book.readingMsByDevice[deviceId] = (book.readingMsByDevice[deviceId] ?? 0) + (stats.totalReadingMs - knownTotal);
    }
    book.lastOpenedAt = Math.max(book.lastOpenedAt, stats.lastOpenedAt);
    book.lastReadAt = Math.max(book.lastReadAt, stats.lastReadAt);
    book.furthestFraction = Math.max(book.furthestFraction, stats.furthestFraction);
    const completedAt = stats.completedAt ?? null;
    if ((book.completion?.completedAt ?? null) !== completedAt) {
      book.completion = firstImport
        ? newerCompletion(book.completion, { completedAt, updatedAt: completedAt ?? 0 })
        : { completedAt, updatedAt: now };
    }
  }

  book.annotationDocuments = earlierDocuments(book.annotationDocuments, state.annotationDocuments);
  if (!book.annotationDocuments) delete book.annotationDocuments;
  if (!book.position) delete book.position;

  if (known && canonicalJson(known) === canonicalJson(book)) return false;
  if (!known && isEmptySyncedBook(book)) return false;
  doc.books[path] = book;
  return true;
}

function isEmptySyncedBook(book: SyncedBook): boolean {
  return !book.position && !Object.keys(book.highlights).length && !Object.keys(book.bookmarks).length
    && !Object.keys(book.readingMsByDevice).length && !book.lastOpenedAt && !book.completion && !book.annotationDocuments;
}

function sortByCreation<T extends { createdAt: number; id: string }>(items: T[]): T[] {
  return items.sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}

/**
 * Makes the local book state match the synced book, mutating `state` in place so open views that
 * hold a reference to it stay valid. Local-only fields (stale flags, bookshelf metadata, source
 * signature) are preserved.
 */
export function applySyncedBook(path: string, state: BookState, book: SyncedBook): AppliedBookChange {
  const change: AppliedBookChange = {
    path,
    removedHighlights: [],
    addedHighlights: [],
    bookmarksChanged: false,
    positionChanged: false,
    statsChanged: false,
  };

  const previousHighlights = new Map(state.highlights.map((item) => [item.id, item]));
  const nextHighlights: ReaderHighlight[] = [];
  for (const [id, entry] of Object.entries(book.highlights)) {
    if (!("value" in entry)) continue;
    const previous = previousHighlights.get(id);
    if (previous && fingerprint(syncedHighlight(previous)) === fingerprint(entry.value)) {
      nextHighlights.push(previous);
      continue;
    }
    const next: ReaderHighlight = structuredClone(entry.value);
    if (previous?.stale && previous.cfi === next.cfi) next.stale = true;
    if (previous) change.removedHighlights.push(previous);
    change.addedHighlights.push(next);
    nextHighlights.push(next);
  }
  const nextIds = new Set(nextHighlights.map((item) => item.id));
  for (const previous of state.highlights) {
    if (!nextIds.has(previous.id)) change.removedHighlights.push(previous);
  }
  if (change.addedHighlights.length || change.removedHighlights.length) {
    state.highlights = sortByCreation(nextHighlights);
  }

  const previousBookmarks = new Map(state.bookmarks.map((item) => [item.id, item]));
  const nextBookmarks: Bookmark[] = [];
  for (const [id, entry] of Object.entries(book.bookmarks)) {
    if (!("value" in entry)) continue;
    const previous = previousBookmarks.get(id);
    if (previous && fingerprint(syncedBookmark(previous)) === fingerprint(entry.value)) {
      nextBookmarks.push(previous);
      continue;
    }
    change.bookmarksChanged = true;
    nextBookmarks.push({ ...structuredClone(entry.value), ...(previous?.stale && previous.cfi === entry.value.cfi ? { stale: true } : {}) });
  }
  if (nextBookmarks.length !== state.bookmarks.length) change.bookmarksChanged = true;
  if (change.bookmarksChanged) state.bookmarks = sortByCreation(nextBookmarks);

  const position = newerPosition(state.position, book.position);
  if (position && position !== state.position && canonicalJson(position) !== canonicalJson(state.position ?? null)) {
    state.position = { ...position };
    change.positionChanged = true;
  }

  const totalReadingMs = Object.values(book.readingMsByDevice).reduce((sum, ms) => sum + ms, 0);
  const hasStats = totalReadingMs > 0 || book.lastOpenedAt > 0 || book.lastReadAt > 0
    || book.furthestFraction > 0 || Boolean(book.completion?.completedAt);
  if (hasStats) {
    const previous: ReadingStats | undefined = state.readingStats;
    const completedAt = book.completion ? book.completion.completedAt : previous?.completedAt ?? null;
    const next: ReadingStats = {
      totalReadingMs: Math.max(totalReadingMs, previous?.totalReadingMs ?? 0),
      lastOpenedAt: Math.max(book.lastOpenedAt, previous?.lastOpenedAt ?? 0),
      lastReadAt: Math.max(book.lastReadAt, previous?.lastReadAt ?? 0),
      furthestFraction: Math.max(book.furthestFraction, previous?.furthestFraction ?? 0),
      ...(completedAt ? { completedAt } : {}),
    };
    if (canonicalJson(next) !== canonicalJson(previous ?? null)) {
      if (previous) {
        Object.assign(previous, next);
        if (!completedAt) delete previous.completedAt;
      } else {
        state.readingStats = next;
      }
      change.statsChanged = true;
    }
  }

  if (book.annotationDocuments && canonicalJson(book.annotationDocuments) !== canonicalJson(state.annotationDocuments ?? null)) {
    state.annotationDocuments = { ...book.annotationDocuments };
  }
  return change;
}

export function hasVisibleChanges(change: AppliedBookChange): boolean {
  return change.addedHighlights.length > 0 || change.removedHighlights.length > 0
    || change.bookmarksChanged || change.positionChanged || change.statsChanged;
}

function parseEntries<T>(value: unknown, parseValue: (input: unknown) => T | null): Record<string, SyncEntry<T>> {
  const entries: Record<string, SyncEntry<T>> = {};
  if (!isRecord(value)) return entries;
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    if (typeof raw.deletedAt === "number" && Number.isFinite(raw.deletedAt)) {
      entries[id] = { deletedAt: raw.deletedAt };
      continue;
    }
    const parsed = parseValue(raw.value);
    if (parsed && typeof raw.updatedAt === "number" && Number.isFinite(raw.updatedAt)) {
      entries[id] = { value: parsed, updatedAt: raw.updatedAt };
    }
  }
  return entries;
}

function parseHighlight(input: unknown): SyncedHighlight | null {
  if (!isRecord(input) || typeof input.id !== "string" || typeof input.text !== "string" || !isValidCfi(input.cfi)) return null;
  const colors = new Set(["yellow", "green", "blue", "pink"]);
  const styles = new Set(["highlight", "underline", "strikethrough", "squiggly"]);
  return {
    id: input.id,
    cfi: input.cfi.trim(),
    text: input.text.slice(0, 10000),
    chapter: typeof input.chapter === "string" ? input.chapter : "Untitled chapter",
    color: colors.has(String(input.color)) ? input.color as SyncedHighlight["color"] : "yellow",
    style: styles.has(String(input.style)) ? input.style as SyncedHighlight["style"] : "highlight",
    tags: Array.isArray(input.tags) ? input.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 20) : [],
    sectionIndex: Math.max(0, Math.round(finite(input.sectionIndex))),
    createdAt: finite(input.createdAt),
    ...(typeof input.page === "string" && input.page.trim() ? { page: input.page.trim().slice(0, 50) } : {}),
    ...(input.lookup === true ? { lookup: true } : {}),
    ...(typeof input.note === "string" && input.note ? { note: input.note.slice(0, 20000) } : {}),
    ...(typeof input.noteUpdatedAt === "number" && Number.isFinite(input.noteUpdatedAt) ? { noteUpdatedAt: input.noteUpdatedAt } : {}),
  };
}

function parseBookmark(input: unknown): SyncedBookmark | null {
  if (!isRecord(input) || typeof input.id !== "string" || !isValidCfi(input.cfi)) return null;
  return {
    id: input.id,
    cfi: input.cfi.trim(),
    fraction: Math.min(1, Math.max(0, finite(input.fraction))),
    chapter: typeof input.chapter === "string" ? input.chapter : "Untitled chapter",
    createdAt: finite(input.createdAt),
  };
}

function parseSyncedBook(value: unknown): SyncedBook | null {
  if (!isRecord(value)) return null;
  const book = emptySyncedBook();
  if (isRecord(value.position) && isValidCfi(value.position.cfi)) {
    book.position = {
      cfi: value.position.cfi.trim(),
      fraction: Math.min(1, Math.max(0, finite(value.position.fraction))),
      updatedAt: finite(value.position.updatedAt),
    };
  }
  book.highlights = parseEntries(value.highlights, parseHighlight);
  book.bookmarks = parseEntries(value.bookmarks, parseBookmark);
  if (isRecord(value.readingMsByDevice)) {
    for (const [device, ms] of Object.entries(value.readingMsByDevice)) {
      if (typeof ms === "number" && Number.isFinite(ms) && ms > 0) book.readingMsByDevice[device] = ms;
    }
  }
  book.lastOpenedAt = Math.max(0, finite(value.lastOpenedAt));
  book.lastReadAt = Math.max(0, finite(value.lastReadAt));
  book.furthestFraction = Math.min(1, Math.max(0, finite(value.furthestFraction)));
  if (isRecord(value.completion) && typeof value.completion.updatedAt === "number") {
    const completedAt = value.completion.completedAt;
    book.completion = {
      completedAt: typeof completedAt === "number" && completedAt > 0 ? completedAt : null,
      updatedAt: finite(value.completion.updatedAt),
    };
  }
  if (isRecord(value.annotationDocuments)) {
    const text = (input: unknown): string => typeof input === "string" ? input : "";
    const highlightPath = normalizeVaultPath(text(value.annotationDocuments.highlightPath));
    const notePath = normalizeVaultPath(text(value.annotationDocuments.notePath));
    const createdDate = text(value.annotationDocuments.createdDate);
    if (highlightPath.toLowerCase().endsWith(".md") && notePath.toLowerCase().endsWith(".md")) {
      book.annotationDocuments = { highlightPath, notePath, createdDate: /^\d{4}-\d{2}-\d{2}$/.test(createdDate) ? createdDate : "" };
    }
  }
  return book;
}

/** Parses a sync file. Returns null for anything that is not a valid sync document. */
export function parseSyncDocument(text: string): SyncDocument | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.format !== SYNC_FORMAT || value.version !== SYNC_VERSION) return null;
  if (typeof value.deviceId !== "string" || !value.deviceId) return null;
  const doc = createSyncDocument(value.deviceId);
  doc.updatedAt = finite(value.updatedAt);
  if (isRecord(value.books)) {
    for (const [path, raw] of Object.entries(value.books)) {
      const key = normalizeVaultPath(path);
      const book = parseSyncedBook(raw);
      if (key && book) doc.books[key] = book;
    }
  }
  return doc;
}
