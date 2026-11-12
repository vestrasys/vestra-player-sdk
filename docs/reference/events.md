---
title: Events
description: Every player event a plugin can listen to by name, with its payload, the SDK members that listen to it, whether it wakes a stopped plugin and the capability it needs.
---

# Events

The player sends an event as one JSON line `{"event": name, "data": …}`, only to plugins that subscribed to that name. The SDK subscribes for you when a member follows the player's state (`plugin.player.state`, an `onChange` listener). {@link "@vestra-player/sdk"!Player.on | plugin.player.on(event, listener)} listens to a name directly, typed by {@link "@vestra-player/sdk"!EventPayloads | EventPayloads}; {@link "@vestra-player/sdk"!Wire.on | plugin.wire.on} does the same untyped.

- **Payload**: the player's wire shape, not the SDK's view of it (`source.state` says `stamp.generation` where `PlayerState` says `sourceId`).
- **SDK members that listen to it**: from the SDK's request table; in parentheses, members that subscribe to it on top of their own request.
- **Wakes a stopped plugin**: the player starts a plugin on standby for this event, so a listener of it does not keep the plugin running ([Keep a command's state without keeping the plugin running](../guides/command-state.md)); a listener of any other event does.
- **Capability**: what the manifest must declare to subscribe; a missing one fails with `capability`.

<!-- generated:events -->

| Event | Payload | SDK members that listen to it | Wakes a stopped plugin | Capability |
| --- | --- | --- | --- | --- |
| `source.state` | `SourceState`: The player's source: phase, position, rate, volume, its stamp (what `PlayerState` is made from). | {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange} ({@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}) | no | `events` |
| `playback.backend` | `{ currentSession: number; event: string }`: A playback backend event: the backend's name for it (`event`) and the source generation it belongs to. | none: `Player.on` only | no | `events` |
| `window.state` | `WindowFacts`: The main window: fullscreen, maximized, video area, picture-in-picture (what `WindowState` is made from). | {@linkcode "@vestra-player/sdk"!MainWindow.onChange MainWindow.onChange}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange} | no | `events` |
| `packages.changed` | `PackageInfo[]`: Every installed plugin, after an install, an uninstall or a change of one (needs no capability). | {@linkcode "@vestra-player/sdk"!Packages.onChange Packages.onChange} | yes | none |
| `bindings.changed` | `null`: A key binding changed somewhere; read them again with `plugin.bindings.list()`. | {@linkcode "@vestra-player/sdk"!Bindings.onChange Bindings.onChange} | yes | `bindings.manage` |
| `commands.keys` | `CommandKeys`: The key labels of this plugin's own commands, with the binding table's revision. | {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys} | yes | `commands` |
| `timeline.changed` | `WireTimeline`: Every timeline mark and range, after any plugin or the player changed one. | none: `Player.on` only | no | `events` |
| `appearance.changed` | `{ theme: string; language?: string }`: The palette changed (`theme`), or the interface language the user saved (`language`; the oldest players send no language). | none: `Player.on` only | yes | `events` |
| `resolvers.fileTypes` | `{ fileTypes: string[] }`: The file extensions the plugins' file resolvers claim now. | none: `Player.on` only | yes | `events` |
| `video.upscaling.changed` | `Omit<WireUpscalingState, "enabled">`: The AI upscaling state, without this plugin's own `enabled`. | {@linkcode "@vestra-player/sdk"!VideoUpscaling.onChange VideoUpscaling.onChange} | no | `video.upscaling` |
| `video.motion.changed` | `Omit<WireMotionState, "mode">`: Motion smoothing's state, without this plugin's own `mode`. | {@linkcode "@vestra-player/sdk"!VideoMotion.onChange VideoMotion.onChange} | no | `video.motion` |

<!-- /generated -->

Events the player sends without a subscription (`commands.execute`, `ui.callback`, `ui.closed`, and `palette.lead` to the plugin that holds the palette's lead row, which wakes a stopped plugin: {@link "@vestra-player/sdk"!PaletteLead.onRun | PaletteLead.onRun}) are handled by the SDK; {@link "@vestra-player/sdk"!Wire.on | plugin.wire.on} hears them too. Requests are in [Messages](messages.md).
