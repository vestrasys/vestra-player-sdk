---
title: Messages
description: Every request method of the player's protocol, with the capability it needs, its parameters and result, the errors documented for it and the SDK member that sends it.
---

# Messages

Every request reaches the player as one JSON line `{"id": n, "method": name, "params": {…}}`, answered with `{"id": n, "result": …}` or `{"id": n, "error": {"code", "message"}}`. The typed members send these for you; {@link "@vestra-player/sdk"!Wire.request | plugin.wire.request(method, params)} sends one by name.

**The wire protocol is not semver**: a method can change with a player version, and this table with it. Prefer the member named in the Stability column.

- **Capability**: from the player's own table: none for most methods, or one of `player`, `plugins`, `clipboard`, `credentials` ([Capabilities](capabilities.md)). `vestra-plugin check` reads a literal method name in `plugin.wire.request`.
- **Params** and **Result**: what the SDK's client sends and expects (`?`: optional; "—": none or not read), in the SDK's internal wire types; units and meanings are at the member that sends the method.
- **Errors (documented)**: the codes in the sending members' `@throws` ([Error codes](errors.md)). Any request can also fail with `capability` or `invalid`.
- **Stability**: "SDK member" names the public members that send it (semver); "`plugin.wire` only" means only a direct request reaches it.

A method ending in `.*` stands for the other methods with that prefix. The residency line under each heading says what those calls mean for standby ([Keep a command's state without keeping the plugin running](../guides/command-state.md)).

<!-- generated:messages -->

### Provide audio and video it generates itself

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `producer.prepare` | none | `{ width, height }` | `PreparedProducer` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.state` | none | `{ producerId }` | `ProducerState` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.release` | none | `{ producerId }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Stream.stop Stream.stop} |
| `producer.ack` | none | `{ control }` | `{ status, control }` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.declareInput` | none | `{ producerId, keys }` | `ProducerInputState` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.ackInput` | none | `{ notice }` | `{ status: "acknowledged"; sequence: number }` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |

### Read what is playing and the position

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `source.state` | none | — | `SourceState` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.state Player.state}, {@linkcode "@vestra-player/sdk"!Player.refresh Player.refresh} |
| `processing.state` | none | — | `ProcessingState` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `playback.stats` | none | — | `PlaybackStats` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.stats Player.stats} |
| `player.chapters` | none | — | `{ sourceId, chapters }` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.chapters Player.chapters} |
| `player.audioDevices` | none | — | `{ id: string; name: string }[]` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.audioDevices Player.audioDevices} |
| `timeline.marks` | none | — | `WireTimeline` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.marks Timeline.marks}, {@linkcode "@vestra-player/sdk"!Timeline.ranges Timeline.ranges} |

### Open media, control playback, keep the computer awake

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `playback.set` | none | `{ property, value }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setOutput Player.setOutput} |
| `source.submit` | none | `{ operationId, intent }` | `SourceOperation` | `stale`, `replaced`, `invalid`, `aborted`, `busy`, `backend`, `unsupported`, `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!Player.open Player.open}, {@linkcode "@vestra-player/sdk"!Player.setPaused Player.setPaused}, {@linkcode "@vestra-player/sdk"!Player.seek Player.seek}, {@linkcode "@vestra-player/sdk"!Player.setRate Player.setRate}, {@linkcode "@vestra-player/sdk"!Player.restart Player.restart}, {@linkcode "@vestra-player/sdk"!Player.close Player.close}, {@linkcode "@vestra-player/sdk"!Player.scrub Player.scrub} |
| `source.operation` | none | `{ operationId }` | `SourceOperation` | `stale`, `replaced`, `invalid`, `aborted`, `busy`, `backend`, `unsupported`, `unavailable`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Player.open Player.open}, {@linkcode "@vestra-player/sdk"!Player.setPaused Player.setPaused}, {@linkcode "@vestra-player/sdk"!Player.seek Player.seek}, {@linkcode "@vestra-player/sdk"!Player.setRate Player.setRate}, {@linkcode "@vestra-player/sdk"!Player.restart Player.restart}, {@linkcode "@vestra-player/sdk"!Player.close Player.close}, {@linkcode "@vestra-player/sdk"!Player.scrub Player.scrub}, {@linkcode "@vestra-player/sdk"!MediaSources.open MediaSources.open} |
| `audio.addTrack` | none | `{ expected?, path, select }` | `SourceAudioTrack` | `invalid`, `unavailable`, `backend`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.addAudioTrack Player.addAudioTrack} |
| `audio.selectTrack` | none | `{ expected?, id }` | `void` | `invalid`, `unavailable`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.selectAudioTrack Player.selectAudioTrack} |
| `player.setLoop` | none | `{ expected?, loop }` | `void` | `invalid`, `unsupported`, `unavailable`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setLoop Player.setLoop} |
| `player.setAudioDevice` | none | `{ id }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setAudioDevice Player.setAudioDevice} |
| `player.step` | none | `{ expected?, unit, direction }` | `void` | `unsupported`, `busy`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.step Player.step} |
| `player.setStepSeek` | none | `{ seconds, keyframes? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setStepSeek Player.setStepSeek} |
| `power.preventSleep` | none | `{ mode }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Power.preventSleep Power.preventSleep} |
| `sequence.set` | none | `{ flags }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Player.provideSequence Player.provideSequence} |
| `sequence.step` | none | `{ direction }` | `void` | `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!Player.next Player.next}, {@linkcode "@vestra-player/sdk"!Player.previous Player.previous} |

### Resolve online video addresses

Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `sourceResolvers.register` | none | `{ id, schemes?, hosts?, extensions? }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.unregister` | none | `{ id }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.respond` | none | `{ requestId, error }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.*` (any other) | none | — | — | — | `plugin.wire` only |

### Receive playback changes as they happen

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `events.subscribe` | none | `{ event, mirror?, why? }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange}, {@linkcode "@vestra-player/sdk"!MainWindow.onChange MainWindow.onChange}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange}, {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys}, {@linkcode "@vestra-player/sdk"!Packages.onChange Packages.onChange}, {@linkcode "@vestra-player/sdk"!Bindings.onChange Bindings.onChange}, {@linkcode "@vestra-player/sdk"!VideoUpscaling.onChange VideoUpscaling.onChange}, {@linkcode "@vestra-player/sdk"!VideoMotion.onChange VideoMotion.onChange} |
| `events.unsubscribe` | none | `{ event }` | — | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.on Player.on}, {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange} |

### Add menu commands and shortcuts

Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `commands.register` | none | `{ when?, id, revision, declaration, state }` | `{ revision: number }` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.add Commands.add} |
| `commands.update` | none | `{ when?, id, revision, state }` | `{ revision: number }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Command.set Command.set} |
| `commands.unregister` | none | `{ id }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Command.dispose Command.dispose} |
| `host.run` | none | `{ action, seconds? }` | `void` | `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Host.run Host.run} |
| `commands.keys` | none | `{}` | `CommandKeys` | — | SDK member: {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys} |

### Open tool windows

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `ui.open` | none | `{ id, file, properties, callbacks }` | `void` | `conflict` | SDK member: {@linkcode "@vestra-player/sdk"!Windows.create Windows.create} |
| `ui.set` | none | `{ value?, seq?, more?, id, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Window.set Window.set}, {@linkcode "@vestra-player/sdk"!Window.bind Window.bind} |
| `ui.show` | none | `{ id, visible }` | `void` | `unavailable`, `host`, `missing`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Window.show Window.show}, {@linkcode "@vestra-player/sdk"!Window.hide Window.hide} |
| `ui.close` | none | `{ id }` | `void` | `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Window.close Window.close} |

### Show panels in the bottom bar, the sidebar or behind the video

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `ui.mount` | none | `{ slot, file, component, global, title?, properties? }` | `{ status, prepareMs, shellGeneration }` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Panels.mount Panels.mount} |
| `ui.setMount` | none | `{ slot?, value?, seq?, more?, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Panel.set Panel.set}, {@linkcode "@vestra-player/sdk"!Panel.bind Panel.bind} |
| `ui.unmount` | none | `{ slot: MountSlot; } \| undefined` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.dispose Panel.dispose} |
| `ui.interaction` | none | `{ slot?, focused, dragging, popupOpen }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.setInteraction Panel.setInteraction} |
| `ui.menu` | none | `{ slot?, items, x, y }` | `void` | `missing`, `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Panel.showMenu Panel.showMenu} |
| `layout.state` | none | — | `{ bottom, sidebar, adjust?, backdrop? }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panels.bottom Panels.bottom}, {@linkcode "@vestra-player/sdk"!Panels.sidebar Panels.sidebar}, {@linkcode "@vestra-player/sdk"!Panels.backdrop Panels.backdrop}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange} |
| `layout.set` | none | `{ slot, visible?, detached?, active?, reveal? }` | `void` | `missing`, `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!PanelSlot.setVisible PanelSlot.setVisible}, {@linkcode "@vestra-player/sdk"!PanelSlot.toggle PanelSlot.toggle}, {@linkcode "@vestra-player/sdk"!Panel.show Panel.show}, {@linkcode "@vestra-player/sdk"!Panel.toggle Panel.toggle} |

### Show file pickers and confirmations

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `dialogs.open` | none | `{ kind, title?, fileName? }` | `{ cancelled: boolean; paths: string[] }` | `busy`, `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Dialogs.openFile Dialogs.openFile}, {@linkcode "@vestra-player/sdk"!Dialogs.openFiles Dialogs.openFiles}, {@linkcode "@vestra-player/sdk"!Dialogs.openDirectory Dialogs.openDirectory}, {@linkcode "@vestra-player/sdk"!Dialogs.saveFile Dialogs.saveFile} |
| `dialogs.confirm` | none | `{ [key: string]: Json; }` | `{ confirmed: boolean; checked: boolean }` | `invalid`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Dialogs.confirm Dialogs.confirm} |

### Install, uninstall and disable other plugins

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `packages.cancel` | `plugins` | `{ operationId }` | `PackageOperation` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageChange.cancel PackageChange.cancel} |
| `packages.install` | `plugins` | `{ enabled?, replace?, source?, token, expectedRevision, requestId }` | `PackageOperation` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.installed` | `plugins` | `{ id }` | `InstalledPackage` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.operation` | `plugins` | `{ operationId }` | `PackageOperation` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.reload` | `plugins` | `{ id }` | `void` | `invalid`, `missing`, `busy`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.reload Packages.reload} |
| `packages.setEnabled` | `plugins` | `{ id, enabled }` | `void` | `invalid`, `missing`, `busy`, `unsupported`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.setEnabled Packages.setEnabled} |
| `packages.uninstall` | `plugins` | `{ id, removeData, expectedRevision, requestId }` | `PackageOperation` | `unsupported`, `missing`, `invalid`, `busy`, `revisionConflict`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.uninstall Packages.uninstall} |
| `packages.validate` | `plugins` | `{ directory, apiVersion }` | `PackageValidation` | `host`, `invalid`, `javascript`, `slint`, `reserved`, `versionMismatch`, `disabled`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.validate Packages.validate} |
| `packages.validateArchive` | `plugins` | `{ file }` | `PackageValidation` | `invalid`, `host`, `javascript`, `slint`, `reserved`, `versionMismatch`, `disabled`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.validateArchive Packages.validateArchive} |
| `packages.*` (any other) | `plugins` | — | — | — | `plugin.wire` only |

### Process the picture and the sound (filters, shaders)

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `processing.replace` | none | `ProcessingChange` | `ProcessingApplied` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `processing.operation` | none | `{ stage, resourceId, revision }` | `ProcessingOperation` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `video.view.set` | none | `{ values }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.view} |
| `video.view.release` | none | — | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.view} |
| `video.render.set` | none | `{ values }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.render} |
| `video.render.release` | none | — | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.render} |
| `video.shaders.set` | none | `{ id, paths }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.shaders} |

### Read subtitles

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `subtitles.state` | none | — | `SubtitleState` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.state Subtitles.state}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.refresh Subtitles.refresh} |

### Load and change subtitles

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `subtitles.commit` | none | `{ operationId, uploadId, sha256, resourceId, revision, expected, inputOrigin?, format?, title?, select? }` | `SubtitleState` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.operation` | none | `{ operationId }` | `{ status, result?, error? }` | `stale`, `invalid`, `missing`, `unavailable`, `busy`, `aborted`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.select Subtitles.select}, {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load}, {@linkcode "@vestra-player/sdk"!Subtitles.remove Subtitles.remove}, {@linkcode "@vestra-player/sdk"!Subtitles.setStyle Subtitles.setStyle} |
| `subtitles.remove` | none | `{ resourceId, expected, operationId }` | `SubtitleState` | `invalid`, `stale`, `unavailable`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.remove Subtitles.remove} |
| `subtitles.select` | none | `{ role?, target, expected, operationId }` | `SubtitleState` | `stale`, `invalid`, `missing`, `unavailable`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.select Subtitles.select} |
| `subtitles.style` | none | `{ operationId, revision, expected, style }` | `SubtitleState` | `invalid`, `unsupported`, `stale`, `unavailable`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.setStyle Subtitles.setStyle} |
| `subtitles.upload.append` | none | `{ uploadId, offset, base64 }` | `SubtitleUpload` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.upload.begin` | none | `{ uploadId, generation, expectedBytes }` | `SubtitleUpload` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.upload.discard` | none | `{ uploadId }` | `void` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.*` (any other) | none | — | — | — | `plugin.wire` only |

### Take snapshots and export clips (residency `none`)

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `snapshot.state` | none | `{ snapshotId }` | `Snapshot` | `stale`, `noSource`, `invalid`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.capture MediaCapture.capture} |
| `jobs.state` | none | `{ jobId }` | `MediaJob` | `released`, `invalid`, `busy`, `unavailable`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export}, {@linkcode "@vestra-player/sdk"!MediaCapture.export MediaCapture.export} |
| `jobs.operation` | none | `{ operationId }` | `MediaOperation` | `released`, `invalid`, `busy`, `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export} |

### Take snapshots and export clips (residency `live`)

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `snapshot.capture` | none | `RawCapture \| ProcessedCapture` | `Snapshot` | `stale`, `noSource`, `invalid`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.capture MediaCapture.capture} |
| `snapshot.release` | none | `{ snapshotId, operationId }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.dispose Snapshot.dispose} |
| `snapshot.*` (any other) | none | — | — | — | `plugin.wire` only |
| `jobs.cancel` | none | `{ jobId, operationId }` | `{ jobId, cancel }` | `rejected` | SDK member: {@linkcode "@vestra-player/sdk"!ExportJob.cancel ExportJob.cancel} |
| `jobs.check` | none | `{ parts, encoding? }` | `WireExportCheck` | `invalid`, `released`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.exportCheck MediaCapture.exportCheck} |
| `jobs.start` | none | `{ operationId: number; snapshotId: number; destination: string; } & ({ kind: "rawPng" \| "processedPng" \| "rawBmp" \| "processedBmp"; sampleTime?: number \| undefined; } \| { kind: "rawJpeg" \| "processedJpeg"; sampleTime?: number \| undefined; quality?: number \| undefined; } \| { ...; } \| { ...; })` | `{ jobId, status, snapshotId }` | `released`, `invalid`, `busy`, `unavailable`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export}, {@linkcode "@vestra-player/sdk"!MediaCapture.export MediaCapture.export} |
| `jobs.*` (any other) | none | — | — | — | `plugin.wire` only |

### Remember videos you add and export from them later

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `media.sources.forget` | none | `{ token }` | `void` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.forget MediaSources.forget} |
| `media.sources.get` | none | `{ token }` | `WireSourceReference` | `missing`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.get MediaSources.get} |
| `media.sources.list` | none | `{}` | `WireSourceReference[]` | `busy` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.list MediaSources.list} |
| `media.sources.locate` | none | `{ token }` | `WireSourceReference \| null` | `missing`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.locate MediaSources.locate} |
| `media.sources.open` | none | `{ token, operationId, start? }` | `SourceOperation` | `missing`, `invalid`, `replaced`, `backend` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.open MediaSources.open} |
| `media.sources.remember` | none | `{ expected? }` | `WireSourceReference` | `unsupported`, `stale`, `limit`, `busy`, `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.remember MediaSources.remember} |
| `media.sources.*` (any other) | none | — | — | — | `plugin.wire` only |

### Show messages on the video

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `osd.show` | none | `{ actions?, args?, text }` | `void` | `invalid`, `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!Osd.show Osd.show} |
| `osd.panel` | none | `{ maxColumns?, args?, text }` | `void` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Osd.panel Osd.panel} |

### Read and write the clipboard

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `clipboard.readText` | `clipboard` | — | `string \| null` | `unavailable`, `unsupported`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.readText Clipboard.readText} |
| `clipboard.writeText` | `clipboard` | `{ text }` | `void` | `invalid`, `unavailable`, `unsupported`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.writeText Clipboard.writeText} |
| `clipboard.writeImage` | `clipboard` | `{ path }` | `void` | `missing`, `invalid`, `unavailable`, `unsupported`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.writeImage Clipboard.writeImage} |

### Adjust the main window (size, on top, picture-in-picture)

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `window.setVideoArea` | none | `{ width, height }` | `{ width, height, clamped }` | `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setVideoArea MainWindow.setVideoArea} |
| `window.setAlwaysOnTop` | none | `{ onTop }` | `void` | `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setAlwaysOnTop MainWindow.setAlwaysOnTop} |
| `window.setCursorAutoHide` | none | `{ mode }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setCursorAutoHide MainWindow.setCursorAutoHide} |
| `window.setPictureInPicture` | none | `{ on }` | `void` | `unsupported`, `unavailable`, `invalid`, `busy`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setPictureInPicture MainWindow.setPictureInPicture} |

### Read and change all shortcuts

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `bindings.list` | `player` | — | `BindingTable` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.list Bindings.list} |
| `bindings.set` | `player` | `{ plugin, command, inputs }` | `void` | `invalid`, `missing`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.set Bindings.set} |
| `bindings.reset` | `player` | `{ plugin?, command? }` | `void` | `missing`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.reset Bindings.reset} |

### Show marks on the progress bar

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `timeline.set` | none | `{ sourceId?, marks }` | `{ applied: boolean }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.layer Timeline.layer} |
| `timeline.setRanges` | none | `{ sourceId?, ranges }` | `{ applied: boolean }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.layer Timeline.layer} |

### Receive files dropped on the player

Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `drops.provide` | none | `{ id, extensions }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Drops.provide Drops.provide} |
| `drops.withdraw` | none | `{ id }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Drops.provide Drops.provide} |
| `drops.listen` | none | `{ listen }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.onDrop Panel.onDrop} |

### Add pages to the Options window

Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `settings.register` | none | `{ id, category, title, order?, file, component, global, properties }` | `void` | `invalid`, `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Settings.page Settings.page} |
| `settings.set` | none | `{ value?, seq?, more?, id, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.set}, {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.bind} |
| `settings.show` | none | `{ id? }` | `void` | `invalid`, `unavailable`, `ui` | SDK member: {@linkcode "@vestra-player/sdk"!Settings.show Settings.show} |
| `settings.unregister` | none | `{ id }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.dispose} |
| `settings.*` (any other) | none | — | — | — | `plugin.wire` only |

### Change the player's palette and interface language

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `appearance.set` | `player` | `{ theme }` | `void` | `invalid`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Appearance.set Appearance.set} |
| `appearance.setLanguage` | `player` | `{ language }` | `void` | `invalid`, `capability`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Appearance.setLanguage Appearance.setLanguage} |

### Store sign-in details in the system keychain

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `secrets.get` | `credentials` | `{ name }` | `string \| null` | `unsupported`, `unavailable`, `failed`, `capability`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.get Secrets.get} |
| `secrets.set` | `credentials` | `{ name, value }` | `void` | `invalid`, `limit`, `unsupported`, `unavailable`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.set Secrets.set} |
| `secrets.delete` | `credentials` | `{ name }` | `void` | `invalid`, `unsupported`, `unavailable`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.delete Secrets.delete} |

### Choose GPU or software rendering and restart the player

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `rendering.setPreference` | `player` | `{ preference }` | `WireRenderingState` | `invalid`, `unsupported`, `unavailable`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.setPreference Rendering.setPreference} |
| `rendering.restart` | `player` | — | `null` | `unsupported`, `busy`, `failed`, `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.restartPlayer Rendering.restartPlayer} |

### Upscale the video with the GPU's video upscaler

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `video.upscaling.state` | none | — | `WireUpscalingState` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!VideoUpscaling.state VideoUpscaling.state} |
| `video.upscaling.set` | none | `{ enabled }` | `WireUpscalingState` | `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!VideoUpscaling.set VideoUpscaling.set} |

### Smooth motion with the GPU's frame-rate converter

Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `video.motion.state` | none | `{ engine }` | `WireMotionState` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!VideoMotion.state VideoMotion.state} |
| `video.motion.set` | none | `{ engine, mode }` | `WireMotionState` | `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!VideoMotion.set VideoMotion.set} |

### Run any player or plugin command

Residency `none`: no effect on standby.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `commands.list` | `plugins` | `{}` | `CommandList` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.list Commands.list} |
| `commands.run` | `plugins` | `{ id, ticket, step?, of?, then? }` | `CommandRunResult` | `capability`, `ticket`, `missing`, `disabled`, `busy`, `limit`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.run Commands.run} |

### Add the first row of the command palette

Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.

| Method | Capability | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- | --- |
| `palette.lead.set` | none | `{ [key: string]: Json; }` | `void` | `conflict`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Palette.lead Palette.lead} |
| `palette.lead.clear` | none | `{}` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!PaletteLead.dispose PaletteLead.dispose} |
| `palette.lead.done` | none | `{ ticket }` | `void` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!PaletteLead.done PaletteLead.done} |

### Read the plugin list, the window and rendering state; open files and links with the system; keep values for this run

Residency `none`: no effect on standby.

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
