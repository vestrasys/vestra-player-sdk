---
title: Design rules
description: The rules the player's built-in plugins follow for surfaces, theme, windows, panels, menus, keys and text, and the rules every plugin follows to stay independent and portable.
---

# Design rules

**Goal:** make a plugin that feels like part of the player.

These are the rules the built-in plugins follow. Token names, sizes, icons and widgets are in [Theme](../reference/theme.md); menu ids, orders and default keys in [Commands](../reference/commands.md).

## Steps

### Choose the smallest surface

- **Feedback is an OSD message**, not a window or a dialog ("Bookmark added"). It may end in at most two buttons that run your commands ("Saved clip.mp4 [Show in Folder]"), never the only way to reach something.
- **Errors are messages too**: one sentence in the OSD, or `Theme.danger` text in an open window.
- **Nothing sits permanently over the video.** Live numbers go in an OSD info block ({@link "@vestra-player/sdk"!Osd.panel | osd.panel}) behind a checked command, off by default.
- **A dialog only for a real question** before something destructive, or for a path (the system file dialogs).
- **A settings page** for preferences that rarely change; a **tool window** for a tool the user opens, uses and closes.
- **A panel only when living there is the plugin's main purpose** (a playlist, chapters; the `backdrop` slot for cover art while nothing plays). A one-click entry point is a bottom-bar button (`button` in the command's options).

### Use the theme

- **Every colour is a `Theme` token**, never a colour value, so it follows the dark and light palettes: `Theme.danger` for failures, `Theme.playing` for what plays now, `Theme.accent` for hover and selection, `Theme.accent-fill` for fills.
- **Over the video, use the OSD's colours** (white text on a translucent dark plate, [Over the video](../reference/theme.md#over-the-video)), not `Theme.text`. A check mark on an accent background is white.
- **Do not set a font family**: the system UI font falls back per character, CJK included. Use `Theme.font-mono` for code or aligned numbers.
- **Use the four font sizes only** (`font-xs`, `font-body`, `font-tab`, `font-title`). A time or counter whose digits must not shift while it changes uses `Theme.font-mono`: Slint has no font-feature setting, so tabular digits cannot be asked of the UI font.
- **Do not change `Palette.color-scheme`**: the player switches it with the palette.

### Use the player's icons and controls

- **Icons come from `@vestra/icons.slint`**, never a font character (✓ › ▲ ▼ ×), at their box size and coloured by state ([Icons](../reference/theme.md#icons)). An icon of your own is drawn like the set: lines only, round caps.
- **Controls come from `@vestra/widgets.slint`** (`Button`, `Slider`, `ToolTipArea`, `KeyHint`, `UrlInputRow`), other controls from `std-widgets.slint`. Sizes, gaps, padding and corners are `Theme` tokens.
- **Icon buttons have no separators** and a tooltip each; a long value (a full path) is a tooltip too.
- **Show a control's keys** with `KeyHint` at the right end of its row and in its tooltip, taking the labels from `plugin.commands.keys`, never by hand.

### Build tool windows the player's way

- **No heading inside the window**: the title bar shows its `title`.
- **Adjustments apply at once.** No "Apply" or "OK": each row has its own "Default" button, and closing the window undoes nothing. Keep sliders responsive ([slider guide](./slider.md)); small adjustment windows use the [shared layout](../reference/theme.md#small-adjustment-windows).
- **Status and error text is one translated sentence**: never task ids, revisions or stack traces.
- **A link input is `UrlInputRow`.** A longer form groups its fields with right-aligned labels and ends in one primary button.
- The standard close keys close every tool window; you need not handle them.

### Build panels the player's way

- **No heading, status line or path line in a panel.** The sidebar's tab strip shows its title; messages go to the OSD; a path is a tooltip.
- **Show state with colour, not words**: `Theme.playing`, `Theme.text-played`, `Theme.selected-bg`; a failed item gets the `failed` icon and an OSD message.
- **Lists are plain**: single-line rows on `Theme.bg-list`, no cards, stripes or rounded rows. A list whose length the user decides is a `ListView` from `std-widgets.slint`; keep a bare `for` for a short fixed list.
- **A panel's commands go into its right-click menu** ({@link "@vestra-player/sdk"!Panel.showMenu | panel.showMenu}); keys that act on its content are bindings with `focus: "panel"`.
- **Give the keys back after a list action.** After the user plays or opens an item (Enter, a double click), and on Escape, call `VestraFocus.release()` from `@vestra/focus.slint` ([Focus](../reference/theme.md#focus)).
- **The bottom bar is icons only.** The player draws the command-button strip, sidebar toggle and palette button at its right end; draw none of your own. Report your controls' least width in `content-min-width` (and their full width in `content-full-width` if the bar drops controls when narrow), and lay your row out in the width `BarButtonsHost.width` leaves ([Bar buttons](../reference/theme.md#bar-buttons)).

### Put commands where users look

- **By subject, not by plugin**: a video filter in Video, a subtitle tool in Subtitles, an open-something in Open. A domain of your own gets a submenu named after the domain (Games), not the plugin.
- **Look for an existing item first** in [Built-in commands](../reference/commands.md#built-in-commands); do not duplicate the player or scatter one feature over several menus.
- **Keep the top level short**: it holds Open ▸, Close, Play/Pause, Tools ▸, Options… and Quit, plus the domain menus. A tool, or an item that shows a window, goes into Tools ▸ (`["@tools", "Screen Ruler…"]`); a domain of your own is one top-level submenu ([The top level](../reference/commands.md#the-top-level)). No "File" or "View" menu.
- **Name a built-in menu by its id** (`["@video", "Blur"]`). Without an `order` your item goes after the player's; give your related items a `group` of their own.
- **Resets go under `@reset`**, titled by what they reset without the word Reset (`["@reset", "Picture"]`), grouped per domain, and nowhere else.
- **Shared submenus merge by their English words**: write them exactly as [Submenu keys in use](../reference/commands.md#submenu-keys-in-use) does, and ask the maintainers to register a new one.

### Title menu items

- **Title Case, short.** End with `…` (one character) when the item opens a window or asks before acting.
- **A toggle has a check mark; exclusive choices are radio items** in one group.
- **No key names in titles**: the menu shows the binding.
- **Dynamic items are data**, shown as they are; cap long lists.
- **Keep unavailable items, disabled, with a `reason`.** An empty dynamic list shows one disabled item that says so.
- In documentation and messages, write menu paths with `▸`, never `▶`.

### Choose default keys sparingly

- **Give a default only to a command people repeat often**, on an unused key: a colliding default simply does nothing.
- **Write `Ctrl`, not `Cmd`**: on macOS it fires for both.
- **Avoid the [keys the system takes first](../reference/commands.md#keys-the-system-takes-first)**; bindings fire only in the main window.

### Write text for every language

- **Every visible text is English source text** the player translates ([Add settings and translations](./i18n.md)): short, plain, one sentence per status or error.
- **Leave room for longer languages**: let labels and buttons grow with their text instead of fixing widths.
- **Data is not translated**: file, track and device names show as they are.

### Follow the plugin rules

- **Only the public SDK**: `@vestra-player/sdk` with `import type`, `@vestra-player/sdk/testing` only in tests.
- **No other plugins**: no importing, reading or private talking to another plugin. A plugin runs alone.
- **No system commands** (`cmd`, `open`): use `plugin.system`, `plugin.clipboard`, `plugin.tools` or portable Node.js code.
- **macOS and Windows**: paths with `node:path`, package paths with `/`, and handle `unsupported` where a method documents a platform difference.
- **Your own id**, `<owner>.<name>` with your GitHub user or organization; `vestra.*` is reserved.

### Check your plugin

Switch the palette (Appearance commands, `Ctrl+Shift+P`) with your windows open: everything follows at once. Switch the language to German and Japanese and look for clipped text. Compare your tool window with the player's Picture Adjustments window.

## Complete example

A blur tool that follows the rules: it lives in Video and opens a window (`…`), is greyed out with a reason while nothing plays, confirms with an OSD template, and puts its reset under `@reset`.

```ts
import type { Plugin } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  let amount = 0;
  const filter = plugin.video.filter("blur");
  const apply = () =>
    filter.set(amount ? [{ kind: "gblur", sigma: amount, steps: 3 }] : []);
  const blurWindow = plugin.windows.create("ui/blur.slint");
  blurWindow.bind(() => ({ amount }));
  blurWindow.on("amountChanged", (value: number) => {
    amount = value;
    apply(); // applies at once: no Apply button
  });

  const playing = () => plugin.player.state.phase === "ready";
  plugin.commands.add({
    id: "blur",
    path: ["@video", "Blur…"], // by subject; … opens a window
    enabled: playing,
    reason: () => (playing() ? null : plugin.i18n.text("Nothing is playing")),
    run: () => blurWindow.show(),
  });
  plugin.commands.add({
    id: "blur.reset",
    path: ["@reset", "Blur"], // no word "Reset" in the title
    group: "reset-video",
    run: () => {
      amount = 0;
      apply();
      return plugin.osd.show("Blur {}", [amount]); // a template
    },
  });
}
```

## See also

- [Theme](../reference/theme.md): tokens, fonts, icons, widgets, layouts.
- [Commands](../reference/commands.md): built-in menus, orders, default keys.
- [Publish a plugin](./publish.md): what the store requires on top of these rules.
