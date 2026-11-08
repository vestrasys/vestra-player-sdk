---
title: Interface guidelines
description: Rules for a plugin's tool windows, panels, on-screen messages and text, so they match the player's own interface in both palettes and every language.
---

# Interface guidelines

These are the rules the player's built-in plugins follow for their windows, panels and messages. Follow them and your plugin looks like part of the player. They assume you know the five surfaces from [Windows, panels, settings pages, dialogs and the OSD](../explanation/ui.md); token names, sizes, fonts, icons and widgets are listed in [Theme](../reference/theme.md).

All sizes are logical pixels (Slint `px`).

## Choose the smallest surface

- **Feedback is an OSD message, not a window.** Confirm what just happened with {@link "@vestra-player/sdk"!Osd.show | osd.show} ("Bookmark added", a new volume, a new speed). Do not open a dialog to say that something succeeded: the player's own snapshot command saves at once and shows a message; only "Save As…" asks. When the user is likely to want the result next, end the message in a button that runs one of your commands ("Saved clip.mp4 [Show in Folder]", player 0.7.6; {@link "@vestra-player/sdk"!OsdShowOptions | OsdShowOptions}): at most two, short verbs, and never the only way to reach something.
- **Errors are messages too.** A failed load or a failed action shows one sentence in the OSD; in a window the user is working in, a failure state is drawn in `Theme.danger`.
- **No permanent text over the video.** Nothing sits above the video, and diagnostic numbers are not always on: show them in an OSD info block ({@link "@vestra-player/sdk"!Osd.panel | osd.panel}) behind a command with a check mark, off by default (the player's "Playback Info", Tab, works this way).
- **A dialog only for a real question** (before something destructive) or a path (the system file dialogs).
- **Prefer the smallest surface that works**: an OSD message before a dialog, a settings page before a tool window. Every window the user has to close is a cost.
- **Mount a panel only when the plugin's main purpose is to live there.** Panels are shared space; a command that needs a one-click entry point gets a bottom-bar button instead ([Bottom-bar buttons](../explanation/commands.md#bottom-bar-buttons)).

Which surface for which purpose:

- **Confirm that something happened ("Bookmark added", "Speed 1.5×"):** OSD message. A window or dialog would interrupt; the message vanishes by itself.
- **Show a few live numbers while playing (bitrate, A/B loop points):** OSD info block. Needs no Slint and no focus; drawn over the video, also in fullscreen.
- **Content that belongs to the player and stays visible: a playlist, chapters, a custom seek bar:** Panel (sidebar or bottom bar). It follows the main window's layout and fullscreen; a tool window would float elsewhere.
- **Cover art or an idle screen while nothing is playing:** Panel in the `backdrop` slot. It replaces the black video area; one plugin at a time.
- **A tool the user opens, uses and closes: picture adjustments, an inspector, an editor:** Tool window. It has its own title bar and size and does not take space from the video.
- **Preferences that rarely change:** Settings page. Users look for preferences in Options; the player keeps the window and its navigation.
- **A yes/no question before something destructive:** {@link "@vestra-player/sdk"!Dialogs.confirm dialogs.confirm}. Native look and keyboard handling (Enter, Escape); no Slint file.
- **A file or folder from the user:** {@link "@vestra-player/sdk"!Dialogs.openFile dialogs.openFile} and friends. The system dialog is the only one users trust with paths.

The size each surface gets is in [Theme: surface sizes](../reference/theme.md#surface-sizes).

## Theme

- **Use `Theme` tokens for every colour**, never a colour value: hard-coded colours do not follow the user's palette (`vestra` dark or `vestra-light`). `Theme.danger` is for failure states and destructive buttons, `Theme.playing` for what is playing now, `Theme.accent` for hover, "on" and selection marks, `Theme.accent-fill` for progress-like fills (sliders, levels).
- **Over the video, use the OSD's colours.** The video area is dark in both palettes, so text and icons drawn on it (a backdrop, an overlay) use the OSD's white text on a translucent dark plate ([Theme: over the video](../reference/theme.md#over-the-video)), not `Theme.text`, which is dark in `vestra-light`.
- **A check mark on an accent background is white**, in both palettes.
- **Do not set a font family.** Every window uses the system UI font, and Slint falls back per character (CJK included); a fixed family breaks scripts it lacks. For code or aligned numbers use `Theme.font-mono`.
- **Use the four font sizes only**: `Theme.font-xs` (tiny labels), `Theme.font-body` (body text, lists, times), `Theme.font-tab` (tabs, menus), `Theme.font-title` (window and tab titles). Times and counters use tabular digits (`font-feature: tnum`) so they do not jitter.
- **Do not change `Palette.color-scheme`.** The player switches the `std-widgets.slint` controls between their dark and light colours with the palette.

## Icons

- **Icons come from `@vestra/icons.slint`.** Never use a font character as an icon (✓ › ▲ ▼ ▾ × ▶): each system's font draws it differently.
- **Icon colours follow the state**: normal `Theme.text` (or `Theme.text-dim` for small icons), hover or on `Theme.accent`, pressed `Theme.accent-press`, disabled `Theme.icon-disabled`.
- An icon is drawn in its own box, which is its default size; keep it, so rows and buttons line up with the player's.
- For an icon of your own, draw it the same way as the set: lines only, never filled, round caps and joins, the set's line width, kept inside the box ([Theme: icons](../reference/theme.md#icons)).

## Controls

- **Use the player's widgets** from `@vestra/widgets.slint`: `Button` (with a `small` size), `Slider` (the bottom bar style, or `panel: true` in tool windows), `ToolTipArea`, `KeyHint`, `UrlInputRow`. They take their sizes and colours from `Theme`. Other controls come from `std-widgets.slint`.
- **Control sizes are tokens**: `Theme.button-height`, `Theme.button-primary-height` (the main action at the bottom of a dialog), `Theme.button-small-height` (a "Default" button in a row), `Theme.input-height`, `Theme.checkbox-row-height`, `Theme.label-height`, `Theme.form-row-gap`, `Theme.dialog-padding`.
- **Corners**: `Theme.radius-control` for buttons, rows, hover plates and tooltips; `Theme.radius-panel` for menus, floating layers and larger plates.
- **Icon buttons have no separators between them.** Hover and press light a rounded plate behind the icon (`Theme.hover-bg`, `Theme.press-bg`).
- **Explain icon buttons with a tooltip** (`ToolTipArea`), and put long values (a full path) in a tooltip instead of a line of text.
- **Show a control's keys** when a command does what the control does: `KeyHint` caps at the right end of its row, the minus key before the plus key, and the same keys in its tooltip (`ToolTipArea.keys`). Take the labels from `plugin.commands.keys`, never write them by hand, so they follow the user's changes ([Key hints beside controls](../explanation/commands.md#key-hints-beside-controls)).

## Tool windows

- **No heading inside the window.** The title bar already shows the window's `title`.
- **Theme sizes throughout**: buttons, inputs, row spacing and padding from the `Theme` size tokens, body text `Theme.font-body` ([Theme: layouts](../reference/theme.md#layouts)).
- **Adjustments apply at once.** A window that changes picture, sound or subtitles has no "Apply" or "OK": every change takes effect while the user moves the control, and each row has its own "Default" button that resets it. Keep the slider responsive while dragging ([the slider guide](../how-to/slider.md)).
- **Status and error text is one sentence**, written as English source text and translated like every other text ([Translate a plugin](../how-to/i18n.md)). Never show debugging details: task ids, revisions, generations, stack traces.
- **Closing a tool window does not undo its effect.** The window is a way to change a setting, not the setting's owner.

### Small adjustment windows

The player's picture, audio and subtitle tools share one layout; a window of the same kind uses it too:

Use the layout of [Theme: small adjustment windows](../reference/theme.md#small-adjustment-windows): the same width, row height, label column, slider and "Default" button as the player's windows.

### Dialog-like windows

- **A link input is `UrlInputRow`**: the input with **Open** and **Cancel**, Enter accepts and Escape cancels, no history list. The player's own link windows (Open URL, the playlist's Add URL, the plugin store) all use it.
- **Group the fields** of a longer form (storage, format and size, range…) with labels in a right-aligned left column; the main action is a primary button (`Theme.button-primary-height`) at the bottom.
- The [standard close keys](../reference/commands.md#keys-the-system-takes-first) close every tool window; you cannot and need not handle them.

## Panels

- **A sidebar panel has no heading of its own.** The player shows its title in the sidebar's tab strip when there are two or more panels; with one panel there is no strip.
- **No status or path lines in a panel.** Messages go to the OSD; a full path is a tooltip on its row.
- **Show state with colour, not words.** As in the player's playlist: what is playing in `Theme.playing` (with a thin bar at the left, [Theme: layouts](../reference/theme.md#layouts)), what was played in `Theme.text-played`, the selection on `Theme.selected-bg`. A failed item gets the `failed` icon at the end of its row and an OSD message.
- **Lists are plain**: single-line rows, background `Theme.bg-list`, no cards, no stripes, no rounded rows; scroll bars come from `std-widgets.slint` so they follow the palette.
- **Long lists use `ListView`.** A list whose length the user decides (a playlist, search results, files, messages) goes in a `ListView` from `std-widgets.slint`, with the `for` inside it: it creates only the rows in view, so a list of thousands of rows scrolls as smoothly as one of ten. A `for` in a layout builds every row up front. Keep a bare `for` for a short list of a fixed size, such as a row of buttons. [Example: Panel menu](../examples/panel-menu.md) is a panel list drawn this way.
- **Commands of a panel go into its right-click menu**, made of the plugin's commands ({@link "@vestra-player/sdk"!Panel.showMenu | panel.showMenu}); see [Menus](menus.md).
- **The bottom bar is icons only**: no text buttons, no source path, no status text (the source name is in the window title, status is an OSD message).
- **Give the keys back after a list action.** The player's shortcuts (Space, the arrows…) fire while the video has the focus, or when a key bubbles up unaccepted from a panel; a list with keyboard navigation or a text field keeps the keys it accepts. A click on an empty part of a panel never takes the focus from the video. After the user plays or opens an item from your list (Enter, a double click), and on Esc in the list, call `VestraFocus.release()` from `@vestra/focus.slint` (SDK 1.7.0, player 0.7.6, so set `"minPlayerVersion": "0.7.6"`), as desktop players do. In the main window the video takes the focus; in the floating sidebar window, the window's own key scope; elsewhere it does nothing ([Reference: theme › Focus](../reference/theme.md#focus)).

```slint nocheck
import { VestraFocus } from "@vestra/focus.slint";

export global ListBridge {
    callback play(int); // the plugin plays this row
}

// The list's key handler; `current` is the selected row.
component ListKeys inherits FocusScope {
    in property <int> current;
    key-pressed(event) => {
        if event.text == Key.Return { ListBridge.play(root.current); VestraFocus.release(); return accept; }
        if event.text == Key.Escape { VestraFocus.release(); return accept; }
        reject
    }
}
```

### Writing a bottom bar

The bottom bar holds one panel. From player 0.7.6 the player draws the strip of command buttons ({@link "@vestra-player/sdk"!CommandOptions.button | CommandOptions.button}, [Bottom-bar buttons](../explanation/commands.md#bottom-bar-buttons)) itself, at the right end of the bottom slot, its cells on the slot's bottom edge, so they line up with a button row of the same height at the bottom of your bar ([Theme: bar buttons](../reference/theme.md#bar-buttons) has the sizes). It shows the plugins' buttons, a » menu when some do not fit, and the player's own **Command Palette**, **Adjustments and Effects** (player 0.7.6: the adjust column's toggle, `host/adjust`) and **Sidebar** (`host/sidebar`). A bar that replaces the built-in one (`vestra.playback`) places nothing; it shares the width with the strip:

- **Report the least width of your own controls** in `content-min-width`, a public `length` property of the mounted component (`out`; `in` works too), declared on it or on a base component it inherits. The player gives the strip the rest of the bar (less a small margin), so plugin buttons never cover what you need (the built-in bar keeps its five buttons and the time). It must not depend on `BarButtonsHost.width`. Without it the strip takes the width it needs from the right end of the bar.
- **A bar that drops controls of its own also reports its full width** in `content-full-width` (player 0.7.6), a public `length` property declared the same way: your row with every one of its controls shown, whatever the bar shows now. The player then gives the strip only the width beyond it, so as the window narrows every plugin button moves into the » menu before your bar drops a control, and narrowing never brings a button back out of ». With `content-min-width` alone the strip gets the width beyond what your bar shows now: when the bar drops a control, the room it frees can let a plugin button back into the strip. Like `content-min-width`, it must not depend on `BarButtonsHost.width` or on the bar's `width`. A bar whose controls never change needs only `content-min-width`.
- **End your row at the strip**: read `BarButtonsHost.width` from `@vestra/bar-buttons.slint` (read only) and lay your controls out in the width the strip leaves, less the same small margin (as in the example below). Anything optional beyond `content-min-width` shows only while it fits there. To keep an optional control ahead of the plugins' buttons, as the built-in bar does with Fullscreen, count it in `content-min-width` while it fits beside the player's own cells: `BarButtonsHost.fixed` (read only) is how many cells, one cell wide each, your bar must always leave free: the player's own and, while any plugin button exists, the » cell.
- **Decide what goes first when the window narrows.** Plugin buttons move into the » menu first (all of them before your bar drops anything, when you report `content-full-width`); the player's own cells always show. In a very narrow window they may then cover the right end of your row, so keep `content-min-width` small.
- **Do not draw a sidebar toggle or a command palette button of your own**: the strip has the player's (`host/sidebar`, `host/palette`), with their state.
- **`BarButtons` is deprecated** (SDK 1.6.8). A bar that still places it gets that strip instead of the player's (without the palette button and the » menu; the player draws no second strip). Remove it, and the `room` you computed for it, when you add `content-min-width`.

```slint
import { BarButtonsHost } from "@vestra/bar-buttons.slint";

export component MyBar inherits Rectangle {
    height: 40px;
    // Your three 41px buttons and 8px to spare.
    out property <length> content-min-width: 3 * 41px + 8px;
    // A bar that hides an optional fourth button when narrow also reports
    // its row with every control shown (player 0.7.6):
    // out property <length> content-full-width: 4 * 41px + 8px;
    HorizontalLayout {
        x: 0px;
        width: max(0px, root.width - BarButtonsHost.width - 4px);
        height: root.height;
        alignment: start;
        // Your controls …
    }
}
```

## Text

- **Every visible text is English source text** that the player translates ([Translate a plugin](../how-to/i18n.md)). Write short, plain sentences; one sentence per status or error.
- **Leave room for longer languages.** German and French texts are usually longer than English; a Chinese, Japanese or Korean character is about one font size wide, a Latin letter about half. Let labels and buttons grow with their text (layouts, `preferred-width`; the `Button` widget does) instead of fixing widths to the English text.
- **Mixed scripts must render without boxes.** That is why you use the system font (above): the player falls back per character to the system's fonts (on Windows also to a bundled CJK font) ([Theme](../reference/theme.md#sizes-and-fonts)).
- **Data is not translated.** File names, track names and device names show as they are.

## Check your plugin

- Switch the palette (the Appearance commands of the command palette, `Ctrl+Shift+P`) with your windows open: everything should follow at once.
- Switch the interface language (the Language commands of the command palette, used from the next start) to German and to Japanese, and look for clipped or overlapping text.
- Compare your tool window with the player's Picture Adjustments window: same row heights, same buttons, same slider.
