# Omni Book Reader Mod

A personal fork of Omni Book Reader. It installs as a separate plugin (id `omni-book-reader-mod`) with its own settings, sync folder, views and `obsidian://omni-book-reader-mod` links, so the original plugin's updates never replace it. On first run it imports reading progress, highlights, notes, bookmarks and reader settings once from the original plugin's folder if that is present. Disable the original plugin: only one plugin can open `.epub` files.

An all-in-one, local-first EPUB 2/3 reading workbench for Obsidian. It supports paginated and scrolled reading, nested tables of contents, full-book search, reading-position restore, bookmarks, color highlights, and notes attached to highlights.

The default reading typography follows Obsidian's configured text font and font size, then applies a comfortable long-form reading rhythm: 1.7 line height, 0.01em letter spacing, 0.65em paragraph spacing, a 720px text measure, and 48px page margins. Publisher, serif, and sans-serif font modes remain available. The typography panel also includes a one-click comfortable-default reset.

The plugin interface uses a plain, functional style built on Obsidian's own theme variables, so it follows your active light or dark theme, interface font, and accent color. Reduced-motion behavior, keyboard focus rings, and a mobile drawer layout are included. The plugin does not download web fonts or other interface assets.

Click a highlight in the book, or use its note button in the reader sidebar, to add or edit a note. The selection toolbar's tag button highlights the selection and asks for tags straight away. Highlights and notes are written into the book's own note, the Markdown file named exactly like the EPUB (`Dune - Frank Herbert.epub` → `Dune - Frank Herbert.md`), directly under the line `> > > [!quotenew] Quotes & References` (added at the end of the note if it is missing). Each highlight is one line, in book order: `> > - passage #quote #tags *-- your note* *(Chapter, [p. 14](link back into the book))*`. The plugin only adds, updates and removes its own lines (the ones with a link back into the book); anything else you write under the callout is left alone. Use the sidebar export button or the command palette to refresh and open the note. While a book is open, the page you are on is saved in the book note's `Progress` property every 3 minutes (only when it has changed), and again when you close the reading tab or open a different book in it. Books with a generated `Notes.md` file from 1.1.1–1.1.10 (or an older Highlight/Note pair) are moved the next time they are opened: anything you wrote in those files is added to the book note, and the files go to the Obsidian trash.

Annotations support highlight, underline, strikethrough, and squiggly styles, four colors, notes, and tags. The sidebar can combine tag, chapter, color, and note-status filters, then sort by creation time or chapter. Exported entries include an Obsidian CFI link that reopens the source EPUB at the exact location.

On mobile, dragging text-selection handles keeps the current page in place, including vertical drags. For a passage spanning pages, highlight each page separately; page turns resume after saving or cancelling the selection.

Additional reading tools:

- Footnote and endnote links open an in-reader preview with an optional jump to the referenced position.
- The current chapter can be exported to managed-block Markdown, including its images and annotations. Images are stored in the chapter export `assets` folder.
- Clicking a book image opens a zoom viewer with copy-to-clipboard and save-to-Vault actions.
- Reading statistics track the current session, total active reading time, estimated remaining time, furthest progress, and completion state. Tracking pauses after two minutes without activity.
- Recent Reading is available from the ribbon and command palette for quickly continuing a book without a full bookshelf.
- Focus Paragraph mode dims surrounding text and supports previous/next paragraph navigation with buttons or Arrow Up/Down. Escape exits the mode.

## Defining and translating words

Select a word or phrase and tap the **Define or translate** button in the selection toolbar. English is looked up in a dictionary and shows its pronunciation, parts of speech and definitions; any other language is translated into English. Only the result is shown, and nothing is saved unless you ask. From the result you can **Copy** it, or tap **Save to book note** (always visible at the bottom of the result): that highlights the selection and keeps the result as its note (tagged `#definition` or `#translation` in the reader), and adds it to the book note as `> > - word *-- result (Chapter, [p. 14](link))*`.

### Network use

This is the only feature that goes online, and only when you tap the button. The selected text is sent to Google Translate (`translate.googleapis.com`) to detect its language and translate it, and, for English words Google has no definition for, to Wiktionary (`en.wiktionary.org`) and the Free Dictionary API (`api.dictionaryapi.dev`) for the definition. Nothing else from your vault or books is sent.

## Syncing across devices

Reading position, highlights, notes, bookmarks, reading time, and finished state sync between devices that share the vault. Each device writes its own file to `Utilities/Omni Book Reader Mod/Sync/` (configurable in settings), and the plugin merges the other devices' files as they arrive. Edits made on several devices before they sync are combined rather than overwritten, and deletions carry over. If a book is open when a newer position arrives from another device, the reader moves there.

With Obsidian Sync, turn on **Sync all other types** in Obsidian Sync's settings so the `.json` sync files are included. Any other file sync service works too. Display settings stay per device. Use **Omni Book Reader: Sync reading data now** from the command palette to force a sync.

## Markdown exports

Chapter exports are written only between `omni-book-reader` managed-block comments, so content written outside that block is preserved. Unchanged exports are not rewritten.

## Development

```powershell
npm install
npm run verify:quick
```

`verify:quick` runs lint, TypeScript checks, and the unit test suite. Before completing a change, run the full gate:

```powershell
npm run verify:full
```

The full gate also creates the production bundle and validates the release metadata and assets. Project specifications, architecture, design decisions, and execution-plan conventions are indexed in [`AGENTS.md`](AGENTS.md), [`ARCHITECTURE.md`](ARCHITECTURE.md), and [`docs/product-specs/index.md`](docs/product-specs/index.md).

The production artifacts loaded by Obsidian are `main.js`, `manifest.json`, and `styles.css`.

To verify and package a release exactly as GitHub Actions does:

```powershell
npm ci
npm run release:check
```

This creates `dist/main.js`, `dist/manifest.json`, and `dist/styles.css` for manual installation or a GitHub Release.
The generated `main.js` is not committed; GitHub Actions builds it and attaches all three files directly to the Release.

## Release process

1. Update the same semantic version in `manifest.json`, `package.json` and `package-lock.json`, and add it to `versions.json`.
2. Run `npm run release:check`.
3. Commit and push to `main`. If that version has no tag yet, GitHub Actions validates the build, creates the tag, and publishes the three plugin files as a GitHub Release. (Pushing a matching tag such as `1.2.0` yourself also works.)

For a local manual install, copy those three files into `<vault>/.obsidian/plugins/omni-book-reader-mod/`, then reload the plugin in Obsidian.

## License

MIT. See [LICENSE](LICENSE). Foliate and bundled dependency notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
