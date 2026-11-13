---
title: Capabilities
description: The eight capabilities a manifest can declare, the API members each one opens, how the plugin store describes it, and what replaced the names of SDK 1.7.
---

# Capabilities

A capability is a boundary, not a feature. A plugin declares one in the manifest's `capabilities` ([Manifest](manifest.md)) when it touches things that are neither its own nor the playback session's:

| The plugin touches | Declares |
| --- | --- |
| Its own things: its commands, windows, panels, settings pages, messages on the video, drops, resolvers, marks (gone when it is disabled) | nothing |
| The playback session: playback, subtitles, filters, upscaling, motion smoothing, snapshots and exports, media sources, the main window, keeping the computer awake | nothing |
| The user's player settings, which outlive the plugin: shortcuts, theme, language, rendering and restart | `player` |
| Other plugins: installing, uninstalling, disabling them, running any command | `plugins` |
| The user's system: the clipboard, the keychain | `clipboard`, `credentials` |

The list is closed: a later player API takes one of these names or needs none. The four reserved names copy the operating systems' own privacy categories; no member needs them yet, and declaring one grants nothing (`vestra-plugin check` reminds you to remove it).

A call to a member whose capability is missing fails with code `capability`. Capabilities limit only the player API: a plugin is a Node.js process with the user's access to files, the network and other programs, which the player neither asks about nor can stop, and the install dialog says so. The store shows the declared capabilities to the user before installing, in the words of the "Shown in the store as" column, and asks again when an update adds one.

<!-- generated:capabilities -->

| Capability | State | Opens | Shown in the store as |
| --- | --- | --- | --- |
| `player` | active | {@linkcode "@vestra-player/sdk"!Appearance.set Appearance.set}, {@linkcode "@vestra-player/sdk"!Appearance.setLanguage Appearance.setLanguage}, {@linkcode "@vestra-player/sdk"!Bindings.list Bindings.list}, {@linkcode "@vestra-player/sdk"!Bindings.set Bindings.set}, {@linkcode "@vestra-player/sdk"!Bindings.reset Bindings.reset}, {@linkcode "@vestra-player/sdk"!Rendering.setPreference Rendering.setPreference}, {@linkcode "@vestra-player/sdk"!Rendering.restartPlayer Rendering.restartPlayer} | Change your player settings (shortcuts, theme, language, rendering) and restart the player |
| `plugins` | active | {@linkcode "@vestra-player/sdk"!Commands.list Commands.list}, {@linkcode "@vestra-player/sdk"!Commands.run Commands.run}, {@linkcode "@vestra-player/sdk"!Packages.validate Packages.validate}, {@linkcode "@vestra-player/sdk"!Packages.validateArchive Packages.validateArchive}, {@linkcode "@vestra-player/sdk"!Packages.setEnabled Packages.setEnabled}, {@linkcode "@vestra-player/sdk"!Packages.reload Packages.reload}, {@linkcode "@vestra-player/sdk"!Packages.uninstall Packages.uninstall} | Install, uninstall and disable other plugins, and run any command, including theirs |
| `clipboard` | active | {@linkcode "@vestra-player/sdk"!Clipboard.readText Clipboard.readText}, {@linkcode "@vestra-player/sdk"!Clipboard.writeText Clipboard.writeText}, {@linkcode "@vestra-player/sdk"!Clipboard.writeImage Clipboard.writeImage} | Read and write the clipboard |
| `credentials` | active | {@linkcode "@vestra-player/sdk"!Secrets.get Secrets.get}, {@linkcode "@vestra-player/sdk"!Secrets.set Secrets.set}, {@linkcode "@vestra-player/sdk"!Secrets.delete Secrets.delete} | Keep sign-in details in the system keychain |
| `camera` | reserved | nothing yet | Use the camera |
| `microphone` | reserved | nothing yet | Use the microphone |
| `screen` | reserved | nothing yet | Record the screen |
| `notifications` | reserved | nothing yet | Send system notifications |

<!-- /generated -->

`plugins` is transitive: a plugin that may run any command acts through every other plugin. A member not in the table needs no capability, and neither does any event ([Events](events.md)): `bindings.onChange` says only that the shortcuts changed, while reading them needs `player`. Tests can check a manifest against the table, {@link "@vestra-player/sdk/testing"!CAPABILITY_INFO | CAPABILITY_INFO}.

## Names before 1.8.0

Until SDK 1.8.0 there were 31 capabilities, one per feature. The player and `vestra-plugin check` refuse a manifest that still lists one, and both name the replacement.

| Old name | Write instead |
| --- | --- |
| `bindings.manage`, `rendering.manage`, `ui.theme` | `player` |
| `plugins.manage`, `commands.run` | `plugins` |
| `secrets` | `credentials` |
| `clipboard` | `clipboard` (unchanged) |
| `commands`, `events`, `playback.read`, `playback.control`, `producer.av`, `source.resolve`, `ui.window`, `ui.mount`, `ui.dialog`, `ui.osd`, `ui.drop`, `ui.settings`, `processing.video`, `processing.audio`, `subtitles.read`, `subtitles.control`, `media.read`, `media.control`, `media.sources`, `window.control`, `timeline.marks`, `video.upscaling`, `video.motion`, `palette.lead` | nothing: delete the line |

Every plugin now behaves as one that declared `events` and `playback.read` did: {@link "@vestra-player/sdk"!Player.state | Player.state} follows the player from the plugin's start, and `onChange` listeners hear changes made elsewhere. `commands.run` and `palette.lead` are no longer for built-in plugins only.

## Catching a missing capability

The player refuses a request whose capability is not declared. The SDK finds such calls earlier, from the player's table of which request needs which capability and the requests each member sends:

- **In the editor**: an error at the member with the quick fix **Add 'clipboard' to manifest.json**, from the TypeScript plugin `@vestra-player/sdk/ts-plugin` listed in `tsconfig.json` (`"plugins": [{ "name": "@vestra-player/sdk/ts-plugin" }]`). In VS Code, choose **TypeScript: Select TypeScript Version** → **Use Workspace Version**. The plugin needs the editor's Node.js to be 22.12 or later.
- **`vestra-plugin check`** reports each use as `file:line:column` and fails; `build` and `pack` run it first ([Command line](cli.md)).

Only the plugin's own code is checked, not `tests/`, `node_modules/`, `dist/` or `vendor/`; the manifest is the nearest `manifest.json` above the file. The check follows types, not names, so destructured members and members of returned objects are found. `plugin.wire.request("clipboard.readText")`, whose capability depends on the method name, is checked when the name is a string literal and reported as unchecked otherwise. Not found: computed names, values typed `any`, plain JavaScript and options that need more than the member. The player's check at run time stays the boundary.
