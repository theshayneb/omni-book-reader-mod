import { normalizePath } from "obsidian";
import type { TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { compare as compareCfi } from "foliate-js/epubcfi.js";
import type {
  AnnotationDocuments,
  BookState,
  ExportTemplatePreset,
  ReaderHighlight,
} from "./types";

const LEGACY_GENERATED_MARKER = "<!-- omni-book-reader:generated -->";

/** Every book's highlights and notes are kept in one file, `<title>-Notes.md`, in this vault folder. */
export const ANNOTATION_FOLDER = "Media/Books/Attachments";

const FRONTMATTER = "---\ntags:\n  - book_notes\n---\n";

/** `annotations` is the current single-file block; the other two are only read when moving old files. */
type AnnotationDocumentKind = "annotations" | "highlights" | "notes";

export interface AnnotationDocumentInput {
  sourceFile: TFile;
  state: BookState;
  title: string;
  author: string;
  exportTemplate?: ExportTemplatePreset;
  customExportTemplatePath?: string;
}

export interface AnnotationRenderOptions {
  sourcePath?: string;
  vaultName?: string;
  preset?: ExportTemplatePreset;
  customTemplate?: string;
  exportedAt?: number;
}

function isFile(value: TAbstractFile | null): value is TFile {
  return Boolean(value && "extension" in value);
}

function isFolder(value: TAbstractFile | null): value is TFolder {
  return Boolean(value && "children" in value);
}

function dateStamp(timestamp: number): string {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function singleLine(value: string, fallback = ""): string {
  return value.replace(/\s+/g, " ").trim() || fallback;
}

function quote(value: string): string {
  return value.replace(/\r\n?/g, "\n").split("\n").map((line) => `> ${line}`).join("\n");
}

/** Turns a highlight tag into an Obsidian tag: spaces become `_` and characters tags cannot hold are dropped. */
export function toObsidianTag(tag: string): string {
  const body = tag.trim().replace(/^#+/, "").replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_/-]/gu, "");
  return body ? `#${body}` : "";
}

/** Every highlighted passage ends with this tag in the annotation file. */
const QUOTE_TAG = "#quote";

/** The highlighted text with `#quote` at the end of its last line. */
function taggedText(text: string): string {
  return `${text.replace(/\r\n?/g, "\n").trimEnd()} ${QUOTE_TAG}`;
}

function tagText(highlight: ReaderHighlight): string {
  const tags = new Set(highlight.tags.map(toObsidianTag).filter(Boolean));
  tags.delete(QUOTE_TAG);
  return Array.from(tags).join(" ");
}

function pageText(highlight: ReaderHighlight): string {
  return highlight.page ? `Page ${singleLine(highlight.page)}` : "";
}

/** Builds the vault file name from the EPUB title, dropping characters that file names and links cannot hold. */
export function annotationFileName(title: string, fallback: string): string {
  const clean = (value: string): string => value
    .replace(/[\\/:*?"<>|#^[\]\p{Cc}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+/, "")
    .replace(/[\s.]+$/, "")
    .slice(0, 180)
    .trim();
  return clean(title) || clean(fallback) || "Untitled book";
}

export function annotationDocumentPath(title: string, sourceFile: TFile): string {
  return normalizePath(`${ANNOTATION_FOLDER}/${annotationFileName(title, sourceFile.basename)}-Notes.md`);
}

function comparePosition(left: ReaderHighlight, right: ReaderHighlight): number {
  if (left.sectionIndex !== right.sectionIndex) return left.sectionIndex - right.sectionIndex;
  try {
    const order = compareCfi(left.cfi, right.cfi);
    if (order) return order;
  } catch {
    // Fall back to creation order when a CFI cannot be parsed.
  }
  return left.createdAt - right.createdAt || left.id.localeCompare(right.id);
}

/** Highlights in book order, grouped under the chapter they belong to. */
function chapterGroups(highlights: ReaderHighlight[]): Array<{ chapter: string; highlights: ReaderHighlight[] }> {
  const groups: Array<{ chapter: string; highlights: ReaderHighlight[] }> = [];
  for (const highlight of [...highlights].sort(comparePosition)) {
    const chapter = singleLine(highlight.chapter, "Untitled chapter");
    const last = groups[groups.length - 1];
    if (last?.chapter === chapter) last.highlights.push(highlight);
    else groups.push({ chapter, highlights: [highlight] });
  }
  return groups;
}

/** `obsidian://` action for links back into a book. Separate from the original plugin's `omni-book-reader`. */
export const PROTOCOL_ACTION = "omni-book-reader-mod";
const PROTOCOL_PREFIXES = [`obsidian://${PROTOCOL_ACTION}?`, "obsidian://omni-book-reader?"];

/** True for links made by this plugin or, from before it became separate, by the original one. */
export function isBookLink(href: string): boolean {
  return PROTOCOL_PREFIXES.some((prefix) => href.startsWith(prefix));
}

export function buildCfiLink(vaultName: string, sourcePath: string, cfi: string): string {
  const encode = (value: string): string => encodeURIComponent(value)
    .replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  const params = [
    // `vault` is reserved by Obsidian and is resolved before custom protocol
    // handlers run. Keep the source Vault as plugin-owned metadata instead.
    vaultName ? `sourceVault=${encode(vaultName)}` : "",
    `path=${encode(normalizePath(sourcePath))}`,
    `cfi=${encode(cfi)}`,
  ].filter(Boolean).join("&");
  return `obsidian://${PROTOCOL_ACTION}?${params}`;
}

function sourceLink(highlight: ReaderHighlight, options: AnnotationRenderOptions): string {
  if (!options.sourcePath) return "";
  return `[Open in book](${buildCfiLink(options.vaultName ?? "", options.sourcePath, highlight.cfi)})`;
}

function entryDetails(highlight: ReaderHighlight, options: AnnotationRenderOptions): string {
  return [pageText(highlight), dateStamp(highlight.createdAt), tagText(highlight), sourceLink(highlight, options)]
    .filter(Boolean)
    .join(" · ");
}

/** A highlight's note as one Markdown bullet; extra lines are indented so they stay inside it. */
export function noteBullet(note: string, indent = ""): string {
  const lines = note.replace(/\r\n?/g, "\n").split("\n")
    .map((line) => line.trim().replace(/^[-*+]\s+/, ""))
    .filter(Boolean);
  return lines.map((line, index) => `${indent}${index ? "  " : "- "}${line}`).join("\n");
}

function renderClassicEntry(highlight: ReaderHighlight, options: AnnotationRenderOptions): string {
  const lines = [quote(taggedText(highlight.text)), ""];
  const note = highlight.note?.trim();
  if (note) lines.push(noteBullet(note), "");
  lines.push(entryDetails(highlight, options));
  return lines.join("\n");
}

function renderCompactEntry(highlight: ReaderHighlight, options: AnnotationRenderOptions): string {
  const lines = [`- ${taggedText(singleLine(highlight.text, "(empty excerpt)"))}`];
  const note = highlight.note?.trim();
  if (note) lines.push(noteBullet(note, "  "));
  lines.push(`  - ${entryDetails(highlight, options)}`);
  return lines.join("\n");
}

function renderCalloutEntry(highlight: ReaderHighlight, options: AnnotationRenderOptions): string {
  const lines = [`> [!quote]${highlight.page ? ` ${pageText(highlight)}` : ""}`, quote(taggedText(highlight.text))];
  const note = highlight.note?.trim();
  if (note) lines.push(">", quote(noteBullet(note)));
  lines.push(">", `> ${entryDetails(highlight, options)}`);
  return lines.join("\n");
}

function renderEntries(highlights: ReaderHighlight[], options: AnnotationRenderOptions): string {
  if (!highlights.length) return "_No highlights yet._";
  const preset = options.preset ?? "classic";
  const render = preset === "compact"
    ? renderCompactEntry
    : preset === "callout"
      ? renderCalloutEntry
      : renderClassicEntry;
  const separator = preset === "compact" ? "\n" : "\n\n";
  return chapterGroups(highlights)
    .map((group) => `## ${group.chapter}\n\n${group.highlights.map((item) => render(item, options)).join(separator)}`)
    .join("\n\n");
}

function applyDocumentTemplate(template: string, variables: Record<string, string>): string {
  let output = template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, key: string) => variables[key] ?? match);
  if (!/\{\{\s*entries\s*\}\}/.test(template)) output = `${output.trimEnd()}\n\n${variables.entries}`;
  return `${output.trim() || variables.entries}\n`;
}

/**
 * Wikilink to the book's own note, the Markdown file named like the EPUB
 * (`Dune - Frank Herbert.epub` → `[[Dune - Frank Herbert]]`). Falls back to the title without a source path.
 */
export function bookNoteLink(title: string, sourcePath?: string): string {
  const fileName = normalizePath(sourcePath ?? "").split("/").pop() ?? "";
  const noteName = fileName.replace(/\.epub$/i, "").replace(/[[\]|#^]/g, "").trim();
  return noteName ? `[[${noteName}]]` : title;
}

/** Renders the managed part of a book's annotation file: every highlight, with its note, grouped by chapter. */
export function renderAnnotationDocument(
  title: string,
  author: string,
  highlights: ReaderHighlight[],
  options: AnnotationRenderOptions = {},
): string {
  const bookTitle = singleLine(title, "Untitled book");
  const entries = renderEntries(highlights, options);
  const normalizedAuthor = singleLine(author);
  const bookLink = bookNoteLink(bookTitle, options.sourcePath);
  const builtIn = [
    `# ${bookLink}`,
    "",
    entries,
  ].join("\n");
  if (!options.customTemplate?.trim()) return `${builtIn.trimEnd()}\n`;
  return applyDocumentTemplate(options.customTemplate, {
    "document.title": "Highlights and notes",
    "document.kind": "annotations",
    "book.title": bookTitle,
    "book.author": normalizedAuthor,
    "book.link": bookLink,
    "book.filePath": normalizePath(options.sourcePath ?? ""),
    "export.date": dateStamp(options.exportedAt ?? Date.now()),
    entries,
  });
}

function managedStart(kind: AnnotationDocumentKind): string {
  return `<!-- omni-book-reader:${kind}:start -->`;
}

function managedEnd(kind: AnnotationDocumentKind): string {
  return `<!-- omni-book-reader:${kind}:end -->`;
}

export function mergeManagedDocument(existing: string, kind: AnnotationDocumentKind, generated: string): string {
  const start = managedStart(kind);
  const end = managedEnd(kind);
  const safeGenerated = generated.replace(/<!--\s*omni-book-reader:/gi, "&lt;!-- omni-book-reader:");
  const block = `${start}\n${safeGenerated.trim()}\n${end}`;
  const startIndex = existing.indexOf(start);
  const endIndex = startIndex >= 0 ? existing.indexOf(end, startIndex + start.length) : -1;
  const orphanEndIndex = existing.indexOf(end);
  if ((startIndex >= 0 && endIndex < 0) || (startIndex < 0 && orphanEndIndex >= 0)) {
    throw new Error(`The ${kind} managed-block markers in the annotation document are incomplete. Fix or remove the markers and try again.`);
  }
  if (startIndex >= 0 && endIndex >= 0) {
    if (existing.indexOf(start, startIndex + start.length) >= 0 || existing.indexOf(end, endIndex + end.length) >= 0) {
      throw new Error(`The annotation document contains more than one ${kind} managed block. Keep only one pair of markers.`);
    }
    const merged = `${existing.slice(0, startIndex)}${block}${existing.slice(endIndex + end.length)}`;
    return merged.endsWith("\n") ? merged : `${merged}\n`;
  }
  if (existing.trimStart().startsWith(LEGACY_GENERATED_MARKER)) return `${block}\n`;
  if (!existing.trim()) return `${block}\n`;
  return `${existing.trimEnd()}\n\n${block}\n`;
}

/** Adds the `book_notes` tag frontmatter unless the file already has frontmatter of its own. */
export function withFrontmatter(content: string): string {
  return /^---\r?\n/.test(content) ? content : `${FRONTMATTER}${content}`;
}

/** What the person wrote in an annotation file, without the plugin's generated blocks or default frontmatter. */
export function userContent(content: string): string {
  if (content.trimStart().startsWith(LEGACY_GENERATED_MARKER)) return "";
  let rest = content.startsWith(FRONTMATTER) ? content.slice(FRONTMATTER.length) : content;
  for (const kind of ["annotations", "highlights", "notes"] as const) {
    const start = managedStart(kind);
    const end = managedEnd(kind);
    const startIndex = rest.indexOf(start);
    const endIndex = startIndex >= 0 ? rest.indexOf(end, startIndex + start.length) : -1;
    if (endIndex >= 0) rest = `${rest.slice(0, startIndex)}${rest.slice(endIndex + end.length)}`;
  }
  return rest.replace(/\n{3,}/g, "\n\n").trim();
}

function parentPath(path: string): string {
  const normalized = normalizePath(path);
  const separator = normalized.lastIndexOf("/");
  return separator < 0 ? "" : normalized.slice(0, separator);
}

function joinPath(...parts: string[]): string {
  return normalizePath(parts.filter(Boolean).join("/"));
}

export class AnnotationDocumentService {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly vault: Vault,
    /** Should be `app.fileManager.trashFile`, which respects the person's deletion preference. */
    private readonly trashFile: (file: TAbstractFile) => Promise<void>,
  ) {}

  sync(input: AnnotationDocumentInput): Promise<void> {
    const job = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const path = annotationDocumentPath(input.title, input.sourceFile);
        const previous = input.state.annotationDocuments;
        const preset = input.exportTemplate ?? "classic";
        const customTemplate = preset === "custom"
          ? await this.loadCustomTemplate(input.customExportTemplatePath, path)
          : "";
        const options: AnnotationRenderOptions = {
          sourcePath: input.sourceFile.path,
          vaultName: this.vault.getName(),
          preset,
          ...(customTemplate ? { customTemplate } : {}),
        };
        const markdown = renderAnnotationDocument(input.title, input.author, input.state.highlights, options);
        const oldFiles = this.oldDocumentFiles(previous, path);
        const carried: string[] = [];
        for (const file of oldFiles) {
          const text = userContent(await this.vault.cachedRead(file));
          if (text) carried.push(text);
        }
        await this.ensureFolder(parentPath(path));
        await this.upsertManaged(path, markdown, carried);
        input.state.annotationDocuments = {
          highlightPath: path,
          notePath: path,
          createdDate: previous?.createdDate || dateStamp(Date.now()),
        };
        await this.removeOldDocuments(oldFiles);
      });
    this.writeChain = job.catch(() => undefined);
    return job;
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  migrateLegacyProtocolLinks(documents: Iterable<AnnotationDocuments | undefined>): Promise<void> {
    const paths = new Set<string>();
    for (const item of documents) {
      if (item?.highlightPath) paths.add(normalizePath(item.highlightPath));
      if (item?.notePath) paths.add(normalizePath(item.notePath));
    }
    const job = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        for (const path of paths) {
          const file = this.vault.getAbstractFileByPath(path);
          if (!isFile(file) || file.extension.toLowerCase() !== "md") continue;
          const current = await this.vault.cachedRead(file);
          // Older links used `vault=` (reserved by Obsidian) and the original plugin's action.
          const next = current
            .replace(/obsidian:\/\/omni-book-reader(?:-mod)?\?vault=/g, `obsidian://${PROTOCOL_ACTION}?sourceVault=`)
            .replaceAll("obsidian://omni-book-reader?", `obsidian://${PROTOCOL_ACTION}?`);
          if (next !== current) await this.vault.modify(file, next);
        }
      });
    this.writeChain = job.catch(() => undefined);
    return job;
  }

  private async loadCustomTemplate(path: string | undefined, documentPath: string): Promise<string> {
    const normalized = normalizePath(path?.trim() ?? "");
    if (!normalized) throw new Error("No custom export template path is set.");
    if (normalized === documentPath) {
      throw new Error("The custom template cannot be this book's highlights and notes file.");
    }
    const file = this.vault.getAbstractFileByPath(normalized);
    if (!isFile(file) || file.extension.toLowerCase() !== "md") throw new Error(`Custom export template not found: ${normalized}`);
    return this.vault.cachedRead(file);
  }

  /** Files from the old two-file layout (or an earlier title) that should be folded into `path`. */
  private oldDocumentFiles(previous: AnnotationDocuments | undefined, path: string): TFile[] {
    if (!previous) return [];
    const files: TFile[] = [];
    for (const oldPath of new Set([previous.highlightPath, previous.notePath])) {
      if (normalizePath(oldPath) === path) continue;
      const file = this.vault.getAbstractFileByPath(normalizePath(oldPath));
      if (isFile(file) && file.extension.toLowerCase() === "md") files.push(file);
    }
    return files;
  }

  private async removeOldDocuments(files: TFile[]): Promise<void> {
    const folders = new Set(files.map((file) => parentPath(file.path)));
    for (const file of files) await this.trashFile(file);
    for (const folderPath of folders) {
      if (!folderPath || normalizePath(folderPath) === normalizePath(ANNOTATION_FOLDER)) continue;
      const folder = this.vault.getAbstractFileByPath(folderPath);
      if (isFolder(folder) && !folder.children.length) await this.trashFile(folder);
    }
  }

  private async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    let current = "";
    for (const segment of normalizePath(path).split("/")) {
      current = joinPath(current, segment);
      const existing = this.vault.getAbstractFileByPath(current);
      if (isFile(existing)) throw new Error(`Could not create the notes folder because a file already exists at: ${current}`);
      if (!existing) await this.vault.createFolder(current);
    }
  }

  private async upsertManaged(path: string, generated: string, carried: string[]): Promise<void> {
    const existing = this.vault.getAbstractFileByPath(path);
    if (existing && !isFile(existing)) {
      throw new Error(`Could not write the annotation document because the path is not a file: ${path}`);
    }
    const current = isFile(existing) ? await this.vault.cachedRead(existing) : "";
    let next = withFrontmatter(mergeManagedDocument(current, "annotations", generated));
    for (const text of carried) {
      if (!next.includes(text)) next = `${next.trimEnd()}\n\n${text}\n`;
    }
    if (!isFile(existing)) await this.vault.create(path, next);
    else if (next !== current) await this.vault.modify(existing, next);
  }
}
