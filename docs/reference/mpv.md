---
title: mpv
description: The four members of the mpv pass-through, the messages behind them, what it refuses and why, who owns filters and observers, and its limits.
---

# mpv

{@link "@vestra-player/sdk"!Mpv | plugin.mpv} sends mpv's own commands and properties to the player's mpv as they are. It needs the capability `mpv`, a capability of its own that the store highlights before installing ([Capabilities](capabilities.md)). The channel is the SDK's contract: the members, the errors, what is refused and who owns what, all on this page. The names, the arguments and what they do are mpv's, for the mpv the player ships: [commands](https://mpv.io/manual/stable/#list-of-input-commands), [properties](https://mpv.io/manual/stable/#properties), [options](https://mpv.io/manual/stable/#options). They can change with a player version, and the SDK does not track them.

Use a typed member where one exists ({@link "@vestra-player/sdk"!Player | plugin.player}, {@link "@vestra-player/sdk"!Scope.video | plugin.video}, {@link "@vestra-player/sdk"!Subtitles | plugin.subtitles}): it is checked, the test host models it, and a typed filter chain reaches snapshots and exports. A filter added through `plugin.mpv` works on live playback only.

## Members and messages

| Member | Message | Params | Result |
| --- | --- | --- | --- |
| `command(args)` | `mpv.command` | `{ args }`: the command's name, then its arguments (strings, numbers, booleans) | `{ result }`: what the command returns, `null` for most |
| `get(name)` | `mpv.get` | `{ name }` | `{ value }` |
| `set(name, value)` | `mpv.set` | `{ name, value }` | none |
| `observe(name, listener)` | `mpv.observe`, `mpv.unobserve` | `{ name }` | none; the values arrive as the event `mpv.property` with `{ name, value }`: the current one first, then each change |

A command is an array, as in mpv's own client API: no prefix (`no-osd`, `async`) and no property expansion. Values are JSON as mpv gives them: a flag is `true` or `false`, a number a number, a list an array.

| Code | When |
| --- | --- |
| `capability` | The manifest does not declare `mpv`. |
| `invalid` | The shape is wrong: not a command array, a bad argument type, not a property name, no value. |
| `refused` | The command or the property is one the channel does not carry (below). The message names it and why: `mpv command "run" is refused: it starts a program (a plugin starts its own with Node)`. |
| `conflict` | A filter label that another plugin owns. |
| `limit` | Too many observed properties. |
| `backend` | mpv's own error, passed on: `mpv: property not found`, `mpv: property unavailable`, `mpv: invalid parameter`, `mpv: error running command`. |

## What is refused

The rule is closed: a command or a property is refused when it would cross a boundary that is not `mpv`'s (a program, code, files, the clipboard), or change what the player manages itself. Everything else goes to mpv. It is not a sandbox (a plugin is a Node.js process and can start programs and write files itself); it keeps the channel to what only the player can do, and keeps the player's own state true.

<!-- generated:mpv-rules -->

| Category | Refused because | Commands | Properties and options | Refused |
| --- | --- | --- | --- | --- |
| `process` | It starts a program (a plugin starts its own with Node) | `run`, `subprocess` | `ytdl`, `ytdl-format`, `ytdl-raw-options` | writes |
| `code` | It loads scripts or configuration into the player | `load-script`, `load-config-file`, `load-input-conf`, `apply-profile` | `scripts`, `script`, `script-opts`, `include`, `profile`, `config`, `config-dir`, `use-filedir-conf`, `osc`, `load-*` | writes |
| `clients` | It opens a control channel to the player or talks to its other clients | `script-message`, `script-message-to`, `script-binding`, `hook-add`, `hook-continue` | `wid`, `input-ipc-*` | writes |
| `files` | It makes the player write or delete files (a plugin writes its own with Node) | `screenshot`, `screenshot-to-file`, `write-watch-later-config`, `delete-watch-later-config`, `dump-cache`, `ab-loop-dump-cache` | `stream-record`, `stream-dump`, `record-file`, `log-file`, `dump-stats`, `o`, `ao-pcm-file`, `cache-dir`, `demuxer-cache-dir`, `icc-cache`, `icc-cache-dir`, `gpu-shader-cache`, `gpu-shader-cache-dir`, `save-position-on-quit`, `screenshot-*`, `watch-later-*` | writes |
| `quit` | It ends the player | `quit`, `quit-watch-later` | `idle`, `keep-open`, `keep-open-pause`, `force-window` | writes |
| `input` | The keyboard and the mouse are the player's (plugin.commands, plugin.bindings) | `keypress`, `keydown`, `keyup`, `keybind`, `mouse`, `enable-section`, `disable-section`, `define-section`, `begin-vo-dragging`, `context-menu` | `cursor-autohide`, `input-*` | writes |
| `clipboard` | The clipboard has its own capability (plugin.clipboard) | `update-clipboard` | `clipboard`, `clipboard-*` | writes and reads |
| `managed` | The player manages it and keeps its own state of it (use the plugin API's member for it) | `loadfile`, `loadlist`, `stop`, `playlist-next`, `playlist-prev`, `playlist-next-playlist`, `playlist-prev-playlist`, `playlist-play-index`, `playlist-clear`, `playlist-remove`, `playlist-move`, `playlist-shuffle`, `playlist-unshuffle`, `seek`, `revert-seek`, `sub-seek`, `sub-step`, `frame-step`, `frame-back-step`, `ab-loop`, `ab-loop-align-cache`, `sub-add`, `sub-remove`, `sub-reload`, `audio-add`, `audio-remove`, `audio-reload`, `video-add`, `video-remove`, `video-reload`, `rescan-external-files`, `screenshot-raw`, `overlay-add`, `overlay-remove`, `osd-overlay`, `show-text`, `show-progress` | `pause`, `speed`, `volume`, `mute`, `volume-gain`, `ao-volume`, `ao-mute`, `time-pos`, `playback-time`, `percent-pos`, `chapter`, `edition`, `start`, `end`, `length`, `loop`, `loop-file`, `loop-playlist`, `shuffle`, `chapter-list`, `ab-loop-a`, `ab-loop-b`, `ab-loop-count`, `audio-device`, `audio-delay`, `stop-screensaver`, `aid`, `vid`, `sid`, `secondary-sid`, `alang`, `slang`, `vlang`, `audio`, `video`, `sub`, `audio-files`, `audio-file-auto`, `external-files`, `cover-art-auto`, `cover-art-files`, `audio-display`, `embeddedfonts`, `vf`, `af`, `vo`, `ao`, `hwdec`, `hwdec-software-fallback`, `gpu-api`, `gpu-context`, `deinterlace`, `framedrop`, `audio-stream-silence`, `lavfi-complex`, `glsl-shaders`, `video-sync`, `display-fps-override`, `tone-mapping`, `gamut-mapping-mode`, `hdr-compute-peak`, `target-peak`, `interpolation`, `video-zoom`, `video-pan-x`, `video-pan-y`, `video-aspect-override`, `video-rotate`, `video-crop`, `video-scale-x`, `video-scale-y`, `keepaspect`, `panscan`, `fullscreen`, `fs`, `ontop`, `border`, `title`, `geometry`, `window-scale`, `window-minimized`, `window-maximized`, `playlist-*`, `autofit*`, `video-align-*`, `sub-*`, `secondary-sub-*` | writes |

| Command | Rule |
| --- | --- |
| `set`, `del`, `add`, `multiply`, `cycle`, `cycle-values`, `change-list` | Write the property their first argument names: checked as a write of it. |
| `vf` | Only `add`, `pre`, `toggle`, `remove` of one filter with a label of the plugin's own (`@label:…`, not starting with `vestra-` and not `all`); anything else is refused (`filters`). |
| `af` | Only `add`, `pre`, `toggle`, `remove` of one filter with a label of the plugin's own (`@label:…`, not starting with `vestra-` and not `all`); anything else is refused (`filters`). |
| `vf-command`, `af-command` | Only to a filter label of the plugin's own (`refused` otherwise, ${code(MPV_RULES.reservedLabels)} included: mpv reads it as every filter); without a label argument the command is `invalid`. |

<!-- /generated -->

A command's name is looked up as mpv reads it, with `_` for `-` (`cycle_values` is `cycle-values`, `quit_watch_later` is refused as `quit-watch-later` is); the refusal names it as it was written. A property is looked up by its name before the first `/`, without an `options/` or `file-local-options/` prefix, exactly as written: mpv folds neither `_` nor case in a property's name, so another spelling is not that property. Reading is never refused, except the clipboard. A command or property this table does not name is not refused; mpv answers for it.

## Filters

A plugin adds filters to mpv's chains with `["vf", "add", "@label:filter"]` (`af` for sound), one labelled filter per command. The label is the plugin's handle on it:

- **One owner.** The plugin that adds a label owns it in that chain. Another plugin's command on it fails with `conflict`; the label `all` is refused (mpv reads it as every filter of the chain; `ALL` or `all2` is an ordinary label), and a label starting with `vestra-` is the player's and is refused.
- **Gone with the plugin.** When the plugin stops (disabled, uninstalled, crashed, the player quits), the player removes its filters. While it owns one, the player keeps it running.
- **Beside the player's own.** The typed chains of `plugin.video.filter` and `plugin.audio.filter`, the upscaler and motion smoothing are filters of the player's in the same chain; they stay. The order is mpv's: `add` appends, `pre` puts first. Whole-chain changes (`set`, `clr`, a write of the `vf` or `af` property) are refused.
- **Checked by the result.** The player compares the chain before and after: if a command changed anything but the plugin's own labelled filter, it puts the chain back and answers `refused`.

## Properties and observers

- **A property set stays set** after the plugin stops, until the player quits, which is what the capability `mpv` discloses. mpv does not save it for the next start. A plugin that wants it back reads the value first and sets it back.
- **Observers end with the plugin**, and with the handle `observe` returns. While one exists the player keeps the plugin running. The player sends the newest value at most every 100 ms for each property.

## Limits

<!-- generated:limits MPV_LIMITS -->

| Limit | Value | Meaning |
| --- | --- | --- |
| args | 32 | Elements of one command, its name included. |
| nameChars | 128 | Characters of a command or property name. |
| labelChars | 64 | Characters of a filter label, after the `@`. |
| observed | 64 | Different properties one plugin observes at the same time. |
| observeIntervalMs | 100 | A property's changes reach an observer at most this often; the newest value wins. |

<!-- /generated -->

## Testing

{@link "@vestra-player/sdk/testing"!TestHost.mpv | TestHost.mpv} records the commands, answers `get` from a map of values a test presets, applies the refusals of this page and keeps the owners of filter labels; {@link "@vestra-player/sdk/testing"!TestHost.setMpvProperty | setMpvProperty} changes a value as mpv would. It runs no mpv: a command's effect on playback is not simulated.
