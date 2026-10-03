import type { TAbstractFile, TFile, Vault } from "obsidian";
import { describe, expect, it, vi } from "vitest";
import {
  AnnotationDocumentService,
  annotationFileName,
  bookNoteLink,
  buildCfiLink,
  mergeManagedDocument,
  renderAnnotationDocument,
  toObsidianTag,
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

type Entry = { path: string; extension?: string; content?: string; children?: Entry[] };

function memoryVault() {
  const entries = new Map<string, Entry>();
  const parent = (path: string) => entries.get(path.slice(0, Math.max(0, path.lastIndexOf("/"))));
  const vault = {
    getAbstractFileByPath: vi.fn((path: string) => entries.get(path) ?? null),
    createFolder: vi.fn(async (path: string) => { entries.set(path, { path, children: [] }); }),
    create: vi.fn(async (path: string, content: string) => {
      const file = { path, extension: "md", content };
      entries.set(path, file);
      parent(path)?.children?.push(file);
      return file;
    }),
    modify: vi.fn(async (file: Entry, content: string) => { file.content = content; }),
    cachedRead: vi.fn(async (file: Entry) => file.content ?? ""),
    getName: vi.fn(() => "Test Vault"),
  };
  const trash = vi.fn(async (file: TAbstractFile) => {
    entries.delete(file.path);
    const folder = parent(file.path);
    if (folder?.children) folder.children = folder.children.filter((child) => child.path !== file.path);
  });
  const addFile = (path: string, content: string) => {
    const folderPath = path.slice(0, path.lastIndexOf("/"));
    if (!entries.has(folderPath)) entries.set(folderPath, { path: folderPath, children: [] });
    const file = { path, extension: "md", content };
    entries.set(path, file);
    entries.get(folderPath)!.children!.push(file);
  };
  return { entries, vault, typedVault: vault as unknown as Vault, trash, addFile };
}

const sourceFile = { path: "Books/Test Book.epub", basename: "Test Book" } as TFile;
const documentPath = "Media/Books/Attachments/Test Book-Notes.md";

function bookState(highlights: ReaderHighlight[]): BookState {
  return { sourceSignature: { size: 1, mtime: 1 }, bookmarks: [], highlights };
}

describe("annotation documents", () => {
  it("renders highlights and notes together, grouped by chapter in book order", () => {
    const options = { sourcePath: "Books/Test Book.epub", vaultName: "Test Vault" };
    const markdown = renderAnnotationDocument("Test Book", "Test Author", [
      highlight({ id: "late", cfi: "epubcfi(/6/4!/4/2:0)", sectionIndex: 1, chapter: "Chapter 2", text: "Second chapter", createdAt: 1 }),
      highlight({ id: "b", cfi: "epubcfi(/6/2!/4/8:0)", text: "Later in chapter one", page: "14", tags: ["big idea", "#archetype"] }),
      highlight({ id: "a", cfi: "epubcfi(/6/2!/4/2:0)", text: "Early in chapter one", note: "My thoughts", noteUpdatedAt: createdAt, createdAt: createdAt + 5 }),
    ], options);

    expect(markdown).toContain("# [[Test Book]]\n\n## Chapter 1");
    expect(markdown.indexOf("## Chapter 1")).toBeLessThan(markdown.indexOf("## Chapter 2"));
    expect(markdown.match(/## Chapter 1/g)).toHaveLength(1);
    expect(markdown.indexOf("Early in chapter one")).toBeLessThan(markdown.indexOf("Later in chapter one"));
    expect(markdown).toContain("> Early in chapter one #quote\n\n- My thoughts\n\n2026-07-19");
    expect(markdown).toContain("> Later in chapter one #quote\n\nPage 14 · 2026-07-19 · #big_idea #archetype · [Open in book](obsidian://omni-book-reader-mod?sourceVault=");
    expect(markdown).not.toMatch(/Color|#FFD54F|yellow/i);
    expect(markdown).not.toMatch(/[?&]vault=/);
  });

  it("renders the compact and callout presets with pages and tags", () => {
    const item = highlight({ page: "3", tags: ["quote"], note: "Line one\n\n- Line two" });
    const compact = renderAnnotationDocument("Book", "", [item], { preset: "compact" });
    expect(compact).toContain("## Chapter 1\n\n- The highlighted source text #quote\n  - Line one\n  - Line two\n  - Page 3 · 2026-07-19");
    const callout = renderAnnotationDocument("Book", "", [item], { preset: "callout" });
    expect(callout).toContain("> [!quote] Page 3\n> The highlighted source text #quote\n>\n> - Line one\n> - Line two\n>\n> Page 3 · 2026-07-19");
  });

  it("makes file names and tags Obsidian-safe", () => {
    expect(annotationFileName("Dune: Messiah / Part #1?", "fallback")).toBe("Dune Messiah Part 1");
    expect(annotationFileName("  ", "Test Book")).toBe("Test Book");
    expect(toObsidianTag("big idea!")).toBe("#big_idea");
    expect(toObsidianTag("#already/nested")).toBe("#already/nested");
    expect(toObsidianTag("!!!")).toBe("");
  });

  it("preserves manual text outside managed blocks and supports custom templates", () => {
    const generated = renderAnnotationDocument("Test Book", "Author", [highlight()], {
      sourcePath: "Books/Test Book.epub",
      vaultName: "Vault",
      customTemplate: "# {{book.title}}\nExported: {{export.date}}\n\n{{entries}}",
      exportedAt: createdAt,
    });
    const first = mergeManagedDocument("# My handwritten summary\n", "annotations", generated);
    const withManualSuffix = `${first}\n## My conclusion\nWill not be overwritten by the plugin\n`;
    const second = mergeManagedDocument(withManualSuffix, "annotations", generated.replace("The highlighted source text", "The updated excerpt"));
    expect(second).toContain("# My handwritten summary");
    expect(second).toContain("The updated excerpt");
    expect(second).toContain("## My conclusion\nWill not be overwritten by the plugin");
    expect(second).not.toContain("The highlighted source text");
    expect(second.match(/omni-book-reader:annotations:start/g)).toHaveLength(1);
    expect(generated).toContain("Exported: 2026-07-19");
    expect(userContent(second)).toBe("# My handwritten summary\n\n## My conclusion\nWill not be overwritten by the plugin");
    const cfiLink = buildCfiLink("Vault", "Books/Test Book.epub", highlight().cfi);
    expect(cfiLink).toContain("sourceVault=Vault");
    expect(cfiLink).toContain("cfi=epubcfi%28");
    expect(() => mergeManagedDocument("<!-- omni-book-reader:annotations:start -->\ncorrupted", "annotations", generated))
      .toThrow("managed-block markers in the annotation document are incomplete");
  });

  it("does not resolve a stale custom template path while an internal preset is selected", async () => {
    const { typedVault, vault, trash } = memoryVault();
    const service = new AnnotationDocumentService(typedVault, trash);
    await expect(service.sync({
      sourceFile,
      state: bookState([highlight()]),
      title: "Test Book",
      author: "Test Author",
      exportTemplate: "classic",
      customExportTemplatePath: "Templates/Deleted.md",
    })).resolves.toBeUndefined();
    expect(vault.cachedRead).not.toHaveBeenCalled();
  });

  it("creates one file per book named after the EPUB title, with book_notes frontmatter", async () => {
    const { entries, vault, typedVault, trash } = memoryVault();
    const service = new AnnotationDocumentService(typedVault, trash);
    const state = bookState([highlight()]);
    const input = { sourceFile, state, title: "Test Book", author: "Test Author" };

    await service.sync(input);
    expect(state.annotationDocuments).toMatchObject({ highlightPath: documentPath, notePath: documentPath });
    expect(entries.get(documentPath)?.content).toMatch(/^---\ntags:\n {2}- book_notes\n---\n<!-- omni-book-reader:annotations:start -->\n# \[\[Test Book\]\]\n/);

    state.highlights[0]!.note = "A note added later";
    await service.sync(input);
    await service.sync(input);
    expect(vault.create).toHaveBeenCalledTimes(1);
    expect(vault.modify).toHaveBeenCalledTimes(1);
    expect(entries.get(documentPath)?.content).toContain("- A note added later");
    expect(trash).not.toHaveBeenCalled();

    const document = entries.get(documentPath)!;
    document.content = `${document.content!.replace("?sourceVault=", "?vault=")}\n[Old](obsidian://omni-book-reader?sourceVault=V&path=p&cfi=c)\n`;
    await service.migrateLegacyProtocolLinks([state.annotationDocuments]);
    expect(document.content).toContain("obsidian://omni-book-reader-mod?sourceVault=Test");
    expect(document.content).toContain("[Old](obsidian://omni-book-reader-mod?sourceVault=V&path=p&cfi=c)");
    expect(document.content).not.toMatch(/omni-book-reader\?|[?&]vault=/);
  });

  it("moves an old highlight/note pair into the new file and trashes the old files", async () => {
    const { entries, typedVault, trash, addFile } = memoryVault();
    const oldHighlights = "Books/Test Book/Test Book-Highlight-2026-07-19.md";
    const oldNotes = "Books/Test Book/Test Book-Note-2026-07-19.md";
    addFile(oldHighlights, "<!-- omni-book-reader:highlights:start -->\n# Old\n<!-- omni-book-reader:highlights:end -->\n");
    addFile(oldNotes, "My own summary\n\n<!-- omni-book-reader:notes:start -->\n# Old\n<!-- omni-book-reader:notes:end -->\n");
    const state = bookState([highlight()]);
    state.annotationDocuments = { highlightPath: oldHighlights, notePath: oldNotes, createdDate: "2026-07-19" };
    const service = new AnnotationDocumentService(typedVault, trash);

    await service.sync({ sourceFile, state, title: "Test Book", author: "" });

    const content = entries.get(documentPath)?.content ?? "";
    expect(content).toContain("omni-book-reader:annotations:end -->\n\nMy own summary\n");
    expect(content).not.toContain("# Old");
    expect(state.annotationDocuments).toEqual({ highlightPath: documentPath, notePath: documentPath, createdDate: "2026-07-19" });
    expect(trash.mock.calls.map(([file]) => file.path)).toEqual([oldHighlights, oldNotes, "Books/Test Book"]);

    // A second device repeating the move does not duplicate the carried text.
    addFile(oldNotes, "My own summary\n");
    state.annotationDocuments = { highlightPath: oldHighlights, notePath: oldNotes, createdDate: "2026-07-19" };
    await service.sync({ sourceFile, state, title: "Test Book", author: "" });
    expect(entries.get(documentPath)?.content?.match(/My own summary/g)).toHaveLength(1);
  });

  it("keeps the old files when the new file cannot be written", async () => {
    const { entries, typedVault, trash, addFile } = memoryVault();
    const oldHighlights = "Books/Test Book/Test Book-Highlight-2026-07-19.md";
    addFile(oldHighlights, "notes");
    entries.set(documentPath, { path: documentPath, children: [] });
    const state = bookState([highlight()]);
    const previous = { highlightPath: oldHighlights, notePath: oldHighlights, createdDate: "2026-07-19" };
    state.annotationDocuments = previous;
    const service = new AnnotationDocumentService(typedVault, trash);

    await expect(service.sync({ sourceFile, state, title: "Test Book", author: "" })).rejects.toThrow("path is not a file");
    expect(trash).not.toHaveBeenCalled();
    expect(state.annotationDocuments).toBe(previous);
  });

  it("links the heading to the book note named like the EPUB", () => {
    expect(bookNoteLink("Dune", "Books/Dune.epub")).toBe("[[Dune]]");
    expect(bookNoteLink("Dune: Messiah", "Books/Dune Messiah - Frank Herbert.epub")).toBe("[[Dune Messiah - Frank Herbert]]");
    expect(bookNoteLink("Plain", undefined)).toBe("Plain");
    expect(renderAnnotationDocument("Dune", "", [], { sourcePath: "Books/Dune.epub" })).toMatch(/^# \[\[Dune\]\]\n/);
  });
});
