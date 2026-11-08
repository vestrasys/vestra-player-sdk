---
title: "Example: Adjust panel"
description: "Walkthrough of examples/adjust-panel: a speed slider in the player's adjust column, opened by its own key, with a command that names it as its home."
---

# Example: Adjust panel

A speed slider in the player's **adjust column**, the column of controls for what is playing. It shows how to choose a slot by what a panel is for, how a key opens the column at your tab, and how `home` puts that key under the tab.

## What it demonstrates

The `"adjust"` slot · {@link "@vestra-player/sdk"!Panel.toggle | Panel.toggle} as the panel's own key · {@link "@vestra-player/sdk"!CommandOptions.home | CommandOptions.home}.

[Open a tool window and remember its state](../guides/windows.md) teaches the view surface panels share with tool windows; [Keep a slider responsive while dragging](../guides/slider.md) covers the slider itself.

## What you'll build

- A **Speed** tab in the adjust column: the speed, a slider from 0.25× to 4×, four presets and **Normal Speed**.
- **Alt+5** opens the adjust column at this tab; pressing it again while the tab is shown closes the column. The player shows `Alt+5` under the tab's title.
- **Normal Speed** is also a command (in the command palette and Keyboard Shortcuts) that lives in this panel.

### Sidebar or adjust?

Ask: after the user closes the panel, do they still look at what it showed? A playlist, chapters or search results: yes, so they are **content** and go in `"sidebar"`. A speed slider: no, it only changes what is playing, so it goes in `"adjust"`. The slot is a contract about purpose; the player decides how the column looks, and that may change.

## Files

```text
examples/adjust-panel/
  manifest.json                   identity and capabilities
  main.ts                         the code
  ui/speed.slint                  the panel
  tests/adjust-panel.test.ts      tests against the SDK's in-memory player
  package.json                    the SDK as a dev dependency, and the scripts
```

## The manifest

{@includeCode ../../examples/adjust-panel/manifest.json}

`playback.read` and `playback.control` read and set the speed; `events` keeps `plugin.player.state` following the player, so the panel enables itself when a file is opened after the plugin started (without it, `state` changes only after the plugin's own calls, and the panel would stay as it was at start-up).

## The panel in Slint

{@includeCode ../../examples/adjust-panel/ui/speed.slint}

- The column is about 317 px wide (280 at least): one column of rows, top to bottom, and four presets in a row, which fit 280 px. A panel wider than its column is clipped to it.
- `rate` is `in-out` so the slider can bind to it two-way (`<=>`) and still follow the speed the plugin writes.
- The player draws the tab strip above the panel and the column's ground; the panel draws its own background in `Theme.bg-list` like the player's panels.

## The code

### Mounting the panel

{@includeCode ../../examples/adjust-panel/main.ts#mount}

- {@link "@vestra-player/sdk"!Panels.mount | plugin.panels.mount} with `"adjust"`; `title` is the tab's label.
- `bind` sends the speed and whether the source can change it; the slider and the presets call `rateChanged`.

### The key and the home

{@includeCode ../../examples/adjust-panel/main.ts#commands}

- `speed` calls {@link "@vestra-player/sdk"!Panel.toggle | panel.toggle}: it opens the column at this tab, or closes the column when this tab is already the one shown, the way the player's own Alt+1…4 work.
- `speed-reset` names `speed` as its `home`. The player then knows that `speed` opens the panel this command lives in: it shows `speed`'s key under the tab, and the command palette shows where **Normal Speed** lives.

## The tests

{@includeCode ../../examples/adjust-panel/tests/adjust-panel.test.ts}

- `host.layout.adjust` is the adjust column as the player reports it; it starts hidden (`preferred: false`).
- `host.mountOther("adjust", …)` adds another plugin's tab, and `host.selectTab` makes it current.

## Run it

```sh
npm ci                    # once, in the SDK repository root
cd examples/adjust-panel
npm install
npm run check && npm test
npm run pack              # examples.adjust-panel-0.1.0.vxp
```

Start the player with `--plugin <path to examples/adjust-panel>` and press Alt+5, or click the bottom bar's Adjustments and Effects button (the sliders).

## Try next

1. **More controls.** Add a fine step (±0.05) as two buttons and two commands with `home: "speed"`; their keys can show next to them with `KeyHint` and `plugin.commands.keys`.
2. **Follow the user.** Listen to `plugin.panels.adjust.onChange` (with `events`) to know when the column opens or closes.
