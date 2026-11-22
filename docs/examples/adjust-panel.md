---
title: "Example: Adjust panel"
description: "Walkthrough of examples/adjust-panel: a speed slider in the player's adjust column, opened by its own key, with a command that names it as its home."
---

# Example: Adjust panel

A speed slider in the player's **adjust column**, the column of controls for what is playing. It shows how to choose a slot by what a panel is for, how a key opens the column at your tab, how `home` puts that key under the tab, and how a panel follows playback only while it is on screen, so the plugin can be stopped while the column is closed.

## What it demonstrates

The `"adjust"` slot · {@link "@vestra-player/sdk"!Panel.toggle | Panel.toggle} as the panel's own key · {@link "@vestra-player/sdk"!CommandOptions.home | CommandOptions.home} · a stream only while the tab is on screen, opened and stopped on `layout.changed` · a `when` condition for the command.

[Open a tool window and remember its state](../guides/windows.md) teaches the view surface panels share with tool windows; [Keep a slider responsive while dragging](../guides/slider.md) covers the slider itself; [Learn what happens in the player without staying up](../guides/events-and-triggers.md) covers the stream while shown.

## What you'll build

- A **Speed** tab in the adjust column: the speed, a slider from 0.25× to 4×, four presets and **Normal Speed**.
- **Alt+5** opens the adjust column at this tab; pressing it again while the tab is shown closes the column. The player shows `Alt+5` under the tab's title.
- **Normal Speed** is also a command (in the command palette and Keyboard Shortcuts) that lives in this panel.

### Sidebar or adjust?

Ask: after the user closes the panel, do they still look at what it showed? A playlist, chapters or search results: yes, so they are **content** and go in `"sidebar"`. A speed slider: no, it only changes what is playing, so it goes in `"adjust"`. The slot is a contract about purpose; the player decides how the column looks, and that may change.

## Files

```text
examples/adjust-panel/
  manifest.json                   identity
  main.ts                         the code
  ui/speed.slint                  the panel
  tests/adjust-panel.test.ts      tests against the SDK's in-memory player
  package.json                    the SDK as a dev dependency, and the scripts
```

## The manifest

{@includeCode ../../examples/adjust-panel/manifest.json}

`minPlayerVersion` is 0.11.0, the first player that sends `layout.changed`. `await plugin.player.read()`, first in `activate`, reads the player's state once; from then on `plugin.player.state` follows the player only while the tab is shown (below).

## The panel in Slint

{@includeCode ../../examples/adjust-panel/ui/speed.slint}

- The column is about 317 px wide (280 at least): one column of rows, top to bottom, and four presets in a row, which fit 280 px. A panel wider than its column is clipped to it.
- `rate` is `in-out` so the slider can bind to it two-way (`<=>`) and still follow the speed the plugin writes.
- The player draws the tab strip above the panel and the column's ground; the panel draws its own background in `Theme.bg-list` like the player's panels.

## The code

### Mounting the panel

{@includeCode ../../examples/adjust-panel/main.ts#mount}

- {@link "@vestra-player/sdk"!Panels.mount | plugin.panels.mount} with `"adjust"`; `title` is the tab's label.

### Following the speed while the tab shows

{@includeCode ../../examples/adjust-panel/main.ts#follow}

- The speed has no event of its own, so the panel follows it with a stream ({@link "@vestra-player/sdk"!Player.stream | plugin.player.stream}): `player.state` is updated at every change and the binding below runs again. The stream is open only while `panel.state.effective` is true, that is while the column is open at this tab.
- `layout.changed` says when the column opens or closes or another tab is chosen. A listener of it does not keep the plugin running: the player starts a stopped plugin to deliver it. Showing the tab starts the plugin too, and the check at `ready` opens the stream for a column that is already open then (the player then keeps the plugin running for that run).
- With the column closed nothing of the plugin follows the player, and the player stops it after its idle time; its tab, its key and **Normal Speed**'s state stay.

### Binding the panel

{@includeCode ../../examples/adjust-panel/main.ts#bind}

- `bind` sends the speed and whether the source can change it; the slider and the presets call `rateChanged`.

### The key and the home

{@includeCode ../../examples/adjust-panel/main.ts#commands}

- `speed` calls {@link "@vestra-player/sdk"!Panel.toggle | panel.toggle}: it opens the column at this tab, or closes the column when this tab is already the one shown, the way the player's own Alt+1…4 work.
- `speed-reset` is enabled by the condition `when.can("rate")`, which the player evaluates itself, also while the plugin is stopped.
- `speed-reset` names `speed` as its `home`. The player then knows that `speed` opens the panel this command lives in: it shows `speed`'s key under the tab, and the command palette shows where **Normal Speed** lives.

## The tests

{@includeCode ../../examples/adjust-panel/tests/adjust-panel.test.ts}

- `host.layout.adjust` is the adjust column as the player reports it; it starts hidden (`preferred: false`).
- `host.mountOther("adjust", …)` adds another plugin's tab, and `host.selectTab` makes it current.
- `host.keepsRunning` is what would keep the plugin running: empty while the column is closed; the current tab and the stream while it is open.

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
2. **Show the speed elsewhere.** A label in the bottom bar follows the speed the same way: a stream while it is on screen.
