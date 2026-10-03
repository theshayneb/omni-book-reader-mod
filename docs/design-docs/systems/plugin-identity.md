# Separate plugin identity

Status: Accepted
Date: 2026-10-03

## Context

This fork used the original plugin's id, `omni-book-reader`, so Obsidian treated it as the same plugin: the original's updates could replace it, and the two could not be told apart.

## Decision

- `manifest.json` id `omni-book-reader-mod`, name "Omni Book Reader Mod". Obsidian stores its files and `data.json` in `.obsidian/plugins/omni-book-reader-mod/`.
- Own view types (`omni-book-reader-mod-view`, `omni-book-reader-mod-bookshelf-view`), `obsidian://omni-book-reader-mod` links, sync folder default `Omni Book Reader Mod/Sync`, sync format `omni-book-reader-mod-sync`, and device-id key.
- On startup, data from any plugin folder whose manifest id is `omni-book-reader` (`ORIGINAL_PLUGIN_ID`) is imported once, like the existing recovery from earlier plugin folders. On a fresh install, the first imported data also supplies the reader settings, except the sync folder.
- Old `obsidian://omni-book-reader?` links still open inside Obsidian (the click handler accepts both), and links in annotation files are rewritten to the new action at startup. The protocol handler only registers the new action, so it never conflicts with the original plugin.

## Consequences

- Only one plugin can register `.epub`; the original should be disabled.
- CSS class names are unchanged, so if both plugins are enabled their identical styles overlap harmlessly.
- Old links outside Obsidian (or in chapter exports opened by another app) still point at the original plugin.

## Validation

`tests/legacy-plugin-data.test.ts`, `tests/store.test.ts` (settings take-over) and `tests/annotation-documents.test.ts` (link rewrite).
