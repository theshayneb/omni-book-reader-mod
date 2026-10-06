import { normalizePath } from "obsidian";
import type { TAbstractFile, TFile, TFolder, Vault } from "obsidian";
import { compare as compareCfi } from "foliate-js/epubcfi.js";
import type { AnnotationDocuments, BookState, ReaderHighlight } from "./types";

const LEGACY_GENERATED_MARKER = "<!-- omni-book-reader:generated -->";

/** Marker comments from the generated files of earlier versions; only read when moving those files. */
type AnnotationDocumentKind = "annotations" | "highlights" | "notes";

/** Where earlier versions kept a separate `<title> Notes.md` file per book. */
export const ANNOTATION_FOLDER = "Media/Books/Attachments";

/** The callout in each book note that holds the highlights. */
export const HIGHLIGHTS_CALLOUT = "> > > [!quotenew] Quotes & References";
/** Every highlight is one line under the callout, starting with this. */
export const HIGHLIGHT_LINE_PREFIX = "> > - ";

/** A leading YAML frontmatter block. */
const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n?---[ \t]*(?:\r?\n|$)/;

export interface AnnotationDocumentInput {
  sourceFile: TFile;
  state: BookState;
  title: string;
  author: string;
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

/** Turns a highlight tag into an Obsidian tag: spaces become `_` and characters tags cannot hold are dropped. */
export function toObsidianTag(tag: string): string {
  const body = tag.trim().replace(/^#+/, "").replace(/\s+/g, "_").replace(/[^\p{L}\p{N}_/-]/gu, "");
  return body ? `#${body}` : "";
}

/** Every highlighted passage is followed by this tag. */
const QUOTE_TAG = "#quote";

function tagText(highlight: ReaderHighlight): string {
  const tags = new Set(highlight.tags.map(toObsidianTag).filter(Boolean));
  tags.delete(QUOTE_TAG);
  return Array.from(tags).join(" ");
}

/** Builds a vault file name from the EPUB title, dropping characters that file names and links cannot hold. */
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

/** The separate notes files earlier versions wrote for a book (`<title> Notes.md`, and `<title>-Notes.md` before that). */
function companionPaths(title: string, sourceFile: TFile): string[] {
  const name = annotationFileName(title, sourceFile.basename);
  return [`${name} Notes.md`, `${name}-Notes.md`].map((file) => normalizePath(`${ANNOTATION_FOLDER}/${file}`));
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

/** `obsidian://` action for links back into a book. Separate from the original plugin's `omni-book-reader`. */
export const PROTOCOL_ACTION = "omni-book-reader-mod";
const PROTOCOL_PREFIXES = [`obsidian://${PROTOCOL_ACTION}?`, "obsidian://omni-book-reader?"];
/** A Markdown link made by this plugin (or, from before it became separate, by the original one). */
const BOOK_LINK = /\]\(obsidian:\/\/omni-book-reader(?:-mod)?\?[^)\s]*\)/;

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

/**
 * One highlight as a line under the book note's callout:
 * `> > - passage #quote #tags *-- note* *(Chapter, [p. 14](link))*`.
 * A saved word lookup is `> > - word *-- definition (Chapter, [p. 14](link))*` instead.
 * The link back into the book is what marks the line as the plugin's.
 */
export function renderHighlightLine(highlight: ReaderHighlight, sourcePath: string, vaultName = ""): string {
  const tags = tagText(highlight);
  const note = singleLine(highlight.note ?? "");
  const chapter = singleLine(highlight.chapter);
  const linkText = highlight.page ? `p. ${singleLine(highlight.page)}` : "Open in book";
  const location = [
    chapter && chapter !== "Untitled chapter" ? chapter : "",
    `[${linkText}](${buildCfiLink(vaultName, sourcePath, highlight.cfi)})`,
  ].filter(Boolean).join(", ");
  if (highlight.lookup) {
    return `${HIGHLIGHT_LINE_PREFIX}${singleLine(highlight.text, "(empty excerpt)")} *${note ? `-- ${note} ` : ""}(${location})*`;
  }
  return [
    `${HIGHLIGHT_LINE_PREFIX}${singleLine(highlight.text, "(empty excerpt)")}`,
    QUOTE_TAG,
    tags,
    note ? `*-- ${note}*` : "",
    `*(${location})*`,
  ].filter(Boolean).join(" ");
}

/** The book's highlights as callout lines, in book order. */
export function renderHighlightLines(highlights: ReaderHighlight[], sourcePath: string, vaultName = ""): string[] {
  return [...highlights].sort(comparePosition).map((highlight) => renderHighlightLine(highlight, sourcePath, vaultName));
}

function isPluginLine(line: string): boolean {
  return BOOK_LINK.test(line);
}

/** A line that continues the callout's list: another `> > -` item or an indented continuation of one. */
function isCalloutListLine(line: string): boolean {
  return /^> > (?:-|\s{2,}\S)/.test(line);
}

/**
 * Puts the plugin's highlight lines under the highlights callout, leaving every other line alone.
 * The plugin's existing lines (those with a link back into a book) are replaced in place, in book order;
 * extra lines go after the last one, or at the end of the callout's list. A missing callout is added at the end.
 */
export function updateHighlightsCallout(content: string, lines: string[]): string {
  const all = content.replace(/\r\n?/g, "\n").split("\n");
  const header = all.findIndex((line) => line.trim() === HIGHLIGHTS_CALLOUT.trim());
  if (header < 0) {
    if (!lines.length) return content;
    const body = content.replace(/\s+$/, "");
    return `${body}${body ? "\n\n" : ""}${[HIGHLIGHTS_CALLOUT, ...lines].join("\n")}\n`;
  }
  let end = header + 1;
  while (end < all.length && isCalloutListLine(all[end] ?? "")) end += 1;
  const region = all.slice(header + 1, end);
  const slots = region.flatMap((line, index) => isPluginLine(line) ? [index] : []);
  const lastSlot = slots[slots.length - 1];
  const next: string[] = [];
  let used = 0;
  region.forEach((line, index) => {
    if (!isPluginLine(line)) {
      next.push(line);
      return;
    }
    if (used < lines.length) next.push(lines[used] ?? "");
    used += 1;
    if (index === lastSlot) next.push(...lines.slice(used));
  });
  if (lastSlot === undefined) next.push(...lines);
  const updated = [...all.slice(0, header + 1), ...next, ...all.slice(end)].join("\n");
  return updated === content.replace(/\r\n?/g, "\n") ? content : updated;
}

function managedStart(kind: AnnotationDocumentKind): string {
  return `<!-- omni-book-reader:${kind}:start -->`;
}

function managedEnd(kind: AnnotationDocumentKind): string {
  return `<!-- omni-book-reader:${kind}:end -->`;
}

/** True for a file the plugin generated in an earlier version; nothing else is ever moved or trashed. */
function isGeneratedDocument(content: string): boolean {
  return content.includes("<!-- omni-book-reader:");
}

/** What the person wrote in an earlier generated file, without the plugin's blocks or its frontmatter. */
export function userContent(content: string): string {
  if (content.trimStart().startsWith(LEGACY_GENERATED_MARKER)) return "";
  let rest = content.replace(FRONTMATTER_BLOCK, "");
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

export class AnnotationDocumentService {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(
    private readonly vault: Vault,
    /** Should be `app.fileManager.trashFile`, which respects the person's deletion preference. */
    private readonly trashFile: (file: TAbstractFile) => Promise<void>,
    /** Finds the Markdown note named like the EPUB (`Dune.epub` → `Dune.md`). */
    private readonly findBookNote: (sourceFile: TFile) => TFile | null,
  ) {}

  sync(input: AnnotationDocumentInput): Promise<void> {
    const job = this.writeChain
      .catch(() => undefined)
      .then(async () => {
        const note = this.findBookNote(input.sourceFile);
        if (!note) {
          throw new Error(`No note named "${input.sourceFile.basename}" was found to hold this book's highlights.`);
        }
        const previous = input.state.annotationDocuments;
        const lines = renderHighlightLines(input.state.highlights, input.sourceFile.path, this.vault.getName());
        const oldFiles = await this.oldDocumentFiles(input, previous, note.path);
        const current = await this.vault.cachedRead(note);
        let next = updateHighlightsCallout(current, lines);
        for (const file of oldFiles) {
          const text = userContent(await this.vault.cachedRead(file));
          if (text && !next.includes(text)) next = `${next.trimEnd()}\n\n${text}\n`;
        }
        if (next !== current) await this.vault.modify(note, next);
        input.state.annotationDocuments = {
          highlightPath: note.path,
          notePath: note.path,
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

  /** Generated files from earlier versions (Highlight/Note pairs, `<title> Notes.md`) to fold into the book note. */
  private async oldDocumentFiles(
    input: AnnotationDocumentInput,
    previous: AnnotationDocuments | undefined,
    notePath: string,
  ): Promise<TFile[]> {
    const candidates = new Set([
      ...(previous ? [previous.highlightPath, previous.notePath] : []),
      ...companionPaths(input.title, input.sourceFile),
    ].map((path) => normalizePath(path)));
    candidates.delete(normalizePath(notePath));
    const files: TFile[] = [];
    for (const path of candidates) {
      const file = this.vault.getAbstractFileByPath(path);
      if (!isFile(file) || file.extension.toLowerCase() !== "md") continue;
      if (isGeneratedDocument(await this.vault.cachedRead(file))) files.push(file);
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
}
