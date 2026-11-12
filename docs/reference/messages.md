---
title: Messages
description: Every request method of the player's protocol, by capability, with its parameters and result, the errors documented for it and the SDK member that sends it.
---

# Messages

Every request reaches the player as one JSON line `{"id": n, "method": name, "params": {…}}`, answered with `{"id": n, "result": …}` or `{"id": n, "error": {"code", "message"}}`. The typed members send these for you; {@link "@vestra-player/sdk"!Wire.request | plugin.wire.request(method, params)} sends one by name.

**The wire protocol is not semver**: a method can change with a player version, and this table with it. Prefer the member named in the Stability column.

- **Capability**: from the player's own table. "By `event`" or "by `stage`": it depends on that parameter. `vestra-plugin check` reads a literal method name in `plugin.wire.request`.
- **Params** and **Result**: what the SDK's client sends and expects (`?`: optional; "—": none or not read), in the SDK's internal wire types; units and meanings are at the member that sends the method.
- **Errors (documented)**: the codes in the sending members' `@throws` ([Error codes](errors.md)). Any request can also fail with `capability` or `invalid`.
- **Stability**: "SDK member" names the public members that send it (semver); "`plugin.wire` only" means only a direct request reaches it.

A method ending in `.*` stands for the other methods with that prefix. The residency line under each capability says what its calls mean for standby ([Keep a command's state without keeping the plugin running](../guides/command-state.md)).

<!-- generated:messages -->

### `producer.av`

Provide audio and video it generates itself. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `producer.prepare` | `producer.av` | `{ width, height }` | `PreparedProducer` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.state` | `producer.av` | `{ producerId }` | `ProducerState` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.release` | `producer.av` | `{ producerId }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Stream.stop Stream.stop} |
| `producer.ack` | `producer.av` | `{ control }` | `{ status, control }` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.declareInput` | `producer.av` | `{ producerId, keys }` | `ProducerInputState` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.ackInput` | `producer.av` | `{ notice }` | `{ status: "acknowledged"; sequence: number }` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |

### `playback.read`

Read what is playing and the position. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `source.state` | `playback.read` | — | `SourceState` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.state Player.state}, {@linkcode "@vestra-player/sdk"!Player.refresh Player.refresh} |
| `processing.state` | `playback.read` | — | `ProcessingState` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `playback.stats` | `playback.read` | — | `PlaybackStats` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.stats Player.stats} |
| `player.chapters` | `playback.read` | — | `{ sourceId, chapters }` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.chapters Player.chapters} |
| `player.audioDevices` | `playback.read` | — | `{ id: string; name: string }[]` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.audioDevices Player.audioDevices} |
| `timeline.marks` | `playback.read` | — | `WireTimeline` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.marks Timeline.marks}, {@linkcode "@vestra-player/sdk"!Timeline.ranges Timeline.ranges} |

### `playback.control`

Open media, control playback, keep the computer awake. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `playback.set` | `playback.control` | `{ property, value }` | `void` | `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setOutput Player.setOutput} |
| `source.submit` | `playback.control` | `{ operationId, intent }` | `SourceOperation` | `stale`, `replaced`, `invalid`, `aborted`, `busy`, `backend`, `unsupported`, `unavailable`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.open Player.open}, {@linkcode "@vestra-player/sdk"!Player.setPaused Player.setPaused}, {@linkcode "@vestra-player/sdk"!Player.seek Player.seek}, {@linkcode "@vestra-player/sdk"!Player.setRate Player.setRate}, {@linkcode "@vestra-player/sdk"!Player.restart Player.restart}, {@linkcode "@vestra-player/sdk"!Player.close Player.close}, {@linkcode "@vestra-player/sdk"!Player.scrub Player.scrub} |
| `source.operation` | `playback.control` when the manifest declares `playback.control`, otherwise `playback.read` | `{ operationId }` | `SourceOperation` | `stale`, `replaced`, `invalid`, `aborted`, `busy`, `backend`, `unsupported`, `unavailable`, `capability`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Player.open Player.open}, {@linkcode "@vestra-player/sdk"!Player.setPaused Player.setPaused}, {@linkcode "@vestra-player/sdk"!Player.seek Player.seek}, {@linkcode "@vestra-player/sdk"!Player.setRate Player.setRate}, {@linkcode "@vestra-player/sdk"!Player.restart Player.restart}, {@linkcode "@vestra-player/sdk"!Player.close Player.close}, {@linkcode "@vestra-player/sdk"!Player.scrub Player.scrub}, {@linkcode "@vestra-player/sdk"!MediaSources.open MediaSources.open} |
| `audio.addTrack` | `playback.control` | `{ expected?, path, select }` | `SourceAudioTrack` | `invalid`, `unavailable`, `backend`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.addAudioTrack Player.addAudioTrack} |
| `audio.selectTrack` | `playback.control` | `{ expected?, id }` | `void` | `invalid`, `unavailable`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.selectAudioTrack Player.selectAudioTrack} |
| `player.setLoop` | `playback.control` | `{ expected?, loop }` | `void` | `invalid`, `unsupported`, `unavailable`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setLoop Player.setLoop} |
| `player.setAudioDevice` | `playback.control` | `{ id }` | `void` | `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setAudioDevice Player.setAudioDevice} |
| `player.step` | `playback.control` | `{ expected?, unit, direction }` | `void` | `unsupported`, `busy`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.step Player.step} |
| `player.setStepSeek` | `playback.control` | `{ seconds, keyframes? }` | `void` | `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setStepSeek Player.setStepSeek} |
| `power.preventSleep` | `playback.control` | `{ mode }` | `void` | `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Power.preventSleep Power.preventSleep} |
| `sequence.set` | `playback.control` | `{ flags }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Player.provideSequence Player.provideSequence} |
| `sequence.step` | `playback.control` | `{ direction }` | `void` | `unavailable`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.next Player.next}, {@linkcode "@vestra-player/sdk"!Player.previous Player.previous} |

### `source.resolve`

Resolve online video addresses. Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `sourceResolvers.register` | `source.resolve` | `{ id, schemes?, hosts?, extensions? }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.unregister` | `source.resolve` | `{ id }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.respond` | `source.resolve` | `{ requestId, error }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.*` (any other) | `source.resolve` | — | — | — | `plugin.wire` only |

### `events`

Receive playback changes as they happen. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `events.subscribe` | by `event`: `bindings.changed` → `bindings.manage`, `commands.keys` → `commands`, `packages.changed` → none, `video.upscaling.changed` → `video.upscaling`, `video.motion.changed` → `video.motion`; any other: `events` | `{ event, mirror?, why? }` | — | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange}, {@linkcode "@vestra-player/sdk"!MainWindow.onChange MainWindow.onChange}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange}, {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys}, {@linkcode "@vestra-player/sdk"!Packages.onChange Packages.onChange}, {@linkcode "@vestra-player/sdk"!Bindings.onChange Bindings.onChange}, {@linkcode "@vestra-player/sdk"!VideoUpscaling.onChange VideoUpscaling.onChange}, {@linkcode "@vestra-player/sdk"!VideoMotion.onChange VideoMotion.onChange} |
| `events.unsubscribe` | by `event`: `bindings.changed` → `bindings.manage`, `commands.keys` → `commands`, `packages.changed` → none, `video.upscaling.changed` → `video.upscaling`, `video.motion.changed` → `video.motion`; any other: `events` | `{ event }` | — | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.on Player.on}, {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange} |

### `commands`

Add menu commands and shortcuts. Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `commands.register` | `commands` | `{ when?, id, revision, declaration, state }` | `{ revision: number }` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.add Commands.add} |
| `commands.update` | `commands` | `{ when?, id, revision, state }` | `{ revision: number }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Command.set Command.set} |
| `commands.unregister` | `commands` | `{ id }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Command.dispose Command.dispose} |
| `host.run` | `commands` | `{ action, seconds? }` | `void` | `unavailable`, `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Host.run Host.run} |
| `commands.keys` | `commands` | `{}` | `CommandKeys` | — | SDK member: {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys} |

### `ui.window`

Open tool windows. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `ui.open` | `ui.window` | `{ id, file, properties, callbacks }` | `void` | `conflict` | SDK member: {@linkcode "@vestra-player/sdk"!Windows.create Windows.create} |
| `ui.set` | `ui.window` | `{ value?, seq?, more?, id, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Window.set Window.set}, {@linkcode "@vestra-player/sdk"!Window.bind Window.bind} |
| `ui.show` | `ui.window` | `{ id, visible }` | `void` | `capability`, `unavailable`, `host`, `missing`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Window.show Window.show}, {@linkcode "@vestra-player/sdk"!Window.hide Window.hide} |
| `ui.close` | `ui.window` | `{ id }` | `void` | `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Window.close Window.close} |

### `ui.mount`

Show panels in the bottom bar, the sidebar or behind the video. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `ui.mount` | `ui.mount` | `{ slot, file, component, global, title?, properties? }` | `{ status, prepareMs, shellGeneration }` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Panels.mount Panels.mount} |
| `ui.setMount` | `ui.mount` | `{ slot?, value?, seq?, more?, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Panel.set Panel.set}, {@linkcode "@vestra-player/sdk"!Panel.bind Panel.bind} |
| `ui.unmount` | `ui.mount` | `{ slot: MountSlot; } \| undefined` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.dispose Panel.dispose} |
| `ui.interaction` | `ui.mount` | `{ slot?, focused, dragging, popupOpen }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.setInteraction Panel.setInteraction} |
| `ui.menu` | `ui.mount` | `{ slot?, items, x, y }` | `void` | `missing`, `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Panel.showMenu Panel.showMenu} |
| `layout.state` | `ui.mount` | — | `{ bottom, sidebar, adjust?, backdrop? }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panels.bottom Panels.bottom}, {@linkcode "@vestra-player/sdk"!Panels.sidebar Panels.sidebar}, {@linkcode "@vestra-player/sdk"!Panels.backdrop Panels.backdrop}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange} |
| `layout.set` | `ui.mount` | `{ slot, visible?, detached?, active?, reveal? }` | `void` | `missing`, `unavailable`, `capability`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!PanelSlot.setVisible PanelSlot.setVisible}, {@linkcode "@vestra-player/sdk"!PanelSlot.toggle PanelSlot.toggle}, {@linkcode "@vestra-player/sdk"!Panel.show Panel.show}, {@linkcode "@vestra-player/sdk"!Panel.toggle Panel.toggle} |

### `ui.dialog`

Show file pickers and confirmations. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `dialogs.open` | `ui.dialog` | `{ kind, title?, fileName? }` | `{ cancelled: boolean; paths: string[] }` | `busy`, `unavailable`, `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Dialogs.openFile Dialogs.openFile}, {@linkcode "@vestra-player/sdk"!Dialogs.openFiles Dialogs.openFiles}, {@linkcode "@vestra-player/sdk"!Dialogs.openDirectory Dialogs.openDirectory}, {@linkcode "@vestra-player/sdk"!Dialogs.saveFile Dialogs.saveFile} |
| `dialogs.confirm` | `ui.dialog` | `{ [key: string]: Json; }` | `{ confirmed: boolean; checked: boolean }` | `invalid`, `busy`, `unavailable`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Dialogs.confirm Dialogs.confirm} |

### `plugins.manage`

Install, uninstall and disable other plugins. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `packages.cancel` | `plugins.manage` | `{ operationId }` | `PackageOperation` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageChange.cancel PackageChange.cancel} |
| `packages.install` | `plugins.manage` | `{ enabled?, replace?, source?, token, expectedRevision, requestId }` | `PackageOperation` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.installed` | `plugins.manage` | `{ id }` | `InstalledPackage` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.operation` | `plugins.manage` | `{ operationId }` | `PackageOperation` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.reload` | `plugins.manage` | `{ id }` | `void` | `invalid`, `missing`, `busy`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.reload Packages.reload} |
| `packages.setEnabled` | `plugins.manage` | `{ id, enabled }` | `void` | `invalid`, `missing`, `busy`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.setEnabled Packages.setEnabled} |
| `packages.uninstall` | `plugins.manage` | `{ id, removeData, expectedRevision, requestId }` | `PackageOperation` | `unsupported`, `missing`, `invalid`, `busy`, `revisionConflict`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.uninstall Packages.uninstall} |
| `packages.validate` | `plugins.manage` | `{ directory, apiVersion }` | `PackageValidation` | `host`, `invalid`, `javascript`, `slint`, `reserved`, `versionMismatch`, `disabled`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.validate Packages.validate} |
| `packages.validateArchive` | `plugins.manage` | `{ file }` | `PackageValidation` | `invalid`, `host`, `javascript`, `slint`, `reserved`, `versionMismatch`, `disabled`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.validateArchive Packages.validateArchive} |
| `packages.*` (any other) | `plugins.manage` | — | — | — | `plugin.wire` only |

### `processing.video`

Process the picture (filters, shaders). Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `processing.replace` | by `stage`: `video` → `processing.video`; any other: `processing.audio` | `ProcessingChange` | `ProcessingApplied` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `processing.operation` | by `stage`: `video` → `processing.video`; any other: `processing.audio` | `{ stage, resourceId, revision }` | `ProcessingOperation` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `video.view.set` | `processing.video` | `{ values }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.view} |
| `video.view.release` | `processing.video` | — | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.view} |
| `video.render.set` | `processing.video` | `{ values }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.render} |
| `video.render.release` | `processing.video` | — | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.render} |
| `video.shaders.set` | `processing.video` | `{ id, paths }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.shaders} |

### `processing.audio`

Process the sound. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |

### `subtitles.read`

Read subtitles. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `subtitles.state` | `subtitles.read` | — | `SubtitleState` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.state Subtitles.state}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.refresh Subtitles.refresh} |

### `subtitles.control`

Load and change subtitles. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `subtitles.commit` | `subtitles.control` | `{ operationId, uploadId, sha256, resourceId, revision, expected, inputOrigin?, format?, title?, select? }` | `SubtitleState` | `invalid`, `stale`, `unavailable`, `aborted`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.operation` | `subtitles.control` | `{ operationId }` | `{ status, result?, error? }` | `stale`, `invalid`, `missing`, `unavailable`, `busy`, `capability`, `aborted`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.select Subtitles.select}, {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load}, {@linkcode "@vestra-player/sdk"!Subtitles.remove Subtitles.remove}, {@linkcode "@vestra-player/sdk"!Subtitles.setStyle Subtitles.setStyle} |
| `subtitles.remove` | `subtitles.control` | `{ resourceId, expected, operationId }` | `SubtitleState` | `invalid`, `stale`, `unavailable`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.remove Subtitles.remove} |
| `subtitles.select` | `subtitles.control` | `{ role?, target, expected, operationId }` | `SubtitleState` | `stale`, `invalid`, `missing`, `unavailable`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.select Subtitles.select} |
| `subtitles.style` | `subtitles.control` | `{ operationId, revision, expected, style }` | `SubtitleState` | `invalid`, `unsupported`, `stale`, `unavailable`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.setStyle Subtitles.setStyle} |
| `subtitles.upload.append` | `subtitles.control` | `{ uploadId, offset, base64 }` | `SubtitleUpload` | `invalid`, `stale`, `unavailable`, `aborted`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.upload.begin` | `subtitles.control` | `{ uploadId, generation, expectedBytes }` | `SubtitleUpload` | `invalid`, `stale`, `unavailable`, `aborted`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.upload.discard` | `subtitles.control` | `{ uploadId }` | `void` | `invalid`, `stale`, `unavailable`, `aborted`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.*` (any other) | `subtitles.control` | — | — | — | `plugin.wire` only |

### `media.read`

Take snapshots and export clips. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `snapshot.state` | `media.read` | `{ snapshotId }` | `Snapshot` | `stale`, `noSource`, `invalid`, `busy`, `unavailable`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.capture MediaCapture.capture} |
| `jobs.state` | `media.read` | `{ jobId }` | `MediaJob` | `released`, `invalid`, `busy`, `unavailable`, `capability`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export}, {@linkcode "@vestra-player/sdk"!MediaCapture.export MediaCapture.export} |
| `jobs.operation` | `media.read` | `{ operationId }` | `MediaOperation` | `released`, `invalid`, `busy`, `unavailable`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export} |

### `media.control`

Take snapshots and export clips. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `snapshot.capture` | `media.control` | `RawCapture \| ProcessedCapture` | `Snapshot` | `stale`, `noSource`, `invalid`, `busy`, `unavailable`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.capture MediaCapture.capture} |
| `snapshot.release` | `media.control` | `{ snapshotId, operationId }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.dispose Snapshot.dispose} |
| `snapshot.*` (any other) | `media.control` | — | — | — | `plugin.wire` only |
| `jobs.cancel` | `media.control` | `{ jobId, operationId }` | `{ jobId, cancel }` | `rejected`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!ExportJob.cancel ExportJob.cancel} |
| `jobs.check` | `media.control` | `{ parts, encoding? }` | `WireExportCheck` | `invalid`, `released`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.exportCheck MediaCapture.exportCheck} |
| `jobs.start` | `media.control` | `{ operationId: number; snapshotId: number; destination: string; } & ({ kind: "rawPng" \| "processedPng" \| "rawBmp" \| "processedBmp"; sampleTime?: number \| undefined; } \| { kind: "rawJpeg" \| "processedJpeg"; sampleTime?: number \| undefined; quality?: number \| undefined; } \| { ...; } \| { ...; })` | `{ jobId, status, snapshotId }` | `released`, `invalid`, `busy`, `unavailable`, `capability`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export}, {@linkcode "@vestra-player/sdk"!MediaCapture.export MediaCapture.export} |
| `jobs.*` (any other) | `media.control` | — | — | — | `plugin.wire` only |

### `media.sources`

Remember videos you add and export from them later. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `media.sources.open` | `media.sources` when the manifest declares `playback.control`, otherwise `playback.control` | `{ token, operationId, start? }` | `SourceOperation` | `missing`, `invalid`, `replaced`, `backend`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.open MediaSources.open} |
| `media.sources.forget` | `media.sources` | `{ token }` | `void` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.forget MediaSources.forget} |
| `media.sources.get` | `media.sources` | `{ token }` | `WireSourceReference` | `missing`, `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.get MediaSources.get} |
| `media.sources.list` | `media.sources` | `{}` | `WireSourceReference[]` | `busy`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.list MediaSources.list} |
| `media.sources.locate` | `media.sources` | `{ token }` | `WireSourceReference \| null` | `missing`, `busy`, `unavailable`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.locate MediaSources.locate} |
| `media.sources.remember` | `media.sources` | `{ expected? }` | `WireSourceReference` | `unsupported`, `stale`, `limit`, `busy`, `unavailable`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.remember MediaSources.remember} |
| `media.sources.*` (any other) | `media.sources` | — | — | — | `plugin.wire` only |

### `ui.osd`

Show messages on the video. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `osd.show` | `ui.osd` | `{ actions?, args?, text }` | `void` | `invalid`, `unavailable`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Osd.show Osd.show} |
| `osd.panel` | `ui.osd` | `{ maxColumns?, args?, text }` | `void` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Osd.panel Osd.panel} |

### `clipboard`

Read and write the clipboard. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `clipboard.readText` | `clipboard` | — | `string \| null` | `unavailable`, `unsupported`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.readText Clipboard.readText} |
| `clipboard.writeText` | `clipboard` | `{ text }` | `void` | `invalid`, `unavailable`, `unsupported`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.writeText Clipboard.writeText} |
| `clipboard.writeImage` | `clipboard` | `{ path }` | `void` | `missing`, `invalid`, `unavailable`, `unsupported`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.writeImage Clipboard.writeImage} |

### `window.control`

Adjust the main window (size, on top, picture-in-picture). Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `window.setVideoArea` | `window.control` | `{ width, height }` | `{ width, height, clamped }` | `unavailable`, `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setVideoArea MainWindow.setVideoArea} |
| `window.setAlwaysOnTop` | `window.control` | `{ onTop }` | `void` | `unavailable`, `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setAlwaysOnTop MainWindow.setAlwaysOnTop} |
| `window.setCursorAutoHide` | `window.control` | `{ mode }` | `void` | `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setCursorAutoHide MainWindow.setCursorAutoHide} |
| `window.setPictureInPicture` | `window.control` | `{ on }` | `void` | `unsupported`, `unavailable`, `invalid`, `busy`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setPictureInPicture MainWindow.setPictureInPicture} |

### `bindings.manage`

Change all shortcuts. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `bindings.list` | `bindings.manage` | — | `BindingTable` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.list Bindings.list} |
| `bindings.set` | `bindings.manage` | `{ plugin, command, inputs }` | `void` | `invalid`, `missing`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.set Bindings.set} |
| `bindings.reset` | `bindings.manage` | `{ plugin?, command? }` | `void` | `missing`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.reset Bindings.reset} |

### `timeline.marks`

Show marks on the progress bar. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `timeline.set` | `timeline.marks` | `{ sourceId?, marks }` | `{ applied: boolean }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.layer Timeline.layer} |
| `timeline.setRanges` | `timeline.marks` | `{ sourceId?, ranges }` | `{ applied: boolean }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.layer Timeline.layer} |

### `ui.drop`

Receive files dropped on the player. Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `drops.provide` | `ui.drop` | `{ id, extensions }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Drops.provide Drops.provide} |
| `drops.withdraw` | `ui.drop` | `{ id }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Drops.provide Drops.provide} |
| `drops.listen` | `ui.drop` | `{ listen }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.onDrop Panel.onDrop} |

### `ui.settings`

Add pages to the Options window. Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `settings.register` | `ui.settings` | `{ id, category, title, order?, file, component, global, properties }` | `void` | `invalid`, `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Settings.page Settings.page} |
| `settings.set` | `ui.settings` | `{ value?, seq?, more?, id, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.set}, {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.bind} |
| `settings.show` | `ui.settings` | `{ id? }` | `void` | `invalid`, `unavailable`, `ui`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Settings.show Settings.show} |
| `settings.unregister` | `ui.settings` | `{ id }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.dispose} |
| `settings.*` (any other) | `ui.settings` | — | — | — | `plugin.wire` only |

### `ui.theme`

Change the player's palette. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `appearance.set` | `ui.theme` | `{ theme }` | `void` | `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Appearance.set Appearance.set} |
| `appearance.setLanguage` | `ui.theme` | `{ language }` | `void` | `invalid`, `capability`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Appearance.setLanguage Appearance.setLanguage} |

### `secrets`

Store sign-in details in the system keychain. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `secrets.get` | `secrets` | `{ name }` | `string \| null` | `unsupported`, `unavailable`, `failed`, `capability`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.get Secrets.get} |
| `secrets.set` | `secrets` | `{ name, value }` | `void` | `invalid`, `limit`, `unsupported`, `unavailable`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.set Secrets.set} |
| `secrets.delete` | `secrets` | `{ name }` | `void` | `invalid`, `unsupported`, `unavailable`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.delete Secrets.delete} |

### `rendering.manage`

Choose GPU or software rendering and restart the player. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `rendering.setPreference` | `rendering.manage` | `{ preference }` | `WireRenderingState` | `invalid`, `unsupported`, `unavailable`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.setPreference Rendering.setPreference} |
| `rendering.restart` | `rendering.manage` | — | `null` | `unsupported`, `busy`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.restartPlayer Rendering.restartPlayer} |

### `video.upscaling`

Upscale the video with the GPU's video upscaler. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `video.upscaling.state` | `video.upscaling` | — | `WireUpscalingState` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!VideoUpscaling.state VideoUpscaling.state} |
| `video.upscaling.set` | `video.upscaling` | `{ enabled }` | `WireUpscalingState` | `capability`, `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!VideoUpscaling.set VideoUpscaling.set} |

### `video.motion`

Smooth motion with the GPU's frame-rate converter. Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `video.motion.state` | `video.motion` | `{ engine }` | `WireMotionState` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!VideoMotion.state VideoMotion.state} |
| `video.motion.set` | `video.motion` | `{ engine, mode }` | `WireMotionState` | `capability`, `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!VideoMotion.set VideoMotion.set} |

### `commands.run`

Run any player or plugin command. Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `commands.list` | `commands.run` | `{}` | `CommandList` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.list Commands.list} |
| `commands.run` | `commands.run` | `{ id, ticket, step?, of?, then? }` | `CommandRunResult` | `capability`, `ticket`, `missing`, `disabled`, `busy`, `limit`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.run Commands.run} |

### `palette.lead`

Add the first row of the command palette. Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `palette.lead.set` | `palette.lead` | `{ [key: string]: Json; }` | `void` | `capability`, `conflict`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Palette.lead Palette.lead} |
| `palette.lead.clear` | `palette.lead` | `{}` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!PaletteLead.dispose PaletteLead.dispose} |
| `palette.lead.done` | `palette.lead` | `{ ticket }` | `void` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PaletteLead.done PaletteLead.done} |

### No capability

Methods every plugin may call.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `packages.list` | none | — | `PackageInfo[]` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.list Packages.list} |
| `window.state` | none | — | `WindowFacts` | — | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.state MainWindow.state} |
| `system.reveal` | none | `{ paths }` | `void` | `missing`, `invalid`, `failed`, `timeout`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!System.reveal System.reveal} |
| `system.openPath` | none | `{ path }` | `void` | `missing`, `invalid`, `failed`, `timeout`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!System.openPath System.openPath} |
| `system.openUrl` | none | `{ url }` | `void` | `invalid`, `timeout`, `failed`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!System.openUrl System.openUrl} |
| `app.system` | none | — | `WireSystemInfo` | `busy` | SDK member: {@linkcode "@vestra-player/sdk"!App.system App.system} |
| `ui.markdownScan` | none | `{ text, base }` | `{ images: string[] }` | `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Ui.markdown Ui.markdown} |
| `storage.session.get` | none | `{ key }` | `{ value?: Json }` | `invalid`, `disabled`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.get SessionStorage.get} |
| `storage.session.set` | none | `{ key, value }` | `void` | `invalid`, `disabled`, `unsupported`, `limit` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.set SessionStorage.set} |
| `storage.session.delete` | none | `{ key }` | `void` | `invalid`, `disabled`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.delete SessionStorage.delete} |
| `storage.session.keys` | none | — | `string[]` | `disabled`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.keys SessionStorage.keys} |
| `rendering.state` | none | — | `WireRenderingState` | `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.state Rendering.state} |

<!-- /generated -->

Events, the other direction, are in [Events](events.md).
