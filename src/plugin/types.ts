/**
 * The plugin API types (`apiVersion: "vestra/1"`).
 *
 * A plugin module default-exports `async function activate(plugin: Plugin)`;
 * everything it creates is a handle owned by `plugin` (or a sub-scope) and is
 * released automatically when the plugin stops.
 *
 * Plugins import these names as types only. The player's runner supplies the
 * object, so a built plugin has no runtime dependency on this package.
 */
import type { Json } from "../wire.ts";
import type { AudioNode, VideoNode } from "../processing.ts";
import type { SubtitleStyle } from "../subtitles.ts";
import type { ResolvedMedia } from "../source-resolvers.ts";
import type { MediaJob } from "../media.ts";

export type { Json, AudioNode, VideoNode, SubtitleStyle, ResolvedMedia };

/**
 * Anything that owns player-side or local resources: every handle the API
 * returns (commands, windows, panels, filters, snapshots, listeners…).
 *
 * A handle belongs to the {@link Scope} that created it and is disposed with
 * that scope, so most plugins never call `dispose()` themselves. Call it to
 * release one resource early. Disposing twice is harmless, and `dispose()`
 * never rejects: failures are only written to the plugin log.
 *
 * What disposal does depends on the handle: a {@link Command} leaves the menu
 * and the binding table, a {@link Window} closes, a {@link Panel} is
 * unmounted, a {@link VideoFilter} / {@link AudioFilter} withdraws this
 * plugin's chain, a {@link Snapshot} is released, an unfinished
 * {@link ExportJob} is cancelled, a {@link Stream} stops, a {@link Resolver}
 * is unregistered (aborting resolutions in flight), a {@link JsonStore}
 * flushes, a running `tools.run` process is killed and a listener is
 * unsubscribed. A {@link Media} is the exception: disposing its scope does
 * **not** close the media; call {@link Media.close} for that.
 *
 * @example Releasing a listener early
 * ```ts
 * const subscription = plugin.player.onChange((state) => {
 *   if (state.phase === "ready") void subscription.dispose();
 * });
 * ```
 */
export interface Disposable {
  /**
   * Release the resource. Resolves once the player confirmed the release
   * (or immediately for purely local resources). Never rejects.
   */
  dispose(): Promise<void>;
}

/**
 * Every API failure is an ordinary `Error` with a stable string `code`.
 * Branch on `code`, never on `message` (the message is for logs and may
 * change).
 *
 * | code | meaning |
 * | --- | --- |
 * | `stale` | A condition no longer held (the source or the subtitle selection changed); nothing was done. See {@link Conditional}. |
 * | `staleDigest` | {@link PackageCandidate.install}: the package's files changed after it was validated; validate it again. |
 * | `capability` | The manifest does not declare the capability the call needs. |
 * | `invalid` | A bad argument (out of range, malformed, unknown id). |
 * | `missing` | The target does not exist (an empty panel position, a missing file, an unknown command). |
 * | `busy` | The player is still doing a previous call of the same kind (a dialog is open, a step is in flight). |
 * | `conflict` | Another plugin owns the resource (the sequence provider, the display layer, the backdrop, a menu path), or this plugin already uses the id (a window or command id). |
 * | `unavailable` | Not possible right now (no ready media, no user interface, fullscreen, a disabled core action). |
 * | `unsupported` | Not possible on this system, build or source (a platform gap, software rendering, a source that cannot seek, a filter on a generated stream). |
 * | `backend` | Loading or resolving failed; `message` is the backend's reason. |
 * | `failed` | The operation ran and failed (`media.ready()` load error, a non-zero `tools.run` exit, the system refused). |
 * | `replaced` | Accepted, but another source replaced it before it finished. |
 * | `ended` | {@link Media.ready}: the media already played to the end. |
 * | `noSource` | {@link MediaCapture.capture}: nothing is playing to capture. |
 * | `released`, `disposed` | A {@link Snapshot} used after `release()`; an {@link ExportJob} handle disposed while something still waited for it. |
 * | `aborted` | An `AbortSignal` fired (`error.name === "AbortError"`). |
 * | `timeout` | A time limit ran out (`openStream` start-up, `tools.run`, `system.*` after 10 s). |
 * | `stream`, `device` | `openStream`: the producer failed / the audio device is not ready. |
 * | `backend-uncertain` | The player's backend blocked a filter stage; call `retry()`. |
 * | `cleanup` | {@link PackageTrial.stop} could not confirm cleanup; call it again. |
 * | `limit` | A player-wide limit was reached (for example the number of commands). |
 * | `versionMismatch` | The package needs a newer player (`minPlayerVersion`) or another `apiVersion`. |
 * | `ui-prepare` | The player could not prepare a mounted panel or a settings page (its Slint file does not compile, a bound property is not declared, or another plugin's panel holds the slot); `message` has the diagnostics. |
 * | `ui` | The player could not apply a property to a tool window or a settings page, or could not build the Options window (a property the Slint file does not declare, a value of the wrong type); `message` has Slint's reason. |
 * | `host` | Any other failure inside the player; `message` is the player's reason. |
 * | `disabled` | The plugin is being stopped; pending requests fail with it. |
 * | `unknown`, `rejected`, `expired` | After a transport problem the SDK could not confirm the outcome (does not happen in normal operation). |
 *
 * Errors thrown by handlers the SDK invokes go to {@link Scope.onError}. A
 * rejected promise you forgot to `await` is only logged; it never crashes
 * the plugin process. Requests have no client-side timeout: the player
 * answers every request or stops the plugin.
 *
 * @example
 * ```ts
 * try {
 *   await plugin.player.seek(30);
 * } catch (error) {
 *   if ((error as PluginError).code === "stale") return; // someone else changed the source
 *   throw error;
 * }
 * ```
 */
export type PluginError = Error & {
  /** The stable failure code (see the table above). */
  code: string;
};

/**
 * A group of handles released together.
 *
 * {@link Plugin} is the root scope. Create a child with {@link Scope.scope}
 * for a feature that can be torn down on its own (a dynamic submenu, a
 * temporary window and its listeners). Both have exactly the same modules;
 * a handle created through a child belongs only to that child, and
 * `child.dispose()` releases its handles and deeper children in reverse
 * creation order.
 *
 * Capabilities: each module documents the manifest capability it needs.
 * Reading {@link Scope.window}, {@link Scope.app}, {@link Scope.appearance}
 * `.theme`, {@link Scope.ui}, {@link Scope.tools}, {@link Scope.storage} and
 * {@link Scope.system} needs none.
 *
 * @example Rebuilding a dynamic submenu with a child scope
 * ```ts
 * let tracks = plugin.scope();
 * plugin.subtitles.onChange(async (state) => {
 *   await tracks.dispose(); // removes the previous menu items
 *   tracks = plugin.scope();
 *   state.tracks.forEach((track, i) =>
 *     tracks.commands.add({
 *       id: `track.${i}`,
 *       path: ["Subtitles", "Track", track.title],
 *       order: 300 + i,
 *       radio: true,
 *       checked: () => plugin.subtitles.state?.selected?.id === track.id,
 *       run: () => plugin.subtitles.select(track),
 *     }),
 *   );
 * });
 * ```
 */
export interface Scope extends Disposable {
  /** Menu commands and their default bindings (`commands`). */
  readonly commands: Commands;
  /** Tool windows from `.slint` files (`ui.window`). */
  readonly windows: Windows;
  /** Docked panels: bottom bar, sidebar and backdrop (`ui.mount`). */
  readonly panels: Panels;
  /** Native file dialogs and confirmation alerts (`ui.dialog`). */
  readonly dialogs: Dialogs;
  /** Playback state and controls (`playback.read`, `events`, `playback.control`). */
  readonly player: Player;
  /**
   * Video processing: this plugin's filter chain, the display layer and the
   * GPU render options. All three need `processing.video` and
   * `playback.read`; the filter chain also needs `events` (without it the
   * SDK never sees the media become ready and the chain stays `waiting`).
   */
  readonly video: {
    /**
     * This plugin's video filter chain named `id` (unique within the
     * plugin). Nothing is sent until the first `set()`.
     *
     * @param id - Local name of the chain.
     * @returns A {@link VideoFilter} owned by this scope.
     */
    filter(id: string): VideoFilter;
    /**
     * The display layer (needs `processing.video`). The first plugin to call
     * it owns the layer; another plugin's view fails with `conflict` until the
     * owner disposes or stops. A second call in the same plugin throws.
     */
    view(): VideoView;
    /**
     * The GPU renderer's options (needs `processing.video`), owned like the
     * display layer. `failed` with `unsupported` under software rendering.
     */
    render(): RenderOptions;
  };
  /**
   * Audio processing: this plugin's filter chain and delay
   * (`processing.audio`, `playback.read` and `events`, as for
   * {@link VideoFilter}).
   */
  readonly audio: {
    /**
     * This plugin's audio filter chain named `id` (unique within the
     * plugin). Nothing is sent until the first `set()`.
     *
     * @param id - Local name of the chain.
     * @returns An {@link AudioFilter} owned by this scope.
     */
    filter(id: string): AudioFilter;
  };
  /** Subtitle tracks, uploads and style (`subtitles.read`, `subtitles.control`). */
  readonly subtitles: Subtitles;
  /** Frozen snapshots and offline exports (`media.read`, `media.control`). */
  readonly media: MediaCapture;
  /** Page-URL to stream-URL resolvers (`source.resolve`). */
  readonly resolvers: Resolvers;
  /** The installed plugins; validation, trials, installs (`plugins.manage` for changes). */
  readonly packages: Packages;
  /** On-screen messages over the video (`ui.osd`). */
  readonly osd: Osd;
  /** The player's own core playback actions (`commands`). */
  readonly host: Host;
  /** The system clipboard (`clipboard`). */
  readonly clipboard: Clipboard;
  /** Keeping the computer awake while playing (`playback.control`). */
  readonly power: Power;
  /** ffmpeg / ffprobe, run by this plugin's process. */
  readonly tools: Tools;
  /** JSON settings files in `dataDirectory`. */
  readonly storage: Storage;
  /** Show files in the file manager, open files and links. */
  readonly system: System;
  /** Small secrets in the system's secret store (`secrets`). */
  readonly secrets: Secrets;
  /** The main window: fullscreen, video area, size, level, pointer hiding. */
  readonly window: MainWindow;
  /** The player's version and components, and the system it runs on. */
  readonly app: App;
  /** Every command's bindings and the user's overrides (`bindings.manage`). */
  readonly bindings: Bindings;
  /** Runtime images for Slint `image` properties. */
  readonly ui: Ui;
  /** Marks on the seek bar, merged from every plugin's layer. */
  readonly timeline: Timeline;
  /** Files dropped on the video area, by extension (`ui.drop`). */
  readonly drops: Drops;
  /** The player's palette. */
  readonly appearance: Appearance;
  /** Pages in the player's options window (`ui.settings`). */
  readonly settings: Settings;
  /**
   * A child scope; disposing it releases only what was created through it.
   * The child is itself owned by this scope.
   */
  scope(): Scope;
  /**
   * Adopt an existing handle: it is disposed together with this scope.
   *
   * @param item - Any {@link Disposable}, for example a handle created
   *   through another scope.
   * @returns `item` itself, for chaining.
   */
  add<T extends Disposable>(item: T): T;
  /**
   * Run `cleanup` when this scope is disposed (for example `clearInterval`
   * or closing a socket). It may be async; errors are logged.
   *
   * @returns A handle that cancels the registration early (without
   *   running `cleanup`).
   *
   * @example
   * ```ts
   * const timer = setInterval(() => plugin.update(), 1000);
   * plugin.onDispose(() => clearInterval(timer));
   * ```
   */
  onDispose(cleanup: () => void | Promise<void>): Disposable;
  /**
   * Errors thrown by handlers that the SDK invoked (command `run`, window and
   * panel callbacks, `onChange` listeners) in this scope. Without a listener
   * they go to the parent scope, and finally to the plugin log.
   *
   * Rejections of async handlers count too, and so do failures of
   * registrations made after activation (a command whose `ready` rejects,
   * a property write the player refused).
   *
   * @example
   * ```ts
   * plugin.onError((error) => {
   *   void plugin.osd.show(`Bookmarks: ${error.message}`);
   * });
   * ```
   */
  onError(listener: (error: PluginError) => void): Disposable;
  /**
   * Re-evaluate every bound value (`bind()` functions and command state
   * functions) and send what changed. The SDK already does this after each
   * handler it invokes and when that handler's promise settles; call it after
   * changing state from your own timers or between awaits of a long task.
   *
   * Several calls within one microtask are merged into one pass.
   */
  update(): void;
}

/**
 * The object the player passes to a plugin's `activate`: the root
 * {@link Scope}, plus the plugin's identity and data directory.
 *
 * Activation: the player starts one Node process per plugin, reads the
 * initial player, window and timeline state, then calls `activate(plugin)`.
 * Registrations started during activation (commands, panels, resolvers,
 * subscriptions) do not need to be awaited: the plugin is reported ready
 * once they all succeed, and activation fails if `activate` throws or any
 * of them fails. The entry module must **default-export** `activate`.
 *
 * Stopping: the player first revokes everything the plugin owns on its side
 * (menus, windows, panels, filters, subtitle layers, snapshots, jobs,
 * resolvers, streams); pending requests then fail with `disabled` and the
 * root scope is disposed for local cleanup (timers, signals, sockets). A
 * process that has not exited after 300 ms is killed. Media the plugin
 * opened with {@link Player.open} keeps playing.
 *
 * @example A minimal plugin: main.ts, with capabilities commands and ui.osd
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 *
 * export default async function activate(plugin: Plugin) {
 *   plugin.commands.add({
 *     id: "hello",
 *     path: ["Tools", "Say hello"],
 *     bindings: ["Ctrl+H"],
 *     run: () => plugin.osd.show(`Hello from ${plugin.id}`),
 *   });
 * }
 * ```
 */
export interface Plugin extends Scope {
  /** The manifest id, e.g. `"community.bookmark"`. */
  readonly id: string;
  /**
   * A writable directory for this plugin's own files (settings, remembered
   * folders). Kept across restarts, disabling and upgrades; a trial gets a
   * temporary one. Write files atomically: to a temporary name, then rename.
   * Throws `unavailable` when the player provided none.
   *
   * Location: `~/Library/Application Support/Vestra/plugin-data/<id>/` on
   * macOS, `%APPDATA%\Vestra\plugin-data\<id>\` on Windows (the environment
   * variable `VESTRA_PLUGIN_DATA` moves the root). Another plugin's data
   * directory is `join(dirname(plugin.dataDirectory), id)`. It is deleted
   * only by `packages.uninstall(id, { removeData: true })`. No capability.
   * For JSON settings prefer {@link Scope.storage}.
   */
  readonly dataDirectory: string;
}

// ---------------------------------------------------------------- commands

/** The state of a command's menu item, as the player shows it. */
export interface CommandState {
  /** False greys the item out; the player then never calls `run` (bound keys are swallowed). Default true. */
  enabled: boolean;
  /** `null` means the menu item has no check mark. */
  checked: boolean | null;
  /** Shown as busy; like `enabled: false`, the player does not call `run`. Default false. */
  busy: boolean;
  /** Shown when the command is disabled or busy. */
  reason: string | null;
}

/**
 * A value, or a function the SDK re-evaluates on every update pass (see
 * {@link Scope.update}); only changes are sent to the player.
 *
 * @example
 * ```ts
 * plugin.commands.add({
 *   id: "loop",
 *   path: ["Playback", "Loop"],
 *   checked: () => plugin.player.state.loop != null, // re-evaluated
 *   enabled: true, // a fixed value
 *   run: () => plugin.player.setLoop(null),
 * });
 * ```
 */
export type Bindable<T> = T | (() => T);

/**
 * A built-in top-level menu of the player, named in a command path as
 * `@<id>` (see {@link CommandOptions.path}): Open (打开), Playback (播放),
 * Subtitles (字幕), Video (视频), Audio (声音), Screen (屏幕), Settings (设置).
 * The list is `MENU_IDS` in `@vestra-player/sdk/testing`.
 */
export type MenuId =
  "open" | "playback" | "subtitles" | "video" | "audio" | "screen" | "settings";

/**
 * The declaration passed to {@link Commands.add}.
 *
 * Menu order: siblings sort by `order` ascending; a submenu sits where its
 * first command sits and takes that command's `group`. Equal orders sort by
 * plugin id, then declaration order, never by title. `group` only draws
 * separators, so keep a group's orders contiguous. Recommended top-level
 * ranges: `open` 100–199, `domain` 200–699 (playback, subtitles, video,
 * audio…), `screen` 700–799, `windows` 800–899, `exit` 900–999.
 *
 * {@link Commands.add} throws `invalid` synchronously for a bad path,
 * order, group or binding. The same path registered twice, or a path that
 * is both an item and a submenu, fails with `conflict` (through `ready`).
 */
export interface CommandOptions {
  /** Local id, unique within the plugin (the global id is `<manifest id>/<id>`). */
  id: string;
  /**
   * Menu path including the leaf, 1–8 segments, e.g. `["@video", "Adjust picture…"]`;
   * one segment is a top-level item. Omit it for a command that is not in the
   * main menu (bindings and panel menus only); `title` is then required.
   *
   * Segments are menu titles, matched exactly. The player's own menus have
   * Chinese titles, so `["Video", "Blur"]` would add a second top-level menu
   * "Video". To join a built-in menu, start the path with its id, `@` plus a
   * {@link MenuId}: `@open`, `@playback`, `@subtitles`, `@video`, `@audio`,
   * `@screen` or `@settings`. Only the first segment is read as an id; an
   * unknown id, or an id with nothing after it, fails with `invalid`. Needs
   * player 0.3.0 (set `"minPlayerVersion": "0.3.0"`).
   *
   * @example
   * ```ts
   * plugin.commands.add({ id: "blur", path: ["@video", "Blur"], run: toggle });
   * ```
   */
  path?: string[];
  /** Menu label; defaults to the last path segment. */
  title?: string;
  /**
   * Sibling order in the menu, ascending (integer, default 0). A submenu sits
   * where its first command sits. Equal orders: plugin id, then declaration order.
   * Range ±1,000,000.
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
   * `NumpadDivide`, `NumpadEnter`, `NumpadDecimal`, and the video-area mouse
   * inputs `Mouse:LeftClick`, `Mouse:LeftDoubleClick[:LeftHalf|:RightHalf]`,
   * `Mouse:MiddleClick`, `Mouse:X1`, `Mouse:X2`, `Mouse:WheelUp`/`Down`/`Left`/`Right`.
   *
   * Platforms: on macOS `Ctrl+X` fires for both ⌃X and ⌘X while `Cmd+X`
   * means ⌘X only; on Windows `Cmd` is the Windows logo key, so write
   * `Ctrl+…` for bindings that work on both. Avoid keys the system takes
   * first (⌃F1–⌃F8, ⌃Arrow keys, ⌘Tab on macOS).
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
  /** Whether the command can run (default true). */
  enabled?: Bindable<boolean>;
  /** Check mark (or radio dot with `radio`); `null` (default) draws none. */
  checked?: Bindable<boolean | null>;
  /** Busy state (default false); the player does not call `run` while busy. */
  busy?: Bindable<boolean>;
  /** Why the command is disabled or busy (shown to the user). */
  reason?: Bindable<string | null>;
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
 */
export interface Command extends Disposable {
  /** The local id given in {@link CommandOptions.id}. */
  readonly id: string;
  /**
   * Replace some state fields (values or functions). Last write wins.
   *
   * @example
   * ```ts
   * exportCommand.set({ busy: true, reason: "Exporting…" });
   * ```
   */
  set(
    state: Partial<{ [K in keyof CommandState]: Bindable<CommandState[K]> }>,
  ): void;
  /**
   * Resolves when the host has registered the command. Rejects with
   * `conflict` (path already taken), `invalid` or `limit` (more than 160
   * commands in this plugin, or 1024 in the whole player). You rarely need
   * to await it: during activation a failure fails activation, later it
   * goes to {@link Scope.onError}.
   */
  readonly ready: Promise<void>;
}

/** `plugin.commands`: menu commands with default bindings. Needs `commands`. */
export interface Commands {
  /**
   * Declare a command. It is registered and kept in sync; `dispose()` removes
   * it from the menu and the binding table, and the id may be added again.
   *
   * Titles and paths cannot change in place: put changing items (track
   * lists, presets) in a child {@link Scope} and rebuild it.
   *
   * @throws `invalid` synchronously for a malformed path (including an
   *   unknown `@` menu id), order, group or binding; `conflict` for an id this
   *   plugin has already declared and not disposed.
   *
   * @example
   * ```ts
   * const toggle = plugin.commands.add({
   *   id: "toggle-pause",
   *   path: ["Playback", "Pause"],
   *   order: 210,
   *   bindings: ["Ctrl+P"],
   *   enabled: () => plugin.player.state.can.pause,
   *   checked: () => plugin.player.state.paused,
   *   run: () => plugin.player.setPaused(!plugin.player.state.paused),
   * });
   * ```
   */
  add(options: CommandOptions): Command;
}

// ---------------------------------------------------------------- windows and panels

/**
 * An image file for a Slint `image` property, made by {@link Ui.image}.
 *
 * @remarks
 * Opaque: pass it as the **whole** value of an `image` property with
 * {@link View.set} or {@link View.bind}; it cannot sit inside a struct or an
 * array. Making the reference does not read the file: the player checks and
 * decodes it each time a view uses it ({@link Ui.image} has the rules and
 * limits).
 *
 * A reference belongs to the {@link Scope} that created it. Once that scope
 * is disposed, writing the reference fails with `invalid` (reported to
 * {@link Scope.onError}); an image already on screen stays until the
 * property changes or the view closes.
 *
 * @example Show a cover image from the data directory
 * ```ts
 * const cover = plugin.windows.create("ui/cover.slint");
 * cover.set({ art: plugin.ui.image(`${plugin.dataDirectory}/cover.png`) });
 * await cover.show();
 * ```
 *
 * @see {@link Ui.image}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
 * @since 1.0.0
 * @category UI
 */
export interface ImageRef {
  /** The path given to {@link Ui.image}, unchanged. */
  readonly path: string;
  /** Brand that marks the value as an image reference; never construct one yourself. */
  readonly __vestraImage: true;
}

/**
 * A Markdown document for `MarkdownView`, made by {@link Ui.markdown}.
 *
 * @remarks
 * Opaque, like {@link ImageRef}: pass it as the whole value of a
 * `[MarkdownBlock]` property (the `blocks` of `MarkdownView` from
 * `@vestra/markdown.slint`). It carries the text, the base address and the
 * local copies of its remote images; the player parses and draws it. It
 * belongs to the scope that created it: once that scope is disposed, writing
 * it fails with `invalid`.
 *
 * @player 0.2.0
 * @see {@link Ui.markdown}, {@link MarkdownOptions}
 * @since 1.1.0
 * @category UI
 */
export interface MarkdownRef {
  /** The Markdown text, as given to {@link Ui.markdown}. */
  readonly text: string;
  /** Brand that marks the value as a Markdown document; never construct one yourself. */
  readonly __vestraMarkdown: true;
}

/**
 * Options of {@link Ui.markdown}: where relative links and images point, and
 * whether remote images are downloaded.
 *
 * @since 1.1.0
 * @category UI
 */
export interface MarkdownOptions {
  /**
   * What relative links and images resolve against: an `http:` or `https:`
   * address (such as the document's own URL) or an absolute directory.
   * Without it, relative links are reported as written and relative images
   * show their alt text.
   */
  base?: string;
  /**
   * Download `https:` images into the data directory. Off: they show their
   * alt text, and the call makes no network requests.
   *
   * @defaultValue `true`
   */
  remoteImages?: boolean;
}

/**
 * The value of one Slint property: JSON, or an image or a Markdown document
 * as the whole value of a property.
 *
 * @remarks
 * JSON becomes Slint values as you would expect: booleans for `bool`,
 * finite numbers for `int` and `float`, strings for `string`, arrays for
 * models (`[T]`), objects for structs. Struct field names are passed
 * unchanged, so write them as the Slint file spells them; a name with `_`
 * is refused (Slint treats `_` and `-` as the same, so use camelCase or
 * kebab-case).
 *
 * Limits per value: nesting depth 8, 4096 values in total, 1024 rows per
 * array, 64 KiB per string and 1 MiB of text in total. A value over a limit
 * is a failed write (see {@link View}).
 *
 * @since 1.0.0
 * @category UI
 */
export type PropValue = Json | ImageRef | MarkdownRef;

/**
 * Properties to write to a view, by name.
 *
 * @remarks
 * Names may be camelCase: the SDK turns every capital letter into `-` plus
 * the lower-case letter (`canMark` → `can-mark`); names already in
 * kebab-case are kept. Only the property names are converted, not the
 * fields of struct values.
 *
 * @example
 * ```ts
 * const props: Props = { canMark: true, rows: [{ rowId: "a", title: "First" }] };
 * ```
 *
 * @since 1.0.0
 * @category UI
 */
export type Props = Record<string, PropValue>;

/**
 * Values for Slint properties that are not plain JSON: images from files and
 * Markdown documents. `plugin.ui`.
 *
 * @remarks
 * A Slint file can only name images compiled into it (`@image-url`). To show
 * an image the plugin picks at run time (cover art, a thumbnail it rendered,
 * a downloaded icon), make an {@link ImageRef} with {@link Ui.image} and
 * write it to an `image` property. To show formatted text, make a
 * {@link MarkdownRef} with {@link Ui.markdown} and give it to `MarkdownView`.
 * Both work in tool windows, panels (the backdrop and the floating sidebar
 * included) and settings pages.
 *
 * @capability None.
 *
 * @example A window that shows a Markdown file (examples/markdown)
 * {@includeCode ../../examples/markdown/main.ts#document}
 *
 * `ui/document.slint`:
 *
 * {@includeCode ../../examples/markdown/ui/document.slint}
 *
 * @see {@link ImageRef}, {@link MarkdownRef}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
 * @since 1.0.0
 * @category UI
 */
export interface Ui {
  /**
   * Reference a PNG or JPEG file for an `image` property.
   *
   * @remarks
   * Returns at once without touching the file. The player checks the file
   * each time a view uses the reference (a property write, a window opening,
   * the main window being rebuilt): it must be inside this plugin's package
   * directory or {@link Plugin.dataDirectory} after following links, at most
   * 16 MB and 4096×4096 pixels, and PNG or JPEG by content (the extension
   * does not matter). A failed check is a failed property write: `missing`
   * for a file that does not exist, `invalid` otherwise. It goes to
   * {@link Scope.onError} and the property keeps its previous image; in the
   * initial properties of a tool window it makes {@link Window.show} reject.
   *
   * The player caches decoded images per plugin (up to 64 MB, least recently
   * used first) and does not watch files. Every call returns a new value, so
   * after rewriting a file under the same path, call `image()` again and
   * write the new reference.
   *
   * @capability None.
   *
   * @param path - Absolute path of the image file, inside the package
   *   directory or the data directory.
   * @returns A new {@link ImageRef}, owned by this scope.
   *
   * @throws `invalid` (throws) `path` is not a non-empty string.
   *
   * @example Show a thumbnail the plugin rendered
   * ```ts
   * const window = plugin.windows.create("ui/thumbnail.slint");
   * const file = `${plugin.dataDirectory}/thumbnail.png`;
   * // … write the PNG to `file` (for example with plugin.tools.run("ffmpeg", …)) …
   * window.set({ thumbnail: plugin.ui.image(file) });
   * await window.show();
   * ```
   *
   * @since 1.0.0
   */
  image(path: string): ImageRef;
  /**
   * Prepare a Markdown document for `MarkdownView` (`@vestra/markdown.slint`).
   *
   * @remarks
   * The player renders headings, paragraphs (bold, italic, strikethrough,
   * inline code, links), lists and task lists, code blocks, block quotes,
   * images, tables and rules; embedded HTML is not shown. A click on a link
   * calls the view's `link-clicked(url)` callback with the address resolved
   * against `base`; opening it is up to the plugin (for example with
   * {@link System.openUrl}).
   *
   * Images: PNG or JPEG. Local ones follow {@link Ui.image}'s rules (this
   * plugin's package or data directory). `https:` images are downloaded by
   * this call into `<dataDirectory>/.vestra-cache/markdown/` (each at most
   * 4 MB and 10 s, at most 64 per document; the cache keeps 32 MB and fetches
   * an address again after 24 hours). A failed or unsupported image (SVG,
   * GIF, `http:`…) shows its alt text; the call itself does not fail for it.
   *
   * The text is at most 256 KB; very long documents are cut off after 4000
   * blocks.
   *
   * @capability None.
   * @player 0.2.0 (set `"minPlayerVersion": "0.2.0"` in the manifest)
   *
   * @param text - The Markdown source (CommonMark with GitHub tables, task
   *   lists and strikethrough), at most 256 KB as UTF-8.
   * @param options - Where relative addresses point and whether to download
   *   remote images.
   * @returns The document, owned by this scope, once its remote images are
   *   downloaded (or have failed).
   *
   * @throws `invalid` (rejects) `text` is not a string or is over 256 KB, or
   *   `base` is neither an `http(s):` address nor an absolute path.
   * @throws `unsupported` (rejects) The player is older than 0.2.0.
   *
   * @example Show a README from the web
   * ```ts
   * const readmeUrl = "https://example.com/plugin/README.md";
   * const text = await (await fetch(readmeUrl)).text();
   * const window = plugin.windows.create("ui/readme.slint");
   * window.on("openLink", (url: string) => plugin.system.openUrl(url));
   * window.set({ doc: await plugin.ui.markdown(text, { base: readmeUrl }) });
   * await window.show();
   * ```
   *
   * @since 1.1.0
   */
  markdown(text: string, options?: MarkdownOptions): Promise<MarkdownRef>;
}

/**
 * The surface that tool windows, panels and settings pages share: properties
 * out to Slint, callbacks in from Slint.
 *
 * @remarks
 * The plugin's TypeScript and its Slint files run in different processes and
 * exchange two kinds of messages. Plugin → UI: `in` and `in-out` properties,
 * written with {@link View.set} or kept up to date with {@link View.bind}.
 * UI → plugin: Slint callbacks (returning nothing), handled with
 * {@link View.on}. A {@link Window} declares them on its exported component;
 * a {@link Panel} and a {@link SettingsPage} declare them on the file's
 * exported global, the bridge. The plugin cannot call Slint functions or read
 * a property back: a value the user changes reaches it only through a
 * callback.
 *
 * `bind` is the usual way: the SDK re-evaluates bound functions in every
 * update pass (after each handler it calls, after player state changes, on
 * {@link Scope.update}) and sends only what changed, at most one write in
 * flight per view. `set` sends now, even an unchanged value.
 *
 * Writes that fail (a name the Slint file does not declare, a value of the
 * wrong type, an image that fails its check): a bound value is not sent
 * again until it changes; a `set` value is retried with back-off (0.25 s,
 * doubling up to 30 s); the first failure of a series is reported to
 * {@link Scope.onError}.
 *
 * A control whose value both the user and the plugin change needs a two-way
 * binding to an `in-out` property (`value <=> root.level`). A one-way
 * binding (`value: root.level`) is broken by Slint the first time the user
 * moves the control.
 *
 * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
 *
 * @example A window with a label, two buttons and their callbacks (examples/bookmark)
 * {@includeCode ../../examples/bookmark/main.ts#window}
 *
 * `ui/bookmark.slint`:
 *
 * {@includeCode ../../examples/bookmark/ui/bookmark.slint}
 *
 * @see {@link Window}, {@link Panel}, {@link SettingsPage}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md), [Keep a slider responsive while dragging](../../docs/how-to/slider.md)
 * @since 1.0.0
 * @category UI
 */
export interface View {
  /**
   * Handle a Slint callback.
   *
   * @remarks
   * The handler receives the callback's arguments as JSON (struct fields
   * spelled as in Slint). It may be async. An error it throws, or a rejection
   * of its promise, goes to {@link Scope.onError}. After it returns, and
   * again when its promise settles, the SDK runs an update pass, so state it
   * changed reaches bound properties without further calls (state changed
   * after an `await` appears only when the promise settles; call
   * {@link Scope.update} to show it earlier).
   *
   * Calling `on` again with the same name replaces the handler. A callback
   * the plugin has no handler for is ignored.
   *
   * **Tool windows** forward only the callback names bound when the window
   * opens: bind every name before the first {@link Window.show}. While the
   * window is open, binding a new name throws; after a close the next `show`
   * registers the names bound by then. A name the Slint file does not declare
   * makes `show` reject. **Panels and settings pages** forward every
   * callback of their bridge global, so bind whenever you like.
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param callback - The Slint callback's name, in camelCase
   *   (`toggleEffect`) or as written in Slint (`toggle-effect`).
   * @param handler - Receives the callback's arguments.
   * @returns A handle that removes this handler (if it is still the current
   *   one for the name).
   *
   * @throws `Error` without a code (throws) On an open {@link Window}, for a
   *   name that has no handler yet.
   *
   * @example
   * ```ts
   * const picture = plugin.windows.create("ui/picture.slint");
   * let brightness = 0;
   * picture.on("brightnessChanged", (value: number) => {
   *   brightness = value;
   * });
   * picture.bind(() => ({ brightness }));
   * await picture.show();
   * ```
   *
   * @since 1.0.0
   */
  on<A extends Json[]>(
    callback: string,
    handler: (...args: A) => unknown,
  ): Disposable;
  /**
   * Write properties now, even values that did not change.
   *
   * @remarks
   * Each value given is sent once with the next write, even if it equals the
   * last value sent. That makes `set` the way to pull a control back to the
   * model value after the user moved it, or to put a one-off value (a
   * document, an image) on screen. While the view is not open (a window
   * before `show`, a panel before `ready`) the values are kept and become its
   * initial properties.
   *
   * Do not `set` a property that a {@link View.bind} function also returns:
   * the next update pass replaces the set value with the bound one.
   *
   * Never throws. A write that fails is retried with back-off and reported
   * to {@link Scope.onError}.
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param props - Properties by name; see {@link Props}.
   *
   * @example Put a drop-down back when the user picks an entry the plugin refuses
   * ```ts
   * const window = plugin.windows.create("ui/presets.slint");
   * let presetIndex = 0;
   * window.on("presetChosen", (index: number) => {
   *   if (index > 2) window.set({ presetIndex }); // "Custom" is not a preset
   *   else presetIndex = index;
   * });
   * ```
   *
   * @since 1.0.0
   */
  set(props: Props): void;
  /**
   * Keep properties equal to a function of the plugin's state.
   *
   * @remarks
   * The SDK calls `props` in every update pass (and right after `bind`) and
   * sends the values that differ from the ones it sent last. Because an
   * unchanged value is not sent again, text the user typed into an `in-out`
   * property stays until the plugin's value for it changes.
   *
   * Keep the function quick and synchronous: it runs often. An error it
   * throws is reported to {@link Scope.onError} and the other bindings still
   * run. A view can have several bindings; when two return the same name,
   * the one bound later wins.
   *
   * Never throws. Writes that fail are not repeated until the value changes.
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param props - Returns the properties, by name.
   * @returns A handle that stops this binding (the values last sent stay).
   *
   * @example
   * ```ts
   * const status = plugin.windows.create("ui/status.slint");
   * status.bind(() => ({
   *   title: plugin.player.state.source ?? "Nothing playing",
   *   canSeek: plugin.player.state.can.seek,
   * }));
   * ```
   *
   * @see [Keep a slider responsive while dragging](../../docs/how-to/slider.md)
   * @since 1.0.0
   */
  bind(props: () => Props): Disposable;
}

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
 * 4. {@link Window.close}, or the user (title-bar button; ⌘W on macOS,
 *    Ctrl+W or Ctrl+F4 on Windows), destroys the window instance; only the
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
 * @example A menu command that opens a window (examples/bookmark)
 * {@includeCode ../../examples/bookmark/main.ts#window,command}
 *
 * @example Stop work when the user closes the window
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
 *     timer ??= setInterval(() => plugin.update(), 1000);
 *   },
 * });
 * ```
 *
 * @see {@link Windows.create}, {@link View}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md), [Remember a window's state between runs](../../docs/how-to/window-state.md)
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
   * ```ts
   * const window = plugin.windows.create("ui/inspector.slint");
   * try {
   *   await window.show();
   * } catch (error) {
   *   await plugin.osd.show(`Cannot open the inspector (${(error as PluginError).code})`);
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
   * @example A command that shows and hides a window
   * ```ts
   * const levels = plugin.windows.create("ui/levels.slint");
   * let visible = false;
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
   * Called for the title-bar close button and the standard close keys (⌘W
   * on macOS, Ctrl+W or Ctrl+F4 on Windows). When it runs, the window
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
   * @example Remember that the user closed it
   * ```ts
   * const store = plugin.storage.json("window", { defaults: { open: false } });
   * const window = plugin.windows.create("ui/notes.slint");
   * window.onClose(() => store.save({ open: false }));
   * ```
   *
   * @see [Remember a window's state between runs](../../docs/how-to/window-state.md)
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
 * @example
 * {@includeCode ../../examples/bookmark/main.ts#window,command}
 *
 * @see {@link Window}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
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
   * @throws `conflict` (throws) This plugin already has a window with this id
   *   (SDK 1.3.0; before, a plain `Error` without `code`).
   *
   * @example One file, two windows
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
   * - `idle`: the bottom bar in fullscreen, hidden after 3 seconds without
   *   activity.
   */
  reason: "userHidden" | "space" | "fullscreen" | "idle" | null;
  /** The sidebar floats in its own window; always `false` for the bottom bar. */
  detached: boolean;
}

/**
 * The bottom bar or the sidebar position (`plugin.panels.bottom`,
 * `plugin.panels.sidebar`), independent of who mounted the panel there.
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
 * @example A "Show sidebar" menu item that works with any sidebar panel (examples/core-ui)
 * {@includeCode ../../examples/core-ui/main.ts#sidebar}
 *
 * @see {@link Panels}, {@link SlotState}
 * @since 1.0.0
 * @category UI
 */
export interface PanelSlot {
  /** The current state; `null` while no plugin has a panel there (or without `ui.mount`). */
  readonly state: SlotState | null;
  /**
   * Run code when the position's state changes.
   *
   * @remarks
   * Needs `events`: without it the listener runs only after this plugin's own
   * changes. Called with `null` when the panel there is unmounted. Errors go
   * to {@link Scope.onError}.
   *
   * @capability ui.mount and events
   *
   * @param listener - Receives the new state.
   * @returns A handle that removes the listener.
   *
   * @example
   * ```ts
   * plugin.panels.sidebar.onChange((state) => {
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
   * @example
   * ```ts
   * await plugin.panels.bottom.setVisible(false);
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
   * `events`.
   *
   * @capability ui.mount
   *
   * @returns Resolves once the layout has the new preference.
   *
   * @throws `missing` (rejects) No panel is mounted at this position.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.mount`.
   *
   * @example
   * ```ts
   * plugin.commands.add({
   *   id: "toggle-bar",
   *   path: ["@screen", "Control bar"],
   *   checked: () => plugin.panels.bottom.state?.preferred ?? false,
   *   run: () => plugin.panels.bottom.toggle(),
   * });
   * ```
   *
   * @since 1.0.0
   */
  toggle(): Promise<void>;
}

/**
 * The sidebar position: a {@link PanelSlot} that can also float in a window
 * of its own.
 *
 * @remarks
 * Detached, the sidebar panel is shown in a separate window (300×408 by
 * default, at least 300×250) with the panel's `title`. The plugin's
 * properties and callbacks stay the same, but the window holds a new
 * instance of the component. Closing the floating window (its close button,
 * ⌘W, Ctrl+W, Ctrl+F4) is the same as `setVisible(false)`.
 *
 * @capability ui.mount
 *
 * @example
 * {@includeCode ../../examples/core-ui/main.ts#sidebar}
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
   * @example
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
 * @example A sidebar list with a right-click menu (examples/panel-menu)
 * {@includeCode ../../examples/panel-menu/main.ts#mount,menu}
 *
 * `ui/panel.slint`:
 *
 * {@includeCode ../../examples/panel-menu/ui/panel.slint}
 *
 * @see {@link Panels.mount}, {@link PanelSlot}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
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
   * ready: a rejection fails activation. Later failures also go to
   * {@link Scope.onError}.
   *
   * @throws `ui-prepare` (rejects) The Slint file does not compile, or a
   *   bound property is not declared on the bridge global; `message` has the
   *   diagnostics. Also when another plugin's panel already occupies the
   *   bottom bar or the sidebar.
   * @throws `conflict` (rejects) Another plugin shows the backdrop.
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
   * Keep the panel on screen while the user works in it.
   *
   * @remarks
   * The bottom bar hides after 3 seconds without activity in fullscreen, and
   * the fullscreen sidebar overlay collapses when the pointer leaves it. Set a
   * lock while a text field has focus, a drag is in progress or a popup is
   * open, and clear it afterwards. Locks are merged with the earlier ones;
   * the last value of each wins. The player already locks a panel while the
   * pointer is over it. No effect on the backdrop.
   *
   * Never throws: a failed write is reported to {@link Scope.onError}.
   *
   * @capability ui.mount
   *
   * @param locks - The locks to change; omitted ones keep their value.
   *
   * @example Keep the bar while a search field has focus
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
   * @throws `unavailable` (rejects) The panel is not on screen, or it is the
   *   backdrop.
   * @throws `invalid` (rejects) No items, more than 32, or `at` is not
   *   finite.
   * @throws The errors of {@link Panel.ready} (rejects) The mount failed.
   *
   * @example
   * {@includeCode ../../examples/panel-menu/main.ts#menu}
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
   * ```ts
   * const files: string[] = [];
   * const panel = plugin.panels.mount("sidebar", "ui/list.slint", { title: "Files" });
   * panel.bind(() => ({ rows: files }));
   * panel.onDrop(({ paths }) => {
   *   files.push(...paths);
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

/** Keys held when the files were dropped. */
export interface DropModifiers {
  /** Option (macOS) / Alt (Windows). */
  readonly alt: boolean;
  /** Shift. */
  readonly shift: boolean;
  /** ⌘ on macOS, Ctrl on Windows. */
  readonly cmd: boolean;
}

/** A provider for files dropped on the video area ({@link Drops.provide}). */
export interface DropHandler {
  /**
   * Lower case, without the dot; `"folder"` matches directories.
   * 1–64 entries of 1–16 lower-case letters or digits.
   */
  extensions: string[];
  /** The dropped paths with these extensions, in the order dropped. */
  drop(event: { paths: string[]; modifiers: DropModifiers }): unknown;
}

/** `plugin.drops`: files dropped on the video area. Needs `ui.drop`. */
export interface Drops {
  /**
   * Take files dropped on the video area. The first provider registered for
   * an extension gets it; files nobody takes are ignored.
   *
   * Paths are grouped by extension (case-insensitive) in the order the file
   * manager gave them, one call per provider. Folders are not expanded.
   *
   * @throws `invalid` synchronously for malformed extensions.
   *
   * @example
   * ```ts
   * plugin.drops.provide({
   *   extensions: ["srt", "ass"],
   *   drop: async ({ paths }) => {
   *     for (const path of paths)
   *       await plugin.subtitles.load(await readFile(path), {
   *         format: path.endsWith(".ass") ? "ass" : "srt",
   *       });
   *   },
   * });
   * ```
   */
  provide(handler: DropHandler): Disposable;
}

/**
 * The player's palettes. Today there is one, `vestra` (the default); a later
 * version may add more (a light palette, for example), so read colours from
 * `Theme` instead of branching on the id.
 *
 * @remarks
 * SDK 1.4.0 removed a second palette that earlier versions listed. The player
 * treats an id it does not have as `vestra`, so plugins built with an older
 * SDK that still ask for it keep working.
 *
 * @since 1.0.0
 * @category UI
 */
export type ThemeId = "vestra";

/**
 * The player's palette, which every view uses. `plugin.appearance`.
 *
 * @remarks
 * The player sets the palette on every view (the main window and its panels,
 * the floating sidebar, tool windows, the Options window) before it appears
 * and again when the palette changes. Slint code that reads its colours from
 * `Theme` (`import { Theme } from "@vestra/theme.slint"`) follows it with no
 * plugin code; hard-coded colours do not. Only colours change: corner radii,
 * font sizes and control sizes are the same in every palette.
 *
 * The player saves the choice; it stays after the plugin that set it stops.
 * Tell the user about a change yourself (for example with
 * {@link Osd.show}).
 *
 * @capability None to read `theme`; `events` to follow changes; `ui.theme`
 *   to change it.
 *
 * @example A menu item that selects the palette
 * ```ts
 * plugin.commands.add({
 *   id: "vestra-colours",
 *   path: ["@settings", "Vestra colours"],
 *   radio: true,
 *   checked: () => plugin.appearance.theme === "vestra",
 *   run: () => plugin.appearance.set("vestra"),
 * });
 * ```
 *
 * @see [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md) (theme tokens)
 * @since 1.0.0
 * @category UI
 */
export interface Appearance {
  /**
   * The palette in use. Read before activation; with `events` it follows
   * other plugins' changes from the first read on, without it only this
   * plugin's own.
   */
  readonly theme: ThemeId;
  /**
   * Run code when the palette changes.
   *
   * @remarks
   * Needs `events`: without it the listener never runs for other plugins'
   * changes. Views need no help to follow the palette; use this for things
   * the plugin draws itself (a rendered image, colours it computes). Errors
   * go to {@link Scope.onError}.
   *
   * @capability events
   *
   * @param listener - Receives the new palette.
   * @returns A handle that removes the listener.
   *
   * @example
   * ```ts
   * plugin.appearance.onChange((theme) => {
   *   void plugin.osd.show(`Palette: ${theme}`);
   * });
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (theme: ThemeId) => void): Disposable;
  /**
   * Switch the palette of every view.
   *
   * @remarks
   * The player applies it to every open view without interrupting a drag or
   * an open menu, and saves it across restarts.
   *
   * @capability ui.theme
   *
   * @param theme - The palette to use.
   * @returns Resolves once the player has accepted the change;
   *   {@link Appearance.theme} has the new value.
   *
   * @throws `invalid` (rejects) `theme` is not a {@link ThemeId}.
   * @throws `capability` (rejects) The manifest does not declare `ui.theme`.
   *
   * @example
   * ```ts
   * await plugin.appearance.set("vestra");
   * ```
   *
   * @since 1.0.0
   */
  set(theme: ThemeId): Promise<void>;
}

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
 * @capability ui.settings
 *
 * @example Two preferences on a page (examples/blur)
 * {@includeCode ../../examples/blur/main.ts#settings-page}
 *
 * `ui/settings.slint`:
 *
 * {@includeCode ../../examples/blur/ui/settings.slint}
 *
 * @see {@link Settings.page}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
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
     * @throws `capability` (rejects) The manifest does not declare
     *   `ui.settings`.
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
 * @capability ui.settings
 *
 * @example A page that edits stored settings
 * ```ts
 * const store = plugin.storage.json("settings", { defaults: { resume: true } });
 * const page = plugin.settings.page("ui/settings.slint", {
 *   id: "resume",
 *   category: "playback",
 *   title: "Resume",
 * });
 * page.bind(() => ({ resume: store.value.resume }));
 * page.on("resumeToggled", (on: boolean) => store.save({ ...store.value, resume: on }));
 * ```
 *
 * @see {@link SettingsPage}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
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
   * @capability ui.settings
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
   * @example
   * ```ts
   * const page = plugin.settings.page("ui/advanced.slint", {
   *   id: "advanced",
   *   category: "plugins",
   *   title: "My plugin",
   *   order: 10,
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
   * @capability ui.settings
   *
   * @param pageId - The `id` of one of this plugin's pages.
   * @returns Resolves once the window is shown.
   *
   * @throws `invalid` (rejects) `pageId` is not a page of this plugin.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `ui` (rejects) The window could not be built (for example a page
   *   wrote a property its file does not declare).
   * @throws `capability` (rejects) The manifest does not declare
   *   `ui.settings`.
   *
   * @example An "Options…" button in a tool window (examples/blur)
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
 * {@link Player.stats}. With `events`, `state` follows every change; without
 * it, it refreshes only when this plugin mounts.
 *
 * @capability ui.mount; `events` to follow changes.
 *
 * @example React when a video picture appears
 * ```ts
 * plugin.panels.backdrop.onChange((state) => {
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
   * @capability ui.mount and events
   *
   * @param listener - Receives the new state (`null`: no backdrop).
   * @returns A handle that removes the listener.
   *
   * @example
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
 * Each plugin mounts at most one panel, and each position holds one panel
 * for all plugins. {@link Panels.bottom} and {@link Panels.sidebar} describe
 * the positions, whoever mounted there.
 *
 * @capability ui.mount
 *
 * @example A sidebar list (examples/panel-menu)
 * {@includeCode ../../examples/panel-menu/main.ts#mount}
 *
 * `ui/panel.slint`:
 *
 * {@includeCode ../../examples/panel-menu/ui/panel.slint}
 *
 * @see {@link Panel}, {@link PanelSlot}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
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
   *   floats over the video and hides after 3 seconds without activity.
   * - `"sidebar"`: right of the video, the window's full height, as wide as the
   *   user drags it (at least 317). The user can detach it into a floating
   *   window titled `title`.
   * - `"backdrop"`: the whole video area, under the OSD, while there is no
   *   video picture (see {@link Panels.backdrop}). One plugin at a time; it
   *   takes no pointer or keyboard input. While it is mounted, the player does
   *   not show the cover art of audio files itself (from the next file
   *   opened on), so the plugin can draw it.
   *
   * @capability ui.mount
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
   * @throws `Error` without a code (throws) This plugin already has a panel,
   *   or the file exports no component or global, or several and `options`
   *   does not name one. A file that cannot be read throws Node's file system
   *   error (`code` `ENOENT` and so on).
   * @throws The errors of {@link Panel.ready} (rejects `ready`) The player
   *   refused the mount.
   *
   * @example A bottom bar
   * ```ts
   * const bar = plugin.panels.mount("bottom", "ui/bar.slint");
   * bar.bind(() => ({ position: plugin.player.state.position ?? 0 }));
   * bar.on("seek", (seconds: number) => plugin.player.seek(seconds));
   * await bar.ready;
   * ```
   *
   * @since 1.0.0
   */
  mount(
    slot: "bottom" | "sidebar" | "backdrop",
    file: string,
    options?: {
      /** The exported component to mount, if the file exports several. */
      component?: string;
      /** The exported global to use as the bridge, if the file exports several. */
      global?: string;
      /** The floating sidebar window's title (at most 128 bytes). */
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
}

// ---------------------------------------------------------------- timeline

/** What a timeline mark stands for; readers choose colours by it. */
export type MarkKind = "chapter" | "bookmark" | "marker";

/** One mark on the seek bar. */
export interface TimelineMark {
  /** Seconds from the start. */
  readonly time: number;
  /** The mark's kind. */
  readonly kind: MarkKind;
  /** Label, `null` without one. */
  readonly title: string | null;
  /** The manifest id of the plugin that published it. */
  readonly plugin: string;
}

/** This plugin's own marks; disposing it removes them. */
export interface TimelineLayer extends Disposable {
  /**
   * Replace the layer (last write wins; `[]` clears it). At most 1000 marks,
   * titles ≤ 100 characters, times within the media. Failures go to `onError`;
   * with `ifCurrent`, a write for another source is dropped silently.
   *
   * @example
   * ```ts
   * const layer = plugin.timeline.layer();
   * const seen = plugin.player.state;
   * layer.set(
   *   bookmarks.map((b) => ({ time: b.time, kind: "bookmark", title: b.note })),
   *   { ifCurrent: seen },
   * );
   * ```
   */
  set(
    marks: { time: number; kind: MarkKind; title?: string }[],
    options?: { ifCurrent?: PlayerState },
  ): void;
}

/**
 * `plugin.timeline`: marks on the seek bar. Every plugin publishes one
 * layer; the player merges them. A new source clears every layer.
 */
export interface Timeline {
  /** Every layer merged, by time (`playback.read`). Empty on a new source. */
  readonly marks: readonly TimelineMark[];
  /** The merged list changed (needs `events`; at most every 100 ms). */
  onChange(listener: (marks: readonly TimelineMark[]) => void): Disposable;
  /** This plugin's layer (`timeline.marks`); a second call throws. */
  layer(): TimelineLayer;
}

/** The main window as `plugin.window.state` reports it (logical points). */
export interface WindowState {
  /** The main window is fullscreen. */
  readonly fullscreen: boolean;
  /** The video column, without the bottom bar, sidebar and splitter. */
  readonly videoArea: {
    /** Logical points. */
    readonly width: number;
    /** Logical points. */
    readonly height: number;
  };
  /**
   * System picture-in-picture: `supported` on this system and build (macOS
   * 14+; `false` on Windows, Linux and without a native window), `active`
   * while its window shows the video.
   */
  readonly pictureInPicture: {
    /** Picture-in-picture is possible here (macOS 14+ with a native window). */
    readonly supported: boolean;
    /** The picture-in-picture window shows the video now. */
    readonly active: boolean;
  };
}

/**
 * The player's main window. Reading needs no capability; changes need `window.control`.
 *
 * With `events`, `state` follows the window from the first read or
 * `onChange`; without it, it updates only at start and after this plugin's
 * `setVideoArea`.
 *
 * @example A "1:1 size" command
 * ```ts
 * plugin.commands.add({
 *   id: "size-1x",
 *   path: ["Screen", "Original size"],
 *   enabled: () => !plugin.window.state.fullscreen,
 *   run: async () => {
 *     const stats = await plugin.player.stats();
 *     if (stats.video?.width && stats.video.height)
 *       await plugin.window.setVideoArea({ width: stats.video.width, height: stats.video.height });
 *   },
 * });
 * ```
 */
export interface MainWindow {
  /** Latest state; zero video area without a native window. */
  readonly state: WindowState;
  /** The window state changed (needs `events` for outside changes). */
  onChange(listener: (state: WindowState) => void): Disposable;
  /**
   * Resize the window so the video column is `width`×`height` (the bottom bar
   * and a docked sidebar are added), keeping the top-left corner, moved back
   * inside the screen's visible area. Too large: scaled down keeping the
   * aspect; too small: raised to the minimum; `clamped` then. Resolves with
   * the video area applied. `unavailable` in fullscreen.
   *
   * Sizes are 1–16384 logical points; the minimum video area is 318×120.
   * The visible area excludes the menu bar and Dock on macOS; on Windows it
   * is the whole display. `unavailable` without a user interface too.
   */
  setVideoArea(size: { width: number; height: number }): Promise<{
    /** The applied video area width, logical points. */
    width: number;
    /** The applied video area height, logical points. */
    height: number;
    /** The request was scaled down or raised to fit. */
    clamped: boolean;
  }>;
  /**
   * Float the player's windows above other applications. Newest call wins; reverts when this plugin stops.
   * `unavailable` without a user interface.
   */
  setAlwaysOnTop(onTop: boolean): Promise<void>;
  /**
   * `"playing"`: hide the pointer over the video after 3 idle seconds while
   * playing, in a window too (not only fullscreen). Newest call wins;
   * reverts to `"fullscreen"` when this plugin stops.
   */
  setCursorAutoHide(mode: "fullscreen" | "playing"): Promise<void>;
  /**
   * Play the video in the system picture-in-picture window (`true`) or back
   * in the main window. Resolves once the window has opened or closed and
   * `state.pictureInPicture` shows it. From fullscreen the player leaves
   * fullscreen first. `unsupported` where `supported` is false; `unavailable`
   * without video; `busy` while the previous call is still switching;
   * `failed` when the system refuses. The window's play/pause and skip
   * buttons drive playback; its close button also pauses. It closes when
   * this plugin stops or the video goes away.
   *
   * Where it is unsupported (Windows, Linux), `setVideoArea` plus
   * `setAlwaysOnTop` make a reasonable "mini player" fallback.
   *
   * @example
   * ```ts
   * if (plugin.window.state.pictureInPicture.supported)
   *   await plugin.window.setPictureInPicture(!plugin.window.state.pictureInPicture.active);
   * ```
   */
  setPictureInPicture(on: boolean): Promise<void>;
}

/** `plugin.app`: fixed for the life of the plugin process. */
export interface AppInfo {
  /** The player's version, e.g. `"1.0.0"`. */
  readonly version: string;
  /** Short git hash of the build, `null` when unknown. */
  readonly build: string | null;
  /** Versions of the player's main components. */
  readonly components: {
    /** libmpv's `mpv-version`. */
    readonly mpv: string | null;
    /** `{ ffmpeg: <ffmpeg-version> }` (what libmpv reports). */
    readonly libav: Readonly<Record<string, string>>;
    /** The linked Slint version, e.g. `"1.18.1"`. */
    readonly slint: string;
  };
}

/**
 * `plugin.app`: the fixed facts plus the system, read on request. No
 * capability.
 *
 * @example
 * ```ts
 * const system = await plugin.app.system();
 * const text = `Vestra ${plugin.app.version} on ${system.name} ${system.version ?? ""}`;
 * ```
 */
export interface App extends AppInfo {
  /**
   * The operating system and the displays, read when called (displays come
   * and go). No capability. CPU and memory: Node's `os` module.
   */
  system(): Promise<SystemInfo>;
}

/** What {@link App.system} reports. */
export interface SystemInfo {
  /** The operating system family. */
  readonly os: "macos" | "windows" | "linux" | "other";
  /** Product name: `macOS`, `Windows 11`, … */
  readonly name: string;
  /** `26.2` (macOS), `23H2` (Windows); `null` when unknown. */
  readonly version: string | null;
  /** `25C56` (macOS), `22631.4460` (Windows); `null` when unknown. */
  readonly build: string | null;
  /** Hardware model (`Mac15,6`, the firmware's product name); `null` when unknown. */
  readonly model: string | null;
  /** CPU architecture of the player build: `aarch64`, `x86_64`, … */
  readonly arch: string;
  /** Primary display first; empty without a user interface. */
  readonly displays: readonly DisplayInfo[];
}

/** One display in {@link SystemInfo.displays}. */
export interface DisplayInfo {
  /** The system's name for it, `null` when it has none. */
  readonly name: string | null;
  /** Pixels in the current mode. */
  readonly width: number;
  /** Pixels in the current mode. */
  readonly height: number;
  /** Pixels per logical point (2 on Retina, 1.5 at 150 %). */
  readonly scale: number;
  /** Hz, `null` when unknown. */
  readonly refreshRate: number | null;
  /** The primary display. */
  readonly primary: boolean;
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
  message: string;
  /** More text under the message; at most 2000 characters. */
  detail?: string;
  /** The confirm button's text (the default button: Enter picks it); 1–40 characters. */
  confirm: string;
  /**
   * The cancel button's text (Escape picks it); 1–40 characters.
   *
   * @defaultValue "Cancel", in the player's language
   */
  cancel?: string;
  /**
   * Mark the confirm button as destructive: red text on macOS, a warning
   * icon on Windows.
   *
   * @defaultValue `false`
   */
  destructive?: boolean;
  /** A checkbox under the text, such as "Don't ask again"; 1–40 characters. */
  checkbox?: string;
}

/**
 * The system's own dialogs: a confirmation alert and the open and save file
 * dialogs. `plugin.dialogs`.
 *
 * @remarks
 * The plugin passes text and gets the answer; the system draws the dialog,
 * so it looks and behaves like every other dialog on the system. Each call
 * resolves when the user answers; there is no time limit and no way to close
 * a dialog from code. Only one dialog (of any kind, from any plugin) is open
 * at a time: another call meanwhile rejects with `busy`. Playback continues
 * while a dialog is open; command key bindings pause.
 *
 * For anything more than a question or a path, use a {@link Windows | tool
 * window}.
 *
 * @capability ui.dialog
 *
 * @example Ask before deleting, remembering "Don't ask again"
 * ```ts
 * const store = plugin.storage.json("confirm", { defaults: { askBeforeDelete: true } });
 * async function deleteAll(count: number) {
 *   if (store.value.askBeforeDelete) {
 *     const { confirmed, checked } = await plugin.dialogs.confirm({
 *       message: `Delete ${count} bookmarks?`,
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
 * @see [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
 * @since 1.0.0
 * @category UI
 */
export interface Dialogs {
  /**
   * Ask the user to confirm something, in a system alert.
   *
   * @remarks
   * **macOS:** an `NSAlert` sheet on the active player window (usually the
   * tool window the user just clicked in), else on the main window.
   *
   * **Windows:** a task dialog owned by the active player window, titled
   * "Vestra Player"; `detail` follows `message` after a blank line. A
   * `checkbox` is asked as a second yes/no dialog after the user confirms
   * (on cancel it is not asked and `checked` is `false`).
   *
   * Remembering "Don't ask again" is up to the plugin (see
   * {@link Scope.storage}).
   *
   * @capability ui.dialog
   *
   * @param options - The text and buttons; see {@link ConfirmOptions}.
   * @returns The answer: `confirmed` is `true` when the user picked the
   *   confirm button (Escape, the cancel button or closing the dialog give
   *   `false`); `checked` is the checkbox's state (`false` without one).
   *
   * @throws `invalid` (rejects) A text is empty or too long, or `destructive`
   *   is not a boolean.
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   * @throws `capability` (rejects) The manifest does not declare `ui.dialog`.
   *
   * @example
   * ```ts
   * const { confirmed } = await plugin.dialogs.confirm({
   *   message: "Replace the current playlist?",
   *   confirm: "Replace",
   * });
   * if (confirmed) await plugin.osd.show("Playlist replaced");
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
   * @capability ui.dialog
   *
   * @param options - `title`: the dialog's title, at most 256 bytes.
   * @returns The absolute path, or `null` when the user cancelled.
   *
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `invalid` (rejects) `title` is longer than 256 bytes.
   * @throws `capability` (rejects) The manifest does not declare `ui.dialog`.
   *
   * @example
   * ```ts
   * const path = await plugin.dialogs.openFile({ title: "Choose a subtitle file" });
   * if (path !== null) await plugin.osd.show(`Chosen: ${path}`);
   * ```
   *
   * @since 1.0.0
   */
  openFile(options?: {
    /** The dialog's title, at most 256 bytes. */
    title?: string;
  }): Promise<string | null>;
  /**
   * Ask the user for one or more files to open.
   *
   * @capability ui.dialog
   *
   * @param options - `title`: the dialog's title, at most 256 bytes.
   * @returns The absolute paths, or `[]` when the user cancelled.
   *
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `invalid` (rejects) `title` is longer than 256 bytes.
   * @throws `capability` (rejects) The manifest does not declare `ui.dialog`.
   *
   * @example
   * ```ts
   * const paths = await plugin.dialogs.openFiles({ title: "Add to the playlist" });
   * await plugin.osd.show(`${paths.length} files added`);
   * ```
   *
   * @since 1.0.0
   */
  openFiles(options?: {
    /** The dialog's title, at most 256 bytes. */
    title?: string;
  }): Promise<string[]>;
  /**
   * Ask the user for a folder.
   *
   * @capability ui.dialog
   *
   * @param options - `title`: the dialog's title, at most 256 bytes.
   * @returns The absolute path, or `null` when the user cancelled.
   *
   * @throws `busy` (rejects) Another dialog is open.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `invalid` (rejects) `title` is longer than 256 bytes.
   * @throws `capability` (rejects) The manifest does not declare `ui.dialog`.
   *
   * @example
   * ```ts
   * const folder = await plugin.dialogs.openDirectory({ title: "Save snapshots in" });
   * if (folder === null) return; // cancelled
   * ```
   *
   * @since 1.0.0
   */
  openDirectory(options?: {
    /** The dialog's title, at most 256 bytes. */
    title?: string;
  }): Promise<string | null>;
  /**
   * Ask the user where to save a file.
   *
   * @remarks
   * The dialog only returns a path; writing the file is up to the plugin.
   *
   * @capability ui.dialog
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
   * @throws `capability` (rejects) The manifest does not declare `ui.dialog`.
   *
   * @example
   * ```ts
   * const path = await plugin.dialogs.saveFile({ title: "Save snapshot", fileName: "frame.png" });
   * if (path === null) return; // cancelled
   * ```
   *
   * @since 1.0.0
   */
  saveFile(options?: {
    /** The dialog's title, at most 256 bytes. */
    title?: string;
    /** The proposed file name: a plain name, at most 256 bytes. */
    fileName?: string;
  }): Promise<string | null>;
}

// ---------------------------------------------------------------- player

/** One audio track of the current media ({@link PlayerState.audioTracks}). */
export interface AudioTrack {
  /** The backend's track id; pass it to {@link Player.selectAudioTrack}. */
  id: number;
  /** The track is playing. */
  selected: boolean;
  /** True for an external track; such tracks cannot be exported. */
  external: boolean;
  /** False when the track is not inside the source container. */
  exportable: boolean;
  /** Codec name, `null` when unknown. */
  codec: string | null;
  /** Track title, `null` when unknown. */
  title: string | null;
  /** Language tag, `null` when unknown. */
  language: string | null;
}

/**
 * An immutable view of the player. Keep one to make a later call conditional on it.
 *
 * Without `events`, {@link Player.state} only updates at start and after
 * this plugin's own operations.
 */
export interface PlayerState {
  /** Changes every time a source is opened, even the same file again. */
  readonly sourceId: number;
  /** `stream` for a generated source ({@link Player.openStream}). */
  readonly kind: "media" | "stream";
  /** The source's life cycle. */
  readonly phase: "empty" | "loading" | "ready" | "ended" | "error";
  /** Path or URL. */
  readonly source: string | null;
  /** Playback is paused. */
  readonly paused: boolean;
  /** Seconds, `null` without media. */
  readonly position: number | null;
  /** Seconds, `null` when unknown (live streams). */
  readonly duration: number | null;
  /** Playback speed (1 = normal). */
  readonly rate: number;
  /** Device volume 0–200. */
  readonly volume: number;
  /** Device output is muted. */
  readonly muted: boolean;
  /** Why the last playthrough stopped. */
  readonly endReason: "natural" | "stopped" | "replaced" | "unknown" | null;
  /** Load failure text when `phase` is `error`. */
  readonly error: string | null;
  /** Which controls the current source allows. */
  readonly can: {
    /** {@link Player.setPaused}. */
    pause: boolean;
    /** {@link Player.seek} and {@link Player.scrub}. */
    seek: boolean;
    /** {@link Player.setRate}. */
    rate: boolean;
    /** {@link Player.restart}. */
    restart: boolean;
    /** {@link Player.close}. */
    close: boolean;
    /** {@link MediaCapture.capture}. */
    snapshot: boolean;
    /** A sequence provider exists and can go forward / back (`player.next()`). */
    next: boolean;
    /** A sequence provider exists and can go back (`player.previous()`). */
    previous: boolean;
  };
  /** The media's audio tracks; `null` before they are known. */
  readonly audioTracks: AudioTrack[] | null;
  /**
   * The A-B loop (`setLoop`) as requested; `count` null = endless. Cleared by
   * a new source. The SDK always sets it (`null` = no loop); it is optional
   * only so hand-written test states without it still type-check.
   */
  readonly loop?: {
    /** Loop start, seconds. */
    a: number;
    /** Loop end, seconds. */
    b: number;
    /** Requested repetitions (not the remaining ones); `null` = endless. */
    count: number | null;
  } | null;
  /**
   * The output device `setAudioDevice` asked for and the one in use (`null`
   * = system default). Always set by the SDK; optional for the same reason
   * as `loop`.
   */
  readonly audioOutput?: {
    /** The device id asked for, `null` = system default. */
    requested: string | null;
    /** The device in use, `null` = system default. */
    active: string | null;
  };
}

/** An audio output device (`player.audioDevices`). */
export interface AudioDevice {
  /** Stable id to pass to `setAudioDevice` (e.g. `coreaudio/<UID>`). */
  id: string;
  /** What the system calls it. */
  name: string;
}

/** One chapter of the current media. */
export interface Chapter {
  /** Chapter title, `null` without one. */
  title: string | null;
  /** Seconds. */
  start: number;
}

/**
 * Controls act on the state you are looking at: by default `player.state`.
 * If another plugin or the user changed the source in between, the call fails
 * with code `stale` and nothing happens. Pass `ifCurrent` to bind the call to
 * an older snapshot instead (for example the state when a drag started).
 *
 * The SDK refreshes `player.state` after its own operations, so a plugin's
 * consecutive calls do not make each other stale. {@link Player.open} is
 * unconditional unless `ifCurrent` is given.
 *
 * @example
 * ```ts
 * // Advance only if nobody changed the source since it ended.
 * media.onEnd((ended) => plugin.player.open(next, { ifCurrent: ended }));
 * ```
 */
export interface Conditional {
  /** The state the call is conditional on; default: the current `player.state`. */
  ifCurrent?: PlayerState;
}

/** A source this plugin opened. */
export interface Media {
  /** Still the player's source (a restart keeps it current). */
  readonly current: boolean;
  /**
   * Resolves when it is playing. Rejects with code `failed` (load error),
   * `replaced` (another source took over) or `ended`; with `AbortError` when
   * the signal aborts, after closing the media.
   */
  ready(options?: { signal?: AbortSignal }): Promise<void>;
  /** Called once each time a playthrough of this media ends naturally. */
  onEnd(listener: (state: PlayerState) => void): Disposable;
  /** Close it if it is still the player's source; otherwise do nothing. */
  close(): Promise<void>;
}

/**
 * A drag gesture: each seek is conditional on the previous one, latest value wins.
 * Any outside change (another plugin opens a file, the user pauses) ends
 * the gesture.
 *
 * @example
 * ```ts
 * let scrub: Scrub | null = null;
 * bar.on("dragStart", () => (scrub = plugin.player.scrub()));
 * bar.on("dragMove", (seconds: number) => void scrub?.seek(seconds));
 * bar.on("dragEnd", () => scrub?.end());
 * ```
 */
export interface Scrub {
  /**
   * Resolves `true` when this exact target was applied, `false` when a newer
   * target superseded it or the gesture ended. Rejects on a host failure.
   */
  seek(seconds: number): Promise<boolean>;
  /** False once anyone else changed the source; later seeks are ignored. */
  readonly active: boolean;
  /** End the gesture; later seeks resolve `false`. */
  end(): void;
}

/**
 * Frames a stream supplies on demand: RGBA pixels and 48 kHz stereo f32 PCM.
 *
 * Limits: the picture is exactly `width × height × 4` bytes and at most
 * 4 MiB (1280×720 fits, 1920×1080 does not: lower the resolution, the
 * player scales it). Every sample is finite and within −1…1; clamp your
 * own mix. A frame that breaks a limit ends the stream with `invalid`
 * (`openStream` rejects, or {@link Stream.onStop} gets the error).
 *
 * The SDK copies the frame once before `frame()` is called again, so you
 * may reuse the same buffers for every frame.
 */
export interface StreamFrame {
  /** `width × height × 4` bytes of RGBA, at most 4 MiB. */
  video: Uint8Array;
  /**
   * Interleaved stereo samples at 48 kHz for this frame's duration (an even
   * length, any number of frames; the SDK sends them in packets of at most
   * 4800). Each sample finite, −1…1.
   */
  audio: Float32Array;
}

/** Options of {@link Player.openStream}. */
export interface StreamOptions {
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Produce the next frame. Never called concurrently or while paused. */
  frame(): StreamFrame;
  /** Aborting stops the stream. */
  signal?: AbortSignal;
}

/**
 * `openStream` start-up timeouts: code `timeout` with the step that ran out
 * of time, the first buffers (`prefill`) or the host's activation.
 * Both limits are 10 seconds.
 */
export type StreamStartError = PluginError & {
  /** The start-up step that timed out. */
  stage: "prefill" | "activation";
};

/** A generated source, from {@link Player.openStream}. Disposing it stops it. */
export interface Stream extends Disposable {
  /** The stream is producing frames. */
  readonly running: boolean;
  /**
   * The stream stopped for a reason outside this plugin: `error` is null when
   * another source replaced it or the user closed it, otherwise the failure
   * (`stream`, `invalid` for a bad frame, …). Not called when the plugin
   * itself stops it (`stop()`, `dispose()`, deactivation): the promise of
   * `stop()` is that notification.
   */
  onStop(listener: (error: PluginError | null) => void): Disposable;
  /**
   * Stop producing and close the stream if it is still the player's source.
   * The source closes first, then the frame connection, then the producer,
   * so stopping never shows as a playback failure. `dispose()` and
   * deactivation do the same.
   */
  stop(): Promise<void>;
}

/** The plugin that owns "next / previous" (a playlist). */
export interface SequenceProvider {
  /** Go to the next item (called in the provider's scope). */
  next(): unknown;
  /** Go to the previous item. */
  previous(): unknown;
  /** Whether there is a next item; shown as `state.can.next`. */
  canNext: Bindable<boolean>;
  /** Whether there is a previous item; shown as `state.can.previous`. */
  canPrevious: Bindable<boolean>;
}

/**
 * What {@link Player.stats} reports. Every field is the backend's own value
 * (libmpv properties), `null` when it has none; nothing is converted.
 */
export interface PlaybackStats {
  /**
   * The rendering path: "libmpv · GPU 渲染（OpenGL）" (GPU, macOS default) or
   * "libmpv · 软件渲染" (software: Windows, Linux, headless, fallback).
   * The strings are the player's display text.
   */
  backend: string;
  /** The playback session number. */
  session: number;
  /** Frames the host has shown. */
  framesShown: number;
  /** Frames dropped, `null` when unknown. */
  framesDropped: number | null;
  /** Every field is the backend's own value, `null` when it has none. */
  video: {
    /** Codec name. */
    codec: string | null;
    /** Coded width. */
    width: number | null;
    /** Coded height. */
    height: number | null;
    /** Frames per second (after a `frameBlend` node: the output rate). */
    fps: number | null;
    /** Short decoder name, e.g. "h264". */
    decoder: string | null;
    /** e.g. "yuv420p". */
    pixelFormat: string | null;
    /** Colour matrix, e.g. "bt.709". */
    colorspace: string | null;
    /** Size after aspect correction and filters. */
    displayWidth: number | null;
    /** Size after aspect correction and filters. */
    displayHeight: number | null;
    /** Measured display refresh; only with display-synced output (usually null). */
    displayFps: number | null;
    /** Bits per second, updated per keyframe. */
    bitrate: number | null;
    /** Hardware decoder in use, e.g. "videotoolbox"; "no" = software decoding. */
    hwdec: string | null;
    /** Transfer characteristic as mpv names it, e.g. "bt.1886", "pq", "hlg". */
    transfer: string | null;
  } | null;
  /** `null` without audio. */
  audio: {
    /** Codec name. */
    codec: string | null;
    /** Hz. */
    sampleRate: number | null;
    /** Channel count. */
    channels: number | null;
    /** Short decoder name, e.g. "aac". */
    decoder: string | null;
    /** Sample format, e.g. "floatp". */
    format: string | null;
    /** Readable layout, e.g. "stereo", "5.1(side)". */
    channelLayout: string | null;
    /** Bits per second. */
    bitrate: number | null;
  } | null;
  /** Last audio/video difference in milliseconds (signed). */
  avSyncMs: number | null;
  /** Seconds of media buffered ahead by the demuxer. */
  cacheSeconds: number | null;
}

/**
 * `plugin.player`: playback state and controls.
 *
 * Capabilities: reading (`state` at start, `refresh`, `stats`, `chapters`,
 * `audioDevices`) needs `playback.read`; live updates and `onChange` need
 * `events`; every control needs `playback.control`; `openStream` needs
 * `producer.av` as well as `playback.control`.
 *
 * Controls are conditional (see {@link Conditional}): they fail with
 * `stale` and do nothing when the source changed since the state you saw.
 *
 * @example Open a file and wait until it plays
 * ```ts
 * const media = await plugin.player.open("/Movies/clip.mp4");
 * try {
 *   await media.ready({ signal: AbortSignal.timeout(10_000) });
 * } catch (error) {
 *   void plugin.osd.show(`Cannot play: ${(error as Error).message}`);
 * }
 * ```
 */
export interface Player {
  /** Latest state; always newer than anything delivered before. */
  readonly state: PlayerState;
  /** The state changed (needs `events` for outside changes). */
  onChange(listener: (state: PlayerState) => void): Disposable;
  /** Read the state from the player now (`playback.read`). */
  refresh(): Promise<PlayerState>;
  /** True if nothing changed the source since `state` was observed. */
  isCurrent(state: PlayerState): boolean;
  /**
   * Open a path or URL, replacing the current source (unless `ifCurrent` no
   * longer holds). Resolves when the host accepted the load.
   *
   * It does not wait for playback: use {@link Media.ready}. `paused` opens
   * it paused; aborting `signal` closes it. URLs matching a registered
   * {@link Resolver} are resolved first.
   */
  open(
    source: string,
    options?: { paused?: boolean; signal?: AbortSignal } & Conditional,
  ): Promise<Media>;
  /**
   * Start a source whose frames this plugin generates. Needs `producer.av`
   * and `playback.control` (the stream becomes the player's source, like
   * {@link Player.open}).
   *
   * The SDK calls `frame()` on the audio clock and handles prefill,
   * activation, pausing and acknowledgement. Frames travel over a local
   * connection the SDK sets up: a Unix socket on macOS and Linux, loopback
   * TCP with a token on Windows. Rejects with a {@link StreamStartError}
   * (`timeout`), `stream` or `device`.
   *
   * @example
   * ```ts
   * const frame = new Uint8Array(320 * 240 * 4);
   * const silence = new Float32Array(2 * 800); // 1/60 s of stereo
   * const stream = await plugin.player.openStream({
   *   width: 320,
   *   height: 240,
   *   frame: () => ({ video: render(frame), audio: silence }),
   * });
   * stream.onStop((error) => error && plugin.osd.show(error.message));
   * ```
   */
  openStream(options: StreamOptions): Promise<Stream>;
  /** Pause or resume. */
  setPaused(paused: boolean, options?: Conditional): Promise<void>;
  /** Jump to `seconds`. */
  seek(seconds: number, options?: Conditional): Promise<void>;
  /** Set the playback speed. */
  setRate(rate: number, options?: Conditional): Promise<void>;
  /** Play from the start (the "replay" after the end). */
  restart(options?: Conditional): Promise<void>;
  /** Close the current source. */
  close(options?: Conditional): Promise<void>;
  /** Start a drag gesture from the current state. */
  scrub(): Scrub;
  /**
   * Device output; last write wins and volume is applied before mute.
   * Resolves `true` when this request was applied, `false` if superseded.
   * `volume` is 0–200.
   */
  setOutput(output: { volume?: number; muted?: boolean }): Promise<boolean>;
  /**
   * Become the sequence provider (one at a time; another provider rejects with
   * `conflict` through the scope's `onError`, or fails activation). Dispose to stop.
   *
   * @example
   * ```ts
   * plugin.player.provideSequence({
   *   next: () => playAt(index + 1),
   *   previous: () => playAt(index - 1),
   *   canNext: () => index + 1 < items.length,
   *   canPrevious: () => index > 0,
   * });
   * ```
   */
  provideSequence(provider: SequenceProvider): Disposable;
  /** Ask the provider to go forward / back. Rejects `unavailable` when it cannot. */
  next(): Promise<void>;
  /** Ask the provider to go back. Rejects `unavailable` when it cannot. */
  previous(): Promise<void>;
  /**
   * Codec, size, frame counts and backend of the current playback.
   * `playback.read`; `video` and `audio` are `null` without a source.
   */
  stats(): Promise<PlaybackStats>;
  /**
   * Add an external audio file (absolute local path) to the current media and,
   * unless `select: false`, select it. Resolves with the new track (`external`,
   * not exportable). It stays until the source changes. Rejects `invalid` for a
   * bad path, `unavailable` without ready media, `backend` when it cannot load.
   */
  addAudioTrack(
    path: string,
    options?: { select?: boolean } & Conditional,
  ): Promise<AudioTrack>;
  /** Select one of `state.audioTracks` by id; `invalid` for an unknown id. */
  selectAudioTrack(id: number, options?: Conditional): Promise<PlayerState>;
  /**
   * One frame or to the next / previous keyframe (pauses for frames). Rejects
   * `unsupported` without moving video (audio only, cover art, a generated
   * stream) or when backwards needs a seekable source.
   *
   * Resolves once the new position is in effect, so `player.state.position`
   * is current afterwards. One step at a time: a second call while one is
   * in flight rejects `busy`.
   */
  step(
    unit: "frame" | "keyframe",
    direction: "backward" | "forward",
    options?: Conditional,
  ): Promise<void>;
  /**
   * The core's first-tier relative seek (`seek-backward` / `seek-forward`,
   * ← / →): 0.1–3600 seconds in tenths, default 5. The newest call of any
   * plugin wins; it reverts when that plugin stops.
   */
  setStepSeek(options: { seconds: number }): Promise<void>;
  /**
   * The chapters of the current media (empty without media or chapters),
   * read on demand; `sourceId` tells which source they belong to.
   * `playback.read`.
   */
  chapters(): Promise<{
    /** The source the chapters belong to (compare with `state.sourceId`). */
    sourceId: number;
    /** In playback order. */
    chapters: Chapter[];
  }>;
  /**
   * A-B loop: on reaching `b`, jump back to `a` (seconds, `0 ≤ a < b ≤
   * duration`), `count` times (positive integer; omitted = endless); `null`
   * stops it. After the last jump back `state.loop` becomes null.
   * `invalid` out of range, `unsupported` for a source that cannot seek,
   * `unavailable` without ready media. A new source clears it.
   */
  setLoop(
    loop: { a: number; b: number; count?: number } | null,
    options?: Conditional,
  ): Promise<void>;
  /** The output devices present now (not the system default entry). `playback.read`. */
  audioDevices(): Promise<AudioDevice[]>;
  /**
   * Play on this device while it is present, else on the system default
   * (`null` = always the default). Generated streams follow too. Kept for
   * this run only. `playback.control`.
   *
   * Unknown ids are accepted (`state.audioOutput.active` stays `null`); a
   * malformed id is `invalid`. Reverts to the default when this plugin
   * stops; save the choice yourself to restore it on activation.
   */
  setAudioDevice(id: string | null): Promise<void>;
}

/**
 * The core's basic playback actions (menu commands owned by the player).
 *
 * | action | default bindings | behaviour |
 * | --- | --- | --- |
 * | `stop` | F4 | close the source |
 * | `play-pause` | Space | pause / resume, replay after the end |
 * | `previous` / `next` | PageUp, Mouse:X1 / PageDown, Mouse:X2 | ask the sequence provider |
 * | `frame-back` / `frame-forward` | D / F | `player.step("frame", …)` |
 * | `seek-backward` / `seek-forward` | ← / → | relative seek by `setStepSeek` seconds |
 * | `rate-normal`, `rate-down`, `rate-up` | Z, X, C | 1×, ±0.1 within 0.25–4 |
 * | `volume-up` / `volume-down` | ↑ / ↓, wheel | ±5 (`volume-up` stops at 100) |
 * | `mute` | M | toggle mute |
 *
 * In the binding overlay their keys are `host/<action>`.
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
  | "mute";

/** `plugin.host`: the player's own core actions. */
export interface Host {
  /**
   * Run a core action exactly like its menu item or key: same checks, same
   * on-screen text. Resolves when it finished (or was dropped because the
   * same action is still running). Rejects `unavailable` when disabled,
   * `invalid` for an unknown id. Needs `commands`.
   *
   * Prefer this over reimplementing playback buttons.
   *
   * @example
   * ```ts
   * bar.on("playPause", () => plugin.host.run("play-pause"));
   * ```
   */
  run(action: HostAction): Promise<void>;
}

// ---------------------------------------------------------------- on-screen display

/**
 * This plugin's information block on the OSD: multi-line text over the
 * video that stays until the plugin changes or removes it. Made by
 * {@link Osd.panel}.
 *
 * @remarks
 * The block sits under the OSD message line, on a translucent black
 * background, and takes no input. Its font scales with the video area. When
 * several plugins have one, they are stacked from top to bottom. `dispose()`,
 * disposing the scope or stopping the plugin removes it.
 *
 * @capability ui.osd
 *
 * @example Live playback numbers
 * ```ts
 * const info = plugin.osd.panel();
 * plugin.player.onChange((state) =>
 *   info.set(`${state.position?.toFixed(1) ?? "–"} / ${state.duration?.toFixed(1) ?? "–"} s`),
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
   * (`invalid` for too much text, `unavailable` without a user interface,
   * `capability` without `ui.osd`).
   *
   * @capability ui.osd
   *
   * @param text - The text, with `\n` between lines: at most 32 lines and
   *   4096 bytes. `null` hides the block.
   *
   * @example
   * ```ts
   * const info = plugin.osd.panel();
   * info.set("A: 12.0 s\nB: 18.5 s");
   * info.set(null); // hide it
   * ```
   *
   * @since 1.0.0
   */
  set(text: string | null): void;
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
 * or removes it. Both are white text with a dark outline whose size follows
 * the height of the video area.
 *
 * @capability ui.osd
 *
 * @example On-screen messages that the user can turn off (examples/blur)
 * {@includeCode ../../examples/blur/main.ts#osd}
 *
 * @see {@link OsdPanel}, [Windows, panels, settings pages, dialogs and the OSD](../../docs/concepts/ui.md)
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
   * @capability ui.osd
   *
   * @param text - 1–200 characters; line breaks become spaces.
   * @returns Resolves once the message is on screen.
   *
   * @throws `invalid` (rejects) `text` is empty, only white space, or longer
   *   than 200 characters.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.osd`.
   *
   * @example
   * ```ts
   * await plugin.osd.show("Bookmark added");
   * ```
   *
   * @since 1.0.0
   */
  show(text: string): Promise<void>;
  /**
   * Create this plugin's information block.
   *
   * @remarks
   * Nothing is shown until {@link OsdPanel.set}. A plugin has one block;
   * dispose it before creating another.
   *
   * @capability ui.osd
   *
   * @returns An {@link OsdPanel} owned by this scope.
   *
   * @throws `Error` without a code (throws) This plugin already has a block.
   *
   * @example
   * ```ts
   * const info = plugin.osd.panel();
   * info.set("Loop: off");
   * ```
   *
   * @since 1.0.0
   */
  panel(): OsdPanel;
}

// ---------------------------------------------------------------- video and audio filters

/**
 * The state of a filter, display layer or render options handle.
 * After `failed` nothing retries automatically until the next `set()`,
 * `retry()` or a new source.
 */
export type FilterStatus =
  /** No ready media; the value is kept and applied when media is ready. */
  | {
      /** Waiting for ready media. */
      state: "waiting";
    }
  /** A request is in flight. */
  | {
      /** A request is in flight. */
      state: "applying";
    }
  /** The backend accepted it (not a visible-frame guarantee). */
  | {
      /** Accepted by the backend. */
      state: "applied";
    }
  /** Not applied. `retry()`, the next `set()` or a new source tries again. */
  | {
      /** Not applied. */
      state: "failed";
      /**
       * Why. `backend-uncertain`: the backend blocked the stage.
       * `unsupported`: the source is a generated stream
       * ({@link Player.openStream}), whose frames and samples do not pass
       * through the player's filters; the chain is applied again when the
       * source changes to media the player decodes.
       */
      error: PluginError;
    };

interface Filter<T> extends Disposable {
  /**
   * Desired chain; last write wins. An empty chain (video `[]`; audio
   * `nodes: []` with no delay) removes this chain, leaving other chains
   * alone; nothing is sent if it was never applied. Players before 0.3.0
   * refuse an empty video chain with `invalid`.
   */
  set(value: T): void;
  /** Current status. */
  readonly status: FilterStatus;
  /** The status changed. */
  onStatus(listener: (status: FilterStatus) => void): Disposable;
  /** Re-check the host and apply the current value again. */
  retry(): void;
}

/**
 * This plugin's own video processing chain, re-applied for every new source.
 * From `plugin.video.filter(id)`; needs `processing.video`,
 * `playback.read` and `events`. Without `events` the SDK does not see the
 * source change: a value set before the media is ready stays `waiting`.
 *
 * Members: `set(nodes)` (desired chain, last write wins, `[]` withdraws
 * this plugin's effect), `status` ({@link FilterStatus}),
 * `onStatus(listener)`, `retry()` (re-check and apply again) and
 * `dispose()` (withdraws the chain if it was applied).
 *
 * Each plugin's chain is joined with the others' in a stable order; at most
 * 64 nodes across all plugins. A generated stream ({@link Player.openStream})
 * bypasses the filters: while one plays, a non-empty chain is `failed` with
 * `unsupported`, and it is applied again once a decoded file or URL plays. Calling `set` on every slider move is fine:
 * one request is in flight at a time and only the newest value is sent.
 * Values out of range fail with `invalid` (see {@link VideoNode}). The
 * same chain applies to processed snapshots and exports.
 *
 * @example
 * ```ts
 * const picture = plugin.video.filter("picture");
 * picture.onStatus((s) => s.state === "failed" && plugin.osd.show(s.error.message));
 * picture.set([{ kind: "eq", brightness: 0.1, contrast: 1.1, saturation: 1, gamma: 1 }]);
 * ```
 */
export type VideoFilter = Filter<VideoNode[]>;
/**
 * This plugin's own audio chain plus its audio delay in 10 ms steps.
 * From `plugin.audio.filter(id)`; needs `processing.audio`,
 * `playback.read` and `events`. Same members and rules as
 * {@link VideoFilter}.
 *
 * `delayMs` is −10000–10000 in multiples of 10; the positive and the
 * negative delays of all plugins each add up to at most 10000.
 *
 * @example
 * ```ts
 * const audio = plugin.audio.filter("sound");
 * audio.set({ nodes: [{ kind: "volume", gainDb: -6 }], delayMs: 120 });
 * ```
 */
export type AudioFilter = Filter<{
  /** The audio chain; `[]` for none. */
  nodes: AudioNode[];
  /** Audio delay in ms, −10000–10000 in steps of 10 (default 0). */
  delayMs?: number;
}>;

/**
 * How the video sits in the video area; not part of snapshots or exports.
 * Defaults: `{ aspect: null, fit: "keep", zoom: 1, panX: 0, panY: 0 }`.
 */
export interface ViewSettings {
  /** Display aspect override 0.25–4; `null` = as the source. */
  aspect: number | null;
  /** keep: letterbox; stretch: fill, distorted; fill: fill, cropped. */
  fit: "keep" | "stretch" | "fill";
  /** 0.25–4 (1 = fit the area). */
  zoom: number;
  /** −1–1, in units of the shown video's width / height. */
  panX: number;
  /** −1–1, in units of the shown video's height. */
  panY: number;
}
/**
 * The display layer, from `plugin.video.view()` (`processing.video`).
 *
 * Single owner: the first plugin to call `view()` owns it; another plugin's
 * handle reports `failed` (`conflict`) and retries on each `set`. Values
 * persist across sources (reset them yourself on a new `sourceId` if
 * needed); disposing or stopping the owner restores the defaults.
 * Out-of-range values or unknown fields fail with `invalid` without
 * sending anything.
 *
 * @example
 * ```ts
 * const view = plugin.video.view();
 * view.set({ fit: "fill" });
 * view.set({ zoom: 1.5, panX: 0.1 }); // merged with the previous write
 * ```
 */
export interface VideoView extends Disposable {
  /** Merged into the current settings; last write wins. */
  set(value: Partial<ViewSettings>): void;
  /** Current status (the same four states as filters). */
  readonly status: FilterStatus;
  /** The status changed. */
  onStatus(listener: (status: FilterStatus) => void): Disposable;
}

/**
 * GPU renderer options; not part of snapshots or exports.
 * Defaults: `{ toneMapping: "auto", targetPeak: 203, peakDetect: true, shaders: [], interpolation: false }`.
 */
export interface RenderSettings {
  /** HDR → SDR: "auto" maps HDR sources only; "off" clips without a curve. */
  toneMapping:
    "auto" | "off" | "bt.2390" | "hable" | "mobius" | "reinhard" | "clip";
  /** SDR display brightness in nits, 100–400. */
  targetPeak: number;
  /** Per-scene peak estimation (where the GPU supports it). */
  peakDetect: boolean;
  /** mpv user shaders (`.glsl`): absolute paths of existing files, at most 16, in order. */
  shaders: string[];
  /** Motion interpolation, resampled to the display's refresh rate. */
  interpolation: boolean;
}
/**
 * The GPU renderer's options, from `plugin.video.render()`
 * (`processing.video`). Single owner, like {@link VideoView}; the two are
 * independent handles.
 *
 * Platforms: only macOS renders on the GPU. Under software rendering
 * (Windows, Linux, headless, fallback) every `set` fails with
 * `unsupported`. macOS OpenGL 4.1 has no compute shaders, so `peakDetect`
 * is accepted but has no effect; output is always SDR.
 *
 * @example
 * ```ts
 * const render = plugin.video.render();
 * render.onStatus((s) => {
 *   if (s.state === "failed" && s.error.code === "unsupported") hideHdrMenu();
 * });
 * render.set({ toneMapping: "bt.2390", targetPeak: 250 });
 * ```
 */
export interface RenderOptions extends Disposable {
  /** Merged into the current settings; last write wins. */
  set(value: Partial<RenderSettings>): void;
  /**
   * `failed` with `unsupported` while the player renders in software;
   * `failed` with `failed` when mpv cannot compile a shader (pushed later).
   */
  readonly status: FilterStatus;
  /** The status changed (including later pushes such as shader compile errors). */
  onStatus(listener: (status: FilterStatus) => void): Disposable;
}

// ---------------------------------------------------------------- subtitles

/** A subtitle track of the current source. */
export interface SubtitleTrack {
  /** Stable while the track exists; compare tracks by id. */
  id: string;
  /** Inside the container, or loaded from a file. */
  kind: "embedded" | "external";
  /** The container's subtitle track number, for embedded tracks only. */
  embeddedId?: number;
  /** Track title. */
  title: string;
  /** Language tag, `null` when unknown. */
  language: string | null;
  /** {@link Subtitles.setStyle} applies to this track. */
  styleSupported: boolean;
  /** Why the style does not apply, `null` when it does. */
  styleReason: string | null;
  /** Loaded by this plugin, so `remove()` may delete it. */
  owned: boolean;
  /** The backend's codec name, e.g. "subrip", "ass", "hdmv_pgs_subtitle". */
  codec: string | null;
  /** Text cues (subrip, ass, ssa, webvtt, mov_text, text), not bitmaps. */
  text: boolean;
  /**
   * The container stream number (`ffmpeg -map 0:<n>`) of an embedded track,
   * when the player can vouch for it; `null` for external tracks and network sources.
   */
  streamIndex: number | null;
}

/** The subtitle state of the current source. */
export interface SubtitlesState {
  /** The source it belongs to ({@link PlayerState.sourceId}). */
  readonly sourceId: number;
  /** The source phase. */
  readonly phase: string;
  /** Every track. */
  readonly tracks: SubtitleTrack[];
  /** The primary subtitle, `null` when off. */
  readonly selected: SubtitleTrack | null;
  /** The secondary subtitle, shown together with `selected`. */
  readonly secondary: SubtitleTrack | null;
  /** Fonts a style can use (`fontId`). */
  readonly fonts: {
    /** Pass as {@link SubtitleStyle.fontId}. */
    id: string;
    /** Font family name for display. */
    family: string;
  }[];
  /** The effective style, from whichever plugin set it last. */
  readonly style: SubtitleStyle | null;
  /** Whether the renderer confirmed the selection. */
  readonly trackConfirmation: "waiting" | "applied" | "uncertain";
  /** Whether the renderer confirmed the style. */
  readonly styleConfirmation: "waiting" | "applied" | "uncertain";
  /** The last error, `null` without one. */
  readonly error: string | null;
}

/** Subtitle calls act on the selection you see; pass `ifCurrent` to pin an older one. */
export interface SubtitleConditional {
  /** The subtitle state the call is conditional on; `stale` otherwise. */
  ifCurrent?: SubtitlesState;
}

/**
 * `plugin.subtitles`: tracks, uploads and style. Reading needs
 * `subtitles.read`, changes need `subtitles.control`.
 *
 * @example Load an SRT file as the secondary subtitle
 * ```ts
 * const bytes = await readFile(path);
 * const track = await plugin.subtitles.load(bytes, { title: "English", select: "secondary" });
 * await plugin.subtitles.setStyle({
 *   fontId: plugin.subtitles.state!.fonts[0]!.id,
 *   fontSize: 40,
 *   color: "white",
 *   outline: 2,
 *   marginPercent: 5,
 *   offsetMs: 0,
 * });
 * ```
 */
export interface Subtitles {
  /** `null` until first read. */
  readonly state: SubtitlesState | null;
  /** The subtitle state changed. */
  onChange(listener: (state: SubtitlesState) => void): Disposable;
  /** Read the state from the player now. */
  refresh(): Promise<SubtitlesState>;
  /**
   * `role: "secondary"` sets the secondary subtitle: a text track that is not
   * the primary one (`invalid` otherwise). A new source clears it.
   * `track: null` turns the role off.
   */
  select(
    track: SubtitleTrack | null,
    options?: SubtitleConditional & { role?: "primary" | "secondary" },
  ): Promise<SubtitlesState>;
  /**
   * Upload a subtitle file's bytes (UTF-8 SRT, or ASS/SSA with
   * `format: "ass"`) for the current source; select it unless
   * `select: "none"`. `title` (1–200 characters) names the track. Aborting
   * `signal` before the commit discards the upload (rejects with AbortError);
   * once the commit was sent it completes.
   *
   * Limits: SRT ≤ 2 MiB and ≤ 10,000 cues; ASS ≤ 2 MiB with `[Script Info]`
   * and `[Events]` and 1–20,000 `Dialogue:` lines. Convert other formats
   * (VTT, SAMI) to SRT first.
   */
  load(
    bytes: Uint8Array,
    options?: SubtitleConditional & {
      format?: "srt" | "ass";
      title?: string;
      select?: "primary" | "secondary" | "none";
      signal?: AbortSignal;
    },
  ): Promise<SubtitleTrack>;
  /** Remove a track this plugin loaded. */
  remove(
    track: SubtitleTrack,
    options?: SubtitleConditional,
  ): Promise<SubtitlesState>;
  /** This plugin's style layer; `null` removes it. Last write wins. */
  setStyle(
    style: SubtitleStyle | null,
    options?: SubtitleConditional,
  ): Promise<SubtitlesState>;
}

// ---------------------------------------------------------------- capture and export

/**
 * Options of {@link MediaCapture.capture}. Conditional on `player.state`
 * like other controls.
 */
export interface CaptureOptions extends Conditional {
  /** Source time; defaults to the current position at the moment of capture. */
  at?: number;
  /** Include this plugin set's effects (and subtitles unless `subtitles: false`). */
  processed?: boolean;
  /** With `processed`, include the primary subtitle (default true). */
  subtitles?: boolean;
  /** Audio to freeze with the snapshot: the selected track, none, or a track id. */
  audio?: "selected" | "none" | number;
}

/** A frozen, immutable input for exports. Dispose to release it. */
export interface Snapshot extends Disposable {
  /** Without or with effects. */
  readonly kind: "raw" | "processed";
  /** Source time in seconds. */
  readonly time: number;
  /** The source path or URL. */
  readonly source: string;
  /** Media duration in seconds (the backend's estimate). */
  readonly duration: number;
  /** The frozen audio track id, `null` for none. */
  readonly audioTrack: number | null;
  /** Processed snapshots: output size and the frozen processing revision. */
  readonly presentation: {
    /** Output width in pixels. */
    width: number;
    /** Output height in pixels. */
    height: number;
  } | null;
  /** The frozen processing revision (processed snapshots). */
  readonly processingRevision: number | null;
  /**
   * Start exporting; the job runs in the host's offline worker.
   * One snapshot can be exported several times.
   */
  export(options: ExportOptions): Promise<ExportJob>;
}

/**
 * One frame as PNG, JPEG (`quality` 1–100, default 90) or BMP (24-bit), or
 * a clip as MP4.
 *
 * `destination` is never overwritten if it exists. The extension does not
 * choose the format. `sampleTime` picks the frame (default: the snapshot
 * time); `end` is the clip's end in source seconds. On Windows the export
 * worker needs FFmpeg 6.1 or newer.
 */
export type ExportOptions =
  | {
      /** A lossless frame. */
      format: "png" | "bmp";
      /** Absolute path of the new file. */
      destination: string;
      /** The frame's source time; default the snapshot time. */
      sampleTime?: number;
    }
  | {
      /** A JPEG frame. */
      format: "jpeg";
      /** Absolute path of the new file. */
      destination: string;
      /** The frame's source time; default the snapshot time. */
      sampleTime?: number;
      /** Integer 1–100, default 90. */
      quality?: number;
    }
  | {
      /** A clip from the snapshot time. */
      format: "mp4";
      /** Absolute path of the new file. */
      destination: string;
      /** Clip end, source seconds. */
      end: number;
    };

/**
 * An export job's state. `status` is `queued`, `running`, `cancelling`,
 * `completed`, `failed` or `cancelled`; once terminal, `outcome` is
 * `{ destination }`, `{ error: { code, message } }` or `{ cancelled: true }`.
 * `facts` describes what the worker produced (versions, range, streams).
 */
export type JobState = Omit<MediaJob, "jobId">;

/** An export, from {@link Snapshot.export}. Disposing an unfinished job cancels it. */
export interface ExportJob extends Disposable {
  /** Latest state. */
  readonly state: JobState;
  /** The state changed. */
  onChange(listener: (state: JobState) => void): Disposable;
  /** Resolves with the terminal state (completed, failed or cancelled). */
  readonly done: Promise<JobState>;
  /** Ask to cancel: `requested`, `tooLate` (already publishing) or `terminal` (already over). */
  cancel(): Promise<"requested" | "tooLate" | "terminal">;
  /** Read the state from the player now. */
  refresh(): Promise<JobState>;
}

/**
 * `plugin.media`: snapshots and exports. Needs `media.read` and
 * `media.control` (processed snapshots also `playback.read` and
 * `subtitles.read`). Exports decode offline and do not disturb playback.
 *
 * @example Save the current frame as JPEG
 * ```ts
 * const seen = plugin.player.state;
 * const destination = await plugin.dialogs.saveFile({ fileName: "frame.jpg" });
 * if (!destination) return;
 * const snapshot = await plugin.media.capture({ ifCurrent: seen, processed: true });
 * try {
 *   const job = await snapshot.export({ format: "jpeg", destination, quality: 85 });
 *   const end = await job.done;
 *   if (end.status !== "completed") throw new Error(`export ${end.status}`);
 * } finally {
 *   await snapshot.dispose();
 * }
 * ```
 */
export interface MediaCapture {
  /**
   * Freeze the current source (and optionally this plugin set's effects)
   * as an input for exports. Fails `stale` when the source changed since
   * `ifCurrent`; `unsupported` for an external ASS track with subtitles; `noSource` when nothing is playing.
   */
  capture(options?: CaptureOptions): Promise<Snapshot>;
}

// ---------------------------------------------------------------- source resolvers

/** Declaration of {@link Resolvers.add}. */
export interface ResolverOptions {
  /** Local id, unique within the plugin. */
  id: string;
  /** URL schemes handled. */
  schemes: ("http" | "https")[];
  /** Exact host names. */
  hosts: string[];
  /** Turn a page URL into playable stream URLs. */
  resolve(url: string, signal: AbortSignal): Promise<ResolvedMedia>;
}

/** A registered resolver. Disposing it unregisters it and aborts resolutions in flight. */
export interface Resolver extends Disposable {
  /** Resolves when the player registered it; rejects (e.g. `conflict`) otherwise. */
  readonly ready: Promise<void>;
}

/**
 * `plugin.resolvers`: turn web page URLs into playable streams. Needs
 * `source.resolve`.
 *
 * @example
 * ```ts
 * plugin.resolvers.add({
 *   id: "example",
 *   schemes: ["https"],
 *   hosts: ["video.example.com"],
 *   async resolve(url, signal) {
 *     const page = await (await fetch(url, { signal })).json();
 *     return { kind: "media", originalUrl: url, title: page.title, primary: { url: page.stream } };
 *   },
 * });
 * ```
 */
export interface Resolvers {
  /**
   * Register a resolver. When anyone opens a matching URL the player calls
   * `resolve`; `signal` aborts when the open is cancelled or replaced. One
   * scheme + host pair has one resolver (`conflict` otherwise).
   */
  add(options: ResolverOptions): Resolver;
}

// ---------------------------------------------------------------- packages (plugins.manage)

/**
 * The manifest of a package, as validated. The display fields and
 * `minPlayerVersion` are optional (player 0.2.0); see the API reference for
 * their rules.
 */
export interface PackageManifest {
  /** Plugin id. */
  id: string;
  /** `x.y.z`. */
  version: string;
  /** `vestra/1`. */
  apiVersion: string;
  /** Entry module path inside the package. */
  entry: string;
  /** Declared capabilities. */
  capabilities: string[];
  /** Display name, 1–64 characters. */
  name?: string;
  /** Author, 1–64 characters. */
  author?: string;
  /** One-line summary, 1–120 characters. */
  punchline?: string;
  /** Plain-text description, 1–2000 characters. */
  description?: string;
  /** Up to 8 tags of 1–24 characters. */
  tags?: string[];
  /** Package path of a PNG or JPEG icon (≤ 512 KB, sides ≤ 1024). */
  icon?: string;
  /** Package path of the README (`.md`, ≤ 256 KB); `README.md` when present. */
  readme?: string;
  /** Package path of the changelog (`.md`, ≤ 256 KB); `CHANGELOG.md` when present. */
  changelog?: string;
  /** `https:` address of the source code. */
  sourceUrl?: string;
  /** License, preferably an SPDX expression. */
  license?: string;
  /** The oldest player version that can load the package (`x.y.z`). */
  minPlayerVersion?: string;
}

/**
 * Where an installed plugin came from. Installs with the same source
 * upgrade the plugin and keep its data; links and local files count as one
 * source. `bundled` marks the player's built-in plugins (set by the player
 * only).
 */
export type PackageSource =
  | {
      /** A repository. */
      kind: "repository";
      /** The full address of its `index.json`. */
      url: string;
    }
  | {
      /** A package link. */
      kind: "link";
      /** The package's address. */
      url: string;
    }
  | {
      /** A local `.vxp` file or package directory. */
      kind: "file";
    }
  | {
      /** Generated by the plugin workshop. */
      kind: "workshop";
    }
  | {
      /** Shipped with the player (built-in). */
      kind: "bundled";
    };

/** Options of {@link PackageCandidate.install}. */
export interface InstallOptions {
  /**
   * Where the package comes from (default `{ kind: "file" }`). Repository
   * and link addresses must be `http(s)`. `bundled` is `invalid`.
   */
  source?: PackageSource;
  /**
   * Replace a plugin of the same id installed from another source (ask the
   * user first). Without it such an install fails with `conflict`. The
   * replaced plugin's data is kept; installing from its source again
   * reconnects to it.
   */
  replace?: boolean;
}

/** A validated package directory, from {@link Packages.validate}. */
export interface PackageCandidate {
  /** The package directory. */
  readonly directory: string;
  /** Content digest of the package. */
  readonly digest: string;
  /** Its manifest. */
  readonly manifest: PackageManifest;
  /** The checks the player ran. */
  readonly checks: string[];
  /** Load it temporarily alongside the installed plugins. */
  trial(): Promise<PackageTrial>;
  /**
   * Install it. The same source upgrades the installed plugin (its data
   * stays); another source fails with `conflict` unless `replace` is set;
   * a built-in id fails with `unsupported` (built-ins update with the
   * player).
   */
  install(options?: InstallOptions): Promise<PackageChange>;
}

/** A trial load of a package. Disposing it stops the trial and waits for cleanup. */
export interface PackageTrial extends Disposable {
  /** The trial's status as the player reports it. */
  readonly status: string;
  /**
   * Stop and wait until the host confirmed cleanup. Rejects with code
   * `cleanup` when the host stopped the trial without confirming cleanup;
   * calling `stop()` again then asks the host again.
   */
  stop(): Promise<void>;
}

/** The progress of an install, rollback or uninstall. */
export type PackageChangeStatus =
  | "preparing"
  | "activating"
  | "restoring"
  | "committed"
  | "cancelled"
  | "failed"
  | "failedDegraded"
  | "tooLate";

/**
 * An install, rollback or uninstall in progress. The SDK never submits a
 * change twice: after a lost reply it only queries the same request.
 */
export interface PackageChange {
  /** Current status. */
  readonly status: PackageChangeStatus;
  /** Details for failures, `null` otherwise. */
  readonly message: string | null;
  /** The status changed. */
  onChange(listener: (status: PackageChangeStatus) => void): Disposable;
  /** Resolves with the final status. */
  readonly done: Promise<PackageChangeStatus>;
  /** Ask to cancel (it may be `tooLate`). */
  cancel(): Promise<void>;
}

/** One plugin as the player knows it (`packages.list`). */
export interface PluginInfo {
  /** Manifest id. */
  id: string;
  /** Version, `null` when unknown. */
  version: string | null;
  /** From the install library, a `--plugin` development load, or a trial. */
  origin: "installed" | "development" | "trial";
  /** Run state. */
  state: "starting" | "running" | "disabled" | "failed" | "stopped";
  /** Why it failed (`state: "failed"`). */
  error: string | null;
  /** Declared capabilities. */
  capabilities: string[];
  /** The package directory (read its `manifest.json` for display fields). */
  directory: string;
  /** The version a rollback would restore, `null` without one. */
  previousVersion: string | null;
  /**
   * Shipped with the player: it can be disabled, not uninstalled or
   * replaced. `false` from players before 0.2.0.
   */
  builtin: boolean;
  /** Where an installed plugin came from; `null` for development loads and trials. */
  source: PackageSource | null;
  /**
   * Its data directory (`plugin.dataDirectory` of that plugin); `null` when
   * the player has none. The path's layout is not part of the API.
   */
  dataDirectory: string | null;
}

/**
 * `plugin.packages`: the plugins the player knows. `list` and `onChange`
 * need no capability; everything else needs `plugins.manage`.
 *
 * @example
 * ```ts
 * const candidate = await plugin.packages.validate(unpackedDirectory);
 * const change = await candidate.install();
 * if ((await change.done) !== "committed") throw new Error(change.message ?? "install failed");
 * ```
 */
export interface Packages {
  /** Validate a package directory (`plugins.manage`). */
  validate(directory: string): Promise<PackageCandidate>;
  /**
   * Validate a `.vxp` package file (`plugins.manage`, player 0.2.0): the
   * same checks as {@link Packages.validate} after unpacking. Check the
   * file's sha256 yourself before calling when you know it.
   */
  validateArchive(file: string): Promise<PackageCandidate>;
  /** Restore a plugin's previous version (`plugins.manage`). */
  rollback(id: string): Promise<PackageChange>;
  /** Every plugin: running, installed, and this run's development loads. No capability. */
  list(): Promise<PluginInfo[]>;
  /** The new list after any start, stop, failure, install or uninstall. No capability. */
  onChange(listener: (plugins: PluginInfo[]) => void): Disposable;
  /**
   * Stop or start a plugin (`plugins.manage`). An installed plugin stays
   * disabled across launches; a development load only for this run.
   * `invalid` to disable oneself, `unsupported` for a trial, `missing` unknown.
   * `busy` while it is being installed.
   */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /**
   * Remove an installed plugin (`plugins.manage`); `removeData` also deletes
   * its data directory, otherwise reinstalling it from the same source
   * reconnects to its data. Its user bindings stay (as orphans).
   * `unsupported` for built-ins, development loads and trials, `missing`
   * unknown, `invalid` for oneself.
   */
  uninstall(
    id: string,
    options?: { removeData?: boolean },
  ): Promise<PackageChange>;
}

// ---------------------------------------------------------------- bindings (bindings.manage)

/** A command: manifest id (`"host"` for the player's own) and command id. */
export interface BindingRef {
  /** Manifest id, or `"host"`. */
  plugin: string;
  /** Command id within that plugin. */
  command: string;
}

/** One command's bindings, from {@link Bindings.list}. */
export interface BindingInfo extends BindingRef {
  /** Menu title. */
  title: string;
  /** Menu path; `null` for a command outside the menu. */
  path: string[] | null;
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
 * @example "Ignore the default shortcut" for one command
 * ```ts
 * await plugin.bindings.set({ plugin: "host", command: "mute" }, []);
 * // later
 * await plugin.bindings.reset({ plugin: "host", command: "mute" });
 * ```
 */
export interface Bindings {
  /** Every declared command, and overrides whose command is gone. */
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
   */
  set(ref: BindingRef, inputs: string[]): Promise<void>;
  /** Back to the defaults: one command, or every override when omitted. */
  reset(ref?: BindingRef): Promise<void>;
  /** Declarations or overrides changed (read `list()` again). At most every 200 ms. */
  onChange(listener: () => void): Disposable;
}

// ---------------------------------------------------------------- shared services

/**
 * The system clipboard (`clipboard`). Unavailable without a user interface.
 *
 * Platforms: macOS writes text as UTF-8 and images as their original
 * PNG/JPEG bytes; Windows writes Unicode text and images as a bitmap plus
 * PNG. Other systems: `unsupported`. Failures: `invalid`, `missing`,
 * `unavailable`, `failed` (the system refused).
 *
 * @example
 * ```ts
 * await plugin.clipboard.writeText(`${plugin.player.state.source} @ ${plugin.player.state.position}`);
 * ```
 */
export interface Clipboard {
  /** Plain text on the clipboard; `null` when it holds none. */
  readText(): Promise<string | null>;
  /** Replace the clipboard with text (at most 1 MiB of UTF-8). */
  writeText(text: string): Promise<void>;
  /** Replace the clipboard with a PNG or JPEG file (absolute path, at most 16 MB). */
  writeImage(path: string): Promise<void>;
}

/** Keeping the computer awake (`playback.control`). */
export interface Power {
  /**
   * `"playing"`: while a source is ready and not paused, keep the display
   * (video) or the system (audio only) from sleeping. Any plugin asking is
   * enough; a stopped plugin's request is withdrawn.
   *
   * It only registers the request (`invalid` for a bad mode); failures to
   * take the system assertion are logged by the player, not reported.
   * macOS uses `caffeinate`, Windows the thread execution state; elsewhere
   * it has no effect.
   */
  preventSleep(mode: "off" | "playing"): Promise<void>;
}

/** The output of {@link Tools.run}. */
export interface ToolResult {
  /** Standard output (at most `maxOutput` bytes). */
  stdout: Uint8Array;
  /** The last 64 KiB of standard error. */
  stderr: string;
}

/**
 * `plugin.tools`: ffmpeg and ffprobe, run in this plugin's process. No
 * capability.
 *
 * @example
 * ```ts
 * if (await plugin.tools.available("ffprobe")) {
 *   const { stdout } = await plugin.tools.run(
 *     "ffprobe",
 *     ["-v", "error", "-show_format", "-of", "json", path],
 *     { timeoutMs: 10_000 },
 *   );
 *   const info = JSON.parse(new TextDecoder().decode(stdout));
 * }
 * ```
 */
export interface Tools {
  /**
   * Run ffmpeg or ffprobe (found through `VESTRA_FFMPEG` / `VESTRA_FFPROBE`,
   * then `PATH`) without a shell. Rejects `unavailable` (not found), `timeout`,
   * `failed` (non-zero exit; `message` is the last stderr line), `invalid`
   * (output over `maxOutput`, default 16 MiB), `aborted` (`signal`). Timeout,
   * `signal` and disposing the scope end the process.
   *
   * Arguments are passed as-is (no quoting needed). On Windows `PATHEXT` is
   * honoured. Ending sends SIGTERM, then SIGKILL after 300 ms (immediate on
   * Windows).
   */
  run(
    tool: "ffmpeg" | "ffprobe",
    args: string[],
    options: { timeoutMs: number; maxOutput?: number; signal?: AbortSignal },
  ): Promise<ToolResult>;
  /** Whether the tool can be found. */
  available(tool: "ffmpeg" | "ffprobe"): Promise<boolean>;
}

/** A JSON file `dataDirectory/<name>.json`, loaded once and saved debounced. */
export interface JsonStore<T> extends Disposable {
  /** The loaded value, or `defaults` when the file was missing or broken. */
  readonly value: T;
  /**
   * Replace the value now and write it after `debounceMs`.
   * Only `save` writes: mutating `value` in place is not saved.
   */
  save(next: T): void;
  /** Write a pending save now. */
  flush(): Promise<void>;
}

/** `plugin.storage`: JSON settings files. No capability. */
export interface Storage {
  /**
   * Open `<name>.json` (`name`: 1–64 of `a-z 0-9 -`). A file that cannot be
   * parsed or fails `validate` is renamed `<name>.json.bad-<timestamp>` and
   * `defaults` is used. Writes go to a temporary file, then a rename. Disposal
   * (and stopping the plugin) flushes first.
   *
   * The file is read synchronously on creation; `debounceMs` defaults to
   * 300. Files are created with mode 0600. `invalid` for a bad name.
   *
   * @example
   * ```ts
   * type Settings = { resume: boolean; recent: string[] };
   * const store = plugin.storage.json<Settings>("settings", {
   *   defaults: { resume: true, recent: [] },
   *   validate: (v): v is Settings =>
   *     typeof v === "object" && v !== null && typeof (v as Settings).resume === "boolean",
   * });
   * store.save({ ...store.value, recent: [path, ...store.value.recent].slice(0, 10) });
   * ```
   */
  json<T>(
    name: string,
    options: {
      defaults: T;
      validate?: (value: unknown) => value is T;
      debounceMs?: number;
    },
  ): JsonStore<T>;
}

/**
 * `plugin.system`: files and links, executed by the player. No capability.
 * Other systems than macOS and Windows: `unsupported`.
 *
 * @example
 * ```ts
 * await plugin.system.reveal(exportedFile);
 * await plugin.system.openUrl("https://example.com/help");
 * ```
 */
export interface System {
  /**
   * Select files or folders in the file manager (macOS: one Finder window
   * for all, so several files of one folder are all highlighted; Windows:
   * one Explorer window per folder, selecting its first path). Paths that do
   * not exist are skipped; `missing` when none exists; at most 256.
   */
  reveal(paths: string | string[]): Promise<void>;
  /** Open the file or folder with its default application. `missing` if absent. */
  openPath(path: string): Promise<void>;
  /**
   * Open an http(s) address in the default browser. `invalid` for another
   * protocol or a malformed address; `timeout` after 10 s, `failed` otherwise.
   */
  openUrl(url: string): Promise<void>;
}

/**
 * Per-plugin secrets (API keys, passwords) in the system's secret store:
 * the login keychain on macOS, the Credential Manager on Windows. Needs
 * `secrets`. `unsupported` on systems without a store, `unavailable` when
 * the store refuses access: keep a fallback (or ask again).
 *
 * The user denying access and other system errors reject `failed`. Never
 * write secrets to settings files.
 *
 * @example
 * ```ts
 * let token = await plugin.secrets.get("api-token");
 * if (token === null) {
 *   token = await askUser();
 *   await plugin.secrets.set("api-token", token);
 * }
 * ```
 */
export interface Secrets {
  /** The stored value, `null` when there is none. */
  get(name: string): Promise<string | null>;
  /**
   * Store or replace (`name`: 1–64 of `a-z 0-9 . _ -`; value 1–1024 bytes).
   * At most 256 different names per plugin: a new name beyond that rejects
   * `limit`. Uninstalling with `removeData` deletes them.
   */
  set(name: string, value: string): Promise<void>;
  /** Remove; removing a missing secret is fine. */
  delete(name: string): Promise<void>;
}
