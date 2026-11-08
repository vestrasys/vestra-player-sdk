// Plugin category: the plugin object and its scopes, lifecycle, errors, the app and main window.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { Bindings, Commands, Host, When } from "./commands.ts";
import type { Packages } from "./packages.ts";
import type { Player, Timeline } from "./playback.ts";
import type {
  AudioFilter,
  RenderOptions,
  VideoFilter,
  VideoShaders,
  VideoUpscaling,
  VideoView,
} from "./processing.ts";
import type {
  Clipboard,
  Power,
  Rendering,
  RenderingReason,
  Secrets,
  Storage,
  System,
  Tools,
} from "./services.ts";
import type { MediaCapture } from "./snapshots.ts";
import type { Resolvers } from "./sources.ts";
import type { Subtitles } from "./subtitles.ts";
import type { Ui } from "./ui-content.ts";
import type { Drops, Windows } from "./ui-layout.ts";
import type { Appearance, I18n } from "./ui-locale.ts";
import type { Dialogs, Osd, Panels, Settings } from "./ui-shell.ts";
import type { Wire } from "./plugin-wire.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Command, CommandOptions } from "./commands.ts";
import type { PackageCandidate, PluginInfo } from "./packages.ts";
import type { Conditional, Media, Stream } from "./playback.ts";
import type {
  JsonStore,
  RenderingReasonCode,
  RenderingState,
} from "./services.ts";
import type { ExportJob, Snapshot } from "./snapshots.ts";
import type { Resolver } from "./sources.ts";
import type { PropValue, View } from "./ui-content.ts";
import type { Panel, Window } from "./ui-layout.ts";
/* oxlint-enable no-unused-vars */

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
 * | `unsupported` | Not possible on this system, build or source (a platform gap, software rendering, a source that cannot seek, a filter on a generated stream, an export the player cannot make as asked: a stream copy, a source bitrate it cannot tell). |
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
 * | `export-failed` | An export job ({@link ExportJob}) failed: the code of its `outcome.error`, not a rejection; `message` has the worker's or FFmpeg's reason. |
 * | `input-overflow` | `openStream` input: the player's queue of physical key transitions was full; the input was revoked and its keys released. |
 * | `internal` | An internal step of the player failed (keeping an operation's result, a subtitle or media job); `message` has the reason. |
 * | `javascript`, `slint` | {@link Packages.validate}: the package's entry module does not pass `node --check` / one of its Slint files does not compile; `message` has the diagnostics. |
 * | `owner` | A resolver answered a request that belongs to another plugin's resolver. |
 * | `pending` | An operation with the same token is still running in the player. The SDK waits and asks again, so it rarely reaches a plugin. |
 * | `producer` | `openStream`: the player refused or lost the generated stream; `message` has the reason. |
 * | `resolution` | A file or web resolver's result could not be opened; `message` has the reason. |
 * | `revisionConflict` | {@link Packages}: the installed revision changed since it was read (another install or uninstall ran). Read again and retry; the SDK passes the revision it read, so this reaches plugins that act on old data. |
 * | `source-geometry`, `source-geometry-unsupported` | The source's picture size or rotation could not be applied: invalid decoder dimensions / a rotation that is not a multiple of 90°. |
 * | `previous-crash` | {@link VideoShaders}, {@link RenderOptions} `shaders` (player 0.6.3): plugin shaders are off because the player ended abnormally while they were drawing; clearing still works. Do not retry while refused (the player shows its own OSD line). |
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
   * GPU render options, this plugin's shaders and the GPU's video
   * upscaler. The first four need `processing.video` and `playback.read`;
   * the filter chain also needs `events` (without it the SDK never sees
   * the media become ready and the chain stays `waiting`). The upscaler
   * needs `video.upscaling` only.
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
     * This plugin's own GPU shaders named `id` (default `"shaders"`;
     * needs `processing.video`; SDK 1.5.39, player 0.5.20). Unlike
     * {@link Scope.video | render()}, every plugin may hold shader
     * handles at the same time; the player joins their lists. Nothing is
     * sent until the first `set()`.
     *
     * @param id - Local name of the handle, 1–128 bytes, unique within
     *   the plugin.
     * @returns A {@link VideoShaders} owned by this scope.
     * @throws `capability` (throws) The manifest does not declare
     *   `processing.video`.
     * @throws `invalid` (throws) `id` is empty, longer than 128 bytes or
     *   has control characters.
     * @throws `Error` without a code (throws) A second handle with the
     *   same `id` while the first is not disposed.
     */
    shaders(id?: string): VideoShaders;
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
   * Direct messages to the player: requests by method name, raw events,
   * direct property writes, bare command registrations (SDK 1.7.0).
   * Experimental: the wire protocol is not semver; this member changes
   * with versions. See {@link Wire}.
   *
   * @experimental
   */
  readonly wire: Wire;
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
   *     const statsWindow = live.windows.create("ui/stats.slint");
   *     const timer = setInterval(() => live?.update(), 1000);
   *     live.onDispose(() => clearInterval(timer));
   *     await statsWindow.show();
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
   * @example Save a cache at once when the player is lost
   * The plugin writes its cache file at once when the player crashed or
   * was killed, instead of waiting for the next periodic save. The cleanup
   * may get a {@link DisposeInfo}: `stopping` says the plugin itself stops
   * (not a child scope), `reason` why (player 0.6.4). Players
   * whose SDK is older than 1.5.54 call the cleanup without an argument,
   * so read it with `?.`.
   * ```ts
   * declare function saveCacheNow(): void;
   * // ---cut---
   * plugin.onDispose((info) => {
   *   // The player is gone: ask it nothing, keep what is local.
   *   if (info?.reason === "host-lost") saveCacheNow();
   * });
   * ```
   *
   * @remarks
   * From SDK 1.5.54 in the player (and in `TestHost`) the cleanup is called
   * with one argument, a {@link DisposeInfo}: whether the plugin stops, and
   * why. A player whose own SDK is older calls it without one (`info` is
   * `undefined`). A cleanup that takes no argument works as before; a
   * function with optional parameters of its own that is passed directly
   * (`onDispose(controller.abort.bind(controller))`) now receives the
   * `DisposeInfo` as its first argument: wrap it (`() => controller.abort()`)
   * when that matters.
   *
   * @capability None.
   * @since 1.0.0
   */
  onDispose(
    cleanup:
      | ((info?: DisposeInfo) => void | Promise<void>)
      | (() => void | Promise<void>),
  ): Disposable;
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
   * declare const downloadWindow: Window;
   * declare function downloadPart(part: number): Promise<void>;
   * // ---cut---
   * let done = 0;
   * downloadWindow.bind(() => ({ progress: done }));
   * downloadWindow.on("start", async () => {
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
  /**
   * Plugin-owned state that bound values follow by themselves: reading a
   * field in a `bind` function or a command's state function records it,
   * and writing that field re-evaluates exactly those readers.
   *
   * @remarks
   * Returns an object of the same shape as `initial` (a copy of its own
   * fields; `initial` itself is not tracked). A read inside a
   * {@link View.bind} function or a {@link CommandOptions} field given as a
   * function is recorded like a read of `plugin.player.state`; anywhere
   * else (a handler, an `onChange` listener, a timer) it is a plain read,
   * and writing there is how a handler updates what is bound. A write of a
   * field (or a new field, or `delete`) schedules one
   * update pass for the microtask turn, however many fields change, and that
   * pass evaluates only the readers of what changed, not every binding and
   * command as {@link Scope.update} does. Writing a value equal to the
   * current one (`Object.is`) changes nothing.
   *
   * Tracking is one level deep: a field holding an object or array is
   * compared by identity, so changing something inside it is not seen.
   * Replace the object instead (`st.list = [...st.list, item]`). Do not
   * write a field from a `bind` function that reads it: each write runs the
   * function again; the SDK stops such a loop after 100 passes in a row and
   * reports it to {@link Scope.onError} once (`limit`).
   *
   * The object is a `Proxy`: spread, `Object.keys` and `JSON.stringify` give
   * its values; `structuredClone` does not take it (clone `{ ...st }`). It
   * belongs to this scope: once the scope is disposed it is a plain object,
   * whose reads and writes still work but are no longer recorded and
   * schedule no pass (as other handles of a disposed scope go quiet).
   * `update()` stays for state the SDK cannot see.
   *
   * @param initial - The fields and their first values: a plain object.
   * @returns The tracked object.
   *
   * @throws `invalid` (throws) `initial` is not a plain object (`null`, an
   *   array, a class instance).
   *
   * @capability None.
   *
   * @example Show a check's answer without a manual update
   * A panel shows whether the current file has video once an asynchronous
   * check answers. The answer is written to a tracked field; only the
   * `bind` function that reads it runs again and sends the new value, with
   * no `plugin.update()` and no pass over every other binding.
   * ```ts
   * declare const bar: Panel;
   * declare function hasVideo(path: string): Promise<boolean>;
   * // ---cut---
   * const st = plugin.state({ video: null as boolean | null });
   * bar.bind(() => ({ keyframes: st.video === true })); // reads st.video
   * plugin.player.onChange((state) => {
   *   if (state.source === null) return;
   *   void hasVideo(state.source).then((video) => (st.video = video)); // re-runs the bind above
   * });
   * ```
   *
   * @since 1.7.0
   */
  state<T extends object>(initial: T): T;
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
 * of them fails. A command declaration the player refuses is the exception
 * (SDK 1.5.49): the SDK logs and skips it, its `ready` rejects and
 * {@link Scope.onError} hears it, the rest of the plugin activates
 * (`startPlugin` still fails on it). The entry module must
 * **default-export** `activate`.
 *
 * Stopping: the player first revokes everything the plugin owns on its side
 * (menus, windows, panels, filters, subtitle layers, snapshots, jobs,
 * resolvers, streams); pending requests then fail with `disabled` and the
 * root scope is disposed for local cleanup (timers, signals, sockets). A
 * process that has not exited after its grace is killed: 5 s from player
 * 0.7.1 (before it 300 ms; 300 ms after a fault); at quit all plugins
 * together get 1 s. Media the
 * plugin opened with {@link Player.open} keeps playing.
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
 * @see [How a plugin runs](../../../docs/explanation/plugins.md)
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
   * none. See [How a plugin runs](../../../docs/explanation/plugins.md#the-data-directory).
   */
  readonly dataDirectory: string;
  /**
   * Why the player stops this plugin (SDK 1.5.54, player 0.6.4): set when
   * the stop begins, before any
   * {@link Scope.onDispose} cleanup runs. `undefined` while the plugin
   * runs, and for every stop by an older player (one whose own SDK is older
   * than 1.5.54 does not have the property at all). See {@link StopReason}.
   */
  readonly stopReason: StopReason | undefined;
}

/**
 * Why the player stopped the plugin ({@link DisposeInfo.reason},
 * {@link Plugin.stopReason}).
 *
 * - `quit`: the player quits (or restarts after a lost GPU device). Every
 *   plugin is stopped at the same time, with 1 s in all (300 ms after a
 *   lost device; player 0.7.1).
 * - `disable`: the user, or a plugin with `plugins.manage`, switched the
 *   plugin off. Its session storage is cleared.
 * - `uninstall`: the user uninstalls it.
 * - `reload`: it is reloaded (from the plugin manager, or a development
 *   load with `--plugin`).
 * - `upgrade`: an install or update replaces the running version; also a
 *   new version stopped because its install was cancelled (the previous
 *   version comes back).
 * - `idle`: the plugin goes to standby and its next use starts it again;
 *   its menu items, keys, settings pages, resolvers and drop targets stay,
 *   and so does its session storage
 *   ([Idle plugins](../../../docs/explanation/plugins.md#idle-plugins-are-stopped)).
 *   Only with on-demand start (lazy activation): on for everyone from
 *   player 0.7.1, off by default before it (`VESTRA_LAZY=1` turns it on).
 *   It comes after the idle time without use (30 s; 60 s before 0.7.1),
 *   right after a first run that holds nothing live, and, from player
 *   0.7.1, when the player's limit on third-party processes or low system
 *   memory puts an idle plugin in standby early. A busy plugin never gets
 *   it; a resident one (it held something live when it became ready) never
 *   from player 0.7.1 (before it, after the idle time).
 * - `failed`: the player stops it for a fault it can still tell the plugin
 *   about: a malformed request, an unreadable or oversized line, a start
 *   that is not ready within the start timeout (60 s from player 0.7.1;
 *   the stop may come while `activate` still runs), an uncaught exception
 *   the shared process attributes to this plugin, and, from player 0.7.1,
 *   a request from the player (a resolution) it leaves unanswered for 5
 *   minutes. From player 0.7.1 the player may start it again afterwards (a
 *   built-in or resident plugin by itself, a plugin that has run before on
 *   its next use), until the fifth fault within 10 minutes.
 * - `host-lost`: the plugin's runner saw its pipe to the player close
 *   without a stop: the player crashed or was killed. Requests are refused
 *   with `disabled`; clean up locally only. Player 0.6.4 sends `quit` on a
 *   normal exit; read `host-lost` as "the player is gone", not as proof of
 *   a crash.
 *
 * Some ends are no stop at all: the plugin gets no reason and its
 * {@link Scope.onDispose} cleanups do not run. That is the case when its
 * own process is killed because its input queue is full or a write to it
 * failed, when its own process fails to activate (the runner exits without
 * cleaning up), when the process ended by itself (it crashed, or its
 * JavaScript heap passed the 512 MB cap of player 0.7.1 and V8 ended it:
 * "ran out of memory"), and when the shared runner is restarted as a whole
 * (a hang, a fault it cannot attribute, an unreadable line of its own, a
 * member's full input queue, the runner exiting): every member is killed
 * with it. Keep state that must survive such an end in storage as it
 * changes, not only in a cleanup. Timings and restarts are in
 * [How the player runs and talks to plugins](../../../docs/explanation/host-and-node.md#crashes-and-restarts).
 *
 * Player 0.6.4 and later send the reason with `runtime.stop`, and their
 * runner reports `host-lost`. Players up to 0.6.3 give no reason for any
 * stop, a lost player included (`undefined`); so does a stop that does not
 * come from the player (a `TestHost` `stop()` without a reason). A value
 * this SDK does not know reads as `undefined`.
 *
 * @player 0.6.4; older players give no reason (`undefined`).
 * @since 1.5.54
 * @category Plugin
 */
export type StopReason =
  | "quit"
  | "disable"
  | "uninstall"
  | "reload"
  | "upgrade"
  | "idle"
  | "failed"
  | "host-lost";

/**
 * What a {@link Scope.onDispose} cleanup is told (SDK 1.5.54). A player
 * whose own SDK is older passes nothing, so the cleanup's parameter is
 * optional.
 *
 * @since 1.5.54
 * @category Plugin
 */
export interface DisposeInfo {
  /**
   * `true` when the plugin itself stops (the player stops it), `false`
   * when the plugin's own code disposed this scope or one of its parents.
   */
  readonly stopping: boolean;
  /**
   * Why the player stops the plugin (player 0.6.4; the causes are listed at
   * {@link StopReason}); `undefined` while `stopping` is false, and for
   * every stop by an older player.
   */
  readonly reason?: StopReason;
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
  /**
   * The main window is maximized (`false` in fullscreen, also when it was
   * maximized before and will be again after). Changes reach
   * {@link MainWindow.onChange}. A plugin that sizes the window, such as to
   * the video when playback starts, leaves a maximized window alone, as
   * MPC-HC and mpv do. Always `false` with players before 0.6.3, which do
   * not report it.
   *
   * @player 0.6.3; older players: always `false`.
   * @since 1.5.52
   */
  readonly maximized: boolean;
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
 * `plugin.window` is the player's main window: its size, whether it is
 * maximized or fullscreen, picture-in-picture and the video area. Reading it needs no capability;
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
  /**
   * The player's version, e.g. `"0.7.1"`. From player 0.7.1 this is the
   * player's release version (the version of the published release), which
   * can differ from the version of the host binary inside it. The player
   * compares `minPlayerVersion` with this value, and plugins compare with
   * it too.
   */
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
   * Today the player renders on the GPU on macOS, on Windows when the
   * user turned on Video ▸ GPU Rendering (Experimental) (since version 0.5.14;
   * off by default), and in software otherwise: on Windows by default, on
   * Linux and without a user interface (see
   * [Platforms](../../../docs/reference/platforms.md)); test this field
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
