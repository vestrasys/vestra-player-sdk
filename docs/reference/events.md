---
title: Events
description: Every player event a plugin can listen to by name, with its payload, the SDK members that listen to it, whether it wakes a stopped plugin and whether it waits for `plugin.player.subscribe()`.
---

# Events

The player sends an event as one JSON line `{"event": name, "data": …}`, only to plugins that subscribed to that name. The SDK subscribes for you when a member follows the player's state (`plugin.player.state`, an `onChange` listener). {@link "@vestra-player/sdk"!Player.on | plugin.player.on(event, listener)} listens to a name directly, typed by {@link "@vestra-player/sdk"!EventPayloads | EventPayloads}; {@link "@vestra-player/sdk"!Wire.on | plugin.wire.on} does the same untyped.

- **Payload**: the player's wire shape, not the SDK's view of it (`source.state` says `stamp.generation` where `PlayerState` says `sourceId`). The three source events, `source.opening`, `source.ready` and `source.ended` ({@link "@vestra-player/sdk"!SourceEvent | SourceEvent}, typed by {@link "@vestra-player/sdk"!SourceEventPayloads | SourceEventPayloads}), are the exception: their `state` is the SDK's `PlayerState`. Each is sent once per thing that happened to a source; for one source the order is `opening`, `ready` (none when it could not be opened), `ended`, and a replaced source's `ended` comes before the next one's `opening`.
- **SDK members that listen to it**: from the SDK's request table.
- **Wakes a stopped plugin**: the player starts a plugin on standby for this event, so a listener of it does not keep the plugin running ([Keep a command's state without keeping the plugin running](../guides/command-state.md)); a listener of any other event does.
- **After `subscribe()` only**: "yes": it reaches the plugin only once the plugin called {@link "@vestra-player/sdk"!Player.subscribe | plugin.player.subscribe()}; until then a listener of it never runs (a warning in the log says so once).

<!-- generated:events -->

| Event | Payload | SDK members that listen to it | Wakes a stopped plugin | After `subscribe()` only |
| --- | --- | --- | --- | --- |
| `source.state` | `SourceState`: The player's source: phase, position, rate, volume, its stamp (what `PlayerState` is made from). | {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange}, {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter} | no | yes |
| `playback.backend` | `{ currentSession: number; event: string }`: A playback backend event: the backend's name for it (`event`) and the source generation it belongs to. | none: `Player.on` only | no | yes |
| `window.state` | `WindowFacts`: The main window: fullscreen, maximized, video area, picture-in-picture (what `WindowState` is made from). | {@linkcode "@vestra-player/sdk"!MainWindow.onChange MainWindow.onChange}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange} | no | yes |
| `packages.changed` | `PackageInfo[]`: Every installed plugin, after an install, an uninstall or a change of one. | {@linkcode "@vestra-player/sdk"!Packages.onChange Packages.onChange} | yes | no |
| `bindings.changed` | `null`: A key binding changed somewhere; read them again with `plugin.bindings.list()`. | {@linkcode "@vestra-player/sdk"!Bindings.onChange Bindings.onChange} | yes | no |
| `commands.keys` | `CommandKeys`: The key labels of this plugin's own commands, with the binding table's revision. | {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys} | yes | no |
| `timeline.changed` | `WireTimeline`: Every timeline mark and range, after any plugin or the player changed one. | none: `Player.on` only | no | yes |
| `appearance.changed` | `{ theme: string; language?: string }`: The palette changed (`theme`), or the interface language the user saved (`language`; the oldest players send no language). | none: `Player.on` only | yes | yes |
| `resolvers.fileTypes` | `{ fileTypes: string[] }`: The file extensions the plugins' file resolvers claim now. | none: `Player.on` only | yes | yes |
| `video.upscaling.changed` | `Omit<WireUpscalingState, "enabled">`: The AI upscaling state, without this plugin's own `enabled`. | {@linkcode "@vestra-player/sdk"!VideoUpscaling.onChange VideoUpscaling.onChange} | no | no |
| `video.motion.changed` | `Omit<WireMotionState, "mode">`: Motion smoothing's state, without this plugin's own `mode`. | {@linkcode "@vestra-player/sdk"!VideoMotion.onChange VideoMotion.onChange} | no | no |
| `source.opening` | `{ state: PlayerState; previous: { sourceId: number } \| null }`: A new source starts to open (also the same file again, and `Player.restart`). `state` is the player's state at that moment, as a `PlayerState` (pass it as `ifCurrent` or to `Player.isCurrent`); `previous` names the source that was open before it, `null` when nothing was. | none: `Player.on` only | yes | no |
| `source.ready` | `{ state: PlayerState }`: The source is loaded: its duration, tracks and seekability are known. Once per opening, after its `source.opening`. | none: `Player.on` only | yes | no |
| `source.ended` | `{ state: PlayerState; reason: "natural" \| "stopped" \| "replaced" \| "error" \| "quit"; error?: string }`: A source left playback: it played to its end (`natural`), was closed (`stopped`), another source took its place (`replaced`), it could not be played (`error`, with the failure text in `error`), or the player quits (`quit`, sent only to a plugin that is running then). `state` is **that** source's last state, with its last position, not the player's current one. | none: `Player.on` only | yes | no |

<!-- /generated -->

Events the player sends without a subscription (`commands.execute`, `ui.callback`, `ui.closed`, and `palette.lead` to the plugin that holds the palette's lead row, which wakes a stopped plugin: {@link "@vestra-player/sdk"!PaletteLead.onRun | PaletteLead.onRun}) are handled by the SDK; {@link "@vestra-player/sdk"!Wire.on | plugin.wire.on} hears them too. Requests are in [Messages](messages.md).
