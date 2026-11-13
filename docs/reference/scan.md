---
title: Capability scan
description: The boundary categories vestra-plugin scan reports for a plugin's code, what each covers, how files are read and the JSON it prints.
---

# Capability scan

`vestra-plugin scan` reads a plugin's source and reports which boundaries its code crosses, as one-word categories. The plugin repository runs it for every package and keeps the result in its index; the store shows it before installing and compares it between two versions of a plugin. It is a report for people: it gates nothing. What a plugin may call is still decided by the `capabilities` of its manifest ([Capabilities](capabilities.md)), and a plugin is a Node.js process, so files, the network and other programs are outside the scan.

```text
vestra-plugin scan [plugin-dir...]
```

A plugin directory holds `manifest.json`; the default is the current directory. The scan runs no type check and no build, needs no installed dependencies, and changes nothing.

## Categories

A member is in a category when it changes the user's own settings or the player beyond what the plugin itself contributes (`player`), acts on other plugins (`plugins`), or reaches a resource the system protects (the others). Everything else is in no category: the plugin's own commands, windows, panels and settings pages, the playback session (playback, subtitles, filters, snapshots and exports, the main window), and reading state. Reading is never in a category, except the clipboard and the keychain.

<!-- generated:scan-categories -->

| Category | Covers | API members | Requests by name |
| --- | --- | --- | --- |
| `player` | Changes the user's own player settings, or the player beyond what the plugin itself contributes: shortcuts, theme, language, rendering mode, a restart, mpv driven directly. | `Appearance.set`, `Appearance.setLanguage`, `Bindings.reset`, `Bindings.set`, `Mpv.command`, `Mpv.set`, `Rendering.restartPlayer`, `Rendering.setPreference` | `appearance.set`, `appearance.setLanguage`, `bindings.reset`, `bindings.set`, `mpv.command`, `mpv.set`, `rendering.restart`, `rendering.setPreference` |
| `plugins` | Acts on other plugins: installs, uninstalls, disables or reloads them, or runs any command, theirs included. | `Commands.run`, `PackageCandidate.install`, `Packages.reload`, `Packages.setEnabled`, `Packages.uninstall`, `Packages.validate`, `Packages.validateArchive` | `commands.run`, `packages.*` |
| `clipboard` | Reads or writes the system clipboard. | `Clipboard.readText`, `Clipboard.writeImage`, `Clipboard.writeText` | `clipboard.readText`, `clipboard.writeImage`, `clipboard.writeText` |
| `credentials` | Reads or writes sign-in details in the system keychain. | `Secrets.delete`, `Secrets.get`, `Secrets.set` | `secrets.delete`, `secrets.get`, `secrets.set` |
| `camera` | Uses a camera. No member of the API does today. | — | — |
| `microphone` | Records from a microphone. No member of the API does today. | — | — |
| `screen` | Captures the screen or other windows. No member of the API does today (a snapshot or an export is of the playing video). | — | — |
| `notifications` | Shows system notifications. No member of the API does today (a message on the video is the plugin's own). | — | — |

<!-- /generated -->

`camera`, `microphone`, `screen` and `notifications` are reserved: no member of the API reaches them today, so no plugin is reported with them.

The table is `capability-scan.json` in the package (`@vestra-player/sdk/capability-scan.json`): `categories` has the eight names in this order, each with `about`, `members` (API methods as `Interface.member`) and `requests` (methods of the player's protocol, as [Messages](messages.md) names them; `packages.*` covers the prefix's other methods); `none` has the same lists for everything else. Every method of the API and every method of the player's protocol is in exactly one list.

Some members that need a highlighted capability only read, and are in no category: `Bindings.list`, `Bindings.onChange`, `Commands.list`, `Mpv.get`, `Mpv.observe`. `Packages.validate` and `Packages.validateArchive` are in `plugins`, since their answer is the handle that installs.

## How files are read

| Files | Read | Finds |
| --- | --- | --- |
| TypeScript (`.ts`, `.mts`, `.cts`, `.tsx`) | By type, against this SDK's declarations | A member however its object was reached: `plugin.clipboard.readText()`, an alias, a destructured member, a parameter typed `Clipboard`, `secrets["get"]`. A request by name (`plugin.wire.request("clipboard.readText")`) when its method is one literal string. |
| JavaScript (`.js`, `.mjs`, `.cjs`), and TypeScript that imports no types of `@vestra-player/sdk` | By name, best effort | A member used on something named as its module of `plugin`: `plugin.clipboard.readText`, `clipboard.readText`, `const { readText } = plugin.clipboard`. A call of something named `request` with a literal string. |

Left out: `tests/`, `node_modules/`, `vendor/`, `dist/` and directories whose name starts with a dot, as `vestra-plugin build` leaves them out. A directory with no source outside `dist/` (a built package) is read in `dist/`, by name.

Not found by type: a computed member name (`clipboard[name]`), an object typed `any`. Not found by name: an object reached under another name, a member whose interface is not a module of `plugin` (`PackageCandidate.install`); a name that only looks like a member is counted. A request whose method the scan cannot read, or does not know, is listed in `unchecked` and is not in `uses`.

## Output

One JSON object on standard output for one directory; an array of them, each with `directory` (as given), for several. Exit code 0; 1 with a message on standard error and nothing on standard output when a directory has no `manifest.json`.

```json
{
  "scan": 1,
  "sdk": "1.8.0",
  "plugin": "me.example",
  "version": "1.2.3",
  "uses": ["player", "clipboard"],
  "method": "types",
  "files": { "types": 2, "names": 0 },
  "evidence": {
    "player": [
      { "member": "Mpv.set", "file": "main.ts", "line": 6, "by": "types" }
    ],
    "clipboard": [
      { "request": "clipboard.readText", "file": "lib/copy.ts", "line": 2, "by": "types" }
    ]
  },
  "unchecked": [
    { "file": "main.ts", "line": 11, "message": "a request whose method name is not one literal string: the scan cannot tell what it asks for" }
  ],
  "notes": ["Some requests by name could not be placed (unchecked): what they ask for is not in uses."]
}
```

| Field | Value |
| --- | --- |
| `scan` | The format's version, `1`. It changes when a field changes meaning or goes; new fields do not change it. |
| `sdk` | The version of the SDK that scanned: its table decides the categories. |
| `plugin`, `version` | The manifest's `id` and `version` (`null` when it has none). |
| `uses` | The categories the code uses, each once, in the order of the table above. Empty when it uses none. This is what the index stores and the store shows. |
| `method` | How the files were read: `"types"`, `"names"`, `"mixed"` (some each way) or `"none"` (no files found). With `"names"` or `"mixed"`, `uses` is a best effort. |
| `files` | How many files were read each way: `{ types, names }`. |
| `evidence` | For each category of `uses`, where it was found: `member` (an API member) or `request` (a method requested by name), `file` (relative to the plugin, with `/`), `line` (from 1) and `by` (`"types"` or `"names"`); ordered by file, line and name. |
| `unchecked` | Requests by name the scan could not place: `file`, `line`, `message`. |
| `notes` | Sentences for people: that files were read by name and what that misses, that requests are unchecked, that no files were found. |

Two scans of the same files with the same SDK print the same text.
