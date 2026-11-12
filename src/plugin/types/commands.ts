// Commands category: commands, conditions, menus and buttons, host actions, key bindings.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { Disposable } from "./base.ts";
import type { PlayerState } from "./playback.ts";
import type { ImageRef } from "./ui-content.ts";
import type {
  LanguagePreference,
  Text,
  TextValue,
  ThemeId,
} from "./ui-locale.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Scope } from "./base.ts";
import type { Player } from "./playback.ts";
import type { Ui, View } from "./ui-content.ts";
/* oxlint-enable no-unused-vars */

// ---------------------------------------------------------------- commands

/**
 * The state of a command's menu item, as the player shows it.
 *
 * @see {@link Command.set}, {@link CommandOptions}
 * @since 1.0.0
 * @category Commands
 */
export interface CommandState {
  /** False greys the item out; the player then never calls `run` (bound keys are swallowed). Default true. */
  enabled: boolean;
  /** `null` means the menu item has no check mark. */
  checked: boolean | null;
  /** Shown as busy; like `enabled: false`, the player does not call `run`. Default false. */
  busy: boolean;
  /**
   * Shown when the command is disabled or busy: English source text the player
   * translates, or a {@link Text}.
   */
  reason: TextValue | null;
}

/**
 * A value, or a function the SDK re-evaluates on every full update pass,
 * and after a player state change only if it read a field of
 * `plugin.player.state` that changed (see {@link Scope.update}); only
 * changes are sent to the player.
 *
 * @remarks
 * Only a command with at least one function field takes part in the update
 * passes: a command whose fields are all values or `plugin.when` conditions is
 * registered once and evaluated again only when {@link Command.set} changes it.
 *
 * @example Mix a computed state with a fixed one
 * The Loop item carries a check mark while a loop is set and is always
 * enabled. A function is evaluated again in every full update pass (after
 * each handler), and after a player state change only if it read a changed
 * field; only changes are sent, and a plain value never changes.
 * ```ts
 * plugin.commands.add({
 *   id: "loop",
 *   path: ["Playback", "Loop"],
 *   checked: () => plugin.player.state.loop != null, // re-evaluated
 *   enabled: true, // a fixed value
 *   run: () => plugin.player.setLoop(null),
 * });
 * ```
 *
 * @since 1.0.0
 * @category Commands
 */
export type Bindable<T> = T | (() => T);

/**
 * A condition on the player's own state, from {@link Scope.when}, for a
 * command's `enabled` or `checked`. The player evaluates it, again on
 * every change of that state, whether or not the plugin runs.
 *
 * @remarks
 * Combine conditions with `and`, `or` and `not`; each returns a new
 * condition and leaves the original as it was. A condition is data: it
 * reads nothing in the plugin and keeps no listener, so a plugin whose
 * menu state is made of conditions may be stopped while idle (lazy
 * activation) and its menu stays current. A function (see {@link Bindable})
 * keeps working; one that reads `plugin.player.state` or another service's
 * state keeps the plugin running so the SDK can evaluate it.
 *
 * @capability commands
 *
 * @example Enable an item while a frame can be saved
 * "Save Snapshot" is greyed out with its reason unless a media file is
 * open at a frame the player can capture. The condition is sent with the
 * command and evaluated by the player, so the item follows playback even
 * while the plugin is stopped; with an `enabled` condition the player
 * shows the `reason` only while the item is disabled.
 * ```ts
 * declare function saveSnapshot(): Promise<void>;
 * // ---cut---
 * const { when } = plugin;
 * plugin.commands.add({
 *   id: "save",
 *   path: ["@video", "Save Snapshot"],
 *   enabled: when.can("snapshot").and(when.phase("ready", "ended"), when.stream.not()),
 *   reason: "No frame to capture", // shown only while disabled
 *   run: saveSnapshot,
 * });
 * ```
 *
 * @since 1.5.40
 * @category Commands
 */
export interface Condition {
  /**
   * True when this condition and every one of `others` hold.
   *
   * @example Combine two conditions with and
   * The item is enabled only while a file plays in fullscreen. `and`
   * returns a new condition; `when.playing` itself is unchanged.
   * ```ts
   * const { when } = plugin;
   * const playingFullscreen = when.playing.and(when.fullscreen);
   * ```
   *
   * @capability None (the command it is given to needs `commands`).
   * @since 1.5.40
   */
  and(...others: Condition[]): Condition;
  /**
   * True when this condition or one of `others` holds.
   *
   * @example Combine two conditions with or
   * The item is enabled while a file plays or is paused. `or` returns a
   * new condition that holds when either of the two holds.
   * ```ts
   * const { when } = plugin;
   * const active = when.playing.or(when.paused);
   * ```
   *
   * @capability None (the command it is given to needs `commands`).
   * @since 1.5.40
   */
  or(...others: Condition[]): Condition;
  /**
   * True when this condition does not hold.
   *
   * @example Negate a condition with not
   * An "Enter Fullscreen" item is enabled only outside fullscreen. `not`
   * returns the opposite condition; the player evaluates it on every
   * window change.
   * ```ts
   * const { when } = plugin;
   * const windowed = when.fullscreen.not();
   * ```
   *
   * @capability None (the command it is given to needs `commands`).
   * @since 1.5.40
   */
  not(): Condition;
}

/**
 * `plugin.when`: the vocabulary of conditions. It names only state the player
 * owns: the source's phase, kind, pause and controls (the same names as
 * {@link PlayerState}), fullscreen, the palette and the saved interface
 * language.
 *
 * @remarks
 * Give a condition as a command's `enabled` or `checked`
 * ({@link CommandOptions}, {@link Command.set}). The player evaluates it and
 * shows the result in menus, on keys and on bar buttons, again whenever that
 * state changes, also while the plugin is stopped because nothing used it. With
 * an `enabled` condition the player shows the command's `reason` only while the
 * condition is false (or the command is busy), so a fixed reason is enough.
 *
 * State the vocabulary does not name (a plugin's own settings, an open
 * window, a track list) stays a function or a value set with
 * {@link Command.set}.
 *
 * @capability commands
 *
 * @example Check a palette item and follow the palette
 * The Appearance submenu has one radio item per palette; the player
 * checks the one in use, also after another plugin or the user changed
 * it, and while this plugin is stopped. Nothing in the plugin listens to
 * the palette.
 * ```ts
 * const { when } = plugin;
 * for (const [id, title] of [["vestra", "Dark"], ["vestra-light", "Light"]] as const)
 *   plugin.commands.add({
 *     id: `theme.${id}`,
 *     path: ["Settings", "Appearance", title],
 *     radio: true,
 *     checked: when.theme(id), // evaluated by the player, not the plugin
 *     run: () => plugin.appearance.set(id),
 *   });
 * ```
 *
 * @since 1.5.40
 * @category Commands
 */
export interface When {
  /** A source is open: any phase but `empty` (loading, ready, ended, error). */
  readonly open: Condition;
  /** The source is loaded and can play (`phase` is `ready`). */
  readonly ready: Condition;
  /** The source is ready and not paused. */
  readonly playing: Condition;
  /** The source is ready and paused. */
  readonly paused: Condition;
  /** The source is a generated stream (`PlayerState.kind` is `stream`). */
  readonly stream: Condition;
  /** The main window is fullscreen. */
  readonly fullscreen: Condition;
  /**
   * The source's `phase` is one of `phases`.
   *
   * @throws `TypeError` (throws) No phase, or one that is not a phase.
   *
   * @example Enable an item while a file is loaded or finished
   * The item is enabled while the source is ready or has ended, as a
   * snapshot needs a frame. The phases are those of `PlayerState.phase`.
   * ```ts
   * const { when } = plugin;
   * const hasFrame = when.phase("ready", "ended");
   * ```
   *
   * @capability None (the command it is given to needs `commands`).
   * @since 1.5.40
   */
  phase(...phases: PlayerState["phase"][]): Condition;
  /**
   * The source allows `control`: `PlayerState.can[control]` is true.
   *
   * @throws `TypeError` (throws) `control` is not one of `PlayerState.can`.
   *
   * @example Enable a seek item only where seeking works
   * "Jump to Middle" is greyed out on live streams that cannot seek.
   * The player reads its own `can.seek` for the current source.
   * ```ts
   * const { when } = plugin;
   * const seekable = when.can("seek");
   * ```
   *
   * @capability None (the command it is given to needs `commands`).
   * @since 1.5.40
   */
  can(control: keyof PlayerState["can"]): Condition;
  /**
   * The palette in use is `theme` (`plugin.appearance.theme`).
   *
   * @throws `TypeError` (throws) `theme` is not a palette of the player.
   *
   * @example Check the light palette's item
   * The item carries a check mark while the light palette is in use,
   * whoever switched to it.
   * ```ts
   * const { when } = plugin;
   * const light = when.theme("vestra-light");
   * ```
   *
   * @capability None (the command it is given to needs `commands`).
   * @since 1.5.40
   */
  theme(theme: ThemeId): Condition;
  /**
   * The saved interface language is `language`
   * (`plugin.appearance.language`: `"system"` or a locale).
   *
   * @throws `TypeError` (throws) `language` is not `"system"` or a locale.
   *
   * @example Check the Follow System item
   * The item carries a check mark while the player follows the system's
   * language; the player reads its own saved preference.
   * ```ts
   * const { when } = plugin;
   * const followSystem = when.language("system");
   * ```
   *
   * @capability None (the command it is given to needs `commands`).
   * @since 1.5.40
   */
  language(language: LanguagePreference): Condition;
}

/**
 * A built-in top-level menu of the player, named in a command path as `@<id>`
 * or by its English key (see {@link CommandOptions.path}): Open, Playback,
 * Subtitles, Video, Audio, Screen, Settings, Reset, Tools. The list is
 * `MENU_IDS` in `@vestra-player/sdk/testing`. Reset (`@reset`) gathers every
 * command that puts something back to its default; Tools (`@tools`, since
 * 1.7.12) holds the player's tools (tracks, snapshot, Vestra Player AI, the
 * store, the command palette, About) and any plugin's own.
 *
 * @since 1.3.0
 * @category Commands
 */
export type MenuId =
  | "open"
  | "playback"
  | "subtitles"
  | "video"
  | "audio"
  | "screen"
  | "settings"
  | "reset"
  | "tools";

/**
 * An icon of the player's V-Line set (`@vestra/icons.slint`), by name: what
 * a bottom-bar button may show. The list is `BAR_BUTTON_ICONS` in
 * `@vestra-player/sdk/testing`.
 *
 * @since 1.5.29
 *
 * @category Commands
 */
export type BarButtonIcon =
  | "play"
  | "pause"
  | "stop"
  | "back"
  | "forward"
  | "open"
  | "volume"
  | "mute"
  | "playlist"
  | "detach"
  | "attach"
  | "close"
  | "failed"
  | "move-top"
  | "move-up"
  | "move-down"
  | "move-bottom"
  | "search"
  | "chapter"
  | "bookmark"
  | "check-task"
  | "check-box"
  | "menu-check"
  | "submenu"
  | "scroll-up"
  | "scroll-down"
  | "caret-down"
  | "sort-asc"
  | "sort-desc"
  | "tag-remove"
  | "preview-play"
  | "add"
  | "remove"
  | "sort"
  | "fullscreen"
  | "exit-fullscreen"
  | "store"
  | "ai"
  | "sliders"
  | "search-ai";

/**
 * A command's button on the bottom bar: {@link CommandOptions.button}.
 *
 * @remarks
 * **Where it shows.** The player draws the bottom bar's button strip and
 * decides where it goes: today at the right end of the bottom bar; this may
 * change. Buttons are ordered by `order`, then by plugin id; lower `order`
 * comes first and stays visible longest. When the strip runs out of room, or
 * more than 8 plugin buttons are declared, the remaining buttons move to the
 * strip's » menu, in the same order. A button is never dropped: it is either in
 * the strip or in the » menu, and its command keeps its menu entry, its key and
 * its place in the command palette. Users may pin and unpin buttons later; do
 * not rely on a position. See [Bottom-bar
 * buttons](../../../docs/reference/commands.md#bottom-bar-buttons).
 *
 * **What it shows.** The icon, the command's title (translated, a trailing
 * "…" removed) and its first key as the tooltip ("Plugin Store (F9)"),
 * `enabled`, `busy` and `reason` as the menu item has them: a disabled or
 * busy command's button is drawn disabled, its tooltip adds the reason, and
 * a click runs nothing. Every button's icon is drawn in the accent colour;
 * a command with `checked` shows a small dot under its icon while checked.
 * A click runs the command exactly like a click on its menu item.
 *
 * **Limits.** One button per plugin, the first it declares (a later one
 * stays a menu item only), and eight in the strip (`BAR_BUTTON_LIMITS`); the
 * rest are in the » menu. The button goes
 * with its command: disposing the command, or disabling, stopping or
 * uninstalling the plugin, removes it.
 *
 * @example Give a command a button in the bottom bar
 * A Store icon appears in the bottom bar's button strip; a click opens
 * the store window, exactly like the menu item. The player draws the
 * button from the command's title, keys and state, and places it by
 * `order` (200 is where the player's own Plugin Store button sits).
 * ```ts
 * const store = plugin.windows.create("ui/store.slint");
 * plugin.commands.add({
 *   id: "open",
 *   path: ["Plugin Store…"], // a button needs a menu path
 *   button: { icon: "store", order: 200 },
 *   run: () => store.show(),
 * });
 * ```
 *
 * @player 0.5.10
 * @since 1.5.29
 *
 * @category Commands
 */
export interface CommandButton {
  /**
   * A name of the player's icon set ({@link BarButtonIcon}), or an image
   * made with {@link Ui.image} (a PNG or JPEG in your package or data
   * directory), drawn in the 14×12 icon box, aspect kept, coloured like the
   * player's line icons: only its alpha counts, so draw it as a dark shape
   * on a transparent background. An unknown name fails with `invalid`.
   */
  icon: BarButtonIcon | ImageRef;
  /**
   * Place in the strip, left to right ascending: an integer 0–999. It is
   * position only: a lower order sits further left, and in a narrow window
   * (or past the limit of eight) it is the first to go. Equal orders sort
   * by plugin id, then declaration order. The player's own buttons use AI
   * 100, Plugin Store 200.
   */
  order: number;
}

/**
 * The declaration passed to {@link Commands.add}.
 *
 * Menu order: siblings sort by `order` ascending; a submenu sits where its
 * first command sits and takes that command's `group`. Equal orders sort by
 * plugin id, then declaration order, never by title. `group` only draws
 * separators, so keep a group's orders contiguous. Recommended top-level
 * ranges: `open` 100–199, `domain` 200–699 (playback, subtitles, video,
 * audio…), `screen` 700–799, `windows` 800–819, `settings-main` 820–999
 * (Tools ▸, Options…, Quit); put a tool into Tools ▸ (`@tools`) rather than
 * the top level.
 *
 * Built-in menus keep their place. The built-in top-level menus
 * ({@link MenuId}) sit at fixed orders, whatever is inside them: Open 110,
 * Playback 200, Subtitles 300, Video 400, Audio 500, Screen 710, Tools 820,
 * Settings 830, Reset 840. Tools and Settings are drawn in the separator group
 * of Options… and Quit (`settings-main`) and Reset in Settings' group, whatever
 * groups the items inside declare. Like every built-in menu, Tools, Settings
 * and Reset show only when a command is in them. This holds whether
 * the path names the menu by id (`["@video", "Blur"]`) or by its key
 * (`["Video", "Blur"]`), so a plugin's item never moves the player's menu.
 * Directly inside a built-in menu, `order` 0 (the default) sorts after every
 * other order: an item without `order` goes at the end, after the player's own
 * items (which all use 100 or more). Give a positive order to sit between them
 * (the player's items in menu order are in [Built-in
 * commands](../../../docs/reference/commands.md#built-in-commands)), or a
 * negative one to come first. Deeper levels (a plugin's own submenu) have no
 * such rule.
 *
 * {@link Commands.add} throws `invalid` synchronously for a bad path,
 * order or binding; the player refuses an empty or overlong text, a control
 * character or whitespace at either end (`COMMAND_LIMITS`) with
 * `invalid` (through `ready`). The same path registered twice, or a path that
 * is both an item and a submenu, fails with `conflict` (through `ready`).
 *
 * @see {@link Commands.add}, [Commands, menus and bindings](../../../docs/reference/commands.md)
 * @since 1.0.0
 * @category Commands
 */
export interface CommandOptions {
  /** Local id, unique within the plugin (the global id is `<manifest id>/<id>`). */
  id: string;
  /**
   * Menu path including the leaf, 1–8 segments, e.g. `["@video", "Adjust picture…"]`;
   * one segment is a top-level item. Omit it for a command that is not in the
   * main menu (bindings and panel menus only); `title` is then required.
   *
   * Segments are English source text, and menus merge by them: commands of
   * different plugins with the same leading segments share a submenu. The
   * player shows each segment and the title in the interface language from the
   * declaring plugin's catalog (`locales/<lang>.po`, see the [i18n
   * guide](../../../docs/guides/i18n.md)); the player's own menus (Open,
   * Playback, Subtitles, Video, Audio, Screen, Settings, Reset, Tools, and Playback ▸
   * Speed, Playback ▸ Seek) always show the player's words. A built-in menu can
   * also be named by its id, `@` plus a {@link MenuId}: `@open`, `@playback`,
   * `@subtitles`, `@video`, `@audio`, `@screen`, `@settings`, `@reset` or `@tools`. Only
   * the first segment is read as an id; an unknown id, or an id with nothing
   * after it, fails with `invalid`.
   *
   * A segment that mixes words with data (a track number, a count) is a
   * {@link Text}: `plugin.i18n.text("Track {} ({})", [n, codec])`. The menu
   * shows it translated and filled in; it merges by its English rendering
   * ("Track 2 (opus)").
   *
   * @example Put items into built-in menus, one with a track number
   * "Blur" appears in the Video menu and "Track 2 (opus)" under Audio ▸
   * Audio Track, both in the user's language. `@video` and `@audio` name
   * the built-in menus by id; "Audio Track" is a submenu key that merges
   * with any other plugin's same key; the `text()` segment is translated
   * with the plugin's catalog and then filled in with the number and codec.
   * ```ts
   * declare function toggle(): void;
   * declare function select(): void;
   * // ---cut---
   * plugin.commands.add({ id: "blur", path: ["@video", "Blur"], run: toggle });
   * const { text } = plugin.i18n;
   * // A segment with data: translated as "Track {} ({})", then filled in.
   * plugin.commands.add({
   *   id: "track-2",
   *   path: ["@audio", "Audio Track", text("Track {} ({})", [2, "opus"])],
   *   run: select,
   * });
   * ```
   */
  path?: (string | Text)[];
  /**
   * Menu label (English source text, shown translated, or a {@link Text});
   * defaults to the last path segment.
   */
  title?: string | Text;
  /**
   * What the command is about, in a word or two (`"Subtitle Sync"`,
   * `"Picture"`): English source text, shown translated like `title`, or a
   * {@link Text}. The player's command palette (Ctrl+Shift+P, ⌘⇧P on macOS)
   * and lists of commands name a command `Category: Title`, so a short title
   * such as "Earlier 0.5 s", "Off" or "90°" still says what it changes once
   * it is out of the menu. Without it the player uses the menu path above
   * the item, then the plugin's name.
   *
   * 1–80 UTF-8 bytes (a text value counted by its English rendering), no
   * control characters, no whitespace at either end
   * (`COMMAND_LIMITS.categoryBytes`); the player refuses anything else with
   * `invalid`.
   *
   * @example Name commands that have no menu path
   * The palette lists "Subtitle Sync: Earlier 0.5 s" and "Subtitle Sync:
   * Later 0.5 s"; without a category both would read as a bare "Earlier
   * 0.5 s", indistinguishable from an audio delay command of the same name.
   * ```ts
   * declare function shift(seconds: number): void;
   * // ---cut---
   * for (const [id, title, seconds] of [
   *   ["sync-earlier", "Earlier 0.5 s", -0.5],
   *   ["sync-later", "Later 0.5 s", 0.5],
   * ] as const)
   *   plugin.commands.add({
   *     id,
   *     title,
   *     category: "Subtitle Sync", // the palette reads "Subtitle Sync: Earlier 0.5 s"
   *     bindings: [id === "sync-earlier" ? "." : ","],
   *     run: () => shift(seconds),
   *   });
   * ```
   *
   * @player 0.7.6
   * @since 1.6.4
   */
  category?: string | Text;
  /**
   * The id of this plugin's command that opens the window or panel where this
   * command's control lives (`"tune"` for a Subtitle Tuning… command whose
   * window has the sync slider). The player's command palette shows that place
   * next to the command. A local id, like `id`: ASCII letters, digits, `.`, `_`
   * and `-`, 1–128 bytes; the player refuses anything else with `invalid`. The
   * command it names need not be registered yet; while it is not, the palette
   * shows the place it would show without `home`: the menu path above the item,
   * "Menu" for a top-level item, nothing for a command outside the menu.
   *
   * @example Point a key command at its window
   * The palette row for "Subtitle Sync: Earlier 0.5 s" also says where the
   * same setting can be changed by hand: the Subtitle Tuning window that the
   * `tune` command opens.
   * ```ts
   * declare const tuning: { show(): void };
   * declare function shift(seconds: number): void;
   * // ---cut---
   * plugin.commands.add({
   *   id: "tune",
   *   path: ["@subtitles", "Subtitle Tuning…"],
   *   run: () => tuning.show(),
   * });
   * plugin.commands.add({
   *   id: "sync-earlier",
   *   title: "Earlier 0.5 s",
   *   category: "Subtitle Sync",
   *   home: "tune", // the palette shows "Subtitle Tuning" as its place
   *   run: () => shift(-0.5),
   * });
   * ```
   *
   * @player 0.7.6
   * @since 1.6.4
   */
  home?: string;
  /**
   * Sibling order in the menu, ascending (integer, default 0). A submenu sits
   * where its first command sits, except a built-in menu, which keeps its
   * fixed place. Directly inside a built-in menu, 0 (the default) sorts last.
   * Equal orders: plugin id, then declaration order. Range ±1,000,000. See
   * {@link CommandOptions} for the menu order rules.
   */
  order?: number;
  /** Separator label: a line is drawn between adjacent items of different groups. Default `"domain"`. */
  group?: string;
  /** Draw `checked` as a radio dot instead of a check mark. */
  radio?: boolean;
  /**
   * Default input bindings, e.g. `["Space"]`, `["Ctrl+O", "F3"]`, `["Mouse:WheelUp"]`.
   *
   * Syntax: `{Modifier "+"} Input`, modifiers in the order `Ctrl`, `Alt`,
   * `Shift`, `Cmd`, each at most once. Inputs: `A`–`Z`, `0`–`9`, `F1`–`F24`,
   * `Space`, `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Insert`,
   * `Home`, `End`, `PageUp`, `PageDown`, `ArrowLeft`/`Right`/`Up`/`Down`,
   * `Plus`, any other single symbol as typed (`">"`, not `"Shift+."`),
   * `Numpad0`–`Numpad9`, `NumpadPlus`, `NumpadMinus`, `NumpadMultiply`,
   * `NumpadDivide`, `NumpadEnter`, `NumpadDecimal`, the video-area mouse
   * inputs `Mouse:LeftClick`, `Mouse:LeftDoubleClick[:LeftHalf|:RightHalf]`,
   * `Mouse:MiddleClick`, `Mouse:WheelUp`/`Down`/`Left`/`Right`, and the side
   * buttons `Mouse:X1` (back), `Mouse:X2` (forward), anywhere
   * in the main window or the floating sidebar window, except while a menu
   * is open.
   *
   * Platforms: on macOS `Ctrl+X` fires for both ⌃X and ⌘X while `Cmd+X`
   * means ⌘X only; on Windows `Cmd` is the Windows logo key, so write
   * `Ctrl+…` for bindings that work on both. Avoid the
   * [keys the system takes first](../../../docs/reference/commands.md#keys-the-system-takes-first).
   *
   * Conflicts are not errors: the user's overrides win, then the player's
   * own commands, then the plugin loaded first; a shadowed binding takes
   * effect when the winner goes away. Up to 16 bindings.
   */
  bindings?: string[];
  /** `"panel"`: the bindings apply only while this plugin's panel has focus. */
  focus?: "panel";
  /** Fire again on keyboard auto-repeat while the key is held. Default false. */
  repeat?: boolean;
  /**
   * A button for this command on the bottom bar: an icon and a place,
   * `{ icon: "store", order: 200 }`. Needs a `path`: the menu entry is where
   * the command stays reachable wherever the button is (the strip or its »
   * menu). See {@link CommandButton} for where it shows, what it shows and the
   * limits. Fails with `invalid` for an unknown icon name, an order outside
   * 0–999 or a button without a path.
   */
  button?: CommandButton;
  /**
   * The command cannot be undone: it deletes or clears the user's data,
   * closes what is open or quits (default false). When another plugin runs
   * it through {@link Commands.run}, the player asks the user first; a menu
   * pick, a key or the command palette runs it as before.
   *
   * @player 0.7.6
   * @since 1.7.9
   */
  destructive?: boolean;
  /**
   * Whether the command can run (default true): a value, a function, or a
   * {@link Condition} the player evaluates (`plugin.when`).
   */
  enabled?: Bindable<boolean> | Condition;
  /**
   * Check mark (or radio dot with `radio`); `null` (default) draws none. A
   * {@link Condition} (`plugin.when`) draws the mark while it holds.
   */
  checked?: Bindable<boolean | null> | Condition;
  /** Busy state (default false); the player does not call `run` while busy. */
  busy?: Bindable<boolean>;
  /**
   * Why the command is disabled or busy (shown to the user): English source
   * text, or a {@link Text} for one with data in it. With an `enabled`
   * {@link Condition} the player shows it only while the condition is false or
   * the command is busy, so a fixed text is enough.
   */
  reason?: Bindable<TextValue | null>;
  /**
   * Run the command (menu item, binding, panel menu or
   * `host.command(id).run()` in tests). It may return a promise; errors
   * and rejections go to {@link Scope.onError}, and bound values are
   * re-evaluated when it returns and when its promise settles.
   */
  run(): unknown;
}

/**
 * A registered command, from {@link Commands.add}. Disposing it removes it
 * from the menu and the binding table; the id can be added again right away.
 *
 * @remarks
 * The handle of one menu item and its keys. Its state (`enabled`, `checked`,
 * `busy`, `reason`) is bound: functions given to {@link Commands.add} or
 * {@link Command.set} are evaluated again in every full update pass (after
 * a player state change only if they read a changed field of
 * `plugin.player.state` or {@link Scope.state}) and only changes reach the
 * player; a command without functions is left out of the passes. Its title, path, bindings and button cannot
 * change in place; dispose the command (or a child {@link Scope}) and add it
 * again. Disposing it, its scope or stopping the plugin removes the menu
 * item, its keys and its bar button.
 *
 * @capability commands
 *
 * @example Enable an item only while a file is open
 * Video ▸ Export… is greyed out until a file is open. `set` replaces the
 * `enabled` field with a function; the SDK evaluates it again after every
 * player state change and sends the new state when it changes, so the
 * item follows the player without further code.
 * ```ts
 * declare function runExport(): Promise<void>;
 * // ---cut---
 * const exportCommand = plugin.commands.add({
 *   id: "export",
 *   path: ["@video", "Export…"],
 *   run: runExport,
 * });
 * // A function: re-evaluated in every full pass and when `phase` changes.
 * exportCommand.set({ enabled: () => plugin.player.state.phase === "ready" });
 * ```
 *
 * @see {@link Commands.add}, [Commands, menus and bindings](../../../docs/reference/commands.md)
 * @since 1.0.0
 * @category Commands
 */
export interface Command extends Disposable {
  /** The local id given in {@link CommandOptions.id}. */
  readonly id: string;
  /**
   * Replace some state fields (values or functions). Last write wins.
   *
   * @remarks
   * Only this command is evaluated again, not every binding and command of
   * the plugin. Several calls within one
   * microtask send one update. A function field makes the command take part in
   * the update passes from then on. A binding that reads a plugin variable
   * changed together with `set` outside a handler the SDK runs (a timer) is not
   * refreshed by it: call {@link Scope.update} or keep that variable in
   * {@link Scope.state}.
   *
   * @example Show a command as busy while it works
   * The Export item shows as busy with "Exporting…" as its reason while the
   * export runs, then returns to normal. `set` replaces only the fields it
   * names and the SDK sends the new state to the player; a busy command's
   * menu item and key do not run it again until it is set back.
   * ```ts
   * declare function runExport(): Promise<void>;
   * // ---cut---
   * const exportCommand = plugin.commands.add({
   *   id: "export",
   *   path: ["@video", "Export…"],
   *   run: async () => {
   *     exportCommand.set({ busy: true, reason: "Exporting…" });
   *     try {
   *       await runExport();
   *     } finally {
   *       exportCommand.set({ busy: false, reason: null }); // also on failure
   *     }
   *   },
   * });
   * ```
   *
   * @capability commands
   * @since 1.0.0
   */
  set(
    state: Partial<
      { [K in "busy" | "reason"]: Bindable<CommandState[K]> } & {
        enabled: Bindable<boolean> | Condition;
        checked: Bindable<boolean | null> | Condition;
      }
    >,
  ): void;
  /**
   * Resolves when the host has registered the command. Rejects with `conflict`
   * (path already taken), `invalid` or `limit` (more than 160 commands in this
   * plugin, or 1024 in the whole player). You rarely need to await it: the
   * refusal goes to {@link Scope.onError}. During activation the SDK, in the
   * plugin's process, logs the refusal with the command id and the player's
   * message, skips the command and lets the rest of the plugin activate;
   * the error reaches `onError` once
   * activation completes, so a listener added anywhere in `activate` hears it.
   * `startPlugin` stays strict: there a refusal during activation fails it, so
   * tests show the bad declaration. Any other failure during activation
   * (`capability`, no answer) fails activation.
   *
   * Only the player's answer is skipped. What {@link Commands.add} checks
   * itself still throws from `add` (an unknown `@` menu id, more than 8
   * path segments, an `order` out of range, a malformed binding or one
   * listed twice, a bad `button`, a reason text of the wrong shape, an id
   * already declared), and fails activation unless the plugin catches it.
   *
   * @throws `conflict` (rejects) Another command already has this menu path,
   *   or the path would be both a menu item and a submenu.
   * @throws `capability` (rejects) The manifest does not declare `commands`.
   * @throws `invalid` (rejects) The player refused the declaration.
   * @throws `limit` (rejects) More than 160 commands in this plugin, or 1024 in
   *   the player.
   */
  readonly ready: Promise<void>;
}

/**
 * `plugin.commands`: menu commands with default bindings. Needs `commands`.
 *
 * @remarks
 * A command is one action of the plugin with a menu item (`path`), default keys
 * (`bindings`), optionally a bottom-bar button (`button`) and a state the menu
 * shows (`enabled`, `checked`, `busy`, `reason`). The player owns the menu, the
 * binding table and the user's key overrides: it calls `run` when the user
 * picks the item, presses a key or clicks the button. Commands of all plugins
 * merge into the player's menus by their English path keys. Registration is
 * asynchronous: `add` returns at once, and {@link Command.ready} reports the
 * player's answer (during activation the SDK logs a refusal and skips that
 * command; `startPlugin` fails on it). What `add` checks itself throws from
 * `add`.
 *
 * @capability commands
 *
 * @example Add a menu item with a default key
 * Tools ▸ Say hello, or Ctrl+H, shows a greeting. `add` declares the item;
 * the player calls `run` when the user picks it or presses its key, and the
 * user can change the key in the player's key settings.
 * ```ts
 * plugin.commands.add({
 *   id: "hello",
 *   path: ["Tools", "Say hello"],
 *   bindings: ["Ctrl+H"], // a default; the user may override it
 *   run: () => plugin.osd.show("Hello"),
 * });
 * ```
 *
 * @see {@link Command}, {@link CommandOptions}, [Commands, menus and bindings](../../../docs/reference/commands.md)
 * @since 1.0.0
 * @category Commands
 */
export interface Commands {
  /**
   * Declare a command. It is registered and kept in sync; `dispose()` removes
   * it from the menu and the binding table, and the id may be added again.
   *
   * Titles and paths cannot change in place: put changing items (track
   * lists, presets) in a child {@link Scope} and rebuild it.
   *
   * @throws `invalid` synchronously for a malformed path (including an
   *   unknown `@` menu id), order or binding; `conflict` for an id this
   *   plugin has already declared and not disposed.
   * @throws `invalid` (`ready` rejects; during activation the SDK logs and
   * skips the command and the plugin activates, see {@link Command.ready};
   * `startPlugin` fails) for a text the player refuses: an id, title, path segment, group or reason
   * that is empty, longer than its `COMMAND_LIMITS` bytes (a text value counted
   * by its English rendering), has a control character or whitespace at either
   * end, or an id with other characters than ASCII letters, digits, `.`, `_`
   * and `-`. `TestHost` refuses the same.
   *
   * @example Pause playback from a menu item
   * Playback ▸ Pause (and Ctrl+P) pauses and resumes, shows a check mark
   * while paused and is greyed out when nothing can be paused. The player
   * calls `run` when the user picks the item or presses its key; `enabled`
   * and `checked` are functions the SDK evaluates again after every
   * handler and player state change, sending only what changed.
   * ```ts
   * const toggle = plugin.commands.add({
   *   id: "toggle-pause",
   *   path: ["Playback", "Pause"],
   *   order: 210, // position among the Playback menu's items
   *   bindings: ["Ctrl+P"],
   *   enabled: () => plugin.player.state.can.pause,
   *   checked: () => plugin.player.state.paused,
   *   run: () => plugin.player.setPaused(!plugin.player.state.paused),
   * });
   * ```
   *
   * @capability commands
   * @since 1.0.0
   */
  add(options: CommandOptions): Command;
  /**
   * The keys of one of this plugin's own commands (its local id, as in
   * {@link CommandOptions.id}), written as the player's menus and command
   * palette write them: `["W"]`, `["Ctrl+B"]`, `["⌘B"]` on macOS, arrows as
   * `←`. Read-only, and always what is bound now: the user's own keys
   * after a change in Keyboard Shortcuts, none when the user cleared them
   * or turned on Ignore Default Shortcuts, and none for a key another
   * command holds. Mouse bindings are left out, and so are `Cmd`
   * bindings outside macOS (as in the menus). The first label is the one
   * the menus show.
   *
   * @remarks
   * For key hints beside a panel's controls (`KeyHint` and the `keys` of
   * `ToolTipArea` in `@vestra/widgets.slint`). Read it in a
   * {@link View.bind} function and the view follows every change; or
   * listen with `plugin.player.on("commands.keys", …)` and read it there
   * (the SDK's copy already has the event's keys). The first read asks the
   * player, and until its answer arrives (a few milliseconds) every
   * command reads `[]`; a binding that read it runs again then. That answer
   * is not an event: a `player.on` listener hears only the player's later
   * `commands.keys` events, so read the keys you start with in a `bind`
   * function, which runs again when the answer arrives, not only in the
   * listener.
   *
   * The plugin's own commands, and the player's own as `host/<id>`
   * (`host/volume-up`, `host/mute`: the ids of
   * {@link "@vestra-player/sdk/testing"!BUILTIN_COMMANDS | BUILTIN_COMMANDS}
   * rows owned by `host`), for a panel that shows the player's keys beside its
   * own controls; an id the plugin has not added (or another plugin's) reads
   * `[]`. Needs nothing beyond `commands`, not `bindings.manage` (the whole
   * binding table, every plugin's, is {@link Bindings.list}). Without the
   * `commands` capability every command reads `[]`.
   *
   * @example Show a slider's keys beside it
   * The Brightness row shows its two keys, W and E by default, as key caps
   * (`KeyHint` in `ui/picture.slint`). `keys` is read inside the `bind` function,
   * so the view gets the new labels whenever the user changes a key or
   * clears it (an empty list hides the cap).
   * ```ts
   * const pictureWindow = plugin.windows.create("ui/picture.slint");
   * plugin.commands.add({ id: "brightness.down", path: ["@video", "Brightness −"], bindings: ["W"], run() {} });
   * plugin.commands.add({ id: "brightness.up", path: ["@video", "Brightness +"], bindings: ["E"], run() {} });
   * pictureWindow.bind(() => ({
   *   // Read in bind: the view follows every key change; "" hides a cap.
   *   brightnessDown: plugin.commands.keys("brightness.down")[0] ?? "",
   *   brightnessUp: plugin.commands.keys("brightness.up")[0] ?? "",
   * }));
   * ```
   *
   * @capability commands
   * @player 0.7.6
   * @since 1.6.6
   */
  keys(id: string): readonly string[];
  /**
   * List every command the command palette lists, the player's own and
   * every plugin's, with its state now. **Built-in plugins only.**
   *
   * @remarks
   * The palette's table as data: for a plugin that runs commands for the
   * user (an assistant, a macro recorder, a remote control) or shows how to
   * reach them (a tutorial that says which key opens a window). `revision`
   * changes whenever a command is added, removed or changes state, so a copy
   * with the same revision is still current.
   *
   * @example Find the key that opens a window
   * A tutorial panel tells the user which key opens Subtitle Tuning. `list`
   * returns the palette's rows with their places and current keys; the
   * panel picks the row by its global id and shows its first key.
   * ```ts
   * try {
   *   const { commands } = await plugin.commands.list();
   *   const row = commands.find((each) => each.id === "vestra.subtitles/tuning");
   *   if (row?.keys[0]) await plugin.osd.show("Press {}", [row.keys[0]]);
   * } catch (error) {
   *   // `capability`: not a built-in plugin, or `commands.run` not declared.
   *   if ((error as PluginError).code !== "capability") throw error;
   * }
   * ```
   *
   * @capability commands.run (built-in plugins only)
   * @throws `capability` (rejects) The manifest does not declare
   *   `commands.run`, or the plugin is not built into the player.
   * @player 0.7.6
   * @since 1.7.9
   */
  list(): Promise<CommandList>;
  /**
   * Run any command the palette lists, as the palette runs it, for a request
   * the user made. **Built-in plugins only.**
   *
   * @remarks
   * Every run needs a ticket: the player mints one only for a user action
   * ({@link PaletteLeadRun.ticket}, Enter on the palette's lead row), so a
   * plugin cannot run commands on its own. The ticket ends with
   * {@link PaletteLead.done}, with the plugin's next lead run, when the
   * plugin stops, or 120 s after it was given or last used. The player
   * applies the palette's checks (enabled, not busy), shows an on-screen
   * line naming the plugin and the command (`Vestra Player AI · 1/2 ·
   * Playback: Mute`), and asks the user first (Run / Don't Run) before a
   * command declared {@link CommandOptions.destructive}, the player's Close
   * and Quit, anything in the Settings and Reset menus, and every command
   * of a plugin that is not built in. Runs are limited to 4 a second and 30
   * per ticket, and 120 a minute per plugin. The run is not added to the
   * palette's recent list.
   *
   * A request of several commands names the rest of its plan in `then` on
   * its first run (since 1.7.16): if any command of the plan asks first,
   * the player asks once, before the first command runs, listing the whole
   * plan, and the later runs of the planned commands with the same ticket
   * do not ask again. Don't Run runs none of them. See
   * {@link CommandRunOptions.then}.
   *
   * @param id - The command's global id, as {@link CommandInfo.id}:
   *   `<manifest id>/<local id>`, `host/<id>` for the player's own.
   * @param options - `ticket`: from the user action this run is for.
   *   `step` and `of`: this is step `step` of `of` (1-based), shown in the
   *   on-screen line. `then`: the commands the ticket runs next, asked for
   *   together with this one.
   * @returns `{ ran: true }` once the command was started, or
   *   `{ ran: false, declined: true }` when the user chose Don't Run.
   *
   * @example Run the commands of one request
   * The user typed "reset the picture and mute" into the palette's lead
   * row; the plugin runs the two commands it chose for it. The ticket comes
   * with the lead's run event and covers every run of this request; `done`
   * ends it. The first run names the rest of the plan in `then`, so the
   * player asks once for both (Reset: Picture asks first) before anything
   * runs. A declined confirmation or a failure stops the request.
   * ```ts
   * declare const lead: PaletteLead;
   * // ---cut---
   * lead.onRun(async ({ ticket }) => {
   *   const ids = ["vestra.video/video.reset", "host/mute"]; // chosen for the request
   *   try {
   *     for (const [index, id] of ids.entries()) {
   *       const result = await plugin.commands.run(id, {
   *         ticket,
   *         step: index + 1,
   *         of: ids.length,
   *         // The first run names the rest of the plan.
   *         ...(index === 0 ? { then: ids.slice(1) } : {}),
   *       });
   *       if (!result.ran) break; // the user chose Don't Run: nothing ran
   *     }
   *   } catch (error) {
   *     // `disabled`, `busy`, `missing`, `ticket` (expired), `limit` (rate).
   *     await plugin.osd.show("Stopped: {}", [(error as PluginError).message]);
   *   } finally {
   *     await lead.done(ticket);
   *   }
   * });
   * ```
   *
   * @capability commands.run (built-in plugins only)
   * @throws `capability` (rejects) The manifest does not declare
   *   `commands.run`, or the plugin is not built into the player.
   * @throws `ticket` (rejects) No ticket, or it ended or expired.
   * @throws `missing` (rejects) No listed command has this id, or one of
   *   the ids of `then`.
   * @throws `disabled` (rejects) The command is disabled now; `message` has
   *   its reason.
   * @throws `busy` (rejects) The command is busy, or its confirmation
   *   cannot be shown while another alert is open.
   * @throws `limit` (rejects) Over the rate limits above.
   * @throws `invalid` (rejects) Only one of `step` and `of`, or not
   *   whole numbers with 1 ≤ `step` ≤ `of` ≤ 99; `then` is not an array
   *   of at most 7 non-empty strings; or `id` or an id of `then` is the
   *   command palette itself (`host/palette`).
   * @player 0.7.6
   * @since 1.7.9
   */
  run(id: string, options: CommandRunOptions): Promise<CommandRunResult>;
}

/**
 * How {@link Commands.run} runs a command.
 *
 * @since 1.7.9
 * @category Commands
 */
export interface CommandRunOptions {
  /** The ticket of the user action the run is for ({@link PaletteLeadRun.ticket}). */
  ticket: string;
  /** This run's step number (1–99), for the on-screen line; with `of`. */
  step?: number;
  /** The request's number of steps (`step`–99); with `step`. */
  of?: number;
  /**
   * The rest of the request's plan: the global ids of the commands this
   * ticket runs next, in order. At most 7, so a plan has at most 8
   * commands; the same id may appear more than once. Absent or `null`: no
   * new plan; the run is judged as a later run below (one left in an
   * approved plan uses up an entry and does not ask). An empty array: a
   * new plan of this command alone, which replaces the rest of an earlier
   * one.
   *
   * The player looks at the whole plan, this command first. When none of
   * it asks first (see {@link Commands.run}), nothing is asked and nothing
   * is remembered. When any of it does, the player asks once, before this
   * command runs, listing every command of the plan:
   *
   * - **Run** runs this command and remembers the rest of the plan for the
   *   ticket. Each later run of a planned command with the same ticket,
   *   in any order, uses up one of its entries and does not ask. A command
   *   not left in the plan (never in it, or its entries used up) is judged
   *   on its own and asks first as usual.
   * - **Don't Run** runs nothing and remembers nothing: the result is
   *   `{ ran: false, declined: true }`.
   *
   * A later run that gives `then` again (`[]` included) starts a new plan:
   * the rest of the earlier one is forgotten and the new plan is judged as
   * above. The plan
   * ends with its ticket. The ids of `then` must be listed commands now
   * (`missing` otherwise; `host/palette` is `invalid`); whether each is
   * enabled and not busy is checked when it runs, as for any run. `then`
   * itself is no run: only runs count against the rate limits.
   *
   * Players before the approval sheet (Ask Vestra UX, step 3) ignore the
   * field and ask before each command that asks first; a built-in plugin
   * ships with its player.
   *
   * @since 1.7.16
   */
  then?: string[] | null;
}

/**
 * The outcome of {@link Commands.run}: the command started, or the user
 * declined the confirmation.
 *
 * @since 1.7.9
 * @category Commands
 */
export type CommandRunResult =
  | {
      /** The command was started. */
      ran: true;
    }
  | {
      /** The command was not started. */
      ran: false;
      /** The user chose Don't Run in the confirmation. */
      declined: true;
    };

/**
 * The command palette's table, from {@link Commands.list}.
 *
 * @since 1.7.9
 * @category Commands
 */
export interface CommandList {
  /** The table's revision: the same number means the same table. */
  revision: number;
  /**
   * Every command the palette lists, in no particular order: not a
   * panel-only command, nor a disabled one without a reason.
   */
  commands: CommandInfo[];
}

/**
 * One command of the palette's table ({@link CommandList}), with its texts
 * as the palette shows them in the interface language.
 *
 * @since 1.7.9
 * @category Commands
 */
export interface CommandInfo {
  /** The global id: `<manifest id>/<local id>`, `host/<id>` for the player's own. */
  id: string;
  /** The row's text, `Category: Title`, as shown. */
  label: string;
  /** The same in English source text. */
  labelSource: string;
  /** The command's title as shown. */
  title: string;
  /**
   * The row's category as shown: the declared category, else the menu path
   * above the command (`Video ▸ Snapshot`), else the plugin's name.
   */
  category: string;
  /** Its menu path as shown, empty for a command outside the menus. */
  path: string[];
  /**
   * Where it lives: the window its `home` command opens, `Menu`, the menu
   * above it (`Video ▸`), or `""` outside the menus.
   */
  place: string;
  /** Its current keys as the menus write them. */
  keys: string[];
  /** The owning plugin's name as shown, `Vestra Player` for the player's own. */
  plugin: string;
  /** The owner is the player or a built-in plugin. */
  builtin: boolean;
  /** It can run now. */
  enabled: boolean;
  /** Why it is disabled, as shown (only while disabled). */
  reason?: string;
  /** It has a check mark or a radio dot. */
  checkable: boolean;
  /** The check mark now (with `checkable`). */
  checked?: boolean;
  /** The mark is a radio dot. */
  radio: boolean;
  /** Its separator group in the menu. */
  group: string;
  /** It is busy now. */
  busy: boolean;
  /** {@link Commands.run} asks the user before running it. */
  dangerous: boolean;
}

// ---------------------------------------------------------------- palette lead (palette.lead)

/**
 * `plugin.palette`: the command palette's lead row.
 *
 * @remarks
 * The palette's first row hands what the user typed to a plugin: a
 * calculator ("3.5 GB in MB"), a library or history search, jump to a time,
 * an assistant that runs commands for a sentence. There is one lead in the
 * player, and only a built-in plugin can hold it.
 *
 * @capability palette.lead (built-in plugins only)
 *
 * @example Answer typed time stamps from the palette
 * The palette's first row reads "Go to: 12:30"; Enter seeks there. `lead`
 * puts the row up; the player sends the typed text with Enter, and the
 * plugin ends the request with `done`.
 * ```ts
 * // Put up the row once, in activate: the player keeps it while stopped.
 * const lead = plugin.palette.lead({ title: "Go to", icon: "search" });
 * lead.onRun(async ({ query, ticket }) => {
 *   const [minutes = 0, seconds = 0] = query.split(":").map(Number); // "12:30"
 *   await plugin.player.seek(minutes * 60 + seconds);
 *   await lead.done(ticket); // this request needs no command runs
 * });
 * ```
 *
 * @player 0.7.6
 * @since 1.7.9
 * @category Commands
 */
export interface Palette {
  /**
   * Put up the palette's lead row. **Built-in plugins only.**
   *
   * The player keeps the row while the plugin is stopped and starts the
   * plugin for a run, so call it in `activate`. Disposing the handle (or
   * its scope) removes the row.
   *
   * @example See Palette
   * {@link Palette}
   *
   * @capability palette.lead (built-in plugins only)
   * @throws `capability` (through `ready`) The manifest does not declare
   *   `palette.lead`, or the plugin is not built into the player.
   * @throws `conflict` (through `ready`) Another plugin holds the lead.
   * @throws `invalid` (through `ready`) A text over its length.
   * @player 0.7.6
   * @since 1.7.9
   */
  lead(options: PaletteLeadOptions): PaletteLead;
}

/**
 * What the palette's lead row shows ({@link Palette.lead}). Texts are
 * English source text or a {@link Text}, translated like command titles.
 *
 * @since 1.7.9
 * @category Commands
 */
export interface PaletteLeadOptions {
  /** The row reads `title: <typed text>`, or `title` alone with nothing typed (1–40 characters). */
  title: string | Text;
  /** A name of the player's icon set ({@link BarButtonIcon}) or an image from {@link Ui.image}. */
  icon: BarButtonIcon | ImageRef;
  /** The search field's placeholder (up to 60 characters). */
  placeholder?: string | Text;
  /** Dimmed after `title` while nothing is typed (up to 80 characters). */
  empty?: string | Text;
  /** On the right of the row ("Set up a model first"; up to 40 characters). */
  note?: string | Text;
  /**
   * Replaces the row while nothing is typed (a running request; the cursor
   * starts on it); `null` or absent: none. Its run event has `status: true`.
   * While the palette is closed the player shows it in a status strip at
   * the top of the main window, as its `state` says.
   */
  status?: {
    /** The status text (up to 80 characters). */
    text: string | Text;
    /** On the right of the row (up to 40 characters). */
    note?: string | Text;
    /**
     * Still working or ended. Absent: `"working"`.
     *
     * - `"working"`: the work goes on. The strip shows the text with a
     *   moving line and a Stop button (Stop is Enter on the status row)
     *   and stays until the status changes or is removed.
     * - `"done"`, `"failed"`, `"note"`: an end state (finished; failed; a
     *   sentence for the user, such as an answer). The player shows it
     *   with a check, in the danger colour, or plain, then removes it by
     *   itself after a few seconds (about 2 s, 6 s, and 4–10 s by length;
     *   longer while the pointer is on it). It is shown once: not kept,
     *   not shown again later (when the plugin is stopped or woken), and
     *   the row goes back to its usual form. The plugin needs no timer of
     *   its own and may call {@link PaletteLead.done} right after setting
     *   it.
     *
     * Once {@link Commands.run} has shown a step of the ticket in the
     * strip, a `"working"` text changes only the palette's status row,
     * until an end state, `status: null` or the end of the ticket.
     *
     * Players before the status strip refuse the field (`invalid`); a
     * built-in plugin ships with its player. Any other value: `invalid`
     * (through `ready`, or `update` rejects).
     *
     * @since 1.7.15
     */
    state?: "working" | "done" | "failed" | "note";
  } | null;
}

/**
 * The user activated the lead row: the data of {@link PaletteLead.onRun}.
 *
 * @since 1.7.9
 * @category Commands
 */
export interface PaletteLeadRun {
  /** What was typed in the palette. */
  query: string;
  /** Shift+Enter: the palette stays open. */
  keep: boolean;
  /**
   * The ticket of this user action, for {@link Commands.run} and
   * {@link PaletteLead.done}.
   */
  ticket: string;
  /** The user activated the status row ({@link PaletteLeadOptions.status}), for example to stop. */
  status: boolean;
}

/**
 * The palette's lead row, from {@link Palette.lead}. Disposing it removes
 * the row.
 *
 * @remarks
 * Holds the row while the scope lives. `update` changes what it shows (a
 * status while a request runs, a note while it cannot run); `onRun` hears
 * each activation; `done` ends the ticket of a finished request.
 *
 * @capability palette.lead (built-in plugins only)
 *
 * @example Show a status while a request runs
 * While the plugin works on a request the row shows "Working… (Enter to
 * stop)"; Enter on it stops the work. The status row replaces the lead
 * while nothing is typed; its run event has `status: true`.
 * ```ts
 * const lead = plugin.palette.lead({ title: "Ask", icon: "search" });
 * let stop = new AbortController();
 * lead.onRun(async ({ query, ticket, status }) => {
 *   if (status) return stop.abort(); // Enter on the status row
 *   stop = new AbortController();
 *   await lead.update({ title: "Ask", icon: "search", status: { text: "Working… (Enter to stop)" } });
 *   try {
 *     await plugin.osd.show("Asked: {}", [query]);
 *   } finally {
 *     await lead.update({ title: "Ask", icon: "search" });
 *     await lead.done(ticket);
 *   }
 * });
 * ```
 *
 * @player 0.7.6
 * @since 1.7.9
 * @category Commands
 */
export interface PaletteLead extends Disposable {
  /**
   * Settles when the player has the row.
   *
   * @throws `capability` (rejects) Not declared, or not a built-in plugin.
   * @throws `conflict` (rejects) Another plugin holds the lead.
   * @throws `invalid` (rejects) A text over its length.
   */
  readonly ready: Promise<void>;
  /**
   * Replace what the row shows.
   *
   * @example See PaletteLead
   * {@link PaletteLead}
   *
   * @capability palette.lead (built-in plugins only)
   * @throws `invalid` (rejects) A text over its length.
   * @throws `capability` (rejects) The row was refused (see `ready`).
   * @since 1.7.9
   */
  update(options: PaletteLeadOptions): Promise<void>;
  /**
   * Listen to the user activating the row (Enter, Shift+Enter or a click).
   * The player starts a stopped plugin for it.
   *
   * @example Keep the palette open for another conversion
   * A unit converter shows its answer and, after Shift+Enter, leaves the
   * palette open for the next one. The listener gets the typed text and
   * `keep`; the player closes the palette on Enter by itself.
   * ```ts
   * declare const lead: PaletteLead;
   * // ---cut---
   * lead.onRun(async ({ query, keep, ticket }) => {
   *   const gigabytes = Number.parseFloat(query); // "3.5 GB in MB"
   *   await plugin.osd.show("{} MB", [gigabytes * 1024]);
   *   if (keep) await plugin.osd.show("Type the next value");
   *   await lead.done(ticket);
   * });
   * ```
   *
   * @capability palette.lead (built-in plugins only)
   * @since 1.7.9
   */
  onRun(listener: (run: PaletteLeadRun) => void): Disposable;
  /**
   * End a request's ticket: {@link Commands.run} refuses it from now on.
   *
   * @example End a request when it fails
   * A macro plugin stops at the first command that fails and ends the
   * ticket, so nothing more runs for this request. `done` ends the ticket
   * at once; without it the ticket would end 120 s after its last run.
   * ```ts
   * declare const lead: PaletteLead;
   * // ---cut---
   * lead.onRun(async ({ ticket }) => {
   *   try {
   *     await plugin.commands.run("host/mute", { ticket });
   *   } catch {
   *     await plugin.osd.show("Macro stopped"); // ticket, limit, disabled…
   *   } finally {
   *     await lead.done(ticket);
   *   }
   * });
   * ```
   *
   * @capability palette.lead (built-in plugins only)
   * @throws `capability` (rejects) The manifest does not declare `palette.lead`.
   * @since 1.7.9
   */
  done(ticket: string): Promise<void>;
}

/**
 * The core's basic playback actions (menu commands owned by the player),
 * and the main window's fullscreen toggle.
 *
 * | action | default bindings | behaviour |
 * | --- | --- | --- |
 * | `stop` | F4 | close the source |
 * | `play-pause` | Space, a left click on the video | pause / resume, replay after the end |
 * | `previous` / `next` | PageUp, Mouse:X2 / PageDown, Mouse:X1 | ask the sequence provider |
 * | `frame-back` / `frame-forward` | D / F | `player.step("frame", …)` |
 * | `seek-backward` / `seek-forward` | ← / → | relative seek by `setStepSeek` seconds (or `host.run`'s `seconds`), exact or to keyframes as `setStepSeek` says; after the end an exact seek that plays on |
 * | `rate-normal`, `rate-down`, `rate-up` | Z, X, C | 1×, ±0.1 within 0.25–4 |
 * | `volume-up` / `volume-down` | ↑ / ↓, wheel | ±5 (`volume-up` stops at 100) |
 * | `mute` | M | toggle mute |
 * | `fullscreen` | Escape | toggle the main window's fullscreen: enter it when windowed, leave it when fullscreen, as the Toggle Fullscreen command does (`unavailable` when the player has no window) |
 *
 * In the binding overlay their keys are `host/<action>`. `fullscreen` changes
 * no playback state: read the result from `window.state.fullscreen`
 * (`plugin.window.onChange`), which also changes when the user toggles it.
 *
 * @see {@link Host.run}
 * @since 1.0.0
 * @category Commands
 */
export type HostAction =
  | "play-pause"
  | "stop"
  | "previous"
  | "next"
  | "frame-back"
  | "frame-forward"
  | "seek-backward"
  | "seek-forward"
  | "rate-down"
  | "rate-up"
  | "rate-normal"
  | "volume-up"
  | "volume-down"
  | "mute"
  | "fullscreen";

/**
 * `plugin.host`: the player's own core actions.
 *
 * @remarks
 * The player's core actions (play/pause, stop, step seeks, speed, volume,
 * fullscreen…) are commands of the player itself, `host/<action>` in the
 * binding table. Running them through `host.run` gives a plugin's own
 * buttons exactly the player's behaviour: the same checks, the same
 * accumulation of repeated presses and the same on-screen text, instead of
 * reimplementing them with {@link Player} calls.
 *
 * @capability commands
 *
 * @example Give a custom bar the player's own Stop and Mute
 * The plugin's bar buttons stop playback and mute exactly as the player's
 * own keys do, with the same on-screen text. Each callback runs a core
 * action; the player applies its checks and rejects with `unavailable`
 * while the action is disabled, which the bar ignores.
 * ```ts
 * declare const bar: Panel;
 * // ---cut---
 * const run = (action: HostAction) =>
 *   plugin.host.run(action).catch((error: PluginError) => {
 *     if (error.code !== "unavailable") throw error; // disabled right now
 *   });
 * bar.on("stop", () => run("stop"));
 * bar.on("mute", () => run("mute"));
 * ```
 *
 * @see {@link HostAction}, {@link Player}
 * @since 1.0.0
 * @category Commands
 */
export interface Host {
  /**
   * Run a core action exactly like its menu item or key: same checks, same
   * on-screen text. Resolves when it finished (or was dropped because the
   * same action is still running). Rejects `unavailable` when disabled,
   * `invalid` for an unknown id. Needs `commands`.
   *
   * Prefer this over reimplementing playback buttons.
   *
   * @example Make a bar button play and pause like Space
   * The plugin's own Play button behaves exactly like the player's Space
   * key, including its on-screen text. `host.run` runs the core action
   * with the player's checks; it resolves when the action finished, and
   * rejects with `unavailable` while the action is disabled (nothing open).
   * ```ts
   * declare const bar: Panel;
   * // ---cut---
   * bar.on("playPause", async () => {
   *   try {
   *     await plugin.host.run("play-pause");
   *   } catch (error) {
   *     if ((error as PluginError).code !== "unavailable") throw error;
   *     // Nothing to play: the button simply does nothing.
   *   }
   * });
   * ```
   *
   * @capability commands
   * @throws `unavailable` (rejects) The action is disabled right now (nothing
   *   open, no window for `fullscreen`).
   * @throws `invalid` (rejects) An unknown action, or `seconds` out of range.
   * @throws `capability` (rejects) The manifest does not declare `commands`.
   *
   * @since 1.0.0
   */
  run(action: HostAction): Promise<void>;
  /**
   * One step seek of `seconds` (0.1–3600 in tenths) instead of the
   * {@link Player.setStepSeek} step: the same checks, mode (exact or
   * keyframes), accumulation and on-screen text as ← / →. Use it for more
   * seek steps of your own (Ctrl+→ and the like) so that they add up with
   * the core's and land the same way.
   *
   * In keyframe mode it resolves once the seek has landed (so
   * `player.state.position` is current after the `await`); presses that add
   * up resolve together, the last with the text. In exact mode it resolves
   * once the seek is submitted, as before. `invalid` for `seconds` out of
   * range.
   *
   * @player 0.5.1
   * @since 1.5.19
   *
   * @example Add a 30-second skip that adds up with the arrow keys
   * The plugin's "+30 s" button seeks forward 30 seconds and shows the same
   * text as →. Passing `seconds` makes the core step seek use that step
   * with the player's mode (exact or keyframes); quick presses of it and of
   * → add up into one seek.
   * ```ts
   * declare const bar: Panel;
   * // ---cut---
   * bar.on("forward30", () => plugin.host.run("seek-forward", { seconds: 30 }));
   * ```
   *
   * @capability commands
   * @throws `unavailable` (rejects) The action is disabled right now (nothing
   *   open, no window for `fullscreen`).
   * @throws `invalid` (rejects) An unknown action, or `seconds` out of range.
   * @throws `capability` (rejects) The manifest does not declare `commands`.
   */
  run(
    action: "seek-backward" | "seek-forward",
    options: { seconds: number },
  ): Promise<void>;
}

// ---------------------------------------------------------------- bindings (bindings.manage)

/**
 * A command: manifest id (`"host"` for the player's own) and command id.
 *
 * @since 1.0.0
 * @category Commands
 */
export interface BindingRef {
  /** Manifest id, or `"host"`. */
  plugin: string;
  /** Command id within that plugin. */
  command: string;
}

/**
 * One command's bindings, from {@link Bindings.list}.
 *
 * @since 1.0.0
 * @category Commands
 */
export interface BindingInfo extends BindingRef {
  /** Menu title. */
  title: string;
  /** Menu path as shown; `null` for a command outside the menu. */
  path: string[] | null;
  /**
   * The menu path's keys: the English text menus merge by, the same in every
   * interface language (`["Playback", "Seek", "Back 5 s"]`; a built-in menu by
   * its key, `"Video"`, also when declared as `@video`). `null` for a command
   * outside the menu. Find a command by where it is in the menu with this, not
   * with `path`. Always set by `list()`.
   *
   * @since 1.5.11
   */
  key?: string[] | null;
  /**
   * The command's category as shown ({@link CommandOptions.category},
   * translated), `null` when it declares none. Always set by `list()`. A list
   * of commands names one `Category: Title`; without a category, use the menu
   * path (`path`) as before.
   *
   * @since 1.6.4
   */
  category?: string | null;
  /** Global, or only while the plugin's panel has focus. */
  scope: "global" | "panel";
  /** The command's own bindings. */
  defaults: string[];
  /** In effect for it: the user's override, else the defaults. */
  current: string[];
  /** The user overrode the defaults. */
  overridden: boolean;
  /** Inputs of `current` another command holds. */
  shadowed: {
    /** The input. */
    input: string;
    /** The command that holds it. */
    by: BindingRef;
  }[];
  /** Menu text of each of `current` (`Ctrl+←`, `Num5`). */
  labels: string[];
}

/**
 * `plugin.bindings`: list and override every command's bindings, including
 * the player's. Needs `bindings.manage`.
 *
 * @example Unbind the player's Mute key, then restore it
 * The player's Mute command loses its default key, and later gets it
 * back. `set` with `[]` saves an override that unbinds the command
 * (remembered across launches); `reset` removes the override, so the
 * command's own default bindings apply again.
 * ```ts
 * await plugin.bindings.set({ plugin: "host", command: "mute" }, []);
 * // later
 * await plugin.bindings.reset({ plugin: "host", command: "mute" });
 * ```
 *
 * @remarks
 * The player's binding table: every command's default keys (from
 * {@link CommandOptions.bindings}, the player's own as `host/<action>`)
 * and the user's overrides on top, saved across launches. A key-settings
 * plugin lists the table, writes overrides and resets them; the player
 * applies the change at once to every running plugin.
 *
 * @capability bindings.manage
 * @see [Commands, menus and bindings](../../../docs/reference/commands.md)
 * @since 1.0.0
 * @category Commands
 */
export interface Bindings {
  /**
   * Every declared command, and overrides whose command is gone.
   *
   * A `focus: "panel"` command of a plugin whose manifest does not declare
   * `ui.mount` is left out (player 0.8.0): it has no panel, so no key can
   * reach it. It is still declared: its stored binding is not an orphan,
   * and `set` accepts it.
   *
   * @capability bindings.manage
   * @throws `capability` (rejects) The manifest does not declare
   *   `bindings.manage`.
   *
   * @example Find the commands that use a key
   * A key-settings window shows which commands Ctrl+K is bound to now. `list`
   * resolves with every declared command and its current bindings (the
   * defaults with the user's overrides applied) and with the overrides
   * whose command is not running (`orphans`).
   * ```ts
   * const { commands } = await plugin.bindings.list();
   * const users = commands.filter((command) => command.current.includes("Ctrl+K"));
   * console.log(users.map((command) => `${command.plugin}/${command.command}`)); // "host" for the player
   * ```
   *
   * @since 1.0.0
   */
  list(): Promise<{
    /** Every declared command (running plugins and the player). */
    commands: BindingInfo[];
    /** Overrides whose command is not declared now (plugin stopped or removed). */
    orphans: {
      /** The command the override is for. */
      ref: BindingRef;
      /** The saved inputs. */
      inputs: string[];
    }[];
  }>;
  /**
   * Override a command's bindings (`[]` unbinds it); saved across launches.
   * `invalid` for a bad binding, `missing` for an unknown command that has
   * no override either.
   * At most 16 inputs, syntax as {@link CommandOptions.bindings}.
   *
   * @capability bindings.manage
   * @throws `invalid` (rejects) A malformed binding, or more than 16.
   * @throws `missing` (rejects) An unknown command that has no override
   *   either.
   * @throws `capability` (rejects) The manifest does not declare
   *   `bindings.manage`.
   *
   * @example Give the player's Mute command a second key
   * Mute now answers to M and to Ctrl+M. `set` replaces the command's
   * bindings with the list given (an override saved across launches), so it
   * repeats the default it keeps; `[]` would unbind it.
   * ```ts
   * await plugin.bindings.set({ plugin: "host", command: "mute" }, ["M", "Ctrl+M"]);
   * ```
   *
   * @since 1.0.0
   */
  set(ref: BindingRef, inputs: string[]): Promise<void>;
  /**
   * Back to the defaults: one command, or every override when omitted.
   *
   * @capability bindings.manage
   * @throws `missing` (rejects) A command that has no override and is not
   *   declared.
   * @throws `capability` (rejects) The manifest does not declare
   *   `bindings.manage`.
   *
   * @example Restore every default key
   * A "Restore defaults" button removes all of the user's overrides, so
   * every command has its declared keys again. Without an argument `reset`
   * clears every override; with a reference only that command's.
   * ```ts
   * await plugin.bindings.reset(); // every override
   * ```
   *
   * @since 1.0.0
   */
  reset(ref?: BindingRef): Promise<void>;
  /**
   * The binding list changed (read `list()` again): a declaration or an
   * override. At most every 200 ms, and only when the list itself changed,
   * not when a plugin starts again with the same commands.
   *
   * @capability bindings.manage
   *
   * @example Refresh a key list when bindings change
   * The plugin's key list stays current when the user changes a key in the
   * player or a plugin with other commands is installed. The listener
   * carries no data and runs at most every 200 ms; the plugin reads the
   * table again with `list`.
   * ```ts
   * declare function render(commands: BindingInfo[]): void;
   * // ---cut---
   * plugin.bindings.onChange(async () => {
   *   const { commands } = await plugin.bindings.list(); // read the new table
   *   render(commands);
   * });
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: () => void): Disposable;
}
