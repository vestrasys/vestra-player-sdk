---
title: Error codes
description: Every error.code the plugin API rejects or throws with, and what it means.
---

# Error codes

Every failure of the API is an ordinary `Error` with a stable string `code` ({@link "@vestra-player/sdk"!PluginError | PluginError}). Branch on `code`, never on `message`: the message is for logs and people, and it may change or be translated. Which methods fail with which code is in each method's `@throws` in the API reference.

<!-- generated:error-codes -->

| Code | Meaning |
| --- | --- |
| `stale` | A condition no longer held (the source or the subtitle selection changed); nothing was done. See {@link "@vestra-player/sdk"!Conditional}. |
| `capability` | The call is for the player's built-in plugins only (`commands.list`, `commands.run`, `palette.lead`) and this plugin is not one. |
| `invalid` | A bad argument (out of range, malformed, unknown id). |
| `missing` | The target does not exist (an empty panel position, a missing file, an unknown command). |
| `busy` | The player is still doing a previous call of the same kind (a dialog is open, a step is in flight). |
| `conflict` | Another plugin owns the resource (the sequence provider, the display layer, the backdrop, a menu path, the command palette's lead row), or this plugin already uses the id (a window or command id). |
| `unavailable` | Not possible right now (no ready media, no user interface, fullscreen, a disabled core action). |
| `unsupported` | Not possible on this system, build or source (a platform gap, software rendering, a source that cannot seek, a filter on a generated stream, an export the player cannot make as asked: a stream copy, a source bitrate it cannot tell). |
| `backend` | Loading or resolving failed, or mpv failed a command or a property of {@link "@vestra-player/sdk"!Mpv}; `message` is the backend's reason. |
| `refused` | {@link "@vestra-player/sdk"!Mpv}: a command or a property the pass-through does not carry (it would start a program, load code, write files, end the player, or change what the player manages); `message` names it and why. |
| `failed` | The operation ran and failed (`media.ready()` load error, a non-zero `tools.run` exit, the system refused). |
| `replaced` | Accepted, but another source replaced it before it finished. |
| `ended` | {@link "@vestra-player/sdk"!Media.ready}: the media already played to the end. |
| `noSource` | {@link "@vestra-player/sdk"!MediaCapture.capture}: nothing is playing to capture. |
| `released`, `disposed` | A {@link "@vestra-player/sdk"!Snapshot} used after `release()`; an {@link "@vestra-player/sdk"!ExportJob} handle disposed while something still waited for it. |
| `aborted` | An `AbortSignal` fired (`error.name === "AbortError"`). |
| `timeout` | A time limit ran out (`openStream` start-up, `tools.run`, `system.*` after 10 s). |
| `stream`, `device` | `openStream`: the producer failed / the audio device is not ready. |
| `backend-uncertain` | The player's backend blocked a filter stage; call `retry()`. |
| `limit` | A player-wide limit was reached (for example the number of commands), a property value is over the limits of {@link "@vestra-player/sdk"!PropValue}, a request is longer than the player's 1 MiB message, {@link "@vestra-player/sdk"!Commands.run} ran too often, or a client that bypasses the SDK left more than 320 requests or 4 MiB of them unanswered (the player's backstop; the SDK keeps a plugin under it). |
| `reserved` | {@link "@vestra-player/sdk"!Packages.validate}, {@link "@vestra-player/sdk"!PackageCandidate.install}: the id is `vestra` or starts with `vestra.` (any case), which only the player's built-in plugins use. |
| `versionMismatch` | The package needs a newer player (`minPlayerVersion`). |
| `ui-prepare` | The player could not prepare a mounted panel or a settings page (its Slint file does not compile, or a bound property is not declared); `message` has the diagnostics. A panel shown at once rejects its `ready`; a tab mounted in the background is compiled when it is first shown, and its failure goes to {@link "@vestra-player/sdk"!Scope.onError} without a request (see {@link "@vestra-player/sdk"!Panel.ready}). |
| `ui` | The player could not apply a property to a tool window or a settings page, or could not build the Options window (a property the Slint file does not declare, a value of the wrong type); `message` has Slint's reason. Also reported to {@link "@vestra-player/sdk"!Scope.onError} without a request: a callback whose arguments the player could not convert, a property it could not show again when it rebuilt a view (an image file removed since). |
| `host` | Any other failure inside the player; `message` is the player's reason. |
| `disabled` | The plugin is being stopped; pending requests fail with it. {@link "@vestra-player/sdk"!Commands.run}: the command is disabled; `message` has its reason. |
| `ticket` | {@link "@vestra-player/sdk"!Commands.run}: no ticket, or it ended or expired (a ticket comes with {@link "@vestra-player/sdk"!PaletteLeadRun}). |
| `unknown`, `rejected`, `expired` | After a transport problem the SDK could not confirm the outcome (does not happen in normal operation). |
| `activation` | The plugin opened a tool window while its activation was still pending and the player could not track it. |
| `command` | The player could not run or update a command it no longer knows for this plugin (removed meanwhile, or another plugin's). |
| `export-failed`, `source-missing`, `source-changed`, `no-space` | An export job ({@link "@vestra-player/sdk"!ExportJob}) failed: the code of its `outcome.error`, not a rejection; `message` has the worker's or FFmpeg's reason. An export of parts ({@link "@vestra-player/sdk"!MediaCapture.export}) ends `source-missing` when a part's file is gone and `source-changed` when it changed since it was remembered; {@link "@vestra-player/sdk"!MediaSources.open} rejects with them. An export of parts ends `no-space` when the disk has less room than its estimate. |
| `input-overflow` | `openStream` input: the player's queue of physical key transitions was full; the input was revoked and its keys released. |
| `internal` | An internal step of the player failed (keeping an operation's result, a subtitle or media job); `message` has the reason. |
| `javascript`, `slint` | {@link "@vestra-player/sdk"!Packages.validate}: the package's entry module does not pass `node --check` / one of its Slint files does not compile; `message` has the diagnostics. |
| `owner` | A resolver answered a request that belongs to another plugin's resolver. |
| `pending` | An operation with the same token is still running in the player. The SDK waits and asks again, so it rarely reaches a plugin. |
| `producer` | `openStream`: the player refused or lost the generated stream; `message` has the reason. |
| `resolution` | A file or web resolver's result could not be opened; `message` has the reason. |
| `revisionConflict` | {@link "@vestra-player/sdk"!Packages}: the installed revision changed since it was read (another install or uninstall ran). Read again and retry; the SDK passes the revision it read, so this reaches plugins that act on old data. |
| `source-geometry`, `source-geometry-unsupported` | The source's picture size or rotation could not be applied: invalid decoder dimensions / a rotation that is not a multiple of 90°. |
| `previous-crash` | {@link "@vestra-player/sdk"!VideoShaders}, {@link "@vestra-player/sdk"!RenderOptions} `shaders`: plugin shaders are off because the player ended abnormally while they were drawing; clearing still works. Do not retry while refused (the player shows its own OSD line). |
| `source-unavailable` | The source is not ready (still loading, or its time or native binding is not available yet). |
| `unknown-expired` | The player no longer knows the operation or snapshot (it expired or was released). The SDK maps it to `unknownExpired` results where it can; do not resubmit the operation blindly. |

<!-- /generated -->

A refusal by the player (`stale`, `busy`, `conflict`, `invalid`, `unavailable`, `unsupported`) means the call was not carried out. A plain `Error` without a `code` comes from Node.js or from the plugin's own code, not from the API.
