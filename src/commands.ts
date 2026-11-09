/** Finite candidate command registry. Host authenticates owner; no plugin supplies an owner id. */
import type { Json, Transport } from "./wire.ts";
import type { ListJson, TextJson } from "./i18n.ts";
import type { ConditionJson } from "./plugin/when.ts";
/**
 * The player's command registry caps, the same values as the player's own
 * table (the player's tests check that they agree). They are runaway guards,
 * not product limits: a command added past them is refused by the player
 * with code `limit` (its `ready` rejects; during activation, activation
 * fails; later the failure goes to `Scope.onError`), commands
 * already registered are unaffected, and disposing a command frees its slot
 * at once. {@link TestHost} enforces the same caps.
 *
 * The other fields are the player's rules for one declaration (since
 * 1.5.48): a command past them is refused with `invalid`, the same way.
 *
 * For menus built from media content (tracks, chapters, presets), set your
 * own sensible display cap well below `perPlugin`.
 *
 * @example Cap a chapter menu well below the command limit
 * The Chapters submenu lists at most 50 chapters, however many the file
 * has. Every menu item is a command, and the player counts them per plugin.
 * `add` itself returns at once and never throws `limit`: past `perPlugin`
 * the player refuses the registration, which fails the activation or, later,
 * reaches `Scope.onError`. A try/catch around `add` cannot catch that, so a
 * menu built from media content keeps its own cap and leaves room for the
 * plugin's fixed commands.
 * ```ts
 * declare const chapters: { title: string; time: number }[];
 * // ---cut---
 * import { COMMAND_LIMITS } from "@vestra-player/sdk/testing";
 *
 * // 20 slots stay free for the plugin's own commands.
 * const shown = chapters.slice(0, Math.min(50, COMMAND_LIMITS.perPlugin - 20));
 * ```
 *
 * @since 1.0.0
 * @category Testing
 */
export const COMMAND_LIMITS = {
  /**
   * Commands one plugin instance may have at the same time (160).
   */
  perPlugin: 160,
  /** Commands of every plugin plus the player's own, together (1024). */
  total: 1024,
  /**
   * Segments of a menu path, the leaf included.
   *
   * @since 1.5.48
   */
  depth: 8,
  /**
   * UTF-8 bytes of a command's local id: ASCII letters, digits, `.`,
   * `_` and `-`.
   *
   * @since 1.5.48
   */
  idBytes: 128,
  /**
   * UTF-8 bytes of a title, a text value counted by its English
   * rendering. Like every command text: not empty, no control characters,
   * no whitespace at either end.
   *
   * @since 1.5.48
   */
  titleBytes: 128,
  /**
   * UTF-8 bytes of a menu path segment, a text value counted by its
   * English rendering.
   *
   * @since 1.5.48
   */
  segmentBytes: 80,
  /**
   * UTF-8 bytes of a group.
   *
   * @since 1.5.48
   */
  groupBytes: 80,
  /**
   * UTF-8 bytes of a category (`CommandOptions.category`), a text value
   * counted by its English rendering.
   *
   * @since 1.6.4
   */
  categoryBytes: 80,
  /**
   * UTF-8 bytes of a state's reason, as shown in the player's
   * language.
   *
   * @since 1.5.48
   */
  reasonBytes: 512,
  /**
   * The largest `order` either way: an order is within ±1,000,000.
   *
   * @since 1.5.48
   */
  order: 1_000_000,
} as const;
/**
 * The player's built-in top-level menus, by id. Write `@<id>` as the first
 * segment of a command path (`["@video", "Blur"]`, see `CommandOptions.path`)
 * to put a command into that menu whatever language the player's menus are in.
 * Later segments are titles.
 * `reset`: the Reset menu, directly below Settings, gathers every command that
 * puts something back to its default. The player's tests check that this list
 * agrees with the player's.
 *
 * @example Put a command into the built-in Video menu
 * "Blur" appears in the player's Video menu in every interface language.
 * The player replaces a leading `@video` with that menu's key ("Video")
 * before it merges paths, so the item joins the built-in menu; an id that
 * is not in `MENU_IDS` makes `add` fail with `invalid`, which a test can
 * rule out ahead of time.
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * // ---cut---
 * import assert from "node:assert/strict";
 * import { MENU_IDS } from "@vestra-player/sdk/testing";
 *
 * plugin.commands.add({ id: "blur", path: ["@video", "Blur"], run() {} });
 * assert.ok(MENU_IDS.includes("video")); // a menu id, not a title
 * ```
 *
 * @since 1.3.0
 * @category Testing
 */
export const MENU_IDS = [
  "open",
  "playback",
  "subtitles",
  "video",
  "audio",
  "screen",
  "settings",
  "reset",
] as const;

/**
 * The icons a bottom-bar button may name (`CommandOptions.button.icon`): every
 * icon of the player's V-Line set, `@vestra/icons.slint` (draw one in your own
 * Slint with `Icon { name: "store"; }`). The player's tests check that this
 * list is its icon set. `"sliders"` (three sliders, the player's Adjustments
 * and Effects button).
 *
 * @example Check in a test that the button's icon exists
 * The test fails before release if the plugin's bar button names an icon
 * the player does not have. `commands.add` would refuse an unknown name
 * with `invalid`; the player's tests keep `BAR_BUTTON_ICONS` equal to its
 * icon set, so checking against it is the same check without a player.
 * ```ts
 * import assert from "node:assert/strict";
 * import { BAR_BUTTON_ICONS } from "@vestra-player/sdk/testing";
 *
 * assert.ok(BAR_BUTTON_ICONS.includes("store")); // the icon main.ts uses
 * ```
 *
 * @since 1.5.29
 *
 * @category Testing
 */
export const BAR_BUTTON_ICONS = [
  "play",
  "pause",
  "stop",
  "back",
  "forward",
  "open",
  "volume",
  "mute",
  "playlist",
  "detach",
  "attach",
  "close",
  "failed",
  "move-top",
  "move-up",
  "move-down",
  "move-bottom",
  "search",
  "chapter",
  "bookmark",
  "check-task",
  "check-box",
  "menu-check",
  "submenu",
  "scroll-up",
  "scroll-down",
  "caret-down",
  "sort-asc",
  "sort-desc",
  "tag-remove",
  "preview-play",
  "add",
  "remove",
  "sort",
  "fullscreen",
  "exit-fullscreen",
  "store",
  "ai",
  "sliders",
] as const;

/**
 * The player's limits on bottom-bar buttons (`CommandOptions.button`), the same
 * values as the player's (its tests check that they agree). A button past
 * `perPlugin` has none (its command still registers and its menu entry stays).
 * `total` is what the strip holds: the `total` lowest by order, plugin id and
 * declaration order; the rest are in the strip's » menu, in the same order.
 *
 * @since 1.5.29
 *
 * @category Testing
 */
export const BAR_BUTTON_LIMITS = {
  /** Buttons one plugin shows (1). */
  perPlugin: 1,
  /** Buttons in the strip, every plugin together, besides the player's own (8); the rest are in its » menu. */
  total: 8,
  /** The highest `order` (999; the lowest is 0). */
  maxOrder: 999,
} as const;

/**
 * A submenu that one of the player's built-in plugins declares: an entry of
 * {@link BUILTIN_SUBMENUS}.
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export interface BuiltinSubmenu {
  /**
   * The submenu's key path: the English texts paths merge by, the
   * built-in menu first by its key (`"Playback"` for `@playback`). Write
   * these segments, followed by your command's title, to put a command into
   * this submenu.
   */
  readonly path: readonly string[];
  /** The built-in plugins that declare it (`vestra.history`). */
  readonly plugins: readonly string[];
}

/**
 * The submenus the player's built-in plugins declare, by key path, in menu
 * order (built-in menus as in {@link MENU_IDS}, then top-level submenus).
 * Menu paths merge by their English key, so a command whose path starts
 * with the same keys appears in the same submenu, whatever the interface
 * language; the submenu's title is the declaring plugin's translation. The
 * player's own submenus (`Playback ▸ Speed`, `Playback ▸ Seek`) are not
 * listed. The player's tests check that this list agrees with what its
 * built-in plugins declare.
 *
 * @example Add an item to the built-in Snapshot submenu
 * "Copy Snapshot" appears in Snapshot ▸ next to the built-in capture
 * plugin's items. Paths merge by their English keys, so a command whose
 * path starts with the submenu's keys (`["Snapshot"]`, a top-level submenu)
 * lands in the same submenu whatever the interface
 * language.
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * declare function copySnapshot(): Promise<void>;
 * // ---cut---
 * import { BUILTIN_SUBMENUS } from "@vestra-player/sdk/testing";
 *
 * const snapshot = BUILTIN_SUBMENUS.find((menu) => menu.path.at(-1) === "Snapshot")!;
 * plugin.commands.add({
 *   id: "snapshot-to-clipboard",
 *   // ["Snapshot", "Copy Snapshot"]
 *   path: [...snapshot.path, "Copy Snapshot"],
 *   run: copySnapshot,
 * });
 * ```
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export const BUILTIN_SUBMENUS: readonly BuiltinSubmenu[] = Object.freeze([
  { path: ["Open", "Recently Played"], plugins: ["vestra.history"] },
  { path: ["Audio Track"], plugins: ["vestra.audio"] },
  { path: ["Subtitle Track"], plugins: ["vestra.subtitles"] },
  { path: ["Snapshot"], plugins: ["vestra.capture"] },
]);

/**
 * A command the player or one of its built-in plugins registers: an entry
 * of {@link BUILTIN_COMMANDS}.
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export interface BuiltinCommand {
  /** `"host"` for the player's own commands, else the built-in plugin's id. */
  readonly owner: string;
  /** The command's id within its owner (`"play-pause"`, `"capture.save"`). */
  readonly id: string;
  /**
   * The menu path by key (the English texts paths merge by), the leaf
   * included; a built-in menu by its key (`"Video"`, not `"@video"`).
   * Empty for a command that is not in the main menu (a panel shortcut).
   */
  readonly path: readonly string[];
  /** The English title (the last segment of `path` when there is one). */
  readonly title: string;
  /** The default bindings, canonical, in the order the command declares them. */
  readonly bindings: readonly string[];
  /** `"panel"`: the bindings apply only while the owner's panel has focus. */
  readonly focus: "panel" | null;
}

/** owner | id | key path, or (title) outside the menu | bindings | panel */
const BUILTIN_COMMAND_TABLE = `
vestra.playback | open | Open File… | Ctrl+O, F3
vestra.playback | open-url | Open ▸ Open URL… | Ctrl+U
vestra.playlist | playlist.open-folder | Open ▸ Open Folder… | F2
vestra.subtitles | load | Open ▸ Open Subtitle… | Alt+O
vestra.subtitles | load-secondary | Open ▸ Add Secondary Subtitle…
vestra.audio | audio.load | Open ▸ Load External Audio…
vestra.subtitle-online | search | Open ▸ Search and Download Subtitles…
vestra.history | recent.empty | Open ▸ Recently Played ▸ (No Entries)
vestra.history | recent.prune | Open ▸ Recently Played ▸ Remove Invalid Entries
vestra.history | recent.clear | Open ▸ Recently Played ▸ Clear Entries
vestra.history | recent.enabled | Open ▸ Recently Played ▸ Record Playback History
host | stop | Close | F4
host | play-pause | Play/Pause | Space, Mouse:LeftClick
vestra.audio | audio.track.none | Audio Track ▸ No Audio Tracks
vestra.subtitles | track-off | Subtitle Track ▸ Off
vestra.capture | capture.save | Snapshot ▸ Save Current Frame | Ctrl+E
vestra.capture | capture.copy | Snapshot ▸ Copy Current Frame | Ctrl+C
vestra.capture | capture.burst | Snapshot ▸ Burst… | Ctrl+G
vestra.capture | capture.clip | Snapshot ▸ Export Clip…
vestra.capture | capture.panel | Snapshot ▸ Capture… | Alt+S
host | adjust | Adjustments and Effects
host | sidebar | Sidebar
vestra.marks | marks.list | Chapter and Bookmark List… | H
host | fullscreen | Toggle Fullscreen | Escape
vestra.workshop | workshop.open | Vestra Player AI…
vestra.store | open | Plugin Store…
host | palette | Command Palette… | Ctrl+Shift+P
vestra.preferences | options | Options… | F5
vestra.info | info.about | About Vestra Player… | F1
host | quit | Quit | Cmd+Q
host | previous | (Previous) | PageUp, Mouse:X2
host | next | (Next) | PageDown, Mouse:X1
host | enter-fullscreen | (Enter Fullscreen)
host | exit-fullscreen | (Leave Fullscreen)
host | volume-up | (Volume +) | ArrowUp, Mouse:WheelUp
host | volume-down | (Volume −) | ArrowDown, Mouse:WheelDown
host | mute | (Mute) | M
host | frame-back | (Previous Frame) | D
host | frame-forward | (Next Frame) | F
host | seek-backward | (Back 5 s) | ArrowLeft
host | seek-forward | (Forward 5 s) | ArrowRight
host | rate-normal | (Normal) | Z
host | rate-down | (Slower 0.1) | X
host | rate-up | (Faster 0.1) | C
vestra.video | video.picture | (Picture…) | Alt+1
vestra.audio | audio.workbench | (Audio…) | Alt+2
vestra.subtitles | tune | (Subtitles…) | Alt+3
vestra.playback | panel | (Playback…) | Alt+4
vestra.playlist | playlist.visibility | (Playlist) | F6
vestra.playback | reopen | (Reopen Current/Last File) | Ctrl+Y
vestra.playback | copy-name | (File Name)
vestra.playback | copy-folder | (Folder Path)
vestra.playback | copy-path | (Full Path)
vestra.playback | prevent-sleep | (Disable Screen Saver While Playing)
vestra.playback | hover-time | (Show Time on Seek Bar Hover)
vestra.playback | hover-thumbnail | (Show Thumbnail on Seek Bar Hover)
vestra.playback | ab.set-a | (Set Start Point) | [
vestra.playback | ab.clear-a | (Clear Start Point) | {
vestra.playback | ab.a-back | (Start Point Back 0.1 s) | Ctrl+[
vestra.playback | ab.a-forward | (Start Point Forward 0.1 s) | Alt+[
vestra.playback | ab.set-b | (Set End Point) | ]
vestra.playback | ab.clear-b | (Clear End Point) | }
vestra.playback | ab.b-back | (End Point Back 0.1 s) | Ctrl+]
vestra.playback | ab.b-forward | (End Point Forward 0.1 s) | Alt+]
vestra.playback | ab.back | (Move Range Back 0.1 s) | Ctrl+Alt+[
vestra.playback | ab.forward | (Move Range Forward 0.1 s) | Ctrl+Alt+]
vestra.playback | ab.segment | (Loop Current Chapter or Bookmark Range) | Alt+\\
vestra.playback | ab.toggle | (A-B Loop On/Off) | \\
vestra.playback | ab.count.endless | (Endless)
vestra.playback | ab.count.1 | (Once)
vestra.playback | ab.count.2 | (2 Times)
vestra.playback | ab.count.3 | (3 Times)
vestra.playback | ab.count.5 | (5 Times)
vestra.playback | ab.count.10 | (10 Times)
vestra.window | hide-cursor | (Hide Pointer While Playing)
vestra.window | pip | (Picture-in-Picture)
vestra.window | mini | (Mini Size) | \`
vestra.window | size.0.5 | (0.5×) | 1
vestra.window | size.1 | (1×) | 2
vestra.window | size.1.5 | (1.5×) | 3
vestra.window | size.2 | (2×) | 4
vestra.window | fit | (Fit to Video Aspect Ratio) | 8
vestra.window | auto.off | (Don't Resize)
vestra.window | auto.0.5 | (0.5×)
vestra.window | auto.1 | (1×)
vestra.window | auto.1.5 | (1.5×)
vestra.window | auto.2 | (2×)
vestra.window | auto.fit | (Fit to Video Aspect Ratio)
vestra.window | auto.once | (Only Once)
vestra.window | top.cycle | (Cycle Mode) | Ctrl+T
vestra.window | top.never | (Never)
vestra.window | top.always | (Always)
vestra.window | top.playing | (While Playing)
vestra.window | top.fullscreen | (While Playing in Fullscreen)
vestra.playlist | playlist.add | (Add Files…)
vestra.playlist | playlist.link | (Add Link…)
vestra.playlist | playlist.add-folder | (Add Folder…)
vestra.playlist | playlist.repeat-none | (Off)
vestra.playlist | playlist.repeat-all | (All)
vestra.playlist | playlist.repeat-one | (One)
vestra.playlist | playlist.repeat-once | (Stop After Current)
vestra.playlist | playlist.shuffle | (Shuffle)
vestra.playlist | playlist.open-list | (Open List File…)
vestra.playlist | playlist.save-list | (Save List…)
vestra.playlist | playlist.open-mode-only | (Open Only That File)
vestra.playlist | playlist.open-mode-similar | (Add Similar Files)
vestra.playlist | playlist.open-mode-folder | (Add All Files in the Folder)
vestra.playlist | playlist.fast-advance | (Fast Advance to Next)
vestra.playlist | playlist.remember | (Remember List)
vestra.playlist | playlist.confirm-clear | (Confirm Before Removing All)
vestra.history | resume.off | (Don't Resume)
vestra.history | resume.auto | (Resume Automatically)
vestra.history | resume.ask | (Ask Every Time)
vestra.history | resume.audio | (Also Remember Audio Files)
vestra.history | resume.clear | (Clear All Saved Positions)
vestra.marks | marks.add | (Add Bookmark) | P
vestra.marks | marks.previous | (Previous Bookmark or Chapter) | Shift+PageUp
vestra.marks | marks.next | (Next Bookmark or Chapter) | Shift+PageDown
vestra.marks | marks.previous-chapter | (Previous Chapter) | Ctrl+PageUp
vestra.marks | marks.next-chapter | (Next Chapter) | Ctrl+PageDown
vestra.marks | marks.seekbar | (Show Marks on Seek Bar)
vestra.subtitle-online | settings | (Online Subtitle Settings…)
vestra.visualizer | audio-cover | (Show Album Cover for Audio Only)
vestra.visualizer | idle-logo | (Show Logo When Idle)
vestra.visualizer | choose-logo | (Choose Logo Image…)
vestra.visualizer | reset-logo | (Idle Logo)
vestra.hotkeys | keys | (Keyboard Shortcuts…)
vestra.hotkeys | mouse | (Mouse…)
vestra.hotkeys | ignore-defaults | (Ignore Default Shortcuts)
vestra.preferences | theme.vestra | (Vestra Dark)
vestra.preferences | theme.vestra-light | (Vestra Light)
vestra.preferences | language.system | (Follow System)
vestra.preferences | language.en | (English)
vestra.preferences | language.zh-Hans | (简体中文)
vestra.preferences | language.ja | (日本語)
vestra.preferences | language.ko | (한국어)
vestra.preferences | language.de | (Deutsch)
vestra.preferences | language.fr | (Français)
vestra.preferences | language.es | (Español)
vestra.info | info.toggle | (Playback Info) | Tab
vestra.info | info.properties | (Playback Properties…) | Ctrl+F1
vestra.info | info.update | (Check for Updates…)
vestra.audio | audio.track.cycle | (Cycle Tracks) | Alt+A
vestra.audio | audio.channels.stereo | (Stereo)
vestra.audio | audio.channels.left | (Left Channel)
vestra.audio | audio.channels.right | (Right Channel)
vestra.audio | audio.channels.mono | (Mono Mix)
vestra.audio | audio.channels.swap | (Swap Left and Right)
vestra.audio | audio.equalizer | (Equalizer) | Shift+E
vestra.audio | audio.preset.0 | (Flat)
vestra.audio | audio.preset.1 | (Voice)
vestra.audio | audio.preset.2 | (Music)
vestra.audio | audio.preset.3 | (Cinema)
vestra.audio | audio.sync.earlier | (50 ms Earlier) | >
vestra.audio | audio.sync.later | (50 ms Later) | <
vestra.audio | audio.sync.reset | (Reset) | ?
vestra.audio | audio.sync.keep.none | (Don't Keep)
vestra.audio | audio.sync.keep.session | (Keep for This Run)
vestra.audio | audio.sync.keep.always | (Always Keep)
vestra.audio | audio.normalize | (Normalize) | Shift+N
vestra.audio | audio.clarity | (Crystalizer) | Shift+C
vestra.audio | audio.reset | (Reset)
vestra.capture | capture.clipExport | (Export Clip Range) | Ctrl+Shift+E
vestra.capture | capture.saveAs | (Save Current Frame As…)
vestra.capture | capture.saveScreen | (Save Rendered Frame) | Ctrl+Alt+E
vestra.capture | capture.saveScreenAs | (Save Rendered Frame As…)
vestra.capture | capture.copyScreen | (Copy Rendered Frame) | Ctrl+Alt+C
vestra.capture | capture.saveVideo | (Save Video Frame Only)
vestra.capture | capture.copyVideo | (Copy Video Frame Only)
vestra.capture | capture.tasks | (Export Tasks…)
vestra.capture | capture.format.png | (Capture as PNG)
vestra.capture | capture.format.jpeg | (Capture as JPEG)
vestra.capture | capture.format.bmp | (Capture as BMP)
vestra.capture | capture.screenSubtitles | (Include Subtitles in Rendered Frame)
vestra.capture | capture.settings | (Snapshot Settings…)
vestra.capture | capture.folder | (Snapshot Folder…)
vestra.capture | capture.openFolder | (Open Snapshot Folder)
vestra.capture | capture.revealLast | (Show Last Capture in Folder)
vestra.capture | capture.copyLast | (Copy Last Snapshot)
vestra.capture | capture.clipStart | (Set Clip Start)
vestra.capture | capture.clipEnd | (Set Clip End)
vestra.capture | capture.last30 | (Export Last 30 Seconds) | Ctrl+Shift+R
vestra.info | info.brief | (Brief Info) | Shift+Tab
vestra.playback | keyframe-back | (Previous Keyframe) | Ctrl+Shift+ArrowLeft
vestra.playback | keyframe-forward | (Next Keyframe) | Ctrl+Shift+ArrowRight
vestra.playback | jump | (Jump to Time…) | G
vestra.playback | jump-start | (Jump to Start) | Backspace
vestra.playback | time-jump | (Seek Steps…)
vestra.playback | rate-05 | (0.5×)
vestra.playback | rate-15 | (1.5×)
vestra.playback | rate-20 | (2×)
vestra.playback | rate-custom | (Custom…)
vestra.playback | backward-2 | (Back 30 s) | Ctrl+ArrowLeft
vestra.playback | forward-2 | (Forward 30 s) | Ctrl+ArrowRight
vestra.playback | backward-3 | (Back 60 s) | Shift+ArrowLeft
vestra.playback | forward-3 | (Forward 60 s) | Shift+ArrowRight
vestra.playback | backward-4 | (Back 300 s) | Ctrl+Alt+ArrowLeft
vestra.playback | forward-4 | (Forward 300 s) | Ctrl+Alt+ArrowRight
vestra.playlist | playlist.play | (Play) | Enter | panel
vestra.playlist | playlist.list-add | (Add Files…)
vestra.playlist | playlist.list-add-folder | (Add Folder…)
vestra.playlist | playlist.list-link | (Add Link…)
vestra.playlist | playlist.remove | (Remove Selected) | Delete | panel
vestra.playlist | playlist.remove-unselected | (Remove Unselected) | Ctrl+Delete | panel
vestra.playlist | playlist.remove-invalid | (Remove Invalid Items)
vestra.playlist | playlist.clear | (Remove All) | Alt+Delete | panel
vestra.playlist | playlist.reveal | (Show in Finder) | Ctrl+F | panel
vestra.playlist | playlist.move-top | (Move to Top)
vestra.playlist | playlist.move-up | (Move Up) | Ctrl+ArrowUp | panel
vestra.playlist | playlist.move-down | (Move Down) | Ctrl+ArrowDown | panel
vestra.playlist | playlist.move-bottom | (Move to Bottom) | Ctrl+End | panel
vestra.playlist | playlist.sort-ascending | (Ascending) | Ctrl+1 | panel
vestra.playlist | playlist.sort-descending | (Descending) | Ctrl+2 | panel
vestra.playlist | playlist.sort-title | (By Title) | Ctrl+3 | panel
vestra.playlist | playlist.sort-filename | (By File Name) | Ctrl+4 | panel
vestra.playlist | playlist.sort-extension | (By Extension) | Ctrl+5 | panel
vestra.playlist | playlist.sort-size | (By Size) | Ctrl+6 | panel
vestra.playlist | playlist.sort-duration | (By Duration) | Ctrl+7 | panel
vestra.playlist | playlist.sort-date | (By Date) | Ctrl+8 | panel
vestra.playlist | playlist.sort-shuffle | (Random Order) | Ctrl+9 | panel
vestra.playlist | playlist.sort-folder | (By Folder) | Ctrl+0 | panel
vestra.playlist | playlist.sort-path | (Sort by Path)
vestra.playlist | playlist.sort-reverse | (Reverse Current Order)
vestra.playlist | playlist.select-all | (Select All) | Ctrl+A | panel
vestra.playlist | playlist.search | (Search) | Ctrl+S | panel
vestra.playlist | playlist.list-open-list | (Open List File…)
vestra.playlist | playlist.list-save-list | (Save List…)
vestra.playlist | playlist.close | (Close List)
vestra.playlist | playlist.settings | (Playlist Settings…)
vestra.subtitles | show | (Show Subtitles) | Alt+H
vestra.subtitles | second-off | (Off)
vestra.subtitles | second-position-top | (Top)
vestra.subtitles | second-position-aboveMain | (Above Main Subtitle)
vestra.subtitles | track-cycle | (Cycle) | Alt+L
vestra.subtitles | size-up | (Size +) | Alt+PageUp
vestra.subtitles | size-down | (Size −) | Alt+PageDown
vestra.subtitles | move-up | (Move Up)
vestra.subtitles | move-down | (Move Down)
vestra.subtitles | move-reset | (Subtitle Position) | Alt+Home
vestra.subtitles | bold | (Bold) | Alt+B
vestra.subtitles | shadow | (Shadow)
vestra.subtitles | box | (Opaque Box)
vestra.subtitles | ass-original | (Original ASS/SSA Styles)
vestra.subtitles | dialogue-previous | (Previous Dialogue) | Home
vestra.subtitles | dialogue-next | (Next Dialogue) | End
vestra.subtitles | dialogue-current | (Current Subtitle Start) | Ctrl+Home
vestra.subtitles | sync-reset | (Subtitle Sync) | /
vestra.subtitles | sync-input | (Adjust Sync…)
vestra.subtitles | reload | (Reload Subtitles) | Ctrl+Alt+Y
vestra.subtitles | refresh | (Refresh Subtitle Tracks)
vestra.subtitles | remove | (Remove External Subtitle)
vestra.subtitles | settings | (Subtitle Settings…)
vestra.subtitles | sync-earlier | (Earlier 0.5 s) | .
vestra.subtitles | sync-later | (Later 0.5 s) | ,
vestra.video | video.shader.use | (Use Shaders) | Shift+P
vestra.video | video.shader.list | (Shader List…)
vestra.video | video.shader.folder | (Open Shader Folder)
vestra.video | video.shader.reload | (Reload Shaders)
vestra.video | video.hdr.auto | (Auto)
vestra.video | video.hdr.off | (Off)
vestra.video | video.hdr.bt.2390 | (BT.2390)
vestra.video | video.hdr.hable | (Hable)
vestra.video | video.hdr.mobius | (Mobius)
vestra.video | video.hdr.reinhard | (Reinhard)
vestra.video | video.hdr.clip | (Clip)
vestra.video | video.hdr.peak | (Dynamic Peak Detection)
vestra.video | video.hdr.settings | (HDR Settings…)
vestra.video | video.deinterlace.cycle | (Cycle) | Ctrl+I
vestra.video | video.deinterlace.auto | (Auto)
vestra.video | video.deinterlace.on | (Always)
vestra.video | video.deinterlace.off | (Never)
vestra.video | video.deinterlace.output.frame | (By Frame)
vestra.video | video.deinterlace.output.field | (By Field (Double Rate))
vestra.video | video.fit.keep | (Keep Aspect Ratio)
vestra.video | video.fit.stretch | (Ignore Aspect Ratio)
vestra.video | video.fit.fill | (Fill Window (Crop Excess))
vestra.video | video.aspect.cycle | (Cycle Aspect Ratio) | Shift+F6
vestra.video | video.aspect.default | (Default (Source))
vestra.video | video.aspect.0 | (4:3)
vestra.video | video.aspect.1 | (16:9)
vestra.video | video.aspect.2 | (16:10)
vestra.video | video.aspect.3 | (1.85:1)
vestra.video | video.aspect.4 | (2.35:1)
vestra.video | video.aspect.custom | (Custom (x:y))
vestra.video | video.aspect.edit | (Custom Aspect Ratio…)
vestra.video | video.reframe.none | (None)
vestra.video | video.reframe.pad.0 | (Stretch to 4:3)
vestra.video | video.reframe.pad.1 | (Stretch to 16:9)
vestra.video | video.reframe.pad.2 | (Stretch to 16:10)
vestra.video | video.reframe.pad.3 | (Stretch to 1.85:1)
vestra.video | video.reframe.pad.4 | (Stretch to 2.35:1)
vestra.video | video.reframe.crop.0 | (Crop to 4:3)
vestra.video | video.reframe.crop.1 | (Crop to 16:9)
vestra.video | video.reframe.crop.2 | (Crop to 16:10)
vestra.video | video.reframe.crop.3 | (Crop to 1.85:1)
vestra.video | video.reframe.crop.4 | (Crop to 2.35:1)
vestra.video | video.reframe.left | (Move Left)
vestra.video | video.reframe.right | (Move Right)
vestra.video | video.reframe.up | (Move Up)
vestra.video | video.reframe.down | (Move Down)
vestra.video | video.reframe.reset | (Crop Position)
vestra.video | video.frame.zoom-in | (Zoom In) | Alt+Plus, Numpad9
vestra.video | video.frame.zoom-out | (Zoom Out) | Alt+-, Numpad1
vestra.video | video.frame.right | (Pan →) | Alt+ArrowRight, Ctrl+Numpad6
vestra.video | video.frame.left | (Pan ←) | Alt+ArrowLeft, Ctrl+Numpad4
vestra.video | video.frame.up | (Pan ↑) | Alt+ArrowUp, Ctrl+Numpad8
vestra.video | video.frame.down | (Pan ↓) | Alt+ArrowDown, Ctrl+Numpad2
vestra.video | video.frame.centre | (Center Frame) | Ctrl+Numpad5
vestra.video | video.frame.reset | (Framing) | Alt+Backspace, Numpad5
vestra.video | video.flip.vertical | (Flip Vertically) | Ctrl+P
vestra.video | video.flip.horizontal | (Flip Horizontally) | Ctrl+Z
vestra.video | video.gaussian | (Gaussian Blur) | Ctrl+B
vestra.video | video.sharpen | (Sharpen) | Ctrl+R
vestra.video | video.edge | (Edge Sharpen)
vestra.video | video.deblock | (Deblock) | Ctrl+H
vestra.video | video.deband | (Deband)
vestra.video | video.denoise.d3 | (3D Denoise) | Ctrl+N
vestra.video | video.denoise.gradual | (Gradual Denoise)
vestra.video | video.denoise.temporal | (Temporal Denoise) | Ctrl+M
vestra.video | video.frame-blend | (Frame Doubling)
vestra.video | video.interpolation | (Motion Interpolation)
vestra.video | video.rotate.cycle | (Cycle) | Alt+K
vestra.video | video.rotate.0 | (No Rotation)
vestra.video | video.rotate.90 | (90°)
vestra.video | video.rotate.180 | (180°)
vestra.video | video.rotate.270 | (270°)
vestra.video | video.reset | (Picture) | Q
vestra.video | video.resetPanel | (Picture Panel)
vestra.video | video.brightness.down | (Brightness -1%) | W
vestra.video | video.brightness.up | (Brightness +1%) | E
vestra.video | video.contrast.down | (Contrast -1%) | R
vestra.video | video.contrast.up | (Contrast +1%) | T
vestra.video | video.saturation.down | (Saturation -1%) | Y
vestra.video | video.saturation.up | (Saturation +1%) | U
vestra.video | video.hue.down | (Hue -1%) | I
vestra.video | video.hue.up | (Hue +1%) | O
vestra.video | video.gpu-rendering | (GPU Rendering (Experimental))
vestra.video | video.upscaling | (AI Upscaling)
`;

/**
 * The commands the player and its built-in plugins register when the
 * player starts with nothing open, in menu order (commands outside the main
 * menu last): their key paths, default bindings and owners. Use it to pick
 * a menu place and default keys that do not collide with the player's (the
 * user's own changes come on top; see {@link @vestra-player/sdk!Bindings | Bindings}). Menu items built
 * from content (tracks, recent files, output devices) are not listed; their
 * placeholders (`No Audio Tracks`) are. Items that appear only in a
 * passing state are not listed either: the Picture Adjustments plugin's
 * `Video ▸ Restart Player to Apply` (`video.gpu-rendering.restart`), shown
 * while a rendering choice waits for the next start. The player's tests check that this
 * list agrees with what the player and its built-in plugins register.
 *
 * @example Check in a test that a default key is still free
 * The test fails if the player or a built-in plugin already binds Ctrl+K
 * globally, before users ever see a conflict. It collects the default
 * bindings of every built-in command that is not limited to its panel's
 * focus (`focus: null`) and looks for the key the plugin wants; bindings
 * are canonical, so compare them as the player writes them.
 * ```ts
 * import assert from "node:assert/strict";
 * import { BUILTIN_COMMANDS } from "@vestra-player/sdk/testing";
 *
 * const taken = BUILTIN_COMMANDS.filter((command) => command.focus === null)
 *   .flatMap((command) => command.bindings);
 * assert.ok(!taken.includes("Ctrl+K"));
 * ```
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export const BUILTIN_COMMANDS: readonly BuiltinCommand[] = Object.freeze(
  BUILTIN_COMMAND_TABLE.trim()
    .split("\n")
    .map((line): BuiltinCommand => {
      const [owner = "", id = "", menu = "", keys = "", focus = ""] =
        line.split(" | ");
      const path = menu.startsWith("(") ? [] : menu.split(" ▸ ");
      return Object.freeze({
        owner,
        id,
        path: Object.freeze(path),
        title: path.at(-1) ?? menu.slice(1, -1),
        bindings: Object.freeze(keys ? keys.split(", ") : []),
        focus: focus === "panel" ? "panel" : null,
      });
    }),
);

export type CommandState = {
  enabled: boolean;
  checked: boolean | null;
  busy: boolean;
  /** Source text, or a text value. */
  reason: string | TextJson | ListJson | null;
};
/**
 * A command's conditions: `enabled` and `checked` evaluated by the player
 * (`plugin.when`).
 */
export type CommandWhen = {
  enabled?: ConditionJson;
  checked?: ConditionJson;
};
export type CommandDeclaration = {
  /** Source text, or a text value. */
  title: string | TextJson;
  /** Complete primary menu path INCLUDING its leaf; empty = not in the main menu. Segments may be text values. */
  path: (string | TextJson)[];
  /** Sibling order, ascending; a submenu takes its first command's order (a built-in menu keeps a fixed one). */
  order: number;
  /** Separator label: adjacent siblings of different groups get a line. */
  group: string;
  /** Draw `checked` as a radio dot. */
  radio: boolean;
  /** Default input bindings, canonical strings (see sdk/plugin/bindings.ts). */
  bindings: string[];
  /** "panel": bindings apply only while this plugin's panel has focus. */
  focus: "panel" | null;
  /** Fire again on keyboard auto-repeat while held. */
  repeat: boolean;
  /**
   * A bottom-bar button: an icon name, or an image in the `plugin.ui.image`
   * wire form.
   */
  button?: { icon: string | Json; order: number };
  /**
   * The command's category, source text or a text value.
   */
  category?: string | TextJson;
  /**
   * The local id of the command that opens where this one lives. Sent only when
   * set, like `category`.
   */
  home?: string;
};
/**
 * `commands.keys`: each of the plugin's own commands, by local id, and each of
 * the player's own as `host/<id>`, with the labels of its current keys; the
 * answer to the request and the data of the event of that name.
 *
 * @remarks
 * The player's wire shape (`commands.keys`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export type CommandKeys = {
  /** The key labels of each command, by local id (the player's own: `host/<id>`). */
  keys: Record<string, string[]>;
  /** The player's binding table revision: a larger one is newer. */
  revision: number;
};
export function commandClient(transport: Transport) {
  return {
    register: (
      id: string,
      revision: number,
      declaration: CommandDeclaration,
      state: CommandState,
      when?: CommandWhen,
    ) =>
      transport.request<{ revision: number }>("commands.register", {
        id,
        revision,
        declaration,
        state,
        ...(when ? { when: when as Json } : {}),
      }),
    /** Remove the command from the menu and the binding table; the id is free again. */
    unregister: (id: string) =>
      transport.request<void>("commands.unregister", { id }),
    /**
     * The key labels of the plugin's own commands, as menus show them; later
     * changes come as the `commands.keys` event, in the same shape. `revision`
     * orders answers and events.
     */
    keys: () => transport.request<CommandKeys>("commands.keys", {}),
    update: (
      id: string,
      revision: number,
      state: CommandState,
      when?: CommandWhen,
    ) =>
      transport.request<{ revision: number }>("commands.update", {
        id,
        revision,
        state,
        ...(when ? { when: when as Json } : {}),
      }),
  };
}
