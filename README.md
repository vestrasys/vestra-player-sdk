<p align="center"><img src="https://raw.githubusercontent.com/vestrasys/vestra-player-sdk/main/.github/assets/logo.png" width="96" height="96" alt="Vestra Player logo"></p>
<h1 align="center">Vestra Player SDK</h1>
<p align="center"><b>Build plugins for Vestra Player in TypeScript: Slint user interfaces, an in-memory test host and a one-command packager.</b></p>
<p align="center">
  <a href="https://www.npmjs.com/package/@vestra-player/sdk"><img src="https://img.shields.io/npm/v/@vestra-player/sdk?logo=npm&color=cb3837" alt="npm version"></a>
  <a href="https://github.com/vestrasys/vestra-player-sdk/actions/workflows/main.yml"><img src="https://img.shields.io/github/actions/workflow/status/vestrasys/vestra-player-sdk/main.yml?branch=main&label=CI&logo=github" alt="CI"></a>
  <a href="https://vestrasys.github.io/vestra-player-sdk/"><img src="https://img.shields.io/badge/docs-TypeDoc-6f42c1" alt="Documentation"></a>
  <a href="https://www.npmjs.com/package/@vestra-player/sdk"><img src="https://img.shields.io/node/v/@vestra-player/sdk?logo=node.js&logoColor=white" alt="Node.js version"></a>
  <a href="https://github.com/vestrasys/vestra-player-sdk/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@vestra-player/sdk" alt="License"></a>
</p>
<p align="center">
  <a href="https://vestrasys.github.io/vestra-player-sdk/">Documentation</a> ·
  <a href="https://vestrasys.github.io/vestra-player-sdk/documents/Getting_started.html">Getting started</a> ·
  <a href="https://github.com/vestrasys/vestra-player-sdk/tree/main/examples">Examples</a> ·
  <a href="https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md">Changelog</a>
</p>
<p align="center"><img src="https://raw.githubusercontent.com/vestrasys/vestra-player-sdk/main/.github/assets/screenshot.png" width="720" alt="An example plugin's window in Vestra Player"></p>

## Features

- **One typed API** (`vestra/1`) for commands and menus, windows, panels, settings pages, on-screen messages, playback state and control, video and audio filters, and generated streams.
- **Native user interfaces** written in [Slint](https://slint.dev), with the player's own theme and widgets.
- **Tests without the player**: `@vestra-player/sdk/testing` runs your plugin against an in-memory host with `node --test`.
- **One command line tool**, `vestra-plugin`, to check, test, build and pack a `.vxp` package.
- **The same API on macOS and Windows**; every plugin runs in its own Node.js 26 process that the player ships.

## Install

```sh
npm i -D @vestra-player/sdk   # Node.js 26 or newer
```

## Quick start

`manifest.json` and `main.ts`:

```json
{ "id": "examples.hello", "version": "0.1.0", "apiVersion": "vestra/1", "entry": "main.ts", "capabilities": ["commands", "ui.osd"] }
```

```ts
import type { Plugin } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  plugin.commands.add({
    id: "hello",
    path: ["Tools", "Hello"],
    run: () => plugin.osd.show("Hello"),
  });
}
```

Run `npx vestra-plugin pack` to check and package it, or start the player with `--plugin <folder>` to try it right away. This is [`examples/hello`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/hello); [Getting started](https://vestrasys.github.io/vestra-player-sdk/documents/Getting_started.html) adds a window, tests and packaging.

## Examples

| Example | Shows |
| --- | --- |
| [hello](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/hello) | The Quick start: one menu command and an on-screen message. |
| [blur](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/blur) | Real-time Gaussian blur with a menu, a parameter window, a shortcut and remembered settings. |
| [signal-generator](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/signal-generator) | Generates its own video and audio (test patterns, oscilloscope, tones) with live controls and an audio filter. |
| [bookmark](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/bookmark) | A tool window that remembers the playback position and jumps back to it. |
| [panel-menu](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/panel-menu) | A sidebar panel with its own right-click menu and panel-only keys. |
| [core-ui](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/core-ui) | Radio menu items, repeating key bindings, the shared sidebar and the theme widgets. |
| [markdown](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/markdown) | A Markdown document window with images, and the manifest's display fields. |

## Command line

| Command | Does |
| --- | --- |
| `vestra-plugin check [dir...]` | Checks the manifest, then a strict type check of the plugin and its tests. |
| `vestra-plugin test [dir...]` | Runs `node --test` on `tests/*.test.{ts,mjs}`. |
| `vestra-plugin build [dir...] [--version x.y.z]` | Writes `dist/`: types stripped, files copied, manifest versioned. |
| `vestra-plugin pack [dir...] [--version x.y.z] [--out dir]` | Builds, then packs `dist/` as `<id>-<version>.vxp`. |

## Compatibility

| SDK | Plugin API | Vestra Player | Node.js |
| --- | --- | --- | --- |
| 1.0 | `vestra/1` | 0.1 or newer | 22.18 or newer |
| 1.1 | `vestra/1` | 0.2 or newer for the 1.1 additions | 22.18 or newer |
| 1.2 | `vestra/1` | 0.2 or newer | 26 (shipped with the player) |

Minor releases only add backwards-compatible API; a breaking change gets a new `apiVersion` and a new major version. `@vestra-player/sdk/runtime` is for the player only and not covered by semver.

## Contributing · License

Bug reports, documentation fixes and examples are welcome: see [CONTRIBUTING.md](https://github.com/vestrasys/vestra-player-sdk/blob/main/CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
