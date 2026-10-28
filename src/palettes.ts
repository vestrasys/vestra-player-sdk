/**
 * The colours of the player's palettes, by `Theme` colour token (without the
 * `Theme.` prefix): `vestra`, the dark default, and `vestra-light` (player
 * 0.4.0). The player sets one of them on every view; a plugin reads the
 * colours through `Theme` in its Slint files and never needs these values.
 * They are here for the documentation (Reference: theme) and for tests that
 * check a design against both palettes.
 *
 * Current values: a later player may adjust them, a token keeps its
 * meaning. The `vestra` values are also the defaults of the SDK's copy of
 * the palette (`slint/palette.slint`); the player's tests check both
 * palettes against its own.
 *
 * @example Check in a test that a colour stays readable in both themes
 * The test fails if the plugin's own highlight colour gets too close to
 * the panel background of either palette. Plugins draw with `Theme` tokens
 * in Slint and the player switches palettes; a colour the plugin picks
 * itself does not switch, so a test compares it with each palette's values
 * (hex strings, `#rrggbb`).
 * ```ts
 * import assert from "node:assert/strict";
 * import { THEME_PALETTES } from "@vestra-player/sdk/testing";
 *
 * const highlight = "#e07000"; // the plugin's own orange
 * const luminance = (hex: string) => {
 *   const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
 *   return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!; // rough, without gamma
 * };
 * for (const [name, palette] of Object.entries(THEME_PALETTES)) {
 *   const gap = Math.abs(luminance(highlight) - luminance(palette["bg-panel"]!));
 *   assert.ok(gap > 0.3, `${name}: highlight too close to bg-panel`);
 * }
 * ```
 *
 * @since 1.5.14
 */
export const THEME_PALETTES: Readonly<
  Record<"vestra" | "vestra-light", Readonly<Record<string, string>>>
> = Object.freeze({
  vestra: Object.freeze({
    "bg-bar": "#16141c",
    "bg-video": "#0a090e",
    "bg-list": "#1a1821",
    "bg-panel": "#201d28",
    line: "#2b2734",
    "hover-bg": "#28232f",
    "press-bg": "#110f16",
    "selected-bg": "#2f2840",
    text: "#f5f3fa",
    "text-dim": "#8e88a0",
    "text-list": "#bdb8cb",
    "text-played": "#6e6980",
    accent: "#f72aa6",
    "accent-press": "#c41a83",
    "accent-disabled": "#5a1d48",
    "icon-disabled": "#3b3646",
    playing: "#2bb6ff",
    "button-bg": "#2f2a3b",
    "button-hover": "#3a3448",
    "button-press": "#25202e",
    "button-disabled": "#1b1922",
    danger: "#ff5a5f",
  }),
  "vestra-light": Object.freeze({
    "bg-bar": "#f7f6fa",
    "bg-video": "#0e0d12",
    "bg-list": "#ffffff",
    "bg-panel": "#f1eff5",
    line: "#dcd8e4",
    "hover-bg": "#e9e6f0",
    "press-bg": "#dcd8e6",
    "selected-bg": "#efe4fb",
    text: "#1c1924",
    "text-dim": "#6f6a7f",
    "text-list": "#3b3748",
    "text-played": "#9a95a8",
    accent: "#d4128a",
    "accent-press": "#a80d6c",
    "accent-disabled": "#ecbcd9",
    "icon-disabled": "#c9c5d2",
    playing: "#0773ba",
    "button-bg": "#e6e3ec",
    "button-hover": "#dcd8e4",
    "button-press": "#cfcadb",
    "button-disabled": "#efedf3",
    danger: "#c42b2b",
  }),
});
