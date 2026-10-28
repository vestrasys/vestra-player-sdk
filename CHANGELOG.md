# Changelog

## 1.5.34

**Who must change: nobody.** Additions only, `apiVersion` stays `vestra/1`. A plugin that reads `SystemInfo.rendering` needs player 0.5.12 (`"minPlayerVersion": "0.5.12"`); older players leave the field out, and a plugin that does not read it sees no difference. Tests that load subtitles past the player's limits now fail with `busy` in `TestHost`, as they would in the player.

- **`plugin.app.system()` reports the renderer** (player 0.5.12): `rendering` is `"gpu"` (render options apply) or `"software"` (they fail with `unsupported`), read at each call, so a plugin can hide its render settings without creating `plugin.video.render()` to find out. No capability. It changes at most once while the player runs, from GPU to software when a window cannot show GPU frames. `TestHost` reports it from `videoRender.gpu`, so `failVideoRender("unsupported", …)` switches both.
- **`SUBTITLE_LIMITS`** (`@vestra-player/sdk/testing`, `./runtime`): the player's limits on loaded subtitle files. Per source, 4 tracks of one plugin at once, 16 tracks of every plugin, 16 MiB of their files, 16 loads of one plugin and 128 of every plugin (removed tracks still count as loads); 2 loads of one plugin and 8 of every plugin in progress; a file of at most 2 MiB. A file over 2 MiB is `invalid`, the others `busy`. `TestHost` now enforces them with these codes (all but `totalBytes` and the all-plugin upload count, which one plugin cannot reach alone); external tracks a test adds to `subtitles.tracks` count as other plugins'. A new source drops the uploads of the old one (`uploads` entries carry `generation`). `Subtitles.load`, *Load subtitles from a plugin* and *Limits* name them.
- Fix: a subtitle load the player refused no longer keeps one of the plugin's two upload slots. After a refused commit (`busy` at a track limit, `stale`, `invalid`…) the SDK now discards the upload, as it already did for a failure before the commit; before, two refusals on one source left the plugin unable to load any subtitle there until the source changed.

## 1.5.33

1.5.32 was not published (a tag error).

**Who must change: nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. Only documentation, its checks and the generated `llms-full.txt` change.

- **Five more categories reach the full reference standard** and join `STRICT_CATEGORIES`: Subtitles (`Subtitles` and its state and track types), Sources (`Resolvers`, `Resolver` and the resolver option and result types), Media (`MediaCapture`, `Snapshot`, `ExportJob` and their options), Processing (`VideoFilter`, `AudioFilter`, `VideoView`, `RenderOptions` and the node and settings types) and Packages (`Packages`, `PackageCandidate`, `PackageChange` and the manifest and plugin-info types); `Bindings` joins Commands, `Timeline` and `TimelineLayer` join Playback, `Drops` joins UI. Every method has an example (what it does and how it works), `@capability`, `@since` and a `@throws` per error code, checked against the SDK and the player's source; every type has `@category`. Methods with an explained example: 121 of 191 → 153.
- Facts the reference now states, from the source: an `ExportJob` and a `PackageChange` are polled (about every 350 ms and 400 ms) until they end, and their `done` resolves with a failed outcome rather than rejecting; a plugin holds at most 4 snapshots (16 in the player); `VideoView.set`, `RenderOptions.set` and the filters' `set` never throw (a refusal shows in `status` and goes to `onError`); `Resolver.ready` rejects with `conflict` without failing activation when another plugin holds the extension or host.
- **The rest reaches the standard: every declaration is now in `STRICT_CATEGORIES`.** Plugin (`Plugin`, `Scope`, `Disposable`, `MainWindow`, `App` and their data types) and Testing (`TestHost`, `startPlugin`, the fakes, `HostError` and the limit and table constants) join the other categories; `doc-lint` now checks declarations of `@vestra-player/sdk/testing` too. Methods with an explained example: 182 of 191; the other 9 are callback fields of option types, documented on the owning type.
- **Corrections from the review against the player's and the SDK's source.** Subtitles have no event: the SDK reads the subtitle state again on source, phase or backend changes, so a selection changed in the player shows after `refresh()`; a change without `ifCurrent` reads the newest state first and almost never fails with `stale`, and the select example passes `ifCurrent` (embedded tracks are chosen by number). `setStyle` reports a font not in `state.fonts` as `unsupported`. Packages: the player copies a package when it validates it, so `staleDigest` is not a code the SDK sees; a broken package is `host` (with `javascript` and `slint` for code that does not parse or compile), `versionMismatch` only for a newer `minPlayerVersion`; `cancel` of a committed change answers `tooLate` and the change stays `committed`. The Drops example claims `.ch8`: the built-in playlist claims every audio and video extension first. More codes: `missing`, `unavailable` and `busy` for subtitle changes, `busy` (2 exports per plugin, 8 in the player) and `unavailable` for `Snapshot.export`, `busy` and `revisionConflict` for install and uninstall, `busy` (16 resolvers) for `Resolver.ready`, `missing` for `Bindings.reset`, `command` for `FakeCommand.run`; `plugin.video.view()` and `render()` throw `capability` or a plain `Error` for a second handle, and `render()` is `failed` with `unsupported` at once under software rendering.
- **TestHost follows the player more closely.** A core action run from its menu record (`host.coreAction(id).run()`) while it is disabled now rejects with `command`, like the player (it rejected with `unavailable`, which is what `plugin.host.run` gives). When only disabled commands hold a pressed key, `press` now looks only at the first of them, as the player does: without a `reason` the key passes, even if a later one has a reason. Tests that relied on the old behaviour see a different code or `"passed"`.
- More corrections from the review: built-in plugins cannot be disabled, so another plugin never gets the built-in playlist's drop extensions or the sequence provider (except a development load replacing the playlist); `validateArchive` reports an archive that cannot be unpacked (over 64 MB, too many files, damaged, unsafe paths) as `invalid` and a broken unpacked package as `host`; `install` is `busy` only while the library is being cleaned up or 64 change records are kept, and `revisionConflict` is retried by calling `install` again; the `PluginError` table no longer lists `staleDigest`, and `versionMismatch` means a newer `minPlayerVersion` only.
- `llms.txt` may now be 10 KB (10,240 bytes, up from 9 KB) to leave room for about 20 more how-to pages in its index; it stays under 2.6k tokens.
- New how-to guide: *Load subtitles from a plugin* (reading tracks, selecting with `stale`, uploading SRT/ASS with the limits, the style layer and which plugin's layer the player shows).

## 1.5.31

**Who must change: nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. Only documentation, its checks and the generated `llms-full.txt` change.

- **The Commands, Playback and Services categories reach the full reference standard** (they are now in `STRICT_CATEGORIES`, so CI keeps them complete): `Commands`, `Command`, `Host` and their option types; `Player`, `Media`, `Scrub`, `Stream` and the playback state and stream types; `Storage`, `JsonStore`, `SessionStorage`, `Secrets`, `Clipboard`, `System`, `Tools`, `Power`. Every method has an example (what it does and how it works), `@capability`, `@since` and a `@throws` per error code it can reject with, checked against the SDK and the player's source; every type has `@category`, so the API reference lists them under their category instead of "Other". Methods with an explained example: 75 of 191 → 121.
- Error codes the reference now names, from the player's source: a control while nothing is open is `invalid` (`close` is not: closing with nothing open just succeeds); `setRate` takes 0.05–10 (the player's own keys stay within 0.25–4); `setOutput`'s volume outside 0–200 is `invalid`; `Stream.stop` rejects only when closing the source fails, and releases the stream either way.
- **Corrections from the review against the player's source.** `stale` means any change of the source since the state a call is based on: another file or a close, but also any pause, seek or speed change by the user or another plugin. A second sequence provider is refused with `conflict` (`sequence-taken`) without failing activation, and the built-in playlist registers first. `VESTRA_FFMPEG` / `VESTRA_FFPROBE` replace the `PATH` search instead of coming before it. More `@throws`: `capability` for `Secrets` and `Clipboard`; for a generated stream `busy` and `unsupported` for `seek` and `setRate`, `busy` for `setPaused` and `unsupported` for `restart`; `replaced`, `busy` and the resolver failures (`backend`, `unsupported`, `unavailable`) for `open`; `capability` for `Command.ready`; `aborted` for `openStream`; `stale` and `unsupported` for `Scrub.seek`; `disabled` and `unsupported` (players before 0.5.5) for session storage; `failed` and `timeout` (macOS) for `System`. *Store a plugin's data* no longer promises that a quit right after `save` loses nothing (a stopping plugin gets about 300 ms).
- New how-to guides: *Control playback* (reading and following the state, `stale` and `ifCurrent`, `Media`, core actions, Next and Previous) and *Store a plugin's data* (settings files, session values, secrets, your own files).
- `doc-lint`: `--list explained` lists the methods without an explained example; its summary line no longer says "Not enforced yet" (every example has been enforced since 1.5.30).
- Comments and docs name the player's host files at their new places (`src/host/src/packages/manifest.rs`, `ui/ui_image.rs`, `ui/ui_values.rs`, `playback/effects.rs`, `ui/theme.rs`).

## 1.5.30

**Who must change: nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. Only documentation, its checks and the generated `llms-full.txt` change.

- **Every example explains what it does and how it works.** The standard, in *Maintaining* ("Examples in reference comments"): an `@example` has a task title, a lead saying what it does and how it works (checked against the SDK and the player's source), code that compiles on its own with comments on the key lines, and error handling where the user can make a call fail. All 159 examples of the API now meet it (none did before this release), including the 65 of the UI category, the test helpers (`TestHost`, `startPlugin`, `HostError`), the limits and tables (`COMMAND_LIMITS`, `MENU_IDS`, `BUILTIN_*`, `BAR_BUTTON_ICONS`, `CAPABILITY_INFO`, `BINDING_INPUTS`, `OSD_LIMITS`, `SESSION_STORAGE_LIMITS`, `SECRET_LIMITS`, `UI_VALUE_LIMITS`, `THEME_PALETTES`) and the 1.5.29 bar buttons (`CommandButton`, `TestHost.barButtons`). Every example now type checks (61 did not). Examples no longer compose shown sentences in TypeScript: OSD and dialog texts are templates with arguments.
- **Corrections found on the way.** `Subtitles.setStyle`, `SubtitlesState.style` and `SubtitleStyle`: when several plugins set a style layer, the effective one is the layer of the plugin whose manifest id sorts last, not the latest call. `COMMAND_LIMITS`: `add` never throws `limit`; the player refuses the registration (activation fails, or `Scope.onError`). `startPlugin`'s restart example gives both runs the same `dataDirectory` instead of copying the data before `stop()` (which could miss a pending store write). `TestHost.settle` says the debounced store write is not waited for. `TestHost.dialogAnswers` is one queue for every kind of dialog. `TestHost.openElsewhere`: calls that return nothing (`TimelineLayer.set` with `ifCurrent`) drop the write silently instead of rejecting. Resolver examples (`I18n.error`, `FileResolverOptions`, `TestHost.otherResolvers`) use a made-up `.ch8` format instead of `.nes`, which the store plugin VestraNES owns.
- **`llms-full.txt` carries the examples and `@remarks`** of every declaration and member (hidden setup lines dropped, `{@includeCode}` inlined), so the plugin workshop's model sees them: 536 KB → 693 KB (about 137k → 177k tokens). `llms.txt` wording trimmed to stay under its 9 KB limit (9,134 bytes).
- **Hidden setup lines**: in an `@example` code block, lines above `// ---cut---` are type checked but not shown on the site or in `llms-full.txt`.
- **Checks.** `docs:check` fails on any block that does not compile (it only warned for most examples; `--lenient` keeps the old behaviour for work in progress). `doc-lint` gains `example-lead` (task title, lead, comments, one `// ---cut---` at most; `See` markers for trivial siblings, whose link must resolve, at most 20 % of a declaration's methods) and `stale-refs` (removed or handed-over names such as `vestra.nes`, `.nes` resolvers), enforced for every example and Markdown code block, and prints per category the share of methods with an explained example. `EXAMPLE_BASELINE` keeps known violations per problem when a rule is tightened; it is empty, and `test/doc-baseline.test.ts` keeps it from growing.
- The parts of `examples/bookmark`, `examples/markdown` and `examples/panel-menu` that the reference includes gained comments on their key lines.
- Test only: the storage test in `test/round2.test.ts` waits for the debounced file to appear and for `flush()` instead of a fixed 60 ms, and stops its plugins before removing their data directory, so it no longer fails now and then with `ENOENT` on a loaded machine.

## 1.5.29

**Who must change: nobody.** Additions only, `apiVersion` stays `vestra/1`. A plugin that does not use `button` is unaffected. A plugin that uses it on a player before 0.5.10 keeps working without a button: the player builds the `plugin` object with its own SDK copy, which does not send the field, so the command and its menu entry register as before (declare `"minPlayerVersion": "0.5.10"` when the button matters). A plugin that mounts its own bottom bar should place `BarButtons` (below); until it does, `vestra-plugin check` warns and the player logs the buttons it hides.

- **Commands can have a bottom-bar button** (player 0.5.10, user-approved design of 2026-10-27): `button: { icon, order }` on `commands.add` (`CommandOptions.button`, `CommandButton`, `BarButtonIcon`). The icon is a name of the player's icon set or an image from `plugin.ui.image` (drawn in the icon colour); `order` 0–999 places it left to right. The button needs a menu `path`; its tooltip is the command's title (without a trailing "…") and first key; disabled or busy commands show a disabled button with the reason; a click runs the command like its menu item. One button per plugin, eight in the player (`BAR_BUTTON_LIMITS`; past eight the highest orders stay and the lowest go first, ties: the smaller plugin id, then the earlier declaration); a button past them is left out (the command and its menu entry stay) and the player logs it with `limit`. `add` throws `invalid` for an unknown icon name (`BAR_BUTTON_ICONS`), an order outside 0–999, a released image or a button without a path.
- **`@vestra/bar-buttons.slint`**: `BarButtons`, the strip of command buttons a bottom bar places at its right end with `room`, the width it can spare. It shows the cells that fit (the player's sidebar toggle, **Toggle Sidebar** `host/sidebar`, rightmost and last to go; cells go from the strip's outer (left) end inward, so of the plugins' buttons the lowest order goes first; `order` is position only) and is as wide as the cells it shows (`first-shown`, out, is the index of the leftmost plugin button shown). The player fills it in every window it composes and runs the clicks. Slint library copy synced; the icon set gains `store` (a shopping bag) and `ai` (a sparkle).
- **`TestHost.barButtons`**: the plugin's button as the player shows it (`command`, `icon`, `image`, `order`, `enabled`, `checked`, `tooltip`) with `click()`, which runs the command and rejects while it is disabled or once it is gone; empty after the command is disposed. The test host checks buttons as the player does.
- **`vestra-plugin check` warns** when a plugin mounts a bottom bar whose Slint file does not import `BarButtons` from `@vestra/bar-buttons.slint`, itself or through the plugin's own Slint files it imports (comments do not count; a warning, the check still passes).
- `BUILTIN_COMMANDS` gains the player's **Toggle Sidebar** (`host/sidebar`, outside the menu, no default key).
- Docs: *Commands* (concepts) gains *Bottom-bar buttons*; *Commands, menus and bindings* (reference) gains *Bottom-bar buttons*; *Interface guidelines* gains *Writing a bottom bar*; *Limits* gains *Bottom-bar buttons*; *Theme* gains *Bar buttons* and the two icons; *Windows, panels…* points to buttons for a one-click entry point. `llms.txt` and `llms-full.txt` regenerated.

## 1.5.28

**Who must change: nobody.** No API changes, `apiVersion` stays `vestra/1`. Only the SDK's copy of what the player ships changes; a plugin that read `BUILTIN_COMMANDS` or `BUILTIN_SUBMENUS` to avoid a key or a menu path simply finds those entries free now.

- **`BUILTIN_COMMANDS` and `BUILTIN_SUBMENUS` follow the player** (its agreement test failed on them):
  - Subtitles 0.4.6: `vestra.subtitles` **Move Up** and **Move Down** have no default keys any more (they were `Alt+ArrowUp` / `Alt+ArrowDown`, which pan the video).
  - The NES emulator is no longer a built-in plugin (it moved to the plugin repository as VestraNES, under **Games ▸ VestraNES**): its three commands (`nes.open`, `nes.stop`, `nes.window`) and the built-in **Emulator** submenu are gone. The player has no built-in Games item.
- Docs: *Built-in commands* regenerated; *Menu guidelines* names a domain submenu **Games** for an emulator and no longer lists Emulator at the top level. `TestHost.otherResolvers` examples use a neutral id (`example.emulator`). `llms.txt` and `llms-full.txt` regenerated.

## 1.5.27

**Who must change: nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. Plugins pick the fix up with the player's next SDK upgrade (the player builds the `plugin` object with its own copy); nothing in a plugin changes.

- **Generated streams reach their full frame rate on Windows.** A stream from `openStream` or a file resolver (the NES emulator: one 1/60 s picture per `frame()`) played at 23–26 frames a second on Windows instead of 60. The SDK asked the player how much audio the sound card had played, rendered at most one frame, and waited 5 ms before asking again; Windows rounds that wait up to its 15.6 ms timer tick, and with the round trip one pass took about 40 ms, so one frame per pass could not keep up. macOS timers are about 1 ms, which hid it. Each pass now calls `frame()` as many times in a row as it takes to refill the whole lead (about 50 ms of audio, unchanged, so latency is unchanged), at most 16 times, and stops early when a frame carries no audio; and a pass that rendered frames and already took longer than 5 ms is followed at once instead of after another timer tick. A pass that rendered nothing (paused, lead full) still waits 5 ms after it ends, so an idle or paused stream asks the player no more often than before. Measured against a real-time audio clock with the NES core and its homebrew ROM: with a 15–30 ms round trip 1.5.26 rendered 22–32 frames a second and let the device run dry, 1.5.27 renders 60 and keeps it fed; only a round trip near 50 ms (the whole lead) still lets it run dry now and then. Controls (start, pause, seek) still apply between frames and never while one renders, and `stop()` still ends after the frame being rendered.
- Docs: *Example: signal generator* says `frame()` may be called several times back to back. `llms.txt` and `llms-full.txt` regenerated.

## 1.5.26

**Who must change: authors whose plugin uses a member without one of the capabilities it needs, and only to `check`, `build` or `pack` again.** No API changes, `apiVersion` stays `vestra/1`, no player version needed, and packages already built keep running as before: the player decides at run time exactly as it did. What changes is that `vestra-plugin check` (and so `build` and `pack`) now fails on such a use, including uses that never failed at run time: a listener (`onChange`) without `events` never fires instead of failing; a subtitle change (`select`, `load`, `remove`, `setStyle`) without `subtitles.read` fails only when it reads the current selection; a capability's **Also needs** (`processing.video` without `playback.read`) was documented but not enforced. Such a plugin packed with 1.5.25 and stops packing with 1.5.26 until the missing capability is added to `manifest.json` (or the use removed). The player's built-in plugins and the plugin repository's plugins were checked with this release: no findings.

- **Undeclared capabilities are caught while writing and packing** (user ruling of 2026-10-27, doc/process/rounds/2026-10-capability-check.md in the player repository): every use of an API member whose capability `manifest.json` does not declare, with `file:line:column`, the member, the capability and the request. Type-aware: found through aliases, destructuring, parameters typed `Player` and so on; not through computed names, `any` or plain JavaScript. A member also needs its capabilities' **Also needs** (`requires`). Tests are not checked.
  - **`vestra-plugin check`** runs it after the type check and fails on any finding; `build` and `pack` run `check` first. **`check --json`** prints the findings as JSON.
  - **`@vestra-player/sdk/ts-plugin`**, a TypeScript language-service plugin: the same findings as errors in the editor, with the quick fix "Add '<capability>' to manifest.json". List it in `tsconfig.json` (`"plugins": [{ "name": "@vestra-player/sdk/ts-plugin" }]`) and use the workspace's TypeScript (VS Code: **Use Workspace Version**).
- **One rule with the player.** The SDK carries a copy of the player's generated capability table (`src/host/capabilities.json`: which request needs which capability, by event name or processing stage where it depends on one) and the requests each member sends. `CAPABILITY_INFO` is now built from them; its contents are unchanged. `HOST_CAPABILITIES` (`@vestra-player/sdk/runtime`, for the player's agreement test) is the copy.
- Docs: *Capabilities* gains *Catching a missing capability*; *Getting started* adds the `tsconfig.json` with the plugin and the VS Code step; *Command line* (the rule and `--json`); *Subtitles* and *Capabilities*: changes also need `subtitles.read` (they read the current selection first; the table now says so). `examples/tsconfig.json` lists the plugin. `llms.txt` and `llms-full.txt` regenerated.

## 1.5.25

**Who must change: nobody.** Plugins built on earlier SDKs keep working unchanged: `plugin.storage.json` and every other API do what they did. Additive; `apiVersion` stays `vestra/1`. The addition needs player 0.5.5.

- **`plugin.storage.session`** (`SessionStorage`, player 0.5.5; user ruling of 2026-10-27, after Chrome's `chrome.storage.session`): `get(key)`, `set(key, value)`, `delete(key)` and `keys()` of JSON values that live as long as the **player**, not the plugin's process. They survive every restart of the plugin within one player session (a reload, also of a development load, an upgrade, a crash, a failed start) and are cleared when the user disables or uninstalls the plugin, and when the player quits. Per plugin, no capability. Keys are 1–1024 bytes of well-formed text; a plugin's keys, values (as compact JSON) and 128 bytes per key are at most 1 MiB together, and a `set` beyond fails with `limit` and changes nothing. One value must also fit in one 1 MiB message. A value `JSON.stringify` cannot write, or one with a lone surrogate in a string, fails with `invalid`; the order of an object's properties is not kept; `get` returns `undefined` for a missing key. Each `set` is one acknowledged request, without debounce. Players before 0.5.5 reject the calls with `unsupported`, so set `"minPlayerVersion": "0.5.5"`.
- **`SESSION_STORAGE_LIMITS`** (`@vestra-player/sdk/testing` and `/runtime`): `keyBytes` 1024, `bytes` 1 MiB, `entryBytes` 128.
- **`TestHost.sessionStorage`** (the player's store for the plugin, with the player's key rule and quota, objects stored with sorted properties as the player returns them) and **`startPlugin(..., { sessionStorage })`** to start with the values an earlier run left, to test a restart within one player session. `TestHost` now refuses any request over the 1 MiB message limit with `limit`, as the plugin runner does.
- Docs: *How a plugin runs* gains *Restarts: activate can run more than once*: when the player restarts a plugin's process, and "keep state that must survive a restart in session storage (or persistent storage)", with a table of what survives what. *Test a plugin* (testing a restart with session values), *Reference: limits* (`SESSION_STORAGE_LIMITS`). `llms.txt` and `llms-full.txt` regenerated.

## 1.5.24

**Who must change: nobody.** Plugins built on earlier SDKs keep working unchanged: `when: "interlaced"` and `when: "all"` do what they did. Additive; `apiVersion` stays `vestra/1`. The addition needs player 0.5.4.

- **`VideoNode` `{ kind: "deinterlace", when: "auto", output: "field" }`** (player 0.5.4; requested by the video plugin, DEINT-AUTO-1: user ruling of 2026-10-27, Auto deinterlacing must cost nothing on progressive files). The player's own deinterlacer instead of BWDIF in the chain: decided per frame from the decoder's interlaced flag, with the decoder's hardware deinterlacer where frames stay on the GPU, one output frame per field; progressive frames pass untouched. It needs no frames in memory, so a chain with only this node keeps zero-copy hardware decoding, where any other node switches to a copy back to memory. It runs before every plugin's chain wherever it is written, and it is shared: on while any plugin's chain has one, off when the last one is removed or its plugin stops. `output: "frame"` with it, or another `deinterlace` node in the same chain, fails with `invalid`. Processed snapshots and exports deinterlace the same frames with BWDIF at field rate. Players before 0.5.4 refuse `auto` with `invalid`, so set `"minPlayerVersion": "0.5.4"`.
- **`TestHost`** validates the new value as the player does (`nodeProblem`).
- Docs: *Processing* (ordering and side effects). `llms.txt` and `llms-full.txt` regenerated.

## 1.5.23

**Who must change: nobody.** Republishes 1.5.22 with a clean API documentation build; 1.5.22 was tagged but never published to npm: TypeDoc treats warnings as errors and failed on two `{@link}` labels in *Playback* that contained a brace (`Scrub.seek(seconds, { keyframes })`). Documentation only; the code is the same as 1.5.22 below.

## 1.5.22

**Who must change: nobody.** Plugins built on earlier SDKs keep working unchanged: a scrub without the new option seeks exactly, as before. Additive; `apiVersion` stays `vestra/1`. The addition needs player 0.5.3.

- **`Scrub.seek(seconds, { keyframes?: boolean })`** (player 0.5.3; requested by the playback plugin for the seek bar, user ruling of 2026-10-27: the bar follows the same "Jump to keyframes only" switch as the arrow keys, PotPlayer style, no second exact seek). With `keyframes: true` the seek lands on the last keyframe at or before `seconds` (mpv `absolute+keyframes`) instead of decoding up to the exact frame: the picture appears in tens of milliseconds on any file, up to one keyframe interval before the target, and the reported position is the keyframe's. Omitted or `false`: exact, as before. The option goes on the wire only when true (`control: { kind: "seek", seconds, keyframes: true }`); players before 0.5.3 ignore the field and seek exactly, so set `"minPlayerVersion": "0.5.3"` when you rely on it. The player sends a repeated target of the same gesture only once while that seek is still running (a click is a press and a release), keyed on the target and the mode: an exact seek to the target of a keyframe seek is always sent.
- **`TestHost.seeks`**: every seek a plugin submitted (`player.seek`, `Scrub.seek`), newest last, as `{ seconds, keyframes }`. The test host lands on the exact target in both modes; a non-boolean `keyframes` is `invalid`.
- Docs: *Playback* (scrubs and the keyframe switch); *Windows, panels, settings pages* gains a pitfall: an `if` that flips under the pointer (a hover highlight created and destroyed on every hover change) rebuilds the window's accessibility tree and drops the video to 10–15 frames a second while the pointer moves; keep the element and change `visible` or `opacity`. `llms.txt` and `llms-full.txt` regenerated.

## 1.5.21

**Who must change: nobody.** Plugins built on earlier SDKs keep working unchanged; the additions need player 0.5.2. Additive and bug fixes; `apiVersion` stays `vestra/1`.

- **`Host.run("fullscreen")`** (player 0.5.2; requested by the playback plugin for a bottom-bar button): toggles the main window's fullscreen exactly like the Toggle Fullscreen command (Enter, F11): in when windowed, out when fullscreen. Read the result from `window.state.fullscreen`. `unavailable` when the player has no window; players before 0.5.2 reject the id with `invalid`, so set `"minPlayerVersion": "0.5.2"`. `HostAction` gains `"fullscreen"`.
- **Default mouse bindings** (player 0.5.2, user ruling): a left click on the video is Play/Pause (`Mouse:LeftClick`, fired on release) and nothing is bound to a double click; Toggle Fullscreen keeps `Enter`, `Alt+Enter`, `F11`. `BUILTIN_COMMANDS` says so. A plugin that declared `Mouse:LeftClick` itself is shadowed by the player's default, as for any key the player binds; users' own bindings are unchanged.
- **`ToolTipArea` no longer swallows a press** (`slint/vestra/widgets.slint`, the player's widget library; bug fix): the tip was a `PopupWindow`, so while it showed, the first press anywhere only closed it, and it took the keyboard focus. It is now Slint's input-transparent tooltip: every press reaches the control under the pointer. It shows after about half a second (was 600 ms), and `showing` follows that delay closely. No API change.
- **Icons `fullscreen` and `exit-fullscreen`** in `slint/vestra/icons.slint` (14 × 12, the V-Line style).
- **`TestHost`**: `host.run("fullscreen")` flips `host.mainWindow.fullscreen` and emits `window.state` (recorded in `coreRuns`); `host/play-pause` declares `Space` and `Mouse:LeftClick`.
- Docs: *Commands* (the player's mouse defaults), *Playback* (a fullscreen button), the Theme and widgets example (the tooltip); generated tables and `llms.txt` / `llms-full.txt` regenerated.

## 1.5.20

Republishes 1.5.19, which was tagged but never published: its API documentation build failed (an example title and four undocumented `IMAGE_LIMITS` fields). Documentation only; the code is the same as 1.5.19 below.

## 1.5.19

Images in list rows, restarting a plugin, and keyframe step seeks (player 0.5.1). Additive; `apiVersion` stays `vestra/1`, and plugins that do not use the new members need no change. Requested by the plugin store (STORE-ROW-LOGO, STORE-RELOAD-BUILTIN) and the playback plugin (keyframe seeks); the online video plugins' search results need the same row images.

- **`ImageRef` at any depth** (`PropData` includes `ImageRef`): an image from `ui.image` goes wherever the Slint type is `image`, also a field of a struct or a row of a model, for example `rows: [{ key, name, icon: plugin.ui.image(path) }]` with `struct Row { key: string, name: string, icon: image }`. Players before 0.5.1 refuse a nested image with `invalid`, as the SDK did until now. A nested image whose file fails the player's checks is drawn empty and the rest of the value is shown; a released image is refused at any depth. Rows with images update in place in the player (a `ListView` keeps its scroll position).
- **`ui.image(path, { maxSide })`** and the new **`ImageOptions`**: decode the image scaled down, aspect kept, so that neither side is over `maxSide` (1–4096). Use about twice the drawn size for logos and thumbnails. Players before 0.5.1 refuse a reference with `maxSide`; without it the wire form is unchanged.
- **Per-view image budget** (player 0.5.1): the images nested in one view's values may show at most 32 MB of decoded pixels together; a write past it is refused with `limit`. **`IMAGE_LIMITS`** (`@vestra-player/sdk/runtime` and `/testing`) lists the player's image limits.
- **`ui.remoteImage(url, options?)`**: downloads an `https:` PNG or JPEG into `<dataDirectory>/.vestra-cache/images/` with the Markdown image rules (4 MB, 10 s, 4 at a time per plugin, a 32 MB cache refreshed after a day) and resolves with an `ImageRef`; rejects `unavailable` when the download fails. Works with any player; nested, with 0.5.1.
- **`Packages.reload(id)`** (`plugins.manage`, player 0.5.1): stop a plugin and start it again from the same package with the same data, built-ins included; a stopped or failed one is just started. The disabled flag is never written. `invalid` for oneself or a disabled plugin, `missing` unknown, `busy` while it is being installed or reloaded; `packages.onChange` shows `starting`, then `running` or `failed`. Listed in `CAPABILITY_INFO["plugins.manage"].apis`.
- **`Player.setStepSeek({ seconds, keyframes })`** (player 0.5.1): with `keyframes: true` the step seeks land on a keyframe (forward at or after position + step, backward at or before position − step, always moving), presses during a seek add up from the landed position, and the on-screen text shows the landed time. Sources without moving video seek exactly; the seek bar, `player.seek`, scrubs, chapters, loops and `player.step` are unaffected. A non-boolean `keyframes` is `invalid`.
- **`Host.run("seek-backward" | "seek-forward", { seconds })`** (player 0.5.1): one step seek of another step, with the core's checks, mode, accumulation and text. In keyframe mode it resolves once the seek has landed. `seconds` with another action, or outside 0.1–3600 in tenths, is `invalid`. Older players ignore `seconds`: set `"minPlayerVersion": "0.5.1"`.
- **`TestHost`**: nested images are recorded in `host.images` (with `maxSide`); `ui.remoteImage` is served from `host.remoteImages`; `packages.reload` is modelled (`starting`, then `running`; `packageCalls` method `"reload"`); `stepSeekKeyframes`, the test data `keyframes` and the log `coreSeeks` model keyframe step seeks, and `host.run` takes `seconds`. The test host lands each press at once (the player completes presses that add up together, with one text).
- Docs: *Windows, panels, settings pages* (images in rows), *Playback* (Step seeks: exact or keyframe); `llms.txt` and `llms-full.txt` regenerated.

## 1.5.18

Fixes for Windows and for a vendored SDK, and built-ins that can no longer be disabled. `apiVersion` stays `vestra/1`; plugins that do not manage other plugins need no change.

- **`TestHost` streams on Windows**: `openStream`'s default transport listened on a socket file in the temp folder, which Windows refuses (`listen EACCES`), so stream tests failed there. It now listens on a named pipe (`\\.\pipe\vestra-test-host-…-producer-<id>`) on Windows and on a Unix socket elsewhere. `producerTransport = "tcp"` still gives the player's own Windows transport (loopback TCP with a token).
- **The CLI runs from an SDK outside any `node_modules`** (a copy with TypeScript on `NODE_PATH`, as the player's AI workshop vendors it): `dist/i18n-tools.js` resolved TypeScript with a bare ES module import, which ignores `NODE_PATH`, so `vestra-plugin` stopped at start with `ERR_MODULE_NOT_FOUND`. It now resolves TypeScript as the rest of the CLI does.
- **Built-in plugins cannot be disabled** (user ruling, 2026-10-26: users manage third-party plugins only). The player and `TestHost` answer `packages.setEnabled(builtin, false)` with `unsupported`; a built-in an older player let the user disable runs again after the upgrade. `PluginInfo.builtin`, `Packages.setEnabled` and *Migrating off package rollback* say so; a plugin manager offers no action for a built-in.

## 1.5.17

**Package rollback is removed**, as announced in 1.5.16: the player keeps no previous plugin version. `apiVersion` stays `vestra/1` (a patch release, as when 1.5.8 removed `PackageCandidate.trial()`); plugins that do not manage other plugins need no change. A plugin manager that still calls `rollback` or reads `previousVersion` no longer compiles. Migration: [Migrating off package rollback](docs/how-to/rollback-migration.md).

- **Removed: `Packages.rollback`** and the wire method `packages.rollback`. The player already answers the method with `unsupported` ("unknown package method"). To go back to an older version of a third-party plugin, the user uninstalls it and installs that version's `.vxp`.
- **Removed: `PluginInfo.previousVersion`** and the wire field `PackageInfo.previousVersion`; `packages.list` and `packages.changed` no longer carry it.
- **Removed from `CAPABILITY_INFO["plugins.manage"].apis`**: `"Packages.rollback"`; the capability is unchanged otherwise.
- **`TestHost`**: `host.packages` entries have no `previousVersion` field (delete it from test data), and there is no `packages.rollback` handler.
- Unchanged: `revisionConflict`, and the `restoring` and `failedDegraded` statuses of `PackageChange`, which belong to recovery from a failed install.
- Docs: the Capabilities reference loses the deprecation note; *Migrating off package rollback* says what 1.5.17 removed; `llms.txt` and `llms-full.txt` regenerated.

## 1.5.16

**Package rollback is deprecated: the player keeps no previous plugin version.** `apiVersion` stays `vestra/1`; code still compiles, and plugins that do not manage other plugins need no change. 1.5.17 removes the deprecated symbols, as 1.5.8 removed `PackageCandidate.trial()` at patch level. Migration: [Migrating off package rollback](docs/how-to/rollback-migration.md).

- **Deprecated: `Packages.rollback`** (removed in 1.5.17). The player no longer has `packages.rollback` and answers it with `unsupported` ("unknown package method"); the SDK still forwards the call, so the error reaches the caller. To go back to an older version of a third-party plugin, the user uninstalls it and installs that version's `.vxp`.
- **Deprecated: `PluginInfo.previousVersion`** and the wire field `PackageInfo.previousVersion` (removed in 1.5.17): always `null`, since an upgrade replaces the package. The SDK reads a missing field as `null`.
- **Built-in plugins** run in place from the player installation: `PluginInfo.directory` of a built-in is `<install resources>/plugins/<id>` and read-only (plugins write only under `plugin.dataDirectory`); they can be disabled and enabled, not uninstalled (`unsupported`, as before).
- **`TestHost`** matches the player: `packages.list` and `packages.changed` report `previousVersion: null` for every plugin, an install no longer records the replaced version, and `packages.rollback` rejects with `unsupported` ("unknown package method"). The `previousVersion` field of `host.packages` entries is deprecated and ignored; it stays required (as `PluginInfo.previousVersion` does), so existing test code compiles unchanged.
- `"Packages.rollback"` stays in `CAPABILITY_INFO["plugins.manage"].apis` until 1.5.17; the Capabilities reference notes the deprecation.
- Docs: the new how-to *Migrating off package rollback (1.5.16)*; *Publish a plugin* no longer mentions a roll back button, installing an older version from the store or the user's rollback as a safety net; the data directory is "kept across restarts, disabling and upgrades"; `revisionConflict`, `PackageChange` and `PackageChangeStatus` speak of installs and uninstalls (the statuses are unchanged).

## 1.5.15

**How many frames really reach the screen, and how the video is decoded** (player 0.5.1); every player error code documented; the fullscreen bottom bar's new behaviour. Additive; `apiVersion` stays `vestra/1`, and plugins need no change.

- **`PlaybackStats.presentedFps`**: new video frames the player window showed per second over the last second, measured by the player (draws of the main window that put a new picture on screen). `framesShown` counts the frames the video renderer produced, so it cannot show frames lost afterwards, for example a window that draws only every other frame: then `presentedFps` is about half of `video.fps`. `null` when the player cannot measure it (no window, the first second) and with players before 0.5.1.
- **`PlaybackStats.video.decoding`**: `"hardware"` or `"software"`, from mpv's `hwdec-current` (the method stays in `video.hwdec`, e.g. `"d3d11va-copy"`); `null` before a decoder runs. With players that do not send it, the SDK derives it from `hwdec`.
- `framesShown` and `framesDropped` say what they count (TSDoc only).
- **`TestHost`**: `host.stats` takes both fields; `presentedFps` is `null` by default, and `video.decoding` follows `video.hwdec` when a test leaves it out.
- **`PluginError`**: the table lists the player's remaining codes with their meaning: `activation`, `command`, `input-overflow`, `internal`, `javascript`, `slint`, `owner`, `pending`, `producer`, `resolution`, `revisionConflict`, `source-geometry`, `source-geometry-unsupported`, `source-unavailable` and `unknown-expired`. `pending`, `unknown-expired` and `revisionConflict` are mostly handled inside the SDK, but can reach a plugin.
- **`SubtitleStyle.offsetMs`**: the range is −600000…600000 ms (±10 minutes), positive shows subtitles later, and outside it the player fails with `invalid`.
- **The fullscreen bottom bar** (player 0.5.1): it shows only while the pointer is in the bar's own band at the bottom of the screen, at once on entering and hidden 500 ms after leaving; keys and pointer motion elsewhere no longer reveal it, and `Panel.setInteraction` locks keep it. `SlotState.reason` `"idle"`, `Panel.setInteraction` and `Panels.mount` (`"bottom"`) said "hides after 3 seconds without activity".
- `llms.txt` names the declaration files by path again (`node_modules/@vestra-player/sdk/dist/plugin/types.d.ts` for the API, `dist/plugin/testing.d.ts` for TestHost) instead of `dist/plugin/*.d.ts`.

## 1.5.14

**The documentation site in seven groups, with generated reference tables.** A documentation release; `apiVersion` stays `vestra/1`, and plugins need no change. Everything a plugin author needs is now on the [documentation site](https://vestrasys.github.io/vestra-player-sdk/) once, in English.

- **Seven groups**: Tutorials, Concepts, How-to, Guidelines, Examples, Reference and API. `scripts/doc-structure.mjs` lists every page and why it is a page of its own; `npm run docs:check` fails on a page that is not listed, a page without a `description`, a placeholder ("coming soon"), a nested folder, a stale generated table or a page far over its size limit.
- **Reference** (new): Manifest (every field and the player version each newer part of the API needs), Capabilities, Limits, Commands, menus and bindings (built-in menus, submenu keys in use, the built-in commands and their default keys, binding syntax and names, core actions, the keys the system takes first), Platforms, Theme (tokens with their current `vestra` values, fonts, icons, widgets) and Command line. Their tables are generated from the SDK's code and Slint files (`npm run docs:tables`), so they cannot drift from it.
- **Guidelines** (new): interface and menu rules.
- **New pages**: Concepts *How a plugin runs*, *Commands, menus and key bindings*, *Playback state, controls and sources*, *Video and audio processing*; How-to *Test a plugin*, *Publish a plugin*; *Translate a plugin* gains the language list and the machine translation review. Getting started and the README link to the Reference instead of repeating its tables; the old compatibility tables are replaced by the generated player version table.
- **New exports** for the generated tables and for tests (`@vestra-player/sdk/testing`): `CAPABILITY_INFO` (per capability: the members it opens, the capabilities they also need, the store's wording, whether the store highlights it; `CAPABILITIES` is derived from it), `MESSAGE_LIMIT` (1 MiB per message), `OSD_LIMITS`, `SECRET_LIMITS`, `BINDING_INPUTS` (the key and mouse names a binding is made of), `BUILTIN_SUBMENUS` (the submenu keys the built-in plugins use), `BUILTIN_COMMANDS` (the built-in commands with their menu paths and default keys) and `THEME_PALETTES` (the colours of `vestra` and `vestra-light` by `Theme` token). The player's tests check them against the player.
- **`TestHost`** enforces the information block's limits like the player: `OsdPanel.set` with more than 32 lines or 4096 bytes (after `maxColumns` is applied) fails with `invalid`.
- `llms.txt` lists every capability and points at every page of the site in `llms-full.txt`, which now contains all of them.

## 1.5.13

**`i18n extract` keeps the translator's comments and writes the right number of plural forms.** A fix; `apiVersion` stays `vestra/1`.

- Merging into a `locales/<lang>.po` kept only the header's text: comment lines before the header (`# Reviewed by an AI reviewer on 2026-10-25`, `# Translator: …`, `#, fuzzy`) and the translator's own `# ` comments on entries were dropped. Both are now kept as written (`parsePo` returns `headerComments`, entries carry `comments`; `writePo` writes them).
- A plural entry has exactly `nplurals` `msgstr[n]` lines, from the file's `Plural-Forms` (or the language: one for `ja`, `ko`, `zh-Hans`). Before, every plural entry got an empty `msgstr[1]`, also in one-form languages; a merge now removes such an extra empty line (a filled one stays).

## 1.5.12

**Keys of disabled commands pass on; `i18n check` fails on stale catalogs; translator notes in tables; the Button follows its text.** A fix release; `apiVersion` stays `vestra/1`.

- **`TestHost.press` matches the player (0.4.3) for disabled commands.** A disabled command no longer swallows its key: the key goes to the next command bound to it (the one it shadowed in a conflict, then the global scope after a panel binding). With only disabled commands left, the first one with a `reason` shows the reason on the OSD and eats the key; without a reason the key reaches the focused control. `press` now resolves with what happened, `"ran"`, `"reason"` (see `host.osd`) or `"passed"`, instead of rejecting for a disabled command; it still rejects when nothing is bound and when the command that runs is busy. A test that expected `press` to reject for a disabled command now gets `"passed"` or `"reason"`.
- **`vestra-plugin i18n check` exits with 1** when `locales/messages.pot` is out of date, missing while `.po` files exist, or a `.po` lacks some of the template's messages, so CI catches a forgotten `extract`. Before, it printed these and exited 0. The other findings stay warnings, and `vestra-plugin check` still only prints them.
- **`TRANSLATORS:` notes on `as const` table entries.** A comment before a property or element of an object or array literal under `as const` (at any depth) now reaches the translators like one at a call site; before, texts extracted through a table lost their notes.
- **`slint/vestra/widgets.slint`** (the copy of the player's library): `Button`'s preferred width follows its label (the minimum width is unchanged), so a longer translated label widens the button instead of overflowing it.

## 1.5.11

**Text values: words mixed with data, translated by the player** (player 0.4.3). Additive; `apiVersion` stays `vestra/1`, and plugins that worked need no change. 1.5.9 and 1.5.10 were not published to npm; this release includes them. Round-2 i18n requests R2-audio-1, R2-video-1, R2-subtitles-1/2, R2-playlist-1/2, R2-store-1, R2-workshop-1, R2-nes-1, capture #1, P-2, the info and hotkeys export texts, timeline and subtitle titles: one mechanism. Guide: [Translate a plugin ▸ Text that mixes words and data](docs/how-to/i18n.md#text-that-mixes-words-and-data).

- **`plugin.i18n.text(source, args?)`** returns a `Text`: plain, frozen data (`{ $vestraText, args }`), not a translation. The player translates `source` with the plugin's catalog and fills in `args` wherever it shows it. Arguments are data, or text values that are translated too, so a sentence can be built from translated parts without composing it in TypeScript.
- **`plugin.i18n.list(items, style?)`** returns a `TextList`: items joined with the interface language's separator (`ListStyle`: `"list"` `, ` / `、`, `"clauses"` `, ` / `，`, `"semicolons"`, `"sentences"`, `"lines"`; `LIST_SEPARATORS` in `@vestra-player/sdk/testing`).
- **Accepted wherever the player shows a plugin's text**: command `title`, `path` segments (the menu merges by the English rendering) and `reason`; `osd.show` and `OsdPanel.set` as the text or an argument (`TemplateArgs` now takes `TextArg`); every `dialogs.confirm` text; file dialog `title` and `saveFile`'s `fileName` (a string `fileName` stays data); property values where Slint has a `string`, at any depth (`PropData` takes `Text` and `TextList`), so a ComboBox model can mix fixed words and data; `TimelineLayer.set` mark titles; `subtitles.load({ title })`.
- **`plugin.i18n.error(source, args?)`**: an `Error` (`TextError`) whose words the player shows translated when a file or web resolver's `resolve` throws it (also a stream failing while it starts): the open's failure and `player.state.error`. `message` is the English rendering.
- **`plugin.i18n.resolve(value)`**: the translated string, for text that leaves the player only (clipboard, files). Never for the interface.
- **`OsdPanel.set(text, args, { maxColumns })`** (`OsdPanelOptions`): the player cuts each line after translation (a wide character is two columns).
- **`BindingInfo.key`**: the menu path's English keys, the same in every language (P-2). Find a command by its place in the menu with it, not with `path`.
- **Limits** (`TEXT_LIMITS` in `@vestra-player/sdk/testing`): nesting 8, 1024 values in one text, 16 arguments per text, 256 items per list, 4096 bytes per source or string argument (template string arguments were 1024 bytes). A malformed value throws `invalid` where it is made, and the player refuses it with `invalid`. A property value's limits count a text value as the string it becomes.
- **`vestra-plugin i18n extract`** collects the source of every `plugin.i18n.text(…)`, `error(…)` and `resolve("…")` call (also destructured: `const { text } = plugin.i18n`) and of a `{ $vestraText: "…" }` literal. Every source is collected, also one made only of placeholders and punctuation (`"{} ({})"`, which Chinese writes `"{}（{}）"`). It now reads fields spread into a call's options (`commands.add({ ...extra })`) by their types and reports the ones it cannot extract; before, it skipped them without a word. A field typed as a text value is not reported as "not a literal".
- **Type note**: the option fields that now take a text value (`ConfirmOptions.message` and the other dialog texts, `CommandOptions.title`/`path`/`reason`, `CommandState.reason`, file dialog `title`/`fileName`, `TemplateArgs`) are wider types. Code that only passes them is unchanged; code that reads such a field back as a `string` (a helper that cuts `options.message`) needs a `typeof … === "string"` check.
- **`TestHost`** shows text values as the player does: `FakeCommand.display` (and the non-enumerable `display.reason`), `host.osd`, `host.osdPanel` (cut to `maxColumns`), `host.confirmTexts`, new `host.fileDialogs` (`FileDialogText`), window, panel and settings page `props` (text values replaced by their strings; `host.sent(...)` keeps what the plugin sent), timeline titles, subtitle titles, a resolver's `TextError`, and `BindingInfo.key`. `host.translate` takes a text value too. It refuses malformed text values with the player's messages.

## 1.5.10

**Property value limits: documented, higher, enforced by `TestHost`, reported loudly** (player 0.4.3). A fix; `apiVersion` stays `vestra/1`, and plugins that worked need no change. 1.5.9 was not published to npm; this release includes its changes.

- **`UI_VALUE_LIMITS`** in `@vestra-player/sdk/testing`: the player's limits on one property value, which used to appear only in the `PropValue` description. Raised in player 0.4.3 (older players in brackets): nesting depth 8, **16384 values** (4096), **4096 rows per array** (1024), 64 KiB per string or field name, 1 MiB of text. A list of 8-field rows is 9 values per row, so about 1800 rows fit (about 450 before). The player's tests check that the constant agrees with the player.
- **`TestHost` enforces them** on `ui.open`, `ui.set`, `ui.mount`, `ui.setMount`, `settings.register` and `settings.set`, with the player's code and message. Before, it took any value, so a plugin whose list outgrew the limit passed its tests and showed a stale list in the player (D1: a 3000-row playlist). A test that writes a value over the limits now sees the failure in `onError` (or, for a tool window's initial property, a rejected `Window.show`).
- **Failures say what they are.** A value over the limits fails with code **`limit`** (was `host`) and the message names the property (`rows: UI array exceeds 4096 rows`). A panel's or settings page's initial property over the limits is still left out (the panel mounts without it; a failed mount during activation would fail the plugin), but the player now reports it to `onError` instead of only writing its log.
- **`ui.error` reaches `onError`.** The player reports failures nobody asked about: a callback whose arguments it could not convert, a property it could not show again when it rebuilt a panel or the Options window (an image file removed since), a detached sidebar it could not prepare. The SDK used to drop these; it now reports them to the root scope's `onError` with the player's code (`ui` from older players).
- The player's runner (player 0.4.3) refuses a request longer than the player's 1 MiB message with `limit`; before, the player stopped the plugin.

## 1.5.9

**Translations** (player 0.4.3). Additive; `apiVersion` stays `vestra/1`, and plugins written for 1.5.8 need no change. One test-visible change: a core action's `declaration.path` in `TestHost` is now the player's English key (read `display` for what the menu shows). The player now shows its interface in English, Simplified Chinese, Japanese, Korean, German, French or Spanish, chosen at start-up; a plugin writes every text in English and ships one gettext file per language. Plugins write no translation code: the player translates. Guides: [Translate a plugin](docs/how-to/i18n.md), [Migrate a plugin to English source text](docs/how-to/i18n-migration.md); example: `examples/i18n`.

- **`plugin.i18n.locale`** (new `I18n`, `Locale`): the interface language of this run, `"en"`, `"zh-Hans"`, `"ja"`, `"ko"`, `"de"`, `"fr"` or `"es"`; it never changes while the player runs. `"en"` from older players.
- **Templates with arguments**: `osd.show(text, args?)`, `OsdPanel.set(text, args?)` and `ConfirmOptions.args` (new `TemplateArgs`: an array for `{}` / `{0}`, an object for `{name}`). The player translates the template with the plugin's catalog, then fills it in. Without `args` the text shows as it is, so existing calls are unchanged; older players show the template unfilled.
- **Declarations are translated by the player** from the plugin's catalog: command titles, path segments and `reason`, settings page and panel titles, and the manifest's display fields. Menu paths are English source text and menus merge by them; the player's own menus have the English keys `Open`, `Playback`, `Subtitles`, `Video`, `Audio`, `Screen`, `Settings` (the `@video`-style ids still work, and the player still accepts the old Chinese titles of its own menus). New `PluginInfo.display` (`PluginDisplay`): a package's name, punchline, description and tags as shown.
- **`appearance.language`** (`LanguagePreference`: `"system"` or a locale) and **`appearance.setLanguage(language)`** (needs `ui.theme`): the saved choice, used from the next start.
- **Catalogs**: `locales/messages.pot` and `locales/<lang>.po` in the plugin's folder. New commands **`vestra-plugin i18n extract`** (finds `@tr` in `.slint` files, the texts of `commands.add`, `osd.show`, dialogs, settings and panel titles through the TypeScript type checker, and the manifest's display fields; merges into every `.po`, keeping translations; `--locale <lang>` starts one) and **`vestra-plugin i18n check`** (coverage, placeholder and plural problems, a stale template, sentences composed in TypeScript, non-literal values, non-English source text, Slint text without `@tr`; warnings only). `vestra-plugin check` prints the same warnings when the plugin has `locales/`. `vestra-plugin build` compiles each `.po` into `dist/locales/<lang>.json` and no longer packs `.po` files.
- **`TestHost`**: `locale` (also `startPlugin({ locale })`) loads the plugin's catalog for that language; `FakeCommand.display` is the menu as shown, `host.osd` and `osdPanel` the shown text (the template and args stay in `host.sent(...)`), new `host.confirmTexts`, `host.translate(text, args)`, `host.loadCatalog(directory)`, `host.language` / `setLanguage(...)`, settings page and panel titles as shown. The core actions' declarations use the player's English keys (`["Playback", "Seek", "Forward 5 s"]`); their `display` and the binding table show the player's words. While `locale` is not set, the player's own messages (core actions, refusals) stay in the Chinese of 1.5.8, so existing tests keep passing; with a `locale` they are the player's English (or its Chinese for `"zh-Hans"`).
- `LOCALES` in `@vestra-player/sdk/testing`.
- The Slint library copy (`slint/vestra/widgets.slint`, `markdown.slint`) uses `@tr` for its own texts (`UrlInputRow`'s default buttons, the code block's Copy button, the image placeholder).

## 1.5.8

**Trial loading is removed; `resolvers.fileTypes`; the CLI under `--permission`.** `apiVersion` stays `vestra/1`. The removal breaks code that called `PackageCandidate.trial()`: only Vestra Player AI did, and it moves to installing (an install can be rolled back).

- **Removed: `PackageCandidate.trial()`, the `PackageTrial` type, `PluginInfo.origin` `"trial"` and the error code `cleanup`** (only `PackageTrial.stop` used it). The player (0.4.2) no longer answers `packages.trial`, `packages.trialState`, `packages.trialStateByRequest` or `packages.stopTrial`, and never lists a plugin with origin `"trial"`. Trial loads only supported plugins using `commands`, `ui.window` and `events`, listed the plugin under another id (`<id>.trial.<n>`), and `trial()` returned before activation ended, so the feature was removed instead of extended. Check a package with `validate` and install it; `rollback` restores the previous version.
- **`plugin.resolvers.fileTypes`** (player 0.4.2): the extensions some plugin's file resolver handles, lower case, sorted, each once, without who registered them; `[]` from older players. Reading needs no capability. **`plugin.resolvers.onFileTypesChange(listener)`** follows it when a file resolver comes or goes (needs `events`). For a playlist that accepts ROMs while an emulator plugin runs. `TestHost`: `host.fileTypes()` (this plugin's file resolvers plus `otherResolvers`) and `host.updateFileTypes()` after changing `otherResolvers`.
- **`vestra-plugin` runs under Node's permission model** (`--permission`, with `--allow-child-process` for the type checker): looking for `node_modules/@types`, `tsconfig.json` and `.git` in parent folders it may not read threw `ERR_ACCESS_DENIED`; such a folder now counts as absent.
- `Packages.validate`: the player (0.4.2) keeps the 32 most recent candidates and drops the oldest, whose `install` then fails with `stale`; before, the 33rd validation of a run failed with `busy` until the player restarted.

## 1.5.7

**Replaced or closed streams stop with `null`.** A fix; no API change, `apiVersion` stays `vestra/1`, any player.

- **`Stream.onStop(null)` when another source replaced the stream or it was closed**, as documented. The player retires a stream's producer at once in both cases, and the SDK then passed the player's answer (`unavailable`, "producer absent") to `onStop` as an error. The SDK now reads the player's state to tell the two apart: replaced or closed is `null`; a failure is a `stream` error with the player's text (also when the player retired the producer right after failing it, which used to give "producer absent" too).
- The same in the start-up paths: `openStream` replaced or closed before it ran rejects with `replaced` (was `unavailable`); a file resolver's stream replaced after the player selected it is a cancellation and no longer reaches `onError`.
- **A file resolver's stream that cannot start after `resolve` returned** fails the open with Chinese text instead of the SDK's English (`"audio device is not ready: deviceLost"`): `device` "音频输出设备不可用", `timeout` "启动超时", `busy` "播放器正忙，请稍后重试", other start-up failures "无法启动播放"; the English detail goes to the plugin's log. The plugin never saw these errors, so the user read the SDK's words. An error thrown by `frame()` keeps its message; text for a file the plugin can judge (a bad header) belongs in `resolve`.
- **`TestHost` retires producers like the player**: on `open`, `close`, another `openProvider` or resolved stream, a retired producer's `producer.state` answers `unavailable` and `producer.ack` `stale`. New `FakeProducer.retired`, and **`host.failStream(producerId, message)`** to fail the playing stream the way the player does (`phase: "error"` with `message`, producer retired). Tests that replaced a stream used to pass where the player failed.

## 1.5.6

**A reference for AI assistants.** Documentation and packaging only; no API change, `apiVersion` stays `vestra/1`. (1.5.5 was not published to npm; this release includes its changes.)

- **`llms.txt` and `llms-full.txt`** ([llmstxt.org](https://llmstxt.org)) in the package, exported as `@vestra-player/sdk/llms.txt` and `@vestra-player/sdk/llms-full.txt` (in `node_modules/@vestra-player/sdk/`), and on the documentation site (`https://vestrasys.github.io/vestra-player-sdk/llms.txt`). For Vestra Player AI and other assistants that write plugins.
  - `llms.txt` (about 10 KB): what a plugin is, the rules, the folder layout, a manifest with every field and the manifest limits, `activate`, every capability, a `TestHost` test, the command line, the common error codes, and the line numbers of each topic in the full file.
  - `llms-full.txt` (about 300 KB): the guides (Getting started, the UI concept page, both how-tos), every public declaration of `@vestra-player/sdk` and `@vestra-player/sdk/testing` with its description and its `@capability`, `@player`, `@param`, `@returns`, `@throws` and `@deprecated` tags, the internal types the API refers to, and each example's README, walkthrough and complete source (TypeScript, Slint, tests).
  - Generated from the sources by `npm run docs:llms` (`scripts/llms.mjs`); CI fails when the committed files are stale.
- **Getting started**: a "Rules for plugins" section (only the public SDK, `import type`, no other plugins, no system commands, macOS and Windows, your own id) and a manifest with every field.
- `scripts/check-pack.mjs` allows the two files and checks that they name the package version; the install smoke test resolves both exports.

## 1.5.5

**Reserved `vestra.` ids** (player 0.4.1). Documentation only; no API change, `apiVersion` stays `vestra/1`.

- Only the plugins built into the player are official plugins; the ids `vestra` and `vestra.*` (any case) are reserved for them. Every other plugin is a third-party plugin, including those hosted in the official plugin repository, and uses `<GitHub user or organization>.<plugin name>`.
- `PluginError` lists the code `reserved`: `packages.validate`, `packages.validateArchive`, `PackageCandidate.trial` and `PackageCandidate.install` refuse a package with a reserved id. Development loads (`vestra-player --plugin DIR`) still accept one, with a warning, so built-in plugins can be developed; they are never installed.
## 1.5.4

**Markdown in list rows** (the player after 0.4.0). Additive; `apiVersion` stays `vestra/1`, and plugins written for 1.5.3 need no change.

- **A `MarkdownRef` at any depth.** A document from `plugin.ui.markdown` may now be a field at any depth of a property value, wherever the Slint type is `[MarkdownBlock]`: for example the `body` of each row of a chat's `[Message]` list. Before, it could only be the whole value of a `[MarkdownBlock]` property. `PropValue` is now `PropData | ImageRef`, where the new **`PropData`** is JSON whose values may also be `MarkdownRef`s, at any depth. A released document is refused with `invalid` wherever it is in the value. An `ImageRef` stays a whole value only: nested in an array or object it is `invalid` (a type error in TypeScript, and refused by the SDK and the player). Older players refuse a nested document like any value they cannot convert.
- **Limits:** a document still holds at most 256 KB of text, 4000 blocks and 64 images; all of a value's text, its documents' text included, counts toward the value's 1 MiB; each document is one of its 4096 values.
- **`MarkdownBlocks`** (new in `@vestra/markdown.slint`): the blocks of a document without scrolling, as tall as their content, for your own layout or a `ListView` row. `in [MarkdownBlock] blocks`, `in bool code-copy` (default `false`), callbacks `link-clicked(string)` and `copy-code(string)`. `MarkdownView` is now a `ScrollView` around it and gains the same `code-copy` and `copy-code`; it looks as before.
- **Code copy, opt in.** With `code-copy: true`, code blocks get a 复制 button that reports `copy-code(code)` with the block's text; the plugin copies it (`plugin.clipboard.writeText`). Off by default: views that do not set it look and behave as before.
- **Cheaper updates** (player): writing a value again with unchanged documents does not parse them again (a new reference for the same text included), and a value with documents is updated in place where its shape allows: changed rows, rows added or removed at the end, and only the changed blocks of a changed document. Streaming a reply into the last row of a 200-message list therefore keeps the list, its scroll position and the other rows. Nothing to change in plugins.
- `TestHost` keeps nested documents in the view's properties as they were sent; `host.markdown(value)` reads one back from a field (`host.markdown(rows[0].body)`).
## 1.5.3

**File resolvers: local files as generated streams** (player 0.4.1). Additive; `apiVersion` stays `vestra/1`. Plugins that register one set `"minPlayerVersion": "0.4.1"`: an older player refuses the declaration (`invalid`).

- **`resolvers.add({ id, extensions, resolve })`** (`FileResolverOptions`). When anyone opens a local file of those extensions with `player.open` (the Open dialog, the playlist, next / previous, the recent list), the player asks this plugin for a stream instead of playing the file. `resolve(path, signal)` returns a `ResolvedStream`: `{ kind: "stream", width, height, frame, started? }`, with the frame contract of `openStream`. Needs `source.resolve` and `producer.av`. `ResolverOptions` is now the union of `WebResolverOptions` (the existing form) and `FileResolverOptions`.
  - The open keeps its arbitration: its `ifCurrent` and operation (the opener's `open` / `media.ready()` settle as usual), and `paused` reaches the stream's start. `state.source` stays the path, `state.kind` is `"stream"`.
  - Cancellation: `signal` aborts when the open is replaced or closed (`player.close()` included), times out (30 s) or the resolver is disposed. Cancelled after `resolve` returned but before the stream ran, the SDK releases the stream and never calls `started`.
  - `started(stream)` is called synchronously right after activation, before any `onStop`; the `Stream` is the same as `openStream`'s and belongs to the resolver's plugin.
  - Extensions: 1–16 entries of 1–16 lower-case letters or digits, not `"folder"`; only absolute local paths match (any case), URLs never do.
- **One extension, and one scheme + host pair, has one resolver.** Another plugin's makes `Resolver.ready` reject with `conflict` (reason `resolver-taken` on the wire), and that no longer fails activation, for web resolvers too (as for panels and the sequence since 1.5.2); the player shows a warning (`PluginInfo.warnings`: `code` `"resolver-taken"`, `owner`, the new `target`). The plugin's own second claim still fails activation.
- **Resolver failures are sent as the error's message** (`error.message`, was `String(error)`, e.g. `"Error: …"`), and the player shows them word for word (it prefixed `resolver failed: `). This changes the failure text of web resolvers too.
- **Docs**: `PlayerState.source` documents the naming of generated streams: `producer://<n>` (opaque) for `openStream`, the path for a file resolver's; tell streams apart by `kind`.
- **`TestHost`** simulates file resolutions: opening a matching path (`player.open`, `openElsewhere`) sends `source.resolveRequest` and keeps the open pending; the answer selects the stream (or fails the open); any later source change cancels it (`source.resolveCancel`). `resolutions` lists the pending ones, `otherResolvers` simulates other plugins' registrations (conflicts). `startPlugin` does not fail activation for such a conflict. Web resolutions are still driven by the test (emit `source.resolveRequest`).
- Internals: `openStream` is split into prepare / activate / abandon steps shared with file resolvers; the wire client (`sourceResolvers.register`) takes a `{ id, extensions }` declaration and a handler answer with the prepared producer.

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
