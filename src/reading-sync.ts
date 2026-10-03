import { normalizePath, TFile, TFolder } from "obsidian";
import type { App, TAbstractFile } from "obsidian";
import { ensureVaultFolder } from "./media-utils";
import {
  applySyncedBook,
  canonicalJson,
  createSyncDocument,
  hasVisibleChanges,
  mergeSyncDocumentInto,
  parseSyncDocument,
  recordLocalBook,
} from "./reading-sync-model";
import type { AppliedBookChange, SyncDocument } from "./reading-sync-model";
import type { ReaderDataStore } from "./store";
import type { ReaderSettings } from "./types";

export interface ReadingSyncHost {
  app: App;
  store: ReaderDataStore;
  getReaderSettings(): ReaderSettings;
  /** Called after synced changes from another device were applied to local book state. */
  onSyncedBookChanges(changes: AppliedBookChange[]): void;
}

const DEVICE_ID_KEY = "omni-book-reader-mod-sync-device-id";
const RECORD_DELAY_MS = 3000;
const RECORD_MAX_WAIT_MS = 15000;

function createDeviceId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Syncs reading progress, highlights, bookmarks, and reading statistics across devices through
 * vault files. Each device owns one file, `<sync folder>/<device id>.json`, and only ever writes
 * that file. Other devices' files are read and merged, so a file sync service such as Obsidian
 * Sync never has to resolve conflicting edits. See `reading-sync-model.ts` for the merge rules.
 */
export class ReadingSyncService {
  private deviceId = "";
  private folder = "";
  private doc: SyncDocument | null = null;
  private firstImport = false;
  private lastWrittenBooks = "";
  private queue: Promise<void> = Promise.resolve();
  private recordTimer: number | null = null;
  private firstPendingChangeAt = 0;
  private unsubscribeStore: (() => void) | null = null;
  private generation = 0;

  constructor(private readonly host: ReadingSyncHost) {}

  get running(): boolean {
    return this.doc !== null;
  }

  /** Starts syncing if it is enabled in settings. Safe to call again after settings change. */
  start(): Promise<void> {
    const generation = ++this.generation;
    return this.enqueue(async () => {
      if (generation !== this.generation) return;
      this.stopTimers();
      this.doc = null;
      const settings = this.host.getReaderSettings();
      if (!settings.syncEnabled) return;
      this.deviceId = this.loadDeviceId();
      this.folder = normalizePath(settings.syncFolder);
      const doc = await this.readOwnDocument();
      if (generation !== this.generation) return;
      this.firstImport = !doc;
      this.doc = doc ?? createSyncDocument(this.deviceId);
      this.lastWrittenBooks = doc ? canonicalJson(doc.books) : "";
      // Record local edits against this device's last synced state before merging anyone else's.
      this.recordLocalChanges();
      const others = await this.readOtherDocuments();
      if (generation !== this.generation) return;
      const changedPaths = new Set<string>();
      for (const other of others) {
        for (const path of mergeSyncDocumentInto(this.doc, other)) changedPaths.add(path);
      }
      this.applyToLocal([...changedPaths]);
      await this.writeOwnDocument();
      this.unsubscribeStore ??= this.host.store.onChange(() => this.scheduleRecord());
    });
  }

  stop(): void {
    this.generation++;
    this.stopTimers();
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
    this.doc = null;
  }

  /** Records and writes pending local changes immediately, e.g. before the app is backgrounded or closed. */
  flush(): Promise<void> {
    if (!this.doc) return this.queue;
    this.stopTimers();
    return this.enqueue(async () => {
      if (!this.doc) return;
      this.recordLocalChanges();
      await this.writeOwnDocument();
    });
  }

  /** Vault event handler for created or modified files. */
  handleVaultChange(file: TAbstractFile): void {
    if (!this.doc || !(file instanceof TFile) || !this.isOtherDeviceFile(file)) return;
    void this.enqueue(async () => {
      if (!this.doc) return;
      const incoming = parseSyncDocument(await this.host.app.vault.read(file));
      if (!this.doc || !incoming || incoming.deviceId === this.deviceId) return;
      this.recordLocalChanges();
      const changedPaths = mergeSyncDocumentInto(this.doc, incoming);
      if (!changedPaths.length) return;
      this.applyToLocal(changedPaths);
      this.scheduleRecord();
    });
  }

  /** Keeps synced data attached to a book when its EPUB is renamed or moved on this device. */
  handleBookRename(oldPath: string, newPath: string): void {
    const doc = this.doc;
    const book = doc?.books[normalizePath(oldPath)];
    if (!doc || !book) return;
    const target = normalizePath(newPath);
    const merged = createSyncDocument(this.deviceId);
    merged.books[target] = book;
    mergeSyncDocumentInto(doc, merged);
    this.scheduleRecord();
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task).catch((error) => {
      console.error("[Omni Book Reader] Reading sync failed", error);
    });
    this.queue = run;
    return run;
  }

  private scheduleRecord(): void {
    if (!this.doc) return;
    const now = Date.now();
    if (!this.firstPendingChangeAt) this.firstPendingChangeAt = now;
    if (this.recordTimer !== null) window.clearTimeout(this.recordTimer);
    const delay = Math.max(0, Math.min(RECORD_DELAY_MS, this.firstPendingChangeAt + RECORD_MAX_WAIT_MS - now));
    this.recordTimer = window.setTimeout(() => {
      this.recordTimer = null;
      this.firstPendingChangeAt = 0;
      void this.flush();
    }, delay);
  }

  private stopTimers(): void {
    if (this.recordTimer !== null) window.clearTimeout(this.recordTimer);
    this.recordTimer = null;
    this.firstPendingChangeAt = 0;
  }

  private recordLocalChanges(): void {
    const doc = this.doc;
    if (!doc) return;
    const now = Date.now();
    for (const [path, state] of this.host.store.liveBooks()) {
      recordLocalBook(doc, path, state, this.deviceId, now, this.firstImport);
    }
    this.firstImport = false;
  }

  /** Makes local book state match the sync document for the given paths. */
  private applyToLocal(paths: string[]): void {
    const doc = this.doc;
    if (!doc || !paths.length) return;
    const changes: AppliedBookChange[] = [];
    for (const path of paths) {
      const book = doc.books[path];
      // Only materialize books whose EPUB exists on this device; the data stays in the sync file either way.
      if (!book || !(this.host.app.vault.getAbstractFileByPath(path) instanceof TFile)) continue;
      const state = this.host.store.getBook(path) ?? this.host.store.ensureBook(path, { size: 0, mtime: 0 });
      const change = applySyncedBook(path, state, book);
      if (hasVisibleChanges(change)) changes.push(change);
    }
    if (!changes.length) return;
    this.host.store.markChanged(0);
    this.host.onSyncedBookChanges(changes);
  }

  private async writeOwnDocument(): Promise<void> {
    const doc = this.doc;
    if (!doc) return;
    const books = canonicalJson(doc.books);
    if (books === this.lastWrittenBooks) return;
    // Persist local data first: the sync file must never claim to know more than data.json, or a
    // crash in between would make the next startup read the gap as local deletions.
    await this.host.store.flush();
    doc.updatedAt = Date.now();
    const content = canonicalJson(doc);
    const vault = this.host.app.vault;
    await ensureVaultFolder(vault, this.folder);
    const path = this.ownPath();
    const existing = vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) await vault.modify(existing, content);
    else if (!existing) await vault.create(path, content);
    else throw new Error(`The reading sync path is not a file: ${path}`);
    this.lastWrittenBooks = books;
  }

  private async readOwnDocument(): Promise<SyncDocument | null> {
    const file = this.host.app.vault.getAbstractFileByPath(this.ownPath());
    if (!(file instanceof TFile)) return null;
    const doc = parseSyncDocument(await this.host.app.vault.read(file));
    return doc && doc.deviceId === this.deviceId ? doc : null;
  }

  private async readOtherDocuments(): Promise<SyncDocument[]> {
    const folder = this.host.app.vault.getAbstractFileByPath(this.folder);
    if (!(folder instanceof TFolder)) return [];
    const docs: SyncDocument[] = [];
    for (const child of folder.children) {
      if (!(child instanceof TFile) || !this.isOtherDeviceFile(child)) continue;
      const doc = parseSyncDocument(await this.host.app.vault.read(child));
      if (doc && doc.deviceId !== this.deviceId) docs.push(doc);
    }
    return docs;
  }

  private isOtherDeviceFile(file: TFile): boolean {
    return file.extension.toLowerCase() === "json"
      && file.parent?.path === this.folder
      && file.path !== this.ownPath();
  }

  private ownPath(): string {
    return normalizePath(`${this.folder}/${this.deviceId}.json`);
  }

  private loadDeviceId(): string {
    const stored: unknown = this.host.app.loadLocalStorage(DEVICE_ID_KEY);
    if (typeof stored === "string" && /^[0-9a-f]{16}$/.test(stored)) return stored;
    const id = createDeviceId();
    this.host.app.saveLocalStorage(DEVICE_ID_KEY, id);
    return id;
  }
}
