---
title: "Example: Theme widgets"
---

# Example: Theme widgets

A tool window drawn with the player's own theme and controls, so it looks like part of the player: its colours, spacing, buttons, sliders and tooltips.

## What you'll build

![Theme widgets in Vestra Player](../../examples/theme-widgets/screenshot.png)

**Examples ▸ Theme widgets…** opens a small window with:

- a label "Level 50" with a tooltip, a slider in the panel style and a small **Default** button;
- a second slider in the bar style, moving together with the first;
- two icon buttons: a cross (with a tooltip) that resets the level, and a play icon that lights up above 50.

## Files

```text
examples/theme-widgets/
  manifest.json                  identity and capabilities
  main.ts                        the code
  ui/theme-widgets.slint         the window
  tests/theme-widgets.test.ts    a test against the SDK's in-memory player
  package.json                   the SDK as a dev dependency, and the scripts
```

## The manifest

{@includeCode ../../examples/theme-widgets/manifest.json}

`commands` for the menu item, `ui.window` for the window.

## The window

{@includeCode ../../examples/theme-widgets/ui/theme-widgets.slint}

From top to bottom:

- **The imports.** `@vestra/theme.slint` and `@vestra/widgets.slint` are supplied by the player at run time. `Theme` holds the palette, fonts and sizes; `Button`, `Slider` and `ToolTipArea` look like the player's own controls. For editor support, point the Slint language server's library path `vestra` at `node_modules/@vestra-player/sdk/slint/vestra`.
- **The window.** A fixed `width`; `Theme.bg-panel` instead of a hard-coded colour, so the background follows the player's palette.
- **The properties.** `level` is `in-out` because both the plugin and the user change it; `label` is only written by the plugin. `level-changed` reports a drag; `reset` reports the reset buttons.
- **The layout.** `Theme.dialog-padding` and `Theme.font-body` give the spacing and text size of the player's dialogs.
- **`ToolTipArea`** shows its `text` after the pointer rests on its content for 600 ms.
- **The sliders** are bound *two-way* to `level` with `<=>`, so dragging one moves the other at once, inside Slint. `changed` passes the value to the plugin. A one-way binding (`value: root.level`) would be broken by Slint the first time the user moved the slider. `panel: true` is the panel style; without it, the bar style.
- **`Button`** with `text` is a dialog button; `small: true` is the 18-pixel one.
- **Icon buttons** have no `text`; `icon` is SVG-style path data drawn in an `icon-width` × `icon-height` box (14×12 by default). `stroked: true` draws lines instead of filling. `checked` draws the icon in the accent colour.

## The code

### The window and its state

{@includeCode ../../examples/theme-widgets/main.ts#window}

- `level` is the plugin's state, 0 to 1.
- {@link "@vestra-player/sdk"!View.bind | bind} keeps the window's `level` and `label` equal to it.
- `levelChanged` stores the dragged value. `bind` then sends it back, but it is the value the slider already shows, so nothing jumps.
- `reset` sets the state back to 0.5; `bind` moves both sliders and the label.

### The menu command

{@includeCode ../../examples/theme-widgets/main.ts#command}

`run` opens the window, or brings it back if it is hidden.

## The test

{@includeCode ../../examples/theme-widgets/tests/theme-widgets.test.ts}

`emit` plays the user's part (a drag, a click on **Default**); `props` shows what the window displays afterwards.

## Run it

```sh
npm ci                    # once, in the SDK repository root
cd examples/theme-widgets
npm install
npm run check && npm test
npm run pack              # examples.theme-widgets-0.1.0.vxp
```

Start the player with `--plugin <path to examples/theme-widgets>` and choose **Examples ▸ Theme widgets…**.

## Try next

1. **Use the level.** Add `ui.osd` and show the level with `plugin.osd.show` when the slider is released (the `Slider`'s `released` callback).
2. **A text field.** Add `UrlInputRow` from `@vestra/widgets.slint`, the player's input row with confirm and cancel buttons.
3. **More tokens.** The [concept page](../concepts/ui.md) lists every `Theme` token and widget property.
