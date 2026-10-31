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
 * @example Stop listening once the file is ready
 * The listener reacts to the first time the source becomes ready and then
 * stops being called. Every registration returns a `Disposable`;
 * disposing it removes just that listener, before the scope that owns it
 * ends.
 * ```ts
 * const subscription = plugin.player.onChange((state) => {
 *   if (state.phase === "ready") void subscription.dispose();
 * });
 * ```
 *
 * @remarks
 * Every handle a plugin creates is a `Disposable` owned by the scope that
 * created it; disposing the scope (or stopping the plugin) disposes them in
 * reverse creation order, so a plugin rarely calls `dispose` itself.
 *
 * @capability None of its own: that of the handle.
 * @since 1.0.0
 * @category Plugin
 */
export interface Disposable {
  /**
   * Release the resource. Resolves once the player confirmed the release
   * (or immediately for purely local resources). Never rejects.
   *
   * @capability None of its own: that of the handle.
   * @throws Never.
   *
   * @example Remove a command when its feature is turned off
   * A "Turn feature off" item removes the feature's own menu item at once,
   * before the plugin stops. `dispose` takes the command out of the menu and
   * the binding table and resolves once the player confirmed it; the id can
   * be added again later.
   * ```ts
   * const extra = plugin.commands.add({ id: "extra", path: ["Tools", "Extra"], run() {} });
   * plugin.commands.add({
   *   id: "extra-off",
   *   path: ["Tools", "Turn extra off"],
   *   run: () => extra.dispose(), // never rejects
   * });
   * ```
   *
   * @since 1.0.0
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
 * | `limit` | A player-wide limit was reached (for example the number of commands), a property value is over the limits of {@link PropValue}, or a request is longer than the player's 1 MiB message. |
 * | `reserved` | {@link Packages.validate}, {@link PackageCandidate.install}: the id is `vestra` or starts with `vestra.` (any case), which only the player's built-in plugins use (player 0.4.1). |
 * | `versionMismatch` | The package needs a newer player (`minPlayerVersion`). |
 * | `ui-prepare` | The player could not prepare a mounted panel or a settings page (its Slint file does not compile, a bound property is not declared, or another plugin's panel holds the slot); `message` has the diagnostics. |
 * | `ui` | The player could not apply a property to a tool window or a settings page, or could not build the Options window (a property the Slint file does not declare, a value of the wrong type); `message` has Slint's reason. Also reported to {@link Scope.onError} without a request: a callback whose arguments the player could not convert, a property it could not show again when it rebuilt a view (an image file removed since). |
 * | `host` | Any other failure inside the player; `message` is the player's reason. |
 * | `disabled` | The plugin is being stopped; pending requests fail with it. |
 * | `unknown`, `rejected`, `expired` | After a transport problem the SDK could not confirm the outcome (does not happen in normal operation). |
 * | `activation` | The plugin opened a tool window while its activation was still pending and the player could not track it. |
 * | `command` | The player could not run or update a command it no longer knows for this plugin (removed meanwhile, or another plugin's). |
 * | `input-overflow` | `openStream` input: the player's queue of physical key transitions was full; the input was revoked and its keys released. |
 * | `internal` | An internal step of the player failed (keeping an operation's result, a subtitle or media job); `message` has the reason. |
 * | `javascript`, `slint` | {@link Packages.validate}: the package's entry module does not pass `node --check` / one of its Slint files does not compile; `message` has the diagnostics. |
 * | `owner` | A resolver answered a request that belongs to another plugin's resolver. |
 * | `pending` | An operation with the same token is still running in the player. The SDK waits and asks again, so it rarely reaches a plugin. |
 * | `producer` | `openStream`: the player refused or lost the generated stream; `message` has the reason. |
 * | `resolution` | A file or web resolver's result could not be opened; `message` has the reason. |
 * | `revisionConflict` | {@link Packages}: the installed revision changed since it was read (another install or uninstall ran). Read again and retry; the SDK passes the revision it read, so this reaches plugins that act on old data. |
 * | `source-geometry`, `source-geometry-unsupported` | The source's picture size or rotation could not be applied: invalid decoder dimensions / a rotation that is not a multiple of 90°. |
 * | `source-unavailable` | The source is not ready (still loading, or its time or native binding is not available yet). |
 * | `unknown-expired` | The player no longer knows the operation or snapshot (it expired or was released). The SDK maps it to `unknownExpired` results where it can; do not resubmit the operation blindly. |
 *
 * Errors thrown by handlers the SDK invokes go to {@link Scope.onError}. A
 * rejected promise you forgot to `await` is only logged; it never crashes
 * the plugin process. Requests have no client-side timeout: the player
 * answers every request or stops the plugin.
 *
 * @example Ignore a seek that lost a race, rethrow anything else
 * The plugin seeks to 0:30 and stays quiet when another file was opened in
 * between. Every failure is an `Error` with a stable `code`; `stale` means
 * the source changed since the state the call was based on and nothing
 * was done, so it is safe to drop. Other codes are real failures.
 * ```ts
 * try {
 *   await plugin.player.seek(30);
 * } catch (error) {
 *   if ((error as PluginError).code === "stale") return; // someone else changed the source
 *   throw error;
 * }
 * ```
 *
 * @since 1.0.0
 * @category Plugin
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
 * @example Rebuild a dynamic submenu with a child scope
 * Subtitles ▸ Track lists the current file's subtitle tracks and is
 * rebuilt whenever they change. Commands added through a child scope
 * belong to it; disposing the scope removes all of them at once, and a
 * new child scope collects the next set.
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
 *
 * @remarks
 * Every module of the API (`commands`, `windows`, `player`…) is reachable
 * from a scope, and every handle made through it belongs to it. A child
 * scope from {@link Scope.scope} is the unit for features that come and
 * go: dispose the child and everything it created is released, while the
 * rest of the plugin keeps running.
 *
 * @capability That of each module (see the modules).
 * @since 1.0.0
 * @category Plugin
 */
export interface Scope extends Disposable {
  /** Menu commands and their default bindings (`commands`). */
  readonly commands: Commands;
  /**
   * Conditions on the player's own state for a command's `enabled` and
   * `checked` (SDK 1.5.40, player 0.5.21): the player evaluates them, so
   * the menu follows playback even while the plugin is stopped. See
   * {@link When}.
   */
  readonly when: When;
  /** Tool windows from `.slint` files (`ui.window`). */
  readonly windows: Windows;
  /** Docked panels: bottom bar, sidebar and backdrop (`ui.mount`). */
  readonly panels: Panels;
  /** Native file dialogs and confirmation alerts (`ui.dialog`). */
  readonly dialogs: Dialogs;
  /** Playback state and controls (`playback.read`, `events`, `playback.control`). */
  readonly player: Player;
  /**
   * Video processing: this plugin's filter chain, the display layer, the
   * GPU render options and the GPU's video upscaler. The first three need
   * `processing.video` and `playback.read`; the filter chain also needs
   * `events` (without it the SDK never sees the media become ready and the
   * chain stays `waiting`). The upscaler needs `video.upscaling` only.
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
     * owner disposes or stops.
     *
     * @throws `capability` (throws) The manifest does not declare
     *   `processing.video`.
     * @throws `Error` without a code (throws) A second call in the same plugin
     *   while the first view is not disposed.
     */
    view(): VideoView;
    /**
     * The GPU renderer's options (needs `processing.video`), owned like the
     * display layer. Under software rendering the handle is `failed` with
     * `unsupported` after the player's first answer, and `onError` hears it.
     *
     * @throws `capability` (throws) The manifest does not declare
     *   `processing.video`.
     * @throws `Error` without a code (throws) A second call in the same plugin
     *   while the first handle is not disposed.
     */
    render(): RenderOptions;
    /**
     * The GPU's video upscaler (NVIDIA RTX Video Super Resolution on
     * Windows; needs `video.upscaling`, player 0.5.16): whether it works
     * here and why not, and turning it on or off for this plugin.
     */
    readonly upscaling: VideoUpscaling;
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
  /** The installed plugins; validation, installs (`plugins.manage` for changes). */
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
  /** GPU or software rendering: read the choice, change it (`rendering.manage`). */
  readonly rendering: Rendering;
  /** Every command's bindings and the user's overrides (`bindings.manage`). */
  readonly bindings: Bindings;
  /** Runtime images for Slint `image` properties. */
  readonly ui: Ui;
  /** Marks on the seek bar, merged from every plugin's layer. */
  readonly timeline: Timeline;
  /** Files dropped on the video area, by extension (`ui.drop`). */
  readonly drops: Drops;
  /** The player's palette and the saved interface language. */
  readonly appearance: Appearance;
  /** The interface language of this run (read-only). */
  readonly i18n: I18n;
  /** Pages in the player's options window (`ui.settings`). */
  readonly settings: Settings;
  /**
   * A child scope; disposing it releases only what was created through it.
   * The child is itself owned by this scope.
   *
   * @capability None.
   *
   * @example Tie a temporary window and its timer to one feature
   * A "Live stats" feature opens a window and starts a timer; turning it off
   * releases both together. Everything made through the child scope, and
   * cleanups registered on it, go when the child is disposed; the parent
   * scope is untouched.
   * ```ts
   * let live: Scope | null = null;
   * plugin.commands.add({
   *   id: "live-stats",
   *   path: ["Tools", "Live stats"],
   *   checked: () => live !== null,
   *   run: async () => {
   *     if (live) {
   *       await live.dispose(); // closes the window, stops the timer
   *       live = null;
   *       return;
   *     }
   *     live = plugin.scope();
   *     const window = live.windows.create("ui/stats.slint");
   *     const timer = setInterval(() => live?.update(), 1000);
   *     live.onDispose(() => clearInterval(timer));
   *     await window.show();
   *   },
   * });
   * ```
   *
   * @since 1.0.0
   */
  scope(): Scope;
  /**
   * Adopt an existing handle: it is disposed together with this scope.
   *
   * @param item - Any {@link Disposable}, for example a handle created
   *   through another scope.
   * @returns `item` itself, for chaining.
   *
   * @capability None.
   *
   * @example Dispose a handle from another scope together with this one
   * A filter made through the root scope is withdrawn when a child feature
   * ends. `add` hands an existing disposable to this scope, which then
   * disposes it with its own handles; it returns the same handle for
   * chaining.
   * ```ts
   * const feature = plugin.scope();
   * const blur = feature.add(plugin.video.filter("blur")); // now ends with `feature`
   * blur.set([{ kind: "gblur", sigma: 4, steps: 3 }]);
   * ```
   *
   * @since 1.0.0
   */
  add<T extends Disposable>(item: T): T;
  /**
   * Run `cleanup` when this scope is disposed (for example `clearInterval`
   * or closing a socket). It may be async; errors are logged.
   *
   * @returns A handle that cancels the registration early (without
   *   running `cleanup`).
   *
   * @example Stop a timer when the plugin stops
   * A once-a-second refresh runs as long as the plugin does. `onDispose`
   * runs the cleanup when the scope is disposed, which for `plugin` is
   * when the player stops the plugin, so the timer never outlives it.
   * ```ts
   * const timer = setInterval(() => plugin.update(), 1000); // re-evaluate bindings
   * plugin.onDispose(() => clearInterval(timer));
   * ```
   *
   * @capability None.
   * @since 1.0.0
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
   * @example Show errors from handlers on the OSD
   * When a menu command, a window callback or a listener of the plugin
   * fails, the user sees why. The SDK catches what those handlers throw
   * (and their rejected promises) and passes it here instead of only
   * logging it; the message is data in a translated template.
   * ```ts
   * plugin.onError((error) => {
   *   void plugin.osd.show("Bookmarks: {}", [error.message]);
   * });
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  onError(listener: (error: PluginError) => void): Disposable;
  /**
   * Re-evaluate every bound value (`bind()` functions and command state
   * functions) and send what changed. The SDK already does this after each
   * handler it invokes and when that handler's promise settles; call it after
   * changing state from your own timers or between awaits of a long task.
   *
   * Several calls within one microtask are merged into one pass.
   *
   * @capability None.
   *
   * @example Show progress from a long task between awaits
   * A progress label moves while a long download runs, not only when it
   * ends. The SDK re-evaluates bound values after each handler and when its
   * promise settles; state changed between the awaits of a long handler
   * shows only after an explicit `update()`.
   * ```ts
   * declare const window: Window;
   * declare function downloadPart(part: number): Promise<void>;
   * // ---cut---
   * let done = 0;
   * window.bind(() => ({ progress: done }));
   * window.on("start", async () => {
   *   for (let part = 0; part < 10; part++) {
   *     await downloadPart(part);
   *     done = part + 1;
   *     plugin.update(); // send `progress` now, not when the handler ends
   *   }
   * });
   * ```
   *
   * @since 1.0.0
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
 * @example Write a minimal plugin with one menu item
 * Tools ▸ Say hello, or Ctrl+H, shows "Hello from" and the plugin's id.
 * The player imports `main.ts`, calls its default export with the
 * `Plugin` object, and keeps the registrations made during activation;
 * the manifest declares the capabilities `commands` and `ui.osd`.
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 *
 * export default async function activate(plugin: Plugin) {
 *   plugin.commands.add({
 *     id: "hello",
 *     path: ["Tools", "Say hello"],
 *     bindings: ["Ctrl+H"], // a default the user can change
 *     run: () => plugin.osd.show("Hello from {}", [plugin.id]),
 *   });
 * }
 * ```
 *
 * @remarks
 * The root scope: disposing it is what stopping the plugin does. Besides
 * the modules of {@link Scope}, it carries the plugin's `id` and its
 * `dataDirectory`.
 *
 * @capability That of each module (see the modules).
 * @see [How a plugin runs](../../docs/concepts/plugins.md)
 * @since 1.0.0
 * @category Plugin
 */
export interface Plugin extends Scope {
  /** The manifest id, e.g. `"community.bookmark"`. */
  readonly id: string;
  /**
   * A writable directory for this plugin's own files (settings, caches,
   * remembered folders), created by the player before it starts the plugin.
   * Each installation has its own directory (player 0.2.0): it is kept across
   * restarts, disabling and upgrades, and a reinstall of the same
   * id from a different source gets a new, empty one. It is deleted only by
   * `packages.uninstall(id, { removeData: true })`. No capability.
   *
   * The path's format is not part of the API: do not derive another
   * plugin's directory from it (a plugin manager reads
   * {@link PluginInfo.dataDirectory}). Write files atomically (to a
   * temporary name, then rename); for JSON settings prefer
   * {@link Scope.storage}. Throws `unavailable` when the player provided
   * none. See [How a plugin runs](../../docs/concepts/plugins.md#the-data-directory).
   */
  readonly dataDirectory: string;
}

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
   * Shown when the command is disabled or busy: English source text the
   * player translates, or a {@link Text} (SDK 1.5.11).
   */
  reason: TextValue | null;
}

/**
 * A value, or a function the SDK re-evaluates on every update pass (see
 * {@link Scope.update}); only changes are sent to the player.
 *
 * @example Mix a computed state with a fixed one
 * The Loop item carries a check mark while a loop is set and is always
 * enabled. A function is evaluated again in every update pass (after each
 * handler and player state change) and only changes are sent; a plain
 * value never changes.
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
 * `plugin.when`: the vocabulary of conditions (SDK 1.5.40, player 0.5.21).
 * It names only state the player owns: the source's phase, kind, pause
 * and controls (the same names as {@link PlayerState}), fullscreen, the
 * palette and the saved interface language.
 *
 * @remarks
 * Give a condition as a command's `enabled` or `checked`
 * ({@link CommandOptions}, {@link Command.set}). The player evaluates it
 * and shows the result in menus, on keys and on bar buttons, again
 * whenever that state changes, also while the plugin is stopped because
 * nothing used it. With an `enabled` condition the player shows the
 * command's `reason` only while the condition is false (or the command
 * is busy), so a fixed reason is enough. Players before 0.5.21 have no
 * `plugin.when` (declare `"minPlayerVersion": "0.5.21"`).
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
 * A built-in top-level menu of the player, named in a command path as
 * `@<id>` or by its English key (see {@link CommandOptions.path}): Open,
 * Playback, Subtitles, Video, Audio, Screen, Settings. The list is
 * `MENU_IDS` in `@vestra-player/sdk/testing`.
 *
 * @since 1.3.0
 * @category Commands
 */
export type MenuId =
  "open" | "playback" | "subtitles" | "video" | "audio" | "screen" | "settings";

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
  | "ai";

/**
 * A command's button on the bottom bar: {@link CommandOptions.button}.
 *
 * @remarks
 * **Where it shows.** The bottom bar places the player's strip of command
 * buttons, `BarButtons` from `@vestra/bar-buttons.slint`, at its right end;
 * the player fills it with the buttons of every plugin, left to right by
 * `order`, and its own sidebar toggle rightmost. When the window is narrow
 * the strip loses cells from its outer (left) end inward: the lowest order
 * goes first, the sidebar toggle last. A
 * bottom bar that does not place `BarButtons` shows no buttons: the
 * command's menu entry stays, and the player logs the buttons it cannot
 * show and whose bar hides them. The built-in bar (`vestra.playback`) places
 * it; see
 * [Writing a bottom bar](../../docs/guidelines/interface.md#writing-a-bottom-bar).
 *
 * **What it shows.** The icon, the command's title (translated, a trailing
 * "…" removed) and its first key as the tooltip ("Plugin Store (F9)"),
 * `enabled`, `busy` and `reason` as the menu item has them: a disabled or
 * busy command's button is drawn disabled, its tooltip adds the reason, and
 * a click runs nothing. A command with `checked` shows its icon in the
 * accent colour while checked. A click runs the command exactly like a
 * click on its menu item.
 *
 * **Limits.** One button per plugin and eight in the player
 * (`BAR_BUTTON_LIMITS`): a button past them is left out (its command and
 * menu entry stay) and the player logs it with `limit`. The button goes
 * with its command: disposing the command, or disabling, stopping or
 * uninstalling the plugin, removes it.
 *
 * @example Give a command a button in the bottom bar
 * A Store icon appears in the bottom bar's button strip; a click opens
 * the store window, exactly like the menu item. The player draws the
 * button from the command's title, keys and state, and places it by
 * `order` (200 is where the player's own Plugin Store button sits); a
 * bar that does not place `BarButtons` shows only the menu item.
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
 * @player 0.5.10; older players show the menu entry without a button
 * (declare `"minPlayerVersion": "0.5.10"` when the button matters).
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
 * audio…), `screen` 700–799, `windows` 800–899, `exit` 900–999.
 *
 * Built-in menus keep their place. The seven built-in top-level menus
 * ({@link MenuId}) sit at fixed orders, whatever is inside them: Open 110,
 * Playback 200, Subtitles 300, Video 400, Audio 500, Screen 710, Settings
 * 830 (player 0.3.0). This holds whether the path names the menu by id
 * (`["@video", "Blur"]`) or by its key (`["Video", "Blur"]`), so a plugin's
 * item never moves the player's menu. Directly inside a built-in menu,
 * `order` 0 (the default) sorts after every other order: an item without
 * `order` goes at the end, after the player's own items (which all use 100
 * or more). Give a positive order to sit between them (the player's items
 * in menu order are in
 * [Built-in commands](../../docs/reference/commands.md#built-in-commands)),
 * or a negative one to come first. Deeper levels (a plugin's own submenu) have no such rule.
 * Players before 0.3.0 place every submenu at its smallest order, so there
 * an item without `order` moves the whole menu to the top; to avoid that,
 * give it an order in the menu's range (Video: 400–499).
 *
 * {@link Commands.add} throws `invalid` synchronously for a bad path,
 * order, group or binding. The same path registered twice, or a path that
 * is both an item and a submenu, fails with `conflict` (through `ready`).
 *
 * @see {@link Commands.add}, [Commands, menus and key bindings](../../docs/concepts/commands.md)
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
   * Segments are English source text, and menus merge by them: commands
   * of different plugins with the same leading segments share a submenu.
   * The player shows each segment and the title in the interface language
   * from the declaring plugin's catalog (`locales/<lang>.po`, see the
   * [i18n guide](../../docs/how-to/i18n.md)); the player's own menus
   * (Open, Playback, Subtitles, Video, Audio, Screen, Settings, and
   * Playback ▸ Speed, Playback ▸ Seek) always show the player's words.
   * A built-in menu can also be named by its id, `@` plus a {@link MenuId}:
   * `@open`, `@playback`, `@subtitles`, `@video`, `@audio`, `@screen` or
   * `@settings`. Only the first segment is read as an id; an unknown id, or
   * an id with nothing after it, fails with `invalid`. Players up to 0.4.2
   * titled their menus in Chinese (视频…): there `["Video", "Blur"]` is a
   * menu of its own, so plugins for those players write `@video`; player
   * 0.4.3 still accepts the old Chinese titles of its own menus.
   *
   * A segment that mixes words with data (a track number, a count) is a
   * {@link Text} (SDK 1.5.11, player 0.4.3): `plugin.i18n.text("Track {}
   * ({})", [n, codec])`. The menu shows it translated and filled in; it
   * merges by its English rendering ("Track 2 (opus)").
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
   * `NumpadDivide`, `NumpadEnter`, `NumpadDecimal`, and the video-area mouse
   * inputs `Mouse:LeftClick`, `Mouse:LeftDoubleClick[:LeftHalf|:RightHalf]`,
   * `Mouse:MiddleClick`, `Mouse:X1`, `Mouse:X2`, `Mouse:WheelUp`/`Down`/`Left`/`Right`.
   *
   * Platforms: on macOS `Ctrl+X` fires for both ⌃X and ⌘X while `Cmd+X`
   * means ⌘X only; on Windows `Cmd` is the Windows logo key, so write
   * `Ctrl+…` for bindings that work on both. Avoid the
   * [keys the system takes first](../../docs/reference/commands.md#keys-the-system-takes-first).
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
   * A button for this command on the bottom bar (SDK 1.5.29, player 0.5.10):
   * an icon and a place, `{ icon: "store", order: 200 }`. Needs a `path`: the
   * menu entry is where the command stays reachable when the bar shows no
   * button (a bar without `BarButtons`, a narrow window, a limit). See
   * {@link CommandButton} for where it shows, what it shows and the limits.
   * Fails with `invalid` for an unknown icon name, an order outside 0–999 or
   * a button without a path.
   */
  button?: CommandButton;
  /**
   * Whether the command can run (default true): a value, a function, or a
   * {@link Condition} the player evaluates (`plugin.when`, SDK 1.5.40).
   */
  enabled?: Bindable<boolean> | Condition;
  /**
   * Check mark (or radio dot with `radio`); `null` (default) draws none.
   * A {@link Condition} (`plugin.when`, SDK 1.5.40) draws the mark while
   * it holds.
   */
  checked?: Bindable<boolean | null> | Condition;
  /** Busy state (default false); the player does not call `run` while busy. */
  busy?: Bindable<boolean>;
  /**
   * Why the command is disabled or busy (shown to the user): English
   * source text, or a {@link Text} for one with data in it (SDK 1.5.11).
   * With an `enabled` {@link Condition} the player shows it only while the
   * condition is false or the command is busy, so a fixed text is enough.
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
 * {@link Command.set} are evaluated again in every update pass and only
 * changes reach the player. Its title, path, bindings and button cannot
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
 * // A function: re-evaluated in every update pass.
 * exportCommand.set({ enabled: () => plugin.player.state.phase === "ready" });
 * ```
 *
 * @see {@link Commands.add}, [Commands, menus and key bindings](../../docs/concepts/commands.md)
 * @since 1.0.0
 * @category Commands
 */
export interface Command extends Disposable {
  /** The local id given in {@link CommandOptions.id}. */
  readonly id: string;
  /**
   * Replace some state fields (values or functions). Last write wins.
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
   * Resolves when the host has registered the command. Rejects with
   * `conflict` (path already taken), `invalid` or `limit` (more than 160
   * commands in this plugin, or 1024 in the whole player). You rarely need
   * to await it: during activation a failure fails activation, later it
   * goes to {@link Scope.onError}.
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
 * A command is one action of the plugin with a menu item (`path`), default
 * keys (`bindings`), optionally a bottom-bar button (`button`) and a state
 * the menu shows (`enabled`, `checked`, `busy`, `reason`). The player owns
 * the menu, the binding table and the user's key overrides: it calls `run`
 * when the user picks the item, presses a key or clicks the button.
 * Commands of all plugins merge into the player's menus by their English
 * path keys. Registration is asynchronous: `add` returns at once, and
 * {@link Command.ready} reports the player's answer (during activation a
 * refusal fails activation).
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
 * @see {@link Command}, {@link CommandOptions}, [Commands, menus and key bindings](../../docs/concepts/commands.md)
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
   *   unknown `@` menu id), order, group or binding; `conflict` for an id this
   *   plugin has already declared and not disposed.
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
}

// ---------------------------------------------------------------- windows and panels

/**
 * An image file for a Slint `image` property, made by {@link Ui.image}.
 *
 * @remarks
 * Opaque: pass it where the Slint type is `image`, with {@link View.set} or
 * {@link View.bind}: the whole value of an `image` property or, from SDK
 * 1.5.19 (player 0.5.1), an `image` field at any depth, such as the logo of
 * each row of a list. Making the reference does not read the file: the
 * player checks and decodes it each time it receives the value (a property
 * write, a window opening; {@link Ui.image} has the rules and limits).
 *
 * A reference belongs to the {@link Scope} that created it. Once that scope
 * is disposed, writing the reference fails with `invalid` (reported to
 * {@link Scope.onError}); an image already on screen stays until the
 * property changes or the view closes.
 *
 * @example Show a cover image from the data directory
 * A window opens showing `cover.png`, which the plugin saved in its data
 * directory. `ui.image` only makes a reference, without reading the file;
 * the player checks and decodes the file when it receives the value, so a
 * missing file fails that write with `missing` (here: `show` rejects, as
 * it is an initial property). A missing image nested inside a value is
 * drawn empty instead.
 * ```ts
 * const cover = plugin.windows.create("ui/cover.slint");
 * // `art` is an `image` property in ui/cover.slint.
 * cover.set({ art: plugin.ui.image(`${plugin.dataDirectory}/cover.png`) });
 * await cover.show();
 * ```
 *
 * @example Show a logo in each row of a list
 * Each row of the list draws its own small logo next to its name. An
 * `ImageRef` may sit in any field of a property value (SDK 1.5.19, player
 * 0.5.1), so the rows carry their icons; `maxSide: 64` decodes each logo
 * at most 64 px wide, which keeps the view's image memory small.
 * ```slint
 * export struct Row { key: string, name: string, icon: image }
 * ```
 * ```ts
 * const items = [{ id: "a", name: "A", iconPath: `${plugin.dataDirectory}/a.png` }];
 * const list = plugin.windows.create("ui/list.slint");
 * list.bind(() => ({
 *   rows: items.map((item) => ({
 *     key: item.id,
 *     name: item.name,
 *     // About twice the drawn size (32 px) stays sharp on dense screens.
 *     icon: plugin.ui.image(item.iconPath, { maxSide: 64 }),
 *   })),
 * }));
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
 * Options of {@link Ui.image} and {@link Ui.remoteImage}.
 *
 * @since 1.5.19
 * @category UI
 */
export interface ImageOptions {
  /**
   * Decode the image scaled down, aspect kept, so that neither side is over
   * this many pixels (an integer 1–4096); smaller images stay as they are.
   * Use about twice the drawn size (64 for a 32 px logo) so that it stays
   * sharp on high-density screens. It keeps the decoded memory small: a
   * 1024×1024 icon is 4 MB decoded, 16 KB at `maxSide: 64`.
   *
   * @player 0.5.1; older players refuse the reference (`invalid`).
   */
  maxSide?: number;
}

/**
 * A Markdown document for `MarkdownView` or `MarkdownBlocks`, made by
 * {@link Ui.markdown}.
 *
 * @remarks
 * Opaque, like {@link ImageRef}: pass it where the Slint type is
 * `[MarkdownBlock]`: the whole value of such a property (the `blocks` of
 * `MarkdownView` from `@vestra/markdown.slint`) or, from SDK 1.5.4, a
 * `[MarkdownBlock]` field at any depth of a property value, such as the
 * `body` of each row of a chat's message list. It carries the text, the
 * base address and the local copies of its remote images; the player parses
 * and draws it. Writing a document whose text did not change (a new
 * reference for the same text included) costs the player no parsing, and a
 * changed document updates only the blocks that changed. It belongs to the
 * scope that created it: once that scope is disposed, writing it fails with
 * `invalid`, wherever it is in the value.
 *
 * @example Show chat messages, one document per row
 * The chat window shows a formatted assistant message. `ui.markdown`
 * resolves once the document is ready (here without downloading images);
 * the reference goes into the `body` field of a row, whose Slint type is
 * `[MarkdownBlock]`, and the player parses and draws it.
 * ```ts
 * const chat = plugin.windows.create("ui/chat.slint");
 * const body = await plugin.ui.markdown("**Hello**", { remoteImages: false });
 * chat.set({ messages: [{ id: "m1", role: "assistant", body }] });
 * ```
 *
 * @player 0.2.0; nested in a value: the player after 0.4.0
 * @see {@link Ui.markdown}, {@link MarkdownOptions}, {@link PropValue}
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
 * The value of one Slint property: JSON with Markdown documents and images
 * at any depth ({@link PropData}).
 *
 * @remarks
 * JSON becomes Slint values as you would expect: booleans for `bool`,
 * finite numbers for `int` and `float`, strings for `string`, arrays for
 * models (`[T]`), objects for structs. Struct field names are passed
 * unchanged, so write them as the Slint file spells them; a name with `_`
 * is refused (Slint treats `_` and `-` as the same, so use camelCase or
 * kebab-case).
 *
 * A {@link Text} or {@link TextList} goes where the Slint type is `string`,
 * at any depth (SDK 1.5.11, player 0.4.3): the player shows it translated
 * with the plugin's catalog, so a `[string]` model (a ComboBox) can mix
 * words and data. The limits below count it as the string it becomes.
 *
 * A {@link MarkdownRef} goes where the Slint type is `[MarkdownBlock]`: the
 * whole value, or a field at any depth (SDK 1.5.4; older players refuse a
 * nested one). An {@link ImageRef} goes where the Slint type is `image`: the
 * whole value, or a field at any depth (SDK 1.5.19, player 0.5.1; older
 * players refuse a nested one with `invalid`). The images nested in the
 * values of one view (a window, panel or settings page) may show at most
 * 32 MB of decoded pixels together (`IMAGE_LIMITS.viewBytes` in
 * `@vestra-player/sdk/runtime`): a write
 * that would pass it is refused with `limit`; use
 * {@link ImageOptions.maxSide} for small pictures such as logos and
 * thumbnails.
 *
 * Limits per value (`UI_VALUE_LIMITS` in `@vestra-player/sdk/testing`,
 * player 0.4.3; older players: 4096 values and 1024 rows): nesting depth 8,
 * 16384 values in total (every array, object, string, number, boolean and
 * null counts, the value itself included; a document or an image is one), 4096 rows
 * per array, 64 KiB per string or field name and 1 MiB of text in total,
 * field names and the text of its Markdown documents included (256 KB per
 * document). A list of rows with 8 fields is 9 values per row, so about
 * 1800 rows fit. The whole request must also fit the player's 1 MiB
 * message. A value over a limit is refused with code `limit` and the
 * property keeps what it showed (see {@link View.set}); `TestHost` refuses
 * it the same way.
 *
 * The limits bound the work of one write, not the size of your data: for
 * a list that can grow without bound, send the rows near the view and the
 * row count, and move that window as the user scrolls.
 *
 * @since 1.0.0
 * @category UI
 */
export type PropValue = PropData | ImageRef;

/**
 * JSON whose values may also be Markdown documents and (SDK 1.5.19) images,
 * at any depth: the part of {@link PropValue} that nests.
 *
 * @example Type a message list whose rows carry a document
 * A property value for a chat's message list, typed so that TypeScript
 * accepts a Markdown document inside each row. `PropData` is the JSON a
 * property takes plus documents and images at any depth; the player turns
 * each object into a Slint struct by its field names.
 * ```ts
 * const messages: PropData = [
 *   { id: "m1", role: "user", body: await plugin.ui.markdown("Hi") },
 * ];
 * ```
 *
 * @since 1.5.4
 * @category UI
 */
export type PropData =
  | null
  | boolean
  | number
  | string
  | MarkdownRef
  | ImageRef
  | Text
  | TextList
  | PropData[]
  | { [key: string]: PropData };

/**
 * Properties to write to a view, by name.
 *
 * @remarks
 * Names may be camelCase: the SDK turns every capital letter into `-` plus
 * the lower-case letter (`canMark` → `can-mark`); names already in
 * kebab-case are kept. Only the property names are converted, not the
 * fields of struct values.
 *
 * @example Prepare a window's initial properties
 * An object of property values by name, as `windows.create` and
 * `View.set` take them. Names match the Slint file (`canMark` for
 * `can-mark`), and each value becomes the Slint type of its property: a
 * boolean, and an array of structs for a model.
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
 * @example Show a Markdown file in a window (examples/markdown)
 * A menu item opens a window with a formatted Markdown file that ships
 * with the plugin. The plugin reads the file, turns it into a document
 * with `ui.markdown` (relative images resolve against the plugin's
 * directory through `base`) and writes it to the window's `doc` property,
 * which the Slint file hands to `MarkdownView`.
 *
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
   * each time it receives the reference (a property write, a window or
   * settings page opening, the main window being rebuilt): it must be inside this plugin's package
   * directory or {@link Plugin.dataDirectory} after following links, at most
   * 16 MB and 4096×4096 pixels, and PNG or JPEG by content (the extension
   * does not matter). A failed check of a whole-value image is a failed
   * property write: `missing` for a file that does not exist, `invalid`
   * otherwise. It goes to {@link Scope.onError} and the property keeps its
   * previous image; in the initial properties of a tool window it makes
   * {@link Window.show} reject. A nested image (a field of a row, SDK
   * 1.5.19) that fails its check is drawn empty instead, and the rest of
   * the value is shown, as a Markdown image shows its alt text.
   *
   * The player caches decoded images per plugin (up to 64 MB, least recently
   * used first) by path, size and modification time, and does not watch
   * files. After rewriting a file under the same path, call `image()` again
   * and write the new reference: the SDK does not send a value that did not
   * change, so the player would not look at the file again.
   *
   * @capability None.
   *
   * @param path - Absolute path of the image file, inside the package
   *   directory or the data directory.
   * @param options - `maxSide` (SDK 1.5.19, player 0.5.1): decode the image
   *   scaled down, aspect kept, so that neither side is over it.
   * @returns A new {@link ImageRef}, owned by this scope.
   *
   * @throws `invalid` (throws) `path` is not a non-empty string, or
   *   `maxSide` is not an integer 1–4096.
   *
   * @example Show a thumbnail the plugin rendered
   * A window shows a PNG the plugin wrote into its data directory. The file
   * must be inside the package or data directory; `image` returns at once.
   * The player decodes the file when it receives the value and notices a
   * rewritten file by its size and modification time; the plugin still
   * calls `image()` again after rewriting it, because the SDK does not send
   * a value that did not change.
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
  image(path: string, options?: ImageOptions): ImageRef;
  /**
   * Download an `https:` PNG or JPEG image (a thumbnail, a repository's
   * plugin icon) and reference the local copy, as {@link Ui.image} does.
   *
   * @remarks
   * Downloads like {@link Ui.markdown}'s remote images: Node's `fetch` in
   * this plugin's process, at most 4 MB and 10 s per image, 4 downloads at a
   * time per plugin, into `<dataDirectory>/.vestra-cache/images/`; the cache
   * keeps 32 MB and fetches an address again after 24 hours, so a list that
   * shows the same thumbnails again reads them from disk.
   *
   * @capability None (the plugin process has network access).
   * @player Any (the reference is an ordinary {@link ImageRef}); nested in a
   *   value, player 0.5.1.
   *
   * @param url - The image's `https:` address.
   * @param options - As for {@link Ui.image}.
   * @returns The reference, owned by this scope, once the file is in the
   *   cache.
   *
   * @throws `invalid` (rejects) `url` is not an `https:` address, or
   *   `maxSide` is not an integer 1–4096.
   * @throws `unavailable` (rejects) the download failed, timed out, was too
   *   large, or is not a PNG or JPEG image; or the plugin has no data
   *   directory.
   *
   * @example Show search results with downloaded thumbnails
   * A results window lists each hit with its thumbnail, or a placeholder
   * when a thumbnail cannot be fetched. `remoteImage` downloads the image
   * in the plugin's process into the data directory's cache (at most 4 at a
   * time) and resolves with a local reference; a failed download rejects
   * with `unavailable`, which the `catch` turns into the placeholder.
   * ```ts
   * const results = [{ title: "A", thumbnailUrl: "https://example.com/a.jpg" }];
   * const placeholder = plugin.ui.image(`${plugin.dataDirectory}/blank.png`);
   * const rows = await Promise.all(
   *   results.map(async (r) => ({
   *     title: r.title,
   *     thumb: await plugin.ui
   *       .remoteImage(r.thumbnailUrl, { maxSide: 320 })
   *       .catch(() => placeholder), // `unavailable`: download failed
   *   })),
   * );
   * plugin.windows.create("ui/results.slint").set({ rows });
   * ```
   *
   * @since 1.5.19
   */
  remoteImage(url: string, options?: ImageOptions): Promise<ImageRef>;
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
   * `MarkdownView` scrolls one document. `MarkdownBlocks` (SDK 1.5.4, players
   * after 0.4.0) draws one without scrolling, as tall as its content, for a
   * layout of your own or a `ListView` row. For a list of documents, write
   * the whole list with one document per row: the player parses only the
   * documents that changed and updates the list in place (rows added or
   * removed at the end, a growing document's changed blocks), so re-sending
   * the list on every streamed chunk keeps the scroll position and costs
   * little.
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
   * @example Build a chat with one Markdown document per row
   * A chat window lists messages as formatted text, with a Copy button on
   * each code block that puts the code on the clipboard. Each row's `body`
   * is a document from `ui.markdown`; the whole list is written again on
   * each change, and the player parses only the documents that changed.
   * `MarkdownBlocks` with `code-copy` calls `copy-code`, which the plugin
   * handles with `on("copyCode")`.
   *
   * `ui/chat.slint`:
   *
   * ```slint
   * import { ListView } from "std-widgets.slint";
   * import { MarkdownBlocks, MarkdownBlock } from "@vestra/markdown.slint";
   * export struct Message { id: string, role: string, body: [MarkdownBlock] }
   * export component Chat inherits Window {
   *     in property <[Message]> messages;
   *     callback copy-code(string);
   *     ListView {
   *         for message in root.messages: VerticalLayout {
   *             padding: 8px;
   *             MarkdownBlocks {
   *                 blocks: message.body;
   *                 code-copy: true;
   *                 copy-code(code) => { root.copy-code(code); }
   *             }
   *         }
   *     }
   * }
   * ```
   *
   * ```ts
   * const chat = plugin.windows.create("ui/chat.slint");
   * const history: { id: string; role: string; text: string }[] = [];
   * chat.on("copyCode", (code: string) => plugin.clipboard.writeText(code));
   * // Re-send the whole list: unchanged documents cost the player nothing.
   * async function render() {
   *   const messages = [];
   *   for (const { id, role, text } of history)
   *     messages.push({ id, role, body: await plugin.ui.markdown(text) });
   *   chat.set({ messages });
   * }
   * history.push({ id: "1", role: "user", text: "Show me `ls`." });
   * await render();
   * await chat.show();
   * ```
   *
   * @example Show a README from the web
   * A window shows a README downloaded from the web, its images included,
   * and clicked links open in the browser. `base` makes relative links and
   * images resolve against the README's address; `markdown` resolves after
   * its `https:` images are downloaded. A click on a link makes
   * `MarkdownView` call `link-clicked`, which `ui/readme.slint` forwards as
   * `open-link`; the plugin opens the address with `openUrl`.
   * ```ts
   * const readmeUrl = "https://example.com/plugin/README.md";
   * const response = await fetch(readmeUrl);
   * if (!response.ok) throw new Error(`README: HTTP ${response.status}`);
   * const text = await response.text();
   * const window = plugin.windows.create("ui/readme.slint");
   * // Bound before the first `show`, as a tool window requires.
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
 * @example Wire a window's label and buttons to the plugin (examples/bookmark)
 * A Bookmark window shows the saved position and two buttons that save
 * it and jump back to it. `bind` keeps the label and the buttons' enabled
 * state equal to the plugin's state: the SDK evaluates the function again
 * after every handler and player change and sends only what changed. The
 * buttons' Slint callbacks reach the plugin through `on`.
 *
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
   * @example Keep a slider and the plugin's value in step
   * Moving the window's brightness slider updates the plugin's value, and
   * the slider shows it back. The Slint callback `brightness-changed`
   * reaches the handler with the slider's value as JSON; after the handler
   * returns, the SDK runs an update pass and `bind` sends the new value.
   * Callbacks of a tool window must be bound before its first `show`.
   * ```ts
   * const picture = plugin.windows.create("ui/picture.slint");
   * let brightness = 0;
   * // camelCase here, `brightness-changed` in the Slint file.
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
   * to {@link Scope.onError} (the first failure of a run of failures; the
   * message names the property). A value over the limits of
   * {@link PropValue} fails with `limit`. As an initial property (written
   * while the view is not open) it makes {@link Window.show} reject; a
   * panel or settings page still opens without it (the property keeps its
   * default) and the failure goes to the plugin's `onError` (player 0.4.3;
   * older players left it out silently).
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param props - Properties by name; see {@link Props}.
   *
   * @example Put a drop-down back when the user picks an entry the plugin refuses
   * Choosing "Custom" snaps the drop-down back to the last real preset.
   * The plugin cannot read a property back, only hear the callback; `set`
   * sends the value even though it equals the one sent before, which is
   * what pulls a control the user moved back to the plugin's value.
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
   * Never throws. Writes that fail are not repeated until the value
   * changes, and are reported to {@link Scope.onError} like a failed
   * {@link View.set} (a value over the limits of {@link PropValue}: `limit`).
   *
   * @capability That of the view: `ui.window`, `ui.mount` or `ui.settings`.
   *
   * @param props - Returns the properties, by name.
   * @returns A handle that stops this binding (the values last sent stay).
   *
   * @example Show what is playing and whether it can seek
   * The status window always shows the current file and enables its seek
   * controls only for seekable sources. The SDK calls the function right
   * away and again in every update pass (after player state changes and
   * after each handler) and sends only the values that changed.
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
 * 4. {@link Window.close}, or the user (title-bar button or the
 *    [standard close keys](../../docs/reference/commands.md#keys-the-system-takes-first)), destroys the window instance; only the
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
 * {@includeCode ../../examples/bookmark/main.ts#window,command}
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
   * When the inspector cannot open, the user sees why on the OSD instead
   * of nothing happening. `show` compiles the Slint file and opens the
   * window; it rejects with a code, such as `host` for a Slint file that
   * does not compile or `unavailable` without a user interface.
   * ```ts
   * const window = plugin.windows.create("ui/inspector.slint");
   * try {
   *   await window.show();
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
   * [standard close keys](../../docs/reference/commands.md#keys-the-system-takes-first). When it runs, the window
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
 * @example Create a window and open it from a menu (examples/bookmark)
 * A Bookmark window opens from Playback ▸ Bookmark…. `create` returns a
 * handle without opening anything; its bindings and callbacks are set up
 * first, and `show` opens the window when the command runs.
 *
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
   *   bar's own band at the bottom of the screen (player 0.5.1: keys and
   *   pointer motion elsewhere do not bring it back; before 0.5.1 it hid after
   *   3 seconds without activity).
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
  /** The sidebar floats in its own window (with all its tabs). */
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
 * or the [standard close keys](../../docs/reference/commands.md#keys-the-system-takes-first)) is the same as `setVisible(false)`.
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
   * ready: a rejection fails activation, except `conflict` for a taken
   * position (below), which the player (0.4.x after 0.4.0) and `TestHost`
   * do not count: the plugin runs without its panel, its commands and keys
   * work, and the player shows the refusal (an OSD message,
   * {@link PluginInfo.warnings} and the text in {@link PluginInfo.error}).
   * Later failures also go to {@link Scope.onError}.
   *
   * A second sidebar panel is not refused: it resolves as another tab
   * (see {@link Panel.state}). Built-in plugins mount first at start-up,
   * so the playlist's tab is first and a built-in panel keeps its position.
   *
   * @throws `ui-prepare` (rejects) The Slint file does not compile, or a
   *   bound property is not declared on the bridge global; `message` has the
   *   diagnostics. (Players 0.4.0 and older also answer a taken bottom bar
   *   or sidebar with it.)
   * @throws `conflict` (rejects) Another plugin's panel holds the bottom bar
   *   or the backdrop (shown, or being mounted), or the sidebar has all the
   *   tabs it takes (8); `message` names the position and the holder
   *   (「侧栏已被 vestra.playlist 使用」). Not an activation failure.
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
   * position; otherwise it does {@link Panel.show}: a panel in a background
   * tab comes to the front instead of the sidebar closing. A "Show list"
   * command checked by `state.preferred && state.active` matches it. Waits
   * for {@link Panel.ready} first.
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
   * hidden 500 ms after it leaves (player 0.5.1; keys and pointer motion
   * elsewhere do not reveal it), and the fullscreen sidebar overlay collapses
   * when the pointer leaves it. A lock keeps the bar shown. Set a
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

/**
 * The player's palettes: `vestra`, the dark default, and `vestra-light`
 * (player 0.4.0, SDK 1.5.0), a light palette whose video area stays dark.
 * Both draw on the logo's colours. Read colours from `Theme` instead of
 * branching on the id: a later version may add palettes.
 *
 * @remarks
 * The player treats an id it does not have as `vestra`: plugins built with an
 * older SDK that still ask for a palette removed in SDK 1.4.0 keep working,
 * and a player older than 0.4.0 answers `vestra-light` with `vestra`.
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
 * @capability None to read `theme`; `events` to follow changes; `ui.theme`
 *   to change it.
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
   * @example Redraw a picture the plugin renders when the palette changes
   * The plugin renders a chart image in the palette's colours and draws it
   * again when the user or another plugin switches palettes. Views that use
   * `Theme` follow on their own; this listener (which needs `events`) is
   * for what the plugin draws itself.
   * ```ts
   * declare function renderChart(dark: boolean): Promise<void>;
   * // ---cut---
   * plugin.appearance.onChange((theme) => {
   *   void renderChart(theme === "vestra"); // the dark default
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
   * @example Switch to the light palette
   * Every view of the player turns light, and stays light after a restart.
   * The player applies the palette to every open view and saves the
   * choice; when the promise resolves, `appearance.theme` already has the
   * new value. Without `ui.theme` it rejects with `capability`.
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
   * activation; with `events` it follows other plugins' changes, without it
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
   * effect after restart"). Every plugin with `events` hears the change in
   * {@link Appearance.language}.
   *
   * @capability ui.theme
   * @player 0.4.3
   *
   * @param language - `"system"` or a {@link Locale}.
   * @returns Resolves once the player saved it; {@link Appearance.language}
   *   has the new value.
   *
   * @throws `invalid` (rejects) `language` is not `"system"` or a {@link Locale}.
   * @throws `capability` (rejects) The manifest does not declare `ui.theme`.
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
 * Arguments of a template sentence ({@link Osd.show},
 * {@link OsdPanel.set}, {@link ConfirmOptions.args}, {@link I18n.text}): an
 * array for `{}` and `{0}`, `{1}` placeholders, or an object for `{name}`
 * placeholders. At most 16. Strings and finite numbers are data, shown as
 * they are (whole numbers without a fraction); a {@link Text} or
 * {@link TextList} argument (SDK 1.5.11, player 0.4.3) is translated too,
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
 * segments and reasons, {@link Osd.show} and {@link OsdPanel.set} (as the
 * text or an argument), the texts of {@link Dialogs.confirm}, file dialog
 * titles and `saveFile`'s `fileName`, and property values where Slint
 * expects a `string` (at any depth: a `[string]` model, a struct field).
 * Nested in another text's arguments it is translated too. Requires player
 * 0.4.3. Limits: `TEXT_LIMITS` in `@vestra-player/sdk/testing`.
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
 * Where words and data cannot be separated that way (a menu item with a
 * number, a `[string]` model, a sentence made of translated parts), the
 * plugin passes a text value ({@link I18n.text}, {@link I18n.list}; SDK
 * 1.5.11): data the player translates, never a translated string.
 *
 * The language is fixed when the player starts: {@link I18n.locale} never
 * changes during a run. Read it for what is not text, such as the order of
 * names or a date format. `vestra-plugin i18n extract` collects the texts
 * into `locales/messages.pot`; see the
 * [i18n guide](../../docs/how-to/i18n.md).
 *
 * @capability None.
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
   * @capability None.
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
   * @capability None.
   *
   * @since 1.5.11
   */
  list(items: readonly TextArg[], style?: ListStyle): TextList;
  /**
   * An `Error` whose words the player shows translated: throw it where the
   * player shows a plugin's failure to the user, such as from a
   * file or web resolver's `resolve` ({@link FileResolverOptions}, {@link WebResolverOptions}) (also when a stream
   * fails while it starts). The player shows `text` translated with this
   * plugin's catalog (as `player.state.error` and the failure message);
   * `message` is the English rendering, for logs and older players.
   * Elsewhere it is an ordinary `Error`.
   *
   * @param source - English source text, as {@link I18n.text}'s.
   * @param args - Values for its placeholders.
   * @throws `invalid` A malformed or over-limit value.
   *
   * @example Fail an open with a message the user can read
   * Opening a `.ch8` file the plugin cannot load shows "The program file
   * was not found." in the user's language. The player shows the message of
   * an error thrown from `resolve`; `i18n.error` makes an `Error` whose text
   * the player translates with this plugin's catalog, while its `message`
   * stays English for logs and older players.
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
   * @capability None.
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
   * @capability None.
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
 * {@link Player.stats}. With `events`, `state` follows every change; without
 * it, it refreshes only when this plugin mounts.
 *
 * @capability ui.mount; `events` to follow changes.
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
   * @capability ui.mount and events
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
 * Each plugin mounts at most one panel, and each position holds one panel
 * for all plugins. {@link Panels.bottom} and {@link Panels.sidebar} describe
 * the positions, whoever mounted there.
 *
 * @capability ui.mount
 *
 * @example Mount a list in the sidebar (examples/panel-menu)
 * The sidebar gets an "Example list" tab showing three rows. `mount`
 * returns at once; the SDK sends the mount with the values bound so far,
 * and the player rebuilds its main window with the panel. The Slint file
 * exports the component and the bridge global whose properties `bind`
 * writes.
 *
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
   *   floats over the video and shows only while the pointer is in its band
   *   at the bottom of the screen (hidden 500 ms after the pointer leaves;
   *   {@link Panel.setInteraction} locks keep it).
   * - `"sidebar"`: right of the video, the window's full height, as wide as the
   *   user drags it (at least 317). The user can detach it into a floating
   *   window titled `title`. Several plugins may mount here (player 0.4.x
   *   after 0.4.0): each panel is a tab, labelled `title` (else the plugin's
   *   name), and the player draws a 31px tab strip above the current one
   *   while there are two or more (with one panel, nothing changes).
   *   Showing, hiding and detaching apply to the whole sidebar. If the
   *   bridge global declares `in property <bool> tabbed`, the player sets
   *   it to `true` while it draws the strip, so a panel with a tab strip of
   *   its own can hide it. Panel coordinates (drops) start below the strip.
   * - `"backdrop"`: the whole video area, under the OSD, while there is no
   *   video picture (see {@link Panels.backdrop}). One plugin at a time (as
   *   for the bottom bar, another one's mount rejects with `conflict`); it
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

/**
 * What a timeline mark stands for; readers choose colours by it.
 *
 * @since 1.0.0
 * @category Playback
 */
export type MarkKind = "chapter" | "bookmark" | "marker";

/**
 * One mark on the seek bar.
 *
 * @since 1.0.0
 * @category Playback
 */
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

/**
 * This plugin's own marks; disposing it removes them.
 *
 * @remarks
 * This plugin's marks on the seek bar, from {@link Timeline.layer}. `set`
 * replaces the whole layer and never throws: the newest write wins, and a
 * refused one is reported to `onError`. Disposing the layer, its scope or
 * stopping the plugin removes the marks.
 *
 * @capability timeline.marks
 *
 * @example Clear the plugin's marks
 * The plugin's marks disappear from the seek bar while it keeps its
 * layer for later. An empty list clears the layer; other plugins' marks
 * stay.
 * ```ts
 * plugin.timeline.layer().set([]);
 * ```
 *
 * @since 1.0.0
 * @category Playback
 */
export interface TimelineLayer extends Disposable {
  /**
   * Replace the layer (last write wins; `[]` clears it). At most 1000 marks,
   * titles ≤ 100 characters, times within the media. Failures go to `onError`;
   * with `ifCurrent`, a write for another source is dropped silently.
   * A title is data (a chapter's or bookmark's own name), or a {@link Text}
   * the player translates (`text("Chapter {}", [n])`, SDK 1.5.11); other
   * plugins read the shown string.
   *
   * @example Show the file's bookmarks on the timeline
   * Bookmark marks appear on the seek bar at their times, titled with the
   * user's notes. `set` replaces this plugin's whole layer; with `ifCurrent`
   * the player drops the write if another file opened since `seen` was
   * read, so bookmarks of the previous file never land on the new one.
   * ```ts
   * declare const bookmarks: { time: number; note: string }[];
   * // ---cut---
   * const layer = plugin.timeline.layer();
   * const seen = plugin.player.state; // the file the bookmarks belong to
   * layer.set(
   *   bookmarks.map((b) => ({ time: b.time, kind: "bookmark", title: b.note })),
   *   { ifCurrent: seen },
   * );
   * ```
   *
   * @capability timeline.marks
   * @since 1.0.0
   */
  set(
    marks: { time: number; kind: MarkKind; title?: string | Text }[],
    options?: { ifCurrent?: PlayerState },
  ): void;
}

/**
 * `plugin.timeline`: marks on the seek bar. Every plugin publishes one
 * layer; the player merges them. A new source clears every layer.
 *
 * @remarks
 * Marks on the player's seek bar: chapters, bookmarks, loop points. Each
 * plugin publishes one layer with {@link Timeline.layer}; the player merges
 * the layers by time and shows them. A new source clears every layer, so a
 * plugin publishes again for each file. `marks` is the merged list, which
 * any plugin can read.
 *
 * @capability `timeline.marks` to publish; `playback.read` to read;
 * `events` to follow changes.
 *
 * @example Count the chapter marks other plugins published
 * The plugin reads how many chapter marks the seek bar shows, whoever
 * published them. `marks` is the merged list of every layer, sorted by
 * time, with each mark's `plugin`.
 * ```ts
 * const chapters = plugin.timeline.marks.filter((mark) => mark.kind === "chapter");
 * await plugin.osd.show("{} chapters", [chapters.length]);
 * ```
 *
 * @since 1.0.0
 * @category Playback
 */
export interface Timeline {
  /** Every layer merged, by time (`playback.read`). Empty on a new source. */
  readonly marks: readonly TimelineMark[];
  /**
   * The merged list changed (needs `events`; at most every 100 ms).
   *
   * @capability events and playback.read
   *
   * @example Follow the marks as they change
   * A panel lists the seek bar's marks and updates when any plugin publishes
   * or a new file clears them. The listener gets the merged list, at most
   * every 100 ms.
   * ```ts
   * plugin.timeline.onChange((marks) => {
   *   console.log(marks.map((mark) => `${mark.time}s ${mark.title ?? mark.kind}`));
   * });
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (marks: readonly TimelineMark[]) => void): Disposable;
  /**
   * This plugin's layer (`timeline.marks`); a second call throws.
   *
   * @capability timeline.marks
   *
   * @example Publish this plugin's marks
   * The plugin gets its one layer and puts two chapter marks on the seek
   * bar. Calling `layer()` again while the first layer is not disposed
   * throws; disposing the layer removes the
   * marks.
   * ```ts
   * const layer = plugin.timeline.layer();
   * layer.set([
   *   { time: 0, kind: "chapter", title: "Intro" },
   *   { time: 95, kind: "chapter", title: "Part 1" }, // seconds
   * ]);
   * ```
   *
   * @since 1.0.0
   */
  layer(): TimelineLayer;
}

/**
 * The main window as `plugin.window.state` reports it (logical points).
 *
 * @see {@link MainWindow.state}
 * @since 1.0.0
 * @category Plugin
 */
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
 * @example Resize the window to the video's own size
 * Screen ▸ Original size makes the video area as many logical points as
 * the video has pixels (one pixel per pixel at a display scale of 100 %).
 * `stats()` reports the video's size;
 * `setVideoArea` resizes the window around the video column (bars and a
 * docked sidebar added), scales it down if it would not fit the screen,
 * and is refused in fullscreen, hence the `enabled` check.
 * ```ts
 * plugin.commands.add({
 *   id: "size-1x",
 *   path: ["Screen", "Original size"],
 *   enabled: () => !plugin.window.state.fullscreen,
 *   run: async () => {
 *     const stats = await plugin.player.stats();
 *     // No video stream (an audio file): nothing to size to.
 *     if (stats.video?.width && stats.video.height)
 *       await plugin.window.setVideoArea({ width: stats.video.width, height: stats.video.height });
 *   },
 * });
 * ```
 *
 * @remarks
 * `plugin.window` is the player's main window: its size, fullscreen,
 * picture-in-picture and the video area. Reading it needs no capability;
 * changing it needs `window.control`. Changes that last only while the
 * plugin runs (always on top, pointer auto-hide) revert when it stops.
 *
 * @capability None to read; window.control to change; events to follow
 * outside changes.
 * @since 1.0.0
 * @category Plugin
 */
export interface MainWindow {
  /** Latest state; zero video area without a native window. */
  readonly state: WindowState;
  /**
   * The window state changed (needs `events` for outside changes).
   *
   * @capability events (for outside changes)
   *
   * @example Fit a panel to fullscreen
   * The plugin's panel uses larger text while the player is fullscreen. The
   * listener runs after the SDK updated `state` from the player's events
   * (with `events`; without it only after this plugin's own changes).
   * ```ts
   * declare const bar: Panel;
   * // ---cut---
   * plugin.window.onChange((state) => bar.set({ large: state.fullscreen }));
   * ```
   *
   * @since 1.0.0
   */
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
   *
   * @capability window.control
   * @throws `unavailable` (rejects) Fullscreen, or no user interface.
   * @throws `invalid` (rejects) A size outside 1–16384 logical points.
   * @throws `capability` (rejects) The manifest does not declare
   *   `window.control`.
   *
   * @example Make the video area 1280×720 points
   * The window resizes so that the video column is 1280×720 logical points,
   * the bars and a docked sidebar added around it. A request that does not
   * fit the screen is scaled down keeping the aspect, and `clamped` says so.
   * ```ts
   * const applied = await plugin.window.setVideoArea({ width: 1280, height: 720 });
   * if (applied.clamped) await plugin.osd.show("{}×{}", [applied.width, applied.height]);
   * ```
   *
   * @since 1.0.0
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
   *
   * @capability window.control
   * @throws `unavailable` (rejects) No user interface.
   * @throws `invalid` (rejects) `onTop` is not a boolean.
   * @throws `capability` (rejects) The manifest does not declare
   *   `window.control`.
   *
   * @example Keep the player above other windows
   * The player's windows (tool windows too) float above other applications
   * while the plugin's "Always on top" item is checked. The newest call of
   * any plugin wins, and the setting reverts when this plugin stops.
   * ```ts
   * let onTop = false;
   * plugin.commands.add({
   *   id: "on-top",
   *   path: ["@screen", "Always on top"],
   *   checked: () => onTop,
   *   run: async () => {
   *     onTop = !onTop;
   *     await plugin.window.setAlwaysOnTop(onTop); // reverts when this plugin stops
   *   },
   * });
   * ```
   *
   * @since 1.0.0
   */
  setAlwaysOnTop(onTop: boolean): Promise<void>;
  /**
   * `"playing"`: hide the pointer over the video after 3 idle seconds while
   * playing, in a window too (not only fullscreen). Newest call wins;
   * reverts to `"fullscreen"` when this plugin stops.
   *
   * @capability window.control
   * @throws `invalid` (rejects) A mode other than `"fullscreen"` or
   *   `"playing"`.
   * @throws `capability` (rejects) The manifest does not declare
   *   `window.control`.
   *
   * @example Hide the pointer over playing video in a window too
   * The pointer disappears after 3 idle seconds over playing video, not only
   * in fullscreen. The newest call wins; when this plugin stops the player
   * goes back to hiding it in fullscreen only.
   * ```ts
   * await plugin.window.setCursorAutoHide("playing");
   * ```
   *
   * @since 1.0.0
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
   * @example Toggle picture-in-picture where the system has it
   * The video moves into a floating picture-in-picture window, or back.
   * `state.pictureInPicture` says whether the system supports it and
   * whether it is on; the plugin only calls `setPictureInPicture` where it
   * is supported.
   * ```ts
   * if (plugin.window.state.pictureInPicture.supported)
   *   await plugin.window.setPictureInPicture(!plugin.window.state.pictureInPicture.active);
   * ```
   *
   * @capability window.control
   * @throws `unsupported` (rejects) The system has no picture-in-picture
   *   (`supported` is false).
   * @throws `unavailable` (rejects) No video, or no user interface.
   * @throws `invalid` (rejects) `on` is not a boolean.
   * @throws `busy` (rejects) The previous call is still switching.
   * @throws `failed` (rejects) The system refused.
   * @throws `capability` (rejects) The manifest does not declare
   *   `window.control`.
   * @since 1.0.0
   */
  setPictureInPicture(on: boolean): Promise<void>;
}

/**
 * `plugin.app`: fixed for the life of the plugin process.
 *
 * @since 1.0.0
 * @category Plugin
 */
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
 * @example Describe the player and the system for a bug report
 * The plugin builds a line such as "Vestra 0.5.10 on macOS 26.2" to copy
 * into a bug report. `app.version` is known from the start; each
 * `system()` call asks the player, which reads the displays at that moment.
 * The operating system's name and version it works out once, at the first
 * call, and reuses them.
 * ```ts
 * const system = await plugin.app.system();
 * const text = `Vestra ${plugin.app.version} on ${system.name} ${system.version ?? ""}`;
 * ```
 *
 * @remarks
 * `plugin.app` holds facts fixed for the player's run (its version, build,
 * library versions) and reads the system's on request: `system()` reads
 * the displays at each call; the operating system's name and version are
 * worked out once, at the first call, and reused.
 *
 * @capability None.
 * @since 1.0.0
 * @category Plugin
 */
export interface App extends AppInfo {
  /**
   * The operating system, the displays and the renderer, read when called
   * (displays come and go; the renderer can fall back from GPU to software
   * once). No capability. CPU and memory: Node's `os` module.
   *
   * @capability None.
   * @throws `busy` (rejects) The player could not start the request (no
   *   thread available).
   *
   * @example Choose a size for the primary display
   * The plugin sizes its picture for the primary display. `system()` asks
   * the player; `displays` lists the displays present now, the primary one
   * first (empty without a user interface).
   * ```ts
   * const { displays } = await plugin.app.system();
   * const primary = displays[0];
   * if (primary) console.log(primary.width, primary.height);
   * ```
   *
   * @since 1.0.0
   */
  system(): Promise<SystemInfo>;
}

/**
 * What {@link App.system} reports.
 *
 * @see {@link App.system}
 * @since 1.0.0
 * @category Plugin
 */
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
  /**
   * Which renderer draws the video now: `"gpu"` (the GPU renderer, so
   * {@link RenderOptions | render options} apply) or `"software"` (they
   * fail with `unsupported`). Read at each call. It changes at most once
   * while the player runs, from `"gpu"` to `"software"` when a window
   * cannot show GPU frames; the owner of the render options hears that
   * switch through {@link RenderOptions.onStatus}.
   *
   * Absent (`undefined`) on players before 0.5.12, which do not report it:
   * the renderer is then unknown, not software.
   *
   * Today the player renders on the GPU on macOS and in software on
   * Windows, Linux and without a user interface (see
   * [Platforms](../../docs/reference/platforms.md)); test this field
   * rather than {@link SystemInfo.os}.
   *
   * @example Offer the HDR menu only where render options work
   * The plugin adds its HDR command only when the player renders on the
   * GPU, instead of creating the render options just to find out from a
   * failed status. `system()` asks the player, which reports the renderer
   * drawing at that moment; no capability is needed to ask. A player before
   * 0.5.12 leaves the field out, so the test is for `"gpu"` exactly (an
   * older player gets no HDR command).
   * ```ts
   * const { rendering } = await plugin.app.system();
   * if (rendering === "gpu") {
   *   const render = plugin.video.render(); // one handle, kept
   *   plugin.commands.add({
   *     id: "hdr",
   *     path: ["@video", "HDR Tone Mapping"],
   *     run: () => render.set({ toneMapping: "bt.2390", targetPeak: 250 }),
   *   });
   * }
   * ```
   *
   * @player 0.5.12; older players leave it out (declare
   * `"minPlayerVersion": "0.5.12"` when the plugin relies on it).
   * @since 1.5.34
   */
  readonly rendering?: "gpu" | "software";
  /**
   * Why {@link SystemInfo.rendering} is what it is now: the same reason as
   * {@link RenderingState.reason} (`default`, `no-gpu-backend`,
   * `preference`, `denylist`, `window-fallback`…, see
   * {@link RenderingReasonCode}). Read at each call, like `rendering`.
   *
   * Absent (`undefined`) on players before 0.5.13.
   *
   * @example Say why the video is drawn in software
   * An About page explains a software renderer with the player's own words,
   * for example that the graphics driver is on the player's denylist.
   * `system()` reports the renderer and its reason together, with no
   * capability; the message is English text that may name the adapter and
   * the driver version.
   * ```ts
   * const { rendering, renderingReason } = await plugin.app.system();
   * if (rendering === "software" && renderingReason)
   *   console.log(`Rendering: software (${renderingReason.message})`);
   * ```
   *
   * @player 0.5.13; older players leave it out (declare
   * `"minPlayerVersion": "0.5.13"` when the plugin relies on it).
   * @since 1.5.35
   */
  readonly renderingReason?: RenderingReason;
}

/**
 * One display in {@link SystemInfo.displays}.
 *
 * @since 1.0.0
 * @category Plugin
 */
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
  message: TextValue;
  /** More text under the message; at most 2000 characters. */
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
   * Mark the confirm button as destructive: red text on macOS, a warning
   * icon on Windows.
   *
   * @defaultValue `false`
   */
  destructive?: boolean;
  /** A checkbox under the text, such as "Don't ask again"; 1–40 characters. */
  checkbox?: TextValue;
  /**
   * Values for the placeholders of `message` and `detail` (player 0.4.3).
   * Any of the texts may instead be a {@link Text} (SDK 1.5.11), which
   * carries its own arguments; `args` only fills the string ones.
   * Every text of the dialog is English source text that the player shows
   * translated from the plugin's catalog; `message` and `detail` are
   * templates like {@link Osd.show}'s. The length limits apply to the shown
   * text.
   *
   * @since 1.5.9
   */
  args?: TemplateArgs;
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
 * **Platforms:** {@link Dialogs.confirm} needs macOS or Windows (other
 * systems reject it with `unsupported`); the file dialogs work on every
 * system.
 *
 * For anything more than a question or a path, use a {@link Windows | tool
 * window}.
 *
 * @capability ui.dialog
 *
 * @example Ask before deleting, remembering "Don't ask again"
 * Deleting asks for confirmation in a system alert with a "Don't ask
 * again" box; once the user ticks it, later deletes go ahead without
 * asking. `confirm` resolves with the button and the checkbox when the
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
   * @example Confirm before replacing the playlist
   * The user sees "Replace the current playlist?" with a Replace button and
   * the playlist is replaced only after a yes. The system draws the alert
   * and the promise resolves when the user answers; only one dialog is
   * open at a time, so a second one meanwhile rejects with `busy`.
   * ```ts
   * try {
   *   const { confirmed } = await plugin.dialogs.confirm({
   *     message: "Replace the current playlist?",
   *     confirm: "Replace",
   *   });
   *   if (confirmed) await plugin.osd.show("Playlist replaced");
   * } catch (error) {
   *   if ((error as PluginError).code !== "busy") throw error;
   *   // Another dialog is already open: let the user finish that one.
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
     * The proposed file name: a plain name, at most 256 bytes. A string is
     * data (not translated); a {@link Text} (SDK 1.5.11) is shown
     * translated, `text("Playlist.m3u8")` (a `/` or `\\` in a translation
     * becomes `-`).
     */
    fileName?: TextValue;
  }): Promise<string | null>;
}

// ---------------------------------------------------------------- player

/**
 * One audio track of the current media ({@link PlayerState.audioTracks}).
 *
 * @since 1.0.0
 * @category Playback
 */
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
 *
 * @see {@link Player.state}, [Playback state, controls and sources](../../docs/concepts/playback.md)
 * @since 1.0.0
 * @category Playback
 */
export interface PlayerState {
  /** Changes every time a source is opened, even the same file again. */
  readonly sourceId: number;
  /** `stream` for a generated source ({@link Player.openStream}). */
  readonly kind: "media" | "stream";
  /** The source's life cycle. */
  readonly phase: "empty" | "loading" | "ready" | "ended" | "error";
  /**
   * Path or URL; `null` when empty. A generated stream started with
   * {@link Player.openStream} has the opaque `producer://<n>` (do not parse
   * it); one a file resolver generates ({@link FileResolverOptions}) keeps
   * the path that was opened. Tell streams apart by `kind`, not by `source`.
   */
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

/**
 * An audio output device (`player.audioDevices`).
 *
 * @since 1.0.0
 * @category Playback
 */
export interface AudioDevice {
  /** Stable id to pass to `setAudioDevice` (e.g. `coreaudio/<UID>`). */
  id: string;
  /** What the system calls it. */
  name: string;
}

/**
 * One chapter of the current media.
 *
 * @since 1.0.0
 * @category Playback
 */
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
 * @example Play the next file only if nothing else was opened
 * When the plugin's file ends, the next one starts, unless the user or
 * another plugin opened something in the meantime. `onEnd` passes the
 * state at the end; `open` with `ifCurrent: ended` is refused with `stale`
 * when the source changed after that state, so nothing is replaced.
 * ```ts
 * declare const media: Media;
 * declare const next: string;
 * // ---cut---
 * media.onEnd(async (ended) => {
 *   try {
 *     await plugin.player.open(next, { ifCurrent: ended });
 *   } catch (error) {
 *     // Someone opened another file: leave it playing.
 *     if ((error as PluginError).code !== "stale") throw error;
 *   }
 * });
 * ```
 *
 * @see [Playback state, controls and sources](../../docs/concepts/playback.md)
 * @since 1.0.0
 * @category Playback
 */
export interface Conditional {
  /** The state the call is conditional on; default: the current `player.state`. */
  ifCurrent?: PlayerState;
}

/**
 * A source this plugin opened.
 *
 * @remarks
 * A source this plugin opened with {@link Player.open}. It does not own
 * the source: the user or another plugin can replace it at any time, and
 * `current` then turns false. `ready` and `onEnd` follow the player state:
 * with `events` they react to the player's events, without it `ready`
 * polls the state every 100 ms (which needs `playback.read`). Disposing the
 * scope that opened it does not close the media; call `close` for that.
 *
 * @capability That of {@link Player.open} (`playback.control`); `ready` and
 * `onEnd` follow the state through `events` and `playback.read`.
 *
 * @example Open a file and say when it ends
 * The file opens and plays, and the OSD says "Finished" when it reaches its
 * end on its own. The handle belongs to this source: `onEnd` fires only
 * for a natural end of this media, not when someone opens another file.
 * ```ts
 * const media = await plugin.player.open("/Movies/clip.mp4");
 * media.onEnd(() => void plugin.osd.show("Finished")); // natural ends only
 * ```
 *
 * @since 1.0.0
 * @category Playback
 */
export interface Media {
  /** Still the player's source (a restart keeps it current). */
  readonly current: boolean;
  /**
   * Resolves when it is playing. Rejects with code `failed` (load error),
   * `replaced` (another source took over) or `ended`; with `AbortError` when
   * the signal aborts, after closing the media.
   *
   * @capability That of {@link Player.open}; `playback.read` or `events` to
   * see the state change.
   * @throws `failed` (rejects) The media could not be loaded.
   * @throws `replaced` (rejects) Another source took over first.
   * @throws `ended` (rejects) The media already played to the end.
   * @throws `aborted` (rejects) `signal` aborted (an `AbortError`); the media
   *   is closed.
   *
   * @example Wait at most ten seconds for a stream to start
   * A network stream gets ten seconds to start playing; otherwise it is
   * closed and the user is told. Aborting the signal makes `ready` reject
   * with an `AbortError` after closing the media.
   * ```ts
   * const media = await plugin.player.open("https://example.com/live.m3u8");
   * // The timeout's abort closes the media and rejects with an AbortError.
   * try {
   *   await media.ready({ signal: AbortSignal.timeout(10_000) });
   * } catch (error) {
   *   await plugin.osd.show("Not playing: {}", [(error as Error).message]);
   * }
   * ```
   *
   * @since 1.0.0
   */
  ready(options?: { signal?: AbortSignal }): Promise<void>;
  /**
   * Called once each time a playthrough of this media ends naturally.
   *
   * @capability That of {@link Player.open}; `events` to hear the end.
   *
   * @example Play the next file when this one ends
   * When the plugin's file ends naturally, the next one opens. The listener
   * gets the state at the end; passing it as `ifCurrent` makes the next
   * `open` fail with `stale` (and do nothing) if the user opened something
   * else in the meantime.
   * ```ts
   * declare const media: Media;
   * declare const next: string;
   * // ---cut---
   * media.onEnd((ended) =>
   *   plugin.player.open(next, { ifCurrent: ended }).catch((error: PluginError) => {
   *     if (error.code !== "stale") throw error; // the user opened something else
   *   }),
   * );
   * ```
   *
   * @since 1.0.0
   */
  onEnd(listener: (state: PlayerState) => void): Disposable;
  /**
   * Close it if it is still the player's source; otherwise do nothing.
   *
   * @capability That of {@link Player.open} (`playback.control`).
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Close the preview the plugin opened
   * The plugin closes the preview it opened, but leaves alone anything the
   * user opened since. `close` acts only while this media is still the
   * player's source and does nothing otherwise.
   * ```ts
   * declare const preview: Media;
   * // ---cut---
   * await preview.close(); // a no-op when something else is playing now
   * ```
   *
   * @since 1.0.0
   */
  close(): Promise<void>;
}

/**
 * A drag gesture: each seek is conditional on the previous one, latest value wins.
 * Any outside change (another plugin opens a file, the user pauses) ends
 * the gesture.
 *
 * @example Seek while the user drags a slider
 * The video follows the slider while it is dragged. `scrub()` starts a
 * gesture from the current state; each `seek` is conditional on the
 * previous one and only the newest target is sent while one is running,
 * so a fast drag does not queue seeks. A change from outside (another file,
 * the user pausing) ends the gesture and later seeks resolve `false`.
 * ```ts
 * declare const bar: Panel;
 * // ---cut---
 * let scrub: Scrub | null = null;
 * bar.on("dragStart", () => (scrub = plugin.player.scrub()));
 * // Latest value wins: superseded targets resolve false, not an error.
 * bar.on("dragMove", (seconds: number) => void scrub?.seek(seconds));
 * bar.on("dragEnd", () => scrub?.end());
 * ```
 *
 * @remarks
 * A drag gesture on a seek slider. Each `seek` is conditional on the
 * previous one and only the newest target is sent while a seek is
 * running, so a fast drag never queues seeks. Any outside change (another
 * file, the user pausing) ends the gesture: `active` turns false and later
 * seeks resolve `false`.
 *
 * @capability playback.control
 * @see [Keep a slider responsive while dragging](../../docs/how-to/slider.md)
 * @since 1.0.0
 * @category Playback
 */
export interface Scrub {
  /**
   * Seek within the gesture. Resolves `true` when this target was applied,
   * `false` when a newer target superseded it or the gesture ended. Rejects
   * on a host failure.
   *
   * `keyframes: true` (player 0.5.3, SDK 1.5.22): land on the last keyframe
   * at or before `seconds` instead of decoding up to that exact frame. The
   * picture appears at once on any file (tens of milliseconds instead of
   * seconds on 4K video with keyframes far apart), up to one keyframe
   * interval before the target; the position the player reports is the
   * keyframe's. Use it when the user chose keyframe seeks (the same switch
   * as {@link Player.setStepSeek}), and the exact seek otherwise. The player
   * sends a repeated target of the same gesture only once while the seek is
   * still running (a click is a press and a release), but an exact seek to
   * the target of a keyframe seek is always sent. Omitted or `false`: exact,
   * as before. Older players ignore the option and seek exactly: set
   * `"minPlayerVersion": "0.5.3"` when you rely on it.
   *
   * @example Scrub on keyframes for a fast picture
   * While dragging, the picture jumps to the nearest earlier keyframe at
   * once instead of decoding up to the exact frame. With `keyframes: true`
   * the player lands each target on the last keyframe at or before it; the
   * plugin follows the user's keyframe-seek setting.
   * ```ts
   * declare const bar: Panel;
   * declare const scrub: Scrub | null;
   * // ---cut---
   * const keyframes = true; // the plugin's own setting
   * bar.on("dragMove", (seconds: number) => void scrub?.seek(seconds, { keyframes }));
   * ```
   *
   * @capability playback.control
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   * @throws `stale` (rejects) The source changed from outside while this
   *   seek was being sent (a superseded target or an ended gesture resolves
   *   `false` instead).
   * @throws `unsupported` (rejects) The source is a generated stream.
   * @throws `backend` (rejects) The player failed the seek.
   * @since 1.0.0
   */
  seek(seconds: number, options?: { keyframes?: boolean }): Promise<boolean>;
  /** False once anyone else changed the source; later seeks are ignored. */
  readonly active: boolean;
  /**
   * End the gesture; later seeks resolve `false`.
   *
   * @capability playback.control
   *
   * @example End the gesture when the user lets go
   * Releasing the slider ends the gesture, so a late `dragMove` cannot move
   * playback any more. After `end`, `seek` resolves `false` without doing
   * anything.
   * ```ts
   * declare const bar: Panel;
   * declare const scrub: Scrub;
   * // ---cut---
   * bar.on("dragEnd", () => scrub.end()); // later seeks resolve false
   * ```
   *
   * @since 1.0.0
   */
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
 *
 * @since 1.0.0
 * @category Playback
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

/**
 * Options of {@link Player.openStream}.
 *
 * @see {@link Player.openStream}
 * @since 1.0.0
 * @category Playback
 */
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
 *
 * @since 1.0.0
 * @category Playback
 */
export type StreamStartError = PluginError & {
  /** The start-up step that timed out. */
  stage: "prefill" | "activation";
};

/**
 * A generated source, from {@link Player.openStream}. Disposing it stops it.
 *
 * @remarks
 * A source whose frames this plugin generates, from
 * {@link Player.openStream}. The SDK pulls frames on the audio clock over
 * a local connection and handles prefill, activation and pausing; the plugin
 * only supplies `frame()`. A stream ends when the plugin stops it, when
 * another source replaces it or the user closes it (`onStop` with `null`),
 * or when it fails (`onStop` with the error).
 *
 * @capability producer.av and playback.control
 *
 * @example Stop the stream from a menu item
 * A menu item ends the plugin's generated stream and closes it as the
 * player's source. `stop` closes the source first and then the frame
 * connection, so the user never sees a playback error; `onStop` is not
 * called for the plugin's own stop.
 * ```ts
 * declare const stream: Stream;
 * // ---cut---
 * // Enabled while the stream produces frames.
 * plugin.commands.add({
 *   id: "stop-generator",
 *   path: ["@playback", "Stop generator"],
 *   enabled: () => stream.running,
 *   run: () => stream.stop(),
 * });
 * ```
 *
 * @see {@link Player.openStream}
 * @since 1.0.0
 * @category Playback
 */
export interface Stream extends Disposable {
  /** The stream is producing frames. */
  readonly running: boolean;
  /**
   * The stream stopped for a reason outside this plugin: `error` is null when
   * another source replaced it or the user closed it, otherwise the failure
   * (`stream` with the player's text, `invalid` for a bad frame, …). Not
   * called when the plugin itself stops it (`stop()`, `dispose()`,
   * deactivation): the promise of `stop()` is that notification.
   *
   * The player retires a stream's producer as soon as it is replaced or
   * closed; the SDK reads the player's state to tell that from a failure
   * (before 1.5.7 a replaced or closed stream could get `unavailable`
   * "producer absent"). Without `playback.read` a failure the SDK has not
   * seen yet is reported as null.
   *
   * @capability producer.av
   *
   * @example Tell the user why the stream stopped
   * The OSD explains a failure, and nothing is said when the user simply
   * opened another file. The listener runs only for stops from outside the
   * plugin: `null` for a replacement or the user's close, an error (such as
   * `stream` with the player's text) for a failure.
   * ```ts
   * declare const stream: Stream;
   * // ---cut---
   * stream.onStop((error) => {
   *   if (error) void plugin.osd.show("Generator stopped: {}", [error.message]);
   * });
   * ```
   *
   * @since 1.0.0
   */
  onStop(listener: (error: PluginError | null) => void): Disposable;
  /**
   * Stop producing and close the stream if it is still the player's source.
   * The source closes first, then the frame connection, then the producer,
   * so stopping never shows as a playback failure. `dispose()` and
   * deactivation do the same.
   *
   * @capability producer.av and playback.control
   * @throws Whatever code closing the player's source failed with (the
   *   frame connection and the producer are released either way). A
   *   stream that is no longer the source just resolves.
   *
   * @example Stop the stream when the plugin's window closes
   * Closing the generator window stops the stream it feeds. `stop` closes
   * the player's source if it is still this stream and then the frame
   * connection; it resolves once both are closed.
   * ```ts
   * declare const stream: Stream;
   * declare const window: Window;
   * // ---cut---
   * window.onClose(() => stream.stop());
   * ```
   *
   * @since 1.0.0
   */
  stop(): Promise<void>;
}

/**
 * The plugin that owns "next / previous" (a playlist).
 *
 * @see {@link Player.provideSequence}
 * @since 1.0.0
 * @category Playback
 */
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
 *
 * @see {@link Player.stats}
 * @since 1.0.0
 * @category Playback
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
  /**
   * Frames the video renderer produced. Not all of them reach the screen: a
   * busy window shows only the newest one, so compare
   * {@link PlaybackStats.presentedFps | presentedFps}.
   */
  framesShown: number;
  /** Frames dropped by the backend (mpv), `null` when unknown. */
  framesDropped: number | null;
  /**
   * New video frames the player window showed per second over the last
   * second, measured by the player itself: draws of the main window that put
   * a new picture on screen. Lower than `video.fps` when frames are lost
   * after decoding and rendering (the window could not keep up with the
   * source, or the display refreshes slower); `0` while paused. `null` when
   * the player cannot measure it (no window, the first second, players
   * before 0.5.1).
   *
   * @player 0.5.1
   * @since 1.5.15
   */
  presentedFps: number | null;
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
    /** Hardware decoder in use, e.g. "videotoolbox", "d3d11va-copy"; "no" = software decoding. */
    hwdec: string | null;
    /**
     * How the video is decoded, from `hwdec`: `"hardware"` (the method is in
     * `hwdec`) or `"software"`; `null` before a decoder runs.
     *
     * @since 1.5.15 (with older players the SDK derives it from `hwdec`)
     */
    decoding: "hardware" | "software" | null;
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
 * The file opens and the plugin learns whether it started playing within
 * ten seconds. `open` resolves once the player accepted the load and
 * returns a `Media` handle; `ready` waits for playback and rejects with
 * `failed` (load error), `replaced` (another source took over) or an
 * `AbortError` when the timeout fires, which closes the media.
 * ```ts
 * const media = await plugin.player.open("/Movies/clip.mp4"); // load accepted
 * try {
 *   await media.ready({ signal: AbortSignal.timeout(10_000) });
 * } catch (error) {
 *   void plugin.osd.show("Cannot play: {}", [(error as Error).message]);
 * }
 * ```
 *
 * @remarks
 * `plugin.player` is the player's one source: what is open, its phase and
 * position, and the controls. `state` is a snapshot the SDK keeps current
 * from the player's events (with `events`) and refreshes after this
 * plugin's own calls; `onChange` runs after it changed. Every control is
 * conditional: it acts on the state the plugin last saw and fails with
 * `stale` when the source changed meanwhile: another file, a close, or any
 * pause, seek or speed change by the user or another plugin (see
 * {@link Conditional}). The player keeps the source when a plugin stops;
 * only the plugin's own handles (a stream, its sequence provider, its
 * output device) are withdrawn.
 *
 * @capability `playback.read` to read; `playback.control` to control;
 * `events` to follow changes made elsewhere; `producer.av` for
 * {@link Player.openStream}.
 *
 * @see [Playback state, controls and sources](../../docs/concepts/playback.md), [Control playback](../../docs/how-to/control-playback.md)
 * @since 1.0.0
 * @category Playback
 */
export interface Player {
  /** Latest state; always newer than anything delivered before. */
  readonly state: PlayerState;
  /**
   * The state changed (needs `events` for outside changes).
   *
   * @capability events (for changes made elsewhere; without it the listener
   * runs only after this plugin's own calls)
   *
   * @example Show the position while it plays
   * The OSD block shows the position, updated as playback moves. The SDK
   * updates `player.state` from the player's events and then calls the
   * listener with the new snapshot; the handler only reads it.
   * ```ts
   * const info = plugin.osd.panel();
   * plugin.player.onChange((state) => {
   *   // `position` is null while nothing is open.
   *   info.set(state.position === null ? null : "{} s", [state.position?.toFixed(0) ?? ""]);
   * });
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (state: PlayerState) => void): Disposable;
  /**
   * Read the state from the player now (`playback.read`).
   *
   * @capability playback.read
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.read`.
   *
   * @example Read the state before deciding
   * A command reads the newest state from the player before acting, even
   * without `events`. `refresh` asks the player and resolves with the new
   * snapshot; `player.state` holds it afterwards.
   * ```ts
   * const state = await plugin.player.refresh();
   * if (state.phase === "ready") await plugin.osd.show("{} s left", [((state.duration ?? 0) - (state.position ?? 0)).toFixed(0)]);
   * ```
   *
   * @since 1.0.0
   */
  refresh(): Promise<PlayerState>;
  /**
   * True if nothing changed the source since `state` was observed.
   *
   * @capability None.
   *
   * @example Drop a result that arrives after the file changed
   * A slow lookup for the current file is shown only if that file is still
   * open. `isCurrent` compares the snapshot taken before the work with the
   * SDK's newest state; it is false once the source changed in any way:
   * another file, a close, or a pause, seek or speed change by anyone.
   * ```ts
   * declare function lookUpTitle(path: string): Promise<string>;
   * // ---cut---
   * const seen = plugin.player.state;
   * const title = await lookUpTitle(seen.source ?? "");
   * if (plugin.player.isCurrent(seen)) await plugin.osd.show("{}", [title]); // still the same file
   * ```
   *
   * @since 1.0.0
   */
  isCurrent(state: PlayerState): boolean;
  /**
   * Open a path or URL, replacing the current source (unless `ifCurrent` no
   * longer holds). Resolves when the host accepted the load.
   *
   * It does not wait for playback: use {@link Media.ready}. `paused` opens
   * it paused; aborting `signal` closes it. URLs matching a registered
   * {@link Resolver} are resolved first, and so are local files of an
   * extension a file resolver claims (the source is then a stream that
   * plugin generates; `paused` reaches it).
   *
   * @capability playback.control
   * @throws `stale` (rejects) `ifCurrent` no longer holds; nothing was opened.
   * @throws `replaced` (rejects) Accepted, then another source took over
   *   before it finished (for example while a URL was still being resolved).
   * @throws `invalid` (rejects) An empty `source`.
   * @throws `aborted` (rejects) `signal` aborted (an `AbortError`); the
   *   source is closed if it was opened.
   * @throws `busy` (rejects) The address needs a resolver plugin and the
   *   player is already resolving 32 addresses.
   * @throws `backend` (rejects) A resolver plugin handled the address or
   *   file and failed (its message), or the resolution was cancelled or
   *   expired.
   * @throws `unsupported` (rejects) The player refused what a resolver
   *   returned (for example split streams with different headers).
   * @throws `unavailable` (rejects) The stream a file resolver prepared was
   *   not ready to play.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Open a file paused
   * The file opens at its start without playing. `open` resolves once the
   * player accepted the load and returns a {@link Media} handle for that
   * source; `ready` then waits until it can play (here: until it is loaded
   * and paused).
   * ```ts
   * const media = await plugin.player.open("/Movies/clip.mp4", { paused: true });
   * await media.ready(); // rejects `failed` when the file cannot be loaded
   * ```
   *
   * @since 1.0.0
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
   * (`timeout`), `stream`, `device`, or `replaced` when another source
   * replaced it (or it was closed) before it ran.
   *
   * @example Play pictures the plugin draws itself
   * The player shows a 320×240 picture the plugin renders, with silence as
   * its sound, as the current source. The SDK pulls frames on the audio
   * clock: each `frame()` returns one picture (RGBA bytes) and the audio
   * that plays with it, here 1/60 s, so the picture runs at 60 frames a
   * second; `frame()` may run several times back to back to refill the
   * lead. `onStop` tells the plugin when and why the stream ended.
   * ```ts
   * declare function render(into: Uint8Array): Uint8Array;
   * // ---cut---
   * const frame = new Uint8Array(320 * 240 * 4); // RGBA, reused per frame
   * const silence = new Float32Array(2 * 800); // 1/60 s of stereo at 48 kHz
   * const stream = await plugin.player.openStream({
   *   width: 320,
   *   height: 240,
   *   frame: () => ({ video: render(frame), audio: silence }),
   * });
   * // `error` is null when the stream stopped normally.
   * stream.onStop((error) => error && plugin.osd.show(error.message));
   * ```
   *
   * @capability producer.av and playback.control
   * @throws `timeout` (rejects) A {@link StreamStartError}: the stream did not
   *   start in time.
   * @throws `stream` (rejects) The player failed to start the stream.
   * @throws `device` (rejects) The audio device was not ready.
   * @throws `replaced` (rejects) Another source replaced it, or it was closed,
   *   before it ran.
   * @throws `invalid` (rejects) Bad options (a size or a frame function).
   * @throws `aborted` (rejects) `signal` aborted, or the scope was disposed,
   *   while the stream was starting (an `AbortError`).
   * @since 1.0.0
   */
  openStream(options: StreamOptions): Promise<Stream>;
  /**
   * Pause or resume.
   *
   * @capability playback.control
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin); nothing was done.
   * @throws `invalid` (rejects) Nothing is open.
   * @throws `busy` (rejects) A generated stream is still handling a previous
   *   control.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Pause, but only the file the user was watching
   * A "pause on lock" helper pauses the current file and does nothing when
   * another file was opened in between. The call is conditional on
   * `player.state` by default; `stale` means the source changed and the
   * pause was not applied, which is the intended outcome here.
   * ```ts
   * try {
   *   await plugin.player.setPaused(true);
   * } catch (error) {
   *   if ((error as PluginError).code !== "stale") throw error; // another file now
   * }
   * ```
   *
   * @since 1.0.0
   */
  setPaused(paused: boolean, options?: Conditional): Promise<void>;
  /**
   * Jump to `seconds`.
   *
   * @capability playback.control
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin); nothing was done.
   * @throws `invalid` (rejects) Nothing is open, or `seconds` is negative or
   *   not finite.
   * @throws `unsupported` (rejects) The source is a generated stream, which
   *   cannot seek.
   * @throws `busy` (rejects) A generated stream is still handling a previous
   *   control.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Jump back ten seconds
   * Playback jumps ten seconds back, never before the start. The target is
   * computed from the snapshot the call is conditional on, so if the user
   * opened another file meanwhile the seek fails with `stale` instead of
   * landing in the wrong file.
   * ```ts
   * const { position } = plugin.player.state;
   * if (position !== null && plugin.player.state.can.seek)
   *   await plugin.player.seek(Math.max(0, position - 10)); // seconds
   * ```
   *
   * @since 1.0.0
   */
  seek(seconds: number, options?: Conditional): Promise<void>;
  /**
   * Set the playback speed.
   *
   * @capability playback.control
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin); nothing was done.
   * @throws `invalid` (rejects) Nothing is open, or `rate` is outside
   *   0.05–10.
   * @throws `unsupported` (rejects) The source is a generated stream, which
   *   cannot change speed.
   * @throws `busy` (rejects) A generated stream is still handling a previous
   *   control.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Play at one and a half times the speed
   * Playback speeds up to 1.5×, with the speed on the OSD. `setRate` sets
   * the speed directly (the player's own keys step it by 0.1 within
   * 0.25–4); `state.can.rate` is false for sources that cannot change speed.
   * ```ts
   * if (plugin.player.state.can.rate) {
   *   await plugin.player.setRate(1.5);
   *   await plugin.osd.show("Speed {}×", [1.5]);
   * }
   * ```
   *
   * @since 1.0.0
   */
  setRate(rate: number, options?: Conditional): Promise<void>;
  /**
   * Play from the start (the "replay" after the end).
   *
   * @capability playback.control
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin); nothing was done.
   * @throws `invalid` (rejects) Nothing is open.
   * @throws `unsupported` (rejects) The source is a generated stream, which
   *   cannot restart.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Replay a file after it ended
   * A Replay button starts the file again from its start once it has ended.
   * `restart` plays the current source from the beginning and keeps it the
   * same source, so a {@link Media} handle stays current.
   * ```ts
   * if (plugin.player.state.phase === "ended") await plugin.player.restart();
   * ```
   *
   * @since 1.0.0
   */
  restart(options?: Conditional): Promise<void>;
  /**
   * Close the current source.
   *
   * @capability playback.control
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin); nothing was done.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Close the file when the sleep timer runs out
   * After 30 minutes the open file is closed, unless the user opened another
   * one meanwhile. The snapshot taken when the timer started is passed as
   * `ifCurrent`, so the close applies only to that source; `stale` means it
   * was replaced.
   * ```ts
   * const seen = plugin.player.state;
   * setTimeout(() => {
   *   // Only the source that was open when the timer started.
   *   plugin.player.close({ ifCurrent: seen }).catch((error: PluginError) => {
   *     if (error.code !== "stale") plugin.osd.show("Could not close: {}", [error.code]);
   *   });
   * }, 30 * 60 * 1000);
   * ```
   *
   * @since 1.0.0
   */
  close(options?: Conditional): Promise<void>;
  /**
   * Start a drag gesture from the current state.
   *
   * @capability playback.control
   *
   * @example Start a gesture when the user grabs the slider
   * A drag on the plugin's seek slider becomes one gesture whose seeks never
   * pile up. `scrub()` captures the current state; the gesture's seeks are
   * conditional on it and on each other, and it ends on its own when
   * someone else changes the source.
   * ```ts
   * declare const bar: Panel;
   * // ---cut---
   * let scrub: Scrub | null = null;
   * bar.on("dragStart", () => (scrub = plugin.player.scrub()));
   * bar.on("dragEnd", () => scrub?.end());
   * ```
   *
   * @see [Keep a slider responsive while dragging](../../docs/how-to/slider.md)
   * @since 1.0.0
   */
  scrub(): Scrub;
  /**
   * Device output; last write wins and volume is applied before mute.
   * Resolves `true` when this request was applied, `false` if superseded.
   * `volume` is 0–200.
   *
   * @capability playback.control
   * @throws `invalid` (rejects) `volume` outside 0–200, or `muted` not a
   *   boolean.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Duck the volume during an announcement
   * The volume drops to 30 while the plugin's announcement plays, then
   * returns. Writes are "latest wins": the promise resolves `true` when this
   * write was applied and `false` when a newer one replaced it first, which
   * is not an error.
   * ```ts
   * const before = plugin.player.state.volume; // 0–200
   * await plugin.player.setOutput({ volume: 30 });
   * // … the announcement …
   * await plugin.player.setOutput({ volume: before });
   * ```
   *
   * @since 1.0.0
   */
  setOutput(output: { volume?: number; muted?: boolean }): Promise<boolean>;
  /**
   * Become the sequence provider, first come first served: while another
   * plugin holds it (the built-in playlist registers at activation), this
   * one is refused with `conflict` (`sequence-taken`). That does not fail
   * activation: the player shows a warning ({@link PluginInfo.warnings});
   * a refusal after activation goes to the scope's `onError`. Dispose to
   * stop.
   *
   * @example Drive the player's Next and Previous from a playlist
   * The player's Next and Previous items and keys play the plugin's list.
   * The player calls `next` and `previous` when the user asks; `canNext`
   * and `canPrevious` are evaluated again after every handler the SDK runs,
   * and while they return false the player disables its items ("No next
   * item").
   * ```ts
   * declare const items: string[];
   * let index = 0;
   * // ---cut---
   * const playAt = async (at: number) => {
   *   index = at;
   *   await plugin.player.open(items[at]!);
   * };
   * // Called by the player's Next / Previous items, keys and buttons.
   * plugin.player.provideSequence({
   *   next: () => playAt(index + 1),
   *   previous: () => playAt(index - 1),
   *   canNext: () => index + 1 < items.length,
   *   canPrevious: () => index > 0,
   * });
   * ```
   *
   * @capability playback.control
   * @since 1.0.0
   */
  provideSequence(provider: SequenceProvider): Disposable;
  /**
   * Ask the provider to go forward / back. Rejects `unavailable` when it cannot.
   *
   * @capability playback.control
   * @throws `unavailable` (rejects) There is no sequence provider, or it has
   *   no next item.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Skip to the next item from a plugin button
   * The plugin's own Next button plays the next item of whichever plugin
   * provides the sequence (the playlist, usually). `next` asks the
   * provider, the same as the player's Next key; `unavailable` means there
   * is no next item, which the button treats as the end of the list.
   * ```ts
   * try {
   *   await plugin.player.next(); // as the player's Next key does
   * } catch (error) {
   *   if ((error as PluginError).code !== "unavailable") throw error;
   *   await plugin.osd.show("End of the list");
   * }
   * ```
   *
   * @since 1.0.0
   */
  next(): Promise<void>;
  /**
   * Ask the provider to go back. Rejects `unavailable` when it cannot.
   *
   * @capability playback.control
   * @throws `unavailable` (rejects) There is no sequence provider, or it has
   *   no previous item.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Go back to the previous item
   * The plugin's Previous button asks the sequence provider for the item
   * before the current one, like the player's PageUp. It is disabled while
   * `state.can.previous` is false, which the provider's `canPrevious`
   * decides.
   * ```ts
   * plugin.commands.add({
   *   id: "previous",
   *   title: "Previous item",
   *   // The provider's `canPrevious`, as the player reports it.
   *   enabled: () => plugin.player.state.can.previous,
   *   run: () => plugin.player.previous(),
   * });
   * ```
   *
   * @since 1.0.0
   */
  previous(): Promise<void>;
  /**
   * Codec, size, frame counts and backend of the current playback.
   * `playback.read`; `video` and `audio` are `null` without a source.
   *
   * @capability playback.read
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.read`.
   *
   * @example Show the video codec and size
   * The OSD shows something like "h264 1920×1080". `stats` asks the player
   * for the backend's own values at that moment; `video` is `null` without
   * a video stream (nothing open, an audio file).
   * ```ts
   * const { video } = await plugin.player.stats();
   * if (video) await plugin.osd.show("{} {}×{}", [video.codec ?? "?", video.width ?? 0, video.height ?? 0]);
   * ```
   *
   * @since 1.0.0
   */
  stats(): Promise<PlaybackStats>;
  /**
   * Add an external audio file (absolute local path) to the current media and,
   * unless `select: false`, select it. Resolves with the new track (`external`,
   * not exportable). It stays until the source changes. Rejects `invalid` for a
   * bad path, `unavailable` without ready media, `backend` when it cannot load.
   *
   * @capability playback.control
   * @throws `invalid` (rejects) Not an absolute path to a file.
   * @throws `unavailable` (rejects) No ready media.
   * @throws `backend` (rejects) The player could not load the file.
   * @throws `stale` (rejects) `ifCurrent` no longer holds.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Add a dubbed audio file and switch to it
   * A separate audio file plays with the film instead of its own sound.
   * `addAudioTrack` attaches the file to the current media and selects it;
   * the track stays until another source opens.
   * ```ts
   * declare const dubPath: string;
   * // ---cut---
   * const track = await plugin.player.addAudioTrack(dubPath); // selected too
   * await plugin.osd.show("Audio: {}", [track.title ?? dubPath]);
   * ```
   *
   * @since 1.0.0
   */
  addAudioTrack(
    path: string,
    options?: { select?: boolean } & Conditional,
  ): Promise<AudioTrack>;
  /**
   * Select one of `state.audioTracks` by id; `invalid` for an unknown id.
   *
   * @capability playback.control
   * @throws `invalid` (rejects) No track with this id.
   * @throws `unavailable` (rejects) No ready media.
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin).
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Switch to the next audio track
   * Each press of the plugin's key moves to the next audio track of the
   * file. The tracks and the selected one are in `state.audioTracks`;
   * `selectAudioTrack` resolves with the new state.
   * ```ts
   * const audioTracks = plugin.player.state.audioTracks ?? []; // null: not known yet
   * const at = audioTracks.findIndex((track) => track.selected);
   * const next = audioTracks[(at + 1) % audioTracks.length];
   * if (next) await plugin.player.selectAudioTrack(next.id);
   * ```
   *
   * @since 1.0.0
   */
  selectAudioTrack(id: number, options?: Conditional): Promise<PlayerState>;
  /**
   * One frame or to the next / previous keyframe (pauses for frames). Rejects
   * `unsupported` without moving video (audio only, cover art, a generated
   * stream) or when backwards needs a seekable source.
   *
   * Resolves once the new position is in effect, so `player.state.position`
   * is current afterwards. One step at a time: a second call while one is
   * in flight rejects `busy`.
   *
   * @capability playback.control
   * @throws `unsupported` (rejects) Nothing playable to step through (no
   *   moving video: audio only, cover art, a generated stream), a backward
   *   frame step on a source that cannot seek, or a keyframe step in either
   *   direction on a source that cannot seek.
   * @throws `busy` (rejects) A step is still in flight.
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin).
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Step one frame forward for a close look
   * The picture advances by one frame and playback pauses. `step` resolves
   * once the new position is in effect, so `state.position` is current
   * afterwards; a second step while one is running rejects with `busy`.
   * ```ts
   * await plugin.player.step("frame", "forward");
   * await plugin.osd.show("{} s", [plugin.player.state.position?.toFixed(3) ?? "?"]);
   * ```
   *
   * @since 1.0.0
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
   *
   * `keyframes: true` (player 0.5.1, SDK 1.5.19): the step seeks
   * (`seek-backward` / `seek-forward`, including {@link Host.run} with
   * `seconds` and the picture-in-picture skips) land on a keyframe instead
   * of the exact time: forward on the first keyframe at or after position +
   * step, backward on the last at or before position − step, and they
   * always move. Presses during a seek add up and continue from where it
   * landed; the on-screen text shows the landed time. Sources without moving
   * video seek exactly. {@link Player.seek}, chapters, loops and
   * {@link Player.step} are unaffected, and so is a scrub unless it asks for
   * keyframes itself ({@link Scrub.seek} with `keyframes: true`, SDK 1.5.22).
   * Omitted or `false`: exact seeks, as before. `seconds` and `keyframes`
   * are written as a pair: the newest call sets both.
   *
   * Older players ignore `keyframes`: set `"minPlayerVersion": "0.5.1"` in
   * the manifest when you rely on it.
   *
   * @capability playback.control
   * @throws `invalid` (rejects) `seconds` outside 0.1–3600 or not in tenths,
   *   or `keyframes` not a boolean.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Make ← and → jump 10 seconds to keyframes
   * The arrow keys now jump 10 seconds and land on keyframes, which is fast
   * on large files. The newest call of any plugin wins and is withdrawn
   * when that plugin stops, so a plugin offering this as a setting applies
   * it on activation.
   * ```ts
   * await plugin.player.setStepSeek({ seconds: 10, keyframes: true });
   * ```
   *
   * @since 1.0.0
   */
  setStepSeek(options: { seconds: number; keyframes?: boolean }): Promise<void>;
  /**
   * The chapters of the current media (empty without media or chapters),
   * read on demand; `sourceId` tells which source they belong to.
   * `playback.read`.
   *
   * @capability playback.read
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.read`.
   *
   * @example List the chapters of the open file
   * The plugin reads the chapter titles of the current file to show them in
   * its panel. `chapters` asks the player when called; `sourceId` says which
   * source they belong to, so a reply for a file that was replaced meanwhile
   * can be dropped.
   * ```ts
   * const { sourceId, chapters } = await plugin.player.chapters();
   * if (sourceId === plugin.player.state.sourceId) // still the same file
   *   console.log(chapters.map((chapter) => chapter.title));
   * ```
   *
   * @since 1.0.0
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
   *
   * @capability playback.control
   * @throws `invalid` (rejects) `a`/`b` out of range or `count` not a positive
   *   integer.
   * @throws `unsupported` (rejects) The source cannot seek, or is a generated
   *   stream.
   * @throws `unavailable` (rejects) No ready media.
   * @throws `stale` (rejects) The source changed since the state the call is
   *   based on (another file, a close, or any pause, seek
   *   or speed change by the user or another plugin).
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Loop a passage three times
   * Playback repeats 1:00–1:30 three times, then goes on. The player jumps
   * back to `a` each time it reaches `b`; after the last repeat
   * `state.loop` becomes `null`, and a new source clears the loop.
   * ```ts
   * await plugin.player.setLoop({ a: 60, b: 90, count: 3 }); // seconds
   * ```
   *
   * @since 1.0.0
   */
  setLoop(
    loop: { a: number; b: number; count?: number } | null,
    options?: Conditional,
  ): Promise<void>;
  /**
   * The output devices present now (not the system default entry). `playback.read`.
   *
   * @capability playback.read
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.read`.
   *
   * @example Offer the audio output devices in a menu
   * A submenu lists the output devices present now, with a radio mark on the
   * one in use. `audioDevices` asks the player when called (devices come and
   * go), and `state.audioOutput` tells which one is active.
   * ```ts
   * // The devices present now; build the menu again when they change.
   * for (const device of await plugin.player.audioDevices())
   *   plugin.commands.add({
   *     id: `device.${device.id}`,
   *     path: ["@audio", "Output", device.name],
   *     radio: true,
   *     checked: () => plugin.player.state.audioOutput?.active === device.id,
   *     run: () => plugin.player.setAudioDevice(device.id),
   *   });
   * ```
   *
   * @since 1.0.0
   */
  audioDevices(): Promise<AudioDevice[]>;
  /**
   * Play on this device while it is present, else on the system default
   * (`null` = always the default). Generated streams follow too. Kept for
   * this run only. `playback.control`.
   *
   * Unknown ids are accepted (`state.audioOutput.active` stays `null`); a
   * malformed id is `invalid`. Reverts to the default when this plugin
   * stops; save the choice yourself to restore it on activation.
   *
   * @capability playback.control
   * @throws `invalid` (rejects) A malformed id.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Restore the user's output device on start
   * The plugin plays on the device the user picked last time, or on the
   * system default when it is not connected. The choice lasts only for
   * this run and is withdrawn when the plugin stops, so the plugin saves
   * it itself and sets it again on activation.
   * ```ts
   * const store = plugin.storage.json("output", { defaults: { device: null as string | null } });
   * await plugin.player.setAudioDevice(store.value.device); // null: the system default
   * ```
   *
   * @since 1.0.0
   */
  setAudioDevice(id: string | null): Promise<void>;
}

/**
 * The core's basic playback actions (menu commands owned by the player),
 * and the main window's fullscreen toggle.
 *
 * | action | default bindings | behaviour |
 * | --- | --- | --- |
 * | `stop` | F4 | close the source |
 * | `play-pause` | Space, a left click on the video (player 0.5.2) | pause / resume, replay after the end |
 * | `previous` / `next` | PageUp, Mouse:X1 / PageDown, Mouse:X2 | ask the sequence provider |
 * | `frame-back` / `frame-forward` | D / F | `player.step("frame", …)` |
 * | `seek-backward` / `seek-forward` | ← / → | relative seek by `setStepSeek` seconds (or `host.run`'s `seconds`), exact or to keyframes as `setStepSeek` says |
 * | `rate-normal`, `rate-down`, `rate-up` | Z, X, C | 1×, ±0.1 within 0.25–4 |
 * | `volume-up` / `volume-down` | ↑ / ↓, wheel | ±5 (`volume-up` stops at 100) |
 * | `mute` | M | toggle mute |
 * | `fullscreen` | Enter, Alt+Enter, F11 | toggle the main window's fullscreen: enter it when windowed, leave it when fullscreen, as the Toggle Fullscreen command does (SDK 1.5.21, player 0.5.2; `unavailable` when the player has no window) |
 *
 * In the binding overlay their keys are `host/<action>`. `fullscreen`
 * changes no playback state: read the result from `window.state.fullscreen`
 * (`plugin.window.onChange`), which also changes when the user toggles it.
 * Players before 0.5.2 reject it with `invalid`: set
 * `"minPlayerVersion": "0.5.2"` when you use it.
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
   * @player 0.5.1 (set `"minPlayerVersion": "0.5.1"`: older players ignore
   * `seconds` and seek by the `setStepSeek` step)
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
 * @capability ui.osd
 *
 * @example Show live playback numbers over the video
 * A block over the video shows the position and the duration, updated
 * as playback moves. `player.onChange` runs after the SDK updated the
 * state (with `events`); `set` never throws and sends only the newest
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
   * (`invalid` for too much text, `unavailable` without a user interface,
   * `capability` without `ui.osd`).
   *
   * @capability ui.osd
   *
   * @param text - The text, with `\n` between lines: at most 32 lines and
   *   4096 bytes once translated and formatted. `null` hides the block. A
   *   template, like {@link Osd.show}'s.
   * @param args - Values for its placeholders (player 0.4.3); `null` or
   *   omitted for none.
   * @param options - `maxColumns`: cut long lines (SDK 1.5.11).
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
   * Korean, full-width forms) is two columns, a combining mark none, any
   * other one. An integer from 8 to 1000 (player 0.4.3; older players show
   * whole lines). Measure the video area to choose it.
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
 * [Limits: on-screen display](../../docs/reference/limits.md#on-screen-display)
 * ({@link "@vestra-player/sdk/testing"!OSD_LIMITS | OSD_LIMITS}).
 *
 * @capability ui.osd
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
   * The text is a template in English: the player shows its translation
   * from the plugin's catalog, with the placeholders (`{}`, `{0}`, `{name}`;
   * `{{` and `}}` for braces) filled from `args`. Without `args` the text
   * shows as it is (braces included). Untranslated, the English template is
   * formatted. Never compose the sentence in TypeScript
   * (`` `Speed ${rate}×` ``): translators can only translate whole templates.
   * An argument that is itself words is a {@link Text} (SDK 1.5.11), and a
   * message made of a varying number of parts is a {@link TextList} of
   * texts; `text` may also be a `Text` (then without `args`).
   *
   * @capability ui.osd
   *
   * @param text - The template, 1–200 characters once translated and
   *   formatted; line breaks become spaces.
   * @param args - Values for its placeholders (player 0.4.3; older players
   *   show the template as it is).
   * @returns Resolves once the message is on screen.
   *
   * @throws `invalid` (rejects) The shown text is empty, only white space,
   *   or longer than 200 characters, or `args` is not a {@link TemplateArgs}.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `capability` (rejects) The manifest does not declare `ui.osd`.
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
   * @since 1.0.0
   */
  show(text: TextValue, args?: TemplateArgs): Promise<void>;
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

// ---------------------------------------------------------------- video and audio filters

/**
 * The state of a filter, display layer or render options handle.
 * After `failed` nothing retries automatically until the next `set()`,
 * `retry()` or a new source.
 *
 * @since 1.0.0
 * @category Processing
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
 * @example Brighten the picture and report when it fails
 * Every video plays a little brighter with more contrast, and the OSD
 * says why when the player cannot apply it. `set` records the desired
 * chain (last write wins, one request in flight); the player reapplies it
 * for each new source, and `onStatus` reports `applied` or `failed`.
 * ```ts
 * const picture = plugin.video.filter("picture");
 * // `unsupported` while a generated stream plays: its frames skip filters.
 * picture.onStatus((s) => s.state === "failed" && plugin.osd.show(s.error.message));
 * picture.set([{ kind: "eq", brightness: 0.1, contrast: 1.1, saturation: 1, gamma: 1 }]);
 * ```
 *
 * @remarks
 * Members: `set(nodes)` records the desired chain (last write wins) and
 * sends it, one request at a time and only the newest; `status` and
 * `onStatus` report `waiting`, `applying`, `applied` or `failed`; `retry`
 * applies the current value again; `dispose` withdraws the chain. `set`
 * never throws: a refused chain shows as `failed` in `status`.
 *
 * @capability processing.video, playback.read and events
 * @see [Video and audio processing](../../docs/concepts/processing.md)
 * @since 1.0.0
 * @category Processing
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
 * @example Lower the volume and delay the sound
 * Every file plays 6 dB quieter, with its sound 120 ms later to match a
 * slow display. `set` sends the plugin's whole chain and delay; the
 * player applies it to each source and adds the delays of all plugins.
 * ```ts
 * const audio = plugin.audio.filter("sound");
 * audio.set({ nodes: [{ kind: "volume", gainDb: -6 }], delayMs: 120 }); // 10 ms steps
 * ```
 *
 * @remarks
 * The same members and rules as {@link VideoFilter}: `set` records the
 * desired value and never throws, `status` and `onStatus` report the
 * result, `retry` applies it again, `dispose` withdraws it.
 *
 * @capability processing.audio, playback.read and events
 * @see [Video and audio processing](../../docs/concepts/processing.md)
 * @since 1.0.0
 * @category Processing
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
 *
 * @since 1.0.0
 * @category Processing
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
 * @example Fill the window, then zoom in
 * The video fills the video area (cropped instead of letterboxed), then
 * zooms to 150 % shifted a little to the right. The first plugin to call
 * `view()` owns the display layer; each `set` merges into its settings,
 * which stay across sources until the plugin disposes the view or stops.
 * ```ts
 * const view = plugin.video.view();
 * view.set({ fit: "fill" });
 * view.set({ zoom: 1.5, panX: 0.1 }); // merged with the previous write
 * ```
 *
 * @remarks
 * Not part of snapshots or exports: it changes how the picture sits in the
 * video area, not the picture. `set` merges into the current settings and
 * never throws: an out-of-range value or unknown field shows as `failed`
 * (`invalid`) in `status` and is reported to `onError`, without sending
 * anything.
 *
 * @capability processing.video, playback.read and events (like
 * {@link VideoFilter})
 * @see [Video and audio processing](../../docs/concepts/processing.md)
 * @since 1.0.0
 * @category Processing
 */
export interface VideoView extends Disposable {
  /**
   * Merged into the current settings; last write wins.
   *
   * @capability processing.video
   *
   * @example Stretch a 4:3 video to fill the window
   * A 4:3 video fills a 16:9 window, distorted, as the user asked. Each
   * `set` merges the given fields into this plugin's view settings; the
   * newest write wins, and the settings stay for later files until the
   * plugin disposes the view or stops.
   * ```ts
   * plugin.video.view().set({ fit: "stretch" });
   * ```
   *
   * @since 1.0.0
   */
  set(value: Partial<ViewSettings>): void;
  /** Current status (the same four states as filters). */
  readonly status: FilterStatus;
  /**
   * The status changed.
   *
   * @capability processing.video
   *
   * @example Tell the user another plugin owns the view
   * When another plugin already controls the display layer, the OSD says
   * so. The first plugin to call `view()` owns it; this plugin's handle
   * then reports `failed` with `conflict`, and tries again on its next `set`.
   * ```ts
   * const view = plugin.video.view();
   * view.onStatus((status) => {
   *   if (status.state === "failed" && status.error.code === "conflict")
   *     void plugin.osd.show("Another plugin controls the picture size");
   * });
   * ```
   *
   * @since 1.0.0
   */
  onStatus(listener: (status: FilterStatus) => void): Disposable;
}

/**
 * GPU renderer options; not part of snapshots or exports.
 * Defaults: `{ toneMapping: "auto", targetPeak: 203, peakDetect: true, shaders: [], interpolation: false }`.
 *
 * @since 1.0.0
 * @category Processing
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
 * `unsupported`; {@link SystemInfo.rendering} tells which renderer draws
 * without creating the handle. macOS OpenGL 4.1 has no
 * compute shaders, so `peakDetect` is accepted but has no effect; output
 * is always SDR.
 *
 * @example Tone-map HDR video and hide the menu where it cannot work
 * On a GPU-rendering player HDR video is tone-mapped with BT.2390 for a
 * 250-nit display; under software rendering the plugin hides its HDR menu.
 * `set` merges the values into the plugin's render options and the
 * player reports the result through `onStatus`: `failed` with
 * `unsupported` means the player renders in software (Windows, Linux).
 * ```ts
 * declare function hideHdrMenu(): void;
 * // ---cut---
 * const render = plugin.video.render();
 * render.onStatus((s) => {
 *   if (s.state === "failed" && s.error.code === "unsupported") hideHdrMenu();
 * });
 * render.set({ toneMapping: "bt.2390", targetPeak: 250 }); // nits
 * ```
 *
 * @remarks
 * GPU renderer options (tone mapping, peak detection, shaders,
 * interpolation). Only the GPU renderer has them, which today means macOS;
 * under software rendering the handle is `failed` with `unsupported` after
 * the player's first answer to `render()` (reported to `onError` too), and so is
 * every `set`. Single owner, like {@link VideoView}. `set` never throws; the
 * result shows in `status`.
 *
 * @capability processing.video, playback.read and events (like
 * {@link VideoFilter})
 * @see [Video and audio processing](../../docs/concepts/processing.md)
 * @since 1.0.0
 * @category Processing
 */
export interface RenderOptions extends Disposable {
  /**
   * Merged into the current settings; last write wins.
   *
   * @capability processing.video
   *
   * @example Turn on motion interpolation
   * Motion becomes smoother on the GPU renderer. `set` merges the field into
   * the plugin's render options; under software rendering the status turns
   * `failed` with `unsupported` instead.
   * ```ts
   * plugin.video.render().set({ interpolation: true });
   * ```
   *
   * @since 1.0.0
   */
  set(value: Partial<RenderSettings>): void;
  /**
   * `failed` with `unsupported` while the player renders in software;
   * `failed` with `failed` when mpv cannot compile a shader (pushed later).
   */
  readonly status: FilterStatus;
  /**
   * The status changed (including later pushes such as shader compile errors).
   *
   * @capability processing.video
   *
   * @example Report a shader that does not compile
   * The OSD shows mpv's message when a shader the plugin set fails to
   * compile. The player pushes that failure after the `set` was accepted, so
   * it arrives through `onStatus`, not as a rejected call.
   * ```ts
   * const render = plugin.video.render();
   * render.onStatus((status) => {
   *   if (status.state === "failed") void plugin.osd.show("Render: {}", [status.error.message]);
   * });
   * ```
   *
   * @since 1.0.0
   */
  onStatus(listener: (status: FilterStatus) => void): Disposable;
}

/**
 * Why the GPU's video upscaler does not work, as a stable kebab-case code.
 * A newer player may add codes: compare with the ones you handle and show
 * {@link UpscalingReason.message} for the rest. The codes of player 0.5.16,
 * in the order the player checks them (the first that holds is reported):
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `platform` | The player has no video upscaler on this system (macOS, Linux). |
 * | `no-gpu` | No GPU that can upscale video (Windows: no NVIDIA GPU). |
 * | `driver` | The graphics driver is too old (Windows: an NVIDIA driver before 530). |
 * | `gpu-unsupported` | The driver does not offer upscaling on this GPU (Windows: not an RTX GPU), or the check failed. |
 * | `rendering` | The player renders in software, or GPU rendering is still starting; upscaling needs GPU rendering ({@link Rendering}). |
 * | `adapter` | GPU rendering runs on another GPU than the one that can upscale (a laptop with two GPUs; Windows: choose the high-performance GPU for Vestra in Settings ▸ System ▸ Display ▸ Graphics). |
 * | `decoding` | The video is not decoded on the GPU that renders it: copy-back or software decoding, for example while a {@link VideoFilter} needs the frames in memory. |
 * | `unchecked` | The player has not checked the GPU yet. Only in the answer to `set(false)`, which never starts the check; `state()` and `set(true)` always check first. |
 *
 * `decoding` and `rendering` while GPU rendering is still starting can pass
 * during the run, so `set(true)` accepts them and keeps the request; every
 * other reason holds until the player restarts, and `set(true)` rejects it.
 * Turning upscaling off is always accepted.
 *
 * @example Advise the user by reason
 * The plugin shows its own advice for the reasons the user can act on and
 * the player's message for the rest. `reason.code` is looked up among the
 * codes the plugin knows; an unknown code from a newer player falls
 * through to the message, which names the GPU and what to do.
 * ```ts
 * const { reason } = await plugin.video.upscaling.state();
 * // Advice for the codes this plugin knows; any other code shows the message.
 * const advice: Partial<Record<UpscalingReasonCode, string>> = {
 *   driver: "Update the NVIDIA driver to 530 or newer.",
 *   rendering: "Turn on Video ▸ GPU Rendering (Experimental) and restart.",
 * };
 * if (reason) console.log(advice[reason.code] ?? reason.message);
 * ```
 *
 * @player 0.5.16
 * @since 1.5.37
 * @category Processing
 */
export type UpscalingReasonCode =
  | "platform"
  | "no-gpu"
  | "driver"
  | "gpu-unsupported"
  | "rendering"
  | "adapter"
  | "decoding"
  | "unchecked"
  // Any other string: a newer player's code (the names above stay suggested).
  | (string & {});

/**
 * Why the GPU's video upscaler does not work: a stable
 * {@link UpscalingReasonCode} to branch on and a sentence to show, the same
 * shape as {@link RenderingReason}.
 *
 * @example Grey out a menu item with the player's reason
 * The plugin disables its upscaling item and shows why. `message` is the
 * player's English text, naming the GPU and what the user can do (turn on
 * GPU rendering, choose the other GPU, update the driver); `code` is for
 * decisions.
 * ```ts
 * const { available, reason } = await plugin.video.upscaling.state();
 * if (!available && reason) console.log(`${reason.code}: ${reason.message}`);
 * ```
 *
 * @player 0.5.16
 * @since 1.5.37
 * @category Processing
 */
export interface UpscalingReason {
  /** The reason as a stable kebab-case code; branch on this. */
  readonly code: UpscalingReasonCode;
  /**
   * The reason as English text for people, for example with the GPU's name
   * and what to change; never branch on it.
   */
  readonly message: string;
}

/**
 * What {@link VideoUpscaling.state} and {@link VideoUpscaling.set} report:
 * whether the upscaler works now and why not, whether this plugin turned
 * it on, and whether the player asked the GPU to upscale.
 *
 * @remarks
 * `requested` is as far as the player can see. The player puts the
 * upscaler last in the video filter chain, scaling the video to the area it
 * is shown in; the driver gives no sign that it upscales. On Windows the
 * user must also turn on Super Resolution in the NVIDIA app (System ▸ Video
 * ▸ RTX Video Enhancement), which no program can read: say so next to the
 * switch.
 *
 * @example Label the item with what happens now
 * The plugin's menu item says whether upscaling is on and whether the
 * video is being upscaled. `enabled` is this plugin's own request;
 * `requested` is true while the player has the upscaler in the filter
 * chain, which needs a video shown larger than its own size (`factor`
 * above 1).
 * ```ts
 * const state = await plugin.video.upscaling.state();
 * // `enabled`: this plugin's request; `requested`: in the filter chain now.
 * const label = !state.enabled
 *   ? "AI Upscaling: Off"
 *   : state.requested
 *     ? `AI Upscaling: On (×${state.factor?.toFixed(2)})`
 *     : "AI Upscaling: On (not needed for this video)";
 * console.log(label);
 * ```
 *
 * @player 0.5.16
 * @since 1.5.37
 * @category Processing
 */
export interface UpscalingState {
  /** Whether the upscaler works now; `false` with {@link UpscalingState.reason}. */
  readonly available: boolean;
  /** Why it does not work now; `null` while it does. */
  readonly reason: UpscalingReason | null;
  /** This plugin asked for upscaling ({@link VideoUpscaling.set}) and has not turned it off. */
  readonly enabled: boolean;
  /**
   * The player has the upscaler in the video filter chain now, for this
   * plugin or another one: upscaling is enabled and available and the
   * video is shown larger than its own size. Not a sign that the GPU
   * upscales (see the remarks).
   */
  readonly requested: boolean;
  /**
   * The scale factor the upscaler was asked for (the area the video is
   * shown in over the video's size, in hundredths, above 1); `null` while
   * nothing is requested.
   */
  readonly factor: number | null;
}

/**
 * `plugin.video.upscaling`: the GPU's video upscaler, NVIDIA RTX Video
 * Super Resolution on Windows (`video.upscaling`). Read whether it works
 * here and why not; turn it on or off for this plugin.
 *
 * @remarks
 * The player checks the GPU once, when a plugin first asks, and keeps the
 * answer: the check wakes a sleeping discrete GPU, so call
 * {@link VideoUpscaling.state} when the plugin first needs the answer (the
 * first time the user picks its upscaling item), not while the plugin
 * starts, and do not poll it. `set(false)` never starts the check. It works
 * only with GPU rendering, on the GPU the upscaler runs on, with the video decoded on that GPU; {@link UpscalingReasonCode}
 * lists what can stand in the way.
 *
 * While some plugin has it on and it works, the player puts the upscaler
 * last in the video filter chain and scales the video to the area it is
 * shown in, following window and video size changes (a resize waits until
 * the size holds). A video already shown at its own size or smaller is not
 * upscaled. The upscaler stays while any plugin has it on; it goes when the
 * last one turns it off or stops: the player revokes a stopped plugin's
 * request.
 *
 * **Windows:** the user must turn on Super Resolution in the NVIDIA app
 * (System ▸ Video ▸ RTX Video Enhancement); no program can read that
 * switch, and the driver gives no sign that it upscales
 * ({@link UpscalingState.requested} is as far as the player can see). It
 * uses the NVIDIA GPU, so power use and heat go up, and on a laptop with
 * two GPUs the whole player must run on the NVIDIA one.
 * **macOS, Linux:** `available` is `false` with `platform`.
 *
 * Players before 0.5.16 do not know `video.upscaling` and do not load a
 * plugin that declares it: declare `"minPlayerVersion": "0.5.16"`.
 *
 * @example Offer AI upscaling as a menu item
 * A Video menu item turns upscaling on and off; once the player said it
 * cannot work here, the item is greyed out with the player's reason. The
 * state is read the first time the user picks the item (that runs the
 * player's GPU check, so nothing wakes the GPU while the plugin starts) and
 * again after each pick; `set` resolves with the new state, or rejects with
 * `unsupported` where upscaling cannot work in this run.
 * ```ts
 * let state: UpscalingState | null = null; // unknown until first picked
 * plugin.commands.add({
 *   id: "upscaling",
 *   path: ["@video", "AI Upscaling"],
 *   checked: () => state?.enabled ?? false,
 *   // Greyed only once the player said it cannot work (`decoding` can pass).
 *   enabled: () => state === null || state.available || state.reason?.code === "decoding",
 *   reason: () => state?.reason?.message ?? null, // shown while disabled
 *   run: async () => {
 *     state ??= await plugin.video.upscaling.state(); // the first pick checks the GPU
 *     try {
 *       state = await plugin.video.upscaling.set(!(state?.enabled ?? false));
 *     } catch (error) {
 *       // Cannot work in this run (no RTX GPU, software rendering…).
 *       if ((error as PluginError).code !== "unsupported") throw error;
 *       state = await plugin.video.upscaling.state();
 *     }
 *   },
 * });
 * ```
 *
 * @capability video.upscaling
 * @player 0.5.16; older players do not load a plugin that declares
 * `video.upscaling`.
 * @since 1.5.37
 * @category Processing
 */
export interface VideoUpscaling {
  /**
   * Read whether the upscaler works now and why not, whether this plugin
   * turned it on and what the player asked the GPU for.
   *
   * @capability video.upscaling
   * @returns The state, once the player's GPU check ran (the first call
   *   starts it and may take a moment).
   * @throws `capability` (rejects) The manifest does not declare
   *   `video.upscaling`.
   *
   * @example Find out whether upscaling can work here
   * The plugin reads the state the first time the user picks its upscaling
   * item and keeps it for the item. The first call makes the player check the GPU (which
   * wakes a sleeping discrete GPU) and later calls reuse the answer; the
   * rest (GPU rendering, the GPU it runs on, the decoding) is read at
   * each call.
   * ```ts
   * const { available, reason } = await plugin.video.upscaling.state();
   * if (!available) console.log(reason?.message);
   * ```
   *
   * @since 1.5.37
   */
  state(): Promise<UpscalingState>;
  /**
   * Turn upscaling on or off for this plugin.
   *
   * @remarks
   * On stays this plugin's request until it turns it off or stops; the
   * player upscales whenever the request can take effect (a `decoding`
   * reason can pass with the next file). Off takes the upscaler out at
   * once unless another plugin has it on. Upscaling is a request of the
   * whole plugin, not of a {@link Scope}: disposing a scope does not turn
   * it off.
   *
   * @capability video.upscaling
   * @param enabled - `true` to ask for upscaling, `false` to withdraw the
   *   request.
   * @returns The new state.
   * @throws `capability` (rejects) The manifest does not declare
   *   `video.upscaling`.
   * @throws `invalid` (rejects) `enabled` is not a boolean.
   * @throws `unsupported` (rejects) `true` where upscaling cannot work in
   *   this run: every {@link UpscalingReasonCode} except `decoding`, and
   *   except `rendering` while GPU rendering is still starting (those two
   *   are accepted and the request is kept until they pass); `message` is
   *   the reason. Nothing changes. `false` is always accepted and answered
   *   at once without the GPU check (before any check, `available` is
   *   `false` with `unchecked`).
   *
   * @example Turn upscaling on and explain what is needed
   * The plugin turns upscaling on from its settings and tells the user what
   * else to switch on. `set(true)` records the request and resolves with the
   * new state; where upscaling cannot work in this run it rejects with
   * `unsupported` and the player's reason instead.
   * ```ts
   * try {
   *   const state = await plugin.video.upscaling.set(true);
   *   // The driver's own switch cannot be read: remind the user once.
   *   if (state.enabled) await plugin.osd.show("Turn on Super Resolution in the NVIDIA app");
   * } catch (error) {
   *   if ((error as PluginError).code !== "unsupported") throw error;
   *   await plugin.osd.show("AI upscaling: {}", [(error as PluginError).message]);
   * }
   * ```
   *
   * @since 1.5.37
   */
  set(enabled: boolean): Promise<UpscalingState>;
}

// ---------------------------------------------------------------- subtitles

/**
 * A subtitle track of the current source.
 *
 * @since 1.0.0
 * @category Subtitles
 */
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

/**
 * The subtitle state of the current source.
 *
 * @see {@link Subtitles.state}
 * @since 1.0.0
 * @category Subtitles
 */
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
  /**
   * The effective style: among the plugins that set a layer, the one whose
   * manifest id sorts last (not the most recent call); `null` without one.
   */
  readonly style: SubtitleStyle | null;
  /** Whether the renderer confirmed the selection. */
  readonly trackConfirmation: "waiting" | "applied" | "uncertain";
  /** Whether the renderer confirmed the style. */
  readonly styleConfirmation: "waiting" | "applied" | "uncertain";
  /** The last error, `null` without one. */
  readonly error: string | null;
}

/**
 * Subtitle calls act on the selection you see; pass `ifCurrent` to pin an older one.
 *
 * @since 1.0.0
 * @category Subtitles
 */
export interface SubtitleConditional {
  /** The subtitle state the call is conditional on; `stale` otherwise. */
  ifCurrent?: SubtitlesState;
}

/**
 * `plugin.subtitles`: tracks, uploads and style. Reading needs
 * `subtitles.read`; changes need `subtitles.control` and also
 * `subtitles.read`, since they read the current selection first.
 *
 * @example Load an SRT file as the secondary subtitle
 * An English SRT file shows as a second subtitle line next to the
 * film's own subtitles, in white with an outline. The plugin reads the
 * file and uploads its bytes with `load`, which adds a track to the
 * current source and selects it as the secondary subtitle; `refresh`
 * reads the subtitle state for its font list, and `setStyle` sends this
 * plugin's style layer naming one of those fonts.
 * ```ts
 * import { readFile } from "node:fs/promises";
 * declare const path: string;
 * // ---cut---
 * const bytes = await readFile(path);
 * await plugin.subtitles.load(bytes, { title: "English", select: "secondary" });
 * const { fonts } = await plugin.subtitles.refresh();
 * if (!fonts.length) return;
 * await plugin.subtitles.setStyle({
 *   fontId: fonts[0]!.id,
 *   fontSize: 40, // at the 1080p reference height
 *   color: "white",
 *   outline: 2,
 *   marginPercent: 5,
 *   offsetMs: 0,
 * });
 * ```
 *
 * @remarks
 * The subtitle tracks of the current source, the primary and secondary
 * selection, uploaded files and the style. `state` is the SDK's snapshot of
 * the player's subtitle state (`null` until first read). The player has no
 * subtitle event: the SDK reads the state again when the source, its phase
 * or the backend changes (with `events`) and after this plugin's own
 * changes, so a selection the user or another plugin changed shows only
 * after `refresh()`. A change without `ifCurrent` reads the state first
 * and applies to it; pass `ifCurrent` to make it fail with `stale` when the
 * selection changed since that state. Each change is one operation the
 * player confirms; `select`, `remove` and `setStyle` resolve with the new
 * state, `load` with the new track.
 *
 * @capability `subtitles.read` to read; `subtitles.control` and
 * `subtitles.read` to change; `events` to re-read on source changes.
 *
 * @see [Load subtitles from a plugin](../../docs/how-to/subtitles.md)
 * @since 1.0.0
 * @category Subtitles
 */
export interface Subtitles {
  /** `null` until first read. */
  readonly state: SubtitlesState | null;
  /**
   * The subtitle state changed.
   *
   * @capability events and subtitles.read
   *
   * @example Show the subtitle language after a new file opens
   * When a new file starts, the OSD names the language of its primary
   * subtitle. The SDK reads the subtitle state again when the source or its
   * phase changes (there is no subtitle event, so a selection changed in the
   * player shows only after `refresh()`) and then calls the listener;
   * `selected` is `null` when subtitles are off.
   * ```ts
   * plugin.subtitles.onChange((state) => {
   *   // A track's language is null when the file does not say.
   *   void plugin.osd.show("Subtitles: {}", [state.selected?.language ?? "off"]);
   * });
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (state: SubtitlesState) => void): Disposable;
  /**
   * Read the state from the player now.
   *
   * @capability subtitles.read
   * @throws `capability` (rejects) The manifest does not declare
   *   `subtitles.read`.
   *
   * @example Count the subtitle tracks of the file
   * The plugin reads how many subtitle tracks the file has before building a
   * menu. `refresh` asks the player and resolves with the current state, also
   * without `events`; `state` holds it afterwards.
   * ```ts
   * const { tracks } = await plugin.subtitles.refresh();
   * await plugin.osd.show("{} subtitle tracks", [tracks.length]);
   * ```
   *
   * @since 1.0.0
   */
  refresh(): Promise<SubtitlesState>;
  /**
   * `role: "secondary"` sets the secondary subtitle: a text track that is not
   * the primary one (`invalid` otherwise). A new source clears it.
   * `track: null` turns the role off.
   *
   * @capability subtitles.control and subtitles.read
   * @throws `stale` (rejects) With `ifCurrent`: the source or the subtitle
   *   selection changed since that state.
   * @throws `invalid` (rejects) An unknown track; as secondary, a bitmap
   *   track or the primary one; as primary, the current secondary.
   * @throws `missing` (rejects) The track is not in the current source.
   * @throws `unavailable` (rejects) Nothing loaded, or the source is still
   *   loading or not yet confirmed.
   * @throws `busy` (rejects) Too many subtitle operations at once.
   * @throws `capability` (rejects) The manifest does not declare
   *   `subtitles.control` and `subtitles.read`.
   *
   * @example Turn on the first English subtitle
   * The first English track becomes the primary subtitle, but only in the
   * file the plugin looked at. Embedded tracks are chosen by number, so
   * without `ifCurrent` a select after another file opened would pick that
   * file's track with the same number; with `ifCurrent: state` it fails with
   * `stale` instead. Without `ifCurrent`, `select` reads the newest state
   * itself and almost never fails with `stale`.
   * ```ts
   * const state = await plugin.subtitles.refresh();
   * const english = state.tracks.find((track) => track.language === "en");
   * if (english)
   *   await plugin.subtitles.select(english, { ifCurrent: state }).catch((error: PluginError) => {
   *     if (error.code !== "stale") throw error; // another file or selection now
   *   });
   * ```
   *
   * @since 1.0.0
   */
  select(
    track: SubtitleTrack | null,
    options?: SubtitleConditional & { role?: "primary" | "secondary" },
  ): Promise<SubtitlesState>;
  /**
   * Upload a subtitle file's bytes (UTF-8 SRT, or ASS/SSA with
   * `format: "ass"`) for the current source; select it unless
   * `select: "none"`. `title` (1–200 characters) names the track: data, or
   * a {@link Text} the player translates (`text("{} · {}", [text("Simplified
   * Chinese"), file])`, SDK 1.5.11). Aborting
   * `signal` before the commit discards the upload (rejects with AbortError);
   * once the commit was sent it completes.
   *
   * Limits: SRT ≤ 2 MiB and ≤ 10,000 cues; ASS ≤ 2 MiB with `[Script Info]`
   * and `[Events]` and 1–20,000 `Dialogue:` lines. Convert other formats
   * (VTT, SAMI) to SRT first. Per source, a plugin has at most 4 loaded
   * tracks at once and loads at most 16 files (removed ones count), and
   * every plugin together at most 16 tracks; see `SUBTITLE_LIMITS` in
   * `@vestra-player/sdk/testing`.
   *
   * @capability subtitles.control and subtitles.read
   * @throws `invalid` (rejects) A bad `format` or `title`, or a file over the
   *   limits.
   * @throws `stale` (rejects) With `ifCurrent`: the source changed since
   *   that state.
   * @throws `unavailable` (rejects) Nothing loaded, or the source is still
   *   loading.
   * @throws `aborted` (rejects) `signal` aborted before the commit (an
   *   `AbortError`); the upload is discarded.
   * @throws `busy` (rejects) Too many subtitle operations at once, or a
   *   limit of `SUBTITLE_LIMITS` is reached (4 tracks of this plugin, 16
   *   loads of this plugin or 16 tracks in the source, or another of its
   *   limits); nothing is loaded.
   * @throws `capability` (rejects) The manifest does not declare
   *   `subtitles.control` and `subtitles.read`.
   *
   * @example Load a downloaded SRT and select it
   * A subtitle file the plugin downloaded becomes a track of the current file
   * and is selected. The plugin passes the file's bytes; the player parses
   * them, adds an `external` track for this source only and resolves with
   * it once the upload is committed.
   * ```ts
   * declare const url: string;
   * // ---cut---
   * const response = await fetch(url);
   * if (!response.ok) throw new Error(`subtitles: HTTP ${response.status}`);
   * const bytes = new Uint8Array(await response.arrayBuffer());
   * const track = await plugin.subtitles.load(bytes, { title: "Downloaded" }); // selected
   * await plugin.osd.show("Loaded {}", [track.title]);
   * ```
   *
   * @since 1.0.0
   */
  load(
    bytes: Uint8Array,
    options?: SubtitleConditional & {
      format?: "srt" | "ass";
      title?: string | Text;
      select?: "primary" | "secondary" | "none";
      signal?: AbortSignal;
    },
  ): Promise<SubtitleTrack>;
  /**
   * Remove a track this plugin loaded.
   *
   * @capability subtitles.control and subtitles.read
   * @throws `invalid` (rejects) The track was not loaded by this plugin.
   * @throws `stale` (rejects) With `ifCurrent`: the source changed since
   *   that state.
   * @throws `unavailable` (rejects) Nothing is loaded, or the source is
   *   still loading.
   * @throws `busy` (rejects) Too many subtitle operations at once.
   * @throws `capability` (rejects) The manifest does not declare
   *   `subtitles.control` and `subtitles.read`.
   *
   * @example Remove the subtitle the plugin loaded
   * The plugin's downloaded subtitle disappears from the track list. A plugin
   * can remove only tracks it loaded itself; a new source removes them
   * anyway.
   * ```ts
   * declare const loaded: SubtitleTrack;
   * // ---cut---
   * await plugin.subtitles.remove(loaded);
   * ```
   *
   * @since 1.0.0
   */
  remove(
    track: SubtitleTrack,
    options?: SubtitleConditional,
  ): Promise<SubtitlesState>;
  /**
   * Set this plugin's style layer; `null` removes it. The newest call of
   * this plugin replaces its earlier layer. When several plugins have a
   * layer, the player uses the one whose manifest id sorts last, whatever
   * the order of the calls.
   *
   * @capability subtitles.control and subtitles.read
   * @throws `invalid` (rejects) A field out of range.
   * @throws `unsupported` (rejects) A font that is not in `state.fonts`, or a
   *   primary subtitle that is a bitmap track.
   * @throws `stale` (rejects) With `ifCurrent`: the subtitle state changed
   *   since that state.
   * @throws `unavailable` (rejects) Nothing is loaded, or the source is
   *   still loading.
   * @throws `busy` (rejects) Too many subtitle operations at once.
   * @throws `capability` (rejects) The manifest does not declare
   *   `subtitles.control` and `subtitles.read`.
   *
   * @example Take the plugin's style off again
   * The plugin removes its style layer, so the subtitles go back to the
   * player's default (or to another plugin's layer). `null` removes only this
   * plugin's layer; the effective layer is the one whose manifest id sorts
   * last among the plugins that still have one.
   * ```ts
   * await plugin.subtitles.setStyle(null);
   * ```
   *
   * @since 1.0.0
   */
  setStyle(
    style: SubtitleStyle | null,
    options?: SubtitleConditional,
  ): Promise<SubtitlesState>;
}

// ---------------------------------------------------------------- capture and export

/**
 * Options of {@link MediaCapture.capture}. Conditional on `player.state`
 * like other controls.
 *
 * @since 1.0.0
 * @category Media
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

/**
 * A frozen, immutable input for exports. Dispose to release it.
 *
 * @remarks
 * A frozen input, from {@link MediaCapture.capture}: the source, the time
 * and (processed) the effects and subtitle as they were. Exports read it in
 * the player's offline worker, so one snapshot can be exported several
 * times and playback is unaffected. Disposing it releases the player's
 * copy; an export using it after that fails with `released`.
 *
 * @capability media.read and media.control
 *
 * @example Export one frame as PNG and as JPEG
 * The same frozen frame is written twice, lossless and compressed. Each
 * `export` starts a job of its own; the snapshot is released after both
 * are done.
 * ```ts
 * const snapshot = await plugin.media.capture();
 * try {
 *   const png = await snapshot.export({ format: "png", destination: "/tmp/frame.png" });
 *   const jpeg = await snapshot.export({ format: "jpeg", destination: "/tmp/frame.jpg", quality: 85 });
 *   await Promise.all([png.done, jpeg.done]); // terminal states, not errors
 * } finally {
 *   await snapshot.dispose();
 * }
 * ```
 *
 * @since 1.0.0
 * @category Media
 */
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
   *
   * @capability media.read and media.control
   * @throws `released` (rejects) The snapshot was already released.
   * @throws `invalid` (rejects) Bad options (`quality` outside 1–100, a
   *   relative destination, a clip `end` not after the snapshot time or
   *   past the duration).
   * @throws `busy` (rejects) This plugin runs 2 exports (or the player 8).
   * @throws `unavailable` (rejects) No FFmpeg, or the export worker could not
   *   start.
   * @throws `capability` (rejects) The manifest does not declare
   *   `media.read` and `media.control`.
   *
   * @example Export a 30-second clip
   * A clip from the snapshot time to 30 seconds later is written as MP4.
   * `export` resolves once the job is accepted; the job then runs in the
   * player's offline worker, and `done` resolves with its terminal state,
   * whose `outcome` has the destination or the error.
   * ```ts
   * declare const snapshot: Snapshot;
   * // ---cut---
   * const job = await snapshot.export({ format: "mp4", destination: "/tmp/clip.mp4", end: snapshot.time + 30 });
   * const end = await job.done;
   * if (end.status !== "completed") await plugin.osd.show("Export {}", [end.status]);
   * ```
   *
   * @since 1.0.0
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
 *
 * @since 1.0.0
 * @category Media
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
 *
 * @since 1.0.0
 * @category Media
 */
export type JobState = Omit<MediaJob, "jobId">;

/**
 * An export, from {@link Snapshot.export}. Disposing an unfinished job cancels it.
 *
 * @remarks
 * One export, from {@link Snapshot.export}. `state` is the SDK's last copy
 * of the job's state: the SDK polls the player about every 350 ms until the
 * job ends, and `refresh` reads it at once. `done` resolves
 * once the job is terminal (`completed`, `failed` or `cancelled`) and never
 * rejects for a failed export: the failure is in `outcome`. Disposing an
 * unfinished job cancels it.
 *
 * @capability media.read and media.control
 *
 * @example Show export progress and cancel on request
 * The OSD shows the job's status while it runs, and a Cancel command stops
 * it. `onChange` follows the state (`queued`, `running`, `cancelling`,
 * then a terminal one); `cancel` asks the worker to stop. After
 * `requested` the job usually ends `cancelled`, or `failed` when the
 * cleanup failed.
 * ```ts
 * declare const job: ExportJob;
 * // ---cut---
 * job.onChange((state) => void plugin.osd.show("Export: {}", [state.status]));
 * plugin.commands.add({ id: "cancel-export", title: "Cancel export", run: () => job.cancel() });
 * await job.done; // completed, failed or cancelled
 * ```
 *
 * @since 1.0.0
 * @category Media
 */
export interface ExportJob extends Disposable {
  /** Latest state. */
  readonly state: JobState;
  /**
   * The state changed.
   *
   * @capability media.read
   *
   * @example Log each state of an export
   * The plugin's log records each status the job goes through (`queued`,
   * `running`, `cancelling` after a cancel, then a terminal one). The listener runs when the SDK learns a
   * new state from its polling.
   * ```ts
   * declare const job: ExportJob;
   * // ---cut---
   * job.onChange((state) => console.log("export", state.status));
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (state: JobState) => void): Disposable;
  /**
   * Resolves with the terminal state (completed, failed or cancelled).
   *
   * @throws `disposed` (rejects) The job handle was disposed while waiting.
   */
  readonly done: Promise<JobState>;
  /**
   * Ask to cancel: `requested`, `tooLate` (already publishing) or `terminal` (already over).
   *
   * @capability media.control
   * @throws `rejected` (rejects) The player did not accept the request.
   * @throws `capability` (rejects) The manifest does not declare
   *   `media.control`.
   *
   * @example Cancel an export the user no longer wants
   * The running export stops, unless it is already writing its file.
   * `cancel` resolves `requested` when the worker will stop (the job ends
   * `cancelled`), `tooLate` when it is already publishing the file, and
   * `terminal` when the job had already ended.
   * ```ts
   * declare const job: ExportJob;
   * // ---cut---
   * const answer = await job.cancel();
   * if (answer === "tooLate") await plugin.osd.show("Too late: the file is being written");
   * ```
   *
   * @since 1.0.0
   */
  cancel(): Promise<"requested" | "tooLate" | "terminal">;
  /**
   * Read the state from the player now.
   *
   * @capability media.read
   * @throws `capability` (rejects) The manifest does not declare
   *   `media.read`.
   *
   * @example Read a job's state now
   * The plugin reads the newest state of an export without waiting for an
   * event. `refresh` asks the player and resolves with the state, which
   * `state` then holds.
   * ```ts
   * declare const job: ExportJob;
   * // ---cut---
   * const state = await job.refresh();
   * console.log(state.status);
   * ```
   *
   * @since 1.0.0
   */
  refresh(): Promise<JobState>;
}

/**
 * `plugin.media`: snapshots and exports. Needs `media.read` and
 * `media.control` (processed snapshots also `playback.read` and
 * `subtitles.read`). Exports decode offline and do not disturb playback.
 *
 * @example Save the current frame as JPEG
 * The frame on screen, with the plugin's own picture effects, is saved
 * where the user chooses. `capture` freezes the source as it was in
 * `seen` (and fails with `stale` if the user opened another file while
 * the dialog was open); `export` decodes offline without disturbing
 * playback, and `done` resolves with the job's final status.
 * ```ts
 * const seen = plugin.player.state;
 * const destination = await plugin.dialogs.saveFile({ fileName: "frame.jpg" });
 * if (!destination) return;
 * const snapshot = await plugin.media.capture({ ifCurrent: seen, processed: true });
 * // Release the frozen frame whatever happens to the export.
 * try {
 *   const job = await snapshot.export({ format: "jpeg", destination, quality: 85 });
 *   const end = await job.done;
 *   if (end.status !== "completed") throw new Error(`export ${end.status}`);
 * } finally {
 *   await snapshot.dispose();
 * }
 * ```
 *
 * @remarks
 * Exports run in the player's offline worker from a frozen
 * {@link Snapshot}: a still frame or a clip, raw or with this plugin's
 * effects (and the primary subtitle). Playback is not disturbed. A plugin
 * holds at most 4 snapshots at a time (16 in the player); release them
 * when done.
 *
 * @capability media.read and media.control (processed snapshots also
 * `playback.read` and `subtitles.read`)
 * @since 1.0.0
 * @category Media
 */
export interface MediaCapture {
  /**
   * Freeze the current source (and optionally this plugin set's effects)
   * as an input for exports. Fails `stale` when the source changed since
   * `ifCurrent`; `unsupported` for subtitles that cannot be flattened (only
   * plain SRT text can) or a picture over the size limits; `noSource` when
   * nothing is playing.
   *
   * @capability media.read and media.control
   * @throws `stale` (rejects) The source changed since `ifCurrent`.
   * @throws `noSource` (rejects) Nothing is playing.
   * @throws `invalid` (rejects) `at` at or after the end of the source.
   * @throws `busy` (rejects) This plugin holds 4 snapshots (or the player 16);
   *   release one.
   * @throws `unavailable` (rejects) A processed snapshot while the picture is
   *   still being prepared.
   * @throws `unsupported` (rejects) A processed snapshot the player cannot
   *   freeze: subtitles that cannot be flattened (only plain SRT text can),
   *   or a picture over the size limits.
   * @throws `capability` (rejects) The manifest does not declare
   *   `media.read` and `media.control`.
   *
   * @example Freeze the frame at the 10-second mark
   * The plugin freezes the frame at 0:10 of the open file, raw, to export it
   * later. `capture` resolves with a `Snapshot` once the player has frozen
   * that input; the snapshot stays valid when playback moves on or the file
   * changes, until it is released.
   * ```ts
   * const snapshot = await plugin.media.capture({ at: 10 }); // seconds
   * try {
   *   // … export it …
   * } finally {
   *   await snapshot.dispose(); // frees one of the plugin's 4 snapshot slots
   * }
   * ```
   *
   * @since 1.0.0
   */
  capture(options?: CaptureOptions): Promise<Snapshot>;
}

// ---------------------------------------------------------------- source resolvers

/**
 * Declaration of {@link Resolvers.add}: a web resolver
 * ({@link WebResolverOptions}) or a file resolver ({@link FileResolverOptions}).
 *
 * @since 1.0.0
 * @category Sources
 */
export type ResolverOptions = WebResolverOptions | FileResolverOptions;

/**
 * A resolver for web pages: `https://host/…` to playable stream URLs.
 *
 * @since 1.0.0
 * @category Sources
 */
export interface WebResolverOptions {
  /** Local id, unique within the plugin. */
  id: string;
  /** URL schemes handled. */
  schemes: ("http" | "https")[];
  /** Exact host names. */
  hosts: string[];
  /** Turn a page URL into playable stream URLs. */
  resolve(url: string, signal: AbortSignal): Promise<ResolvedMedia>;
}

/**
 * A resolver for local files by extension (SDK 1.5.3, player 0.4.1): when
 * anyone opens such a file with {@link Player.open} (the Open dialog, the
 * playlist, next / previous, the recent list, a drop that calls `open`),
 * the player asks this plugin for a stream it generates instead of
 * playing the file. Needs `source.resolve` and `producer.av`.
 *
 * @remarks
 * The open keeps everything of the original call: its `ifCurrent`, its
 * operation (the opener's `open` and `media.ready()` settle as for any
 * file), `paused` (the stream starts paused), and its path as
 * `state.source`, with `state.kind` `"stream"`. A thrown error fails that
 * open: `phase` `"error"` with the error's message as `state.error`,
 * word for word. The stream belongs to this plugin, as with
 * {@link Player.openStream}.
 *
 * Cancellation: `signal` aborts when the open is replaced, closed
 * (`player.close()`, F4) or times out (30 seconds), or this resolver is
 * disposed. Cancelled after `resolve` returned but before the stream ran,
 * the SDK releases the stream and never calls `started`.
 *
 * One extension has one resolver: another plugin's resolver for it makes
 * {@link Resolver.ready} reject with `conflict` without failing activation
 * (the player shows a warning). When this plugin stops, its extensions are
 * free again and such files go to the player as before.
 *
 * @example Play CHIP-8 programs with the plugin's own emulator
 * Opening a `.ch8` file anywhere in the player (Open dialog, playlist,
 * recent list) runs it in the plugin's emulator instead of failing as an
 * unknown format. The player calls `resolve` with the path; the plugin
 * reads the program and returns a stream whose `frame()` the SDK pulls on
 * the audio clock, one 1/60 s frame per call. `started` runs once the
 * stream plays; `signal` aborts the read when the open is replaced or
 * closed.
 * ```ts
 * import { readFile } from "node:fs/promises";
 * // The plugin's own emulator (made up here): one frame per call.
 * declare function emulator(program: Uint8Array): () => StreamFrame;
 * // ---cut---
 * plugin.resolvers.add({
 *   id: "chip8",
 *   extensions: ["ch8"], // lower case, no dot; matches Game.CH8 too
 *   async resolve(path, signal) {
 *     const frame = emulator(await readFile(path, { signal }));
 *     return {
 *       kind: "stream",
 *       width: 64, // CHIP-8's display
 *       height: 32,
 *       frame,
 *       started: (stream) => stream.onStop((error) => error && plugin.osd.show(error.message)),
 *     };
 *   },
 * });
 * ```
 *
 * @since 1.5.3
 * @category Sources
 */
export interface FileResolverOptions {
  /** Local id, unique within the plugin. */
  id: string;
  /**
   * Lower case, without the dot: 1–16 entries of 1–16 lower-case letters or
   * digits (not `"folder"`). Only absolute local paths match, by their
   * extension in any case (`/roms/Game.NES`); URLs never do.
   */
  extensions: string[];
  /** Read the file and describe the stream to generate for it. */
  resolve(path: string, signal: AbortSignal): Promise<ResolvedStream>;
}

/**
 * What a file resolver returns: a stream, with the same frame contract as
 * {@link StreamOptions} (size limits, `frame()` on the audio clock).
 *
 * After `resolve` returns, the SDK starts the stream while the open waits.
 * If that fails, the open fails with the player's words instead of the
 * SDK's (the detail goes to the log): `device` "音频输出设备不可用",
 * `timeout` "启动超时", `busy` "播放器正忙，请稍后重试", other start-up
 * failures "无法启动播放". An error thrown by `frame()` keeps its message.
 * To give your own text for a file you can tell is unusable (a bad header),
 * check it in `resolve` and throw there.
 *
 * @since 1.5.3
 * @category Sources
 */
export interface ResolvedStream {
  /** Always `"stream"`. */
  kind: "stream";
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Produce the next frame. Never called concurrently or while paused. */
  frame(): StreamFrame;
  /**
   * Called with the running stream once the player plays it, synchronously
   * after activation and before any {@link Stream.onStop}. Not called when
   * the open was cancelled first. `stream.stop()` closes the source (if
   * still current); the plugin stopping stops it too.
   */
  started?(stream: Stream): void;
}

/**
 * A registered resolver. Disposing it unregisters it and aborts resolutions in flight.
 *
 * @remarks
 * A registered resolver, from {@link Resolvers.add}. Disposing it, its
 * scope or stopping the plugin unregisters it and aborts resolutions in
 * flight; the extensions or hosts are free again for other plugins.
 *
 * @capability source.resolve
 *
 * @example Report when another plugin already handles the format
 * The plugin tells the user when its `.ch8` resolver could not register
 * because another plugin holds that extension. `ready` rejects with
 * `conflict`; for another plugin's claim that does not fail activation, so
 * the plugin keeps running without the resolver.
 * ```ts
 * const resolver = plugin.resolvers.add({
 *   id: "chip8",
 *   extensions: ["ch8"],
 *   async resolve() {
 *     throw plugin.i18n.error("Not ready yet.");
 *   },
 * });
 * // Rejects with `conflict` when the extension is taken.
 * resolver.ready.catch((error: PluginError) => {
 *   if (error.code === "conflict") void plugin.osd.show("Another plugin plays .ch8 files");
 * });
 * ```
 *
 * @since 1.0.0
 * @category Sources
 */
export interface Resolver extends Disposable {
  /**
   * Resolves when the player registered it; rejects otherwise: `conflict`
   * when another resolver has the extension or the scheme + host (another
   * plugin's: activation goes on; this plugin's own: activation fails),
   * `invalid` for a malformed declaration (a player before 0.4.1 also for
   * `extensions`).
   *
   * @throws `conflict` (rejects) Another resolver has the extension or the
   *   scheme + host, or this plugin already registered this id.
   * @throws `busy` (rejects) The player already holds 16 resolvers.
   * @throws `invalid` (rejects) A malformed declaration.
   * @throws `capability` (rejects) The manifest does not declare
   *   `source.resolve`.
   */
  readonly ready: Promise<void>;
}

/**
 * `plugin.resolvers`: turn web page URLs into playable streams, or local
 * files into streams this plugin generates. Needs `source.resolve` (file
 * resolvers also `producer.av`).
 *
 * @example Play pages of a video site
 * Opening a `https://video.example.com/…` page plays its video. When the
 * user opens a URL whose scheme and host this resolver declares, the
 * player asks the plugin first; `resolve` returns the stream's address,
 * and `signal` aborts the lookup when the open is replaced or closed.
 * ```ts
 * plugin.resolvers.add({
 *   id: "example",
 *   schemes: ["https"],
 *   hosts: ["video.example.com"],
 *   async resolve(url, signal) {
 *     const response = await fetch(url, { signal }); // the site's JSON for the page
 *     if (!response.ok) throw new Error(`video.example.com answered ${response.status}`);
 *     const page = await response.json();
 *     return { kind: "media", originalUrl: url, title: page.title, primary: { url: page.stream } };
 *   },
 * });
 * ```
 *
 * @remarks
 * A resolver turns something the player cannot play by itself into
 * something it can: a web page address into stream URLs
 * ({@link WebResolverOptions}), or a local file of a format the plugin
 * understands into a stream the plugin generates
 * ({@link FileResolverOptions}). The player asks the resolver whenever
 * anyone opens a matching address or file (the Open dialog, the playlist,
 * another plugin), so the plugin does not intercept opens itself.
 *
 * @capability source.resolve (file resolvers also `producer.av`)
 * @see [Playback state, controls and sources](../../docs/concepts/playback.md)
 * @since 1.0.0
 * @category Sources
 */
export interface Resolvers {
  /**
   * Register a resolver. When anyone opens a matching URL or file the
   * player calls `resolve`; `signal` aborts when the open is cancelled or
   * replaced. One scheme + host pair, and one extension, has one resolver
   * (`conflict` otherwise). A rejected `resolve` fails the open with the
   * error's message.
   *
   * @capability source.resolve
   *
   * @example Play a site's pages through the plugin
   * Opening a `https://video.example.com/…` address plays the page's video.
   * `add` returns at once and registers in the background (`ready` reports
   * the answer); from then on the player calls `resolve` for every matching
   * open, and the error a rejected `resolve` carries is what the user sees.
   * ```ts
   * plugin.resolvers.add({
   *   id: "example",
   *   schemes: ["https"],
   *   hosts: ["video.example.com"], // exact host names
   *   async resolve(url, signal) {
   *     const response = await fetch(url, { signal });
   *     if (!response.ok) throw new Error(`the page answered ${response.status}`);
   *     const page = (await response.json()) as { title: string; stream: string };
   *     return { kind: "media", originalUrl: url, title: page.title, primary: { url: page.stream } };
   *   },
   * });
   * ```
   *
   * @since 1.0.0
   */
  add(options: ResolverOptions): Resolver;
  /**
   * The extensions some plugin's file resolver handles (SDK 1.5.8, player
   * 0.4.2): lower case, without the dot, sorted, each once; not who
   * registered them. Reading needs no capability; `[]` from older players.
   * Without `events` it is the list from when the plugin first read it.
   * Use it to accept such files beside the player's own media types, for
   * example in a playlist's drop or folder scan.
   *
   * @example Accept files that a resolver plugin can play
   * A plugin's own file filter also accepts types other plugins turn into
   * streams. `fileTypes` lists the extensions every running file resolver
   * claims (lower case, no dot); the SDK keeps it current with `events`.
   * ```ts
   * const MEDIA = ["mp4", "mkv", "mp3"];
   * // Extensions compare in lower case, without the dot.
   * const accepted = (path: string) => {
   *   const extension = path.split(".").pop()?.toLowerCase() ?? "";
   *   return MEDIA.includes(extension) || plugin.resolvers.fileTypes.includes(extension);
   * };
   * ```
   *
   * @capability None.
   * @player 0.4.2
   * @since 1.5.8
   */
  readonly fileTypes: readonly string[];
  /**
   * {@link Resolvers.fileTypes} changed: a file resolver was added, or its
   * plugin stopped. Needs `events`; without it the listener never fires.
   *
   * @param listener - Receives the new list.
   * @returns A handle that removes the listener.
   *
   * @example Say which file types became playable
   * When a plugin with a file resolver starts or stops, the OSD lists the
   * extra file types now accepted. The listener (which needs `events`)
   * receives the new list each time it changes.
   * ```ts
   * plugin.resolvers.onFileTypesChange((types) => {
   *   void plugin.osd.show("Also accepted: {}", [plugin.i18n.list(types)]);
   * });
   * ```
   *
   * @capability `events`
   * @player 0.4.2
   * @since 1.5.8
   */
  onFileTypesChange(listener: (types: string[]) => void): Disposable;
}

// ---------------------------------------------------------------- packages (plugins.manage)

/**
 * The manifest of a package, as validated. The display fields and
 * `minPlayerVersion` are optional (player 0.2.0); see the API reference for
 * their rules.
 *
 * @since 1.0.0
 * @category Packages
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
 *
 * @since 1.1.0
 * @category Packages
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

/**
 * Options of {@link PackageCandidate.install}.
 *
 * @since 1.1.0
 * @category Packages
 */
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

/**
 * A validated package directory, from {@link Packages.validate}.
 *
 * @remarks
 * A package the player has checked, from {@link Packages.validate} or
 * {@link Packages.validateArchive}: its manifest, digest and the checks
 * it passed. The player copies the whole package when it checks it and
 * installs that copy, so later changes to the directory do not matter.
 * Installing starts a {@link PackageChange}; the player keeps only the 32
 * most recent candidates.
 *
 * @capability plugins.manage
 *
 * @example Show what a package asks for before installing it
 * Before installing, the plugin shows the package's name and the
 * capabilities it declares. The candidate's `manifest` is the manifest
 * as the player read it.
 * ```ts
 * declare const directory: string;
 * // ---cut---
 * const candidate = await plugin.packages.validate(directory);
 * const { id, version, capabilities } = candidate.manifest;
 * await plugin.osd.show("{} {}: {}", [id, version, capabilities.join(", ")]);
 * ```
 *
 * @since 1.0.0
 * @category Packages
 */
export interface PackageCandidate {
  /** The package directory. */
  readonly directory: string;
  /** Content digest of the package. */
  readonly digest: string;
  /** Its manifest. */
  readonly manifest: PackageManifest;
  /** The checks the player ran. */
  readonly checks: string[];
  /**
   * Install it. The same source upgrades the installed plugin (its data
   * stays); another source fails with `conflict` unless `replace` is set;
   * a built-in id fails with `unsupported` (built-ins update with the
   * player). A reserved id (`vestra` or `vestra.*`, which every built-in
   * uses) fails with `reserved` (player 0.4.1; already when validated), as
   * only the player installs built-in plugins.
   *
   * @capability plugins.manage
   * @throws `conflict` (rejects) The plugin is installed from another source
   *   and `replace` is not set.
   * @throws `unsupported` (rejects) A built-in plugin's id.
   * @throws `reserved` (rejects) A reserved id (`vestra`, `vestra.*`).
   * @throws `busy` (rejects) The plugin library is being cleaned up, or the
   *   player already keeps 64 change records.
   * @throws `revisionConflict` (rejects) The installed revision of this
   *   plugin changed meanwhile; call `install` again (no new validation
   *   needed).
   * @throws `stale` (rejects) The candidate is older than the 32 the player
   *   keeps.
   * @throws `capability` (rejects) The manifest does not declare
   *   `plugins.manage`.
   *
   * @example Replace a plugin installed from another source
   * The new package replaces the installed plugin even though it came from
   * another source. Without `replace` the player refuses with `conflict`;
   * the same source simply upgrades and keeps the plugin's data.
   * ```ts
   * declare const candidate: PackageCandidate;
   * // ---cut---
   * const change = await candidate.install({ replace: true });
   * await change.done; // "committed" once the new plugin runs
   * ```
   *
   * @since 1.0.0
   */
  install(options?: InstallOptions): Promise<PackageChange>;
}

/**
 * The progress of an install or uninstall.
 *
 * @since 1.0.0
 * @category Packages
 */
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
 * An install or uninstall in progress. The SDK never submits a
 * change twice: after a lost reply it only queries the same request.
 *
 * @remarks
 * An install or uninstall the player carries out in steps (`preparing`,
 * `activating`, possibly `restoring`) until a terminal status. The SDK
 * asks the player for the status about every 400 ms until then; `done`
 * resolves with the terminal status and does not reject for a failed
 * change: `message` says why.
 *
 * @capability plugins.manage
 *
 * @example Report each step of an install
 * The OSD shows each step of the install and the end result. `onChange`
 * runs for every new status; `done` resolves when the change is over.
 * ```ts
 * declare const change: PackageChange;
 * // ---cut---
 * change.onChange((status) => void plugin.osd.show("Install: {}", [status]));
 * const end = await change.done;
 * if (end !== "committed") await plugin.osd.show("Not installed: {}", [change.message ?? end]);
 * ```
 *
 * @since 1.0.0
 * @category Packages
 */
export interface PackageChange {
  /** Current status. */
  readonly status: PackageChangeStatus;
  /** Details for failures, `null` otherwise. */
  readonly message: string | null;
  /**
   * The status changed.
   *
   * @capability plugins.manage
   *
   * @example Close a progress window when the change ends
   * The plugin's progress window closes once the install is over, whatever
   * the outcome. The listener receives each new status; the terminal ones
   * are `committed`, `cancelled`, `failed`, `failedDegraded` and `tooLate`
   * (`tooLate` only answers a `cancel` of a change that had committed, and
   * `committed` may follow it).
   * ```ts
   * declare const change: PackageChange;
   * declare const progress: Window;
   * // ---cut---
   * change.onChange((status) => {
   *   if (["committed", "cancelled", "failed", "failedDegraded", "tooLate"].includes(status))
   *     void progress.close();
   * });
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (status: PackageChangeStatus) => void): Disposable;
  /**
   * Resolves with the final status.
   *
   * @throws `missing` (rejects) The player no longer knows the change (a
   *   `HostError` with that code); a failed change is a terminal status,
   *   not a rejection.
   */
  readonly done: Promise<PackageChangeStatus>;
  /**
   * Ask to cancel (it may be `tooLate`).
   *
   * @capability plugins.manage
   * @throws `capability` (rejects) The manifest does not declare
   *   `plugins.manage`.
   *
   * @example Cancel an install the user no longer wants
   * The install stops if it has not gone too far. `cancel` asks the player;
   * the change then ends `cancelled`. When the change had already committed
   * the player answers `tooLate` and `done` still resolves `committed`; a
   * change that is restoring cannot be cancelled and ends `failed` or
   * `failedDegraded`.
   * ```ts
   * declare const change: PackageChange;
   * // ---cut---
   * await change.cancel();
   * console.log(await change.done); // "cancelled"; "committed" when it was too late
   * ```
   *
   * @since 1.0.0
   */
  cancel(): Promise<void>;
}

/**
 * One plugin as the player knows it (`packages.list`).
 *
 * @since 1.0.0
 * @category Packages
 */
export interface PluginInfo {
  /** Manifest id. */
  id: string;
  /** Version, `null` when unknown. */
  version: string | null;
  /** From the install library, or a `--plugin` development load. */
  origin: "installed" | "development";
  /** Run state. */
  state: "starting" | "running" | "disabled" | "failed" | "stopped";
  /** Why it failed (`state: "failed"`). */
  error: string | null;
  /** Declared capabilities. */
  capabilities: string[];
  /**
   * The package directory (read its `manifest.json` for display fields).
   * A built-in's directory is inside the player installation
   * (`<install resources>/plugins/<id>`) and read-only: a plugin writes only
   * under its own {@link Plugin.dataDirectory}.
   */
  directory: string;
  /**
   * Shipped with the player: it always runs; it cannot be disabled,
   * uninstalled or replaced (older players, before SDK 1.5.18, let it be disabled).
   * `false` from players before 0.2.0.
   */
  builtin: boolean;
  /** Where an installed plugin came from; `null` for development loads. */
  source: PackageSource | null;
  /**
   * Its data directory (`plugin.dataDirectory` of that plugin); `null` when
   * the player has none. The path's layout is not part of the API.
   */
  dataDirectory: string | null;
  /**
   * What a running plugin was refused because another plugin holds it: a
   * panel position (`slot-occupied`, with `slot`) or the next/previous
   * sequence (`sequence-taken`). Neither fails activation; `error` has the
   * same as text. Empty from players before 0.4.x (after 0.4.0).
   * Always set by the SDK; optional so that code building `PluginInfo`
   * values itself (tests) keeps compiling.
   *
   * @since 1.5.2
   */
  warnings?: readonly PluginWarning[];
  /**
   * The manifest's display texts in the interface language, translated
   * with that package's catalog; absent from players before 0.4.3 (read
   * `manifest.json` there).
   *
   * @since 1.5.9
   */
  display?: PluginDisplay;
  /**
   * For `state: "running"`: `"running"` while its process runs, `"idle"`
   * while the player stopped it because nothing used it (lazy activation:
   * it starts again on its next use, its menu items, keys, settings pages,
   * resolvers and drop targets stay). Absent in other states and from
   * players before 0.5.18. A change between the two alone does not fire
   * {@link Packages.onChange}.
   *
   * @since 1.5.38
   */
  process?: "running" | "idle";
}

/**
 * {@link PluginInfo.display}: a package's `name`, `punchline`,
 * `description` and `tags` as the player shows them.
 *
 * @since 1.5.9
 *
 * @category Packages
 */
export interface PluginDisplay {
  /** `name`, translated; `null` when the manifest has none. */
  readonly name: string | null;
  /** `punchline`, translated; `null` when the manifest has none. */
  readonly punchline: string | null;
  /** `description`, translated; `null` when the manifest has none. */
  readonly description: string | null;
  /** `tags`, each translated. */
  readonly tags: readonly string[];
}

/**
 * One refusal in {@link PluginInfo.warnings}.
 *
 * @since 1.5.2
 *
 * @category Packages
 */
export interface PluginWarning {
  /**
   * `"slot-occupied"`, `"sequence-taken"` or `"resolver-taken"` (player
   * 0.4.1); a newer player may add codes.
   */
  code: string;
  /** The panel position (`"bottom"`, `"sidebar"`, `"backdrop"`) for `slot-occupied`. */
  slot?: string;
  /**
   * What was taken, for `resolver-taken`: 「文件类型 .nes」 or the
   * `scheme://host` of a web resolver.
   */
  target?: string;
  /** The manifest id of the plugin holding it (absent for a full sidebar). */
  owner?: string;
}

/**
 * `plugin.packages`: the plugins the player knows. `list` and `onChange`
 * need no capability; everything else needs `plugins.manage`.
 *
 * @example Install a plugin from an unpacked package
 * The plugin installs a package directory it downloaded and unpacked, and
 * reports why when it does not work. `validate` asks the player to check
 * the package and returns a candidate; `install` starts the change and
 * `done` resolves with its final status: `committed` only once the new
 * plugin reported that it is running, otherwise `failed`, `cancelled`,
 * `failedDegraded` or `tooLate`.
 * ```ts
 * declare const unpackedDirectory: string;
 * // ---cut---
 * const candidate = await plugin.packages.validate(unpackedDirectory);
 * const change = await candidate.install();
 * // `message` says why a change did not commit.
 * if ((await change.done) !== "committed") throw new Error(change.message ?? "install failed");
 * ```
 *
 * @remarks
 * The plugins the player knows: installed, built-in and this run's
 * development loads. Reading the list needs no capability; installing,
 * enabling, reloading and uninstalling need `plugins.manage` and act on
 * other plugins, never on the calling one. Built-in plugins update with
 * the player and cannot be installed, disabled or uninstalled.
 *
 * @capability None for `list` and `onChange`; plugins.manage for the rest.
 * @since 1.0.0
 * @category Packages
 */
export interface Packages {
  /**
   * Validate a package directory (`plugins.manage`). A package whose id is
   * reserved for the built-in plugins (`vestra` or `vestra.*`) fails with
   * `reserved` (player 0.4.1).
   *
   * The player keeps the 32 most recent candidates of all plugins; an
   * older one's `install` fails with `stale` (validate again). Before
   * player 0.4.2 the 33rd validation of a run failed with `busy` instead.
   *
   * @capability plugins.manage
   * @throws `host` (rejects) Not a package directory, or a manifest that
   *   breaks the rules (another `apiVersion` included); `message` says why.
   * @throws `invalid` (rejects) A bad request (a path that is not a string).
   * @throws `javascript` (rejects) The entry module does not parse.
   * @throws `slint` (rejects) A Slint file does not compile.
   * @throws `reserved` (rejects) A reserved id (`vestra`, `vestra.*`).
   * @throws `versionMismatch` (rejects) The package's `minPlayerVersion` is
   *   newer than the player.
   * @throws `disabled` (rejects) The calling plugin is stopping.
   * @throws `capability` (rejects) The manifest does not declare
   *   `plugins.manage`.
   *
   * @example Check a package directory before installing it
   * The plugin checks a folder it unpacked and installs it if the player
   * accepts it. `validate` runs the player's checks and resolves with a
   * candidate; a package that fails them rejects with the reason.
   * ```ts
   * declare const directory: string;
   * // ---cut---
   * try {
   *   // Rejects with the reason when the package fails the checks.
   *   const candidate = await plugin.packages.validate(directory);
   *   await (await candidate.install()).done;
   * } catch (error) {
   *   await plugin.osd.show("Not a valid plugin: {}", [(error as Error).message]);
   * }
   * ```
   *
   * @since 1.0.0
   */
  validate(directory: string): Promise<PackageCandidate>;
  /**
   * Validate a `.vxp` package file (`plugins.manage`, player 0.2.0): the
   * same checks as {@link Packages.validate} after unpacking. Check the
   * file's sha256 yourself before calling when you know it. A reserved id
   * fails with `reserved`, as in {@link Packages.validate}.
   *
   * @capability plugins.manage
   * @throws `invalid` (rejects) The path does not end in `.vxp`, or the
   *   archive cannot be unpacked (over 64 MB, too many files, a damaged zip,
   *   an unsafe path).
   * @throws `host` (rejects) The unpacked package or its manifest breaks the
   *   rules; `message` says why.
   * @throws `javascript` (rejects) The entry module does not parse.
   * @throws `slint` (rejects) A Slint file does not compile.
   * @throws `reserved` (rejects) A reserved id.
   * @throws `versionMismatch` (rejects) The package's `minPlayerVersion` is
   *   newer than the player.
   * @throws `disabled` (rejects) The calling plugin is stopping.
   * @throws `capability` (rejects) The manifest does not declare
   *   `plugins.manage`.
   *
   * @example Install a downloaded package file
   * A `.vxp` the plugin downloaded is checked and installed. The player
   * unpacks and checks it like a directory; checking the file's sha256
   * first, when the store publishes one, is up to the plugin.
   * ```ts
   * declare const file: string;
   * // ---cut---
   * const candidate = await plugin.packages.validateArchive(file); // a .vxp path
   * const change = await candidate.install();
   * await plugin.osd.show("Install: {}", [await change.done]);
   * ```
   *
   * @since 1.1.0
   */
  validateArchive(file: string): Promise<PackageCandidate>;
  /**
   * Every plugin: running, installed, and this run's development loads. No capability.
   *
   * @capability None.
   * @throws `Error` (rejects) Only when the player cannot be asked; no
   *   capability is needed.
   *
   * @example Show which plugins are running
   * The plugin lists the running plugins by name. `list` asks the player
   * and resolves with every plugin it knows, with its state, origin and
   * display texts in the interface language.
   * ```ts
   * const plugins = await plugin.packages.list();
   * const running = plugins.filter((info) => info.state === "running");
   * console.log(running.map((info) => info.display?.name ?? info.id));
   * ```
   *
   * @since 1.0.0
   */
  list(): Promise<PluginInfo[]>;
  /**
   * The new list after any start, stop, failure, install or uninstall. No capability.
   *
   * @capability None.
   *
   * @example Refresh a plugin list after any change
   * A store window's list updates when a plugin starts, stops, fails, is
   * installed or uninstalled. The listener receives the new list each time.
   * ```ts
   * plugin.packages.onChange((plugins) => console.log(plugins.length, "plugins"));
   * ```
   *
   * @since 1.0.0
   */
  onChange(listener: (plugins: PluginInfo[]) => void): Disposable;
  /**
   * Stop or start a plugin (`plugins.manage`). An installed plugin stays
   * disabled across launches; a development load only for this run.
   * `invalid` to disable oneself, `missing` unknown.
   * `busy` while it is being installed or reloaded. `unsupported` to disable a built-in
   * ({@link PluginInfo.builtin}): users manage third-party plugins only
   * (players released with SDK 1.5.18 on; older ones disabled built-ins too).
   *
   * @capability plugins.manage
   * @throws `invalid` (rejects) Disabling the calling plugin itself.
   * @throws `missing` (rejects) An unknown id.
   * @throws `busy` (rejects) The plugin is being installed or reloaded.
   * @throws `unsupported` (rejects) A built-in plugin.
   * @throws `capability` (rejects) The manifest does not declare
   *   `plugins.manage`.
   *
   * @example Turn a third-party plugin off
   * The plugin stops another plugin and keeps it disabled across launches
   * until it is enabled again. Built-in plugins cannot be disabled
   * (`unsupported`).
   * ```ts
   * await plugin.packages.setEnabled("someone.demo", false);
   * ```
   *
   * @since 1.0.0
   */
  setEnabled(id: string, enabled: boolean): Promise<void>;
  /**
   * Restart a plugin (`plugins.manage`): stop it and start it again from the
   * same package with the same data directory, for example to recover one
   * that misbehaves. Built-ins included. A stopped or failed plugin is just
   * started. The disabled flag is never written, so a reload never leaves
   * a plugin disabled.
   *
   * Resolves once the plugin is stopped and its start is scheduled; the
   * player starts it as soon as the old process is gone (at most 20 s).
   * Follow it with {@link Packages.onChange}: `starting`, then `running`,
   * or `failed` with the reason.
   *
   * `invalid` for oneself or a disabled plugin (enable it instead),
   * `missing` unknown, `busy` while it is being installed or reloaded.
   *
   * @player 0.5.1; older players reject it as an unknown request
   * (`unsupported`).
   * @since 1.5.19
   *
   * @capability plugins.manage
   * @throws `invalid` (rejects) The calling plugin itself, or a disabled
   *   plugin.
   * @throws `missing` (rejects) An unknown id.
   * @throws `busy` (rejects) The plugin is being installed or reloaded.
   * @throws `unsupported` (rejects) A player before 0.5.1.
   * @throws `capability` (rejects) The manifest does not declare
   *   `plugins.manage`.
   *
   * @example Restart a plugin that misbehaves
   * The other plugin is stopped and started again from the same package and
   * data. `reload` resolves once the old process is stopped and the start is
   * scheduled; `onChange` then shows `starting` and `running` (or `failed`).
   * ```ts
   * await plugin.packages.reload("someone.demo");
   * ```
   */
  reload(id: string): Promise<void>;
  /**
   * Remove an installed plugin (`plugins.manage`); `removeData` also deletes
   * its data directory, otherwise reinstalling it from the same source
   * reconnects to its data. Its user bindings stay (as orphans).
   * `unsupported` for built-ins and development loads, `missing`
   * unknown, `invalid` for oneself.
   *
   * @capability plugins.manage
   * @throws `unsupported` (rejects) A built-in plugin or a development load.
   * @throws `missing` (rejects) An unknown id.
   * @throws `invalid` (rejects) The calling plugin itself.
   * @throws `busy` (rejects) The plugin library is being cleaned up, or that
   *   plugin is being installed or reloaded.
   * @throws `revisionConflict` (rejects) The installed revision of that
   *   plugin changed meanwhile; call `uninstall` again.
   * @throws `capability` (rejects) The manifest does not declare
   *   `plugins.manage`.
   *
   * @example Uninstall a plugin together with its data
   * The other plugin is removed and its data directory deleted, so a later
   * reinstall starts fresh. Without `removeData` a reinstall from the same
   * source finds its data again.
   * ```ts
   * const change = await plugin.packages.uninstall("someone.demo", { removeData: true });
   * await change.done;
   * ```
   *
   * @since 1.0.0
   */
  uninstall(
    id: string,
    options?: { removeData?: boolean },
  ): Promise<PackageChange>;
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
   * The menu path's keys: the English text menus merge by, the same in
   * every interface language (`["Playback", "Seek", "Back 5 s"]`; a
   * built-in menu by its key, `"Video"`, also when declared as `@video`).
   * `null` for a command outside the menu, and from players before 0.4.3.
   * Find a command by where it is in the menu with this, not with `path`.
   * Always set by `list()`; optional so that test fakes written for older
   * SDKs still type-check.
   *
   * @since 1.5.11
   */
  key?: string[] | null;
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
 * @see [Commands, menus and key bindings](../../docs/concepts/commands.md)
 * @since 1.0.0
 * @category Commands
 */
export interface Bindings {
  /**
   * Every declared command, and overrides whose command is gone.
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
   * override. At most every 200 ms; since player 0.5.21 only when the list
   * itself changed, not when a plugin starts again with the same commands.
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

// ---------------------------------------------------------------- shared services

/**
 * The system clipboard (`clipboard`). Unavailable without a user interface.
 *
 * Platforms: macOS writes text as UTF-8 and images as their original
 * PNG/JPEG bytes; Windows writes Unicode text and images as a bitmap plus
 * PNG. Other systems: `unsupported`. Failures: `invalid`, `missing`,
 * `unavailable`, `failed` (the system refused).
 *
 * @example Copy the current file and position
 * The clipboard holds "path @ seconds" for pasting into a note. The
 * player writes the system clipboard; it rejects with `unsupported` on
 * systems other than macOS and Windows and `failed` when the system
 * refuses, which the plugin reports.
 * ```ts
 * const { source, position } = plugin.player.state;
 * try {
 *   await plugin.clipboard.writeText(`${source} @ ${position}`); // data, not shown
 * } catch (error) {
 *   void plugin.osd.show("Could not copy: {}", [(error as PluginError).code]);
 * }
 * ```
 *
 * @remarks
 * The player reads and writes the system clipboard on the plugin's behalf.
 * Text is plain text; images are written from a PNG or JPEG file.
 *
 * @capability clipboard
 * @since 1.0.0
 * @category Services
 */
export interface Clipboard {
  /**
   * Plain text on the clipboard; `null` when it holds none.
   *
   * @capability clipboard
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   * @throws `failed` (rejects) The system refused (Windows).
   * @throws `capability` (rejects) The manifest does not declare
   *   `clipboard`.
   *
   * @example Open a URL the user copied
   * A "Paste and play" command opens the address on the clipboard. `readText`
   * resolves with the clipboard's text, or `null` when it holds none (an
   * image, nothing).
   * ```ts
   * const text = await plugin.clipboard.readText();
   * if (text?.startsWith("https://")) await plugin.player.open(text.trim());
   * ```
   *
   * @since 1.0.0
   */
  readText(): Promise<string | null>;
  /**
   * Replace the clipboard with text (at most 1 MiB of UTF-8).
   *
   * @capability clipboard
   * @throws `invalid` (rejects) More than 1 MiB of UTF-8.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   * @throws `failed` (rejects) The system refused.
   * @throws `capability` (rejects) The manifest does not declare
   *   `clipboard`.
   *
   * @example Copy the playing file's path
   * The path of the playing file is put on the clipboard, replacing what was
   * there. It resolves once the system has it.
   * ```ts
   * const { source } = plugin.player.state;
   * if (source) await plugin.clipboard.writeText(source);
   * ```
   *
   * @since 1.0.0
   */
  writeText(text: string): Promise<void>;
  /**
   * Replace the clipboard with a PNG or JPEG file (absolute path, at most 16 MB).
   *
   * @capability clipboard
   * @throws `missing` (rejects) The file does not exist.
   * @throws `invalid` (rejects) Not an absolute path, not PNG or JPEG, over
   *   16 MB, or (Windows) an image the system cannot decode.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   * @throws `failed` (rejects) The system refused.
   * @throws `capability` (rejects) The manifest does not declare
   *   `clipboard`.
   *
   * @example Copy a snapshot to the clipboard
   * A frame the plugin saved as PNG is put on the clipboard, ready to paste
   * into another application. The player reads the file and writes the
   * image (macOS: its original bytes; Windows: a bitmap plus PNG).
   * ```ts
   * declare const pngPath: string;
   * // ---cut---
   * await plugin.clipboard.writeImage(pngPath); // absolute path, at most 16 MB
   * await plugin.osd.show("Snapshot copied");
   * ```
   *
   * @since 1.0.0
   */
  writeImage(path: string): Promise<void>;
}

/**
 * Keeping the computer awake (`playback.control`).
 *
 * @remarks
 * A request, not a command: the player keeps the system awake while any
 * plugin asks for it and a source plays, and withdraws a plugin's request
 * when it stops.
 *
 * @capability playback.control
 *
 * @example Keep the display on while playing
 * The screen does not dim or sleep while a video plays, and may again when
 * it is paused or ends. The player takes the system's assertion only while
 * a source is ready and not paused.
 * ```ts
 * await plugin.power.preventSleep("playing"); // "off" withdraws the request
 * ```
 *
 * @since 1.0.0
 * @category Services
 */
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
   *
   * @capability playback.control
   * @throws `invalid` (rejects) A mode other than `"off"` or `"playing"`.
   * @throws `capability` (rejects) The manifest does not declare
   *   `playback.control`.
   *
   * @example Follow the plugin's own "Keep awake" setting
   * The plugin keeps the display awake during playback only while its
   * setting is on. Each call replaces this plugin's request; `"off"`
   * withdraws it, and other plugins' requests still count.
   * ```ts
   * const store = plugin.storage.json("power", { defaults: { keepAwake: true } });
   * await plugin.power.preventSleep(store.value.keepAwake ? "playing" : "off");
   * ```
   *
   * @since 1.0.0
   */
  preventSleep(mode: "off" | "playing"): Promise<void>;
}

/**
 * The output of {@link Tools.run}.
 *
 * @see {@link Tools.run}
 * @since 1.0.0
 * @category Services
 */
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
 * @example Read a file's format with ffprobe
 * The plugin gets a media file's container details as JSON. `available`
 * says whether ffprobe can be found (`VESTRA_FFPROBE`, then `PATH`); `run`
 * starts it from the plugin's own process without a shell and resolves
 * with its output as bytes once it exits, or rejects when it fails
 * (`failed`, with the last stderr line) or takes longer than `timeoutMs`.
 * ```ts
 * declare const path: string;
 * // ---cut---
 * if (await plugin.tools.available("ffprobe")) {
 *   const { stdout } = await plugin.tools.run(
 *     "ffprobe",
 *     ["-v", "error", "-show_format", "-of", "json", path],
 *     { timeoutMs: 10_000 }, // give up on a stuck file after 10 s
 *   );
 *   const info = JSON.parse(new TextDecoder().decode(stdout));
 *   void info.format; // container, duration, bit rate…
 * }
 * ```
 *
 * @remarks
 * ffmpeg and ffprobe run as child processes of the plugin. When
 * `VESTRA_FFMPEG` / `VESTRA_FFPROBE` is set, only that path is used (an
 * invalid one means the tool is not found); otherwise the tool is searched
 * on `PATH`. A found path is kept for the plugin's run, a miss is looked up
 * again next time. Disposing the
 * scope ends a running process.
 *
 * @capability None.
 * @since 1.0.0
 * @category Services
 */
export interface Tools {
  /**
   * Run ffmpeg or ffprobe (`VESTRA_FFMPEG` / `VESTRA_FFPROBE` when set, else
   * found on `PATH`) without a shell. Rejects `unavailable` (not found), `timeout`,
   * `failed` (non-zero exit; `message` is the last stderr line), `invalid`
   * (output over `maxOutput`, default 16 MiB), `aborted` (`signal`). Timeout,
   * `signal` and disposing the scope end the process.
   *
   * Arguments are passed as-is (no quoting needed). On Windows `PATHEXT` is
   * honoured. Ending sends SIGTERM, then SIGKILL after 300 ms (immediate on
   * Windows).
   *
   * @capability None.
   * @throws `unavailable` (rejects) The tool was not found.
   * @throws `timeout` (rejects) It ran longer than `timeoutMs`; the process is
   *   ended.
   * @throws `failed` (rejects) A non-zero exit; `message` is the last stderr
   *   line.
   * @throws `invalid` (rejects) Bad arguments or options, or output over
   *   `maxOutput`.
   * @throws `aborted` (rejects) `signal` aborted, or the scope was disposed.
   *
   * @example Cut a clip without re-encoding
   * The plugin writes the first ten seconds of the file to a new file. `run`
   * starts ffmpeg without a shell (arguments pass as they are, no quoting)
   * and resolves with its output once it exits with 0; a failure rejects
   * with the last line ffmpeg printed.
   * ```ts
   * declare const input: string;
   * declare const output: string;
   * // ---cut---
   * await plugin.tools.run(
   *   "ffmpeg",
   *   ["-y", "-i", input, "-t", "10", "-c", "copy", output],
   *   { timeoutMs: 60_000 }, // give up after a minute
   * );
   * ```
   *
   * @since 1.0.0
   */
  run(
    tool: "ffmpeg" | "ffprobe",
    args: string[],
    options: { timeoutMs: number; maxOutput?: number; signal?: AbortSignal },
  ): Promise<ToolResult>;
  /**
   * Whether the tool can be found.
   *
   * @capability None.
   * @throws Never; it resolves `false` when the tool cannot be found.
   *
   * @example Grey out a command when ffmpeg is missing
   * The Export item is disabled with a reason when ffmpeg is not installed.
   * `available` looks the tool up (a found path is kept, a miss is looked
   * up again on the next call, so installing it later is noticed).
   * ```ts
   * const hasFfmpeg = await plugin.tools.available("ffmpeg");
   * plugin.commands.add({
   *   id: "export",
   *   path: ["@video", "Export…"],
   *   enabled: hasFfmpeg,
   *   // Shown with the greyed-out item.
   *   reason: hasFfmpeg ? null : "Install ffmpeg to export",
   *   run() {},
   * });
   * ```
   *
   * @since 1.0.0
   */
  available(tool: "ffmpeg" | "ffprobe"): Promise<boolean>;
}

/**
 * A JSON file `dataDirectory/<name>.json`, loaded once and saved debounced.
 *
 * @remarks
 * One JSON file, `<dataDirectory>/<name>.json`, made by
 * {@link Storage.json}. `value` is read once when the store is made;
 * `save` replaces it in memory at once and writes the file `debounceMs`
 * later (300 by default) through a temporary file and a rename, so a
 * crash never leaves half a file. Writes to one file run one at a time,
 * newest last. Disposing the store, its scope or stopping the plugin
 * writes a pending save first.
 *
 * @capability None.
 *
 * @example Count how often the plugin was started
 * The counter grows by one at every start and is kept in `stats.json`. The
 * store reads the file when it is made (the defaults when there is none),
 * and `save` writes the new count a moment later.
 * ```ts
 * const stats = plugin.storage.json("stats", { defaults: { starts: 0 } });
 * stats.save({ starts: stats.value.starts + 1 }); // written 300 ms later
 * ```
 *
 * @since 1.0.0
 * @category Services
 */
export interface JsonStore<T> extends Disposable {
  /** The loaded value, or `defaults` when the file was missing or broken. */
  readonly value: T;
  /**
   * Replace the value now and write it after `debounceMs`.
   * Only `save` writes: mutating `value` in place is not saved.
   *
   * @capability None.
   *
   * @example Save a slider value without writing on every move
   * Dragging the plugin's volume slider updates the stored value at once but
   * writes the file only once the user stops for 300 ms. Each `save`
   * replaces the value and restarts the debounce timer.
   * ```ts
   * declare const window: Window;
   * // ---cut---
   * const store = plugin.storage.json("prefs", { defaults: { volume: 100 } });
   * window.on("volumeChanged", (volume: number) => store.save({ ...store.value, volume }));
   * ```
   *
   * @since 1.0.0
   */
  save(next: T): void;
  /**
   * Write a pending save now.
   *
   * @capability None.
   * @throws `Error` (rejects) Node's file system error when the file cannot
   *   be written; its `code` is Node's (`ENOSPC`, `EACCES` and so on), not a
   *   player error code.
   *
   * @example Write the file now before copying it
   * Before exporting its settings, the plugin makes sure the file on disk has
   * the latest value. `flush` writes a pending save at once (or waits for
   * the write in progress) and resolves when the file is written.
   * ```ts
   * import { copyFile } from "node:fs/promises";
   * import { join } from "node:path";
   * declare const exportPath: string;
   * // ---cut---
   * const store = plugin.storage.json("settings", { defaults: { step: 5 } });
   * await store.flush(); // the file now has the newest value
   * await copyFile(join(plugin.dataDirectory, "settings.json"), exportPath);
   * ```
   *
   * @since 1.0.0
   */
  flush(): Promise<void>;
}

/**
 * `plugin.storage`: JSON settings files. No capability.
 *
 * @remarks
 * Two kinds of storage, both private to the plugin and needing no
 * capability. {@link Storage.json} keeps settings in JSON files in the
 * plugin's data directory: they last across player restarts and upgrades,
 * and are written by the plugin's own process. {@link Storage.session}
 * keeps values in the player's memory for one player run: they survive a
 * restart of the plugin's process but not of the player. Secrets belong in
 * {@link Secrets}, never in either.
 *
 * @capability None.
 *
 * @example Keep a setting across restarts and a queue for this run
 * The plugin's step size survives a restart of the player; its work queue
 * survives a reload of the plugin but starts empty with the next player
 * run. The JSON store reads its file at once and writes it shortly after
 * each `save`; session values live in the player process.
 * ```ts
 * const settings = plugin.storage.json("settings", { defaults: { step: 5 } });
 * const queue = (await plugin.storage.session.get<string[]>("queue")) ?? [];
 * void settings.value.step; // read synchronously, from the file or the defaults
 * void queue;
 * ```
 *
 * @see [Store a plugin's data](../../docs/how-to/store-data.md), [Remember a window's state between runs](../../docs/how-to/window-state.md)
 * @since 1.0.0
 * @category Services
 */
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
   * @example Keep settings and a recent list in a JSON file
   * The plugin remembers whether to resume and the last ten files across
   * restarts. `json` reads `settings.json` from the data directory at once
   * (or uses `defaults` when it is missing or fails `validate`); `save`
   * replaces the value and writes the file 300 ms later, and stopping the
   * plugin writes a pending save first.
   * ```ts
   * declare const path: string;
   * // ---cut---
   * type Settings = { resume: boolean; recent: string[] };
   * const store = plugin.storage.json<Settings>("settings", {
   *   defaults: { resume: true, recent: [] },
   *   validate: (v): v is Settings =>
   *     typeof v === "object" && v !== null && typeof (v as Settings).resume === "boolean",
   * });
   * // Only `save` writes: changing `store.value` in place is not saved.
   * store.save({ ...store.value, recent: [path, ...store.value.recent].slice(0, 10) });
   * ```
   *
   * @capability None.
   * @throws `invalid` (throws) A bad `name`, or a `debounceMs` that is not a
   *   non-negative number.
   * @since 1.0.0
   */
  json<T>(
    name: string,
    options: {
      defaults: T;
      validate?: (value: unknown) => value is T;
      debounceMs?: number;
    },
  ): JsonStore<T>;
  /**
   * Values the player keeps in its memory for this plugin until the player
   * quits: they survive a restart of the plugin's process (reload, upgrade,
   * crash, failed start) but not the player. See {@link SessionStorage}.
   *
   * @since 1.5.25
   */
  readonly session: SessionStorage;
}

/**
 * `plugin.storage.session`: JSON values that live as long as the **player**,
 * not as long as the plugin's process (like `chrome.storage.session`). No
 * capability; needs player 0.5.5 (older players reject the calls with
 * `unsupported`).
 *
 * `activate` can run more than once in one player session: the player stops
 * and starts a plugin's process again when the plugin is reloaded (also a
 * development load with `--plugin`) or upgraded, and after a crash or a
 * failed start. A later player may also restart plugins that share a
 * process, or stop an idle plugin and start it on its next use. Variables do
 * not survive that; keep state that must survive a restart here (or in
 * {@link Storage.json | storage.json} when it must also survive the player
 * quitting).
 *
 * | | Values |
 * | --- | --- |
 * | The plugin's process restarts: reload, upgrade, crash | kept |
 * | The plugin failed to start or failed, and starts again | kept |
 * | The user disables the plugin, or uninstalls it | cleared |
 * | The player quits | cleared |
 *
 * - **Per plugin.** A plugin sees only its own keys. Like
 *   {@link Plugin.dataDirectory | dataDirectory}, the values belong to the
 *   installation: a development load (`--plugin`) has its own.
 * - **JSON.** `set` stores what `JSON.stringify(value)` writes, and `get`
 *   returns that, parsed: `undefined` object properties are dropped, a `Date`
 *   comes back as a string, `NaN` as `null`. **The order of an object's
 *   properties is not kept**: they may come back in another order. A value
 *   `JSON.stringify` cannot write (`undefined`, a function, a cycle, a
 *   `BigInt`) or a string with a lone surrogate (`"\uD800"`) fails with
 *   `invalid`. The value is not checked when it comes back: after an upgrade
 *   an older version's value may be read, so check its shape when it matters.
 * - **Bounded.** Keys are 1–1024 bytes of text. A plugin holds at most 1 MiB,
 *   counting every key, its value as compact JSON and 128 bytes per key
 *   ({@link "@vestra-player/sdk/testing"!SESSION_STORAGE_LIMITS | SESSION_STORAGE_LIMITS}); a
 *   `set` beyond it fails with `limit` and changes nothing. One `set` is
 *   also one message to the player, at most 1 MiB with its key, so a single
 *   value is a little smaller than that; a larger one fails with `limit`.
 *   Split large state over several keys.
 * - **Each call is one request.** A `set` is kept once its promise
 *   resolves, so a crash right after loses nothing; there is no debounce.
 *   Calls answer in order.
 *
 * @example Keep a work queue across a plugin restart
 * A download queue survives the plugin being reloaded or crashing, and is
 * empty again when the player starts next time. Session storage lives in
 * the player process for one player run; each `set` is kept once its
 * promise resolves, so nothing is lost if the plugin dies right after.
 * ```ts
 * // A queue the plugin is working through: after a reload or a crash it
 * // goes on where it stopped, after the player quits it starts afresh.
 * const pending = (await plugin.storage.session.get<string[]>("queue")) ?? [];
 * pending.push("https://example.com/a.mkv");
 * await plugin.storage.session.set("queue", pending);
 * ```
 *
 * @since 1.5.25
 *
 * @remarks
 * The player keeps the values in its own memory, per plugin, until it
 * quits; the plugin's process may restart in between. Each call is one
 * request to the player, answered in order, with no debounce.
 *
 * @capability None.
 * @category Services
 */
export interface SessionStorage {
  /**
   * The value stored under `key`, or `undefined` when there is none.
   *
   * @capability None.
   * @throws `invalid` (rejects) A bad key (empty, over 1024 bytes, with NUL
   *   or a lone surrogate).
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   *
   * @example Pick up where the plugin stopped after a reload
   * After a reload the plugin resumes the item it was working on. `get`
   * asks the player and resolves with the value parsed from JSON, or
   * `undefined` when nothing is stored; the value is not checked, so its
   * shape is checked here.
   * ```ts
   * const current = await plugin.storage.session.get<{ url: string }>("current");
   * if (typeof current?.url === "string") await plugin.osd.show("Resuming {}", [current.url]);
   * ```
   *
   * @since 1.5.25
   */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /**
   * Store or replace `value` under `key`. `invalid` for a bad key or a value
   * that is not JSON, `limit` when the plugin's values would be over 1 MiB
   * or the request over the 1 MiB message limit.
   *
   * @capability None.
   * @throws `invalid` (rejects) A bad key, or a value JSON cannot hold (or a
   *   string with a lone surrogate).
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   * @throws `limit` (rejects) The plugin's values would pass 1 MiB, or the
   *   request the 1 MiB message limit; nothing changes.
   *
   * @example Remember the item being worked on
   * The plugin records the URL it is processing, so a reload can continue
   * with it. The value is stored as `JSON.stringify` writes it, and is kept
   * once the promise resolves.
   * ```ts
   * await plugin.storage.session.set("current", { url: "https://example.com/a.mkv" });
   * ```
   *
   * @since 1.5.25
   */
  set(key: string, value: unknown): Promise<void>;
  /**
   * Remove a key; removing a missing one is fine.
   *
   * @capability None.
   * @throws `invalid` (rejects) A bad key.
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   *
   * @example Forget the item once it is done
   * When the work finishes, the plugin removes the entry so that a later
   * reload does not resume it. Removing a key that is not there is fine.
   * ```ts
   * await plugin.storage.session.delete("current");
   * ```
   *
   * @since 1.5.25
   */
  delete(key: string): Promise<void>;
  /**
   * The keys stored, in code point order.
   *
   * @capability None.
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   *
   * @example Clear everything the plugin stored for this run
   * The plugin starts its session state over. `keys` lists the plugin's own
   * keys in code point order; each `delete` is a request of its own.
   * ```ts
   * const session = plugin.storage.session;
   * for (const key of await session.keys()) await session.delete(key);
   * ```
   *
   * @since 1.5.25
   */
  keys(): Promise<string[]>;
}

/**
 * `plugin.system`: files and links, executed by the player. No capability.
 * Other systems than macOS and Windows: `unsupported`.
 *
 * @example Show an exported file and open the help page
 * The file manager opens with the exported file selected, then the
 * browser opens the plugin's help page. The player performs both on the
 * plugin's behalf; they reject with `unsupported` on systems other than
 * macOS and Windows, which the plugin turns into a message.
 * ```ts
 * declare const exportedFile: string;
 * // ---cut---
 * try {
 *   await plugin.system.reveal(exportedFile);
 *   await plugin.system.openUrl("https://example.com/help");
 * } catch (error) {
 *   if ((error as PluginError).code !== "unsupported") throw error;
 *   await plugin.osd.show(`Saved to ${exportedFile}`); // no file manager to open
 * }
 * ```
 *
 * @remarks
 * The player opens files, folders and links with the system's own
 * applications for the plugin, so the plugin never runs `open`,
 * `explorer` or a shell itself.
 *
 * @capability None.
 * @since 1.0.0
 * @category Services
 */
export interface System {
  /**
   * Select files or folders in the file manager (macOS: one Finder window
   * for all, so several files of one folder are all highlighted; Windows:
   * one Explorer window per folder, selecting its first path). Paths that do
   * not exist are skipped; `missing` when none exists; at most 256.
   *
   * @capability None.
   * @throws `missing` (rejects) None of the paths exists.
   * @throws `invalid` (rejects) No paths, or more than 256.
   * @throws `failed` (rejects) The system refused.
   * @throws `timeout` (rejects) macOS did not answer within 10 s.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   *
   * @example Show the exported files in the file manager
   * After an export, the file manager opens with the new files selected.
   * Paths that no longer exist are skipped; the call rejects with `missing`
   * only when none of them exists.
   * ```ts
   * declare const exported: string[];
   * // ---cut---
   * await plugin.system.reveal(exported); // macOS: one Finder window for all
   * ```
   *
   * @since 1.0.0
   */
  reveal(paths: string | string[]): Promise<void>;
  /**
   * Open the file or folder with its default application. `missing` if absent.
   *
   * @capability None.
   * @throws `missing` (rejects) The path does not exist.
   * @throws `invalid` (rejects) An empty path.
   * @throws `failed` (rejects) The system refused.
   * @throws `timeout` (rejects) macOS did not answer within 10 s.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   *
   * @example Open the plugin's data folder
   * A "Show data folder" command opens the plugin's data directory in the
   * file manager, which is the default application for a folder.
   * ```ts
   * await plugin.system.openPath(plugin.dataDirectory);
   * ```
   *
   * @since 1.0.0
   */
  openPath(path: string): Promise<void>;
  /**
   * Open an http(s) address in the default browser. `invalid` for another
   * protocol or a malformed address; `timeout` after 10 s, `failed` otherwise.
   *
   * @capability None.
   * @throws `invalid` (rejects) Not an `http:` or `https:` address.
   * @throws `timeout` (rejects) macOS did not hand it to the browser within
   *   10 s.
   * @throws `failed` (rejects) The system refused.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   *
   * @example Open the plugin's help page
   * A Help command opens the plugin's documentation in the default browser.
   * Only `http:` and `https:` addresses are opened.
   * ```ts
   * await plugin.system.openUrl("https://example.com/plugin/help");
   * ```
   *
   * @since 1.0.0
   */
  openUrl(url: string): Promise<void>;
}

/**
 * Per-plugin secrets (API keys, passwords) in the system's secret store:
 * the login keychain on macOS, the Credential Manager on Windows. Needs
 * `secrets`. `unsupported` on systems without a store, `unavailable` when
 * the store cannot be reached (no keychain, a read-only store, no logged-in
 * session on Windows): keep a fallback (or ask again).
 *
 * The user denying access and other system errors reject `failed`. Never
 * write secrets to settings files.
 *
 * @example Ask for an API token once and keep it in the keychain
 * The user types the token the first time; later runs read it from the
 * system's secret store. `get` resolves `null` when nothing is stored; a
 * store that is missing or refuses access rejects (`unsupported`,
 * `unavailable`, `failed`), and then the plugin keeps the token for this
 * run only and asks again next time.
 * ```ts
 * declare function askUser(): Promise<string | null>;
 * // ---cut---
 * let token: string | null = null;
 * try {
 *   token = await plugin.secrets.get("api-token");
 * } catch {
 *   // No usable store: fall through and ask.
 * }
 * if (token === null) {
 *   token = await askUser();
 *   if (token)
 *     await plugin.secrets.set("api-token", token).catch(() => {}); // best effort
 * }
 * ```
 *
 * @remarks
 * Values are stored by the player in the system's secret store under this
 * plugin's id: other plugins cannot read them. Names are 1–64 of
 * `a-z 0-9 . _ -`, values 1–1024 bytes of text, at most 256 names per
 * plugin (`SECRET_LIMITS`).
 *
 * @capability secrets
 * @since 1.0.0
 * @category Services
 */
export interface Secrets {
  /**
   * The stored value, `null` when there is none.
   *
   * @capability secrets
   * @throws `unsupported` (rejects) The system has no secret store.
   * @throws `unavailable` (rejects) The store cannot be reached (no keychain,
   *   a read-only store, no logged-in session on Windows).
   * @throws `failed` (rejects) The user denied access, or another system
   *   error.
   * @throws `capability` (rejects) The manifest does not declare
   *   `secrets`.
   * @throws `invalid` (rejects) A bad name.
   *
   * @example Read a stored token
   * The plugin uses the token the user saved earlier, or asks for one when
   * there is none. `get` resolves with the stored text or `null`.
   * ```ts
   * const token = await plugin.secrets.get("api-token");
   * if (token === null) await plugin.osd.show("Sign in first");
   * ```
   *
   * @since 1.0.0
   */
  get(name: string): Promise<string | null>;
  /**
   * Store or replace (`name`: 1–64 of `a-z 0-9 . _ -`; value 1–1024 bytes).
   * At most 256 different names per plugin: a new name beyond that rejects
   * `limit`. Uninstalling with `removeData` deletes them.
   *
   * @capability secrets
   * @throws `invalid` (rejects) A bad name, or a value that is empty, has NUL
   *   or is over 1024 bytes.
   * @throws `limit` (rejects) A new name beyond 256.
   * @throws `unsupported` (rejects) The system has no secret store.
   * @throws `unavailable` (rejects) The store cannot be reached (no keychain,
   *   a read-only store, no logged-in session on Windows).
   * @throws `failed` (rejects) The user denied access, or another system
   *   error.
   * @throws `capability` (rejects) The manifest does not declare
   *   `secrets`.
   *
   * @example Save the token the user entered
   * The token the user typed is kept in the system's secret store for later
   * runs. `set` stores or replaces it; the store can refuse, in which case
   * the plugin keeps the token for this run only.
   * ```ts
   * declare const token: string;
   * // ---cut---
   * await plugin.secrets.set("api-token", token).catch((error: PluginError) => {
   *   // No store, or access denied: the token is not kept for next time.
   *   void plugin.osd.show("The token could not be saved ({})", [error.code]);
   * });
   * ```
   *
   * @since 1.0.0
   */
  set(name: string, value: string): Promise<void>;
  /**
   * Remove; removing a missing secret is fine.
   *
   * @capability secrets
   * @throws `invalid` (rejects) A bad name.
   * @throws `unsupported` (rejects) The system has no secret store.
   * @throws `unavailable` (rejects) The store cannot be reached (no keychain,
   *   a read-only store, no logged-in session on Windows).
   * @throws `failed` (rejects) The user denied access, or another system
   *   error.
   * @throws `capability` (rejects) The manifest does not declare
   *   `secrets`.
   *
   * @example Sign out by removing the token
   * Signing out removes the stored token, so the next start asks again.
   * Removing a name that is not stored is fine.
   * ```ts
   * await plugin.secrets.delete("api-token");
   * ```
   *
   * @since 1.0.0
   */
  delete(name: string): Promise<void>;
}

/**
 * Which renderer draws the video: `"gpu"` (the GPU renderer, where
 * {@link RenderOptions | render options} apply) or `"software"` (they fail
 * with `unsupported`). The same values as {@link SystemInfo.rendering}.
 *
 * @example Tell the user which renderer draws the video
 * The plugin shows "Rendering: GPU" or "Rendering: software" on the
 * video. `state()` asks the player; `mode` is the renderer drawing now,
 * which can differ from the saved choice until the next start.
 * ```ts
 * const { mode } = await plugin.rendering.state();
 * const label: Record<RenderingMode, string> = { gpu: "GPU", software: "software" };
 * await plugin.osd.show("Rendering: {}", [label[mode]]);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export type RenderingMode = "gpu" | "software";

/**
 * The user's saved rendering choice: `"auto"` (the player decides: the GPU
 * where this system has a GPU renderer that is not ruled out, software
 * elsewhere), `"gpu"` or `"software"`. It applies from the next start.
 *
 * @example Describe the saved choice on a settings page
 * The plugin turns the saved choice into the words its settings page
 * shows. `preference` is what the user chose, not what draws now:
 * {@link RenderingState.nextMode} says what the next start will use.
 * ```ts
 * const { preference } = await plugin.rendering.state();
 * // One word per choice; the Record type makes sure none is missing.
 * const words: Record<RenderingPreference, string> = {
 *   auto: "Automatic",
 *   gpu: "GPU",
 *   software: "Software",
 * };
 * console.log(words[preference]);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export type RenderingPreference = "auto" | "gpu" | "software";

/**
 * Why the player renders the way it does, as a stable kebab-case code. A
 * newer player may add codes: compare with the ones you handle and show
 * {@link RenderingReason.message} for the rest. The codes of player 0.5.13:
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `default` | Nothing ruled the GPU out; the platform's default. |
 * | `pending` | GPU rendering is starting. |
 * | `headless` | The player runs without a user interface. |
 * | `no-gpu-backend` | This player has no GPU renderer on this system (Windows today). |
 * | `env` | The environment chose it (`VESTRA_RENDER`, `VESTRA_SOFTWARE_RENDER`). |
 * | `preference` | The user chose software rendering ({@link Rendering.setPreference}); GPU chosen and available reports `default`. |
 * | `denylist` | The graphics driver is on the player's denylist. |
 * | `previous-crash` | GPU rendering crashed at an earlier start; it is tried again after a driver or player update, or after 7 days. |
 * | `init-failed` | GPU rendering could not start. |
 * | `window-fallback` | A window could not show GPU frames; the player switched to software during the run. |
 *
 * @example Explain a driver problem differently from a user choice
 * The plugin adds advice only when the graphics driver is the cause.
 * `reason.code` is looked up among the codes the plugin knows; an unknown
 * code from a newer player falls through to the player's own message.
 * ```ts
 * const { reason } = await plugin.rendering.state();
 * // Advice for the codes this plugin knows; any other code shows the message.
 * const advice: Partial<Record<RenderingReasonCode, string>> = {
 *   denylist: "Update the graphics driver to use the GPU.",
 *   "previous-crash": "The GPU renderer crashed earlier; it is retried after an update.",
 * };
 * console.log(advice[reason.code] ?? reason.message);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export type RenderingReasonCode =
  | "default"
  | "pending"
  | "headless"
  | "no-gpu-backend"
  | "env"
  | "preference"
  | "denylist"
  | "previous-crash"
  | "init-failed"
  | "window-fallback"
  // Any other string: a newer player's code (the names above stay suggested).
  | (string & {});

/**
 * Why the player renders, or will render, the way it does: a stable
 * {@link RenderingReasonCode} to branch on and a sentence to show.
 *
 * @example Show why GPU rendering is off
 * The plugin logs the player's explanation when the video is drawn in
 * software. `message` is the player's English text and may name the
 * graphics adapter and driver version; `code` is for decisions.
 * ```ts
 * const { mode, reason } = await plugin.rendering.state();
 * if (mode === "software") console.log(`${reason.code}: ${reason.message}`);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export interface RenderingReason {
  /** The reason as a stable kebab-case code; branch on this. */
  readonly code: RenderingReasonCode;
  /**
   * The reason as English text for people, for example with the graphics
   * adapter's name and driver version; never branch on it.
   */
  readonly message: string;
}

/**
 * What {@link Rendering.state} and {@link Rendering.setPreference} report:
 * the renderer drawing now and why, the saved choice, what the next start
 * will use, and whether `"gpu"` can be chosen.
 *
 * @example Label a menu item while a change waits for a restart
 * The plugin adds "(Restart to Apply)" to its GPU item after the user
 * changed the choice. `restartPending` compares the mode the next start
 * will use with the mode this run started with, so it turns false again
 * when the user changes the choice back.
 * ```ts
 * const state = await plugin.rendering.state();
 * const title = state.restartPending
 *   ? "GPU Rendering (Experimental) (Restart to Apply)"
 *   : "GPU Rendering (Experimental)";
 * console.log(title, state.nextMode, state.nextReason.message);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export interface RenderingState {
  /** The renderer drawing the video now; the same as {@link SystemInfo.rendering}. */
  readonly mode: RenderingMode;
  /** Why {@link RenderingState.mode} is what it is now. */
  readonly reason: RenderingReason;
  /** The saved choice; it applies from the next start. */
  readonly preference: RenderingPreference;
  /**
   * The renderer the next start will use, as far as the player knows now:
   * from the saved choice, the environment, the driver denylist and an
   * earlier GPU crash.
   */
  readonly nextMode: RenderingMode;
  /** Why the next start will use {@link RenderingState.nextMode}. */
  readonly nextReason: RenderingReason;
  /**
   * `true` while {@link RenderingState.nextMode} differs from the mode this
   * run started with, so a restart would change the renderer; `false` again
   * when the user changes the choice back.
   */
  readonly restartPending: boolean;
  /** Whether the user can choose `"gpu"` now. */
  readonly gpu: {
    /** `true` when `setPreference("gpu")` would be accepted. */
    readonly available: boolean;
    /**
     * Why `"gpu"` cannot be chosen (`no-gpu-backend`, `headless`,
     * `denylist`, `previous-crash`…); `null` while it is available.
     */
    readonly reason: RenderingReason | null;
  };
}

/**
 * `plugin.rendering`: the player's rendering choice, GPU or software.
 * Reading it needs no capability; changing the saved choice and restarting
 * the player need `rendering.manage`.
 *
 * @remarks
 * The choice works like a browser's hardware acceleration switch: the
 * player saves it in its own settings at once, and the running player
 * keeps its renderer. The next start uses it, whether the user restarts
 * now through {@link Rendering.restartPlayer} or quits and starts the
 * player later. The player can still rule the GPU out at a start (an
 * environment variable, a graphics driver on its denylist, a GPU crash at
 * an earlier start); {@link RenderingState.nextMode} and
 * {@link RenderingState.nextReason} say what the next start will do.
 *
 * The renderer is a choice for the whole player and a restart stops every
 * plugin, so change it only when the user asks. A plugin that only needs
 * to know whether render options work reads {@link SystemInfo.rendering}.
 *
 * Players before 0.5.13 do not know these requests: `state()` rejects with
 * `unsupported`, and they do not load a plugin that declares
 * `rendering.manage` (an unknown capability). Declare
 * `"minPlayerVersion": "0.5.13"` when the plugin needs this.
 *
 * @example Offer GPU rendering as a menu item
 * Settings ▸ GPU Rendering (Experimental) carries a check mark while the
 * next start will draw on the GPU, is greyed out with the player's reason
 * where the GPU cannot be chosen, and saves the other choice when picked.
 * `state()` reads the player's view once; `setPreference` saves the choice
 * and resolves with the new state, which the item's bound values read
 * again after the handler. The how-to guide adds the restart.
 * ```ts
 * let state = await plugin.rendering.state();
 * plugin.commands.add({
 *   id: "gpu-rendering",
 *   path: ["@settings", "GPU Rendering (Experimental)"],
 *   checked: () => state.nextMode === "gpu", // also for "auto" on a GPU system
 *   enabled: () => state.gpu.available,
 *   reason: () => state.gpu.reason?.message ?? null, // shown while disabled
 *   run: async () => {
 *     const choice = state.nextMode === "gpu" ? "software" : "gpu";
 *     state = await plugin.rendering.setPreference(choice);
 *   },
 * });
 * ```
 *
 * @capability None to read the state; `rendering.manage` to change the
 *   choice or restart the player.
 * @see [Offer a GPU rendering switch](../../docs/how-to/gpu-rendering.md)
 * @player 0.5.13; older players reject the requests as unknown
 * (`unsupported`).
 * @since 1.5.35
 * @category Services
 */
export interface Rendering {
  /**
   * Read the renderer drawing now, the saved choice, what the next start
   * will use and whether `"gpu"` can be chosen. No capability.
   *
   * @capability None.
   * @throws `unsupported` (rejects) A player before 0.5.13, which does not
   *   know the request.
   *
   * @example Find out whether the GPU can be chosen
   * The plugin reads the state once while it starts and keeps it for its
   * menu. Each call asks the player; `gpu.available` is false, with a
   * reason, where this player has no GPU renderer, without a user
   * interface, or when the driver is ruled out. An older player rejects
   * with `unsupported`, and the plugin then offers nothing.
   * ```ts
   * const state = await plugin.rendering.state().catch((error: PluginError) => {
   *   if (error.code === "unsupported") return null; // a player before 0.5.13
   *   throw error;
   * });
   * if (state && !state.gpu.available) console.log(state.gpu.reason?.message);
   * ```
   *
   * @since 1.5.35
   */
  state(): Promise<RenderingState>;
  /**
   * Save the user's rendering choice. The player writes it to its settings
   * at once; the running player keeps its renderer, and the next start
   * uses the choice whether or not the user restarts now. `"auto"` and
   * `"software"` are always accepted.
   *
   * @param preference - `"auto"`, `"gpu"` or `"software"`.
   * @returns The new state; {@link RenderingState.restartPending} tells
   *   whether a restart would change the renderer.
   *
   * @capability rendering.manage
   * @throws `invalid` (rejects) `preference` is not `"auto"`, `"gpu"` or
   *   `"software"`.
   * @throws `unsupported` (rejects) `"gpu"` where this player has no GPU
   *   renderer on this system, or runs without a user interface; also any
   *   value on a player before 0.5.13.
   * @throws `unavailable` (rejects) `"gpu"` while it is ruled out: the
   *   graphics driver is on the player's denylist, or GPU rendering crashed
   *   at an earlier start. The message says which, with the adapter's name
   *   and the driver version.
   * @throws `failed` (rejects) The player could not write its settings file.
   * @throws `capability` (rejects) The manifest does not declare
   *   `rendering.manage`.
   *
   * @example Switch back to the automatic choice
   * A Reset item returns the renderer to the player's own choice and tells
   * the user when it takes effect. `setPreference` saves the choice and
   * resolves with the new state; `restartPending` is true when the next
   * start will draw differently from this run. A refused save leaves the
   * old choice in place.
   * ```ts
   * try {
   *   const state = await plugin.rendering.setPreference("auto");
   *   if (state.restartPending) await plugin.osd.show("Applies after a restart");
   * } catch (error) {
   *   // `failed`: the player's settings file could not be written.
   *   await plugin.osd.show("Not saved ({})", [(error as PluginError).code]);
   * }
   * ```
   *
   * @since 1.5.35
   */
  setPreference(preference: RenderingPreference): Promise<RenderingState>;
  /**
   * Restart the player so that a changed choice applies now. Resolves once
   * the player has accepted; the player then quits normally, which stops
   * every plugin (this one included), and starts again with the same
   * plugins. A local file that was open continues at its position, paused
   * or playing as it was; a stream or another source that is not a file is
   * not reopened.
   *
   * @capability rendering.manage
   * @throws `unsupported` (rejects) The player runs without a user
   *   interface; also a player before 0.5.13.
   * @throws `busy` (rejects) A restart is already under way, or this player
   *   was itself started by a restart less than 30 seconds ago (so a plugin
   *   that restarts on activation cannot make a loop).
   * @throws `failed` (rejects) The new player process could not be started;
   *   the player keeps running.
   * @throws `capability` (rejects) The manifest does not declare
   *   `rendering.manage`.
   *
   * @example Restart after asking the user
   * After the user changed the renderer, the plugin offers to restart now.
   * `confirm` asks first, because a restart closes every window (it needs
   * `ui.dialog`); once `restartPlayer` resolves, the player is quitting and
   * will stop this plugin, so nothing else is started after it.
   * ```ts
   * const { confirmed } = await plugin.dialogs.confirm({
   *   message: "Restart the player now?",
   *   detail: "The new renderer is used from the restart on. The video continues where it is.",
   *   confirm: "Restart",
   * });
   * if (confirmed)
   *   await plugin.rendering.restartPlayer().catch((error: PluginError) => {
   *     // `failed`: the new player could not start; this one keeps running.
   *     void plugin.osd.show("Could not restart ({})", [error.code]);
   *   });
   * ```
   *
   * @since 1.5.35
   */
  restartPlayer(): Promise<void>;
}
