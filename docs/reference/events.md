---
title: Events
description: Every player event a plugin can listen to by name, with its payload, the SDK members that listen to it, whether it wakes a stopped plugin and the capability it needs.
---

# Events

The player tells a plugin about changes with events: one JSON line `{"event": name, "data": …}` per change, sent only to plugins that subscribed to that name (`events.subscribe`). The SDK subscribes for you when you use a member that follows the player's state (`plugin.player.state`, an `onChange` listener) and keeps one subscription per name however many listeners there are. {@link "@vestra-player/sdk"!Player.on | plugin.player.on(event, listener)} listens to one of these names directly, with the payload typed as {@link "@vestra-player/sdk"!EventPayloads | EventPayloads} gives it; {@link "@vestra-player/sdk"!Wire.on | plugin.wire.on} does the same untyped. Which style to use when is in [Three ways to write a plugin](../explanation/three-ways.md).

Columns:

- **Payload**: the type of the data and what it carries. The payloads are the player's wire shapes, not the SDK's views of them (`source.state` names the source `stamp.generation`, where `PlayerState` says `sourceId`); they can gain fields with a player version.
- **SDK members that listen to it**: the members that subscribe to the event, from the SDK's request table (the capability check reads the same table). In parentheses: members that subscribe to it on top of their own request.
- **Wakes a stopped plugin**: a plugin that stands by (see [Idle plugins are stopped](../explanation/plugins.md#idle-plugins-are-stopped)) is started for this event, so a listener of it does not keep the plugin running. A listener of any other event does: the plugin is resident while it listens.
- **Capability**: what the manifest must declare to subscribe; a missing one fails the subscription with `capability`.
- **Introduced in**: the player version that first sent the event. The player's capability table does not record it yet, so the column shows "—"; until it does, compare `plugin.app.version` with the player versions in [Manifest](manifest.md#player-versions) for the member you use.

<!-- generated:events -->

| Event | Payload | SDK members that listen to it | Wakes a stopped plugin | Capability | Introduced in |
| --- | --- | --- | --- | --- | --- |
| `source.state` | `SourceState`: The player's source: phase, position, rate, volume, its stamp (what `PlayerState` is made from). | {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange} ({@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}) | no | `events` | — |
| `playback.backend` | `{ currentSession: number; event: string }`: A playback backend event: the backend's name for it (`event`) and the source generation it belongs to. | none: `Player.on` only | no | `events` | — |
| `window.state` | `WindowFacts`: The main window: fullscreen, maximized, video area, picture-in-picture (what `WindowState` is made from). | {@linkcode "@vestra-player/sdk"!MainWindow.onChange MainWindow.onChange}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange} | no | `events` | — |
| `packages.changed` | `PackageInfo[]`: Every installed plugin, after an install, an uninstall or a change of one (needs no capability). | {@linkcode "@vestra-player/sdk"!Packages.onChange Packages.onChange} | yes | none | — |
| `bindings.changed` | `null`: A key binding changed somewhere; read them again with `plugin.bindings.list()`. | {@linkcode "@vestra-player/sdk"!Bindings.onChange Bindings.onChange} | yes | `bindings.manage` | — |
| `commands.keys` | `CommandKeys`: The key labels of this plugin's own commands, with the binding table's revision. | {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys}, {@linkcode "@vestra-player/sdk"!Commands.onKeysChange Commands.onKeysChange} | yes | `commands` | — |
| `timeline.changed` | `WireTimeline`: Every timeline mark and range, after any plugin or the player changed one. | {@linkcode "@vestra-player/sdk"!Timeline.onChange Timeline.onChange} | no | `events` | — |
| `appearance.changed` | `{ theme: string; language?: string }`: The palette changed (`theme`), or the interface language the user saved (`language`; the oldest players send no language). | {@linkcode "@vestra-player/sdk"!Appearance.onChange Appearance.onChange} | yes | `events` | — |
| `resolvers.fileTypes` | `{ fileTypes: string[] }`: The file extensions the plugins' file resolvers claim now. | {@linkcode "@vestra-player/sdk"!Resolvers.onFileTypesChange Resolvers.onFileTypesChange} | yes | `events` | — |
| `video.upscaling.changed` | `Omit<WireUpscalingState, "enabled">`: The AI upscaling state, without this plugin's own `enabled`. | {@linkcode "@vestra-player/sdk"!VideoUpscaling.onChange VideoUpscaling.onChange} | no | `video.upscaling` | — |

<!-- /generated -->

Events the player sends without a subscription (`commands.execute` when the user picks a command, `ui.callback` from a view, `ui.closed`) are not in this table: the SDK handles them for the members that need them, and {@link "@vestra-player/sdk"!Wire.on | plugin.wire.on} hears them too. Requests by method name are in [Messages](messages.md).
