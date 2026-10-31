---
title: Test host
description: What startPlugin takes and returns, how TestHost simulates the user and the player, what it records, and every TestHost member.
---

# Test host

`@vestra-player/sdk/testing` runs a plugin against {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, an in-memory player that speaks the real protocol, so the SDK's own logic (revisions, conditional commits, recovery after lost replies) runs as it does in the player. How to write tests with it is in [Test a plugin](../how-to/testing.md); every member's details are in the {@link "@vestra-player/sdk/testing" | @vestra-player/sdk/testing} reference.

## What it simulates and what it does not

- **The player side is simplified**: there is no decoding, no Slint rendering and no native window. A window is a record of its properties and callbacks, and a source is a set of facts the test chooses.
- **It does not compile Slint files.** Check them by running the plugin in the player (`--plugin <dir>`).
- **It checks what the player checks**: the command limits, the property value limits and the menu ids are enforced with the player's numbers, and processing values are validated with the player's ranges (an out-of-range `filter.set` ends in `failed` with `invalid`). Export jobs advance one step on every state query (`queued`, `running`, `completed`).
- **The manifest applies.** {@link "@vestra-player/sdk/testing"!startPlugin | startPlugin} reads `manifest.json` from `directory`, so a call that needs an undeclared capability fails with `capability`, as in the player.

## startPlugin

`startPlugin(activate, options)` resolves with `{ host, plugin, stop }` once activation and every registration made during it are done, and rejects when the player would fail the activation (`activate` throws, or a registration made during it fails, for example with `limit`, `conflict` or `invalid`). `plugin` is the object `activate` received; `stop()` disposes the plugin as when the player stops it (scopes released, stores flushed) and removes the host's temporary files. Each test creates its own host.

| Option | Meaning |
| --- | --- |
| `directory` | The plugin folder with `manifest.json` (from `tests/`: `new URL("..", import.meta.url)`). |
| `host` | A `TestHost` prepared before activation (a preset source, preset data). |
| `dataDirectory` | An existing folder as `plugin.dataDirectory`, to test a restart; by default an empty temporary folder. |
| `sessionStorage` | The values of `plugin.storage.session` an earlier run left (`host.sessionStorage`), to test a restart within one player session. |
| `locale` | The interface language (`"zh-Hans"` loads `locales/zh-Hans.po`). Without it the plugin's own texts show in English as declared and the player's own texts (core action OSD messages, menu titles and reasons) in Simplified Chinese, as in SDK 1.5.8 and older; `"en"` shows the player in English. |
| `id`, `capabilities` | Start without a `manifest.json`. |

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

`press` follows the player's binding table: the panel's bindings first when `panel` is true, then the global ones, the player's own commands before the plugin's. A disabled command lets the key go on to the next command bound to it (SDK 1.5.12, as player 0.4.3). It resolves with what the key did:

| Result | Meaning |
| --- | --- |
| `"ran"` | The first enabled command bound to the key ran. |
| `"reason"` | Only disabled commands hold the key, and the first one with a `reason` showed it on the OSD (it is in `host.osd`) and ate the key. |
| `"passed"` | Only disabled commands without a reason hold it; the key goes on to the focused control and nothing runs. |

It rejects when nothing is bound to the key or the command it would run is busy. User overrides preset in `host.bindings.overlay` apply, and `host.conflicts` lists keys that several commands declare.

## Simulating the player

- `host.openElsewhere(path, phase?)`: the user or another plugin opened a source (a new source id, then `phase`, `"ready"` by default). Calls the plugin made against the old state now fail with `stale`.
- `host.setSource({ phase, position, duration, paused, audioTracks, … })`: the state changed (the user paused, playback reached the end). Before `startPlugin`, it presets the source the plugin finds at activation.
- `host.setMainWindow({ fullscreen, videoArea })`, `host.setAppearance(theme)`, `host.setPackages(list)`: the main window, the colour scheme, the installed plugins changed.
- Preset data the player would return: `host.stats` (`player.stats()`), `host.chapters`, `host.clipboard.text`, `host.secrets`, `host.systemInfo`, `host.rendering` (the GPU or software choice), `host.upscaling`; `host.tools.handle("ffprobe", (args) => ({ stdout }))` makes a tool available and answers its runs.
- `host.handle(method, fn)` replaces the player's answer to one protocol method until `host.reset(method)`. The handler gets the request parameters and returns the reply, or throws: `throw new HostError(code, message)` is a refusal (the plugin's call rejects with that `code`, one of the [error codes](errors.md)); `throw new Error(…)` is a lost reply, and the SDK runs its recovery path. Method names are the protocol's (`"processing.replace"`, `"system.openPath"`, `"clipboard.writeText"`): `host.calls` lists every request in order, which shows the method an action uses, and `host.sent(method)` the parameters of one method's requests.

## Waiting

`await host.settle(ms?)` waits until no request is in flight and the SDK's follow-up update passes ran; with `ms` it also waits that long, so that debounces and timers due by then fire (`host.settle(400)` is past `storage.json`'s 300 ms debounce). `command(id).run()` and `press` already wait. `settle` waits only for calls to the player, not for the plugin's own file reads, child processes or network requests.

## What it records

| Area | Members |
| --- | --- |
| Windows and panels | `host.window(id).props` and `.visible`, `host.mounted().props`; property names are the Slint (kebab-case) names: `canMark` is `can-mark` |
| Commands | `host.command(id).state` (`enabled`, `checked`, `busy`, `reason`), `.declaration` (the English path and bindings as declared), `.display` (the menu as shown, `display.reason` the shown reason) |
| Messages | `host.osd` (every message shown, oldest first), `host.osdPanel`, `host.confirms` and `host.confirmTexts` (confirmation dialogs), `host.fileDialogs` (titles and file names), `host.translate(text, args)` (any text as shown) |
| Playback and processing | `host.source` (`position`, `paused`, `loop`, …), `host.processing`, `host.subtitles`, `host.jobs`, `host.exports` |
| Everything sent | `host.calls`, `host.sent(method)`; `host.system.opened`, `host.clipboard`, `host.tools.calls` for the system services |
| Storage | `host.dataDirectory`, `host.sessionStorage` |

## Every member

<!-- generated:test-host -->

| Member | What it is |
| --- | --- |
| {@link "@vestra-player/sdk/testing"!TestHost.calls} | Every request the plugin sent, in order: `{ method, params }`. |
| {@link "@vestra-player/sdk/testing"!TestHost.subscriptions} | The host events the plugin subscribed to (needs `events` etc.). |
| {@link "@vestra-player/sdk/testing"!TestHost.source} | The player's source facts (phase, position, duration, paused, rate, audio tracks, loop, ...). |
| {@link "@vestra-player/sdk/testing"!TestHost.windows} | Tool windows by id (see `TestHost.window`). |
| {@link "@vestra-player/sdk/testing"!TestHost.panel} | The plugin's mounted panel (bottom bar, sidebar or backdrop), or `null`. |
| {@link "@vestra-player/sdk/testing"!TestHost.commands} | The plugin's commands by local id (see `TestHost.command`). |
| {@link "@vestra-player/sdk/testing"!TestHost.coreCommands} | The player's 14 core actions (`host/<id>`), kept apart from the plugin's `commands`. |
| {@link "@vestra-player/sdk/testing"!TestHost.layout} | Both panel positions as the player reports them (`null` while no panel is mounted there). |
| {@link "@vestra-player/sdk/testing"!TestHost.osd} | Every `osd.show` text as the player shows it (translated with the plugin's catalog and formatted with its args), newest last. |
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
| {@link "@vestra-player/sdk/testing"!TestHost.setTimelineLayer}() | Simulate another plugin publishing its timeline layer (or clearing it with `[]`); pushes `timeline.changed` when the plugin subscribed. |
| {@link "@vestra-player/sdk/testing"!TestHost.images} | Runtime images written to views (`plugin.ui.image`, `plugin.ui.remoteImage`), whole values and (SDK 1.5.19) images nested in rows, newest last. |
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
| {@link "@vestra-player/sdk/testing"!TestHost.processing} | The player's processing (filter) state. |
| {@link "@vestra-player/sdk/testing"!TestHost.subtitles} | The player's subtitle state: tracks, selection, style layers, fonts and loaded resources. |
| {@link "@vestra-player/sdk/testing"!TestHost.uploads} | Subtitle uploads in progress, by upload id. |
| {@link "@vestra-player/sdk/testing"!TestHost.snapshots} | Snapshots taken with `media.capture`, by snapshot id. |
| {@link "@vestra-player/sdk/testing"!TestHost.exports} | Every `jobs.start` request (`kind`, `destination`, `quality`, …), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.jobs} | Export jobs by job id. |
| {@link "@vestra-player/sdk/testing"!TestHost.producerTransport} | `openStream`'s transport: a local stream (a Unix socket on macOS and Linux, a named pipe on Windows) or, with `"tcp"`, loopback TCP where the plugin must send the token first, as the player on Windows answers. |
| {@link "@vestra-player/sdk/testing"!TestHost.producers} | Generated streams (`player.openStream`) by producer id: the fake player end of each frame connection. |
| {@link "@vestra-player/sdk/testing"!TestHost.resolvers} | Registered source resolvers (`resolvers.add`) by id: their declarations. |
| {@link "@vestra-player/sdk/testing"!TestHost.otherResolvers} | Resolvers other plugins hold, as `resolvers.add` declares them plus the holder's id: a registration of this plugin that claims one of their extensions (or scheme + host pairs) is refused with `conflict`, which does not fail activation, like the player. |
| {@link "@vestra-player/sdk/testing"!TestHost.fileTypes}() | What `plugin.resolvers.fileTypes` reports: the extensions of this plugin's file resolvers and of `TestHost.otherResolvers`, sorted, each once. |
| {@link "@vestra-player/sdk/testing"!TestHost.updateFileTypes}() | Push `resolvers.fileTypes` when `TestHost.fileTypes` changed: called after this plugin's resolvers come and go; call it yourself after changing `TestHost.otherResolvers` (another plugin started or stopped). |
| {@link "@vestra-player/sdk/testing"!TestHost.resolutions} | File opens waiting for this plugin's file resolver (`extensions`), by request id: the path and how it was opened. |
| {@link "@vestra-player/sdk/testing"!TestHost.dialogAnswers} | Answers for `dialogs.open` (paths, `null` = cancelled) and `dialogs.confirm` (`{ confirmed, checked }`), consumed in order. |
| {@link "@vestra-player/sdk/testing"!TestHost.confirms} | Every `dialogs.confirm` request (its options), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.mainWindow} | The main window as the player would show it. |
| {@link "@vestra-player/sdk/testing"!TestHost.secrets} | The player's secret store for this plugin: name → value. |
| {@link "@vestra-player/sdk/testing"!TestHost.sessionStorage} | `plugin.storage.session`: key → value, as the player keeps them. |
| {@link "@vestra-player/sdk/testing"!TestHost.systemInfo} | What `plugin.app.system()` reports. |
| {@link "@vestra-player/sdk/testing"!TestHost.app} | What `plugin.app` reports. |
| {@link "@vestra-player/sdk/testing"!TestHost.rendering} | The player's rendering choice behind `plugin.rendering` (player 0.5.13). |
| {@link "@vestra-player/sdk/testing"!TestHost.upscaling} | The GPU's video upscaler behind `plugin.video.upscaling` (player 0.5.16), answered as the player would: - `state()` and `set(true)` set `checked` (the player's one GPU check; a plugin that should not wake the GPU while it starts can assert it is still `false`) and report `available` from `reason` (`null`: it works), this plugin's `enabled`, and `requested` with `factor` while enabled, available and `factor` is above 1. |
| {@link "@vestra-player/sdk/testing"!TestHost.chapters} | What `player.chapters()` lists while media is ready. |
| {@link "@vestra-player/sdk/testing"!TestHost.dataDirectory} | `plugin.dataDirectory`: a fresh empty temporary directory, removed with the host on `stop()`. |
| {@link "@vestra-player/sdk/testing"!TestHost.manifestId} | The manifest id of the plugin under test (set by `startPlugin`; `"test.plugin"` by default). |
| {@link "@vestra-player/sdk/testing"!TestHost.stepSeek} | The `player.setStepSeek` value in effect (default 5). |
| {@link "@vestra-player/sdk/testing"!TestHost.stepSeekKeyframes} | The `player.setStepSeek` `keyframes` in effect (default `false`, SDK 1.5.19). |
| {@link "@vestra-player/sdk/testing"!TestHost.keyframes} | Test data: the keyframe times (seconds, ascending) of the current source, for keyframe step seeks. |
| {@link "@vestra-player/sdk/testing"!TestHost.coreSeeks} | Every step seek the core ran (`seek-backward` / `seek-forward`, from a key, the menu or `host.run`), newest last: the step, whether it went to a keyframe, and where it landed. |
| {@link "@vestra-player/sdk/testing"!TestHost.seeks} | Every seek a plugin submitted (`player.seek`, `Scrub.seek`), newest last, with the mode it asked for. |
| {@link "@vestra-player/sdk/testing"!TestHost.steps} | Every `player.step`, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.coreRuns} | Every core action run (`host.run`, a core command, a pressed core binding), newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.coreAction}() | One of the 14 core actions (`play-pause`, `stop`, `seek-forward`, ...) that the test host registers like the player, as `host/<id>`. |
| {@link "@vestra-player/sdk/testing"!TestHost.handle}() | Replace the host's behaviour for one wire method until `TestHost.reset`. |
| {@link "@vestra-player/sdk/testing"!TestHost.reset}() | Restore the default behaviour of a method replaced with `TestHost.handle`. |
| {@link "@vestra-player/sdk/testing"!TestHost.emit}() | Deliver a host event to the plugin. |
| {@link "@vestra-player/sdk/testing"!TestHost.setSource}() | Change the source facts and broadcast them, as if the player's state changed (the user paused, playback reached the end, a file finished loading). |
| {@link "@vestra-player/sdk/testing"!TestHost.setMainWindow}() | Simulate the user changing the main window (resizing it, entering or leaving fullscreen, closing the picture-in-picture window) and broadcast it. |
| {@link "@vestra-player/sdk/testing"!TestHost.popSidebar}() | The pointer reached the right edge in fullscreen (`true`) or left the popped-out sidebar (`false`): the attached sidebar pops out or collapses (reference §6.3). |
| {@link "@vestra-player/sdk/testing"!TestHost.openElsewhere}() | Simulate another plugin (or the user) opening a source: a new `sourceId`, then the given phase. |
| {@link "@vestra-player/sdk/testing"!TestHost.failStream}() | Simulate a generated stream failing in the player (its audio device lost, its frame connection broken), like the player: the source fails with `message` (`phase: "error"`) and the producer is retired at once. |
| {@link "@vestra-player/sdk/testing"!TestHost.press}() | Press a binding like the host's table would: panel-focus bindings first when `panel` is true, then global ones; within a scope the earliest registration first (the player's own commands before the plugin's), as the conflict rule orders them. |
| {@link "@vestra-player/sdk/testing"!TestHost.conflicts} | Bindings declared by more than one command, each as `[binding, winner, ...ignored]` (command ids; core actions as `host/<id>`). |
| {@link "@vestra-player/sdk/testing"!TestHost.bindings} | The binding overlay `plugin.bindings.set` writes (`"<plugin>/<command>"` to inputs; preset it to simulate saved overrides). |
| {@link "@vestra-player/sdk/testing"!TestHost.packages} | What `packages.list` reports; `setEnabled`, `uninstall` and `install` update it. |
| {@link "@vestra-player/sdk/testing"!TestHost.packageCalls} | Every `packages.setEnabled` / `uninstall` / `install`, newest last. |
| {@link "@vestra-player/sdk/testing"!TestHost.candidates} | Packages `validate` and `validateArchive` accept: path (directory or `.vxp` file) → its manifest. |
| {@link "@vestra-player/sdk/testing"!TestHost.remoteImages} | Remote images (`plugin.ui.markdown`, `plugin.ui.remoteImage`): address → a local PNG or JPEG file served for it, or `null` for a failing download. |
| {@link "@vestra-player/sdk/testing"!TestHost.markdown}() | The Markdown document a value holds (its wire form read back), or `null` when the value is not one. |
| {@link "@vestra-player/sdk/testing"!TestHost.audioDevices} | What `player.audioDevices()` lists. |
| {@link "@vestra-player/sdk/testing"!TestHost.setPackages}() | Replace the plugin list and push `packages.changed` (another plugin started, stopped, was installed or removed). |
| {@link "@vestra-player/sdk/testing"!TestHost.step}() | Simulate another plugin calling `player.next()` / `previous()`: the host asks this plugin's sequence provider. |
| {@link "@vestra-player/sdk/testing"!TestHost.command}() | The plugin's command with this local id. |
| {@link "@vestra-player/sdk/testing"!TestHost.barButtons} | The plugin's bottom-bar buttons (`CommandOptions.button`) as the player shows them: at most one, the first declared (`BAR_BUTTON_LIMITS`; a later one stays a menu item only). |
| {@link "@vestra-player/sdk/testing"!TestHost.window}() | The plugin's tool window with this id (by default the file name without extension: `ui/picture.slint` → `picture`). |
| {@link "@vestra-player/sdk/testing"!TestHost.mounted}() | The plugin's mounted panel (bottom bar, sidebar or backdrop). |
| {@link "@vestra-player/sdk/testing"!TestHost.sent}() | The parameters of every request of one wire method, oldest first. |
| {@link "@vestra-player/sdk/testing"!TestHost.settle}() | Wait until no request is in flight (and the SDK's follow-up passes ran), and at least `ms` milliseconds have passed so that timers due by then fired. |
| {@link "@vestra-player/sdk/testing"!TestHost.close}() | Close the fake stream servers and delete the host's temporary directories. |

<!-- /generated -->
