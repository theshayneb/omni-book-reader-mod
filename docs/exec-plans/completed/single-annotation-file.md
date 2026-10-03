# One highlights-and-notes file per book (1.1.3)

## Scope

Replace the per-book Highlight/Note Markdown pair with one file at `Media/Books/Attachments/<book title>-Notes.md` with `book_notes` frontmatter, entries grouped by chapter in book order, page numbers, Obsidian `#tags`, and no colors. Move existing pairs into the new file. Design: [`../../design-docs/systems/annotation-documents.md`](../../design-docs/systems/annotation-documents.md).

## Acceptance criteria

- New highlights and note edits update `Media/Books/Attachments/<title>-Notes.md` automatically.
- Opening a book that has the old pair writes the new file, keeps user-written text, and trashes the old files and their empty folder.
- New highlights record the page shown in the reader; it syncs across devices.
- One export command and sidebar button open the file.

## Validation

- 2026-10-03: `npm run verify:full` passed (lint, type-check, tests, production build, release validation). Not tried on a device.
