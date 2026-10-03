# Omni Book Reader

An all-in-one, local-first EPUB 2/3 reading workbench for Obsidian. It supports paginated and scrolled reading, nested tables of contents, full-book search, reading-position restore, bookmarks, color highlights, and notes attached to highlights.

The default reading typography follows Obsidian's configured text font and font size, then applies a comfortable long-form reading rhythm: 1.7 line height, 0.01em letter spacing, 0.65em paragraph spacing, a 720px text measure, and 48px page margins. Publisher, serif, and sans-serif font modes remain available. The typography panel also includes a one-click comfortable-default reset.

The plugin interface uses a plain, functional style built on Obsidian's own theme variables, so it follows your active light or dark theme, interface font, and accent color. Reduced-motion behavior, keyboard focus rings, and a mobile drawer layout are included. The plugin does not download web fonts or other interface assets.

Click a highlight in the book, or use its note button in the reader sidebar, to add or edit a note. The plugin keeps one generated Markdown file per book at `Media/Books/Attachments/<book title>-Notes.md`, named after the title in the EPUB's metadata, with a `book_notes` tag in its frontmatter. Highlights and their notes appear together, grouped under their chapter in book order, each with its page number (for highlights made since 1.1.1), date, tags as Obsidian `#tags`, and a link back into the book. The file is updated whenever highlights or notes change. Use the sidebar export button or the command palette to force a refresh and open it. Books that still have the older Highlight/Note file pair next to the EPUB are moved into the new file the next time they are opened: anything you wrote outside the generated section is carried over, and the old files go to the Obsidian trash.

Annotations support highlight, underline, strikethrough, and squiggly styles, four colors, notes, and tags. The sidebar can combine tag, chapter, color, and note-status filters, then sort by creation time or chapter. Exported entries include an Obsidian CFI link that reopens the source EPUB at the exact location.

On mobile, dragging text-selection handles keeps the current page in place, including vertical drags. For a passage spanning pages, highlight each page separately; page turns resume after saving or cancelling the selection.

Additional reading tools:

- Footnote and endnote links open an in-reader preview with an optional jump to the referenced position.
- The current chapter can be exported to managed-block Markdown, including its images and annotations. Images are stored in the chapter export `assets` folder.
- Clicking a book image opens a zoom viewer with copy-to-clipboard and save-to-Vault actions.
- Reading statistics track the current session, total active reading time, estimated remaining time, furthest progress, and completion state. Tracking pauses after two minutes without activity.
- Recent Reading is available from the ribbon and command palette for quickly continuing a book without a full bookshelf.
- Focus Paragraph mode dims surrounding text and supports previous/next paragraph navigation with buttons or Arrow Up/Down. Escape exits the mode.

## Syncing across devices

Reading position, highlights, notes, bookmarks, reading time, and finished state sync between devices that share the vault. Each device writes its own file to `Omni Book Reader/Sync/` (configurable in settings), and the plugin merges the other devices' files as they arrive. Edits made on several devices before they sync are combined rather than overwritten, and deletions carry over. If a book is open when a newer position arrives from another device, the reader moves there.

With Obsidian Sync, turn on **Sync all other types** in Obsidian Sync's settings so the `.json` sync files are included. Any other file sync service works too. Display settings stay per device. Use **Omni Book Reader: Sync reading data now** from the command palette to force a sync.

## Markdown exports

Generated Markdown is written only between `omni-book-reader` managed-block comments, so content written outside that block is preserved. Unchanged exports are not rewritten. The settings page offers Classic, Compact, and Obsidian Callout presets. A custom Vault Markdown template can use these variables:

- `{{document.title}}`, `{{document.kind}}` (`annotations`)
- `{{book.title}}`, `{{book.author}}`, `{{book.filePath}}`
- `{{export.date}}`, `{{entries}}`

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

1. Update the same semantic version in `manifest.json` and `package.json`.
2. Run `npm run release:check`.
3. Commit, push, then create and push a matching tag such as `0.6.1`.
4. GitHub Actions validates the build and publishes the three plugin files as a GitHub Release.

For a local manual install, copy those three files into `<vault>/.obsidian/plugins/omni-book-reader/`, then reload the plugin in Obsidian.

## License

MIT. See [LICENSE](LICENSE). Foliate and bundled dependency notices are listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
