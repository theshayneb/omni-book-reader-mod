# Annotation documents

Status: Accepted
Date: 2026-10-03

## Context

Earlier versions wrote two Markdown files per book, `<book>-Highlight-<date>.md` and `<book>-Note-<date>.md`, in a folder next to the EPUB, in the order highlights were made, with each highlight's color and style. The owner keeps book notes under `Media/Books/` and wanted one file per book alongside them, in book order, with page numbers, real tags and a `book_notes` tag, and no colors.

## Decision

- **Location:** one file per book at `Media/Books/Attachments/<title> Notes.md` (`ANNOTATION_FOLDER` in `src/annotation-documents.ts`). `<title>` is the EPUB metadata title with `\ / : * ? " < > | # ^ [ ]` and control characters removed, falling back to the EPUB file name. The path is recomputed on every write; `BookState.annotationDocuments` records where the file was last written, with `highlightPath` and `notePath` both set to it.
- **Frontmatter:** set by the `notesFrontmatter` setting ("Notes file properties", YAML, default `tags: [book_notes]`). On every write the configured properties are merged into the file's frontmatter: scalar values replace the file's, list values gain the configured items, and other properties are kept. `{{book.title}}`, `{{book.author}}`, `{{book.link}}` and `{{book.filePath}}` are filled in text values; a value that is only a placeholder may be unquoted. An empty setting leaves frontmatter alone, invalid YAML is rejected by the settings page (and ignored if hand-edited into `data.json`), and a file whose own frontmatter does not parse is not touched. Removing a property from the setting does not remove it from existing files.
- **Content:** one managed block, `<!-- omni-book-reader:annotations:start/end -->`, headed `# [[<EPUB file name>]]`, a link to the book's own note (the Markdown file named like the EPUB, whose name already includes the author), then a `##` heading per chapter. Entries are sorted by spine index, then by CFI (`foliate-js/epubcfi.js` `compare`), falling back to creation time. Each entry shows the quote with `#quote` and then the highlight's own tags at the end of its last line (a highlight tag `quote` is not repeated), its note if any as a single bullet (further lines indented inside it), then `Page N · date · [Open in book](…)`. Colors and styles are not exported. Tags become Obsidian tags: spaces turn into `_`, and characters tags cannot contain are dropped.
- **Pages:** `ReaderHighlight.page` stores the page shown in the reader when the highlight was made: the publisher page-list label if the EPUB has one, otherwise Foliate's location number (the same number the reader shows as "Page"). Highlights made before 1.1.3 have no page.
- **Moving old files:** when the stored location differs from the computed path (the old pair, or a book whose title changed), the next write reads each old file, keeps any text outside the plugin's managed blocks and appends it below the new file's block (skipped if the new file already contains that text), records the new location, and only then moves the old files, and their folder if it is now empty, to the trash through `FileManager.trashFile`. If the new file cannot be written, nothing is trashed and the old location is kept.
- **Sync:** the merge rule for `annotationDocuments` prefers a single-file location over a two-file pair, so a device that has not reopened a book yet cannot switch the others back to the old layout.

## Alternatives considered

- A setting for the folder: not needed for a single-owner fork; the constant is easy to change.
- Naming the file after the EPUB file name: the owner's book notes are named by title.

## Consequences

- Two different EPUBs with the same title would share one file and overwrite each other's managed block. Recorded as TD-2026-004.
- The file is only moved when the book is opened, or when a highlight changes, not for every book at startup.

## Validation

`tests/annotation-documents.test.ts` covers ordering, grouping, each preset, file-name and tag cleanup, frontmatter, moving an old pair with user text, repeating the move without duplicating text, and keeping old files when the write fails. `tests/reading-sync-model.test.ts` covers the merge preference and syncing `page`; `tests/store.test.ts` covers normalizing `page`.
