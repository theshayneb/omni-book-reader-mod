import { describe, expect, it } from "vitest";
import {
  applySyncedBook,
  canonicalJson,
  createSyncDocument,
  emptySyncedBook,
  mergeSyncDocumentInto,
  mergeSyncedBooks,
  parseSyncDocument,
  recordLocalBook,
} from "../src/reading-sync-model";
import type { SyncDocument } from "../src/reading-sync-model";
import type { BookState, Bookmark, ReaderHighlight } from "../src/types";

const BOOK = "Books/Test Book.epub";

function highlight(id: string, overrides: Partial<ReaderHighlight> = {}): ReaderHighlight {
  return {
    id,
    cfi: `epubcfi(/6/4!/4/2/1:${id.length})`,
    text: `Text ${id}`,
    chapter: "Chapter 1",
    color: "yellow",
    style: "highlight",
    tags: [],
    sectionIndex: 1,
    createdAt: 1000,
    ...overrides,
  };
}

function bookmark(id: string, createdAt = 1000): Bookmark {
  return { id, cfi: "epubcfi(/6/4!/4/2/1:0)", fraction: 0.1, chapter: "Chapter 1", createdAt };
}

function bookState(overrides: Partial<BookState> = {}): BookState {
  return { sourceSignature: { size: 1, mtime: 1 }, bookmarks: [], highlights: [], ...overrides };
}

/** One simulated device: local book state plus its own sync document, synced the way the service does it. */
class Device {
  doc: SyncDocument;
  firstImport = true;

  constructor(readonly id: string, readonly state: BookState = bookState()) {
    this.doc = createSyncDocument(id);
  }

  /** Records local edits, then merges other devices' files, then applies the result locally. */
  sync(now: number, ...others: Device[]): void {
    recordLocalBook(this.doc, BOOK, this.state, this.id, now, this.firstImport);
    this.firstImport = false;
    for (const other of others) mergeSyncDocumentInto(this.doc, structuredClone(other.doc));
    const book = this.doc.books[BOOK];
    if (book) applySyncedBook(BOOK, this.state, book);
  }

  highlightIds(): string[] {
    return this.state.highlights.map((item) => item.id).sort();
  }
}

describe("reading sync model", () => {
  it("combines highlights added on different devices", () => {
    const desktop = new Device("desktop", bookState({ highlights: [highlight("a")] }));
    const phone = new Device("phone", bookState({ highlights: [highlight("b")] }));

    desktop.sync(2000);
    phone.sync(2000, desktop);
    desktop.sync(3000, phone);

    expect(desktop.highlightIds()).toEqual(["a", "b"]);
    expect(phone.highlightIds()).toEqual(["a", "b"]);
  });

  it("propagates deletions and does not resurrect deleted highlights", () => {
    const desktop = new Device("desktop", bookState({ highlights: [highlight("a"), highlight("b")] }));
    const phone = new Device("phone");
    desktop.sync(2000);
    phone.sync(2000, desktop);
    expect(phone.highlightIds()).toEqual(["a", "b"]);

    phone.state.highlights = phone.state.highlights.filter((item) => item.id !== "a");
    phone.sync(3000, desktop);
    desktop.sync(4000, phone);
    phone.sync(5000, desktop);

    expect(desktop.highlightIds()).toEqual(["b"]);
    expect(phone.highlightIds()).toEqual(["b"]);
  });

  it("keeps the newest edit of the same highlight", () => {
    const desktop = new Device("desktop", bookState({ highlights: [highlight("a")] }));
    const phone = new Device("phone");
    desktop.sync(2000);
    phone.sync(2000, desktop);

    desktop.state.highlights[0]!.note = "Older note";
    desktop.sync(3000, phone);
    phone.state.highlights[0]!.note = "Newer note";
    phone.state.highlights[0]!.color = "blue";
    phone.sync(4000, desktop);
    desktop.sync(5000, phone);

    expect(desktop.state.highlights[0]).toMatchObject({ note: "Newer note", color: "blue" });
    expect(phone.state.highlights[0]).toMatchObject({ note: "Newer note", color: "blue" });
  });

  it("does not delete or override other devices' data on a device's first sync", () => {
    const desktop = new Device("desktop", bookState({
      highlights: [highlight("a", { note: "Edited on desktop", noteUpdatedAt: 5000 })],
      bookmarks: [bookmark("m")],
    }));
    desktop.sync(6000);

    // The phone has an older copy of the same highlight and nothing else.
    const phone = new Device("phone", bookState({ highlights: [highlight("a", { note: "Old note", noteUpdatedAt: 2000 })] }));
    phone.sync(7000, desktop);

    expect(phone.state.highlights[0]?.note).toBe("Edited on desktop");
    expect(phone.state.bookmarks.map((item) => item.id)).toEqual(["m"]);
    desktop.sync(8000, phone);
    expect(desktop.state.highlights[0]?.note).toBe("Edited on desktop");
    expect(desktop.state.bookmarks.map((item) => item.id)).toEqual(["m"]);
  });

  it("uses the most recent reading position and sums reading time across devices", () => {
    const desktop = new Device("desktop", bookState({
      position: { cfi: "epubcfi(/6/10!/4/2/1:0)", fraction: 0.2, updatedAt: 1000 },
      readingStats: { totalReadingMs: 60000, lastOpenedAt: 1000, lastReadAt: 1000, furthestFraction: 0.2 },
    }));
    const phone = new Device("phone", bookState({
      position: { cfi: "epubcfi(/6/20!/4/2/1:0)", fraction: 0.4, updatedAt: 2000 },
      readingStats: { totalReadingMs: 30000, lastOpenedAt: 2000, lastReadAt: 2000, furthestFraction: 0.4 },
    }));

    desktop.sync(3000);
    phone.sync(3000, desktop);
    desktop.sync(4000, phone);

    expect(desktop.state.position?.cfi).toBe("epubcfi(/6/20!/4/2/1:0)");
    expect(desktop.state.readingStats).toMatchObject({ totalReadingMs: 90000, furthestFraction: 0.4, lastReadAt: 2000 });
    expect(phone.state.readingStats?.totalReadingMs).toBe(90000);

    // Further reading on one device adds only that device's new time.
    desktop.state.readingStats!.totalReadingMs += 10000;
    desktop.sync(5000, phone);
    phone.sync(6000, desktop);
    expect(phone.state.readingStats?.totalReadingMs).toBe(100000);
  });

  it("syncs marking a book unfinished after it was finished elsewhere", () => {
    const desktop = new Device("desktop", bookState({
      readingStats: { totalReadingMs: 1, lastOpenedAt: 1, lastReadAt: 1, furthestFraction: 1, completedAt: 1000 },
    }));
    const phone = new Device("phone");
    desktop.sync(2000);
    phone.sync(2000, desktop);
    expect(phone.state.readingStats?.completedAt).toBe(1000);

    delete phone.state.readingStats!.completedAt;
    phone.sync(3000, desktop);
    desktop.sync(4000, phone);
    expect(desktop.state.readingStats?.completedAt).toBeUndefined();
  });

  it("mutates the existing book state object so open views keep a valid reference", () => {
    const desktop = new Device("desktop", bookState({ highlights: [highlight("a")] }));
    const phoneState = bookState();
    const phone = new Device("phone", phoneState);
    desktop.sync(2000);
    phone.sync(2000, desktop);
    expect(phone.state).toBe(phoneState);
    expect(phoneState.highlights.map((item) => item.id)).toEqual(["a"]);
  });

  it("merges in any order to the same result", () => {
    const a = new Device("a", bookState({ highlights: [highlight("1")], bookmarks: [bookmark("x")] }));
    const b = new Device("b", bookState({ highlights: [highlight("2", { createdAt: 3000 })] }));
    a.sync(2000);
    b.sync(2500);
    const left = a.doc.books[BOOK]!;
    const right = b.doc.books[BOOK]!;

    expect(canonicalJson(mergeSyncedBooks(left, right))).toBe(canonicalJson(mergeSyncedBooks(right, left)));
    const once = mergeSyncedBooks(left, right);
    expect(canonicalJson(mergeSyncedBooks(once, right))).toBe(canonicalJson(once));
  });

  it("parses its own output and rejects files that are not sync documents", () => {
    const device = new Device("device", bookState({ highlights: [highlight("a", { note: "Note" })], bookmarks: [bookmark("m")] }));
    device.sync(2000);
    const parsed = parseSyncDocument(canonicalJson(device.doc));

    expect(parsed && canonicalJson(parsed.books)).toBe(canonicalJson(device.doc.books));
    expect(parseSyncDocument("not json")).toBeNull();
    expect(parseSyncDocument(JSON.stringify({ format: "something-else", version: 1, deviceId: "x", books: {} }))).toBeNull();
    expect(parseSyncDocument(JSON.stringify({ format: "omni-book-reader-sync", version: 1, books: {} }))).toBeNull();
  });

  it("prefers the single annotation file over an older highlight/note pair in any merge order", () => {
    const pair = { ...emptySyncedBook(), annotationDocuments: { highlightPath: "Books/a/a-Highlight-2026-01-01.md", notePath: "Books/a/a-Note-2026-01-01.md", createdDate: "2026-01-01" } };
    const single = { ...emptySyncedBook(), annotationDocuments: { highlightPath: "Media/Books/Attachments/A Notes.md", notePath: "Media/Books/Attachments/A Notes.md", createdDate: "2026-01-01" } };

    expect(mergeSyncedBooks(pair, single).annotationDocuments).toEqual(single.annotationDocuments);
    expect(mergeSyncedBooks(single, pair).annotationDocuments).toEqual(single.annotationDocuments);

    const bookNote = { ...emptySyncedBook(), annotationDocuments: { highlightPath: "Media/Books/A.md", notePath: "Media/Books/A.md", createdDate: "2026-01-01" } };
    expect(mergeSyncedBooks(single, bookNote).annotationDocuments).toEqual(bookNote.annotationDocuments);
    expect(mergeSyncedBooks(bookNote, single).annotationDocuments).toEqual(bookNote.annotationDocuments);
  });

  it("syncs the page a highlight was made on", () => {
    const device = new Device("device", bookState({ highlights: [highlight("a", { page: "12" })] }));
    device.sync(2000);
    const parsed = parseSyncDocument(canonicalJson(device.doc));
    const highlights = Object.values(Object.values(parsed?.books ?? {})[0]?.highlights ?? {});
    expect(highlights[0] && "value" in highlights[0] ? highlights[0].value.page : undefined).toBe("12");
  });
});
