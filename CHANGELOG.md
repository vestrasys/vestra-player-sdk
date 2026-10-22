# Changelog

## 1.2.0

For the player's packaged builds, which ship their own Node 26 and run every plugin on it (users no longer install Node). No API change; `apiVersion` stays `vestra/1`.

- `engines.node` is `>=26` (was `>=22.18`). The player's Node major version only goes up while the API is `vestra/1`, so code written for Node 26 keeps running. npm warns when you develop on an older Node; `vestra-plugin` and `TestHost` are tested on Node 26 only (CI: Linux, Windows and macOS × Node 26).
- The `@types/node` dependency is `^26.0.0` (was `>=22.18`, which resolved to the newest types and offered Node APIs newer than the player's Node).
- `plugin.tools.run` starts the tool with `windowsHide`: no console window on Windows.
- In the player, `VESTRA_FFMPEG` / `VESTRA_FFPROBE` name the FFmpeg the player ships unless you set them yourself; `plugin.tools` reads them as before.

## 1.1.3

For the player's switch to the system default font, per-system monospace font and standard close keys. No API change.

- `Stream.stop()` (and `dispose()`, deactivation, a cancelled `openStream`) closes the source first, if it is still the player's, then the frame connection, then the producer. Before, the connection closed first and the player could report the stop as a load failure ("producer transport closed"). Plugins that close their own source before `stop()` keep working.
- `TestHost`: each fake producer has `droppedWhileSelected` (the frame connection closed while its stream was still the source).
- `slint/vestra/theme.slint`, `slint/palette.slint` (read-only copies of the player's): `Theme.font-mono` reads `VestraPalette.font-mono`, which the player sets per system (Menlo on macOS, Consolas on Windows, DejaVu Sans Mono on Linux; the copy's default is Menlo). The font comment says what the player does: no window sets a default font family, every window uses the system default font and Slint falls back per character (CJK in `font-mono` included).
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
