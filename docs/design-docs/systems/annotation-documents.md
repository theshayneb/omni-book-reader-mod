# Annotation documents

Status: Accepted
Date: 2026-10-05 (supersedes the 2026-10-03 one-file-per-book design)

## Context

Versions 1.1.1 to 1.1.10 wrote each book's highlights to a separate generated file, `Media/Books/Attachments/<title> Notes.md` (earlier `<title>-Notes.md`, and before that a Highlight/Note pair next to the EPUB). The owner keeps one note per book, named exactly like the EPUB, and wanted the highlights inside that note under an existing callout, next to quotes and references they add by hand.

## Decision

- **Where:** the book note is the Markdown file named like the EPUB (`Dune - Frank Herbert.epub` → `Dune - Frank Herbert.md`), found with `metadataCache.getFirstLinkpathDest(basename, epubPath)`, falling back to any Markdown file with that basename. If there is none, the write fails with a notice; nothing is written elsewhere.
- **Callout:** highlights go directly under the line `> > > [!quotenew] Quotes & References` (`HIGHLIGHTS_CALLOUT`). If the note has no such line, the callout and its lines are added at the end of the note (only when the book has highlights).
- **Line format:** one line per highlight, `> > - <passage> #quote <#tags> *-- <note>* *(<chapter>, [p. <page>](<link into the book>))*`. Passage and note are collapsed to one line; the note part is left out when there is none; the chapter is left out when unknown; without a page the link reads "Open in book". A highlight tag `quote` is not repeated. Lines are in book order (spine index, then CFI, then creation time).
- **Owned lines:** a line belongs to the plugin when it contains a Markdown link to `obsidian://omni-book-reader-mod?` (or the original plugin's `omni-book-reader?`). Every other line is the owner's and is never changed. The callout's list is the run of `> > -` lines (and `> >` lines indented as continuations) right after the callout line. On each write, the plugin's lines in that run are replaced in place with the current highlights in book order; extra highlights go after the last plugin line, or at the end of the run when there is none yet; plugin lines for deleted highlights are removed. Plugin lines moved outside the run are left as they are.
- **Moving earlier generated files:** candidates are the stored `annotationDocuments` paths and the two `Notes.md` names for the book's title in `Media/Books/Attachments`. A candidate is only used if it contains `<!-- omni-book-reader:` markers, so a hand-written note can never be trashed. Its text outside the plugin's blocks and frontmatter is appended to the book note (unless already there); after the book note is written the files, and an emptied folder (never `Media/Books/Attachments` itself), go to the trash through `FileManager.trashFile`. If writing the book note fails, nothing is trashed.
- **Removed settings:** the export layout (Classic/Compact/Callout), custom template and "Notes file properties" only shaped the separate file, so they were removed; `normalizeSettings` drops them from stored data.
- **Sync:** `annotationDocuments` now records the book note. The merge rule ranks the book note above a generated `Notes.md` and that above an old pair, so devices that have not updated yet cannot pull the others back.
- **Pages:** `ReaderHighlight.page` stores the page shown in the reader when the highlight was made: the publisher page-list label if the EPUB has one, otherwise Foliate's location number. Highlights made before 1.1.3 have no page.

## Alternatives considered

- Rewriting the whole callout list: simpler, but would delete the owner's own quotes and references there.
- Marker comments around a generated block: would show up inside the owner's callout and break its `> > -` list.

## Consequences

- The callout line and prefix are fixed in code for this single-owner fork.
- Two EPUBs with the same file name in different folders would share one book note.

## Validation

`tests/annotation-documents.test.ts` covers the line format, book order, in-place updates around the owner's lines, adding a missing callout, writing into the book note, a missing book note, moving earlier files (stored and found by title, pairs and empty folders), never trashing a non-generated file, and keeping old files when the write fails. `tests/reading-sync-model.test.ts` covers the merge ranking; `tests/defaults.test.ts` covers dropping the removed settings.
