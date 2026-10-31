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
  <a href="https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md">Changelog</a> ·
  <a href="https://vestrasys.github.io/vestra-player-sdk/llms.txt">llms.txt</a>
</p>
## Features

- **One typed API** (`vestra/1`) for commands and menus, windows, panels, settings pages, on-screen messages, playback state and control, video and audio filters, and generated streams.
- **Native user interfaces** written in [Slint](https://slint.dev), with the player's own theme and widgets.
- **Tests without the player**: `@vestra-player/sdk/testing` runs your plugin against an in-memory host with `node --test`.
- **One command line tool**, `vestra-plugin`, to check, test, build and pack a `.vxp` package.
- **The same API on macOS and Windows**; every plugin runs in its own Node.js 26 process that the player ships.
- **A reference for AI assistants**: [`llms.txt`](https://vestrasys.github.io/vestra-player-sdk/llms.txt) (short index) and [`llms-full.txt`](https://vestrasys.github.io/vestra-player-sdk/llms-full.txt) (every declaration, the guides and the examples), also in the package as `@vestra-player/sdk/llms.txt` and `@vestra-player/sdk/llms-full.txt`.

## Install

```sh
npm i -D @vestra-player/sdk   # Node.js 26 or newer
```

## Quick start

`manifest.json` and `main.ts`:

```json
{
  "id": "examples.hello",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": ["commands", "ui.osd"]
}
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

Complete, tested plugins in [`examples/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples). The [examples page](https://vestrasys.github.io/vestra-player-sdk/documents/Examples.html) shows each one with a screenshot and a step-by-step walkthrough.

| Example                                                                                                | What you learn                                                           | Walkthrough                                                                                            |
| ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| [hello](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/hello)                       | The smallest plugin: a manifest, one menu command, an on-screen message. | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Hello.html)                     |
| [blur](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/blur)                         | A video filter driven by one slider in a tool window.                    | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Blur.html)             |
| [signal-generator](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/signal-generator) | Generating video and audio frames yourself: colour bars and a sine tone. | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Signal_generator.html) |
| [bookmark](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/bookmark)                 | A tool window bound to the playback state, with Mark and Jump buttons.   | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Bookmark.html)         |
| [panel-menu](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/panel-menu)             | A sidebar panel with its own right-click menu.                           | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Panel_menu.html)       |
| [menus](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/menus)                       | Radio items, separator groups and a menu item whose title changes.       | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Menus.html)            |
| [theme-widgets](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/theme-widgets)       | A tool window drawn with the player's theme and widgets.                 | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Theme_widgets.html)    |
| [markdown](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/markdown)                 | A window that shows a Markdown document.                                 | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Markdown.html)         |
| [i18n](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/i18n)                         | A plugin in the player's language: English source text, a translation.  | [Step by step](https://vestrasys.github.io/vestra-player-sdk/documents/Counter_%28i18n%29.html)            |

## Documentation

The [documentation site](https://vestrasys.github.io/vestra-player-sdk/) is the one place for everything a plugin author needs:

- **[Tutorials](https://vestrasys.github.io/vestra-player-sdk/documents/Tutorials.html)**: [Getting started](https://vestrasys.github.io/vestra-player-sdk/documents/Getting_started.html), from an empty folder to a packed plugin.
- **[How-to guides](https://vestrasys.github.io/vestra-player-sdk/documents/How-to_guides.html)**: testing, translating and publishing a plugin, responsive sliders, remembering window state.
- **[Reference](https://vestrasys.github.io/vestra-player-sdk/documents/Reference.html)**: capabilities, manifest fields, limits, menus and bindings, platforms, theme, and the [command line](https://vestrasys.github.io/vestra-player-sdk/documents/Command_line.html) (`vestra-plugin check`, `test`, `build`, `pack`, `i18n extract`, `i18n check`).
- **[Explanation](https://vestrasys.github.io/vestra-player-sdk/documents/Explanation.html)**: how a plugin runs, commands and key bindings, playback, video and audio processing, the interface.
- **[Guidelines](https://vestrasys.github.io/vestra-player-sdk/documents/Guidelines.html)**: rules for the interface and the menus.
- **[Examples](https://vestrasys.github.io/vestra-player-sdk/documents/Examples.html)**: the walkthroughs above.
- **[Upgrading](https://vestrasys.github.io/vestra-player-sdk/documents/Upgrading.html)**: what to change when a release deprecates or removes something, with the migration checklists.
- **[API](https://vestrasys.github.io/vestra-player-sdk/modules/_vestra-player_sdk.html)**: every type and member of `@vestra-player/sdk` and `@vestra-player/sdk/testing`.

## Compatibility

Every 1.x release implements the plugin API `vestra/1`: minor releases only add backwards-compatible API, and a breaking change gets a new `apiVersion` and a new major version. Plugins run on the Node.js 26 that the player ships. API added after SDK 1.0 may need a newer player; [Player versions](https://vestrasys.github.io/vestra-player-sdk/documents/Manifest.html#player-versions) lists which API needs which player, for the manifest's `minPlayerVersion`. `@vestra-player/sdk/runtime` is for the player only and not covered by semver.

## Contributing · License

Bug reports, documentation fixes and examples are welcome: see [CONTRIBUTING.md](https://github.com/vestrasys/vestra-player-sdk/blob/main/CONTRIBUTING.md). Licensed under [Apache-2.0](LICENSE).
