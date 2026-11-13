---
title: Test host
description: What startPlugin takes and returns, how TestHost simulates the user and the player, what it records, and every TestHost member.
---

# Test host

`@vestra-player/sdk/testing` runs a plugin against {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, an in-memory player that speaks the real protocol, so the SDK's own logic runs as in the player. How to write tests is in [Test a plugin](../guides/testing.md).

- **Simplified player side**: no decoding, no Slint rendering or compiling, no native window. A window is a record of its properties and callbacks; a source is a set of facts the test chooses. Check Slint files by running the plugin in the player (`--plugin <dir>`).
- **The player's checks apply**: the command limits, property value limits, menu ids and processing ranges are enforced with the player's numbers, and the manifest's capabilities apply. Export jobs advance one step on every state query.
- **Property types are checked against the Slint files**: a value written to a window, panel or settings page is refused when the player would refuse it, with the player's code and message: a property the view does not declare (`nothing: no such property`), an `out` property (unless the write only repeats the value it holds, which the player ignores except when a window opens), a value of another type (`high-tint: wrong type: high-tint is a string where the declaration has a brush`; a struct field the struct does not declare), a struct field name not in Slint's spelling (`UI object field "a_b" is not in Slint canonical spelling`). Numbers fit `int`, `float` and `length` alike; no value fits `brush`, `color` or an enum; `null` fits only where an image is declared inside an array without Markdown documents; a Markdown document's rows must fit the declared row type (`[MarkdownBlock]`). What the test host cannot read is taken as declared loosely, so it never refuses what the player takes: a type name it cannot resolve (one of `std-widgets.slint`, a misspelled or undeclared name) takes any value, and a component that inherits a component of the plugin or one it imports takes undeclared names. A panel's or settings page's initial value with a field name not in Slint's spelling is left out and reported (`onError`, code `host`); a panel's initial value of a type it refuses is reported and stays stored while the panel shows its default, as in the player; a settings page's values are checked when written, where the player checks them when the Options window shows the page.

## startPlugin

`startPlugin(activate, options)` resolves with `{ host, plugin, stop, disconnect }` once activation and its registrations are done, and rejects when the player would fail the activation. `stop()` disposes the plugin as the player does and removes the host's temporary files; `stop({ reason })` passes a stop reason, and `disconnect()` stops it as when the player is lost (`host-lost`). Each test creates its own host.

| Option | Meaning |
| --- | --- |
| `directory` | The plugin folder with `manifest.json` (from `tests/`: `new URL("..", import.meta.url)`). |
| `host` | A `TestHost` prepared before activation (a preset source, preset data). |
| `dataDirectory` | An existing folder as `plugin.dataDirectory`, to test a restart; by default an empty temporary folder. |
| `sessionStorage` | The values of `plugin.storage.session` an earlier run left (`host.sessionStorage`), to test a restart within one player session. |
| `locale` | The interface language (`"zh-Hans"` loads `locales/zh-Hans.po`). Without it the plugin's texts show in English and the player's own texts in Simplified Chinese; `"en"` shows the player in English. |
| `id`, `capabilities` | Start without a `manifest.json`. |
| `builtin` | Run the plugin as one built into the player: only then do the built-in-only capabilities (`commands.run`, `palette.lead`) work; otherwise their calls fail with `capability`, as in the player. |

## Acting like the user

| To simulate | Call |
| --- | --- |
| choosing a menu item | `await host.command(id).run()`; rejects like the player when the command is disabled or busy |
| pressing a key | `await host.press("Ctrl+B")`; `host.press("Delete", { panel: true })` while the plugin's panel has focus |
| a control in a window | `host.window(id).emit(callback, ...args)` (the id is the file name: `ui/picture.slint` is `picture`) |
| closing a window with its title-bar button | `host.window(id).userClose()` (runs the window's `onClose`, unlike the plugin's own `close()`) |
| a control in the mounted panel | `host.mounted().emit(callback, ...args)` |
| answering a dialog | before the action: `host.dialogAnswers.push(["/media/movie.mkv"])` for a file dialog, `null` for Cancel, `{ confirmed: true, checked: false }` for `dialogs.confirm` |
| another plugin calling `player.next()` | `await host.step("next")` |
| Enter on the palette's lead row | `const ticket = await host.runPaletteLead("typed text")` (`{ keep: true }` for Shift+Enter, `{ status: true }` for the status row); the ticket is the one the plugin's `onRun` listener got. A `commands.run` of a command that asks first takes its answer from `host.dialogAnswers` (`{ confirmed: false, checked: false }` is Don't Run). |

`press` follows the player's binding table: the panel's bindings first when `panel` is true, then the global ones, the player's own commands before the plugin's. A disabled command lets the key go on to the next command bound to it. It resolves with what the key did:

| Result | Meaning |
| --- | --- |
| `"ran"` | The first enabled command bound to the key ran. |
| `"reason"` | Only disabled commands hold the key, and the first one with a `reason` showed it on the OSD (it is in `host.osd`) and ate the key. |
| `"passed"` | Only disabled commands without a reason hold it; the key goes on to the focused control and nothing runs. |

It rejects when nothing is bound to the key or its command is busy. Overrides preset in `host.bindings.overlay` apply; `host.conflicts` lists keys that several commands declare.

## Simulating the player

- `host.openElsewhere(path, phase?)`: the user or another plugin opened a source; the plugin's calls against the old state now fail with `stale`.
- `host.setSource({ … })`, `host.setMainWindow({ … })`, `host.setAppearance(theme)`, `host.setPackages(list)`: the state changed; before `startPlugin`, a preset.
- Preset answers: `host.stats`, `host.chapters`, `host.clipboard.text`, `host.secrets`, `host.systemInfo`, `host.rendering`, `host.upscaling`, `host.tools.handle(name, fn)`.
- `host.handle(method, fn)` replaces the player's answer to one protocol method until `host.reset(method)`. `throw new HostError(code, message)` in it is a refusal with that [code](errors.md); `throw new Error(…)` is a lost reply. `host.calls` lists every request in order, `host.sent(method)` one method's parameters.

## Waiting

`await host.settle(ms?)` waits until no request is in flight and the SDK's update passes ran; with `ms` it also lets timers due by then fire (`host.settle(400)` is past `storage.json`'s 300 ms debounce). `command(id).run()` and `press` already wait. It does not wait for the plugin's own file, process or network work.

## Every member

<!-- generated:test-host -->

| Member | What it is |
| --- | --- |
| {@link "@vestra-player/sdk/testing"!TestHost.calls} | Every request the plugin sent, in order: `{ method, params }`. |
| {@link "@vestra-player/sdk/testing"!TestHost.subscriptions} | The host events the plugin subscribed to (needs `events` etc.). |
| {@link "@vestra-player/sdk/testing"!TestHost.listening} | The subscribed events the plugin really listens to: an `onChange` and the like, or a binding that reads the state. |
| {@link "@vestra-player/sdk/testing"!TestHost.listeningWhy} | Why the plugin listens to each event of `TestHost.listening`: every listener and every binding that reads its state, as the player's log says them (`a listener added at main.ts:12`, `command "Save" enabled is a function that reads plugin.player.state (main.ts:40) — use plugin.when`), in the order they came. |
| {@link "@vestra-player/sdk/testing"!TestHost.source} | The player's source facts (phase, position, duration, paused, rate, audio tracks, loop, ...). |
| {@link "@vestra-player/sdk/testing"!TestHost.windows} | Tool windows by id (see `TestHost.window`). |
| {@link "@vestra-player/sdk/testing"!TestHost.panels} | The plugin's mounted panels by slot, in mount order (one panel per slot). |
| {@link "@vestra-player/sdk/testing"!TestHost.panel} | The plugin's mounted panel (bottom bar, sidebar, adjust column or backdrop), the last mounted when it has several, or `null`. |
| {@link "@vestra-player/sdk/testing"!TestHost.commands} | The plugin's commands by local id (see `TestHost.command`). |
| {@link "@vestra-player/sdk/testing"!TestHost.coreCommands} | The player's 14 core actions (`host/<id>`), kept apart from the plugin's `commands`. |
| {@link "@vestra-player/sdk/testing"!TestHost.layout} | Both panel positions as the player reports them (`null` while no panel is mounted there). |
| {@link "@vestra-player/sdk/testing"!TestHost.osd} | Every `osd.show` text as the player shows it (translated with the plugin's catalog and formatted with its args), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.osdActions} | The action buttons of each `osd.show` message, in step with `osd` (index for index): each button's title as shown and its command; `[]` for a message without actions. |
| {@link "@vestra-player/sdk/testing"!TestHost.pressOsdAction}() | Press button `index` of the newest OSD message, as the user does: its command runs as if picked from a menu, and settles. |
| {@link "@vestra-player/sdk/testing"!TestHost.osdPanel} | The text of this plugin's osd panel as shown, `null` when hidden. |
| {@link "@vestra-player/sdk/testing"!TestHost.locale} | The interface language the test host plays (`plugin.i18n.locale`), `"en"` by default. |
| {@link "@vestra-player/sdk/testing"!TestHost.loadCatalog}() | Read the plugin's translations for `TestHost.locale` from a package directory, as the player would (`locales/<locale>.json` of a built package, else the source `locales/<locale>.po`); `startPlugin` does this. |
| {@link "@vestra-player/sdk/testing"!TestHost.translate}() | A text of the plugin as the player shows it: translated with the plugin's catalog (`TestHost.loadCatalog`), then formatted with `args` when given. |
| {@link "@vestra-player/sdk/testing"!TestHost.language} | The saved interface language (`plugin.appearance.language`), changed by `appearance.setLanguage` or `TestHost.setLanguage`. |
| {@link "@vestra-player/sdk/testing"!TestHost.setLanguage}() | Simulate another plugin (or the user) saving the interface language: pushes `appearance.changed`. |
| {@link "@vestra-player/sdk/testing"!TestHost.confirmTexts} | Every `dialogs.confirm` as the player shows it: its texts translated (message and detail formatted with `args`), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.fileDialogs} | Every file dialog (`openFile`, `openFiles`, `openDirectory`, `saveFile`) as the player shows it: the title translated, a text file name translated, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.sequence} | The sequence provider's flags, `null` without a provider. |
| {@link "@vestra-player/sdk/testing"!TestHost.stats} | What `player.stats()` returns. |
| {@link "@vestra-player/sdk/testing"!TestHost.subtitleLoads} | Every `subtitles.load`: its options and bytes, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.clipboard} | The fake system clipboard. |
| {@link "@vestra-player/sdk/testing"!TestHost.power} | The effective `power.preventSleep` mode. |
| {@link "@vestra-player/sdk/testing"!TestHost.tools} | The fake `ffmpeg` / `ffprobe` behind `plugin.tools`. |
| {@link "@vestra-player/sdk/testing"!TestHost.system} | Paths given to `system.reveal` / `system.openPath`, newest last; inject failures with `host.handle("system.openPath", …)`. |
| {@link "@vestra-player/sdk/testing"!TestHost.menus} | Every `panel.showMenu`, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.timeline} | Timeline layers by plugin id (this plugin's is `manifestId`) and the merged list `plugin.timeline.marks` reads. |
| {@link "@vestra-player/sdk/testing"!TestHost.setTimelineRanges}() | Simulate another plugin publishing its timeline ranges (or clearing them with `[]`); pushes `timeline.changed` when the plugin subscribed. |
| {@link "@vestra-player/sdk/testing"!TestHost.setTimelineLayer}() | Simulate another plugin publishing its timeline layer (or clearing it with `[]`); pushes `timeline.changed` when the plugin subscribed. |
| {@link "@vestra-player/sdk/testing"!TestHost.images} | Runtime images written to views (`plugin.ui.image`, `plugin.ui.remoteImage`), whole values and images nested in rows, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.imagePath}() | The file an image property shows, or `null` when the value is not a runtime image. |
| {@link "@vestra-player/sdk/testing"!TestHost.dropProviders} | `drops.provide` registrations of this plugin, in order (`id` is the SDK's). |
| {@link "@vestra-player/sdk/testing"!TestHost.panelDrops} | The panel has an `onDrop` listener. |
| {@link "@vestra-player/sdk/testing"!TestHost.drop}() | Drop files like the player: on a panel with an `onDrop` listener the whole list goes there; otherwise (and on the video area) each path goes to the first provider of its extension (`folder` for existing directories), one call per provider with all of its paths. |
| {@link "@vestra-player/sdk/testing"!TestHost.appearance} | The palette (`plugin.appearance.theme`); `setAppearance` changes it elsewhere. |
| {@link "@vestra-player/sdk/testing"!TestHost.setAppearance}() | Simulate another plugin switching the palette: updates `TestHost.appearance` and pushes `appearance.changed`. |
| {@link "@vestra-player/sdk/testing"!TestHost.settings} | Settings pages by id (`plugin.settings.page`), every `show` (page id or null), and the page the options window shows. |
| {@link "@vestra-player/sdk/testing"!TestHost.settingsPage}() | One settings page by id. |
| {@link "@vestra-player/sdk/testing"!TestHost.backdrop} | The backdrop: who mounted it and whether it shows (`panels.backdrop.state`). |
| {@link "@vestra-player/sdk/testing"!TestHost.setBackdropEffective}() | Simulate the backdrop's `effective` changing (`false`: a video frame appeared; `true`: there is none again); pushed to the plugin. |
| {@link "@vestra-player/sdk/testing"!TestHost.mountOther}() | Simulate another plugin mounting a panel, before or after the plugin under test, as the player handles it: in the sidebar it is another tab (after the existing ones; the first panel's tab is current); the bottom bar and the backdrop take one panel, so the plugin's own mount there then rejects with `conflict` (not an activation failure, as in the player). |
| {@link "@vestra-player/sdk/testing"!TestHost.unmountOther}() | Simulate another plugin's panel going away (`TestHost.mountOther`): when its tab was current, the next tab (else the previous one) is. |
| {@link "@vestra-player/sdk/testing"!TestHost.selectTab}() | Simulate the user clicking a sidebar tab: `plugin`'s panel (the plugin under test's `manifestId`, or one of `TestHost.mountOther`) becomes the current tab. |
| {@link "@vestra-player/sdk/testing"!TestHost.videoView} | The display layer (`plugin.video.view()`): who owns it (this plugin is `manifestId`) and the values the player holds. |
| {@link "@vestra-player/sdk/testing"!TestHost.setVideoViewOwner}() | Simulate another plugin taking the display layer first (the plugin's `video.view()` then fails with `conflict`), or, with `null`, releasing it (values reset to the defaults). |
| {@link "@vestra-player/sdk/testing"!TestHost.videoRender} | The render options (`plugin.video.render()`): who owns them, the values the player holds, and whether it renders on the GPU (`gpu: false` is software rendering, where every `set` fails with `unsupported`). |
| {@link "@vestra-player/sdk/testing"!TestHost.setVideoRenderOwner}() | Simulate another plugin owning the render options (the plugin's `video.render()` then fails with `conflict`), or, with `null`, releasing them (values reset to the defaults). |
| {@link "@vestra-player/sdk/testing"!TestHost.failVideoRender}() | What the player pushes when mpv cannot compile a shader (code `failed`) or switches to software rendering (`unsupported`, which also sets `videoRender.gpu` to false and `rendering.reason` to `window-fallback` with `message`). |
| {@link "@vestra-player/sdk/testing"!TestHost.videoShaders} | The shader channel (`plugin.video.shaders(id)`): the lists the player holds for this plugin's handles by id (the real paths, after following links), and how many shaders other plugins hold, which count against `VIDEO_PROCESSING_LIMITS``.shaders` (`limit`). |
| {@link "@vestra-player/sdk/testing"!TestHost.fileRoots} | Where the plugin's own files may be: its package directory and its data directory (`startPlugin` sets both when the list is still empty). |
| {@link "@vestra-player/sdk/testing"!TestHost.failVideoShaders}() | What the player pushes to a shader handle when mpv cannot compile a shader (code `failed`; the player cannot tell whose shader failed, so every handle with shaders hears it) or the player switches to software rendering (`unsupported`; use `TestHost.failVideoRender`, which also tells the handles). |
| {@link "@vestra-player/sdk/testing"!TestHost.previousCrash} | Play a run after an abnormal end with plugin shaders on: while set, a non-empty `video.shaders` list and a render options `set` with a non-empty `shaders` list are refused with `previous-crash` and this message; clearing still works. |
| {@link "@vestra-player/sdk/testing"!TestHost.processing} | The player's processing (filter) state. |
| {@link "@vestra-player/sdk/testing"!TestHost.subtitles} | The player's subtitle state: tracks, selection, style layers, fonts and loaded resources. |
| {@link "@vestra-player/sdk/testing"!TestHost.uploads} | Subtitle uploads in progress, by upload id. |
| {@link "@vestra-player/sdk/testing"!TestHost.snapshots} | Snapshots taken with `media.capture`, by snapshot id. |
| {@link "@vestra-player/sdk/testing"!TestHost.exports} | Every `jobs.start` request (`kind`, `destination`, `quality`, …), newest last: a snapshot's (`snapshotId`) or, since 1.7.8, an export of remembered files' parts (`parts`), whose job runs half way through its middle part (`progress.part`), then completes (a copy's destination gets the extension of its container). |
| {@link "@vestra-player/sdk/testing"!TestHost.mediaFiles} | Local files as the fake player knows them, by path, for `plugin.media.sources` and exports of their parts. |
| {@link "@vestra-player/sdk/testing"!TestHost.sourceOpens} | Every `plugin.media.sources.open` the plugin made (its token and start, 0 for the beginning), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.sourceReferences} | The plugin's source references (`plugin.media.sources`) by token: the path each stands for. |
| {@link "@vestra-player/sdk/testing"!TestHost.jobs} | Export jobs by job id. |
| {@link "@vestra-player/sdk/testing"!TestHost.exportFailure} | Set it to make every running export end `failed` with this error on its next state query, as the player reports one (`unsupported` for a stream copy it cannot make, `export-failed` otherwise); `null` (the default) completes them. |
| {@link "@vestra-player/sdk/testing"!TestHost.producerTransport} | `openStream`'s transport: a local stream (a Unix socket on macOS and Linux, a named pipe on Windows) or, with `"tcp"`, loopback TCP where the plugin must send the token first, as the player on Windows answers. |
| {@link "@vestra-player/sdk/testing"!TestHost.producers} | Generated streams (`player.openStream`) by producer id: the fake player end of each frame connection. |
| {@link "@vestra-player/sdk/testing"!TestHost.resolvers} | Registered source resolvers (`resolvers.add`) by id: their declarations. |
| {@link "@vestra-player/sdk/testing"!TestHost.otherResolvers} | Resolvers other plugins hold, as `resolvers.add` declares them plus the holder's id: a registration of this plugin that claims one of their extensions (or scheme + host pairs) is refused with `conflict`, which does not fail activation, like the player. |
| {@link "@vestra-player/sdk/testing"!TestHost.fileTypes}() | The list `resolvers.fileTypes` carries: the extensions of this plugin's file resolvers and of `TestHost.otherResolvers`, sorted, each once. |
| {@link "@vestra-player/sdk/testing"!TestHost.updateFileTypes}() | Push `resolvers.fileTypes` when `TestHost.fileTypes` changed: called after this plugin's resolvers come and go; call it yourself after changing `TestHost.otherResolvers` (another plugin started or stopped). |
| {@link "@vestra-player/sdk/testing"!TestHost.resolutions} | File opens waiting for this plugin's file resolver (`extensions`), by request id: the path and how it was opened. |
| {@link "@vestra-player/sdk/testing"!TestHost.dialogAnswers} | Answers for `dialogs.open` (paths, `null` = cancelled) and `dialogs.confirm` (`{ confirmed, checked }`), consumed in order. |
| {@link "@vestra-player/sdk/testing"!TestHost.confirms} | Every `dialogs.confirm` request (its options), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.mainWindow} | The main window as the player would show it. |
| {@link "@vestra-player/sdk/testing"!TestHost.mpv} | The mpv pass-through (`plugin.mpv`), without an mpv: `commands` are the commands the plugin sent, in order (they do nothing else); `properties` is what `get` answers and `set` writes (a property not in it fails `backend`, "mpv: property not found"); `labels` are the owners of filter labels by `"vf/<label>"` or `"af/<label>"` (preset another plugin's id to test `conflict`); `observed` are the properties the plugin observes. |
| {@link "@vestra-player/sdk/testing"!TestHost.setMpvProperty}() | Simulate mpv changing a property: store the value and send it to the plugin if it observes the property (`plugin.mpv.observe`). |
| {@link "@vestra-player/sdk/testing"!TestHost.secrets} | The player's secret store for this plugin: name → value. |
| {@link "@vestra-player/sdk/testing"!TestHost.sessionStorage} | `plugin.storage.session`: key → value, as the player keeps them. |
| {@link "@vestra-player/sdk/testing"!TestHost.systemInfo} | What `plugin.app.system()` reports. |
| {@link "@vestra-player/sdk/testing"!TestHost.app} | What `plugin.app` reports. |
| {@link "@vestra-player/sdk/testing"!TestHost.rendering} | The player's rendering choice behind `plugin.rendering`. |
| {@link "@vestra-player/sdk/testing"!TestHost.upscaling} | The GPU's video upscaler behind `plugin.video.upscaling`, answered as the player would: - `state()` and `set(true)` set `checked` (the player's one GPU check; a plugin that should not wake the GPU while it starts can assert it is still `false`) and report `available` from `reason` (`null`: it works), this plugin's `enabled`, and `requested` with `factor` while enabled, available and `factor` is above 1. |
| {@link "@vestra-player/sdk/testing"!TestHost.upscalingDecoding}() | Make the upscaler's reason `decoding` with `cause`, with the player's message, and set `upscaling.hwdecCurrent` to match (`d3d11va-copy`, `no`, `nvdec`). |
| {@link "@vestra-player/sdk/testing"!TestHost.upscalingChanged}() | Send `video.upscaling.changed` with the state `TestHost.upscaling` describes now (without `enabled`), as the player does when it changes; a plugin listening with `plugin.video.upscaling.onChange` receives it. |
| {@link "@vestra-player/sdk/testing"!TestHost.motion} | Motion smoothing behind `plugin.video.motion`, answered as the player would: - `state()` and `set()` report this plugin's `mode`, the reasons `double` and `display` (`null`: that mode works) and `active`: the mode while its reason is `null` and `sourceFps` is known, else `off`; while active, `searchMode` (`performance` with `performance`) and `outputFps` (`outputFps`, or twice `sourceFps`). |
| {@link "@vestra-player/sdk/testing"!TestHost.motionChanged}() | Send `video.motion.changed` with the state `TestHost.motion` describes now (without `mode`), as the player does when it changes; a plugin listening with `plugin.video.motion("amd").onChange` receives it. |
| {@link "@vestra-player/sdk/testing"!TestHost.chapters} | What `player.chapters()` lists while media is ready. |
| {@link "@vestra-player/sdk/testing"!TestHost.dataDirectory} | `plugin.dataDirectory`: a fresh empty temporary directory, removed with the host on `stop()`. |
| {@link "@vestra-player/sdk/testing"!TestHost.manifestId} | The manifest id of the plugin under test (set by `startPlugin`; `"test.plugin"` by default). |
| {@link "@vestra-player/sdk/testing"!TestHost.stepSeek} | The `player.setStepSeek` value in effect (default 5). |
| {@link "@vestra-player/sdk/testing"!TestHost.stepSeekKeyframes} | The `player.setStepSeek` `keyframes` in effect (default `false`). |
| {@link "@vestra-player/sdk/testing"!TestHost.keyframes} | Test data: the keyframe times (seconds, ascending) of the current source, for keyframe step seeks. |
| {@link "@vestra-player/sdk/testing"!TestHost.coreSeeks} | Every step seek the core ran (`seek-backward` / `seek-forward`, from a key, the menu or `host.run`), newest last: the step, whether it went to a keyframe, and where it landed. |
| {@link "@vestra-player/sdk/testing"!TestHost.seeks} | Every seek a plugin submitted (`player.seek`, `Scrub.seek`), newest last, with the mode it asked for. |
| {@link "@vestra-player/sdk/testing"!TestHost.steps} | Every `player.step` and core frame step, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.coreRuns} | Every core action run (`host.run`, a core command, a pressed core binding), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.builtin} | The plugin is built into the player (`startPlugin`'s `builtin`). |
| {@link "@vestra-player/sdk/testing"!TestHost.paletteLead} | The palette's lead row as the plugin last set it (`palette.lead.set`, wire form), `null` without one. |
| {@link "@vestra-player/sdk/testing"!TestHost.runPaletteLead}() | Simulate the user activating the palette's lead row: Enter (`keep`: Shift+Enter) with `query` typed, or Enter on the status row (`status`). |
| {@link "@vestra-player/sdk/testing"!TestHost.coreAction}() | One of the 14 core actions (`play-pause`, `stop`, `seek-forward`, ...) that the test host registers like the player, as `host/<id>`. |
| {@link "@vestra-player/sdk/testing"!TestHost.handle}() | Replace the host's behaviour for one wire method until `TestHost.reset`. |
| {@link "@vestra-player/sdk/testing"!TestHost.reset}() | Restore the default behaviour of a method replaced with `TestHost.handle`. |
| {@link "@vestra-player/sdk/testing"!TestHost.emit}() | Deliver a host event to the plugin. |
| {@link "@vestra-player/sdk/testing"!TestHost.setSource}() | Change the source facts and broadcast them, as if the player's state changed (the user paused, playback reached the end, a file finished loading). |
| {@link "@vestra-player/sdk/testing"!TestHost.setMainWindow}() | Simulate the user changing the main window (resizing, maximizing or restoring it, entering or leaving fullscreen, closing the picture-in-picture window) and broadcast it. |
| {@link "@vestra-player/sdk/testing"!TestHost.popSidebar}() | The pointer reached the right edge in fullscreen (`true`) or left the popped-out columns (`false`): the attached sidebar and the adjust column, those switched on, pop out or collapse (reference §6.3). |
| {@link "@vestra-player/sdk/testing"!TestHost.openElsewhere}() | Simulate another plugin (or the user) opening a source: a new `sourceId`, then the given phase. |
| {@link "@vestra-player/sdk/testing"!TestHost.failStream}() | Simulate a generated stream failing in the player (its audio device lost, its frame connection broken), like the player: the source fails with `message` (`phase: "error"`) and the producer is retired at once. |
| {@link "@vestra-player/sdk/testing"!TestHost.press}() | Press a binding like the host's table would: panel-focus bindings first when `panel` is true, then global ones; within a scope the earliest registration first (the player's own commands before the plugin's), as the conflict rule orders them. |
| {@link "@vestra-player/sdk/testing"!TestHost.conflicts} | Bindings declared by more than one command, each as `[binding, winner, ...ignored]` (command ids; core actions as `host/<id>`). |
| {@link "@vestra-player/sdk/testing"!TestHost.rebind}() | Change the keys of one of the plugin's commands, or of one of the player's core commands by its `host/<id>`, as the user does in Keyboard Shortcuts: `inputs` replaces its keys (`[]` clears them, as Ignore Default Shortcuts does for every default), `null` gives it its own defaults back. |
| {@link "@vestra-player/sdk/testing"!TestHost.bindings} | The binding overlay `plugin.bindings.set` writes (`"<plugin>/<command>"` to inputs; preset it to simulate saved overrides). |
| {@link "@vestra-player/sdk/testing"!TestHost.packages} | What `packages.list` reports; `setEnabled`, `uninstall` and `install` update it. |
| {@link "@vestra-player/sdk/testing"!TestHost.packageCalls} | Every `packages.setEnabled` / `uninstall` / `install`, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.candidates} | Packages `validate` and `validateArchive` accept: path (directory or `.vxp` file) → its manifest. |
| {@link "@vestra-player/sdk/testing"!TestHost.installKeepsDisabled} | Which install rule `packages.install` plays. |
| {@link "@vestra-player/sdk/testing"!TestHost.remoteImages} | Remote images (`plugin.ui.markdown`, `plugin.ui.remoteImage`): address → a local PNG or JPEG file served for it, or `null` for a failing download. |
| {@link "@vestra-player/sdk/testing"!TestHost.markdown}() | The Markdown document a value holds (its wire form read back), or `null` when the value is not one. |
| {@link "@vestra-player/sdk/testing"!TestHost.audioDevices} | What `player.audioDevices()` lists. |
| {@link "@vestra-player/sdk/testing"!TestHost.setPackages}() | Replace the plugin list and push `packages.changed` (another plugin started, stopped, was installed or removed). |
| {@link "@vestra-player/sdk/testing"!TestHost.step}() | Simulate another plugin calling `player.next()` / `previous()`: the host asks this plugin's sequence provider. |
| {@link "@vestra-player/sdk/testing"!TestHost.command}() | The plugin's command with this local id. |
| {@link "@vestra-player/sdk/testing"!TestHost.barButtons} | The plugin's bottom-bar buttons (`CommandOptions.button`) as the player shows them: at most one, the first declared (`BAR_BUTTON_LIMITS`; a later one stays a menu item only). |
| {@link "@vestra-player/sdk/testing"!TestHost.window}() | The plugin's tool window with this id (by default the file name without extension: `ui/picture.slint` → `picture`). |
| {@link "@vestra-player/sdk/testing"!TestHost.mounted}() | The plugin's mounted panel (bottom bar, sidebar, adjust column or backdrop): the one in `slot`, or without it the only one (a plugin mounts one panel per slot; with several, name the slot). |
| {@link "@vestra-player/sdk/testing"!TestHost.sent}() | The parameters of every request of one wire method, oldest first. |
| {@link "@vestra-player/sdk/testing"!TestHost.settle}() | Wait until no request is in flight (and the SDK's follow-up passes ran), and at least `ms` milliseconds have passed so that timers due by then fired. |
| {@link "@vestra-player/sdk/testing"!TestHost.close}() | Close the fake stream servers and delete the host's temporary directories. |
| {@link "@vestra-player/sdk/testing"!TestHost.keepsRunning} | Why the player would keep this plugin running while nothing uses it (lazy activation), one line per reason: an event it listens to that is not one the player wakes it for (with what listens and where it was added), its panel in the bottom bar or the backdrop, its open windows (these as the player's log says them), and its sidebar tab while that is the current tab. |

<!-- /generated -->
