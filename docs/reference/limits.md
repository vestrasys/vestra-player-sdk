---
title: Limits
description: The player's runtime limits in one place, with what happens when a plugin goes over one.
---

# Limits

The player bounds what one request may cost it. The limits are guards against runaway plugins, not sizes to aim for: a plugin that needs to come close to one usually needs a different design (send the rows near the view, not the whole list). The SDK checks the same limits before it sends a request, so a plugin's own tests hit them too ({@link "@vestra-player/sdk/testing"!TestHost | TestHost} enforces them). A name in code style is a constant you can import from `@vestra-player/sdk/testing`.

## Commands

A command added past a limit fails with code `limit` (its `ready` rejects; during activation, activation fails). Commands already registered are unaffected, and disposing one frees its slot at once.

<!-- generated:limits COMMAND_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `COMMAND_LIMITS.perPlugin` | 160 | Commands one plugin instance may have at the same time. |
| `COMMAND_LIMITS.total` | 1024 | Commands of every plugin plus the player's own, together. |

<!-- /generated -->

## Property values

One value written to a window, panel or settings page property ({@link "@vestra-player/sdk"!View.set | View.set}, {@link "@vestra-player/sdk"!View.bind | View.bind} or an initial property). A value over a limit is refused whole with code `limit`; the property keeps what it showed.

<!-- generated:limits UI_VALUE_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `UI_VALUE_LIMITS.depth` | 8 | Nesting depth; the value itself is depth 0. |
| `UI_VALUE_LIMITS.values` | 16384 | Values in all, counting every array, object, string, number, boolean and null, the value itself included; a Markdown document is one. |
| `UI_VALUE_LIMITS.arrayRows` | 4096 | Rows of one array. |
| `UI_VALUE_LIMITS.stringBytes` | 65536 (64 KiB) | UTF-8 bytes of one string or object field name. |
| `UI_VALUE_LIMITS.textBytes` | 1048576 (1 MiB) | UTF-8 bytes of all strings and field names together, the text of the value's Markdown documents included. |

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

Counted on the text as shown, after translation and with its arguments filled in. A text over a limit fails with code `invalid`: {@link "@vestra-player/sdk"!Osd.show | osd.show} rejects, {@link "@vestra-player/sdk"!OsdPanel.set | OsdPanel.set} reports to `Scope.onError`.

<!-- generated:limits OSD_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `OSD_LIMITS.messageChars` | 200 | Characters of one `osd.show` message (200; at least 1 that is not white space). Line breaks are shown as spaces. |
| `OSD_LIMITS.panelLines` | 32 | Lines of the information block (`OsdPanel.set`). |
| `OSD_LIMITS.panelBytes` | 4096 (4 KiB) | UTF-8 bytes of the information block. |
| `OSD_LIMITS.minColumns` | 8 | The smallest `OsdPanelOptions.maxColumns`. |
| `OSD_LIMITS.maxColumns` | 1000 | The largest `OsdPanelOptions.maxColumns`. |

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

## Messages

Every request a plugin sends travels as one protocol line. The plugin's side refuses a longer one with code `limit` before sending it; property values meet their own limits first.

<!-- generated:limits MESSAGE_LIMIT -->

| Limit | Value | Meaning |
| --- | --- | --- |
| `MESSAGE_LIMIT` | 1048576 (1 MiB) | The longest message a plugin may send the player, in UTF-8 bytes of one protocol line with its newline (1 MiB). The player stops a plugin that writes a longer one, so the plugin's side refuses such a request before sending it: it rejects with code `limit`. Property values meet `UI_VALUE_LIMITS` before this. |

<!-- /generated -->

## Render options

{@link "@vestra-player/sdk"!RenderSettings | RenderSettings}; more shaders fail with `invalid`.

<!-- generated:limits MAX_SHADERS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| Entries of `RenderSettings.shaders` | 16 | mpv user shaders (`.glsl`): absolute paths of existing files, at most 16, in order. |

<!-- /generated -->

## Limits documented at their API

- Filter chains: the number of nodes across all plugins, one `frameBlend`, and the range of every node's parameters, at {@link "@vestra-player/sdk"!VideoFilter | VideoFilter}; the audio delay at {@link "@vestra-player/sdk"!AudioFilter | AudioFilter}.
- Generated streams: frame sizes and sample values at {@link "@vestra-player/sdk"!StreamFrame | StreamFrame}; a frame that breaks them ends the stream with `invalid`.
- Manifest fields: [Manifest](manifest.md).
