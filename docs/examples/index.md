---
title: Examples
---

# Examples

Complete plugins from the [`examples/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples) folder. CI checks, tests and packs every one of them against the current SDK, so they always compile. Each walkthrough explains an example step by step, with the code taken from the example itself.

To run one, see [Running an example](#running-an-example) at the end of this page.

## Hello

![Hello in Vestra Player](../../examples/hello/screenshot.png)

The smallest complete plugin, and the README's Quick start: **Tools → Hello** shows an on-screen message.

**You learn:** the manifest and capabilities · a menu command · the on-screen display.

[Walkthrough](hello.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/hello)

## Blur

![The Blur window over a playing video](../../examples/blur/screenshot.png)

A live Gaussian blur over the video that is playing, with an on/off switch, a strength slider and presets.

**You learn:** video filters and their status · a tool window with live controls (set versus bind, the latest value wins while dragging) · a checkable menu item in the player's **Video** menu · a shortcut · a settings page · remembering state between runs · clean disposal.

[Walkthrough](blur.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/blur)

## Signal generator

![Signal generator: the oscilloscope and the control window](../../examples/signal-generator/screenshot.png)

A plugin that generates its own video and audio — colour bars, a moving grid, an oscilloscope of its own waveform, a timecode overlay and test tones — and plays them in the player like any other source.

**You learn:** generated streams (the player pulls frames, never concurrently, not while paused) · audio samples per video frame · phase-continuous oscillators · drawing RGBA frames without allocations · what audio filters can and cannot process · stopping a stream in the right order.

[Walkthrough](signal-generator.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/signal-generator)

## Bookmark

![Bookmark in Vestra Player](../../examples/bookmark/screenshot.png)

**Playback → Bookmark…** opens a small tool window that remembers the current position and jumps back to it.

**You learn:** a tool window whose properties are bound to the playback state · handling its buttons.

[Walkthrough](bookmark.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/bookmark)

## Panel menu

![Panel menu in Vestra Player](../../examples/panel-menu/screenshot.png)

A list in the sidebar with its own right-click menu. It takes the sidebar, so do not load it together with a playlist plugin.

**You learn:** mounting a sidebar panel through a Slint global · a right-click menu made of the plugin's commands.

[Walkthrough](panel-menu.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/panel-menu)

## Menus

![Menus in Vestra Player](../../examples/menus/screenshot.png)

An **Examples** menu that sets the playback speed with radio items, and an item whose title shows the speed.

**You learn:** radio items · order and separator groups · changing an item's title by rebuilding a child scope.

[Walkthrough](menus.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/menus)

## Theme widgets

![Theme widgets in Vestra Player](../../examples/theme-widgets/screenshot.png)

A tool window drawn with the player's own theme and controls: sliders, buttons, icon buttons and tooltips.

**You learn:** `@vestra/theme.slint` and `@vestra/widgets.slint` · a slider bound two-way to a property.

[Walkthrough](theme-widgets.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/theme-widgets)

## Markdown

![Markdown in Vestra Player](../../examples/markdown/screenshot.png)

**Examples → Markdown example…** shows a Markdown document in a window.

**You learn:** `plugin.ui.markdown` and `MarkdownView` · images relative to the package · packing a non-code file.

[Walkthrough](markdown.md) · [Source](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/markdown)

## Running an example

```sh
git clone https://github.com/vestrasys/vestra-player-sdk.git
cd vestra-player-sdk && npm ci          # builds the SDK the examples link to
cd examples/hello && npm install
npm run check && npm test && npm run pack
```

Start the player with `--plugin <path to the example>` to try it without packing.
