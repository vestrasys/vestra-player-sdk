---
title: Theme
description: The Theme tokens with their current values, fonts, the icon set, and the components of @vestra/widgets.slint and @vestra/markdown.slint.
---

# Theme

What a plugin's Slint file can import from the player's library. How Slint and TypeScript talk is in [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md); which token to use where is in [Guidelines: interface](../guidelines/interface.md).

```slint nocheck
import { Theme } from "@vestra/theme.slint";
import { Icon } from "@vestra/icons.slint";
import { Button, Slider, ToolTipArea, UrlInputRow } from "@vestra/widgets.slint";
import { MarkdownView, MarkdownBlocks, MarkdownBlock } from "@vestra/markdown.slint";
```

> **Current values; they may change — use the tokens.** The values below are what the player uses today. A later player may adjust them; a token keeps its meaning, a value you copy does not follow.

## Colours

`Theme` colours follow the user's palette: `vestra`, the dark default, and `vestra-light` (player 0.4.0), whose video area stays dark. The player sets the palette on every view and again when the user switches, so read colours from `Theme` (they are read-only `out` properties) and never write a colour value yourself. The table shows both palettes' current values; the same values are {@link "@vestra-player/sdk/testing"!THEME_PALETTES | THEME_PALETTES}, for tests.

<!-- generated:theme colors -->

| Token | Value in `vestra` | Value in `vestra-light` | Note |
| --- | --- | --- | --- |
| `Theme.bg-bar` | `#16141c` | `#f7f6fa` |  |
| `Theme.bg-video` | `#0a090e` | `#0e0d12` |  |
| `Theme.bg-list` | `#1a1821` | `#ffffff` |  |
| `Theme.bg-panel` | `#201d28` | `#f1eff5` |  |
| `Theme.line` | `#2b2734` | `#dcd8e4` |  |
| `Theme.hover-bg` | `#28232f` | `#e9e6f0` |  |
| `Theme.press-bg` | `#110f16` | `#dcd8e6` |  |
| `Theme.selected-bg` | `#2f2840` | `#efe4fb` |  |
| `Theme.text` | `#f5f3fa` | `#1c1924` |  |
| `Theme.text-dim` | `#8e88a0` | `#6f6a7f` |  |
| `Theme.text-list` | `#bdb8cb` | `#3b3748` |  |
| `Theme.text-played` | `#6e6980` | `#9a95a8` |  |
| `Theme.accent` | `#f72aa6` | `#d4128a` |  |
| `Theme.accent-press` | `#c41a83` | `#a80d6c` |  |
| `Theme.accent-disabled` | `#5a1d48` | `#ecbcd9` |  |
| `Theme.icon-disabled` | `#3b3646` | `#c9c5d2` |  |
| `Theme.playing` | `#2bb6ff` | `#0773ba` |  |
| `Theme.button-bg` | `#2f2a3b` | `#e6e3ec` |  |
| `Theme.button-hover` | `#3a3448` | `#dcd8e4` |  |
| `Theme.button-press` | `#25202e` | `#cfcadb` |  |
| `Theme.button-disabled` | `#1b1922` | `#efedf3` |  |
| `Theme.danger` | `#ff5a5f` | `#c42b2b` | Errors and destructive actions: a failed status line, a Delete button. |
| `Theme.accent-fill` | gradient 90°: `#fcc402 0%`, `#fb5a35 20%`, `#fa0aa8 45%`, `#7a0afa 72%`, `#10a8fc 100%` | gradient 90°: `#f5a700 0%`, `#f0442f 20%`, `#e0089a 45%`, `#6a08e8 72%`, `#0a95e6 100%` | Brand gradient for "progress" fills (seek bar, volume, sliders, accents). |

<!-- /generated -->

`std-widgets.slint` controls (`CheckBox`, `ComboBox`, `LineEdit`…) are compiled in Slint's `fluent-dark` style and switched to their light colours in `vestra-light`; do not set `Palette.color-scheme` yourself.

## Sizes and fonts

Corner radii, font sizes and control sizes are constants, the same in both palettes. `radius-control` rounds controls, menu rows and hover plates; `radius-panel` menus, panels and the OSD (4px and 8px since player 0.4.0; 3px and 6px before).

<!-- generated:theme sizes -->

| Token | Value | Note |
| --- | --- | --- |
| `Theme.radius-control` | `4px` |  |
| `Theme.radius-panel` | `8px` |  |
| `Theme.font-xs` | `9px` |  |
| `Theme.font-body` | `11px` |  |
| `Theme.font-tab` | `12px` |  |
| `Theme.font-title` | `13px` |  |
| `Theme.button-height` | `21px` |  |
| `Theme.button-min-width` | `66px` |  |
| `Theme.button-padding` | `8px` |  |
| `Theme.button-primary-height` | `24px` |  |
| `Theme.button-small-height` | `18px` |  |
| `Theme.button-small-min-width` | `41px` |  |
| `Theme.input-height` | `21px` |  |
| `Theme.checkbox-row-height` | `18px` |  |
| `Theme.label-height` | `14px` |  |
| `Theme.form-row-gap` | `26px` |  |
| `Theme.dialog-padding` | `14px` |  |

<!-- /generated -->

- **No font family of its own.** Every window uses the system's interface font for Latin text; a plugin does not need to set a font, and a `default-font-family` it sets stays first. A character the font lacks falls back, character by character, to a font for its script.
- **CJK fallback.** On macOS the system's own fallback (PingFang, Hiragino) covers Chinese, Japanese and Korean. On Windows the player sets a chain per script for every window, plugin windows included, and uses the first installed family that has the character:
  1. Windows' CJK families in the interface language's order: for Han text, the language's own tradition first (Simplified Chinese, the default for other languages: Microsoft YaHei UI, Microsoft YaHei, DengXian, SimSun, NSimSun, SimHei; Traditional Chinese: Microsoft JhengHei UI, Microsoft JhengHei, PMingLiU, MingLiU; Japanese: Yu Gothic UI, Meiryo UI, Yu Gothic, Meiryo, MS UI Gothic, MS Gothic; Korean: Malgun Gothic, Gulim, Dotum, Batang), then the other traditions. Kana starts with the Japanese families, Hangul with the Korean, Bopomofo with the Traditional Chinese.
  2. The family Windows' own fallback picks.
  3. The bundled Noto Sans CJK SC, last, so CJK text never shows as boxes when an edition lacks the optional font packs.
- **`Theme.font-mono`** is the system's monospace family: Menlo on macOS, Consolas on Windows ([Platforms](platforms.md)). CJK falls back in it too.

## Icons

`@vestra/icons.slint` is the player's own icon set (player 0.4.0): round-capped, round-joined lines, 1.5px wide (1.25px for the small glyphs), never filled, each in its own box.

```slint nocheck
Icon { name: "play"; color: Theme.text; }                  // its box size
Icon { name: "close"; width: 20px; height: 20px; }         // scaled
```

- The box is the icon's default size; set `width` and `height` to scale it. An unknown name draws nothing.
- For a `Path` of your own, `Icons.commands(name)` returns the path data, `Icons.box-width(name)` and `Icons.box-height(name)` the box (the path's viewbox) and `Icons.line(name)` the line width.

<!-- generated:icons -->

| Name | Box (px) | Line |
| --- | --- | --- |
| `play` | 12 × 14 | 1.5px |
| `pause` | 12 × 14 | 1.5px |
| `stop` | 12 × 12 | 1.5px |
| `back` | 14 × 10 | 1.5px |
| `forward` | 14 × 10 | 1.5px |
| `open` | 14 × 12 | 1.5px |
| `volume` | 13 × 10 | 1.5px |
| `mute` | 13 × 10 | 1.5px |
| `playlist` | 13 × 10 | 1.5px |
| `detach` | 14 × 12 | 1.5px |
| `attach` | 14 × 12 | 1.5px |
| `close` | 14 × 13 | 1.5px |
| `failed` | 10 × 10 | 1.25px |
| `move-top` | 14 × 12 | 1.5px |
| `move-up` | 14 × 12 | 1.5px |
| `move-down` | 14 × 12 | 1.5px |
| `move-bottom` | 14 × 12 | 1.5px |
| `search` | 14 × 12 | 1.5px |
| `chapter` | 12 × 12 | 1.25px |
| `bookmark` | 12 × 12 | 1.25px |
| `check-task` | 11 × 11 | 1.5px |
| `check-box` | 9 × 9 | 1.5px |
| `menu-check` | 14 × 14 | 1.5px |
| `submenu` | 5 × 8 | 1.25px |
| `scroll-up` | 8 × 5 | 1.25px |
| `scroll-down` | 8 × 5 | 1.25px |
| `caret-down` | 8 × 5 | 1.25px |
| `sort-asc` | 7 × 4 | 1.1px |
| `sort-desc` | 7 × 4 | 1.1px |
| `tag-remove` | 7 × 7 | 1.25px |
| `preview-play` | 8 × 9 | 1.25px |
| `add` | 10 × 10 | 1.5px |
| `remove` | 10 × 10 | 1.5px |
| `sort` | 10 × 10 | 1.5px |
| `fullscreen` | 14 × 12 | 1.5px |
| `exit-fullscreen` | 14 × 12 | 1.5px |

<!-- /generated -->

## Widgets

`@vestra/widgets.slint`: compact controls drawn with the theme. Other controls come from `std-widgets.slint`.

<!-- generated:widgets widgets -->

**`ToolTipArea`**: Hover for about half a second to show `text` beside the pointer. The tip closes when the pointer leaves, or presses on content that does not take the press itself; it shows again on the next hover. It is Slint's input-transparent tooltip: every press reaches the control under the pointer, and the tip does not take the keyboard focus. (Up to SDK 1.5.20 the tip was a PopupWindow, which swallowed the first press after it showed and took the focus while it was open.)

| Member | Kind | Default | Note |
| --- | --- | --- | --- |
| `text` | in `string` |  |  |
| `showing` | out `bool` |  | The tip is showing (read-only); it follows the tip's delay closely, not exactly. |

**`Button`**: Dialog button: text (21px, or 18px when `small`), or an icon button when `text` is empty and `icon` holds Path data drawn in an icon-width × icon-height viewbox (filled, or 1.5px round-capped lines when `stroked`, as the @vestra/icons.slint set). The caller sizes icon buttons.

| Member | Kind | Default | Note |
| --- | --- | --- | --- |
| `text` | in `string` |  |  |
| `icon` | in `string` |  |  |
| `icon-width` | in `length` | `14px` |  |
| `icon-height` | in `length` | `12px` |  |
| `stroked` | in `bool` |  |  |
| `enabled` | in `bool` | `true` |  |
| `small` | in `bool` |  |  |
| `checked` | in `bool` |  | Icon buttons: the "on" state, drawn in the accent colour. |
| `clicked` | callback `()` |  |  |

**`Slider`**: 2px line slider. Bar style (default): 8px round thumb, a white core in a 2px accent ring, gradient fill. Panel style (`panel: true`): 14×12 thumb, gradient fill. The track is `Theme.line` in both.

| Member | Kind | Default | Note |
| --- | --- | --- | --- |
| `value` | in-out `float` |  |  |
| `minimum` | in `float` | `0` |  |
| `maximum` | in `float` | `1` |  |
| `enabled` | in `bool` | `true` |  |
| `panel` | in `bool` |  |  |
| `changed` | callback `(float)` |  |  |
| `released` | callback `(float)` |  |  |

**`UrlInputRow`**: Link input: a multi-line input and [Open] [Cancel]. Enter or the confirm button accepts (Shift+Enter starts a new line), Esc or Cancel cancels. No validation here: the plugin checks the address.

| Member | Kind | Default | Note |
| --- | --- | --- | --- |
| `text` | in-out `string` |  |  |
| `placeholder` | in `string` |  |  |
| `confirm-text` | in `string` | `@tr("Open")` |  |
| `cancel-text` | in `string` | `@tr("Cancel")` |  |
| `enabled` | in `bool` | `true` |  |
| `accepted` | callback `(string)` |  |  |
| `cancelled` | callback `()` |  |  |
| `focus-input` | function `()` |  |  |
| `select-all` | function `()` |  |  |

<!-- /generated -->

A component's public functions are called from your own Slint code, through an element id: `row.focus-input()` puts the keyboard focus into `UrlInputRow`'s input (call it when the window opens, for example from `init`), `row.select-all()` selects its text.

## Markdown

`@vestra/markdown.slint` shows a document made by {@link "@vestra-player/sdk"!Ui.markdown | plugin.ui.markdown}: give `blocks` its value. Links report `link-clicked(url)`, resolved against the document's base; the plugin decides what to open (usually {@link "@vestra-player/sdk"!System | plugin.system}). `code-copy: true` adds a Copy button to code blocks that reports `copy-code(code)`; the plugin copies it ({@link "@vestra-player/sdk"!Clipboard | plugin.clipboard}).

<!-- generated:widgets markdown -->

**`MarkdownBlocks`**: Markdown blocks without scrolling, as tall as their content.

| Member | Kind | Default | Note |
| --- | --- | --- | --- |
| `blocks` | in `[MarkdownBlock]` |  |  |
| `code-copy` | in `bool` | `false` | A Copy button on code blocks, reporting `copy-code(code)`. |
| `link-clicked` | callback `(string)` |  |  |
| `copy-code` | callback `(string)` |  |  |

**`MarkdownView`**: A scrolling Markdown document.

| Member | Kind | Default | Note |
| --- | --- | --- | --- |
| `blocks` | in `[MarkdownBlock]` |  |  |
| `inset` | in `length` | `10px` | Space around the document. |
| `code-copy` | in `bool` | `false` | A Copy button on code blocks, reporting `copy-code(code)`. |
| `link-clicked` | callback `(string)` |  |  |
| `copy-code` | callback `(string)` |  |  |

Struct **`MarkdownRow`**: One table row (cells are plain text).

Struct **`MarkdownBlock`**: One displayed block. Plugins only pass these through; the fields are filled by the player.

<!-- /generated -->
