import type { TAbstractFile, TFile, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  AnnotationDocumentService,
  HIGHLIGHTS_CALLOUT,
  annotationFileName,
  buildCfiLink,
  renderHighlightLine,
  renderHighlightLines,
  toObsidianTag,
  updateHighlightsCallout,
  userContent,
} from "../src/annotation-documents";
import type { BookState, ReaderHighlight } from "../src/types";

const createdAt = new Date(2026, 6, 19, 12, 0, 0).getTime();

function highlight(overrides: Partial<ReaderHighlight> = {}): ReaderHighlight {
  return {
    id: "highlight-1",
    cfi: "epubcfi(/6/2!/4/2:0)",
    text: "The highlighted source text",
    chapter: "Chapter 1",
    color: "yellow",
    style: "highlight",
    tags: [],
    sectionIndex: 0,
    createdAt,
    ...overrides,
  };
}

type Entry = { path: string; extension?: string; basename?: string; content?: string; children?: Entry[] };

function memoryVault() {
  const entries = new Map<string, Entry>();
  const parent = (path: string) => entries.get(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => entries.get(path) ?? null),
    modify: vi.fn(async (file: Entry, content: string) => { file.content = content; }),
    cachedRead: vi.fn(async (file: Entry) => file.content ?? ""),
    getName: vi.fn(() => "Test Vault"),
  };
  const trash = vi.fn(async (file: TAbstractFile) => {
    entries.delete(file.path);
    const folder = parent(file.path);
    if (folder?.children) folder.children = folder.children.filter((child) => child.path !== file.path);
  });
  const addFile = (path: string, content: string): Entry => {
    const folderPath = path.slice(0, path.lastIndexOf("/"));
    if (!entries.has(folderPath)) entries.set(folderPath, { path: folderPath, children: [] });
    const basename = path.slice(path.lastIndexOf("/") + 1).replace(/\.md$/, "");
    const file = { path, extension: "md", basename, content };
    entries.set(path, file);
    entries.get(folderPath)!.children!.push(file);
    return file;
  };
  return { entries, vault, typedVault: vault as unknown as Vault, trash, addFile };
}

const sourceFile = { path: "Books/Test Book.epub", basename: "Test Book" } as TFile;
const notePath = "Media/Books/Test Book.md";
const link = (cfi = highlight().cfi) => buildCfiLink("Test Vault", sourceFile.path, cfi);

function bookState(highlights: ReaderHighlight[]): BookState {
  return { sourceSignature: { size: 1, mtime: 1 }, bookmarks: [], highlights };
}

function setup(noteContent: string | null) {
  const vault = memoryVault();
  const note = noteContent === null ? null : vault.addFile(notePath, noteContent);
  const service = new AnnotationDocumentService(vault.typedVault, vault.trash, () => note as TFile | null);
  return { ...vault, service };
}

describe("book note highlights", () => {
  it("renders one line per highlight with tags, note, chapter and page link", () => {
    const line = renderHighlightLine(
      highlight({ page: "14", tags: ["big idea", "quote"], note: "My note.\nStill my note." }),
      sourceFile.path,
      "Test Vault",
    );
    expect(line).toBe(`> > - The highlighted source text #quote #big_idea *-- My note. Still my note.* *(Chapter 1, [p. 14](${link()}))*`);
    expect(renderHighlightLine(highlight({ chapter: "Untitled chapter" }), sourceFile.path, "Test Vault"))
      .toBe(`> > - The highlighted source text #quote *([Open in book](${link()}))*`);
  });

  it("orders lines by position in the book", () => {
    const lines = renderHighlightLines([
      highlight({ id: "c", cfi: "epubcfi(/6/4!/4/2:0)", sectionIndex: 1, text: "Third" }),
      highlight({ id: "b", cfi: "epubcfi(/6/2!/4/8:0)", text: "Second" }),
      highlight({ id: "a", cfi: "epubcfi(/6/2!/4/2:0)", text: "First", createdAt: createdAt + 5 }),
    ], sourceFile.path);
    expect(lines.map((line) => line.split(" #quote")[0])).toEqual(["> > - First", "> > - Second", "> > - Third"]);
  });

  it("updates its own lines in place and leaves the person's lines alone", () => {
    const content = [
      "# Test Book",
      HIGHLIGHTS_CALLOUT,
      "> > - My own reference",
      `> > - Old text #quote ([p. 1](${link("epubcfi(/6/2!/4/2:0)")}))`,
      "> > - Another of mine",
      `> > - Deleted highlight #quote ([p. 2](${link("epubcfi(/6/2!/4/9:0)")}))`,
      "",
      "After the callout",
    ].join("\n");
    const updated = updateHighlightsCallout(content, ["> > - NEW 1", "> > - NEW 2", "> > - NEW 3"]);
    expect(updated).toBe([
      "# Test Book",
      HIGHLIGHTS_CALLOUT,
      "> > - My own reference",
      "> > - NEW 1",
      "> > - Another of mine",
      "> > - NEW 2",
      "> > - NEW 3",
      "",
      "After the callout",
    ].join("\n"));

    const withLinks = updateHighlightsCallout(content, [`> > - Kept #quote ([p. 1](${link()}))`]);
    expect(withLinks).toBe([
      "# Test Book",
      HIGHLIGHTS_CALLOUT,
      "> > - My own reference",
      `> > - Kept #quote ([p. 1](${link()}))`,
      "> > - Another of mine",
      "",
      "After the callout",
    ].join("\n"));
  });

  it("adds lines below the person's items when the plugin has none there yet, and leaves unchanged notes alone", () => {
    const content = `Intro\n${HIGHLIGHTS_CALLOUT}\n> > - Mine\n> >   continued\nOutside`;
    expect(updateHighlightsCallout(content, ["> > - NEW"])).toBe(`Intro\n${HIGHLIGHTS_CALLOUT}\n> > - Mine\n> >   continued\n> > - NEW\nOutside`);
    expect(updateHighlightsCallout(content, [])).toBe(content);
  });

  it("adds the callout at the end of a note that does not have it", () => {
    expect(updateHighlightsCallout("# Test Book\n\nSome notes.\n\n", ["> > - NEW"]))
      .toBe(`# Test Book\n\nSome notes.\n\n${HIGHLIGHTS_CALLOUT}\n> > - NEW\n`);
    expect(updateHighlightsCallout("# Test Book\n", [])).toBe("# Test Book\n");
  });

  it("writes the highlights into the book note", async () => {
    const { entries, vault, service } = setup("---\nstatus: reading\n---\n# Test Book\n");
    const state = bookState([highlight({ page: "3", note: "Nice" })]);

    await service.sync({ sourceFile, state, title: "Test Book", author: "" });
    expect(entries.get(notePath)?.content).toBe(
      `---\nstatus: reading\n---\n# Test Book\n\n${HIGHLIGHTS_CALLOUT}\n> > - The highlighted source text #quote *-- Nice* *(Chapter 1, [p. 3](${link()}))*\n`,
    );
    expect(state.annotationDocuments).toMatchObject({ highlightPath: notePath, notePath });

    await service.sync({ sourceFile, state, title: "Test Book", author: "" });
    expect(vault.modify).toHaveBeenCalledTimes(1);
  });

  it("reports a missing book note instead of writing anywhere else", async () => {
    const { service } = setup(null);
    await expect(service.sync({ sourceFile, state: bookState([highlight()]), title: "Test Book", author: "" }))
      .rejects.toThrow('No note named "Test Book"');
  });

  it("moves an earlier Notes file's own text into the book note and trashes the file", async () => {
    const { entries, service, trash, addFile } = setup("# Test Book\n");
    const companion = "Media/Books/Attachments/Test Book Notes.md";
    addFile(companion, "---\ntags:\n  - book_notes\n---\n<!-- omni-book-reader:annotations:start -->\n# x\n<!-- omni-book-reader:annotations:end -->\n\nMy summary\n");
    const state = bookState([highlight()]);
    state.annotationDocuments = { highlightPath: companion, notePath: companion, createdDate: "2026-10-03" };

    await service.sync({ sourceFile, state, title: "Test Book", author: "" });

    expect(entries.get(notePath)?.content).toContain("> > - The highlighted source text #quote");
    expect(entries.get(notePath)?.content?.trimEnd().endsWith("My summary")).toBe(true);
    expect(trash.mock.calls.map(([file]) => file.path)).toEqual([companion]);
    expect(state.annotationDocuments).toEqual({ highlightPath: notePath, notePath, createdDate: "2026-10-03" });
  });

  it("finds an earlier Notes file by title even without a stored location, and moves old pairs", async () => {
    const { entries, service, trash, addFile } = setup("# Test Book\n");
    addFile("Media/Books/Attachments/Test Book-Notes.md", "<!-- omni-book-reader:annotations:start -->\nx\n<!-- omni-book-reader:annotations:end -->\n");
    addFile("Books/Test Book/Test Book-Highlight-2026-07-19.md", "<!-- omni-book-reader:highlights:start -->\nx\n<!-- omni-book-reader:highlights:end -->\n");
    addFile("Books/Test Book/Test Book-Note-2026-07-19.md", "Pair summary\n\n<!-- omni-book-reader:notes:start -->\nx\n<!-- omni-book-reader:notes:end -->\n");
    const state = bookState([highlight()]);
    state.annotationDocuments = {
      highlightPath: "Books/Test Book/Test Book-Highlight-2026-07-19.md",
      notePath: "Books/Test Book/Test Book-Note-2026-07-19.md",
      createdDate: "2026-07-19",
    };

    await service.sync({ sourceFile, state, title: "Test Book", author: "" });

    expect(trash.mock.calls.map(([file]) => file.path).sort()).toEqual([
      "Books/Test Book",
      "Books/Test Book/Test Book-Highlight-2026-07-19.md",
      "Books/Test Book/Test Book-Note-2026-07-19.md",
      "Media/Books/Attachments/Test Book-Notes.md",
    ]);
    expect(entries.get(notePath)?.content).toContain("Pair summary");
  });

  it("never trashes a file the plugin did not generate", async () => {
    const { service, trash, addFile } = setup("# Test Book\n");
    const renamedNote = "Media/Books/Old Name.md";
    addFile(renamedNote, "# My old book note\n");
    const state = bookState([highlight()]);
    state.annotationDocuments = { highlightPath: renamedNote, notePath: renamedNote, createdDate: "2026-10-03" };

    await service.sync({ sourceFile, state, title: "Test Book", author: "" });
    expect(trash).not.toHaveBeenCalled();
  });

  it("keeps old files when the book note cannot be written", async () => {
    const { service, trash, addFile, vault } = setup("# Test Book\n");
    const companion = "Media/Books/Attachments/Test Book Notes.md";
    addFile(companion, "<!-- omni-book-reader:annotations:start -->\nx\n<!-- omni-book-reader:annotations:end -->\n");
    vault.modify.mockRejectedValueOnce(new Error("disk full"));
    const state = bookState([highlight()]);

    await expect(service.sync({ sourceFile, state, title: "Test Book", author: "" })).rejects.toThrow("disk full");
    expect(trash).not.toHaveBeenCalled();
    expect(state.annotationDocuments).toBeUndefined();
  });

  it("keeps file names and tags Obsidian-safe", () => {
    expect(annotationFileName("Dune: Messiah / Part #1?", "fallback")).toBe("Dune Messiah Part 1");
    expect(toObsidianTag("big idea!")).toBe("#big_idea");
    expect(toObsidianTag("!!!")).toBe("");
    expect(userContent("---\ntags: [x]\n---\n<!-- omni-book-reader:annotations:start -->\ny\n<!-- omni-book-reader:annotations:end -->\n\nMine\n")).toBe("Mine");
  });

  it("rewrites links from earlier versions in old generated files", async () => {
    const { entries, service, addFile } = setup("# Test Book\n");
    const old = "Media/Books/Attachments/Old Notes.md";
    addFile(old, "[a](obsidian://omni-book-reader?vault=V&path=p&cfi=c)\n");
    await service.migrateLegacyProtocolLinks([{ highlightPath: old, notePath: old, createdDate: "" }]);
    expect(entries.get(old)?.content).toBe("[a](obsidian://omni-book-reader-mod?sourceVault=V&path=p&cfi=c)\n");
  });
});
