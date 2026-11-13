// UI category, part 4: the player's own surfaces: settings pages, panel slots, dialogs, OSD.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { Disposable } from "./base.ts";
import type { View } from "./ui-content.ts";
import type { Panel, PanelSlot, SidebarSlot } from "./ui-layout.ts";
import type { TemplateArgs, TextValue } from "./ui-locale.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Scope } from "./base.ts";
import type { CommandOptions } from "./commands.ts";
import type { Player } from "./playback.ts";
import type { Windows } from "./ui-layout.ts";
import type { Text, TextList } from "./ui-locale.ts";
/* oxlint-enable no-unused-vars */

/**
 * The categories of the Options window. The tree shows them in this order:
 * General, Playback, Subtitles, Video, Audio, Input, Appearance, Plugins,
 * Other; a category with no pages is hidden.
 *
 * @since 1.0.0
 * @category UI
 */
export type SettingsCategory =
  | "general"
  | "playback"
  | "subtitles"
  | "video"
  | "audio"
  | "input"
  | "appearance"
  | "plugins"
  | "other";

/**
 * A page in the player's Options window, made by {@link Settings.page}.
 *
 * @remarks
 * A {@link View} like a panel: properties and callbacks live on the file's
 * bridge global, every callback of the global is forwarded, and there is no
 * "bind before show" rule. The page exists from `ready`
 * on, whether or not the Options window is open; property writes while it is
 * closed are kept and applied when it opens. When pages are added or removed
 * while the window is open, the player rebuilds it and restores every page's
 * properties to the values last written, so mirror every user change in the
 * plugin's state (and `bind` it), or it reverts.
 *
 * `dispose()`, disposing the scope or stopping the plugin removes the page;
 * if it was showing, the window shows another page.
 *
 * Testing: `host.settingsPage(id)` of `@vestra-player/sdk/testing` has the
 * page's `props` and `emit(callback, ...args)`.
 *
 * @capability None.
 *
 * @example Put two preferences on a page and keep them in a store
 * Options ▸ Video ▸ Blur shows two check boxes whose values survive
 * restarts. The checkboxes are bound two-way (`<=>`) to `in-out`
 * properties of the bridge global, so the user's clicks show at once; the
 * `toggled` callbacks tell the plugin, which saves the new value, and
 * `bind` writes the stored values when the page opens.
 * ```ts
 * const store = plugin.storage.json("blur", {
 *   defaults: { restoreOnStart: false, messages: true },
 * });
 * const page = plugin.settings.page("ui/settings.slint", {
 *   id: "blur",
 *   category: "video",
 *   title: "Blur",
 * });
 * page.bind(() => ({
 *   restoreOnStart: store.value.restoreOnStart,
 *   messages: store.value.messages,
 * }));
 * // The bridge's `restore-toggled(bool)` callback, in camelCase.
 * page.on("restoreToggled", (on: boolean) =>
 *   store.save({ ...store.value, restoreOnStart: on }),
 * );
 * page.on("messagesToggled", (on: boolean) =>
 *   store.save({ ...store.value, messages: on }),
 * );
 * ```
 *
 * `ui/settings.slint` exports the bridge global and the layout:
 *
 * ```slint
 * import { CheckBox } from "std-widgets.slint";
 * import { Theme } from "@vestra/theme.slint";
 *
 * // The bridge: what the plugin writes and the callbacks it handles.
 * export global BlurPage {
 *     in-out property <bool> restore-on-start;
 *     in-out property <bool> messages: true;
 *     callback restore-toggled(bool);
 *     callback messages-toggled(bool);
 * }
 *
 * export component BlurSettings inherits Rectangle {
 *     VerticalLayout {
 *         padding: Theme.dialog-padding;
 *         spacing: 6px;
 *         alignment: start;
 *         CheckBox {
 *             text: "Turn blur back on when the player starts";
 *             checked <=> BlurPage.restore-on-start;
 *             toggled => { BlurPage.restore-toggled(self.checked); }
 *         }
 *         CheckBox {
 *             text: "Show on-screen messages";
 *             checked <=> BlurPage.messages;
 *             toggled => { BlurPage.messages-toggled(self.checked); }
 *         }
 *     }
 * }
 * ```
 *
 * @see {@link Settings.page}, [Add settings and translations](../../../docs/guides/i18n.md)
 * @since 1.0.0
 * @category UI
 */
export type SettingsPage = View &
  Disposable & {
    /**
     * Resolves once the player has registered the page; rejects when it
     * refused it.
     *
     * @remarks
     * The player compiles the page on its own at registration, so a broken
     * page fails here and does not affect the Options window. Pages added
     * while `activate` runs must succeed before the plugin is ready: a
     * rejection fails activation. Later failures also go to
     * {@link Scope.onError}.
     *
     * @throws `ui-prepare` (rejects) The Slint file does not compile; `message`
     *   has the diagnostics.
     * @throws `invalid` (rejects) The plugin already has 8 pages, or `order`
     *   is beyond ±1,000,000.
     * @throws `host` (rejects) The file is missing or outside the package
     *   directory.
     */
    readonly ready: Promise<void>;
  };

/**
 * Add pages to the player's Options window. `plugin.settings`.
 *
 * @remarks
 * Use a settings page for preferences that change rarely. The player owns
 * the Options window (640×480 by default, at least 600×420, resizable): a
 * category tree on the left, the selected page on the right, a Close button
 * at the bottom. The standard close keys close it, and command key bindings
 * do not fire while it has focus. Opening it does not affect playback.
 *
 * A page file exports **one component and one global**, like a panel: the
 * global (the bridge) declares the properties and callbacks, the component
 * lays the page out and reads them. Pages are 440 logical pixels wide; the
 * window scrolls a taller page.
 *
 * @capability None.
 *
 * @example Add a page that edits a stored setting
 * Options ▸ Playback ▸ Resume shows the plugin's Resume switch. `page`
 * registers the page with the Options window (compiled by the player on
 * its own), `bind` sends the stored value, and the page's callback saves
 * the user's change.
 * ```ts
 * const store = plugin.storage.json("settings", { defaults: { resume: true } });
 * const page = plugin.settings.page("ui/settings.slint", {
 *   id: "resume",
 *   category: "playback",
 *   title: "Resume",
 * });
 * page.bind(() => ({ resume: store.value.resume }));
 * // The bridge's `resume-toggled(bool)`: save, and `bind` sends it back.
 * page.on("resumeToggled", (on: boolean) => store.save({ ...store.value, resume: on }));
 * ```
 *
 * @see {@link SettingsPage}, [Add settings and translations](../../../docs/guides/i18n.md)
 * @since 1.0.0
 * @category UI
 */
export interface Settings {
  /**
   * Add a page to the Options window.
   *
   * @remarks
   * The SDK finds the component and the global from the file's
   * `export component` and `export global` lines; the file must export one
   * of each. In the next microtask it registers the page with every property
   * bound or set so far; `ready` reports the result.
   *
   * Within a category, pages are sorted by `order`, then by plugin id and
   * page id.
   *
   * @capability None.
   *
   * @param file - Path relative to the package directory, for example
   *   `"ui/settings.slint"`.
   * @param options - The page's identity and place:
   *   `id` (unique in this plugin, 1–64 letters, digits, `.`, `-` or `_`),
   *   `category`, `title` (shown in the tree, 1–24 characters) and `order`
   *   (an integer within ±1,000,000, default 0; smaller first).
   * @returns A {@link SettingsPage} owned by this scope.
   *
   * @throws `invalid` (throws) A bad `id`, `category`, `title` or `order`, or
   *   this plugin already has a page with this `id`.
   * @throws `Error` without a code (throws) The file does not export exactly
   *   one component and one global. A file that cannot be read throws Node's
   *   file system error (`code` `ENOENT` and so on).
   *
   * @example Register a page and report when the player refuses it
   * An "My plugin" page appears under Plugins, or the reason it could not
   * be added is logged. `page` returns at once; the player compiles the
   * page on its own, and `ready` rejects (for example with `ui-prepare`
   * and the compiler's diagnostics) when it refuses it.
   * ```ts
   * const page = plugin.settings.page("ui/advanced.slint", {
   *   id: "advanced",
   *   category: "plugins",
   *   title: "My plugin",
   *   order: 10, // after pages with a smaller order in the category
   * });
   * page.ready.catch((error: PluginError) => console.error(error.message));
   * ```
   *
   * @since 1.0.0
   */
  page(
    file: string,
    options: {
      /** Unique in this plugin: 1–64 letters, digits, `.`, `-` or `_`. */
      id: string;
      /** Where the page appears in the tree. */
      category: SettingsCategory;
      /** The page's name in the tree, 1–24 characters. */
      title: string;
      /** An integer within ±1,000,000, smaller first (default 0). */
      order?: number;
    },
  ): SettingsPage;
  /**
   * Open the Options window at one of this plugin's pages, or bring it to
   * the front.
   *
   * @remarks
   * Without `pageId` it shows the page that is selected; when the window
   * first opens, that is the page the user saw last (the player remembers
   * it), else the first one.
   *
   * @capability None.
   *
   * @param pageId - The `id` of one of this plugin's pages.
   * @returns Resolves once the window is shown.
   *
   * @throws `invalid` (rejects) `pageId` is not a page of this plugin.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `ui` (rejects) The window could not be built (for example a page
   *   wrote a property its file does not declare).
   *
   * @example Open the plugin's page from an "Options…" button
   * The button in the plugin's window opens the Options window at the
   * plugin's Blur page, or brings it to the front. `show` takes the id the
   * page was registered with and rejects with `invalid` for any other.
   * ```ts
   * const controls = plugin.windows.create("ui/window.slint");
   * controls.on("openOptions", () => plugin.settings.show("blur"));
   * ```
   *
   * @since 1.0.0
   */
  show(pageId?: string): Promise<void>;
}

/**
 * The backdrop position (`plugin.panels.backdrop`): whether a backdrop is
 * mounted and whether it is shown now.
 *
 * @remarks
 * The player decides when the backdrop shows: while the source is empty or
 * loading, and while ready media has no video picture (audio files). The
 * plugin decides what to draw, from {@link Player.state} and
 * {@link Player.stats}. `state` follows every change.
 *
 * @capability None.
 *
 * @example React when a video picture appears
 * The OSD says "Video is playing" when the backdrop gives way to a video
 * picture. The player decides when the backdrop shows (nothing open,
 * loading, audio without a picture); `effective` turns false when a video
 * frame replaces it.
 * ```ts
 * plugin.panels.backdrop.onChange((state) => {
 *   // `null`: no backdrop is mounted.
 *   if (state?.effective === false) void plugin.osd.show("Video is playing");
 * });
 * ```
 *
 * @since 1.0.0
 * @category UI
 */
export interface BackdropSlot {
  /**
   * `null` while no plugin has a backdrop; otherwise `effective` tells whether
   * it is shown now.
   */
  readonly state: {
    /** The backdrop is shown now (there is no video picture). */
    readonly effective: boolean;
  } | null;
  /**
   * Run code when a backdrop appears or disappears, or when it is shown or
   * hidden.
   *
   * @capability None.
   *
   * @param listener - Receives the new state (`null`: no backdrop).
   * @returns A handle that removes the listener.
   *
   * @example Log when the backdrop shows or hides
   * The plugin's log records each change of the backdrop position. The
   * listener runs when the player starts or stops showing the backdrop
   * and with `null` when it is unmounted.
   * ```ts
   * plugin.panels.backdrop.onChange((state) => console.log("backdrop", state));
   * ```
   *
   * @since 1.0.0
   */
  onChange(
    listener: (state: { readonly effective: boolean } | null) => void,
  ): Disposable;
}

/**
 * Put a panel into the player's main window: the bottom bar, the sidebar or
 * the backdrop. `plugin.panels`.
 *
 * @remarks
 * A panel is part of the player's layout: it resizes with the main window,
 * follows fullscreen and auto-hides with the player's own controls. Use one
 * for content that should stay with the video (a playlist, chapters, a
 * custom control bar, cover art); use a {@link Windows | tool window} for a
 * tool the user opens and closes.
 *
 * A panel file exports **one component and one global**. The global is the
 * bridge: the plugin writes its properties and handles its callbacks. The
 * component lays the panel out and reads and calls the global. The split
 * exists because the player composes the component into its own windows: a
 * new instance of the component is made whenever the main window is rebuilt
 * or the sidebar moves to or from its floating window, while the global is
 * one stable address.
 *
 * A plugin mounts at most one panel per slot: a
 * playback plugin can have its control bar in `"bottom"` and its controls in
 * `"adjust"`. Each {@link Panel} has its own bridge, state, `toggle()` and
 * `setInteraction()`; disposing one leaves the others, and stopping the plugin
 * unmounts them all. The bottom bar and the backdrop hold one panel for all
 * plugins; the sidebar and the adjust column one tab per plugin.
 * {@link Panels.bottom}, {@link Panels.sidebar} and {@link Panels.adjust}
 * describe the positions, whoever mounted there.
 *
 * @capability None.
 *
 * @example Mount a list in the sidebar (examples/panel-menu)
 * The sidebar gets an "Example list" tab showing three rows. `mount`
 * returns at once; the SDK sends the mount with the values bound so far,
 * and the player rebuilds its main window with the panel. The Slint file
 * exports the component and the bridge global whose properties `bind`
 * writes.
 *
 * {@includeCode ../../../examples/panel-menu/main.ts#mount}
 *
 * `ui/panel.slint`:
 *
 * {@includeCode ../../../examples/panel-menu/ui/panel.slint}
 *
 * @see {@link Panel}, {@link PanelSlot}, [Example: Adjust panel](../../../docs/examples/adjust-panel.md), [Example: Panel menu](../../../docs/examples/panel-menu.md)
 * @since 1.0.0
 * @category UI
 */
export interface Panels {
  /**
   * Mount a Slint component in the bottom bar, the sidebar or the backdrop.
   *
   * @remarks
   * Returns at once; the panel is on screen when {@link Panel.ready}
   * resolves. Handlers and bindings made right after `mount()` (in the same
   * synchronous code) are part of the first values.
   *
   * - `"bottom"`: under the video, as wide as the video column, as tall as the
   *   component's preferred height. It may draw above its slot into the video
   *   area (negative `y`); the player does not clip it. In fullscreen it
   *   floats over the video and shows only while the pointer is in its band
   *   at the bottom of the screen (hidden 500 ms after the pointer leaves;
   *   {@link Panel.setInteraction} locks keep it).
   * - `"sidebar"`: right of the video, the window's full height, as wide as the
   *   user drags it (at least 317). The user can detach it into a floating
   *   window titled `title`. Several plugins may mount here: each panel is a tab, labelled `title` (else the plugin's name),
   *   and the player draws a 31px tab strip above the current one while there
   *   are two or more (with one panel, nothing changes). Showing, hiding and
   *   detaching apply to the whole sidebar. If the bridge global declares
   *   `in property <bool> tabbed`, the player sets it to `true` while it draws
   *   the strip, so a panel with a tab strip of its own can hide it. Panel
   *   coordinates (drops) start below the strip.
   * - `"backdrop"`: the whole video area, under the OSD, while there is no
   *   video picture (see {@link Panels.backdrop}). One plugin at a time (as
   *   for the bottom bar, another one's mount rejects with `conflict`); it
   *   takes no pointer or keyboard input. While it is mounted, the player does
   *   not show the cover art of audio files itself (from the next file
   *   opened on), so the plugin can draw it.
   * - `"adjust"`: **controls that change what is playing**: the picture, the
   *   sound, the subtitles, the speed (the player's own Picture, Audio,
   *   Subtitles and Playback panels, a colour grading tool). Several plugins
   *   may mount here, one tab each, labelled `title` (else the plugin's name).
   *
   * **Choosing between `"sidebar"` and `"adjust"`.** The slot says what the
   * panel is for; the player decides how it looks and may change that at any
   * time. Ask: after the user closes the panel, do they still look at what it
   * showed? If yes (a list, chapters, search results, another video), it is
   * content: `"sidebar"`. If it only changes what is playing, it is
   * `"adjust"`.
   *
   * **What the player shows today (may change; do not depend on it).** The
   * adjust column is a second column between the video and the sidebar
   * (`[video][adjust][sidebar]`; both can be open, the sidebar always
   * rightmost), 317 wide by default, 280 to half the window, with text tabs
   * and the key that opens each tab under its title (the key of the command
   * your other commands name as their {@link CommandOptions.home | home}). It
   * has no close or detach button: Adjustments and Effects (`host/adjust`,
   * a menu item and the bottom bar's sliders button), your panel's own
   * command ({@link Panel.toggle}) and the menus open and close it. It starts closed. In a window too narrow to dock it beside a video at
   * least 480 wide, it floats over the right of the video, 300 wide; in
   * fullscreen it slides out from the right edge, left of the sidebar. Its
   * width, open state, current tab and tab order are remembered across
   * launches. Its strip is always drawn, so panel coordinates (drops) start
   * below it, and the bridge global's `tabbed` property, if declared, is
   * `true`. As in the sidebar, only the current tab's plugin is kept
   * running while the column is open, and the player compiles a panel the
   * first time it is shown, not at start-up.
   *
   * @capability None.
   *
   * @param slot - Where to mount the panel.
   * @param file - Path relative to the package directory, for example
   *   `"ui/playlist.slint"`.
   * @param options - `component` and `global`: the names to mount, needed
   *   only if the file exports more than one of either. `title`: the floating
   *   sidebar window's title (at most 128 bytes; default "Vestra Player");
   *   not used for the other slots.
   * @returns A {@link Panel} owned by this scope; await {@link Panel.ready}
   *   for the result.
   *
   * @throws `Error` without a code (throws) This plugin already has a panel in
   * this slot (a panel in another slot is fine), or the file
   * exports no component or global, or several and `options` does not name one.
   * A file that cannot be read throws Node's file system error (`code` `ENOENT`
   * and so on).
   * @throws The errors of {@link Panel.ready} (rejects `ready`) The player
   *   refused the mount.
   *
   * @example Mount a bottom bar with a seek slider
   * The plugin's own control bar appears under the video, its slider
   * following the playback position and seeking when dragged. Bindings and
   * handlers made right after `mount` are part of the first values;
   * `ready` resolves once the main window shows the bar, and rejects with
   * `conflict` when another plugin's panel holds the bottom bar.
   * ```ts
   * const bar = plugin.panels.mount("bottom", "ui/bar.slint");
   * // Sent again whenever the position changes.
   * bar.bind(() => ({ position: plugin.player.state.position ?? 0 }));
   * bar.on("seek", (seconds: number) => plugin.player.seek(seconds));
   * await bar.ready;
   * ```
   *
   * @since 1.0.0
   */
  mount(
    slot: "bottom" | "sidebar" | "adjust" | "backdrop",
    file: string,
    options?: {
      /** The exported component to mount, if the file exports several. */
      component?: string;
      /** The exported global to use as the bridge, if the file exports several. */
      global?: string;
      /** The tab label and the floating sidebar window's title (at most 128 bytes). */
      title?: string;
    },
  ): Panel;
  /**
   * The backdrop position: whether a backdrop is mounted (by any plugin) and
   * shown now.
   */
  readonly backdrop: BackdropSlot;
  /** The bottom bar position, whoever mounted it; any plugin may read and toggle it. */
  readonly bottom: PanelSlot;
  /** The sidebar position, including its floating state; any plugin may read and toggle it. */
  readonly sidebar: SidebarSlot;
  /**
   * The adjust column, whoever mounted there; any plugin may read and toggle
   * it. The same shape as {@link Panels.sidebar} without floating: the adjust
   * column never detaches.
   *
   * @remarks
   * `state` is `null` while no plugin has a panel there. The column starts
   * hidden (`preferred: false`, `reason: "userHidden"`) until the user opens
   * it. To open the column at your own panel, call {@link Panel.show} (or
   * {@link Panel.toggle}, which closes it again when your tab is already the
   * current one, the behaviour of the player's own `Alt+1…4`).
   *
   * @example Open the adjust column at this plugin's tab with a key
   * One command opens the column at the plugin's tab, and pressing it again
   * while that tab is shown closes the column. The panel's other commands
   * name it as their `home`, so the player shows its key under the tab and
   * the command palette knows where they live.
   * ```ts
   * const panel = plugin.panels.mount("adjust", "ui/wheels.slint", { title: "Wheels" });
   * plugin.commands.add({
   *   id: "wheels",
   *   title: "Colour Wheels",
   *   bindings: ["Alt+5"],
   *   // Opens the column at this tab; closes it when this tab is shown.
   *   run: () => panel.toggle(),
   * });
   * plugin.commands.add({
   *   id: "wheels-reset",
   *   title: "Reset Colour Wheels",
   *   // Lives in the panel `wheels` opens: its key shows under the tab.
   *   home: "wheels",
   *   run: () => panel.set({ lift: 0 }),
   * });
   * ```
   *
   * @player 0.7.6
   * @since 1.6.11
   */
  readonly adjust: PanelSlot;
}

/**
 * Options of {@link Dialogs.confirm}. Lengths count Unicode characters (one
 * Chinese character is one character).
 *
 * @since 1.0.0
 * @category UI
 */
export interface ConfirmOptions {
  /** The question, shown in bold; 1–200 characters. */
  message: TextValue;
  /**
   * More text under the message; at most 2000 characters. In the
   * confirmation drawn in the player a long detail scrolls and the buttons
   * stay in view.
   */
  detail?: TextValue;
  /** The confirm button's text (the default button: Enter picks it); 1–40 characters. */
  confirm: TextValue;
  /**
   * The cancel button's text (Escape picks it); 1–40 characters.
   *
   * @defaultValue "Cancel", in the player's language
   */
  cancel?: TextValue;
  /**
   * Mark the confirm button as destructive. Only a tool window's system
   * dialog shows it (a warning icon on Windows, red button text on
   * macOS); the confirmation drawn in the player marks nothing, as its
   * approval sheet marks no destructive step. Enter confirms either way.
   *
   * @defaultValue `false`
   */
  destructive?: boolean;
  /**
   * A checkbox, such as "Don't ask again" (in the player, at the left of
   * the buttons); 1–40 characters.
   */
  checkbox?: TextValue;
  /**
   * Values for the placeholders of `message` and `detail`. Any of the texts may
   * instead be a {@link Text}, which carries its own arguments; `args` only
   * fills the string ones. Every text of the dialog is English source text that
   * the player shows translated from the plugin's catalog; `message` and
   * `detail` are templates like {@link Osd.show}'s. The length limits apply to
   * the shown text.
   *
   * @since 1.5.9
   */
  args?: TemplateArgs;
}

/**
 * Confirmations and the system's open and save file dialogs.
 * `plugin.dialogs`.
 *
 * @remarks
 * The plugin passes text and gets the answer. A confirmation for the main
 * window is drawn in the player; one asked while a tool window has the
 * focus, and every file dialog, is the system's own (see
 * {@link Dialogs.confirm}). Each call resolves when the user answers; there
 * is no time limit and no way to close a dialog from code. Only one system
 * dialog (of any kind, from any plugin) is open at a time: another call
 * meanwhile rejects with `busy`. A confirmation is also `busy` while
 * another confirmation or the player's approval sheet waits for the
 * user's answer; the file dialogs are not. Playback continues while a dialog is open; command key bindings pause.
 *
 * **Platforms:** every system with a window; a player without one
 * (headless) rejects every call with `unavailable`.
 *
 * For anything more than a question or a path, use a {@link Windows | tool
 * window}.
 *
 * @capability None.
 *
 * @example Ask before deleting, remembering "Don't ask again"
 * Deleting asks for confirmation with a "Don't ask again" box; once the
 * user ticks it, later deletes go ahead without asking. `confirm` resolves with the button and the checkbox when the
 * user answers; the texts are templates the player translates, so the
 * count goes in `args`. Remembering the box is up to the plugin.
 * ```ts
 * const store = plugin.storage.json("confirm", { defaults: { askBeforeDelete: true } });
 * async function deleteAll(count: number) {
 *   if (store.value.askBeforeDelete) {
 *     const { confirmed, checked } = await plugin.dialogs.confirm({
 *       message: "Delete {} bookmarks?",
 *       args: [count],
 *       detail: "This cannot be undone.",
 *       confirm: "Delete",
 *       destructive: true,
 *       checkbox: "Don't ask again",
 *     });
 *     if (!confirmed) return;
 *     if (checked) store.save({ askBeforeDelete: false });
 *   }
 *   // … delete …
 * }
 * ```
 *
 * @see [Platforms](../../../docs/reference/platforms.md)
 * @since 1.0.0
 * @category UI
 */
export interface Dialogs {
  /**
   * Ask the user to confirm something.
   *
   * @remarks
   * **For the main window** (no tool window has the focus, also while the
   * player is not in the foreground, which then takes no focus): drawn in
   * the player in the style of its approval sheet, the same on every
   * system: `message`, then `detail` (a long one scrolls; the sheet stays
   * inside the window and its buttons in view), the `checkbox` at the
   * footer's left and the confirm (Enter) and cancel (Esc) buttons at its
   * right. Presses in its first 0.5 s are ignored, and a click outside it
   * is Cancel. A click toggles the checkbox (Space does not).
   * `destructive` draws nothing different.
   *
   * **For a tool window** (a plugin's window, Options or the floating
   * sidebar has the focus): the system's dialog on that window. macOS: an
   * `NSAlert` sheet with the custom buttons and the checkbox. Windows: a
   * task dialog titled "Vestra Player" and centred on the window: `message`
   * is the main instruction and `detail` the text below it; a `checkbox`
   * is the dialog's own verification box (no second dialog); no system
   * sound plays; `destructive` shows a warning icon. Other systems have no
   * system alerts, so it is drawn in the player there too.
   *
   * Either way `checked` is the checkbox's state on cancel too.
   *
   * Remembering "Don't ask again" is up to the plugin (see
   * {@link Scope.storage}).
   *
   * @capability None.
   *
   * @param options - The text and buttons; see {@link ConfirmOptions}.
   * @returns The answer: `confirmed` is `true` when the user picked the
   *   confirm button (Escape, the cancel button or closing the dialog give
   *   `false`); `checked` is the checkbox's state (`false` without one).
   *
   * @throws `invalid` (rejects) A text is empty or too long, or `destructive`
   *   is not a boolean.
   * @throws `busy` (rejects) Another dialog is open, or another
   *   confirmation or the approval sheet is waiting for the user's answer.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) Only players before the confirmation
   *   drawn in the player, on a system other than macOS and Windows.
   *
   * @example Confirm before replacing the playlist
   * The user sees "Replace the current playlist?" with a Replace button and
   * the playlist is replaced only after a yes. The promise resolves when
   * the user answers; only one dialog waits for the user at a time, so a
   * second one meanwhile rejects with `busy`.
   * ```ts
   * try {
   *   const { confirmed } = await plugin.dialogs.confirm({
   *     message: "Replace the current playlist?",
   *     confirm: "Replace",
   *   });
   *   if (confirmed) await plugin.osd.show("Playlist replaced");
   * } catch (error) {
   *   if ((error as PluginError).code !== "busy") throw error;
   *   // Another dialog is waiting: let the user finish that one.
   * }
   * ```
   *
   * @since 1.0.0
   */
  confirm(options: ConfirmOptions): Promise<{
    /** The user picked the confirm button. */
    confirmed: boolean;
    /** The checkbox's state (`false` without one; reported on cancel too). */
    checked: boolean;
  }>;
  /**
   * Ask the user for one file to open.
   *
   * @capability None.
   *
   * @param options - `title`: the dialog's title, at most 256 bytes.
   * @returns The absolute path, or `null` when the user cancelled.
   *
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `invalid` (rejects) `title` is longer than 256 bytes.
   *
   * @example Let the user pick a subtitle file
   * The system's Open dialog appears titled "Choose a subtitle file" and
   * the chosen path is shown on the OSD. The promise resolves when the
   * user answers: with the absolute path, or `null` when they cancelled.
   * ```ts
   * const path = await plugin.dialogs.openFile({ title: "Choose a subtitle file" });
   * if (path !== null) await plugin.osd.show("Chosen: {}", [path]); // a path is data
   * ```
   *
   * @since 1.0.0
   */
  openFile(options?: {
    /** The dialog's title (English source text or a {@link Text}), at most 256 bytes. */
    title?: TextValue;
  }): Promise<string | null>;
  /**
   * Ask the user for one or more files to open.
   *
   * @capability None.
   *
   * @param options - `title`: the dialog's title, at most 256 bytes.
   * @returns The absolute paths, or `[]` when the user cancelled.
   *
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `invalid` (rejects) `title` is longer than 256 bytes.
   *
   * @example Let the user pick several files at once
   * The Open dialog allows selecting several files; the OSD says how many
   * were added. The promise resolves with the absolute paths, or with an
   * empty array when the user cancelled.
   * ```ts
   * const paths = await plugin.dialogs.openFiles({ title: "Add to the playlist" });
   * if (paths.length) await plugin.osd.show("{} files added", [paths.length]);
   * ```
   *
   * @since 1.0.0
   */
  openFiles(options?: {
    /** The dialog's title (English source text or a {@link Text}), at most 256 bytes. */
    title?: TextValue;
  }): Promise<string[]>;
  /**
   * Ask the user for a folder.
   *
   * @capability None.
   *
   * @param options - `title`: the dialog's title, at most 256 bytes.
   * @returns The absolute path, or `null` when the user cancelled.
   *
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `invalid` (rejects) `title` is longer than 256 bytes.
   *
   * @example Let the user choose a folder for snapshots
   * The system's folder dialog appears titled "Save snapshots in". It
   * resolves with the folder's absolute path, or `null` when the user
   * cancelled, in which case the plugin stops there.
   * ```ts
   * const folder = await plugin.dialogs.openDirectory({ title: "Save snapshots in" });
   * if (folder === null) return; // cancelled
   * ```
   *
   * @since 1.0.0
   */
  openDirectory(options?: {
    /** The dialog's title (English source text or a {@link Text}), at most 256 bytes. */
    title?: TextValue;
  }): Promise<string | null>;
  /**
   * Ask the user where to save a file.
   *
   * @remarks
   * The dialog only returns a path; writing the file is up to the plugin.
   *
   * @capability None.
   *
   * @param options - `title`: the dialog's title, at most 256 bytes.
   *   `fileName`: the proposed file name (a plain name without `/` or `\`,
   *   at most 256 bytes).
   * @returns The absolute path, or `null` when the user cancelled.
   *
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `invalid` (rejects) `title` is too long, or `fileName` is too long
   *   or contains `/` or `\`.
   *
   * @example Ask where to save a snapshot
   * The system's Save dialog proposes "frame.png" and returns where the
   * user wants it. The dialog only returns the path (or `null` when
   * cancelled); writing the file is up to the plugin afterwards.
   * ```ts
   * const path = await plugin.dialogs.saveFile({ title: "Save snapshot", fileName: "frame.png" });
   * if (path === null) return; // cancelled
   * ```
   *
   * @since 1.0.0
   */
  saveFile(options?: {
    /** The dialog's title (English source text or a {@link Text}), at most 256 bytes. */
    title?: TextValue;
    /**
     * The proposed file name: a plain name, at most 256 bytes. A string is data
     * (not translated); a {@link Text} is shown translated,
     * `text("Playlist.m3u8")` (a `/` or `\\` in a translation becomes `-`).
     */
    fileName?: TextValue;
  }): Promise<string | null>;
}

// ---------------------------------------------------------------- on-screen display

/**
 * This plugin's information block on the OSD: multi-line text over the
 * video that stays until the plugin changes or removes it. Made by
 * {@link Osd.panel}.
 *
 * @remarks
 * The block sits under the OSD message line, on a translucent dark plate
 * (see {@link Osd} for sizes), and takes no input. When
 * several plugins have one, they are stacked from top to bottom. `dispose()`,
 * disposing the scope or stopping the plugin removes it.
 *
 * @capability None.
 *
 * @example Show live playback numbers over the video
 * A block over the video shows the position and the duration, updated
 * as playback moves. `player.onChange` runs after the SDK updated the
 * state; `set` never throws and sends only the newest
 * text while one is in flight, so calling it on every change is fine.
 * ```ts
 * const info = plugin.osd.panel();
 * plugin.player.onChange((state) =>
 *   // A template with data arguments; the player translates "{} / {} s".
 *   info.set("{} / {} s", [state.position?.toFixed(1) ?? "–", state.duration?.toFixed(1) ?? "–"]),
 * );
 * ```
 *
 * @since 1.0.0
 * @category UI
 */
export interface OsdPanel extends Disposable {
  /**
   * Show the block with this text, change it, or hide it.
   *
   * @remarks
   * Latest value wins: calling it on every state change is fine, the same
   * text is not sent twice and only the newest text is sent while a write is
   * in flight. Never throws; a failed write goes to {@link Scope.onError}
   * (`invalid` for too much text, `unavailable` without a user interface).
   *
   * @capability None.
   *
   * @param text - The text, with `\n` between lines: at most 32 lines and
   *   4096 bytes once translated and formatted. `null` hides the block. A
   *   template, like {@link Osd.show}'s.
   * @param args - Values for its placeholders; `null` or omitted for none.
   * @param options - `maxColumns`: cut long lines.
   *
   * @example Show two loop points, then hide the block
   * The block shows "A: 12.0 s" and "B: 18.5 s" on two lines, then
   * disappears. The text is a template the player translates and fills
   * in; `\n` separates lines, and `null` hides the block.
   * ```ts
   * const info = plugin.osd.panel();
   * info.set("A: {} s\nB: {} s", ["12.0", "18.5"]);
   * info.set(null); // hide it
   * ```
   *
   * @since 1.0.0
   */
  set(
    text: TextValue | null,
    args?: TemplateArgs | null,
    options?: OsdPanelOptions,
  ): void;
}

/**
 * Options of {@link OsdPanel.set}.
 *
 * @since 1.5.11
 * @category UI
 */
export interface OsdPanelOptions {
  /**
   * Cut every line longer than this many columns, after translation and
   * formatting, ending it with `…`: a wide character (Chinese, Japanese,
   * Korean, full-width forms) is two columns, a combining mark none, any other
   * one. An integer from 8 to 1000. Measure the video area to choose it.
   */
  maxColumns?: number;
}

/**
 * Text the player draws over the video: short messages and an information
 * block. `plugin.osd`.
 *
 * @remarks
 * The on-screen display (OSD) is the lightest way to tell the user something:
 * no Slint file, no window, visible in fullscreen. A message
 * ({@link Osd.show}) is one line at the top left of the video that
 * disappears after 2 seconds; a newer message, from any plugin, replaces it.
 * The information block ({@link Osd.panel}) stays until the plugin changes
 * or removes it.
 *
 * How the player draws them (a player before 0.4.0 drew bold white text
 * with a black outline instead):
 *
 * - **Message**: white text on a translucent dark plate with rounded
 *   corners and a gradient line along its bottom edge, 10px from the
 *   video area's left and top edges.
 * - **Font size** follows the video area: 3 % of its height, rounded and
 *   clamped to 12–48px (about 18px in the default window, 32px in
 *   fullscreen at 1080 pixels high). The plate's padding and corners scale
 *   with it.
 * - **Information block**: 4px below the message plate, on the same kind of
 *   plate; its font scales in proportion (11px when the message is 16px),
 *   clamped to 9–28px.
 *
 * How long a text may be is in
 * [Limits: on-screen display](../../../docs/reference/limits.md#on-screen-display)
 * ({@link "@vestra-player/sdk/testing"!OSD_LIMITS | OSD_LIMITS}).
 *
 * @capability None.
 *
 * @example Show on-screen messages the user can turn off
 * "Blur on" appears over the video unless the user turned messages off in
 * the plugin's settings. `osd.show` asks the player to draw the text for a
 * moment; the plugin checks its own stored preference before each call.
 * ```ts
 * const store = plugin.storage.json("prefs", { defaults: { messages: true } });
 * const say = (text: string) => {
 *   if (store.value.messages) void plugin.osd.show(text);
 * };
 * say("Blur on");
 * ```
 *
 * @see {@link OsdPanel}, [Limits: on-screen display](../../../docs/reference/limits.md#on-screen-display)
 * @since 1.0.0
 * @category UI
 */
export interface Osd {
  /**
   * Show a one-line message at the top left of the video for 2 seconds.
   *
   * @remarks
   * Replaces the message on screen, whichever plugin showed it. A message
   * that is on screen when the plugin stops still disappears on time.
   *
   * The text is a template in English: the player shows its translation from
   * the plugin's catalog, with the placeholders (`{}`, `{0}`, `{name}`; `{{`
   * and `}}` for braces) filled from `args`. Without `args` the text shows as
   * it is (braces included). Untranslated, the English template is formatted.
   * Never compose the sentence in TypeScript (`` `Speed ${rate}×` ``):
   * translators can only translate whole templates. An argument that is itself
   * words is a {@link Text}, and a message made of a varying number of parts is
   * a {@link TextList} of texts; `text` may also be a `Text` (then without
   * `args`).
   *
   * @capability None.
   *
   * @param text - The template, 1–200 characters once translated and formatted;
   * line breaks become spaces. With `options.actions` the message ends in up to
   * two buttons, each running one of the plugin's own commands
   * ({@link OsdShowOptions}).
   *
   * @param args - Values for its placeholders. Pass `null` with a `Text` and
   * options.
   * @param options - Action buttons after the text.
   * @returns Resolves once the message is on screen.
   *
   * @throws `invalid` (rejects) The shown text is empty, only white space,
   *   or longer than 200 characters, or `args` is not a {@link TemplateArgs};
   *   or there are more than 2 actions, a title is empty or longer than 40
   *   characters once translated, or a command is not one of the plugin's.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   *
   * @example Confirm an action and show a value
   * The OSD shows "Bookmark added", then "Speed 1.5×" in the user's
   * language. The text is English source the player translates with the
   * plugin's catalog; `{}` is filled in with the argument, which stays as
   * it is because it is data.
   * ```ts
   * await plugin.osd.show("Bookmark added");
   * await plugin.osd.show("Speed {}×", [plugin.player.state.rate]);
   * ```
   *
   * @example Offer "Show in Folder" after saving a file
   * The OSD reads "Saved clip.mp4 [Show in Folder]" for about 4 seconds,
   * longer while the pointer is on it. A click runs the plugin's own
   * `reveal` command, which knows the last saved file; the message goes.
   * ```ts
   * declare const path: string;
   * // ---cut---
   * let saved = path; // the command acts on the last saved file
   * plugin.commands.add({
   *   id: "reveal",
   *   title: "Show Last Saved File in Folder",
   *   enabled: () => saved !== "",
   *   run: () => plugin.system.reveal(saved),
   * });
   * await plugin.osd.show("Saved {}", [saved.split(/[\\/]/).pop() ?? saved], {
   *   actions: [{ title: "Show in Folder", command: "reveal" }], // one button
   * });
   * ```
   *
   * @since 1.0.0
   */
  show(
    text: TextValue,
    args?: TemplateArgs | null,
    options?: OsdShowOptions,
  ): Promise<void>;
  /**
   * Create this plugin's information block.
   *
   * @remarks
   * Nothing is shown until {@link OsdPanel.set}. A plugin has one block;
   * dispose it before creating another.
   *
   * @capability None.
   *
   * @returns An {@link OsdPanel} owned by this scope.
   *
   * @throws `Error` without a code (throws) This plugin already has a block.
   *
   * @example Show a status block over the video
   * A small block over the video says "Loop: off" until the plugin changes
   * or hides it. Each plugin has one block, stacked with other plugins'
   * blocks; a second `panel()` call throws.
   * ```ts
   * const info = plugin.osd.panel();
   * info.set("Loop: off");
   * ```
   *
   * @since 1.0.0
   */
  panel(): OsdPanel;
}

/**
 * One button at the end of an OSD message ({@link Osd.show}).
 *
 * @since 1.6.9
 * @category UI
 */
export interface OsdAction {
  /**
   * The button's label: English source text the player translates with the
   * plugin's catalog, or a {@link Text}; 1–40 characters once translated
   * (`OSD_LIMITS.actionChars`). A verb, as on a menu item: "Show in
   * Folder", "Copy", "Undo".
   */
  title: TextValue;
  /**
   * The local id of one of this plugin's own commands
   * ({@link CommandOptions.id}), declared when the message is shown. A
   * click runs it as if the user picked it from a menu: a disabled command
   * does nothing. The command takes no arguments, so it acts on what the
   * plugin remembers (the file it just saved).
   */
  command: string;
}

/**
 * Options of {@link Osd.show}.
 *
 * @remarks
 * A message with actions stays about 4 seconds instead of 2, and does not
 * fade while the pointer is on it and moving: it goes 2 seconds after the
 * pointer leaves or rests (the player's idle time), and at the latest 30
 * seconds after it showed, hovered or not. A click on a button runs its
 * command and removes the message.
 * It is still one line: the buttons follow the text. Buttons take no
 * keyboard focus; screen readers can press them. A newer message, from any
 * plugin or the player, replaces the message with its buttons, and the
 * buttons go when the plugin stops. While its buttons show, the plugin is
 * not stopped for being idle.
 *
 * Players before 0.7.6 ignore `actions` and show the text alone for 2
 * seconds, so do not make an action the only way to reach something.
 *
 * @since 1.6.9
 * @category UI
 */
export interface OsdShowOptions {
  /** At most 2 buttons (`OSD_LIMITS.actions`), in order after the text. */
  actions?: readonly OsdAction[];
}
