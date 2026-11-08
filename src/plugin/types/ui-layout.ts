// UI category, part 2: where views go: windows, panels and their slots, drops.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { Disposable } from "./base.ts";
import type { Command } from "./commands.ts";
import type { View } from "./ui-content.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { MainWindow, Scope } from "./base.ts";
import type { PluginInfo } from "./packages.ts";
import type { Ui } from "./ui-content.ts";
import type { Dialogs, Panels, Settings } from "./ui-shell.ts";
/* oxlint-enable no-unused-vars */

/**
 * A tool window: a separate operating-system window drawn from one of the
 * plugin's `.slint` files, made by {@link Windows.create}.
 *
 * @remarks
 * **What it is.** A top-level window with its own title bar: the user can
 * move it, resize it (if the Slint file allows) and close it. It is not
 * modal and not attached to the main window: playback and the main window
 * keep working while it is open. Its title, size and content come from the
 * Slint `Window` component (`title`, `width` or `preferred-width`…); the
 * player applies its palette and the system font before the window appears.
 * The system chooses its position; the player does not remember it.
 * {@link MainWindow.setAlwaysOnTop} also floats tool windows.
 *
 * **Life cycle.**
 * 1. `create()` makes the handle; nothing is on screen.
 * 2. Bind callbacks with {@link View.on} and properties with
 *    {@link View.bind} or {@link View.set}.
 * 3. {@link Window.show} opens the window with those properties.
 *    {@link Window.hide} hides it and keeps its state.
 * 4. {@link Window.close}, or the user (title-bar button or the
 *    [standard close keys](../../../docs/reference/commands.md#keys-the-system-takes-first)), destroys the window instance; only the
 *    user's close calls {@link Window.onClose}. The handle stays usable: the
 *    next `show()` opens a fresh instance with the current properties.
 * 5. `dispose()`, disposing the owning scope or the plugin stopping closes
 *    it for good (without `onClose`); the id can then be used again.
 *
 * Command key bindings do not fire while a tool window has focus; handle
 * keys in Slint (a `FocusScope`). The standard close keys never reach the
 * window's Slint code.
 *
 * Testing: `host.window(id)` of `@vestra-player/sdk/testing` has the
 * window's `props`, `visible`, `emit(callback, ...args)` and `userClose()`.
 *
 * @capability ui.window
 *
 * @example Open a window from a menu command (examples/bookmark)
 * Playback ▸ Bookmark… opens the Bookmark window. `create` only makes a
 * handle; the command's `run` calls `show`, which compiles the Slint file
 * and opens the window with the bound properties the first time, and
 * brings back the same window afterwards.
 *
 * {@includeCode ../../../examples/bookmark/main.ts#window,command}
 *
 * @example Stop work when the user closes the window
 * A clock window ticks every second while it is open and stops costing
 * anything once the user closes it. `plugin.update()` makes the SDK
 * evaluate the bound time again from a timer; `onClose` runs only for the
 * user's close, so the plugin stops the timer there.
 * ```ts
 * const clock = plugin.windows.create("ui/clock.slint");
 * let timer: NodeJS.Timeout | undefined;
 * clock.bind(() => ({ time: new Date().toLocaleTimeString() }));
 * clock.onClose(() => {
 *   clearInterval(timer);
 *   timer = undefined;
 * });
 * plugin.commands.add({
 *   id: "clock",
 *   path: ["@screen", "Clock…"],
 *   run: async () => {
 *     await clock.show();
 *     // Re-evaluate `bind` once a second: bound values change only then.
 *     timer ??= setInterval(() => plugin.update(), 1000);
 *   },
 * });
 * ```
 *
 * @see {@link Windows.create}, {@link View}, [Open a tool window and remember its state](../../../docs/guides/windows.md)
 * @since 1.0.0
 * @category UI
 */
export interface Window extends View, Disposable {
  /**
   * Open the window, or show it again if it is hidden.
   *
   * @remarks
   * When no window instance exists (the first call, or after a close), the
   * player compiles the Slint file and opens a new window. Its initial
   * properties are the bound values and the values last passed to
   * {@link View.set}, so no default values flash, and the callbacks bound
   * so far are registered. When the window is hidden, it is shown again with
   * its state.
   *
   * `show`, `hide` and `close` of one window run one after another in call
   * order. After `dispose()`, `show` does nothing.
   *
   * @capability ui.window
   *
   * @returns Resolves once the player has shown the window.
   *
   * @throws `capability` (rejects) The manifest does not declare `ui.window`.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `host` (rejects) The Slint file is missing, outside the package
   *   directory or does not compile; it exports more than one component; or
   *   a bound property or callback is not declared in it. `message` has the
   *   reason, including the compiler's diagnostics.
   * @throws `missing` (rejects) An image in the initial properties does not
   *   exist (see {@link Ui.image}).
   * @throws `invalid` (rejects) An image in the initial properties fails
   *   another check: outside the allowed directories, too large, not PNG or
   *   JPEG.
   *
   * @example Tell the user why a window did not open
   * When the inspector cannot open, the user sees why on the OSD instead
   * of nothing happening. `show` compiles the Slint file and opens the
   * window; it rejects with a code, such as `host` for a Slint file that
   * does not compile or `unavailable` without a user interface.
   * ```ts
   * const inspectorWindow = plugin.windows.create("ui/inspector.slint");
   * try {
   *   await inspectorWindow.show();
   * } catch (error) {
   *   // The code is data; `message` has the details for the log.
   *   await plugin.osd.show("Cannot open the inspector ({})", [(error as PluginError).code]);
   * }
   * ```
   *
   * @since 1.0.0
   */
  show(): Promise<void>;
  /**
   * Hide the window without closing it.
   *
   * @remarks
   * The instance and everything in it stay; {@link Window.opened} stays
   * `true` and {@link Window.show} brings the window back as it was. Does
   * nothing when the window is not open.
   *
   * @capability ui.window
   *
   * @returns Resolves once the window is hidden.
   *
   * @throws `missing` (rejects) The user closed the window just before (the
   *   close had not reached the plugin yet).
   *
   * @example Show and hide a window from a checkable menu item
   * Audio ▸ Levels shows the window with a check mark and hides it again.
   * `hide` keeps the window's instance and state, so showing it again is
   * instant; the check mark follows `visible`, and `onClose` resets it when
   * the user closes the window with its title-bar button.
   * ```ts
   * const levels = plugin.windows.create("ui/levels.slint");
   * let visible = false; // what the check mark shows
   * plugin.commands.add({
   *   id: "levels",
   *   path: ["@audio", "Levels"],
   *   checked: () => visible,
   *   run: async () => {
   *     visible = !visible;
   *     await (visible ? levels.show() : levels.hide());
   *   },
   * });
   * levels.onClose(() => (visible = false));
   * ```
   *
   * @since 1.0.0
   */
  hide(): Promise<void>;
  /**
   * Close the window and destroy its instance; the handle stays usable.
   *
   * @remarks
   * The next {@link Window.show} opens a fresh instance with the current
   * properties; state that only the Slint side had (text the plugin did not
   * record) is gone. {@link Window.onClose} is not called. Does nothing when
   * the window is not open. Unlike `dispose()`, the handle, its handlers and
   * its bindings stay.
   *
   * @capability ui.window
   *
   * @returns Resolves once the window is closed.
   *
   * @throws `missing` (rejects) The user closed the window just before.
   *
   * @example Close the window from its own button
   * The editor's Done button closes the editor window. `close` destroys
   * the window instance but keeps the handle, its handlers and bindings,
   * so the next `show` opens a fresh window; `onClose` is not called for
   * the plugin's own close.
   * ```ts
   * const editor = plugin.windows.create("ui/editor.slint");
   * editor.on("done", () => editor.close());
   * ```
   *
   * @since 1.0.0
   */
  close(): Promise<void>;
  /**
   * Whether a window instance exists, shown or hidden: `false` before the
   * first {@link Window.show}, after {@link Window.close}, after the user
   * closed the window and after `dispose()`.
   */
  readonly opened: boolean;
  /**
   * Run code when the user closes the window.
   *
   * @remarks
   * Called for the title-bar close button and the
   * [standard close keys](../../../docs/reference/commands.md#keys-the-system-takes-first). When it runs, the window
   * instance is gone and {@link Window.opened} is already `false`; a later
   * `show()` opens a fresh one. It is not called for the plugin's own
   * {@link Window.close} or `dispose()`, nor when the plugin stops. Errors
   * it throws go to {@link Scope.onError}, and an update pass follows.
   *
   * Stop what the window needed here: timers, polling, a live preview.
   *
   * @capability ui.window
   *
   * @param listener - Called with no arguments; may be async.
   * @returns A handle that removes the listener.
   *
   * @example Remember that the user closed the window
   * The plugin records that the notes window was closed, so it does not
   * reopen it at the next start. `onClose` runs for the title-bar button,
   * the player's close keys (Cmd+W, Ctrl+W, Ctrl+F4) and the system's own
   * close request such as Alt+F4 (not for the plugin's own `close`); the
   * store writes the change to `window.json` shortly after.
   * ```ts
   * const store = plugin.storage.json("window", { defaults: { open: false } });
   * const notesWindow = plugin.windows.create("ui/notes.slint");
   * notesWindow.onClose(() => store.save({ open: false }));
   * ```
   *
   * @see [Open a tool window and remember its state](../../../docs/guides/windows.md)
   * @since 1.0.0
   */
  onClose(listener: () => unknown): Disposable;
}

/**
 * Create tool windows: separate windows drawn from the plugin's `.slint`
 * files. `plugin.windows`.
 *
 * @remarks
 * Use a tool window for something the user opens, works with and closes: a
 * picture adjustment panel, an inspector, an editor. For content that should
 * stay inside the player's main window, mount a {@link Panels | panel}; for
 * preferences, add a {@link Settings.page | settings page}; for a yes/no
 * question, use {@link Dialogs.confirm}. A plugin can have any number of
 * windows.
 *
 * @capability ui.window
 *
 * @example Create a window and open it from a menu (examples/bookmark)
 * A Bookmark window opens from Playback ▸ Bookmark…. `create` returns a
 * handle without opening anything; its bindings and callbacks are set up
 * first, and `show` opens the window when the command runs.
 *
 * {@includeCode ../../../examples/bookmark/main.ts#window,command}
 *
 * @see {@link Window}, [Open a tool window and remember its state](../../../docs/guides/windows.md)
 * @since 1.0.0
 * @category UI
 */
export interface Windows {
  /**
   * Create a window handle for a `.slint` file; nothing opens until
   * {@link Window.show}.
   *
   * @remarks
   * The file must export exactly one component, usually
   * `export component Name inherits Window`; helper components without
   * `export` are allowed. The window's properties and callbacks are declared
   * on that component. The file is not read here: a missing or broken file
   * makes {@link Window.show} reject.
   *
   * Bind every callback with {@link View.on} before the first `show()`.
   *
   * @capability ui.window (checked by {@link Window.show}).
   *
   * @param file - Path relative to the package directory, with `/` on every
   *   system, for example `"ui/picture.slint"`. It must stay inside the
   *   package.
   * @param options - `id`: the window's name, unique among this plugin's
   *   windows until the window is disposed. Default: the file name without
   *   its extension (`ui/picture.slint` → `picture`). Give distinct ids to
   *   open the same file more than once.
   * @returns A {@link Window} owned by this scope.
   *
   * @throws `conflict` (throws) This plugin already has a window with this id.
   *
   * @example Open two windows from one Slint file
   * Two compare windows open side by side, one labelled A and one B. A
   * window's id defaults to its file name, so the second window of the
   * same file needs its own `id`; each handle has its own properties.
   * ```ts
   * const left = plugin.windows.create("ui/compare.slint", { id: "compare-left" });
   * const right = plugin.windows.create("ui/compare.slint", { id: "compare-right" });
   * left.set({ side: "A" });
   * right.set({ side: "B" });
   * await Promise.all([left.show(), right.show()]);
   * ```
   *
   * @since 1.0.0
   */
  create(file: string, options?: { id?: string }): Window;
}

/**
 * The state of the bottom bar or sidebar position, whoever mounted the
 * panel there.
 *
 * @since 1.0.0
 * @category UI
 */
export interface SlotState {
  /** The user's choice: the check mark of the menu item that shows the panel. */
  preferred: boolean;
  /** Whether the panel is on screen right now (docked, popped out or floating). */
  effective: boolean;
  /**
   * Why it is not on screen, `null` while it is:
   *
   * - `userHidden`: the user (or a plugin) turned it off;
   * - `space`: the window is too narrow for the sidebar (the preference stays);
   * - `fullscreen`: the sidebar's fullscreen overlay is collapsed and pops
   *   out when the pointer reaches the right edge; treat it as "on" for a
   *   toggle button;
   * - `idle`: the bottom bar in fullscreen while the pointer is outside the
   *   bar's own band at the bottom of the screen (keys and pointer motion
   *   elsewhere do not bring it back).
   */
  reason: "userHidden" | "space" | "fullscreen" | "idle" | null;
  /** The sidebar floats in its own window; always `false` for the bottom bar. */
  detached: boolean;
}

/**
 * One panel of a position ({@link PanelSlot.panels}): a tab of the sidebar.
 *
 * @since 1.5.2
 * @category UI
 */
export interface SlotPanel {
  /** The manifest id of the plugin that mounted it (pass it to {@link PanelSlot.activate}). */
  plugin: string;
  /** Its tab label: the `title` of {@link Panels.mount}, else the plugin's name. */
  title: string;
  /** Its tab is the current one (the panel the position shows). */
  active: boolean;
}

/**
 * The state of one panel ({@link Panel.state}): its position's state, seen
 * from this panel, which may be one of several sidebar tabs.
 *
 * @since 1.5.2
 * @category UI
 */
export interface PanelState {
  /**
   * Its tab is the current one. Always `true` for the bottom bar, the
   * backdrop and a sidebar panel without other tabs.
   */
  active: boolean;
  /** The position's preference (the user's choice to show it). */
  preferred: boolean;
  /** This panel is on screen now: the position is, and this is its current tab. */
  effective: boolean;
  /**
   * Why this panel is not on screen, `null` while it is: `otherTab` while
   * another plugin's tab is the current one (whatever the position's state),
   * else the position's reason ({@link SlotState.reason}).
   */
  reason: SlotState["reason"] | "otherTab";
  /** The sidebar floats in its own window (with all its tabs); always `false` in the adjust column. */
  detached: boolean;
}

/**
 * The bottom bar, the sidebar or the adjust column position
 * (`plugin.panels.bottom`, `plugin.panels.sidebar`, `plugin.panels.adjust`),
 * independent of who mounted the panel there.
 *
 * @remarks
 * The position does not belong to the plugin that mounted the panel: any
 * plugin with `ui.mount` may read and toggle it, so a "Show playlist" command
 * can live in a different plugin than the playlist. The player remembers
 * the sidebar's visibility, width, detached state and floating window
 * position across launches.
 *
 * `state` is read when first used. With `events` it then follows every
 * change (the user, other plugins, the window size); without `events` it
 * refreshes only after this plugin's own changes.
 *
 * @capability ui.mount; `events` to follow changes made elsewhere.
 *
 * @example Add a "Show sidebar" item that works with any sidebar panel
 * Tools ▸ Show sidebar shows or hides the sidebar, whichever plugin's
 * panel is in it, with a check mark while it is shown. The position does
 * not belong to the plugin that mounted the panel: `state` is `null`
 * while nobody has a panel there (the item is disabled then), and
 * `toggle` flips the user's remembered preference.
 * ```ts
 * const sidebar = plugin.panels.sidebar;
 * plugin.commands.add({
 *   id: "sidebar",
 *   path: ["Tools", "Show sidebar"],
 *   // `state` is null while no plugin has a panel in the sidebar.
 *   checked: () => sidebar.state?.preferred ?? false,
 *   enabled: () => sidebar.state !== null,
 *   run: () => sidebar.toggle(),
 * });
 * ```
 *
 * @see {@link Panels}, {@link SlotState}
 * @since 1.0.0
 * @category UI
 */
export interface PanelSlot {
  /**
   * The current state; `null` while no plugin has a panel there (or without
   * `ui.mount`). With sidebar tabs it is the whole position's: shown,
   * hidden and floating apply to all tabs, which {@link PanelSlot.panels}
   * lists.
   */
  readonly state: SlotState | null;
  /**
   * The position's panels in tab order: the sidebar's tabs, the bottom
   * bar's one panel; `null` while there is none (as `state`), and from
   * players without sidebar tabs (0.4.0 and older). Refreshed with `state`.
   *
   * @throws Never.
   *
   * @since 1.5.2
   */
  readonly panels: readonly SlotPanel[] | null;
  /**
   * Run code when the position's state changes.
   *
   * @remarks
   * Needs `events`: without it the listener runs only after this plugin's own
   * changes. Called with `null` when the panel there is unmounted, and also
   * when only the tabs changed ({@link PanelSlot.panels}: a panel added or
   * removed, another tab current). Errors go to {@link Scope.onError}.
   *
   * @capability ui.mount and events
   *
   * @param listener - Receives the new state.
   * @returns A handle that removes the listener.
   *
   * @example Tell the user when the window is too narrow for the sidebar
   * When the sidebar should show but the window has no room for it, the
   * OSD says so. With `events`, the listener runs on every change of the
   * position, whoever caused it. The player reports `reason: "space"` when
   * the preference is to show the sidebar but the window is too small.
   * ```ts
   * plugin.panels.sidebar.onChange((state) => {
   *   // `null`: no panel is mounted in the sidebar any more.
   *   if (state?.reason === "space") void plugin.osd.show("Widen the window to see the playlist");
   * });
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (state: SlotState | null) => void): Disposable;
  /**
   * Show or hide the panel at this position: set the user's preference.
   *
   * @remarks
   * The same as the user's menu item: the preference is remembered. Showing
   * may still leave the panel off screen (`reason: "space"`); in fullscreen,
   * `true` pops the sidebar overlay out at once.
   *
   * @capability ui.mount
   *
   * @param visible - The new preference.
   * @returns Resolves once the layout has the new preference, with `state`
   *   refreshed.
   *
   * @throws `missing` (rejects) No panel is mounted at this position.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.mount`.
   *
   * @example Hide the bottom bar for a clean picture
   * The control bar disappears, as if the user had hidden it from the menu,
   * and stays hidden at the next start because the preference is
   * remembered. `setVisible` rejects with `missing` when no panel is in the
   * bottom bar, which this plugin treats as nothing to hide.
   * ```ts
   * await plugin.panels.bottom.setVisible(false).catch((error: PluginError) => {
   *   if (error.code !== "missing") throw error; // no bar mounted: nothing to do
   * });
   * ```
   *
   * @since 1.0.0
   */
  setVisible(visible: boolean): Promise<void>;
  /**
   * Flip the user's preference, using the player's current value.
   *
   * @remarks
   * Reads the state from the player first, so it is right even without
   * `events`. It is a switch, the same in every mode: in fullscreen a column
   * switched on is revealed by the pointer at the right edge, and is not popped
   * out by the toggle (`setVisible(true)` pops it out). Switching it off while
   * it is out slides it in at once.
   *
   * @capability ui.mount
   *
   * @returns Resolves once the layout has the new preference.
   *
   * @throws `missing` (rejects) No panel is mounted at this position.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.mount`.
   *
   * @example Toggle the control bar from a checkable menu item
   * Screen ▸ Control bar shows or hides the bottom bar and carries a check
   * mark while it is shown. `toggle` reads the player's current preference
   * first, so it is right even without `events`; `checked` is evaluated
   * again after the command runs and follows `state`.
   * ```ts
   * plugin.commands.add({
   *   id: "toggle-bar",
   *   path: ["@screen", "Control bar"],
   *   // The user's preference, remembered across launches.
   *   checked: () => plugin.panels.bottom.state?.preferred ?? false,
   *   run: () => plugin.panels.bottom.toggle(),
   * });
   * ```
   *
   * @since 1.0.0
   */
  toggle(): Promise<void>;
  /**
   * Make a panel's tab the current one, without showing or hiding the
   * position.
   *
   * @remarks
   * The sidebar holds the panels of several plugins as tabs (see
   * {@link Panels.mount}); this switches which one it shows, like a click on
   * its tab. To show this plugin's own panel, use {@link Panel.show}. The
   * bottom bar has one panel: activating it changes nothing. Players
   * without sidebar tabs (0.4.0 and older) ignore it.
   *
   * @capability ui.mount
   *
   * @param plugin - The manifest id of the plugin whose panel to show, one
   *   of {@link PanelSlot.panels}.
   * @returns Resolves once the layout has the new current tab, with `state`
   *   refreshed.
   *
   * @throws `missing` (rejects) No panel is mounted at this position, or
   *   none of `plugin`.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.mount`.
   *
   * @example Switch the sidebar to the playlist's tab
   * A command makes the playlist the sidebar's current tab without showing
   * or hiding the sidebar, like a click on its tab. `activate` takes the
   * manifest id of the plugin whose tab to show and rejects with
   * `missing` when that plugin has no panel there.
   * ```ts
   * plugin.commands.add({
   *   id: "to-playlist",
   *   title: "Show the playlist tab",
   *   run: () => plugin.panels.sidebar.activate("vestra.playlist"),
   * });
   * ```
   *
   * @since 1.5.2
   */
  activate(plugin: string): Promise<void>;
}

/**
 * The sidebar position: a {@link PanelSlot} that can also float in a window
 * of its own.
 *
 * @remarks
 * Detached, the sidebar panel is shown in a separate window (300×408 by
 * default, at least 300×250) with the panel's `title`. The plugin's
 * properties and callbacks stay the same, but the window holds a new
 * instance of the component. Closing the floating window (its close button
 * or the [standard close keys](../../../docs/reference/commands.md#keys-the-system-takes-first)) is the same as `setVisible(false)`.
 *
 * @capability ui.mount
 *
 * @example Add a "Detach sidebar" item
 * Tools ▸ Detach sidebar floats the sidebar in its own window and docks
 * it again, with a check mark while it floats. `setDetached` moves all
 * the sidebar's tabs; the floating window holds new instances of the
 * panels, which keep the plugins' properties and callbacks.
 * ```ts
 * const sidebar = plugin.panels.sidebar;
 * plugin.commands.add({
 *   id: "detach",
 *   path: ["Tools", "Detach sidebar"],
 *   // Detaching moves every tab of the sidebar into the floating window.
 *   checked: () => sidebar.state?.detached ?? false,
 *   enabled: () => sidebar.state !== null,
 *   run: () => sidebar.setDetached(!sidebar.state?.detached),
 * });
 * ```
 *
 * @since 1.0.0
 * @category UI
 */
export interface SidebarSlot extends PanelSlot {
  /**
   * Float the sidebar panel in its own window, or attach it back.
   *
   * @capability ui.mount
   *
   * @param detached - `true` to float, `false` to dock.
   * @returns Resolves once the layout has changed, with `state` refreshed.
   *
   * @throws `missing` (rejects) No panel is mounted in the sidebar.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.mount`.
   *
   * @example Float the sidebar or dock it back
   * The sidebar moves into its own window, or back into the main window
   * when it already floats. `state` says whether it is detached now;
   * `setDetached` resolves once the layout changed, with `state` refreshed.
   * ```ts
   * const sidebar = plugin.panels.sidebar;
   * await sidebar.setDetached(!sidebar.state?.detached);
   * ```
   *
   * @since 1.0.0
   */
  setDetached(detached: boolean): Promise<void>;
}

/**
 * A panel in the player's main window, made by {@link Panels.mount}.
 *
 * @remarks
 * Properties and callbacks live on the file's bridge global (see
 * {@link Panels}). Unlike a tool window, a panel forwards every callback of
 * the global, so {@link View.on} has no "bind before show" rule.
 *
 * **Life cycle.** `mount()` returns at once; in the next microtask the SDK
 * sends the mount with every property bound or set so far. The player queues
 * mounts and rebuilds its main window with the panel; {@link Panel.ready}
 * then resolves. Rebuilding happens whenever any plugin mounts or unmounts a
 * panel, and detaching the sidebar puts a new instance in a floating window.
 * The player restores the bridge properties to the values last written, but
 * state kept only inside the component (a scroll position, a property the
 * plugin never writes) starts over: keep what matters in bridge properties.
 * `dispose()`, disposing the scope or stopping the plugin unmounts it.
 *
 * Testing: `host.mounted()` of `@vestra-player/sdk/testing` has the panel's
 * `slot`, `props` and `emit(callback, ...args)`.
 *
 * @capability ui.mount
 *
 * @example Mount a sidebar list with a right-click menu (examples/panel-menu)
 * The sidebar gets an "Example list" tab whose rows can be selected and
 * have a context menu. `mount` returns at once and the player adds the
 * panel when it rebuilds its main window; `bind` keeps the rows and the
 * selection on the panel's bridge global, and the `context-menu` callback
 * opens a menu of the plugin's commands where the user clicked.
 *
 * {@includeCode ../../../examples/panel-menu/main.ts#mount,menu}
 *
 * `ui/panel.slint`:
 *
 * {@includeCode ../../../examples/panel-menu/ui/panel.slint}
 *
 * @see {@link Panels.mount}, {@link PanelSlot}, [Open a tool window and remember its state](../../../docs/guides/windows.md)
 * @since 1.0.0
 * @category UI
 */
export interface Panel extends View, Disposable {
  /**
   * Resolves once the player has mounted the panel and the main window shows
   * it; rejects when the mount failed.
   *
   * @remarks
   * Mounts made while `activate` runs must succeed before the plugin is
   * ready: a rejection fails activation, except `conflict` for a taken
   * position (below), which the player (0.4.x after 0.4.0) and `TestHost`
   * do not count: the plugin runs without its panel, its commands and keys
   * work, and the player shows the refusal (an OSD message,
   * {@link PluginInfo.warnings} and the text in {@link PluginInfo.error}).
   * Later failures also go to {@link Scope.onError}.
   *
   * A second sidebar panel is not refused: it resolves as another tab (see
   * {@link Panel.state}). Built-in plugins mount first at start-up, so the
   * playlist's tab is first and a built-in panel keeps its position. The
   * sidebar takes any number of tabs; the strip shows the tabs that fit and a
   * `»` menu lists all of them. A plugin whose sidebar tab is in the
   * background, and that holds nothing else that keeps it running, goes to
   * standby when idle; showing the tab starts it again (see
   * {@link Panel.state}).
   *
   * @throws `ui-prepare` (rejects) The Slint file does not compile, or a bound
   * property is not declared on the bridge global; `message` has the
   * diagnostics.
   * @throws `conflict` (rejects) Another plugin's panel holds the bottom bar or
   * the backdrop (shown, or being mounted); `message` names the position and
   * the holder (「底栏已被 vestra.playback 使用」). Not an activation failure. Never
   * for the sidebar.
   * @throws `busy` (rejects) The player is still preparing this plugin's
   *   previous mount, or its queue of mounts is full.
   * @throws `invalid` (rejects) `title` is longer than 128 bytes or has
   *   control characters.
   * @throws `host` (rejects) The file is missing or outside the package
   *   directory.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.mount`.
   */
  readonly ready: Promise<void>;
  /**
   * This panel's state: its position's, and whether its tab is the current
   * one; `null` until {@link Panel.ready} resolved (and after `dispose`).
   *
   * @remarks
   * Read when first used; with `events` it then follows every change (the
   * user switching tabs, other plugins, the window size), without `events`
   * only this plugin's own changes. A sidebar panel in a background tab
   * has `active: false`, `effective: false` and `reason: "otherTab"`.
   *
   * A background tab does not keep the plugin running. If the panel is all that
   * keeps it running, the plugin goes to standby after the idle time (stop
   * reason `idle`): the player keeps its tab, with its title, in the strip and
   * the `»` menu. When the user shows the tab, the player starts the plugin
   * again; `activate` runs and mounts the same panel (same file and component),
   * which takes the tab over, and {@link Panel.ready} resolves again. Anything
   * the plugin kept only in memory is gone: restore the view from storage
   * (session storage survives standby). While it is in the background, the
   * player may also drop the panel's component and build it again from the
   * bridge properties last written, as it does on any rebuild.
   *
   * @throws Never; `null` stands for "not mounted".
   *
   * @since 1.5.2
   */
  readonly state: PanelState | null;
  /**
   * Run code when this panel's state changes.
   *
   * @remarks
   * Needs `events`: without it the listener runs only after this plugin's
   * own changes. Called with `null` when the panel is unmounted. Errors go
   * to {@link Scope.onError}.
   *
   * @capability ui.mount and events
   *
   * @param listener - Receives the new state.
   * @returns A handle that removes the listener.
   *
   * @example Notice when the list moves to a background tab
   * The plugin logs when the user switches the sidebar to another plugin's
   * tab, for example to pause work the list does. With `events` the
   * listener runs on every change. `reason: "otherTab"` exists only in a
   * panel's own state: the SDK sets it when the sidebar's current tab is
   * another plugin's (the position's state never has it).
   * ```ts
   * const panel = plugin.panels.mount("sidebar", "ui/list.slint", { title: "List" });
   * panel.onChange((state) => {
   *   if (state?.reason === "otherTab") console.error("list in a background tab");
   * });
   * ```
   *
   * @since 1.5.2
   */
  onChange(listener: (state: PanelState | null) => void): Disposable;
  /**
   * Show this panel: make its tab the current one and show its position.
   *
   * @remarks
   * Sets the position's preference like {@link PanelSlot.setVisible}`(true)`
   * (remembered; in fullscreen the sidebar overlay pops out). On players
   * without sidebar tabs (0.4.0 and older) it is just that. Waits for
   * {@link Panel.ready} first.
   *
   * @capability ui.mount
   *
   * @returns Resolves once the layout shows the panel's tab, with `state`
   *   refreshed.
   *
   * @throws `invalid` (rejects) The panel is the backdrop, which the player
   *   shows by itself.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws The errors of {@link Panel.ready} (rejects) The mount failed.
   *
   * @example Bring the plugin's sidebar panel to the front
   * A command shows the List tab: it becomes the current tab and the
   * sidebar is shown, and the preference is remembered. `show` waits for
   * the mount first, so it can run right after `mount`.
   * ```ts
   * const list = plugin.panels.mount("sidebar", "ui/list.slint", { title: "List" });
   * plugin.commands.add({ id: "show", title: "Show the list", run: () => list.show() });
   * ```
   *
   * @since 1.5.2
   */
  show(): Promise<void>;
  /**
   * Show this panel, or hide its position when it is shown.
   *
   * @remarks
   * Reads the state from the player first. When the position is shown
   * (`preferred`) and this panel's tab is the current one, it hides the
   * position; otherwise it switches the position on at this panel's tab: a
   * panel in a background tab comes to the front instead of the sidebar
   * closing. It is a switch, the same in every mode, like the player's own
   * Alt+1…4 and Adjustments and Effects: in fullscreen a column switched on is
   * revealed by the pointer at the right edge, not popped out
   * ({@link Panel.show} pops it out), and one switched off while out slides in
   * at once. A "Show list" command checked by `state.preferred && state.active`
   * matches it. Waits for {@link Panel.ready} first.
   *
   * @capability ui.mount
   *
   * @returns Resolves once the layout has changed, with `state` refreshed.
   *
   * @throws `invalid` (rejects) The panel is the backdrop.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws The errors of {@link Panel.ready} (rejects) The mount failed.
   *
   * @example Toggle a sidebar panel with F6, like the playlist
   * F6 and Screen ▸ List show the List tab, or hide the sidebar when the
   * list is already in front. `toggle` reads the player's state first:
   * it hides the position only when it is shown and this panel's tab is
   * the current one, otherwise it shows the panel.
   * ```ts
   * const list = plugin.panels.mount("sidebar", "ui/list.slint", { title: "List" });
   * plugin.commands.add({
   *   id: "list",
   *   path: ["@screen", "List"],
   *   bindings: ["F6"],
   *   // Checked while the sidebar is shown with this list in front.
   *   checked: () => (list.state?.preferred ?? false) && (list.state?.active ?? false),
   *   run: () => list.toggle(),
   * });
   * ```
   *
   * @since 1.5.2
   */
  toggle(): Promise<void>;
  /**
   * Keep the panel on screen while the user works in it.
   *
   * @remarks
   * In fullscreen the bottom bar shows only while the pointer is in the bar's
   * own band at the bottom of the screen: at once when the pointer enters it,
   * hidden 500 ms after it leaves (keys and pointer motion elsewhere do not
   * reveal it), and the fullscreen sidebar overlay collapses when the pointer
   * leaves it. A lock keeps the bar shown. Set a lock while a text field has
   * focus, a drag is in progress or a popup is open, and clear it afterwards.
   * Locks are merged with the earlier ones; the last value of each wins. The
   * player already locks a panel while the pointer is over it. No effect on the
   * backdrop.
   *
   * Never throws: a failed write is reported to {@link Scope.onError}.
   *
   * @capability ui.mount
   *
   * @param locks - The locks to change; omitted ones keep their value.
   *
   * @example Keep the bar on screen while a search field has focus
   * In fullscreen the bottom bar stays visible while the user types in
   * its search field, instead of hiding when the pointer leaves it. The
   * Slint side reports the field's focus through a callback, and
   * `setInteraction` sets or clears the `focused` lock; other locks keep
   * their values.
   * ```ts
   * const panel = plugin.panels.mount("bottom", "ui/bar.slint");
   * panel.on("searchFocused", (focused: boolean) => panel.setInteraction({ focused }));
   * ```
   *
   * @since 1.0.0
   */
  setInteraction(
    locks: Partial<{
      /** A text field (or another control taking keys) has focus. */
      focused: boolean;
      /** The user is dragging something in the panel. */
      dragging: boolean;
      /** A popup or menu of the panel is open. */
      popupOpen: boolean;
    }>,
  ): void;
  /**
   * Pop up a menu of this plugin's commands at a point in the panel.
   *
   * @remarks
   * A one-level menu, styled like the main menu (check marks, shortcut text),
   * in the window that shows the panel. Picking an item runs that command;
   * `null` is a separator. Commands without a menu `path` work too, which
   * makes context-only commands possible. Call it when the right button is
   * released, as the main menu does. Waits for {@link Panel.ready} first.
   *
   * @capability ui.mount
   *
   * @param items - At most 32 commands of this plugin, or `null` for a
   *   separator.
   * @param at - Where to open it, in the window's logical pixels: in Slint,
   *   `(self.absolute-position.x + self.mouse-x) / 1px` (and the same for
   *   `y`).
   * @returns Resolves once the menu is open (not when the user picks).
   *
   * @throws `missing` (rejects) An item is not a command of this plugin.
   * @throws `unavailable` (rejects) The panel is not on screen (also: its
   *   sidebar tab is not the current one), or it is the backdrop.
   * @throws `invalid` (rejects) No items, more than 32, or `at` is not
   *   finite.
   * @throws The errors of {@link Panel.ready} (rejects) The mount failed.
   *
   * @example Open a context menu where the user right-clicked (examples/panel-menu)
   * Right-clicking the list opens a menu with "Select the first item" and
   * "Remove the selected item". The Slint file passes the pointer position
   * in window pixels with its `context-menu` callback; `showMenu` opens the
   * plugin's commands there, and picking one runs that command.
   *
   * {@includeCode ../../../examples/panel-menu/main.ts#menu}
   *
   * @since 1.0.0
   */
  showMenu(
    items: (Command | null)[],
    at: {
      /** Logical pixels from the window's left edge. */
      x: number;
      /** Logical pixels from the window's top edge. */
      y: number;
    },
  ): Promise<void>;
  /**
   * Receive the files dropped on this panel.
   *
   * @remarks
   * Covers the docked panel and the floating sidebar window. While a listener
   * exists, drops on the panel come here as one group (not split by
   * extension) instead of going to the {@link Drops} providers. Drops on
   * tool windows and the Options window are ignored; in fullscreen, the
   * bottom bar floats over the video and drops there count as drops on the
   * video area.
   *
   * @capability ui.drop
   *
   * @param listener - Receives the paths in the order the file manager gave
   *   them, the point in panel coordinates (logical pixels from the panel's
   *   top-left corner) and the keys held.
   * @returns A handle that removes the listener.
   *
   * @example Add dropped files to a list
   * Files dropped on the Files panel are added to its list. While the
   * listener exists, drops on the panel come here as one group instead of
   * going to the drop providers; after the listener returns, the SDK runs
   * an update pass and `bind` sends the longer list.
   * ```ts
   * const files: string[] = [];
   * const panel = plugin.panels.mount("sidebar", "ui/list.slint", { title: "Files" });
   * panel.bind(() => ({ rows: files }));
   * panel.onDrop(({ paths }) => {
   *   files.push(...paths); // in the order the file manager gave them
   * });
   * ```
   *
   * @since 1.0.0
   */
  onDrop(
    listener: (event: {
      /** Absolute paths of the dropped files and folders. */
      paths: string[];
      /** Panel coordinates, logical pixels. */
      at: { x: number; y: number };
      /** The keys held while dropping. */
      modifiers: DropModifiers;
    }) => unknown,
  ): Disposable;
}

/**
 * Keys held when the files were dropped.
 *
 * @since 1.0.0
 * @category UI
 */
export interface DropModifiers {
  /** Option (macOS) / Alt (Windows). */
  readonly alt: boolean;
  /** Shift. */
  readonly shift: boolean;
  /** ⌘ on macOS, Ctrl on Windows. */
  readonly cmd: boolean;
}

/**
 * A provider for files dropped on the video area ({@link Drops.provide}).
 *
 * @see {@link Drops.provide}
 * @since 1.0.0
 * @category UI
 */
export interface DropHandler {
  /**
   * Lower case, without the dot; `"folder"` matches directories.
   * 1–64 entries of 1–16 lower-case letters or digits.
   */
  extensions: string[];
  /** The dropped paths with these extensions, in the order dropped. */
  drop(event: { paths: string[]; modifiers: DropModifiers }): unknown;
}

/**
 * `plugin.drops`: files dropped on the video area. Needs `ui.drop`.
 *
 * @remarks
 * Files dropped on the video area go to providers by extension: each
 * extension belongs to the provider registered for it first, and each
 * provider gets one call with all of its paths. Files nobody takes are
 * ignored. A panel with {@link Panel.onDrop} takes drops on itself first.
 *
 * @capability ui.drop
 *
 * @example Collect dropped CHIP-8 programs
 * `.ch8` files dropped on the player are added to the plugin's list. The
 * provider claims the extension; the player calls `drop` with the dropped
 * paths of that type, in the order the file manager gave them. Extensions
 * go to the first provider: the built-in playlist claims every audio and
 * video extension when it starts, and a built-in plugin cannot be disabled,
 * so another plugin's provider for those never gets them (except a
 * development load that replaces the playlist under its id).
 * ```ts
 * const queue: string[] = [];
 * plugin.drops.provide({
 *   extensions: ["ch8"],
 *   drop: ({ paths }) => {
 *     queue.push(...paths); // only .ch8 files reach here
 *   },
 * });
 * ```
 *
 * @see {@link Panel.onDrop}
 * @since 1.0.0
 * @category UI
 */
export interface Drops {
  /**
   * Take files dropped on the video area. The first provider registered for
   * an extension gets it; files nobody takes are ignored.
   *
   * Paths are grouped by provider (an extension, case-insensitive, belongs
   * to the provider that registered it first) in the order the file
   * manager gave them, one call per provider. Folders are not expanded.
   *
   * @throws `invalid` synchronously for malformed extensions.
   *
   * @example Load dropped subtitle files
   * Dropping .srt or .ass files on the video loads each one as a subtitle
   * track. Each extension belongs to the provider that registered it first;
   * the player groups the dropped paths by provider and calls each provider
   * once with all of its paths, so .srt and .ass files dropped together
   * arrive in one call. (A panel under the pointer that listens with
   * `onDrop` takes the whole drop first.) The plugin reads each file itself
   * and uploads its bytes with `subtitles.load`.
   * ```ts
   * import { readFile } from "node:fs/promises";
   * // ---cut---
   * plugin.drops.provide({
   *   extensions: ["srt", "ass"],
   *   drop: async ({ paths }) => {
   *     // Only .srt and .ass files reach this provider.
   *     for (const path of paths)
   *       await plugin.subtitles.load(await readFile(path), {
   *         format: path.endsWith(".ass") ? "ass" : "srt",
   *       });
   *   },
   * });
   * ```
   *
   * @capability ui.drop
   * @since 1.0.0
   */
  provide(handler: DropHandler): Disposable;
}
