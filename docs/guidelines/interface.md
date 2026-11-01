---
title: Interface guidelines
description: Rules for a plugin's tool windows, panels, on-screen messages and text, so they match the player's own interface in both palettes and every language.
---

# Interface guidelines

These are the rules the player's built-in plugins follow for their windows, panels and messages. Follow them and your plugin looks like part of the player. They assume you know the five surfaces from [Windows, panels, settings pages, dialogs and the OSD](../explanation/ui.md); token names, sizes, fonts, icons and widgets are listed in [Theme](../reference/theme.md).

All sizes are logical pixels (Slint `px`).

## Choose the smallest surface

- **Feedback is an OSD message, not a window.** Confirm what just happened with {@link "@vestra-player/sdk"!Osd.show | osd.show} ("Bookmark added", a new volume, a new speed). Do not open a dialog to say that something succeeded: the player's own snapshot command saves at once and shows a message; only "Save As…" asks.
- **Errors are messages too.** A failed load or a failed action shows one sentence in the OSD; in a window the user is working in, a failure state is drawn in `Theme.danger`.
- **No permanent text over the video.** Nothing sits above the video, and diagnostic numbers are not always on: show them in an OSD info block ({@link "@vestra-player/sdk"!Osd.panel | osd.panel}) behind a command with a check mark, off by default (the player's "Playback Info", Tab, works this way).
- **A dialog only for a real question** (before something destructive) or a path (the system file dialogs).
- **Prefer the smallest surface that works**: an OSD message before a dialog, a settings page before a tool window. Every window the user has to close is a cost.
- **Mount a panel only when the plugin's main purpose is to live there.** Panels are shared space; a command that needs a one-click entry point gets a bottom-bar button instead ([Writing a bottom bar](#writing-a-bottom-bar)).

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

- **Use the player's widgets** from `@vestra/widgets.slint`: `Button` (with a `small` size), `Slider` (the bottom bar style, or `panel: true` in tool windows), `ToolTipArea`, `UrlInputRow`. They take their sizes and colours from `Theme`. Other controls come from `std-widgets.slint`.
- **Control sizes are tokens**: `Theme.button-height`, `Theme.button-primary-height` (the main action at the bottom of a dialog), `Theme.button-small-height` (a "Default" button in a row), `Theme.input-height`, `Theme.checkbox-row-height`, `Theme.label-height`, `Theme.form-row-gap`, `Theme.dialog-padding`.
- **Corners**: `Theme.radius-control` for buttons, rows, hover plates and tooltips; `Theme.radius-panel` for menus, floating layers and larger plates.
- **Icon buttons have no separators between them.** Hover and press light a rounded plate behind the icon (`Theme.hover-bg`, `Theme.press-bg`).
- **Explain icon buttons with a tooltip** (`ToolTipArea`), and put long values (a full path) in a tooltip instead of a line of text.

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

### Writing a bottom bar

The bottom bar holds one panel, and every plugin's command buttons ({@link "@vestra-player/sdk"!CommandOptions.button | CommandOptions.button}) and the player's sidebar toggle show inside it, in a strip the player fills. A bar that replaces the built-in one (`vestra.playback`) must place that strip, or those buttons show nowhere while it is mounted (their menu entries stay):

- **Place `BarButtons`** from `@vestra/bar-buttons.slint` at the right end of the button row, and give it `room`: the width left after your own controls. It shows as many button cells as fit ([Theme: bar buttons](../reference/theme.md#bar-buttons)) and loses them from its outer (left) end inward: of the plugins' buttons the lowest order goes first, and the sidebar toggle goes last. The strip is as wide as the cells it shows, so lay your controls out against its `width`. Do not put it under an `if`: it must exist for the player to see it placed. `first-shown` (out) is the index of the leftmost plugin button shown, if your layout needs it.
- **Decide what goes first when the window narrows.** The built-in bar gives the strip only the room its own buttons and the time leave, so the strip shrinks first, then its Fullscreen button hides, and the time is never cut.
- **Do not draw a sidebar toggle of your own**: the strip has the player's (**Toggle Sidebar**, `host/sidebar`), with its state.
- `vestra-plugin check` warns when a plugin mounts a bottom bar whose Slint file does not import `BarButtons` from `@vestra/bar-buttons.slint`, itself or through the plugin's own Slint files it imports, and the player logs the buttons a mounted bar hides.

```slint
import { BarButtons } from "@vestra/bar-buttons.slint";

export component MyBar inherits Rectangle {
    height: 40px;
    // Your controls on the left, 3 × 41px wide …
    strip := BarButtons {
        x: root.width - self.width - 4px;
        y: 0px;
        room: max(0px, root.width - 3 * 41px - 8px);
    }
}
```

## Text

- **Every visible text is English source text** that the player translates ([Translate a plugin](../how-to/i18n.md)). Write short, plain sentences; one sentence per status or error.
- **Leave room for longer languages.** German and French texts are usually longer than English; a Chinese, Japanese or Korean character is about one font size wide, a Latin letter about half. Let labels and buttons grow with their text (layouts, `preferred-width`; the `Button` widget does) instead of fixing widths to the English text.
- **Mixed scripts must render without boxes.** That is why you use the system font (above): the player falls back per character to the system's fonts (on Windows also to a bundled CJK font) ([Theme](../reference/theme.md#sizes-and-fonts)).
- **Data is not translated.** File names, track names and device names show as they are.

## Check your plugin

- Switch the palette (Settings ▸ Appearance) with your windows open: everything should follow at once.
- Switch the interface language (Settings ▸ Language, used from the next start) to German and to Japanese, and look for clipped or overlapping text.
- Compare your tool window with the player's Picture Adjustments window: same row heights, same buttons, same slider.
