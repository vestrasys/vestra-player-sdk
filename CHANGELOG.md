# Changelog

## 1.5.2

**Sidebar tabs** (the player after 0.4.0). Additive; `apiVersion` stays `vestra/1`, and plugins written for 1.5.1 need no change. The new members work against older players too (see each one).

- **Several sidebar panels.** A plugin mounting in the sidebar while another plugin's panel is there no longer fails: its `ready` resolves and the panel is a second tab. The player draws a 31px tab strip (the playlist's) above the current tab while there are two or more; with one panel nothing changes. Shown, hidden and floating apply to the whole sidebar. Tabs are labelled with the mount's `title` (else the plugin's name); built-in plugins' tabs come first, the playlist's is the first.
- **`Panel.state`** (`PanelState`: `active`, `preferred`, `effective`, `reason`, `detached`) and **`Panel.onChange`**: the panel's own state. A panel in a background tab has `active: false`, `effective: false` and `reason: "otherTab"`. Older players report the position's state with `active: true`.
- **`Panel.show()`** makes the panel's tab current and shows the sidebar; **`Panel.toggle()`** hides the sidebar when the panel's tab is shown, otherwise shows it (a background tab comes forward). Use them for a "Show my panel" command: `checked: () => !!list.state?.preferred && !!list.state?.active`. Older players: `setVisible(true)` / `toggle()` of the position.
- **`PanelSlot.panels`** (`SlotPanel[]`: `plugin`, `title`, `active`) lists a position's tabs, `null` from older players; `PanelSlot.onChange` also runs when only the tabs change. **`PanelSlot.activate(plugin)`** switches the current tab (older players ignore it). `SlotState` is unchanged.
- **The `tabbed` property.** If a sidebar panel's bridge global declares `in property <bool> tabbed`, the player sets it to `true` while it draws its tab strip, so a panel with a tab strip of its own (the playlist) hides it. Drop coordinates (`Panel.onDrop`) start below the strip.
- **`Panel.showMenu`** in a background tab rejects with `unavailable`.
- **Taken positions** (player 0.4.x after 0.4.0, documented now): the bottom bar and the backdrop take one panel; another plugin's mount there rejects `ready` with `conflict` (「底栏已被 vestra.playback 使用」), as does a ninth sidebar tab. This refusal, and `conflict` from `player.provideSequence` while another plugin provides next/previous, do not fail activation in the player: the plugin runs without its panel or sequence. Players 0.4.0 and older answered a taken bottom bar or sidebar with `ui-prepare` and failed the activation.
- **`PluginInfo.warnings`** (`PluginWarning`: `code` `"slot-occupied"` or `"sequence-taken"`, `slot`, `owner`): what a running plugin was refused because another plugin holds it. Empty from older players.
- **`TestHost`** models both: `host.mountOther(slot, plugin, { title })` and `host.unmountOther(plugin)` simulate another plugin's panel (a sidebar tab, or a taken bottom bar or backdrop: the plugin's mount then rejects with `conflict`), `host.selectTab(plugin)` the user clicking a tab; `host.layout.sidebar.panels` / `.owner` are the tabs and the current one, `layout.set` takes `active`. `startPlugin` does not fail on a taken position, like the player.
- Examples: panel-menu no longer asks you not to load it with the playlist; it is a second tab there. Its list ends in a stretching filler: without it the rows' fixed heights capped the player's main window at its minimum height.

## 1.5.1

Fix; no API or type changes.

- **`storage.json` saves no longer collide.** Every save wrote through the same temporary file (`<name>.json.tmp-<pid>`), and only the writes of one store were queued. Two stores on the same file (the same name opened twice, in one scope or two) could therefore rename each other's temporary file away mid-save, and the save failed with `ENOENT` (on `chmod` or `rename`); on Windows two renames onto the file at once also fail with `EPERM`. Seen intermittently on Windows.
  - Writes to one file are now queued together, whichever store makes them, and land in the order they were made.
  - Each write has a temporary file of its own, made owner-only (`0600`) through its file handle before it gets the store's name, and removed again if the write fails.
  - On Windows, replacing the file is retried for up to 2 s while another program (a virus scanner, the search indexer) briefly holds it open.

## 1.5.0

**Own visual identity: the Aurora palettes and the V-Line icons** (player 0.4.0). Additive; `apiVersion` stays `vestra/1`. Plugins that use the additions set `"minPlayerVersion": "0.4.0"`.

- **`ThemeId` gains `"vestra-light"`**, a light palette whose video area stays dark. `plugin.appearance.set("vestra-light")` switches every view; `TestHost` accepts it like the player. A player older than 0.4.0 answers it with `vestra` (an id it does not have).
- **New colours for `vestra`.** The palette is now Aurora, drawn from the logo's full spectrum: magenta accent (`#f72aa6`), cyan for what is playing (`Theme.playing`, `#2bb6ff`, violet before), `Theme.accent-fill` from amber through magenta and violet to cyan, and a visible `Theme.line` (`#2b2734`; it was near-black). Token names are unchanged; code that reads `Theme` follows.
- **Rounder corners**: `Theme.radius-control` 4px (was 3px), `Theme.radius-panel` 8px (was 6px). Sizes are otherwise unchanged.
- **`@vestra/icons.slint`** (new library file, `slint/vestra/icons.slint`): `Icon { name: "play"; color: Theme.text; }` draws one icon of the player's own set (round-capped 1.5px lines), and `Icons.commands(name)` / `box-width` / `box-height` / `line` give its path data. The names are listed in **Windows, panels, settings pages, dialogs and the OSD**.
- **`@vestra/widgets.slint`**: the bar slider's thumb is a white core in a 2px accent ring; the panel slider's track is `Theme.line`; stroked icon buttons use round caps and joins; tooltips have rounded corners. Geometry and API are unchanged.
- **std-widgets in a light palette**: the player still compiles plugin files with `fluent-dark` and switches the std-widgets colour scheme (`Palette.color-scheme`) to light for `vestra-light`, so `CheckBox`, `ComboBox`, `LineEdit`, `ScrollView` and the other std-widgets controls follow. The player's palette file (`slint/palette.slint`, not part of the library) now imports `std-widgets.slint` for that.

## 1.4.1

Documentation only; no code or type changes.

- **Built-in menus keep their place** (player 0.3.0). `CommandOptions` and `CommandOptions.order` document the player's menu rule: the seven built-in top-level menus (`@open` … `@settings`) sit at fixed orders (Open 110, Playback 200, Subtitles 300, Video 400, Audio 500, Screen 710, Settings 830), whether a path names them by id or by title, so a plugin's item never moves them. Directly inside a built-in menu, `order` 0 (the default) sorts after every other order, so an item without `order` goes at the end. Players before 0.3.0 move the whole menu to the top for such an item; give it an order in the menu's range there.
- The Blur walkthrough explains `order` inside the Video menu accordingly.

## 1.4.0

**One palette.** `ThemeId` is now `"vestra"` only: the second palette that earlier versions listed is gone from the player. This is a minor version although a type narrows, because the only plugins it affects compare `plugin.appearance.theme` with, or `set` the removed id:

- TypeScript reports a comparison with the removed id as having no overlap, and `appearance.set` with it as a type error; delete that branch or menu item. `appearance.set` rejects anything other than `"vestra"` with `invalid`; `TestHost.appearance` and `setAppearance` take a `ThemeId`.
- The player treats a palette id it does not have as `vestra`: plugins built with an older SDK that still ask for the removed palette keep working (no error, the palette stays Vestra), and a palette saved by an older player opens as Vestra. `TestHost` answers `appearance.set` the same way.
- `Theme` tokens, sizes and `slint/` are otherwise unchanged (comments only). A later version may add palettes again (a light one, for example): read colours from `Theme` rather than branching on the id.

Documentation:

- New concept page **Windows, panels, settings pages, dialogs and the OSD**, and two how-to guides: **Keep a slider responsive while dragging** and **Remember a window's state between runs**.
- The reference of the user interface API (`Windows`, `Window`, `View`, `Panels`, `Panel`, the panel positions, `Settings`, `SettingsPage`, `Dialogs`, `Osd`, `OsdPanel`, `Ui`, `Appearance` and their data types) is rewritten: background, life cycle, capability, parameters with units and ranges, every error code, compiling examples, `@since`, and the `UI` category in the navigation.
- `PluginError` lists the code `ui` (a property the player could not apply to a tool window or settings page).
- `doc-lint` and `docs:check` enforce the documentation standard for the `UI` category (`scripts/doc-standard.mjs`).

## 1.3.0

Fixes and additions found by the blur and signal-generator examples (player 0.3.0). Nothing existing changed meaning; `apiVersion` stays `vestra/1`. Plugins that use the additions set `"minPlayerVersion": "0.3.0"`.

- **Menu ids.** A command path may start with a built-in menu's id instead of its title: `["@video", "Blur"]` joins the player's Video menu (视频) whatever language its menus are in. Ids: `@open`, `@playback`, `@subtitles`, `@video`, `@audio`, `@screen`, `@settings`; type `MenuId`, constant `MENU_IDS` (from `@vestra-player/sdk/testing`). An unknown id, or an id with no item after it, throws `invalid`. Older players show `@video` as a menu of its own.
- **`Theme.danger`**: the colour for errors and destructive actions (`slint/vestra/theme.slint`, `slint/palette.slint`, read-only copies of the player's).
- **Empty video chain.** `video.filter(id).set([])` removes this plugin's chain in player 0.3.0 (older players refused it with `invalid`, which left the effect on screen). `TestHost` removes the resource for an empty chain (audio: with no delay) instead of keeping an empty one, as the player always did for audio: a test that reads `host.processing.resources.get(id)?.nodes` after turning a chain off now gets `undefined` (write `?.nodes ?? []`, `?.offsetMs ?? 0`).
- **Filters on generated streams.** While a stream from `openStream` plays, a non-empty chain is `failed` with `unsupported` (player 0.3.0) and is applied again when decoded media plays; before, it stayed `waiting` and the SDK asked the player every 250 ms. The SDK also asks the player again when the source becomes a stream instead of reporting a kept chain as `applied`. `TestHost` answers like the player.
- **Generated frames.** A frame whose picture is not `width × height × 4` bytes, or whose samples are not finite within ±1, ends the stream with code `invalid` (`openStream` rejects, or `onStop` gets the error); before, the code was `error` or `stream`. Each frame is copied once instead of twice.
- **Error codes.** A duplicate window id (`windows.create`) or command id (`commands.add`) throws `conflict`; before, a plain `Error` without `code`.
- **Documentation.** `VideoFilter`, `AudioFilter` and `Scope.video` / `Scope.audio` say that filters also need `events`. `Player.openStream` needs `playback.control` as well as `producer.av`. `StreamFrame` lists the limits (4 MiB per picture, samples within ±1); `Stream.onStop` is not called for the plugin's own `stop()`. `PluginError` lists `staleDigest`, `noSource`, `released` and `disposed`.
- **Examples.** `blur` and `signal-generator` use `@video` / `@open`, `Theme.danger` and the `unsupported` filter status, and need player 0.3.0.

Documentation:

- New README (logo, badges, Quick start, examples, compatibility) and a contributor guide; the maintainers' handbook moved to `docs/maintaining.md`. Issue and pull request templates.
- `examples/`: `hello` (the Quick start), and `bookmark` (id now `examples.bookmark`), `panel-menu`, `core-ui` and `markdown`, moved from the player repository and translated to English. CI checks, tests and packs every example on Linux, Windows and macOS.
- The documentation site is organised as Tutorials, Concepts, How-to guides, Examples and API, with the GitHub theme, MDN links for Node and Web types, and search in documents and comments. Getting started names Node.js 26 and SDK 1.3.
- The code blocks in the documents are type checked in CI (`npm run docs:check`); `npm run doc-lint` reports the documentation coverage.
- `PluginError` lists the codes `versionMismatch`, `ui-prepare` and `host`, which the player returns.

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
