# Release artifacts

Status: Accepted
Date: 2026-09-23

## Decision

Version tags contain source and release metadata, but not the generated `main.js` bundle. The release workflow runs on every push to `main` and on version-tag pushes. On `main` it publishes only when the manifest version has no tag yet, and creates that tag with the release (2026-10-03: tag pushes from the maintainer's tooling were unreliable). It installs locked dependencies, runs release checks, and attaches `main.js`, `manifest.json`, and `styles.css` as three direct GitHub Release assets. The workflow then checks the release-by-tag API repeatedly because version-based consumers use that endpoint.

Local plugin development still creates `main.js` at the repository root for Obsidian, but Git ignores it. Package and manifest versions must match the tag, and `versions.json` must map that version to `minAppVersion`.

## Consequences and validation

The bundle can be reproduced from tagged source with `npm ci` and `npm run release:check`. A complete release requires a successful workflow, exact asset names, non-empty downloads, and matching SHA-256 hashes. A source-tree `main.js` or an asset visible only through the release ID does not meet this check.
