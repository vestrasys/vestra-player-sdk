---
title: Limits
description: The player's runtime limits in one place, with what happens when a plugin goes over one.
---

# Limits

The player bounds what one request may cost it: the limits guard against runaway plugins and are not sizes to aim for. A whole list fits (50,000 playlist rows): bind it and draw it with a Slint `ListView`. The SDK sends row patches and splits a top-level array property larger than one request; any other value, and each row, must fit in one request. The SDK checks the same limits before it sends, so {@link "@vestra-player/sdk/testing"!TestHost | TestHost} hits them too. A name in code style is a constant of `@vestra-player/sdk/testing`.

## Commands

A command added past `perPlugin` or `total` fails with code `limit` (its `ready` rejects and `onError` hears it; during activation the SDK logs and skips it). A declaration past the other limits fails with `invalid`. Disposing a command frees its slot at once.

<!-- generated:limits COMMAND_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `COMMAND_LIMITS.perPlugin` | 160 | Commands one plugin instance may have at the same time. |
| `COMMAND_LIMITS.total` | 1024 | Commands of every plugin plus the player's own, together. |
| `COMMAND_LIMITS.depth` | 8 | Segments of a menu path, the leaf included. |
| `COMMAND_LIMITS.idBytes` | 128 | UTF-8 bytes of a command's local id: ASCII letters, digits, `.`, `_` and `-`. |
| `COMMAND_LIMITS.titleBytes` | 128 | UTF-8 bytes of a title, a text value counted by its English rendering. Like every command text: not empty, no control characters, no whitespace at either end. |
| `COMMAND_LIMITS.segmentBytes` | 80 | UTF-8 bytes of a menu path segment, a text value counted by its English rendering. |
| `COMMAND_LIMITS.groupBytes` | 80 | UTF-8 bytes of a group. |
| `COMMAND_LIMITS.categoryBytes` | 80 | UTF-8 bytes of a category (`CommandOptions.category`), a text value counted by its English rendering. |
| `COMMAND_LIMITS.reasonBytes` | 512 | UTF-8 bytes of a state's reason, as shown in the player's language. |
| `COMMAND_LIMITS.order` | 1000000 | The largest `order` either way: an order is within ±1,000,000. |

<!-- /generated -->

## Bottom-bar buttons

A command's button ({@link "@vestra-player/sdk"!CommandOptions.button | CommandOptions.button}) is never refused for a limit. Each plugin keeps its first declared button; the strip holds the eight lowest by order, and the rest are in its » menu.

<!-- generated:limits BAR_BUTTON_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `BAR_BUTTON_LIMITS.perPlugin` | 1 | Buttons one plugin shows. |
| `BAR_BUTTON_LIMITS.total` | 8 | Buttons in the strip, every plugin together, besides the player's own (8); the rest are in its » menu. |
| `BAR_BUTTON_LIMITS.maxOrder` | 999 | The highest `order`. |

<!-- /generated -->

## Property values

One value written to a window, panel or settings page property ({@link "@vestra-player/sdk"!View.set | View.set}, {@link "@vestra-player/sdk"!View.bind | View.bind} or an initial property). A value over a limit is refused whole with code `limit`; the property keeps what it showed.

<!-- generated:limits UI_VALUE_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `UI_VALUE_LIMITS.depth` | 8 | Nesting depth; the value itself is depth 0. |
| `UI_VALUE_LIMITS.values` | 1048576 | Values in all, counting every array, object, string, number, boolean and null, the value itself included; a Markdown document is one. |
| `UI_VALUE_LIMITS.arrayRows` | 100000 | Rows of one array. |
| `UI_VALUE_LIMITS.stringBytes` | 65536 (64 KiB) | UTF-8 bytes of one string or object field name. |
| `UI_VALUE_LIMITS.textBytes` | 33554432 (32 MiB) | UTF-8 bytes of all strings and field names together, the text of the value's Markdown documents included. |

<!-- /generated -->

## Text values

One {@link "@vestra-player/sdk"!Text | Text} or {@link "@vestra-player/sdk"!TextList | TextList}, with everything nested in it. A text over a limit fails with code `invalid`.

<!-- generated:limits TEXT_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `TEXT_LIMITS.depth` | 8 | Nesting depth of texts and lists; the value itself is depth 0. |
| `TEXT_LIMITS.nodes` | 1024 | Texts, lists and arguments in all, the value itself included. |
| `TEXT_LIMITS.args` | 16 | Arguments of one text. |
| `TEXT_LIMITS.items` | 256 | Items of one list. |
| `TEXT_LIMITS.stringBytes` | 4096 (4 KiB) | UTF-8 bytes of a source text or a string argument. |

<!-- /generated -->

## Markdown

{@link "@vestra-player/sdk"!Ui.markdown | plugin.ui.markdown} and its image downloads. A failed or oversized image shows its alt text; the call does not fail for it. The number of images per document and of blocks shown are on `Ui.markdown`.

<!-- generated:limits MARKDOWN_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| textBytes | 262144 (256 KiB) | Text bytes. |
| imageBytes | 4194304 (4 MiB) | Bytes of one downloaded image. |
| imageTimeoutMs | 10000 (10 s) | Download time per image. |
| redirects | 5 | Redirects followed per image. |
| concurrency | 4 | Downloads at once, per plugin. |
| cacheBytes | 33554432 (32 MiB) | Cache size per plugin. |
| cacheMaxAgeMs | 86400000 (24 h) | An address is fetched again after this long. |

<!-- /generated -->

## On-screen display

Counted on the text as shown, after translation and with its arguments filled in. A text over a limit fails with code `invalid`: {@link "@vestra-player/sdk"!Osd.show | osd.show} rejects, {@link "@vestra-player/sdk"!OsdPanel.set | OsdPanel.set} reports to `Scope.onError`. Font sizes and placement are at {@link "@vestra-player/sdk"!Osd | Osd}.

<!-- generated:limits OSD_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `OSD_LIMITS.messageChars` | 200 | Characters of one `osd.show` message (200; at least 1 that is not white space). Line breaks are shown as spaces. |
| `OSD_LIMITS.panelLines` | 32 | Lines of the information block (`OsdPanel.set`). |
| `OSD_LIMITS.panelBytes` | 4096 (4 KiB) | UTF-8 bytes of the information block. |
| `OSD_LIMITS.minColumns` | 8 | The smallest `OsdPanelOptions.maxColumns`. |
| `OSD_LIMITS.maxColumns` | 1000 | The largest `OsdPanelOptions.maxColumns`. |
| `OSD_LIMITS.actions` | 2 | Action buttons of one `osd.show` message (`OsdShowOptions.actions`). |
| `OSD_LIMITS.actionChars` | 40 | Characters of an action's title, as shown. |

<!-- /generated -->

## Timeline

One plugin's layer of seek-bar marks and ranges ({@link "@vestra-player/sdk"!TimelineLayer | TimelineLayer}), counted per layer; titles are counted as shown, after translation. A list over a limit is refused whole with code `invalid`, reported to `Scope.onError`.

<!-- generated:limits TIMELINE_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `TIMELINE_LIMITS.marks` | 1000 | Marks in one layer (`TimelineLayer.set`). |
| `TIMELINE_LIMITS.ranges` | 100 | Ranges in one layer (`TimelineLayer.setRanges`). |
| `TIMELINE_LIMITS.titleChars` | 100 | Characters of a mark's or a range's title, as shown. |

<!-- /generated -->

## Secrets

{@link "@vestra-player/sdk"!Secrets | plugin.secrets}. A name or value out of its rule fails with code `invalid`; a new name beyond the count fails with `limit`.

<!-- generated:limits SECRET_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `SECRET_LIMITS.nameChars` | 64 | Characters of a name (64, at least 1), each one of `a-z`, `0-9`, `.`, `_` and `-`. |
| `SECRET_LIMITS.valueBytes` | 1024 (1 KiB) | UTF-8 bytes of a value. |
| `SECRET_LIMITS.names` | 256 | Different names one plugin may have stored at the same time. |

<!-- /generated -->

## Session storage

{@link "@vestra-player/sdk"!SessionStorage | plugin.storage.session}. A key out of its rule, or a value that is not JSON, fails with code `invalid`; a `set` that would take the plugin over `bytes` fails with `limit` and changes nothing. Each key counts its UTF-8 bytes, its value as compact JSON and `entryBytes`; one value must also fit in one [message](#messages).

<!-- generated:limits SESSION_STORAGE_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `SESSION_STORAGE_LIMITS.keyBytes` | 1024 (1 KiB) | UTF-8 bytes of a key. |
| `SESSION_STORAGE_LIMITS.bytes` | 1048576 (1 MiB) | Bytes one plugin may hold at the same time: for every key, its UTF-8 bytes, its value written as compact JSON (`JSON.stringify(value)`) and `entryBytes`. |
| `SESSION_STORAGE_LIMITS.entryBytes` | 128 | What each key costs on top of its text and value (128): the player's own bookkeeping, so that many tiny entries stay within `bytes` of memory. |

<!-- /generated -->

## Subtitle files

{@link "@vestra-player/sdk"!Subtitles.load | Subtitles.load}: a file over `fileBytes` fails with `invalid`, every other limit with `busy`. The counts are per source; a load stays counted until the source changes.

<!-- generated:limits SUBTITLE_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `SUBTITLE_LIMITS.fileBytes` | 2097152 (2 MiB) | UTF-8 bytes of one file; a larger one fails with `invalid`. |
| `SUBTITLE_LIMITS.tracksPerPlugin` | 4 | Tracks one plugin has loaded into the current source at the same time. |
| `SUBTITLE_LIMITS.tracks` | 16 | Loaded tracks of every plugin in the current source at the same time. |
| `SUBTITLE_LIMITS.totalBytes` | 16777216 (16 MiB) | Bytes of the loaded tracks of every plugin in the current source together. |
| `SUBTITLE_LIMITS.loadsPerPlugin` | 16 | Loads by one plugin into the current source, removed tracks included. |
| `SUBTITLE_LIMITS.loads` | 128 | Loads by every plugin into the current source, removed tracks included. |
| `SUBTITLE_LIMITS.uploadsPerPlugin` | 2 | Loads of one plugin in progress at the same time. |
| `SUBTITLE_LIMITS.uploads` | 8 | Loads of every plugin in progress at the same time. |

<!-- /generated -->

## Remembered files and exports of their parts

{@link "@vestra-player/sdk"!MediaSources | plugin.media.sources} and {@link "@vestra-player/sdk"!MediaCapture.export | media.export}. An export of parts is an export job: it counts towards the 2 exports one plugin runs at a time (8 in the player).

<!-- generated:limits MEDIA_SOURCE_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| references | 500 | References one plugin may hold; one more fails with `limit`. |
| parts | 100 | Parts of one export or check, at least 1; more fail with `invalid`. |
| partEnd | 86400 | Seconds of a part's end in its file. |
| totalSeconds | 86400 | Seconds of all parts of one export together, as one clip. |
| requests | 4 | `remember`, `get`, `list` and checks one plugin may have the player working on at the same time; one more fails with `busy`. |
| locateInterval | 2 | Seconds between two `locate` dialogs of one plugin; sooner fails with `busy`. |

<!-- /generated -->

## Messages

Every request a plugin sends travels as one protocol line. The plugin's side refuses a longer one with code `limit` before sending it; property values meet their own limits first.

<!-- generated:limits MESSAGE_LIMIT -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `MESSAGE_LIMIT` | 1048576 (1 MiB) | The longest message a plugin may send the player, in UTF-8 bytes of one protocol line with its newline (1 MiB). The player stops a plugin that writes a longer one, so the plugin's side refuses such a request before sending it: it rejects with code `limit`. Property values meet `UI_VALUE_LIMITS` before this. |

<!-- /generated -->

## Requests in flight

The SDK keeps at most 256 of a plugin's requests, and 3 MiB of their lines, sent and not yet answered. A request made beyond that waits in the plugin's own queue and goes out, in the order it was made, when an answer comes in: nothing fails and nothing is reordered, the request is only late. Past 320 unanswered lines or 4 MiB of them per plugin the player answers `limit` (its backstop; it does not stop the plugin); a plugin on the SDK never reaches it, only a client that bypasses the SDK does. The byte figure keeps one more line of `MESSAGE_LIMIT` under it, for the replies that never wait, and counts each line 32 bytes longer than the SDK's estimate (the id's digits, the shared runner's envelope).

- **Per plugin.** Each plugin has its own queue, also each member of the shared runner of the built-ins.
- **Replies never wait.** The answers to the player's own calls (`sourceResolvers.respond`, `producer.ack`, `producer.ackInput`) go out at once, past the queue: the player may hold one of the plugin's requests until such an answer comes (an open waits for the plugin's resolver). `palette.lead.done` is not one of them: it waits in order, behind a `commands.run` of the same ticket. Events the plugin hears are not requests and are not counted.
- **Aborting.** An `AbortSignal` aborted while its request still waits takes it out of the queue, unsent, with `aborted` (`player.open`'s submit, `subtitles.load`'s upload). A request already sent runs to its answer, as before.
- **Stopping.** When the plugin stops, what still waits rejects with `disabled`, as the requests in flight do.
- **Tests.** `TestHost` is behind the same queue: a plugin's tests see the same waiting.

<!-- generated:limits REQUEST_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| inFlight | 256 | Requests one plugin has sent the player and not yet had answered; the next waits in the plugin's queue until an answer comes, under the player's backstop of 320 lines. |
| inFlightBytes | 3145728 (3 MiB) | UTF-8 bytes of those requests' lines together; the next waits unless nothing is in flight. One `MESSAGE_LIMIT` line more stays under the player's backstop of 4 MiB, for the replies that never wait. |

<!-- /generated -->

## Render options

{@link "@vestra-player/sdk"!RenderSettings | RenderSettings}; more shaders fail with `invalid`.

<!-- generated:limits MAX_SHADERS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| Entries of `RenderSettings.shaders` | 16 | mpv user shaders (`.glsl`): absolute paths of existing files, at most 16, in order. They run before the shaders of every plugin's `VideoShaders` handles. |

<!-- /generated -->

## Video primitives

The `convolution` and `lut3d` {@link "@vestra-player/sdk"!VideoNode | VideoNode}s and {@link "@vestra-player/sdk"!VideoShaders | VideoShaders}. Values beyond them fail with `invalid`; more shaders than `shaders` across all plugins fail with `limit`.

<!-- generated:limits VIDEO_PROCESSING_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `VIDEO_PROCESSING_LIMITS.shaders` | 16 | Shaders across every plugin's `plugin.video.shaders()` handles. |
| `VIDEO_PROCESSING_LIMITS.shaderBytes` | 16777216 (16 MiB) | Bytes of one shader file. |
| `VIDEO_PROCESSING_LIMITS.shaderIdBytes` | 128 | Bytes of a shader handle's id. |
| `VIDEO_PROCESSING_LIMITS.lutBytes` | 16777216 (16 MiB) | Bytes of one `lut3d` `.cube` file. |
| `VIDEO_PROCESSING_LIMITS.lutSize` | 65 | Largest `LUT_3D_SIZE` of a `lut3d` file, points per axis. |
| `VIDEO_PROCESSING_LIMITS.lutPathBytes` | 4096 (4 KiB) | Bytes of a `lut3d` file path. |
| `VIDEO_PROCESSING_LIMITS.matrixValue` | 1024 | Largest magnitude of a `convolution` matrix entry. |
| `VIDEO_PROCESSING_LIMITS.rdiv` | 256 | Largest `convolution` `rdiv`. |
| `VIDEO_PROCESSING_LIMITS.bias` | 65535 | Largest `convolution` `bias`. |

<!-- /generated -->

## Plugin processes

The player's plugin supervisor bounds what a plugin's process may cost and how long the player waits for it. These are the player's values, not SDK constants; `TestHost` does not play them.

| Limit | Value | When it is reached |
| --- | --- | --- |
| JavaScript heap of a plugin's process | 512 MB (shared runner of the built-ins: 1024 MB) | V8 ends the process ("ran out of memory"), handled as a crash. `Buffer` contents and addons are not counted. |
| Start timeout, until `runtime.ready` | 60 s (development load: 120 s) | Stopped with `failed`; a waiting click shows "<name> could not start". |
| Start limit | 5 crashes within 10 minutes (development load: 1) | Listed as failed until reloaded or switched back on. |
| Pause before a crashed plugin starts again | 1 s, doubling, at most 60 s (built-ins: 3 s) | Its commands are disabled with the reason meanwhile. |
| Grace of a stop | 5 s (after a fault: 300 ms) | The process is killed. |
| Idle time before standby | 30 s | The plugin goes to standby (stop reason `idle`). |
| A player request awaiting the plugin's reply (a resolution) | 5 min | Stopped with `failed`, handled as a crash. A `busy` command has no limit. |
| Third-party starts at the same time | `min(4, max(2, cores / 2))`, plus 2 for clicks | The start waits for a slot. |
| Held triggers per plugin while it starts | 64 | A click shows "<name> is busy"; a drop or view callback is dropped. |
| Third-party processes | 3 at 2 GiB of memory, 7 at 4 GiB, 14 at 8 GiB, at most 16 | Idle plugins go to standby, used longest ago first; a busy or resident one never does. Under memory pressure every idle third-party plugin goes to standby. |

## Limits documented at their API

- Filter chains: the number of nodes across all plugins, one `frameBlend`, and the range of every node's parameters, at {@link "@vestra-player/sdk"!VideoFilter | VideoFilter}; the audio delay at {@link "@vestra-player/sdk"!AudioFilter | AudioFilter}.
- Generated streams: frame sizes and sample values at {@link "@vestra-player/sdk"!StreamFrame | StreamFrame}; a frame that breaks them ends the stream with `invalid`.
- Manifest fields: [Manifest](manifest.md).
- Running commands for the user (built-in plugins only): 4 runs a second and 30 per ticket, 120 a minute per plugin, a ticket ending 120 s after its last use, and `step`/`of` up to 99, at {@link "@vestra-player/sdk"!Commands.run | Commands.run}; the lead row's text lengths at {@link "@vestra-player/sdk"!PaletteLeadOptions | PaletteLeadOptions}.
