/** Finite candidate command registry. Host authenticates owner; no plugin supplies an owner id. */
import type { Transport } from "./wire.ts";
import type { ListJson, TextJson } from "./i18n.ts";
/**
 * The player's command registry caps, the same values as the player's own
 * table (the player's tests check that they agree). They are runaway guards,
 * not product limits: a command added past them fails with code `limit`
 * (its `ready` rejects; during activation, activation fails), commands
 * already registered are unaffected, and disposing a command frees its slot
 * at once. {@link TestHost} enforces the same caps.
 *
 * For menus built from media content (tracks, chapters, presets), set your
 * own sensible display cap well below `perPlugin`.
 *
 * @example
 * ```ts
 * import { COMMAND_LIMITS } from "@vestra-player/sdk/testing";
 *
 * const shown = chapters.slice(0, Math.min(50, COMMAND_LIMITS.perPlugin - 20));
 * ```
 */
export const COMMAND_LIMITS = {
  /**
   * Commands one plugin instance may have at the same time (160).
   */
  perPlugin: 160,
  /** Commands of every plugin plus the player's own, together (1024). */
  total: 1024,
} as const;
/**
 * The player's built-in top-level menus, by id. Write `@<id>` as the first
 * segment of a command path (`["@video", "Blur"]`, see `CommandOptions.path`) to put a
 * command into that menu whatever language the player's menus are in. The
 * player stores the menu's title (视频 today); later segments are titles.
 * Needs player 0.3.0 (`"minPlayerVersion": "0.3.0"`); older players show
 * `@video` as a menu of its own. The player's tests check that this list
 * agrees with the player's.
 *
 * @example
 * ```ts
 * import { MENU_IDS } from "@vestra-player/sdk/testing";
 *
 * assert.ok(MENU_IDS.includes("video"));
 * ```
 */
export const MENU_IDS = [
  "open",
  "playback",
  "subtitles",
  "video",
  "audio",
  "screen",
  "settings",
] as const;

/**
 * A submenu that one of the player's built-in plugins declares: an entry of
 * {@link BUILTIN_SUBMENUS}.
 *
 * @since 1.5.14
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
 * @example
 * ```ts
 * import { BUILTIN_SUBMENUS } from "@vestra-player/sdk/testing";
 *
 * const snapshot = BUILTIN_SUBMENUS.find((menu) => menu.path.at(-1) === "Snapshot")!;
 * plugin.commands.add({
 *   id: "snapshot-to-clipboard",
 *   path: ["@video", ...snapshot.path.slice(1), "Copy Snapshot"],
 *   run: copySnapshot,
 * });
 * ```
 *
 * @since 1.5.14
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
  { path: ["Emulator"], plugins: ["vestra.nes"] },
]);

export type CommandState = {
  enabled: boolean;
  checked: boolean | null;
  busy: boolean;
  /** Source text, or a text value (player 0.4.3). */
  reason: string | TextJson | ListJson | null;
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
};
export function commandClient(transport: Transport) {
  return {
    register: (
      id: string,
      revision: number,
      declaration: CommandDeclaration,
      state: CommandState,
    ) =>
      transport.request<{ revision: number }>("commands.register", {
        id,
        revision,
        declaration,
        state,
      }),
    /** Remove the command from the menu and the binding table; the id is free again. */
    unregister: (id: string) =>
      transport.request<void>("commands.unregister", { id }),
    update: (id: string, revision: number, state: CommandState) =>
      transport.request<{ revision: number }>("commands.update", {
        id,
        revision,
        state,
      }),
  };
}
