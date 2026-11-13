// UI category, part 3: theme and language (appearance) and translated text (i18n).
// Re-exported by ../types.ts (`export type *`); see that file.
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Scope } from "./base.ts";
import type { FileResolverOptions, WebResolverOptions } from "./sources.ts";
import type { ConfirmOptions, Dialogs, Osd, OsdPanel } from "./ui-shell.ts";
/* oxlint-enable no-unused-vars */

/**
 * The player's palettes: `vestra`, the dark default, and `vestra-light`, a
 * light palette whose video area stays dark. Both draw on the logo's colours.
 * Read colours from `Theme` instead of branching on the id: a later version may
 * add palettes.
 *
 * @remarks
 * The player treats an id it does not have as `vestra`.
 *
 * @since 1.0.0
 * @category UI
 */
export type ThemeId = "vestra" | "vestra-light";

/**
 * The player's palette, which every view uses. `plugin.appearance`.
 *
 * @remarks
 * The player sets the palette on every view (the main window and its panels,
 * the floating sidebar, tool windows, the Options window) before it appears
 * and again when the palette changes. Slint code that reads its colours from
 * `Theme` (`import { Theme } from "@vestra/theme.slint"`) follows it with no
 * plugin code; hard-coded colours do not. Only colours change: corner radii,
 * font sizes and control sizes are the same in every palette. A light palette
 * also switches the std-widgets controls (`std-widgets.slint`) to their light
 * colours, and keeps the video area dark.
 *
 * The player saves the choice; it stays after the plugin that set it stops.
 * Tell the user about a change yourself (for example with
 * {@link Osd.show}).
 *
 * To run code when the palette or the language changes, listen with
 * `plugin.player.on("appearance.changed", …)` (after `plugin.player.subscribe()`): `theme` and
 * `language` already hold the event's values when the listener runs.
 *
 * @example Offer the light palette as a menu item
 * Settings ▸ Light colours switches every view of the player to the light
 * palette and carries a radio mark while it is in use. `set` asks the
 * player to switch (it saves the choice); `theme` holds the palette in use,
 * and `checked` reads it again after every handler.
 * ```ts
 * plugin.commands.add({
 *   id: "light-colours",
 *   path: ["@settings", "Light colours"],
 *   radio: true, // a round mark instead of a check mark
 *   checked: () => plugin.appearance.theme === "vestra-light",
 *   run: () => plugin.appearance.set("vestra-light"),
 * });
 * ```
 *
 * @see [Theme](../../../docs/reference/theme.md)
 * @since 1.0.0
 * @category UI
 */
export interface Appearance {
  /**
   * The palette in use. Read before activation; after `plugin.player.subscribe()`, it follows
   * other plugins' changes from the first read on, without it only this
   * plugin's own.
   */
  readonly theme: ThemeId;
  /**
   * Switch the palette of every view.
   *
   * @remarks
   * The player applies it to every open view without interrupting a drag or
   * an open menu, and saves it across restarts.
   *
   * @param theme - The palette to use.
   * @returns Resolves once the player has accepted the change;
   *   {@link Appearance.theme} has the new value.
   *
   * @throws `invalid` (rejects) `theme` is not a {@link ThemeId}.
   *
   * @example Switch to the light palette
   * Every view of the player turns light, and stays light after a restart.
   * The player applies the palette to every open view and saves the
   * choice; when the promise resolves, `appearance.theme` already has the
   * new value.
   * ```ts
   * await plugin.appearance.set("vestra-light");
   * ```
   *
   * @since 1.0.0
   */
  set(theme: ThemeId): Promise<void>;
  /**
   * The saved interface language: `"system"` (follow the system's
   * languages, the default) or a {@link Locale}.
   *
   * @remarks
   * This is the choice for the next start. The language of this run is
   * {@link I18n.locale} and never changes while the player runs. Read before
   * activation; after `plugin.player.subscribe()`, it follows other plugins' changes, without it
   * only this plugin's own. Players before 0.4.3 report `"system"`.
   *
   * @since 1.5.9
   */
  readonly language: LanguagePreference;
  /**
   * Save the interface language for the next start.
   *
   * @remarks
   * The player keeps the choice in its interface state; the language
   * changes when the player starts again (tell the user, for example "Takes
   * effect after restart"). Every plugin after `plugin.player.subscribe()`, hears the change in
   * {@link Appearance.language}.
   *
   * @player 0.4.3
   *
   * @param language - `"system"` or a {@link Locale}.
   * @returns Resolves once the player saved it; {@link Appearance.language}
   *   has the new value.
   *
   * @throws `invalid` (rejects) `language` is not `"system"` or a {@link Locale}.
   * @throws `unsupported` (rejects) A player before 0.4.3.
   *
   * @example Choose German for the next start
   * The player will start in German next time, and the user is told so.
   * `setLanguage` only saves the choice: the language of this run
   * (`i18n.locale`) never changes while the player runs. Players before
   * 0.4.3 reject it with `unsupported`.
   * ```ts
   * await plugin.appearance.setLanguage("de");
   * await plugin.osd.show("Takes effect after restart"); // translated by the player
   * ```
   *
   * @since 1.5.9
   */
  setLanguage(language: LanguagePreference): Promise<void>;
}

/**
 * An interface language of the player: English (`en`, the source language
 * of every plugin text) or a translation. The list is `LOCALES` in
 * `@vestra-player/sdk/testing`.
 *
 * @remarks
 * Simplified Chinese is `zh-Hans`. There is no Traditional Chinese: a
 * system set to Traditional Chinese (Taiwan, Hong Kong, Macao) gets English.
 *
 * @since 1.5.9
 * @category UI
 */
export type Locale = "en" | "zh-Hans" | "ja" | "ko" | "de" | "fr" | "es";

/**
 * The saved interface language ({@link Appearance.language}): follow the
 * system, or one {@link Locale}.
 *
 * @since 1.5.9
 * @category UI
 */
export type LanguagePreference = "system" | Locale;

/**
 * Arguments of a template sentence ({@link Osd.show}, {@link OsdPanel.set},
 * {@link ConfirmOptions.args}, {@link I18n.text}): an array for `{}` and `{0}`,
 * `{1}` placeholders, or an object for `{name}` placeholders. At most 16.
 * Strings and finite numbers are data, shown as they are (whole numbers without
 * a fraction); a {@link Text} or {@link TextList} argument is translated too,
 * so a sentence can be built from translated parts.
 *
 * @since 1.5.9
 * @category UI
 */
export type TemplateArgs =
  readonly TextArg[] | Readonly<Record<string, TextArg>>;

/**
 * A text the player translates with the plugin's catalog and fills in:
 * English source text with its arguments. Made by {@link I18n.text}; plain
 * data, not a translation (the plugin never sees the translated string).
 *
 * @remarks
 * Accepted wherever the player shows a plugin's text: command titles, path
 * segments and reasons, {@link Osd.show} and {@link OsdPanel.set} (as the text
 * or an argument), the texts of {@link Dialogs.confirm}, file dialog titles and
 * `saveFile`'s `fileName`, and property values where Slint expects a `string`
 * (at any depth: a `[string]` model, a struct field). Nested in another text's
 * arguments it is translated too. Limits: `TEXT_LIMITS` in
 * `@vestra-player/sdk/testing`.
 *
 * The wire form `{ $vestraText, args }` is what the player reads; write it
 * with {@link I18n.text}, so that `vestra-plugin i18n extract` finds the
 * source text.
 *
 * @since 1.5.11
 * @category UI
 */
export interface Text {
  /** The English source text: a template with `{}`, `{0}` or `{name}`. */
  readonly $vestraText: string;
  /** Values for its placeholders. */
  readonly args?: TemplateArgs;
}

/**
 * Values joined the way the interface language joins them ("a, b" in
 * English, "a、b" in Chinese). Made by {@link I18n.list}; accepted where a
 * {@link Text} is.
 *
 * @since 1.5.11
 * @category UI
 */
export interface TextList {
  /** The items: data, or texts the player translates. */
  readonly $vestraList: readonly TextArg[];
  /** How they are joined; `"list"` by default. */
  readonly style?: ListStyle;
}

/**
 * How a {@link TextList} is joined, per interface language:
 *
 * | style | English | 简体中文 | 日本語 |
 * | --- | --- | --- | --- |
 * | `list` (enumeration) | `, ` | `、` | `、` |
 * | `clauses` (parts of one sentence) | `, ` | `，` | `、` |
 * | `semicolons` | `; ` | `；` | `；` |
 * | `sentences` (no final full stop) | `. ` | `。` | `。` |
 * | `lines` | line break | line break | line break |
 *
 * Korean, German and Spanish join as English; French puts a narrow space
 * before `;`.
 *
 * @since 1.5.11
 * @category UI
 */
export type ListStyle =
  "list" | "clauses" | "semicolons" | "sentences" | "lines";

/**
 * An argument of a template: data (a string or a finite number, shown as it
 * is) or a {@link Text} or {@link TextList} (translated).
 *
 * @since 1.5.11
 * @category UI
 */
export type TextArg = string | number | Text | TextList;

/**
 * A text the player shows: English source text (translated as a whole), a
 * {@link Text} or a {@link TextList}.
 *
 * @since 1.5.11
 * @category UI
 */
export type TextValue = string | Text | TextList;

/**
 * The interface language of this run. `plugin.i18n`.
 *
 * @remarks
 * Plugins write no translation code. Every user-visible text is English
 * source text in one of three places, and the player translates it with
 * the plugin's own catalog (`locales/<lang>.po`, compiled into the package
 * by `vestra-plugin build`):
 *
 * 1. declarations: command titles and paths, settings page and panel
 *    titles, the manifest's `name`, `punchline`, `description` and `tags`;
 * 2. Slint: `@tr("…")` in the plugin's `.slint` files;
 * 3. sentences the plugin hands the player: {@link Osd.show},
 *    {@link OsdPanel.set} and {@link Dialogs.confirm} take a template and
 *    its arguments (`osd.show("Speed {}×", [rate])`), never a sentence
 *    composed in TypeScript.
 *
 * Where words and data cannot be separated that way (a menu item with a number,
 * a `[string]` model, a sentence made of translated parts), the plugin passes a
 * text value ({@link I18n.text}, {@link I18n.list}): data the player
 * translates, never a translated string.
 *
 * The language is fixed when the player starts: {@link I18n.locale} never
 * changes during a run. Read it for what is not text, such as the order of
 * names or a date format. `vestra-plugin i18n extract` collects the texts
 * into `locales/messages.pot`; see the
 * [i18n guide](../../../docs/guides/i18n.md).
 *
 * @example Format a date the way the interface language writes it
 * The OSD shows today's date in the user's language and date format. The
 * sentence is a template the player translates; only the data in it, the
 * date, is formatted by the plugin, with `i18n.locale` (the language the
 * player runs in, fixed for the whole run).
 * ```ts
 * const day = new Date().toLocaleDateString(plugin.i18n.locale);
 * await plugin.osd.show("Today is {}", [day]);
 * ```
 *
 * @since 1.5.9
 * @category UI
 */
export interface I18n {
  /**
   * The interface language of this run, chosen at start-up from the saved
   * {@link Appearance.language} or the system's languages; English when
   * neither names a {@link Locale}. Players before 0.4.3 report `"en"`.
   */
  readonly locale: Locale;
  /**
   * A text that mixes words with data, for the player to translate: the
   * English source text (a template) and its arguments. It returns a plain
   * {@link Text} value, not a translation; pass it where the player shows
   * text (see {@link Text}) and the player shows it translated with this
   * plugin's catalog. `vestra-plugin i18n extract` collects `source` from
   * every call, so write it as a literal (or a conditional of literals, or
   * an `as const` table entry).
   *
   * Arguments are data unless they are texts themselves, so a sentence can
   * be built from translated parts without composing it in TypeScript.
   * `text` does not use `this`: `const { text, list } = plugin.i18n` works.
   *
   * @param source - English source text; `{}`, `{0}` or `{name}` for the
   *   arguments, `{{` and `}}` for braces.
   * @param args - Values for its placeholders.
   * @throws `invalid` A malformed or over-limit value (`TEXT_LIMITS`).
   *
   * @example Fill a drop-down with fixed words and data
   * The drop-down lists "No Audio" and one "Track 7 · en" entry per track,
   * in the user's language. A `[string]` model may hold `text()` values: the
   * player translates each source text with the plugin's catalog and fills
   * in its arguments, so the plugin never composes translated strings.
   * ```ts
   * const { text } = plugin.i18n;
   * const picker = plugin.windows.create("ui/clip.slint");
   * const tracks = [{ id: 7, title: "en" }];
   * // Each entry is translated, then filled in: "Track 7 · en".
   * picker.set({
   *   labels: [text("No Audio"), ...tracks.map((t) => text("Track {} · {}", [t.id, t.title]))],
   * });
   * ```
   *
   * @example Build a message from translated parts
   * The OSD says "Download failed: Connection timed out", both parts in the
   * user's language. An argument made with `text()` is translated too,
   * while string arguments are shown as they are.
   * ```ts
   * await plugin.osd.show("Download failed: {}", [plugin.i18n.text("Connection timed out")]);
   * ```
   *
   * @since 1.5.11
   */
  text(source: string, args?: TemplateArgs): Text;
  /**
   * Items joined the way the interface language joins them (see
   * {@link ListStyle}): `list(["a.glsl", "b.glsl"])` shows "a.glsl, b.glsl"
   * in English and "a.glsl、b.glsl" in Chinese. Items are data, or texts the
   * player translates. Accepted where a {@link Text} is.
   *
   * @param items - At most 256.
   * @param style - `"list"` by default.
   * @throws `invalid` A malformed or over-limit value.
   *
   * @example List file names the way the language joins them
   * The OSD says "Removed missing shaders: a.glsl, b.glsl" in English and
   * joins the names with "、" in Chinese. `list` makes a value the player
   * joins per interface language; the names themselves are data and stay
   * as they are.
   * ```ts
   * const missing = ["a.glsl", "b.glsl"];
   * await plugin.osd.show("Removed missing shaders: {}", [plugin.i18n.list(missing)]);
   * ```
   *
   * @since 1.5.11
   */
  list(items: readonly TextArg[], style?: ListStyle): TextList;
  /**
   * An `Error` whose words the player shows translated: throw it where the
   * player shows a plugin's failure to the user, such as from a file or web
   * resolver's `resolve` ({@link FileResolverOptions},
   * {@link WebResolverOptions}) (also when a stream fails while it starts). The
   * player shows `text` translated with this plugin's catalog (as
   * `player.state.error` and the failure message); `message` is the English
   * rendering, for logs. Elsewhere it is an ordinary `Error`.
   *
   * @param source - English source text, as {@link I18n.text}'s.
   * @param args - Values for its placeholders.
   * @throws `invalid` A malformed or over-limit value.
   *
   * @example Fail an open with a message the user can read
   * Opening a `.ch8` file the plugin cannot load shows "The program file was
   * not found." in the user's language. The player shows the message of an
   * error thrown from `resolve`; `i18n.error` makes an `Error` whose text the
   * player translates with this plugin's catalog, while its `message` stays
   * English for logs.
   * ```ts
   * import { readFile } from "node:fs/promises";
   * declare function startEmulator(program: Uint8Array): ResolvedStream;
   * // ---cut---
   * plugin.resolvers.add({
   *   id: "chip8",
   *   extensions: ["ch8"],
   *   async resolve(path, signal) {
   *     const program = await readFile(path, { signal }).catch(() => {
   *       // Shown as the open's failure, translated (locales/<lang>.po).
   *       throw plugin.i18n.error("The program file was not found.");
   *     });
   *     return startEmulator(program);
   *   },
   * });
   * ```
   *
   * @since 1.5.11
   */
  error(source: string, args?: TemplateArgs): TextError;
  /**
   * The string a text shows in this run's language, for text that leaves
   * the player: what the plugin copies to the clipboard or writes to a file
   * ("Copy info", "Save as…"). Translated with this plugin's catalog (a
   * string as a whole, a {@link Text} or {@link TextList} with its
   * arguments), the way the player would show it.
   *
   * Only for text leaving the player. Never use it for the interface (a
   * window, the menu, the OSD, a dialog): pass the value itself there, so
   * the player translates it and `vestra-plugin i18n check` can see the
   * sentence is whole.
   *
   * @param value - Source text, or a text value.
   * @returns The translated string.
   * @throws `invalid` A malformed value.
   *
   * @example Copy version information in the user's language
   * "Copy info" puts two translated lines on the clipboard. Text that
   * leaves the player cannot be translated by it, so `resolve` turns the
   * values into the string the player would show, using this plugin's
   * catalog; inside the player, pass the values themselves instead.
   * ```ts
   * const { text, list, resolve } = plugin.i18n;
   * const lines = list([text("Version {}", ["1.0"]), text("Cores: {}", [8])], "lines");
   * await plugin.clipboard.writeText(resolve(lines));
   * ```
   *
   * @since 1.5.11
   */
  resolve(value: TextValue): string;
}

/**
 * An `Error` the player shows translated ({@link I18n.error}).
 *
 * @since 1.5.11
 * @category UI
 */
export interface TextError extends Error {
  /** What the player shows. */
  readonly text: Text;
}
