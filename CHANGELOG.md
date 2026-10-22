# Changelog

## 1.1.3

For the player's switch to the system default font and standard close keys. No API change.

- `slint/vestra/theme.slint` (read-only copy of the player's): the font comment now says what the player does: no window sets a default font family, every window uses the system default font and Slint falls back per character (CJK in `font-mono` included); Menlo ships with macOS only, elsewhere `font-mono` text uses the default font (not monospace).
- Getting started: the example command binds `Ctrl+Alt+W` instead of `Ctrl+W`, which is now the standard close key of the player's tool windows, floating panels and options window on Windows and Linux (⌘W on macOS); a `Ctrl+W` binding still fires in the main window.

## 1.1.2

For the player's upgrade to Slint 1.18.1. No API change.

- `slint/vestra/markdown.slint` (read-only copy of the player's): `ScrollView` uses `content-width`/`content-height` (Slint 1.18 renamed `viewport-*`; the old names warn); code blocks are drawn in `Theme.font-mono` as plain lines, inline code as one Slint code span (CJK inside falls back to a system font in Slint 1.18).
- `TestHost`: `app.components.slint` defaults to `"1.18.1"`; `secrets.set` of a new name fails `limit` once 256 names are stored, as in the player.
- `Secrets.set` documents the 256-name limit and that uninstalling with `removeData` deletes the secrets.
- `TestHost.settle()` documents that it only waits for host calls, with a polling example for work the plugin does on its own.

## 1.1.1

Fixes found in the player's GUI review of the Markdown view (player 0.2.0 with these fixes). No API change.

- `slint/vestra/markdown.slint` (read-only copy of the player's): `MarkdownBlock` gains `task` (task list items draw their box with shapes instead of the ☐/☑ glyphs, which some fonts lack) and `aligns` (table columns are equally wide in every row and follow the delimiter row's alignment, header included); code blocks render styled text (ASCII in the monospace font, CJK in the body font). Plugins only pass `MarkdownBlock` values through, so nothing changes for them.
- Image downloads for `ui.markdown`: an HTTP error status or a redirect away from `https:` fails that image (alt text) as before; covered by tests now, with the explicit `User-Agent`.

## 1.1.0

Additions for the plugin store (player 0.2.0; plugins that use them set `"minPlayerVersion": "0.2.0"`). Nothing existing changed.

- Manifest: optional display fields `name`, `author`, `punchline`, `description`, `tags`, `icon`, `readme`, `changelog`, `sourceUrl`, `license`, and `minPlayerVersion`. `PackageManifest` has them as optional properties.
- `plugin.packages.validateArchive(file)`: validate a `.vxp` package file.
- `PackageCandidate.install({ source, replace })`: where the package comes from (`repository`, `link`, `file`, `workshop`). Installing from the same source upgrades the plugin and keeps its data; another source fails with `conflict` unless `replace` is set. Built-in plugins fail with `unsupported`.
- `PluginInfo.builtin`, `PluginInfo.source`, `PluginInfo.dataDirectory`. Data directories are per installation now: read another plugin's data directory from `dataDirectory` instead of deriving it from the id.
- `plugin.ui.markdown(text, { base, remoteImages })` and `MarkdownRef`, for `MarkdownView` in the new `@vestra/markdown.slint` (also in `slint/`). Remote `https:` images are downloaded into the plugin's data directory.
- `TestHost`: `candidates`, `remoteImages`, `markdown()`; `packages` entries take the new fields (optional); `uninstall` and `install` follow the player's built-in and source rules; `packageCalls` records `install`.
- `vestra-plugin`: every command checks the manifest against the player's rules; `check` prints a hint for an id without an owner prefix; `build` copies the manifest's icon, README and changelog into `dist/`; `pack` writes `<id>-<version>.vxp` (was `.zip`; same content).

## 1.0.1

Documentation: README in English, maintainer notes in CONTRIBUTING.md, API documentation site.

## 1.0.0

First release: plugin API `vestra/1`.
