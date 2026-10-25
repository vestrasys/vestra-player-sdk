---
title: Interface guidelines
description: Rules for a plugin's tool windows, panels, on-screen messages and text, so they match the player's own interface in both palettes and every language.
---

# Interface guidelines

These are the rules the player's built-in plugins follow for their windows, panels and messages. Follow them and your plugin looks like part of the player. They assume you know the five surfaces from [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md); token names, sizes, fonts, icons and widgets are listed in [Theme](../reference/theme.md).

All sizes are logical pixels (Slint `px`).

## Choose the smallest surface

- **Feedback is an OSD message, not a window.** Confirm what just happened with {@link "@vestra-player/sdk"!Osd.show | osd.show} ("Bookmark added", a new volume, a new speed). Do not open a dialog to say that something succeeded: the player's own snapshot command saves at once and shows a message; only "Save As…" asks.
- **Errors are messages too.** A failed load or a failed action shows one sentence in the OSD; in a window the user is working in, a failure state is drawn in `Theme.danger`.
- **No permanent text over the video.** Nothing sits above the video, and diagnostic numbers are not always on: show them in an OSD info block ({@link "@vestra-player/sdk"!Osd.panel | osd.panel}) behind a command with a check mark, off by default (the player's "Playback Info", Tab, works this way).
- **A dialog only for a real question** (before something destructive) or a path (the system file dialogs). See [Choosing a surface](../concepts/ui.md).

## Theme

- **Use `Theme` tokens for every colour**, never a colour value: hard-coded colours do not follow the user's palette (`vestra` dark or `vestra-light`). `Theme.danger` is for failure states and destructive buttons, `Theme.playing` for what is playing now, `Theme.accent` for hover, "on" and selection marks, `Theme.accent-fill` for progress-like fills (sliders, levels).
- **Over the video, use the OSD's colours.** The video area is dark in both palettes, so text and icons drawn on it (a backdrop, an overlay) are white (`#ffffff`) on a translucent dark plate (`#0b0a10c4`), not `Theme.text`, which is dark in `vestra-light`.
- **A check mark on an accent background is white**, in both palettes.
- **Do not set a font family.** Every window uses the system UI font, and Slint falls back per character (CJK included); a fixed family breaks scripts it lacks. For code or aligned numbers use `Theme.font-mono`.
- **Use the four font sizes only**: `Theme.font-xs` (tiny labels), `Theme.font-body` (body text, lists, times), `Theme.font-tab` (tabs, menus), `Theme.font-title` (window and tab titles). Times and counters use tabular digits (`font-feature: tnum`) so they do not jitter.
- **Do not change `Palette.color-scheme`.** The player switches the `std-widgets.slint` controls between their dark and light colours with the palette.

## Icons

- **Icons come from `@vestra/icons.slint`.** Never use a font character as an icon (✓ › ▲ ▼ ▾ × ▶): each system's font draws it differently.
- **Icon colours follow the state**: normal `Theme.text` (or `Theme.text-dim` for small icons), hover or on `Theme.accent`, pressed `Theme.accent-press`, disabled `Theme.icon-disabled`.
- An icon is drawn in its own box, which is its default size; keep it, so rows and buttons line up with the player's.
- For an icon of your own, draw it the same way: lines only, never filled, round caps and joins, 1.5px wide (1.25px for icons of 12px or less), kept inside the box.

## Controls

- **Use the player's widgets** from `@vestra/widgets.slint`: `Button` (21px high; `small` 18px), `Slider` (the bottom bar style, or `panel: true` in tool windows), `ToolTipArea`, `UrlInputRow`. They take their sizes and colours from `Theme`. Other controls come from `std-widgets.slint`.
- **Control sizes are tokens**: `Theme.button-height`, `Theme.button-primary-height` (the main action at the bottom of a dialog), `Theme.button-small-height` (a "Default" button in a row), `Theme.input-height`, `Theme.checkbox-row-height`, `Theme.label-height`, `Theme.form-row-gap`, `Theme.dialog-padding`.
- **Corners**: `Theme.radius-control` for buttons, rows, hover plates and tooltips; `Theme.radius-panel` for menus, floating layers and larger plates.
- **Icon buttons have no separators between them.** Hover and press light a rounded plate behind the icon (`Theme.hover-bg`, `Theme.press-bg`).
- **Explain icon buttons with a tooltip** (`ToolTipArea`), and put long values (a full path) in a tooltip instead of a line of text.

## Tool windows

- **No heading inside the window.** The title bar already shows the window's `title`.
- **Theme sizes throughout**: buttons and inputs 21px, form rows 24–26px apart, padding 8–14px, body text `Theme.font-body`.
- **Adjustments apply at once.** A window that changes picture, sound or subtitles has no "Apply" or "OK": every change takes effect while the user moves the control, and each row has its own "Default" button that resets it. Keep the slider responsive while dragging ([the slider guide](../how-to/slider.md)).
- **Status and error text is one sentence**, written as English source text and translated like every other text ([Translate a plugin](../how-to/i18n.md)). Never show debugging details: task ids, revisions, generations, stack traces.
- **Closing a tool window does not undo its effect.** The window is a way to change a setting, not the setting's owner.

### Small adjustment windows

The player's picture, audio and subtitle tools share one layout; a window of the same kind uses it too:

| Part                          | Size and style                                                                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Window                        | 301 wide, at most 320 × 280; background `Theme.bg-bar`; content 8 from the left and right edges (285 usable)                                |
| Tabs (if any)                 | 31 high, 74 wide, text `Theme.font-tab` in `Theme.text-dim`; the current tab in `Theme.text` with a short `Theme.accent-fill` line under it |
| Page                          | background `Theme.bg-panel`                                                                                                                 |
| Row                           | 24 high: label 65 wide, right-aligned, `Theme.font-body`; `Slider` with `panel: true`, 154 × 12; a small "Default" button, 41 × 18          |
| Toggle buttons (flip, rotate) | 46 × 22; choice buttons 51 × 22 (69 wide for longer labels)                                                                                 |

### Dialog-like windows

- **A link input is `UrlInputRow`**: the input with **Open** and **Cancel**, Enter accepts and Escape cancels, no history list. The player's own link windows (Open URL, the playlist's Add URL, the plugin store) all use it.
- **Group the fields** of a longer form (storage, format and size, range…) with labels in a right-aligned left column; the main action is a primary button (`Theme.button-primary-height`) at the bottom.
- The [standard close keys](../reference/commands.md#keys-the-system-takes-first) close every tool window; you cannot and need not handle them.

## Panels

- **A sidebar panel has no heading of its own.** The player shows its title in the sidebar's tab strip when there are two or more panels; with one panel there is no strip.
- **No status or path lines in a panel.** Messages go to the OSD; a full path is a tooltip on its row.
- **Show state with colour, not words.** As in the player's playlist: what is playing in `Theme.playing` (with a 2px bar at the left), what was played in `Theme.text-played`, the selection on `Theme.selected-bg`. A failed item gets the `failed` icon at the end of its row and an OSD message.
- **Lists are plain**: single-line rows, background `Theme.bg-list`, no cards, no stripes, no rounded rows; scroll bars come from `std-widgets.slint` so they follow the palette.
- **Commands of a panel go into its right-click menu**, made of the plugin's commands ({@link "@vestra-player/sdk"!Panel.showMenu | panel.showMenu}); see [Menus](menus.md).
- **The bottom bar is icons only**: no text buttons, no source path, no status text (the source name is in the window title, status is an OSD message).

## Text

- **Every visible text is English source text** that the player translates ([Translate a plugin](../how-to/i18n.md)). Write short, plain sentences; one sentence per status or error.
- **Leave room for longer languages.** German and French texts are usually longer than English; a Chinese, Japanese or Korean character is about one font size wide, a Latin letter about half. Let labels and buttons grow with their text (layouts, `preferred-width`; the `Button` widget does) instead of fixing widths to the English text.
- **Mixed scripts must render without boxes.** That is why you use the system font (above): the player falls back per character to the system's fonts (on Windows also to a bundled CJK font) ([Theme](../reference/theme.md#sizes-and-fonts)).
- **Data is not translated.** File names, track names and device names show as they are.

## Check your plugin

- Switch the palette (Settings ▸ Appearance) with your windows open: everything should follow at once.
- Switch the interface language (Settings ▸ Language, used from the next start) to German and to Japanese, and look for clipped or overlapping text.
- Compare your tool window with the player's Picture Adjustments window: same row heights, same buttons, same slider.
