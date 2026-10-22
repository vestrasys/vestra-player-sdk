---
title: Examples
---

# Examples

Complete plugins in the [`examples/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples) folder of the repository. Each one has a manifest, its source, its Slint files, tests and a short README, and CI checks, tests and packs every one of them against the current SDK, so they always compile. The walkthrough pages explain an example step by step, with the code taken from the example itself.

| Example | Shows | Walkthrough |
| --- | --- | --- |
| [hello](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/hello) | One menu command and an on-screen message: the Quick start, runnable. | [Hello](hello.md) |
| [blur](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/blur) | Real-time Gaussian blur with a menu, a parameter window, a shortcut and remembered settings. | [Blur](blur.md) |
| [signal-generator](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/signal-generator) | A plugin that generates its own video and audio (test patterns, oscilloscope, tones) with live controls and an audio filter. | [Signal generator](signal-generator.md) |
| [bookmark](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/bookmark) | A tool window that remembers the playback position and jumps back to it. | |
| [panel-menu](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/panel-menu) | A sidebar panel with its own right-click menu, panel-only keys and a next/previous sequence. | |
| [core-ui](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/core-ui) | Menus (radio items, groups, changing titles), repeating key bindings, on-screen messages, the shared sidebar, theme widgets. | |
| [markdown](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/markdown) | A Markdown document window with local and remote images; the manifest's display fields. | |

To run one:

```sh
git clone https://github.com/vestrasys/vestra-player-sdk.git
cd vestra-player-sdk && npm ci          # builds the SDK the examples link to
cd examples/hello && npm install
npm run check && npm test && npm run pack
```

Start the player with `--plugin <path to the example>` to try it without packing.
