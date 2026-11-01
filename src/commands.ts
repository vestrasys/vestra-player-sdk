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
 * segment of a command path (`["@video", "Blur"]`, see `CommandOptions.path`) to put a
 * command into that menu whatever language the player's menus are in. The
 * player stores the menu's title (视频 today); later segments are titles.
 * Needs player 0.3.0 (`"minPlayerVersion": "0.3.0"`); older players show
 * `@video` as a menu of its own. `reset` (SDK 1.5.51) needs player 0.6.3:
 * the Reset menu, directly below Settings, gathers every command that puts
 * something back to its default; older players refuse `@reset` with
 * `invalid`. The player's tests check that this list agrees with the
 * player's.
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
 * The icons a bottom-bar button may name (`CommandOptions.button.icon`):
 * every icon of the player's V-Line set, `@vestra/icons.slint` (draw one
 * in your own Slint with `Icon { name: "store"; }`). The player's tests check
 * that this list is its icon set.
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
] as const;

/**
 * The player's limits on bottom-bar buttons (`CommandOptions.button`), the
 * same values as the player's (its tests check that they agree). A button
 * past `perPlugin` or `total` is left out: its command still registers and
 * its menu entry stays, and the player logs the button it left out
 * (`limit`). Which ones stay: each plugin's first declared button, then the
 * `total` highest by order, plugin id and declaration order: as in a narrow
 * strip, the lowest order goes first (equal orders: the smaller plugin id,
 * then the earlier declaration, goes first).
 *
 * @since 1.5.29
 *
 * @category Testing
 */
export const BAR_BUTTON_LIMITS = {
  /** Buttons one plugin shows (1). */
  perPlugin: 1,
  /** Buttons the player shows, every plugin together, besides its own sidebar toggle (8). */
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
 * "Copy Snapshot" appears in Video ▸ Snapshot next to the built-in capture
 * plugin's items. Paths merge by their English keys, so a command whose
 * path continues with the submenu's keys (`["Video", "Snapshot"]`, the menu
 * written as `@video`) lands in the same submenu whatever the interface
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
 *   // ["@video", "Snapshot", "Copy Snapshot"]; @video stands for "Video".
 *   path: ["@video", ...snapshot.path.slice(1), "Copy Snapshot"],
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
  { path: ["Playback", "A-B Loop"], plugins: ["vestra.marks"] },
  { path: ["Playback", "A-B Loop", "Loop Count"], plugins: ["vestra.marks"] },
  { path: ["Playback", "Chapters and Bookmarks"], plugins: ["vestra.marks"] },
  { path: ["Playback", "Playlist"], plugins: ["vestra.playlist"] },
  { path: ["Playback", "Playlist", "Repeat"], plugins: ["vestra.playlist"] },
  {
    path: ["Playback", "Playlist", "When Opening a File"],
    plugins: ["vestra.playlist"],
  },
  { path: ["Playback", "Resume Playback"], plugins: ["vestra.history"] },
  {
    path: ["Subtitles", "Online Subtitles"],
    plugins: ["vestra.subtitle-online"],
  },
  { path: ["Subtitles", "Secondary Subtitle"], plugins: ["vestra.subtitles"] },
  {
    path: ["Subtitles", "Secondary Subtitle", "Position"],
    plugins: ["vestra.subtitles"],
  },
  { path: ["Subtitles", "Subtitle Style"], plugins: ["vestra.subtitles"] },
  { path: ["Subtitles", "Subtitle Track"], plugins: ["vestra.subtitles"] },
  { path: ["Subtitles", "Sync"], plugins: ["vestra.subtitles"] },
  { path: ["Video", "Aspect"], plugins: ["vestra.video"] },
  { path: ["Video", "Crop/Stretch"], plugins: ["vestra.video"] },
  { path: ["Video", "Deinterlace"], plugins: ["vestra.video"] },
  { path: ["Video", "Deinterlace", "Output"], plugins: ["vestra.video"] },
  { path: ["Video", "Framing"], plugins: ["vestra.video"] },
  { path: ["Video", "Image Processing"], plugins: ["vestra.video"] },
  { path: ["Video", "Pixel Shaders"], plugins: ["vestra.video"] },
  {
    path: ["Video", "Pixel Shaders", "HDR Tone Mapping"],
    plugins: ["vestra.video"],
  },
  { path: ["Video", "Rotation"], plugins: ["vestra.video"] },
  { path: ["Video", "Snapshot"], plugins: ["vestra.capture"] },
  { path: ["Audio", "Audio Sync"], plugins: ["vestra.audio"] },
  { path: ["Audio", "Audio Track"], plugins: ["vestra.audio"] },
  { path: ["Audio", "Output Device"], plugins: ["vestra.audio"] },
  { path: ["Audio", "Preset"], plugins: ["vestra.audio"] },
  { path: ["Audio", "Processing"], plugins: ["vestra.audio"] },
  { path: ["Screen", "Always on Top"], plugins: ["vestra.window"] },
  { path: ["Screen", "When Playback Starts"], plugins: ["vestra.window"] },
  {
    path: ["Settings", "Appearance"],
    plugins: ["vestra.preferences", "vestra.visualizer"],
  },
  { path: ["Settings", "Language"], plugins: ["vestra.preferences"] },
  { path: ["Copy to Clipboard"], plugins: ["vestra.playback"] },
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
vestra.audio | audio.load | Open ▸ Load External Audio…
vestra.history | recent.empty | Open ▸ Recently Played ▸ (No Entries)
vestra.history | recent.prune | Open ▸ Recently Played ▸ Remove Invalid Entries
vestra.history | recent.clear | Open ▸ Recently Played ▸ Clear Entries
vestra.history | recent.enabled | Open ▸ Recently Played ▸ Record Playback History
vestra.subtitles | load-secondary | Open ▸ Add Secondary Subtitle…
host | stop | Close | F4
vestra.playback | reopen | Reopen Current/Last File | Ctrl+Y
vestra.playback | copy-name | Copy to Clipboard ▸ File Name
vestra.playback | copy-folder | Copy to Clipboard ▸ Folder Path
vestra.playback | copy-path | Copy to Clipboard ▸ Full Path
host | play-pause | Playback ▸ Play/Pause | Space, Mouse:LeftClick
host | previous | Playback ▸ Previous | PageUp, Mouse:X2
host | next | Playback ▸ Next | PageDown, Mouse:X1
host | frame-back | Playback ▸ Seek ▸ Previous Frame | D
host | frame-forward | Playback ▸ Seek ▸ Next Frame | F
vestra.playback | keyframe-back | Playback ▸ Seek ▸ Previous Keyframe | Ctrl+Shift+ArrowLeft
vestra.playback | keyframe-forward | Playback ▸ Seek ▸ Next Keyframe | Ctrl+Shift+ArrowRight
host | seek-backward | Playback ▸ Seek ▸ Back 5 s | ArrowLeft
host | seek-forward | Playback ▸ Seek ▸ Forward 5 s | ArrowRight
vestra.playback | backward-2 | Playback ▸ Seek ▸ Back 30 s | Ctrl+ArrowLeft
vestra.playback | forward-2 | Playback ▸ Seek ▸ Forward 30 s | Ctrl+ArrowRight
vestra.playback | backward-3 | Playback ▸ Seek ▸ Back 60 s | Shift+ArrowLeft
vestra.playback | forward-3 | Playback ▸ Seek ▸ Forward 60 s | Shift+ArrowRight
vestra.playback | backward-4 | Playback ▸ Seek ▸ Back 300 s | Ctrl+Alt+ArrowLeft
vestra.playback | forward-4 | Playback ▸ Seek ▸ Forward 300 s | Ctrl+Alt+ArrowRight
vestra.subtitles | dialogue-previous | Playback ▸ Seek ▸ Previous Dialogue | Home
vestra.subtitles | dialogue-next | Playback ▸ Seek ▸ Next Dialogue | End
vestra.subtitles | dialogue-current | Playback ▸ Seek ▸ Current Subtitle Start | Ctrl+Home
vestra.playback | jump-start | Playback ▸ Seek ▸ Jump to Start | Backspace
vestra.playback | time-jump | Playback ▸ Seek ▸ Seek Steps…
vestra.playback | jump | Playback ▸ Jump to Time… | G
host | rate-normal | Playback ▸ Speed ▸ Normal | Z
host | rate-down | Playback ▸ Speed ▸ Slower 0.1 | X
host | rate-up | Playback ▸ Speed ▸ Faster 0.1 | C
vestra.playback | rate-05 | Playback ▸ Speed ▸ 0.5×
vestra.playback | rate-15 | Playback ▸ Speed ▸ 1.5×
vestra.playback | rate-20 | Playback ▸ Speed ▸ 2×
vestra.playback | rate-custom | Playback ▸ Speed ▸ Custom…
vestra.playlist | playlist.add | Playback ▸ Playlist ▸ Add Files…
vestra.playlist | playlist.link | Playback ▸ Playlist ▸ Add Link…
vestra.playlist | playlist.add-folder | Playback ▸ Playlist ▸ Add Folder…
vestra.playlist | playlist.repeat-none | Playback ▸ Playlist ▸ Repeat ▸ Off
vestra.playlist | playlist.repeat-all | Playback ▸ Playlist ▸ Repeat ▸ All
vestra.playlist | playlist.repeat-one | Playback ▸ Playlist ▸ Repeat ▸ One
vestra.playlist | playlist.shuffle | Playback ▸ Playlist ▸ Shuffle
vestra.playlist | playlist.open-list | Playback ▸ Playlist ▸ Open List File…
vestra.playlist | playlist.save-list | Playback ▸ Playlist ▸ Save List…
vestra.playlist | playlist.open-mode-only | Playback ▸ Playlist ▸ When Opening a File ▸ Open Only That File
vestra.playlist | playlist.open-mode-similar | Playback ▸ Playlist ▸ When Opening a File ▸ Add Similar Files
vestra.playlist | playlist.open-mode-folder | Playback ▸ Playlist ▸ When Opening a File ▸ Add All Files in the Folder
vestra.playlist | playlist.fast-advance | Playback ▸ Playlist ▸ Fast Advance to Next
vestra.playlist | playlist.remember | Playback ▸ Playlist ▸ Remember List
vestra.playlist | playlist.confirm-clear | Playback ▸ Playlist ▸ Confirm Before Removing All
vestra.playback | prevent-sleep | Playback ▸ Disable Screen Saver While Playing
vestra.window | hide-cursor | Playback ▸ Hide Pointer While Playing
vestra.playback | hover-time | Playback ▸ Show Time on Seek Bar Hover
vestra.playback | hover-thumbnail | Playback ▸ Show Thumbnail on Seek Bar Hover
vestra.history | resume.off | Playback ▸ Resume Playback ▸ Don't Resume
vestra.history | resume.auto | Playback ▸ Resume Playback ▸ Resume Automatically
vestra.history | resume.ask | Playback ▸ Resume Playback ▸ Ask Every Time
vestra.history | resume.audio | Playback ▸ Resume Playback ▸ Also Remember Audio Files
vestra.history | resume.clear | Playback ▸ Resume Playback ▸ Clear All Saved Positions
vestra.marks | marks.list | Playback ▸ Chapters and Bookmarks ▸ Chapter and Bookmark List… | H
vestra.marks | marks.add | Playback ▸ Chapters and Bookmarks ▸ Add Bookmark | P
vestra.marks | marks.previous | Playback ▸ Chapters and Bookmarks ▸ Previous Bookmark or Chapter | Shift+PageUp
vestra.marks | marks.next | Playback ▸ Chapters and Bookmarks ▸ Next Bookmark or Chapter | Shift+PageDown
vestra.marks | marks.previous-chapter | Playback ▸ Chapters and Bookmarks ▸ Previous Chapter | Ctrl+PageUp
vestra.marks | marks.next-chapter | Playback ▸ Chapters and Bookmarks ▸ Next Chapter | Ctrl+PageDown
vestra.marks | marks.seekbar | Playback ▸ Chapters and Bookmarks ▸ Show Marks on Seek Bar
vestra.marks | ab.set-a | Playback ▸ A-B Loop ▸ Set Start Point | [
vestra.marks | ab.clear-a | Playback ▸ A-B Loop ▸ Clear Start Point | {
vestra.marks | ab.a-back | Playback ▸ A-B Loop ▸ Start Point Back 0.1 s | Ctrl+[
vestra.marks | ab.a-forward | Playback ▸ A-B Loop ▸ Start Point Forward 0.1 s | Alt+[
vestra.marks | ab.set-b | Playback ▸ A-B Loop ▸ Set End Point | ]
vestra.marks | ab.clear-b | Playback ▸ A-B Loop ▸ Clear End Point | }
vestra.marks | ab.b-back | Playback ▸ A-B Loop ▸ End Point Back 0.1 s | Ctrl+]
vestra.marks | ab.b-forward | Playback ▸ A-B Loop ▸ End Point Forward 0.1 s | Alt+]
vestra.marks | ab.back | Playback ▸ A-B Loop ▸ Move Range Back 0.1 s | Ctrl+Alt+[
vestra.marks | ab.forward | Playback ▸ A-B Loop ▸ Move Range Forward 0.1 s | Ctrl+Alt+]
vestra.marks | ab.segment | Playback ▸ A-B Loop ▸ Loop Current Chapter or Bookmark Range | Alt+\\
vestra.marks | ab.toggle | Playback ▸ A-B Loop ▸ A-B Loop On/Off | \\
vestra.marks | ab.count.endless | Playback ▸ A-B Loop ▸ Loop Count ▸ Endless
vestra.marks | ab.count.1 | Playback ▸ A-B Loop ▸ Loop Count ▸ Once
vestra.marks | ab.count.2 | Playback ▸ A-B Loop ▸ Loop Count ▸ 2 Times
vestra.marks | ab.count.3 | Playback ▸ A-B Loop ▸ Loop Count ▸ 3 Times
vestra.marks | ab.count.5 | Playback ▸ A-B Loop ▸ Loop Count ▸ 5 Times
vestra.marks | ab.count.10 | Playback ▸ A-B Loop ▸ Loop Count ▸ 10 Times
vestra.subtitles | show | Subtitles ▸ Show Subtitles | Alt+H
vestra.subtitles | track-off | Subtitles ▸ Subtitle Track ▸ Off
vestra.subtitles | track-cycle | Subtitles ▸ Subtitle Track ▸ Cycle | Alt+L
vestra.subtitles | second-off | Subtitles ▸ Secondary Subtitle ▸ Off
vestra.subtitles | second-position-top | Subtitles ▸ Secondary Subtitle ▸ Position ▸ Top
vestra.subtitles | second-position-aboveMain | Subtitles ▸ Secondary Subtitle ▸ Position ▸ Above Main Subtitle
vestra.subtitles | bold | Subtitles ▸ Subtitle Style ▸ Bold | Alt+B
vestra.subtitles | size-up | Subtitles ▸ Subtitle Style ▸ Size + | Alt+PageUp
vestra.subtitles | size-down | Subtitles ▸ Subtitle Style ▸ Size − | Alt+PageDown
vestra.subtitles | move-up | Subtitles ▸ Subtitle Style ▸ Move Up
vestra.subtitles | move-down | Subtitles ▸ Subtitle Style ▸ Move Down
vestra.subtitles | move-reset | Subtitles ▸ Subtitle Style ▸ Reset Position | Alt+Home
vestra.subtitles | shadow | Subtitles ▸ Subtitle Style ▸ Shadow
vestra.subtitles | box | Subtitles ▸ Subtitle Style ▸ Opaque Box
vestra.subtitles | ass-original | Subtitles ▸ Original ASS/SSA Styles
vestra.subtitles | sync-earlier | Subtitles ▸ Sync ▸ Earlier 0.5 s | .
vestra.subtitles | sync-later | Subtitles ▸ Sync ▸ Later 0.5 s | ,
vestra.subtitles | sync-reset | Subtitles ▸ Sync ▸ Reset | /
vestra.subtitles | sync-input | Subtitles ▸ Sync ▸ Adjust Sync…
vestra.subtitle-online | search | Subtitles ▸ Online Subtitles ▸ Search and Download Subtitles…
vestra.subtitle-online | settings | Subtitles ▸ Online Subtitles ▸ Online Subtitle Settings…
vestra.subtitles | reload | Subtitles ▸ Reload Subtitles | Ctrl+Alt+Y
vestra.subtitles | refresh | Subtitles ▸ Refresh Subtitle Tracks
vestra.subtitles | tune | Subtitles ▸ Subtitle Tuning…
vestra.subtitles | settings | Subtitles ▸ Subtitle Settings…
vestra.video | video.shader.use | Video ▸ Pixel Shaders ▸ Use Shaders | Shift+P
vestra.video | video.shader.list | Video ▸ Pixel Shaders ▸ Shader List…
vestra.video | video.shader.folder | Video ▸ Pixel Shaders ▸ Open Shader Folder
vestra.video | video.shader.reload | Video ▸ Pixel Shaders ▸ Reload Shaders
vestra.video | video.hdr.auto | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ Auto
vestra.video | video.hdr.off | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ Off
vestra.video | video.hdr.bt.2390 | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ BT.2390
vestra.video | video.hdr.hable | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ Hable
vestra.video | video.hdr.mobius | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ Mobius
vestra.video | video.hdr.reinhard | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ Reinhard
vestra.video | video.hdr.clip | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ Clip
vestra.video | video.hdr.peak | Video ▸ Pixel Shaders ▸ HDR Tone Mapping ▸ Dynamic Peak Detection
vestra.video | video.hdr.settings | Video ▸ Pixel Shaders ▸ HDR Settings…
vestra.video | video.deinterlace.cycle | Video ▸ Deinterlace ▸ Cycle | Ctrl+I
vestra.video | video.deinterlace.auto | Video ▸ Deinterlace ▸ Auto
vestra.video | video.deinterlace.on | Video ▸ Deinterlace ▸ Always
vestra.video | video.deinterlace.off | Video ▸ Deinterlace ▸ Never
vestra.video | video.deinterlace.output.frame | Video ▸ Deinterlace ▸ Output ▸ By Frame
vestra.video | video.deinterlace.output.field | Video ▸ Deinterlace ▸ Output ▸ By Field (Double Rate)
vestra.video | video.fit.keep | Video ▸ Aspect ▸ Keep Aspect Ratio
vestra.video | video.fit.stretch | Video ▸ Aspect ▸ Ignore Aspect Ratio
vestra.video | video.fit.fill | Video ▸ Aspect ▸ Fill Window (Crop Excess)
vestra.video | video.aspect.cycle | Video ▸ Aspect ▸ Cycle Aspect Ratio | Shift+F6
vestra.video | video.aspect.default | Video ▸ Aspect ▸ Default (Source)
vestra.video | video.aspect.0 | Video ▸ Aspect ▸ 4:3
vestra.video | video.aspect.1 | Video ▸ Aspect ▸ 16:9
vestra.video | video.aspect.2 | Video ▸ Aspect ▸ 16:10
vestra.video | video.aspect.3 | Video ▸ Aspect ▸ 1.85:1
vestra.video | video.aspect.4 | Video ▸ Aspect ▸ 2.35:1
vestra.video | video.aspect.custom | Video ▸ Aspect ▸ Custom (x:y)
vestra.video | video.aspect.edit | Video ▸ Aspect ▸ Custom Aspect Ratio…
vestra.video | video.reframe.none | Video ▸ Crop/Stretch ▸ None
vestra.video | video.reframe.pad.0 | Video ▸ Crop/Stretch ▸ Stretch to 4:3
vestra.video | video.reframe.pad.1 | Video ▸ Crop/Stretch ▸ Stretch to 16:9
vestra.video | video.reframe.pad.2 | Video ▸ Crop/Stretch ▸ Stretch to 16:10
vestra.video | video.reframe.pad.3 | Video ▸ Crop/Stretch ▸ Stretch to 1.85:1
vestra.video | video.reframe.pad.4 | Video ▸ Crop/Stretch ▸ Stretch to 2.35:1
vestra.video | video.reframe.crop.0 | Video ▸ Crop/Stretch ▸ Crop to 4:3
vestra.video | video.reframe.crop.1 | Video ▸ Crop/Stretch ▸ Crop to 16:9
vestra.video | video.reframe.crop.2 | Video ▸ Crop/Stretch ▸ Crop to 16:10
vestra.video | video.reframe.crop.3 | Video ▸ Crop/Stretch ▸ Crop to 1.85:1
vestra.video | video.reframe.crop.4 | Video ▸ Crop/Stretch ▸ Crop to 2.35:1
vestra.video | video.reframe.reset | Video ▸ Crop/Stretch ▸ Reset Position
vestra.video | video.reframe.left | Video ▸ Crop/Stretch ▸ Move Left
vestra.video | video.reframe.right | Video ▸ Crop/Stretch ▸ Move Right
vestra.video | video.reframe.up | Video ▸ Crop/Stretch ▸ Move Up
vestra.video | video.reframe.down | Video ▸ Crop/Stretch ▸ Move Down
vestra.video | video.frame.reset | Video ▸ Framing ▸ Reset Framing | Numpad5, Alt+Backspace
vestra.video | video.frame.zoom-in | Video ▸ Framing ▸ Zoom In | Numpad9, Alt+Plus
vestra.video | video.frame.zoom-out | Video ▸ Framing ▸ Zoom Out | Numpad1, Alt+-
vestra.video | video.frame.right | Video ▸ Framing ▸ Pan → | Ctrl+Numpad6, Alt+ArrowRight
vestra.video | video.frame.left | Video ▸ Framing ▸ Pan ← | Ctrl+Numpad4, Alt+ArrowLeft
vestra.video | video.frame.up | Video ▸ Framing ▸ Pan ↑ | Ctrl+Numpad8, Alt+ArrowUp
vestra.video | video.frame.down | Video ▸ Framing ▸ Pan ↓ | Ctrl+Numpad2, Alt+ArrowDown
vestra.video | video.frame.centre | Video ▸ Framing ▸ Center Frame | Ctrl+Numpad5
vestra.video | video.flip.vertical | Video ▸ Image Processing ▸ Flip Vertically | Ctrl+P
vestra.video | video.flip.horizontal | Video ▸ Image Processing ▸ Flip Horizontally | Ctrl+Z
vestra.video | video.gaussian | Video ▸ Image Processing ▸ Gaussian Blur | Ctrl+B
vestra.video | video.sharpen | Video ▸ Image Processing ▸ Sharpen | Ctrl+R
vestra.video | video.edge | Video ▸ Image Processing ▸ Edge Sharpen
vestra.video | video.deblock | Video ▸ Image Processing ▸ Deblock | Ctrl+H
vestra.video | video.deband | Video ▸ Image Processing ▸ Deband
vestra.video | video.denoise.d3 | Video ▸ Image Processing ▸ 3D Denoise | Ctrl+N
vestra.video | video.denoise.gradual | Video ▸ Image Processing ▸ Gradual Denoise
vestra.video | video.denoise.temporal | Video ▸ Image Processing ▸ Temporal Denoise | Ctrl+M
vestra.video | video.frame-blend | Video ▸ Image Processing ▸ Frame Doubling
vestra.video | video.interpolation | Video ▸ Image Processing ▸ Motion Interpolation
vestra.video | video.rotate.cycle | Video ▸ Rotation ▸ Cycle | Alt+K
vestra.video | video.rotate.0 | Video ▸ Rotation ▸ No Rotation
vestra.video | video.rotate.90 | Video ▸ Rotation ▸ 90°
vestra.video | video.rotate.180 | Video ▸ Rotation ▸ 180°
vestra.video | video.rotate.270 | Video ▸ Rotation ▸ 270°
vestra.capture | capture.save | Video ▸ Snapshot ▸ Save Current Frame | Ctrl+E
vestra.capture | capture.saveAs | Video ▸ Snapshot ▸ Save Current Frame As…
vestra.capture | capture.copy | Video ▸ Snapshot ▸ Copy Current Frame | Ctrl+C
vestra.capture | capture.saveScreen | Video ▸ Snapshot ▸ Save Rendered Frame | Ctrl+Alt+E
vestra.capture | capture.saveScreenAs | Video ▸ Snapshot ▸ Save Rendered Frame As…
vestra.capture | capture.copyScreen | Video ▸ Snapshot ▸ Copy Rendered Frame | Ctrl+Alt+C
vestra.capture | capture.burst | Video ▸ Snapshot ▸ Burst… | Ctrl+G
vestra.capture | capture.clip | Video ▸ Snapshot ▸ Export Clip…
vestra.capture | capture.tasks | Video ▸ Snapshot ▸ Export Tasks…
vestra.capture | capture.format.png | Video ▸ Snapshot ▸ Capture as PNG
vestra.capture | capture.format.jpeg | Video ▸ Snapshot ▸ Capture as JPEG
vestra.capture | capture.format.bmp | Video ▸ Snapshot ▸ Capture as BMP
vestra.capture | capture.screenSubtitles | Video ▸ Snapshot ▸ Include Subtitles in Rendered Frame
vestra.capture | capture.settings | Video ▸ Snapshot ▸ Snapshot Settings…
vestra.capture | capture.folder | Video ▸ Snapshot ▸ Snapshot Folder…
vestra.capture | capture.openFolder | Video ▸ Snapshot ▸ Open Snapshot Folder
vestra.video | video.picture | Video ▸ Picture Adjustments…
vestra.video | video.reset | Video ▸ Reset | Q
vestra.video | video.brightness.down | Video ▸ Brightness -1% | W
vestra.video | video.brightness.up | Video ▸ Brightness +1% | E
vestra.video | video.contrast.down | Video ▸ Contrast -1% | R
vestra.video | video.contrast.up | Video ▸ Contrast +1% | T
vestra.video | video.saturation.down | Video ▸ Saturation -1% | Y
vestra.video | video.saturation.up | Video ▸ Saturation +1% | U
vestra.video | video.hue.down | Video ▸ Hue -1% | I
vestra.video | video.hue.up | Video ▸ Hue +1% | O
vestra.video | video.gpu-rendering | Video ▸ GPU Rendering (Experimental)
host | volume-up | Audio ▸ Volume + | ArrowUp, Mouse:WheelUp
host | volume-down | Audio ▸ Volume − | ArrowDown, Mouse:WheelDown
host | mute | Audio ▸ Mute | M
vestra.audio | audio.workbench | Audio ▸ Audio Workbench…
vestra.audio | audio.track.none | Audio ▸ Audio Track ▸ No Audio Tracks
vestra.audio | audio.track.cycle | Audio ▸ Audio Track ▸ Cycle Tracks | Alt+A
vestra.audio | audio.channels.stereo | Audio ▸ Audio Track ▸ Stereo
vestra.audio | audio.channels.left | Audio ▸ Audio Track ▸ Left Channel
vestra.audio | audio.channels.right | Audio ▸ Audio Track ▸ Right Channel
vestra.audio | audio.channels.mono | Audio ▸ Audio Track ▸ Mono Mix
vestra.audio | audio.channels.swap | Audio ▸ Audio Track ▸ Swap Left and Right
vestra.audio | audio.device.none | Audio ▸ Output Device ▸ No Output Devices
vestra.audio | audio.equalizer | Audio ▸ Equalizer | Shift+E
vestra.audio | audio.preset.0 | Audio ▸ Preset ▸ Flat
vestra.audio | audio.preset.1 | Audio ▸ Preset ▸ Voice
vestra.audio | audio.preset.2 | Audio ▸ Preset ▸ Music
vestra.audio | audio.preset.3 | Audio ▸ Preset ▸ Cinema
vestra.audio | audio.sync.earlier | Audio ▸ Audio Sync ▸ 50 ms Earlier | >
vestra.audio | audio.sync.later | Audio ▸ Audio Sync ▸ 50 ms Later | <
vestra.audio | audio.sync.reset | Audio ▸ Audio Sync ▸ Reset | ?
vestra.audio | audio.sync.keep.none | Audio ▸ Audio Sync ▸ Don't Keep
vestra.audio | audio.sync.keep.session | Audio ▸ Audio Sync ▸ Keep for This Run
vestra.audio | audio.sync.keep.always | Audio ▸ Audio Sync ▸ Always Keep
vestra.audio | audio.normalize | Audio ▸ Processing ▸ Normalize | Shift+N
vestra.audio | audio.clarity | Audio ▸ Processing ▸ Crystalizer | Shift+C
vestra.audio | audio.reset | Audio ▸ Reset
vestra.visualizer | audio-cover | Audio ▸ Show Album Cover for Audio Only
host | fullscreen | Toggle Fullscreen | Escape
vestra.window | pip | Screen ▸ Picture-in-Picture
vestra.window | mini | Screen ▸ Mini Size | \`
vestra.window | size.0.5 | Screen ▸ 0.5× | 1
vestra.window | size.1 | Screen ▸ 1× | 2
vestra.window | size.1.5 | Screen ▸ 1.5× | 3
vestra.window | size.2 | Screen ▸ 2× | 4
vestra.window | fit | Screen ▸ Fit to Video Aspect Ratio | 8
vestra.window | auto.off | Screen ▸ When Playback Starts ▸ Don't Resize
vestra.window | auto.0.5 | Screen ▸ When Playback Starts ▸ 0.5×
vestra.window | auto.1 | Screen ▸ When Playback Starts ▸ 1×
vestra.window | auto.1.5 | Screen ▸ When Playback Starts ▸ 1.5×
vestra.window | auto.2 | Screen ▸ When Playback Starts ▸ 2×
vestra.window | auto.fit | Screen ▸ When Playback Starts ▸ Fit to Video Aspect Ratio
vestra.window | auto.once | Screen ▸ When Playback Starts ▸ Only Once
vestra.window | top.cycle | Screen ▸ Always on Top ▸ Cycle Mode | Ctrl+T
vestra.window | top.never | Screen ▸ Always on Top ▸ Never
vestra.window | top.always | Screen ▸ Always on Top ▸ Always
vestra.window | top.playing | Screen ▸ Always on Top ▸ While Playing
vestra.window | top.fullscreen | Screen ▸ Always on Top ▸ While Playing in Fullscreen
vestra.playlist | playlist.visibility | Playlist | F6
vestra.info | info.toggle | Playback Info | Tab
vestra.info | info.properties | Playback Properties… | Ctrl+F1
vestra.workshop | workshop.open | Vestra Player AI…
vestra.store | open | Plugin Store…
vestra.preferences | options | Settings ▸ Options… | F5
vestra.hotkeys | keys | Settings ▸ Keyboard Shortcuts…
vestra.hotkeys | mouse | Settings ▸ Mouse…
vestra.hotkeys | ignore-defaults | Settings ▸ Ignore Default Shortcuts
vestra.preferences | theme.vestra | Settings ▸ Appearance ▸ Vestra Dark
vestra.preferences | theme.vestra-light | Settings ▸ Appearance ▸ Vestra Light
vestra.visualizer | idle-logo | Settings ▸ Appearance ▸ Show Logo When Idle
vestra.visualizer | choose-logo | Settings ▸ Appearance ▸ Choose Logo Image…
vestra.visualizer | reset-logo | Settings ▸ Appearance ▸ Restore Default Logo
vestra.preferences | language.system | Settings ▸ Language ▸ Follow System
vestra.preferences | language.en | Settings ▸ Language ▸ English
vestra.preferences | language.zh-Hans | Settings ▸ Language ▸ 简体中文
vestra.preferences | language.ja | Settings ▸ Language ▸ 日本語
vestra.preferences | language.ko | Settings ▸ Language ▸ 한국어
vestra.preferences | language.de | Settings ▸ Language ▸ Deutsch
vestra.preferences | language.fr | Settings ▸ Language ▸ Français
vestra.preferences | language.es | Settings ▸ Language ▸ Español
vestra.info | info.about | About Vestra Player… | F1
host | quit | Quit | Cmd+Q
host | enter-fullscreen | (Enter Fullscreen)
host | exit-fullscreen | (Leave Fullscreen)
host | sidebar | (Toggle Sidebar)
vestra.info | info.brief | (Brief Info) | Shift+Tab
vestra.playlist | playlist.play | (Play) | Enter, P | panel
vestra.playlist | playlist.list-add | (Add Files…) | Ctrl+I | panel
vestra.playlist | playlist.list-add-folder | (Add Folder…) | Ctrl+O | panel
vestra.playlist | playlist.list-link | (Add Link…) | Ctrl+U | panel
vestra.playlist | playlist.remove | (Remove Selected) | Delete, Backspace | panel
vestra.playlist | playlist.remove-unselected | (Remove Unselected) | Ctrl+Delete | panel
vestra.playlist | playlist.remove-invalid | (Remove Invalid Items) | Ctrl+T | panel
vestra.playlist | playlist.clear | (Remove All) | Alt+Delete | panel
vestra.playlist | playlist.reveal | (Show in Finder) | Ctrl+F | panel
vestra.playlist | playlist.move-top | (Move to Top) | Ctrl+Home | panel
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
vestra.playlist | playlist.list-open-list | (Open List File…) | F3 | panel
vestra.playlist | playlist.list-save-list | (Save List…) | F2 | panel
vestra.playlist | playlist.close | (Close List) | F6 | panel
vestra.playlist | playlist.settings | (Playlist Settings…) | F5 | panel
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
  /** Source text, or a text value (player 0.4.3). */
  reason: string | TextJson | ListJson | null;
};
/**
 * A command's conditions (SDK 1.5.40, player 0.5.21): `enabled` and
 * `checked` evaluated by the player (`plugin.when`). Older players ignore
 * the field and show the state as sent.
 */
export type CommandWhen = {
  enabled?: ConditionJson;
  checked?: ConditionJson;
};
export type CommandDeclaration = {
  /** Source text, or a text value (player 0.4.3). */
  title: string | TextJson;
  /** Complete primary menu path INCLUDING its leaf; empty = not in the main menu. Segments may be text values (player 0.4.3). */
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
   * A bottom-bar button (player 0.5.10): an icon name, or an image in the
   * `plugin.ui.image` wire form. Sent only when set: older players refuse
   * unknown declaration fields.
   */
  button?: { icon: string | Json; order: number };
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
