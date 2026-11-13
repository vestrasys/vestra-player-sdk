---
title: Messages
description: Every request method of the player's protocol the SDK sends, by area, with its parameters and result, the errors documented for it and the SDK member that sends it.
---

# Messages

Every request reaches the player as one JSON line `{"id": n, "method": name, "params": {…}}`, answered with `{"id": n, "result": …}` or `{"id": n, "error": {"code", "message"}}`. The typed members send these for you; {@link "@vestra-player/sdk"!Wire.request | plugin.wire.request(method, params)} sends one by name.

**The wire protocol is not semver**: a method can change with a player version, and this table with it. Prefer the member named in the Stability column.

- **Params** and **Result**: what the SDK's client sends and expects (`?`: optional; "—": none or not read), in the SDK's internal wire types; units and meanings are at the member that sends the method.
- **Errors (documented)**: the codes in the sending members' `@throws` ([Error codes](errors.md)). Any request can also fail with `invalid`.
- **Stability**: "SDK member" names the public members that send it (semver); "`plugin.wire` only" means only a direct request reaches it.

What a method's calls mean for standby is in [Keep a command's state without keeping the plugin running](../guides/command-state.md).

<!-- generated:messages -->

### `app`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `app.system` | — | `WireSystemInfo` | `busy` | SDK member: {@linkcode "@vestra-player/sdk"!App.system App.system} |

### `appearance`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `appearance.set` | `{ theme }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Appearance.set Appearance.set} |
| `appearance.setLanguage` | `{ language }` | `void` | `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Appearance.setLanguage Appearance.setLanguage} |

### `audio`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `audio.addTrack` | `{ expected?, path, select }` | `SourceAudioTrack` | `invalid`, `unavailable`, `backend`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.addAudioTrack Player.addAudioTrack} |
| `audio.selectTrack` | `{ expected?, id }` | `void` | `invalid`, `unavailable`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.selectAudioTrack Player.selectAudioTrack} |

### `bindings`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `bindings.list` | — | `BindingTable` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.list Bindings.list} |
| `bindings.reset` | `{ plugin?, command? }` | `void` | `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.reset Bindings.reset} |
| `bindings.set` | `{ plugin, command, inputs }` | `void` | `invalid`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Bindings.set Bindings.set} |

### `clipboard`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `clipboard.readText` | — | `string \| null` | `unavailable`, `unsupported`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.readText Clipboard.readText} |
| `clipboard.writeImage` | `{ path }` | `void` | `missing`, `invalid`, `unavailable`, `unsupported`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.writeImage Clipboard.writeImage} |
| `clipboard.writeText` | `{ text }` | `void` | `invalid`, `unavailable`, `unsupported`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!Clipboard.writeText Clipboard.writeText} |

### `commands`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `commands.keys` | `{}` | `CommandKeys` | — | SDK member: {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys} |
| `commands.list` | `{}` | `CommandList` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.list Commands.list} |
| `commands.register` | `{ when?, id, revision, declaration, state }` | `{ revision: number }` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.add Commands.add} |
| `commands.run` | `{ id, ticket, step?, of?, then? }` | `CommandRunResult` | `capability`, `ticket`, `missing`, `disabled`, `busy`, `limit`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Commands.run Commands.run} |
| `commands.unregister` | `{ id }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Command.dispose Command.dispose} |
| `commands.update` | `{ when?, id, revision, state }` | `{ revision: number }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Command.set Command.set} |

### `dialogs`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `dialogs.confirm` | `{ [key: string]: Json; }` | `{ confirmed: boolean; checked: boolean }` | `invalid`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Dialogs.confirm Dialogs.confirm} |
| `dialogs.open` | `{ kind, title?, fileName? }` | `{ cancelled: boolean; paths: string[] }` | `busy`, `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Dialogs.openFile Dialogs.openFile}, {@linkcode "@vestra-player/sdk"!Dialogs.openFiles Dialogs.openFiles}, {@linkcode "@vestra-player/sdk"!Dialogs.openDirectory Dialogs.openDirectory}, {@linkcode "@vestra-player/sdk"!Dialogs.saveFile Dialogs.saveFile} |

### `drops`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `drops.listen` | `{ listen }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.onDrop Panel.onDrop} |
| `drops.provide` | `{ id, extensions }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Drops.provide Drops.provide} |
| `drops.withdraw` | `{ id }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Drops.provide Drops.provide} |

### `events`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `events.subscribe` | `{ event, mirror?, why? }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange}, {@linkcode "@vestra-player/sdk"!MainWindow.onChange MainWindow.onChange}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange}, {@linkcode "@vestra-player/sdk"!Commands.keys Commands.keys}, {@linkcode "@vestra-player/sdk"!Packages.onChange Packages.onChange}, {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Bindings.onChange Bindings.onChange}, {@linkcode "@vestra-player/sdk"!VideoUpscaling.onChange VideoUpscaling.onChange}, {@linkcode "@vestra-player/sdk"!VideoMotion.onChange VideoMotion.onChange} |
| `events.unsubscribe` | `{ event }` | — | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.on Player.on}, {@linkcode "@vestra-player/sdk"!Player.onChange Player.onChange} |

### `host`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `host.run` | `{ action, seconds? }` | `void` | `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Host.run Host.run} |

### `jobs`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `jobs.cancel` | `{ jobId, operationId }` | `{ jobId, cancel }` | `rejected` | SDK member: {@linkcode "@vestra-player/sdk"!ExportJob.cancel ExportJob.cancel} |
| `jobs.check` | `{ parts, encoding? }` | `WireExportCheck` | `invalid`, `released`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.exportCheck MediaCapture.exportCheck} |
| `jobs.operation` | `{ operationId }` | `MediaOperation` | `released`, `invalid`, `busy`, `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export} |
| `jobs.start` | `{ operationId: number; snapshotId: number; destination: string; } & ({ kind: "rawPng" \| "processedPng" \| "rawBmp" \| "processedBmp"; sampleTime?: number \| undefined; } \| { kind: "rawJpeg" \| "processedJpeg"; sampleTime?: number \| undefined; quality?: number \| undefined; } \| { ...; } \| { ...; })` | `{ jobId, status, snapshotId }` | `released`, `invalid`, `busy`, `unavailable`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export}, {@linkcode "@vestra-player/sdk"!MediaCapture.export MediaCapture.export} |
| `jobs.state` | `{ jobId }` | `MediaJob` | `released`, `invalid`, `busy`, `unavailable`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.export Snapshot.export}, {@linkcode "@vestra-player/sdk"!MediaCapture.export MediaCapture.export} |

### `layout`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `layout.set` | `{ slot, visible?, detached?, active?, reveal? }` | `void` | `missing`, `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!PanelSlot.setVisible PanelSlot.setVisible}, {@linkcode "@vestra-player/sdk"!PanelSlot.toggle PanelSlot.toggle}, {@linkcode "@vestra-player/sdk"!Panel.show Panel.show}, {@linkcode "@vestra-player/sdk"!Panel.toggle Panel.toggle} |
| `layout.state` | — | `{ bottom, sidebar, adjust?, backdrop? }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panels.bottom Panels.bottom}, {@linkcode "@vestra-player/sdk"!Panels.sidebar Panels.sidebar}, {@linkcode "@vestra-player/sdk"!Panels.backdrop Panels.backdrop}, {@linkcode "@vestra-player/sdk"!PanelSlot.onChange PanelSlot.onChange}, {@linkcode "@vestra-player/sdk"!Panel.onChange Panel.onChange}, {@linkcode "@vestra-player/sdk"!BackdropSlot.onChange BackdropSlot.onChange} |

### `media`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `media.sources.forget` | `{ token }` | `void` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.forget MediaSources.forget} |
| `media.sources.get` | `{ token }` | `WireSourceReference` | `missing`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.get MediaSources.get} |
| `media.sources.list` | `{}` | `WireSourceReference[]` | `busy` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.list MediaSources.list} |
| `media.sources.locate` | `{ token }` | `WireSourceReference \| null` | `missing`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.locate MediaSources.locate} |
| `media.sources.open` | `{ token, operationId, start? }` | `SourceOperation` | `missing`, `invalid`, `replaced`, `backend` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.open MediaSources.open} |
| `media.sources.remember` | `{ expected? }` | `WireSourceReference` | `unsupported`, `stale`, `limit`, `busy`, `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!MediaSources.remember MediaSources.remember} |

### `mpv`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `mpv.command` | `{ args }` | `{ result: Json }` | `invalid`, `refused`, `conflict`, `backend` | SDK member: {@linkcode "@vestra-player/sdk"!Mpv.command Mpv.command} |
| `mpv.get` | `{ name }` | `{ value: Json }` | `invalid`, `refused`, `backend` | SDK member: {@linkcode "@vestra-player/sdk"!Mpv.get Mpv.get} |
| `mpv.observe` | `{ name }` | `void` | `invalid`, `refused`, `limit` | SDK member: {@linkcode "@vestra-player/sdk"!Mpv.observe Mpv.observe} |
| `mpv.set` | `{ name, value }` | `void` | `invalid`, `refused`, `backend` | SDK member: {@linkcode "@vestra-player/sdk"!Mpv.set Mpv.set} |
| `mpv.unobserve` | `{ name }` | `void` | `invalid`, `refused`, `limit` | SDK member: {@linkcode "@vestra-player/sdk"!Mpv.observe Mpv.observe} |

### `osd`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `osd.panel` | `{ maxColumns?, args?, text }` | `void` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Osd.panel Osd.panel} |
| `osd.show` | `{ actions?, args?, text }` | `void` | `invalid`, `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!Osd.show Osd.show} |

### `packages`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `packages.cancel` | `{ operationId }` | `PackageOperation` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!PackageChange.cancel PackageChange.cancel} |
| `packages.install` | `{ enabled?, replace?, source?, token, expectedRevision, requestId }` | `PackageOperation` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.installed` | `{ id }` | `InstalledPackage` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.list` | — | `PackageInfo[]` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.list Packages.list} |
| `packages.operation` | `{ operationId }` | `PackageOperation` | `invalid`, `conflict`, `unsupported`, `reserved`, `busy`, `revisionConflict`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install} |
| `packages.reload` | `{ id }` | `void` | `invalid`, `missing`, `busy`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.reload Packages.reload} |
| `packages.setEnabled` | `{ id, enabled }` | `void` | `invalid`, `missing`, `busy`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.setEnabled Packages.setEnabled} |
| `packages.uninstall` | `{ id, removeData, expectedRevision, requestId }` | `PackageOperation` | `unsupported`, `missing`, `invalid`, `busy`, `revisionConflict` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.uninstall Packages.uninstall} |
| `packages.validate` | `{ directory, apiVersion }` | `PackageValidation` | `host`, `invalid`, `javascript`, `slint`, `reserved`, `versionMismatch`, `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.validate Packages.validate} |
| `packages.validateArchive` | `{ file }` | `PackageValidation` | `invalid`, `host`, `javascript`, `slint`, `reserved`, `versionMismatch`, `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Packages.validateArchive Packages.validateArchive} |

### `palette`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `palette.lead.clear` | `{}` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!PaletteLead.dispose PaletteLead.dispose} |
| `palette.lead.done` | `{ ticket }` | `void` | `capability` | SDK member: {@linkcode "@vestra-player/sdk"!PaletteLead.done PaletteLead.done} |
| `palette.lead.set` | `{ [key: string]: Json; }` | `void` | `capability`, `conflict`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Palette.lead Palette.lead} |

### `playback`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `playback.set` | `{ property, value }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setOutput Player.setOutput} |
| `playback.stats` | — | `PlaybackStats` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.stats Player.stats} |

### `player`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `player.audioDevices` | — | `{ id: string; name: string }[]` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.audioDevices Player.audioDevices} |
| `player.chapters` | — | `{ sourceId, chapters }` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.chapters Player.chapters} |
| `player.setAudioDevice` | `{ id }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setAudioDevice Player.setAudioDevice} |
| `player.setLoop` | `{ expected?, loop }` | `void` | `invalid`, `unsupported`, `unavailable`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setLoop Player.setLoop} |
| `player.setStepSeek` | `{ seconds, keyframes? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Player.setStepSeek Player.setStepSeek} |
| `player.step` | `{ expected?, unit, direction }` | `void` | `unsupported`, `busy`, `stale` | SDK member: {@linkcode "@vestra-player/sdk"!Player.step Player.step} |

### `power`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `power.preventSleep` | `{ mode }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Power.preventSleep Power.preventSleep} |

### `processing`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `processing.operation` | `{ stage, resourceId, revision }` | `ProcessingOperation` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `processing.replace` | `ProcessingChange` | `ProcessingApplied` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |
| `processing.state` | — | `ProcessingState` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.filter}, {@linkcode "@vestra-player/sdk"!Scope.audio Plugin.audio.filter} |

### `producer`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `producer.ack` | `{ control }` | `{ status, control }` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.ackInput` | `{ notice }` | `{ status: "acknowledged"; sequence: number }` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.declareInput` | `{ producerId, keys }` | `ProducerInputState` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.prepare` | `{ width, height }` | `PreparedProducer` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |
| `producer.release` | `{ producerId }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Stream.stop Stream.stop} |
| `producer.state` | `{ producerId }` | `ProducerState` | `timeout`, `stream`, `device`, `replaced`, `invalid`, `aborted` | SDK member: {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream} |

### `rendering`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `rendering.restart` | — | `null` | `unsupported`, `busy`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.restartPlayer Rendering.restartPlayer} |
| `rendering.setPreference` | `{ preference }` | `WireRenderingState` | `invalid`, `unsupported`, `unavailable`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.setPreference Rendering.setPreference} |
| `rendering.state` | — | `WireRenderingState` | `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Rendering.state Rendering.state} |

### `secrets`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `secrets.delete` | `{ name }` | `void` | `invalid`, `unsupported`, `unavailable`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.delete Secrets.delete} |
| `secrets.get` | `{ name }` | `string \| null` | `unsupported`, `unavailable`, `failed`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.get Secrets.get} |
| `secrets.set` | `{ name, value }` | `void` | `invalid`, `limit`, `unsupported`, `unavailable`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!Secrets.set Secrets.set} |

### `sequence`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `sequence.set` | `{ flags }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Player.provideSequence Player.provideSequence} |
| `sequence.step` | `{ direction }` | `void` | `unavailable` | SDK member: {@linkcode "@vestra-player/sdk"!Player.next Player.next}, {@linkcode "@vestra-player/sdk"!Player.previous Player.previous} |

### `settings`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `settings.register` | `{ id, category, title, order?, file, component, global, properties }` | `void` | `invalid`, `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Settings.page Settings.page} |
| `settings.set` | `{ value?, seq?, more?, id, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.set}, {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.bind} |
| `settings.show` | `{ id? }` | `void` | `invalid`, `unavailable`, `ui` | SDK member: {@linkcode "@vestra-player/sdk"!Settings.show Settings.show} |
| `settings.unregister` | `{ id }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!SettingsPage SettingsPage.dispose} |

### `snapshot`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `snapshot.capture` | `RawCapture \| ProcessedCapture` | `Snapshot` | `stale`, `noSource`, `invalid`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.capture MediaCapture.capture} |
| `snapshot.release` | `{ snapshotId, operationId }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Snapshot.dispose Snapshot.dispose} |
| `snapshot.state` | `{ snapshotId }` | `Snapshot` | `stale`, `noSource`, `invalid`, `busy`, `unavailable`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!MediaCapture.capture MediaCapture.capture} |

### `source`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `source.operation` | `{ operationId }` | `SourceOperation` | `stale`, `replaced`, `invalid`, `aborted`, `busy`, `backend`, `unsupported`, `unavailable`, `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Player.open Player.open}, {@linkcode "@vestra-player/sdk"!Player.setPaused Player.setPaused}, {@linkcode "@vestra-player/sdk"!Player.seek Player.seek}, {@linkcode "@vestra-player/sdk"!Player.setRate Player.setRate}, {@linkcode "@vestra-player/sdk"!Player.restart Player.restart}, {@linkcode "@vestra-player/sdk"!Player.close Player.close}, {@linkcode "@vestra-player/sdk"!Player.scrub Player.scrub}, {@linkcode "@vestra-player/sdk"!MediaSources.open MediaSources.open} |
| `source.state` | — | `SourceState` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!Player.state Player.state}, {@linkcode "@vestra-player/sdk"!Player.refresh Player.refresh} |
| `source.submit` | `{ operationId, intent }` | `SourceOperation` | `stale`, `replaced`, `invalid`, `aborted`, `busy`, `backend`, `unsupported`, `unavailable`, `timeout`, `stream`, `device` | SDK member: {@linkcode "@vestra-player/sdk"!Player.open Player.open}, {@linkcode "@vestra-player/sdk"!Player.openStream Player.openStream}, {@linkcode "@vestra-player/sdk"!Player.setPaused Player.setPaused}, {@linkcode "@vestra-player/sdk"!Player.seek Player.seek}, {@linkcode "@vestra-player/sdk"!Player.setRate Player.setRate}, {@linkcode "@vestra-player/sdk"!Player.restart Player.restart}, {@linkcode "@vestra-player/sdk"!Player.close Player.close}, {@linkcode "@vestra-player/sdk"!Player.scrub Player.scrub} |

### `sourceResolvers`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `sourceResolvers.register` | `{ id, schemes?, hosts?, extensions? }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.respond` | `{ requestId, error }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |
| `sourceResolvers.unregister` | `{ id }` | — | — | SDK member: {@linkcode "@vestra-player/sdk"!Resolvers.add Resolvers.add} |

### `storage`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `storage.session.delete` | `{ key }` | `void` | `invalid`, `disabled`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.delete SessionStorage.delete} |
| `storage.session.get` | `{ key }` | `{ value?: Json }` | `invalid`, `disabled`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.get SessionStorage.get} |
| `storage.session.keys` | — | `string[]` | `disabled`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.keys SessionStorage.keys} |
| `storage.session.set` | `{ key, value }` | `void` | `invalid`, `disabled`, `unsupported`, `limit` | SDK member: {@linkcode "@vestra-player/sdk"!SessionStorage.set SessionStorage.set} |

### `subtitles`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `subtitles.commit` | `{ operationId, uploadId, sha256, resourceId, revision, expected, inputOrigin?, format?, title?, select? }` | `SubtitleState` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.operation` | `{ operationId }` | `{ status, result?, error? }` | `stale`, `invalid`, `missing`, `unavailable`, `busy`, `aborted`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.select Subtitles.select}, {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load}, {@linkcode "@vestra-player/sdk"!Subtitles.remove Subtitles.remove}, {@linkcode "@vestra-player/sdk"!Subtitles.setStyle Subtitles.setStyle} |
| `subtitles.remove` | `{ resourceId, expected, operationId }` | `SubtitleState` | `invalid`, `stale`, `unavailable`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.remove Subtitles.remove} |
| `subtitles.select` | `{ role?, target, expected, operationId }` | `SubtitleState` | `stale`, `invalid`, `missing`, `unavailable`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.select Subtitles.select} |
| `subtitles.state` | — | `SubtitleState` | `disabled`, `stale`, `invalid`, `missing`, `unavailable`, `busy`, `aborted`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.state Subtitles.state}, {@linkcode "@vestra-player/sdk"!Subtitles.onChange Subtitles.onChange}, {@linkcode "@vestra-player/sdk"!Subtitles.refresh Subtitles.refresh}, {@linkcode "@vestra-player/sdk"!Subtitles.select Subtitles.select}, {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load}, {@linkcode "@vestra-player/sdk"!Subtitles.remove Subtitles.remove}, {@linkcode "@vestra-player/sdk"!Subtitles.setStyle Subtitles.setStyle} |
| `subtitles.style` | `{ operationId, revision, expected, style }` | `SubtitleState` | `invalid`, `unsupported`, `stale`, `unavailable`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.setStyle Subtitles.setStyle} |
| `subtitles.upload.append` | `{ uploadId, offset, base64 }` | `SubtitleUpload` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.upload.begin` | `{ uploadId, generation, expectedBytes }` | `SubtitleUpload` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |
| `subtitles.upload.discard` | `{ uploadId }` | `void` | `invalid`, `stale`, `unavailable`, `aborted`, `busy` | SDK member: {@linkcode "@vestra-player/sdk"!Subtitles.load Subtitles.load} |

### `system`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `system.openPath` | `{ path }` | `void` | `missing`, `invalid`, `failed`, `timeout`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!System.openPath System.openPath} |
| `system.openUrl` | `{ url }` | `void` | `invalid`, `timeout`, `failed`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!System.openUrl System.openUrl} |
| `system.reveal` | `{ paths }` | `void` | `missing`, `invalid`, `failed`, `timeout`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!System.reveal System.reveal} |

### `timeline`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `timeline.marks` | — | `WireTimeline` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.marks Timeline.marks}, {@linkcode "@vestra-player/sdk"!Timeline.ranges Timeline.ranges} |
| `timeline.set` | `{ sourceId?, marks }` | `{ applied: boolean }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.layer Timeline.layer} |
| `timeline.setRanges` | `{ sourceId?, ranges }` | `{ applied: boolean }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Timeline.layer Timeline.layer} |

### `ui`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `ui.close` | `{ id }` | `void` | `missing` | SDK member: {@linkcode "@vestra-player/sdk"!Window.close Window.close} |
| `ui.interaction` | `{ slot?, focused, dragging, popupOpen }` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.setInteraction Panel.setInteraction} |
| `ui.markdownScan` | `{ text, base }` | `{ images: string[] }` | `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!Ui.markdown Ui.markdown} |
| `ui.menu` | `{ slot?, items, x, y }` | `void` | `missing`, `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Panel.showMenu Panel.showMenu} |
| `ui.mount` | `{ slot, file, component, global, title?, properties? }` | `{ status, prepareMs, shellGeneration }` | `Error` | SDK member: {@linkcode "@vestra-player/sdk"!Panels.mount Panels.mount} |
| `ui.open` | `{ id, file, properties, callbacks }` | `void` | `conflict` | SDK member: {@linkcode "@vestra-player/sdk"!Windows.create Windows.create} |
| `ui.set` | `{ value?, seq?, more?, id, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Window.set Window.set}, {@linkcode "@vestra-player/sdk"!Window.bind Window.bind} |
| `ui.setMount` | `{ slot?, value?, seq?, more?, property, patch? }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Panel.set Panel.set}, {@linkcode "@vestra-player/sdk"!Panel.bind Panel.bind} |
| `ui.show` | `{ id, visible }` | `void` | `unavailable`, `host`, `missing`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!Window.show Window.show}, {@linkcode "@vestra-player/sdk"!Window.hide Window.hide} |
| `ui.unmount` | `{ slot: MountSlot; } \| undefined` | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Panel.dispose Panel.dispose} |

### `video`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `video.motion.set` | `{ engine, mode }` | `WireMotionState` | `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!VideoMotion.set VideoMotion.set} |
| `video.motion.state` | `{ engine }` | `WireMotionState` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!VideoMotion.state VideoMotion.state} |
| `video.render.release` | — | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.render} |
| `video.render.set` | `{ values }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.render} |
| `video.shaders.set` | `{ id, paths }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.shaders} |
| `video.upscaling.set` | `{ enabled }` | `WireUpscalingState` | `invalid`, `unsupported` | SDK member: {@linkcode "@vestra-player/sdk"!VideoUpscaling.set VideoUpscaling.set} |
| `video.upscaling.state` | — | `WireUpscalingState` | `disabled` | SDK member: {@linkcode "@vestra-player/sdk"!VideoUpscaling.state VideoUpscaling.state} |
| `video.view.release` | — | `void` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.view} |
| `video.view.set` | `{ values }` | `{ state: "applied" \| "waiting" }` | — | SDK member: {@linkcode "@vestra-player/sdk"!Scope.video Plugin.video.view} |

### `window`

| Method | Params | Result | Errors (documented) | Stability |
| --- | --- | --- | --- | --- |
| `window.setAlwaysOnTop` | `{ onTop }` | `void` | `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setAlwaysOnTop MainWindow.setAlwaysOnTop} |
| `window.setCursorAutoHide` | `{ mode }` | `void` | `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setCursorAutoHide MainWindow.setCursorAutoHide} |
| `window.setPictureInPicture` | `{ on }` | `void` | `unsupported`, `unavailable`, `invalid`, `busy`, `failed` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setPictureInPicture MainWindow.setPictureInPicture} |
| `window.setVideoArea` | `{ width, height }` | `{ width, height, clamped }` | `unavailable`, `invalid` | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.setVideoArea MainWindow.setVideoArea} |
| `window.state` | — | `WindowFacts` | — | SDK member: {@linkcode "@vestra-player/sdk"!MainWindow.state MainWindow.state} |

<!-- /generated -->

Events, the other direction, are in [Events](events.md).
