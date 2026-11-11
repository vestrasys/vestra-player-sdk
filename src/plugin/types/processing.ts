// Processing category: video and audio filters, view, render options, shaders, upscaling.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { AudioNode, VideoNode } from "../../processing.ts";
import type { Disposable, PluginError } from "./base.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Plugin, Scope, SystemInfo } from "./base.ts";
import type { Player } from "./playback.ts";
import type { Rendering, RenderingReason } from "./services.ts";
/* oxlint-enable no-unused-vars */

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
 * @see [Process video with a shader or a filter](../../../docs/guides/filters.md)
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
 * @see [Process video with a shader or a filter](../../../docs/guides/filters.md)
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
 * @see [Process video with a shader or a filter](../../../docs/guides/filters.md)
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
  /**
   * mpv user shaders (`.glsl`): absolute paths of existing files, at most
   * 16, in order. They run before the shaders of every plugin's
   * {@link VideoShaders} handles.
   */
  shaders: string[];
  /** Motion interpolation, resampled to the display's refresh rate. */
  interpolation: boolean;
}

/**
 * The GPU renderer's options, from `plugin.video.render()`
 * (`processing.video`). Single owner, like {@link VideoView}; the two are
 * independent handles.
 *
 * Platforms: macOS renders on the GPU by default; Windows does since
 * version 0.5.14 of the player when the user turns on the Picture panel's
 * GPU Rendering (off by default, {@link Rendering}). Under software
 * rendering (Windows by default, Linux, headless, fallback) every `set`
 * fails with `unsupported`; {@link SystemInfo.rendering} tells which
 * renderer draws without creating the handle. macOS OpenGL 4.1 has no
 * compute shaders, so `peakDetect` is accepted but has no effect; output
 * is always SDR.
 *
 * @example Tone-map HDR video and hide the menu where it cannot work
 * On a GPU-rendering player HDR video is tone-mapped with BT.2390 for a
 * 250-nit display; under software rendering the plugin hides its HDR menu.
 * `set` merges the values into the plugin's render options and the
 * player reports the result through `onStatus`: `failed` with
 * `unsupported` means the player renders in software (Linux, or Windows
 * while GPU rendering is off).
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
 * GPU renderer options (tone mapping, peak detection, shaders, interpolation).
 * Only the GPU renderer has them (macOS; Windows with GPU rendering turned on);
 * under software rendering the handle is `failed` with `unsupported` after the
 * player's first answer to `render()` (reported to `onError` too), and so is
 * every `set`. Single owner, like {@link VideoView}. `set` never throws; the
 * result shows in `status`. For shaders that several plugins add at the same
 * time, use {@link VideoShaders}. After a run of the player that ended
 * abnormally while plugin shaders were drawing, a `set` whose merged values
 * hold a non-empty `shaders` list is refused with `previous-crash` (the rules
 * are on {@link VideoShaders}). Every `set` sends all the values set so far,
 * the refused `shaders` included, so include `shaders: []` in the next `set` to
 * go on without them.
 *
 * @capability processing.video, playback.read and events (like
 * {@link VideoFilter})
 * @see [Process video with a shader or a filter](../../../docs/guides/filters.md)
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
   * `failed` with `unsupported` while the player renders in software; `failed`
   * with `failed` when mpv cannot compile a shader (pushed later; while other
   * plugins' {@link VideoShaders} are on too, the player cannot tell whose
   * shader failed and says so in the message); `failed` with `previous-crash`
   * when a `set` with a non-empty `shaders` list comes after a run of the
   * player that ended abnormally while plugin shaders were drawing (the rules
   * are the same as for {@link VideoShaders}). The handle keeps the refused
   * list among its values and every `set` sends them all, so a later `set`
   * without `shaders` is refused again: include `shaders: []` in it
   * (`set({ shaders: [], toneMapping: "bt.2390" })`); `dispose` always works.
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
 * This plugin's own GPU shaders, from `plugin.video.shaders(id)`
 * (`processing.video`): mpv user shaders (`.glsl`, `//!HOOK` …) that the GPU
 * renderer runs on every frame.
 *
 * @remarks
 * Any number of plugins hold shader handles at the same time (unlike
 * {@link RenderOptions}, which has one owner). The player joins every
 * handle's list in a stable order, after the render options' own
 * `shaders`: built-in plugins first, then installed plugins in the order
 * they were first installed, then development loads (`--plugin`); ties by
 * plugin id, and a plugin's handles by `id`. At most 16 shaders across all
 * handles (`limit` beyond, nothing changes); the render options keep their
 * own 16.
 *
 * Files must be this plugin's own: absolute paths inside its package
 * directory or {@link Plugin.dataDirectory} after following links, each
 * at most 16 MiB. Elsewhere: `invalid`; a file that does not exist:
 * `missing`. The player reads the files when the list is set.
 *
 * GPU rendering only (macOS; Windows with the Picture panel's GPU Rendering
 * turned on): under software rendering a non-empty list is
 * `failed` with `unsupported`, and a switch to software during the run
 * pushes `unsupported` to every handle with shaders and removes every
 * list (they no longer count against the 16); set them again once the
 * player draws on the GPU (after a restart). Shaders act when a
 * frame is drawn, so processed snapshots and exports never contain them
 * (use a {@link VideoNode} for that). When mpv cannot compile a shader the
 * handle turns `failed` with `failed` (pushed later); mpv does not say
 * which file failed, so while several plugins' shaders are on, each of
 * them hears it and the message says the player cannot tell whose.
 *
 * `set` sends the whole list (last write wins); `clear` and `dispose` withdraw
 * it; the player removes a stopped plugin's shaders itself.
 *
 * **After an abnormal end**: when the previous run of the player ended while
 * plugin shaders were drawing (a crash, the process being ended, a lost GPU
 * device), the player refuses every non-empty list of every plugin with
 * `previous-crash`, its message naming the plugins whose shaders were on: one
 * such end keeps them off for the next start only; two within a day keep them
 * off until the GPU, its driver or the player changes, or for 7 days. Clearing
 * (`[]`, `clear`, `dispose`) still works. The player shows one OSD line about
 * it itself; the handle is `failed` with `previous-crash` and the SDK does not
 * retry it. Do not set the list again in a loop while it is refused, and do not
 * show an OSD line of your own for it; a later start of the player applies
 * lists again once the guard lets it.
 *
 * @example Add a sharpening shader the plugin ships
 * The video looks sharper on the GPU renderer; under software rendering
 * the OSD says why it is not. The shader file lives in the plugin's
 * package, and the player puts it after other plugins' shaders that come
 * earlier in its order.
 * ```ts
 * import { join } from "node:path";
 * declare const packageDirectory: string;
 * // ---cut---
 * const shaders = plugin.video.shaders("sharpen");
 * shaders.onStatus((s) => {
 *   // `unsupported`: software rendering; `failed`: mpv could not compile it.
 *   if (s.state === "failed") void plugin.osd.show("Sharpen: {}", [s.error.message]);
 * });
 * shaders.set([join(packageDirectory, "shaders", "sharpen.glsl")]);
 * ```
 *
 * @capability processing.video
 * @player 0.5.20
 * @see [Process video with a shader or a filter](../../../docs/guides/filters.md)
 * @since 1.5.39
 * @category Processing
 */
export interface VideoShaders extends Disposable {
  /**
   * Replace this handle's shader list (last write wins); `[]` withdraws
   * it.
   *
   * @remarks
   * Never throws: a refused list shows in `status` (`invalid`, `missing`,
   * `limit`, `unsupported`, and `previous-crash`: see
   * the interface's remarks) and goes to {@link Scope.onError}, and what the
   * player held stays.
   *
   * @capability processing.video
   * @param paths - Absolute paths of shader files in this plugin's package
   *   or data directory, in the order they run.
   *
   * @example Switch between two shader presets
   * The plugin offers a light and a strong preset; picking one replaces
   * the handle's list in one request. The files were written to the
   * plugin's data directory when the user imported them.
   * ```ts
   * import { join } from "node:path";
   * // ---cut---
   * const presets: Record<string, string[]> = {
   *   light: [join(plugin.dataDirectory, "denoise.glsl")],
   *   strong: [join(plugin.dataDirectory, "denoise.glsl"), join(plugin.dataDirectory, "sharpen.glsl")],
   * };
   * plugin.video.shaders("presets").set(presets.strong!);
   * ```
   *
   * @since 1.5.39
   */
  set(paths: readonly string[]): void;
  /**
   * Withdraw this handle's shaders (the same as `set([])`).
   *
   * @capability processing.video
   *
   * @example Turn the plugin's shaders off from a menu item
   * A Video menu item turns the plugin's shader on and off. Clearing
   * keeps the handle, so the next pick sets the list again.
   * ```ts
   * declare const file: string;
   * // ---cut---
   * const shaders = plugin.video.shaders();
   * let on = false;
   * plugin.commands.add({
   *   id: "toggle-shader",
   *   path: ["@video", "Sharpen (Shader)"],
   *   checked: () => on,
   *   run: () => {
   *     on = !on;
   *     // Clearing keeps the handle; the next pick sets the list again.
   *     if (on) shaders.set([file]);
   *     else shaders.clear();
   *   },
   * });
   * ```
   *
   * @since 1.5.39
   */
  clear(): void;
  /**
   * Current status: `waiting` before ready media, `applying`, `applied`,
   * or `failed` with the reason (see the remarks).
   */
  readonly status: FilterStatus;
  /**
   * The status changed, including later pushes (a compile failure, a
   * switch to software rendering).
   *
   * @capability processing.video
   *
   * @example Report a shader that does not compile
   * The OSD shows mpv's message when the plugin's shader fails to compile.
   * The player pushes that failure after the list was accepted, so it
   * arrives through `onStatus`, not as a refused `set`.
   * ```ts
   * const shaders = plugin.video.shaders();
   * shaders.onStatus((status) => {
   *   if (status.state === "failed") void plugin.osd.show("Shader: {}", [status.error.message]);
   * });
   * ```
   *
   * @since 1.5.39
   */
  onStatus(listener: (status: FilterStatus) => void): Disposable;
}

/**
 * Why the GPU's video upscaler does not work, as a stable kebab-case code. A
 * newer player may add codes: compare with the ones you handle and show
 * {@link UpscalingReason.message} for the rest. The codes, in the order the
 * player checks them (the first that holds is reported):
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `platform` | The player has no video upscaler on this system (macOS, Linux). |
 * | `no-gpu` | No GPU that can upscale video (Windows: no NVIDIA GPU). |
 * | `driver` | The graphics driver is too old (Windows: an NVIDIA driver before 530). |
 * | `gpu-unsupported` | The driver does not offer upscaling on this GPU (Windows: not an RTX GPU), or the check failed. |
 * | `rendering` | The player renders in software, or GPU rendering is still starting; upscaling needs GPU rendering ({@link Rendering}). |
 * | `adapter` | GPU rendering runs on another GPU than the one that can upscale (a laptop with two GPUs; Windows: choose the high-performance GPU for Vestra in Settings ▸ System ▸ Display ▸ Graphics). |
 * | `decoding` | The video is not decoded on the GPU that renders it: copy-back or software decoding, for example while a {@link VideoFilter} needs the frames in memory. {@link UpscalingReason.cause} says which, and {@link UpscalingReason.plugins} whose filters (newer players; see there). |
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
 *   rendering: "Turn on Picture ▸ GPU Rendering and restart.",
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
  /**
   * With code `decoding` only: why the video is not decoded on the GPU
   * that renders it ({@link UpscalingDecodingCause}). Absent with every
   * other code, and from players before 0.5.25.
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  readonly cause?: UpscalingDecodingCause;
  /**
   * With cause `copy-back` only: the plugins whose video filters need the
   * frames in memory, which is why the player switched to copy-back
   * decoding, in the order the plugins started (each plugin once). Name
   * them to the user, who can turn the filters off there. Empty when
   * the copy-back decoding is not one the player chose for a filter (the
   * user's own `hwdec` setting). Absent with any other cause, and from
   * players before 0.5.25.
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  readonly plugins?: readonly UpscalingPlugin[];
}

/**
 * Why the video is not decoded on the GPU that renders it: the
 * {@link UpscalingReason.cause} of a `decoding` reason. A newer player may add
 * causes: show {@link UpscalingReason.message} for the ones you do not handle.
 *
 * | Cause | Meaning |
 * | --- | --- |
 * | `copy-back` | Decoded on the GPU and copied back to memory, because a plugin's video filter needs the frames there ({@link UpscalingReason.plugins} names it), or because of the user's `hwdec` setting. |
 * | `hwdec-off` | Hardware decoding is turned off (mpv's `hwdec` is `no`). |
 * | `software` | This video is decoded in software: a cover picture, a format the GPU does not decode, or a hardware decoder that failed. It passes with the next video. |
 * | `other-hwdec` | This video is decoded with another hardware decoder than the one the upscaler needs. |
 *
 * @example Name the plugins whose filters block upscaling
 * A plugin's upscaling window explains a `decoding` reason by its cause,
 * and for `copy-back` names the plugins whose filters stand in the way, so
 * the user can turn them off there (a plugin cannot run another plugin's
 * commands).
 * ```ts
 * const { reason } = await plugin.video.upscaling.state();
 * if (reason?.code === "decoding" && reason.cause === "copy-back") {
 *   const names = (reason.plugins ?? []).map((p) => p.name).join(", ");
 *   // Ask the user to reset those filters; the manifest names are not translated.
 *   console.log(names ? `Turn off the video filters of ${names}` : reason.message);
 * } else if (reason) console.log(reason.message);
 * ```
 *
 * @player 0.5.25
 * @since 1.5.43
 * @category Processing
 */
export type UpscalingDecodingCause =
  | "copy-back"
  | "hwdec-off"
  | "software"
  | "other-hwdec"
  // Any other string: a newer player's cause (the names above stay suggested).
  | (string & {});

/**
 * A plugin named in an {@link UpscalingReason}: its manifest id and its
 * name for people, as its manifest gives it (not translated).
 *
 * @player 0.5.25
 * @since 1.5.43
 * @category Processing
 */
export interface UpscalingPlugin {
  /** The plugin's manifest id, for example `vestra.video`. */
  readonly id: string;
  /** The manifest's `name` as is (its id without one), for people. */
  readonly name: string;
}

/**
 * The video's size as the upscaler gets it ({@link UpscalingState.video}):
 * the decoder's frame size, width and height swapped for the file's
 * quarter-turn rotation metadata.
 *
 * @player 0.5.25
 * @since 1.5.43
 * @category Processing
 */
export interface UpscalingVideoSize {
  /** The frames' stored width in pixels. */
  readonly width: number;
  /** The frames' stored height in pixels. */
  readonly height: number;
  /** The width the video is meant to be shown at (non-square pixels). */
  readonly displayWidth: number;
  /** The height the video is meant to be shown at. */
  readonly displayHeight: number;
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
  /**
   * The video's size as the upscaler gets it; `null` while no video
   * decodes. With {@link UpscalingState.area} it explains the factor.
   * Absent from players before 0.5.25.
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  readonly video?: UpscalingVideoSize | null;
  /**
   * The area the video is shown in, in pixels (the upscaler scales the
   * video to fit it); `null` while the player shows no video area. Absent
   * from players before 0.5.25.
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  readonly area?: {
    /** Width in physical pixels. */
    readonly width: number;
    /** Height in physical pixels. */
    readonly height: number;
  } | null;
  /**
   * The name of the GPU that renders, for example `NVIDIA GeForce RTX 4070
   * Laptop GPU`; `null` in software rendering and where the player does not
   * know it (macOS, Linux). Absent from players before 0.5.25.
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  readonly gpu?: string | null;
  /**
   * The hardware decoder in use for this video, as mpv names it (`d3d11va`,
   * `d3d11va-copy`; `no` for software decoding); `null` while no video
   * decodes. For people and logs: branch on {@link UpscalingReason.cause}.
   * Absent from players before 0.5.25.
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  readonly hwdecCurrent?: string | null;
  /**
   * The upscaler is in the player's video filter chain now, read from the
   * chain itself (`requested` is what the player asked for; they differ
   * only for a moment, while the chain changes). Still not a sign that the
   * GPU upscales: the driver gives none (see the remarks). Absent from
   * players before 0.5.25.
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  readonly inChain?: boolean;
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
 * @player 0.5.16
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
  /**
   * Call `listener` with the new state whenever it changes while some
   * plugin has upscaling on: the factor, whether the upscaler is in the
   * chain, the reason, the video's and the area's size, the decoder. A
   * window that shows how upscaling runs listens instead of polling
   * {@link VideoUpscaling.state}.
   *
   * @remarks
   * The player looks about five times a second while upscaling is on for
   * any plugin (a window resize sends at most that many), and sends a
   * change only when something differs; after the last plugin turns it
   * off one more change says so, then nothing until it is on again: read
   * {@link VideoUpscaling.state} when you need the state then. Nothing is
   * sent before the player's GPU check ran (the first `state()` or
   * `set(true)` of any plugin). `enabled` is this plugin's own request, as
   * in `state()`. The message of a `rendering` reason can be shorter than
   * the one `state()` gives (it may leave out what to do).
   *
   * **A listener keeps the plugin running.** `video.upscaling.changed` is
   * not an event the player wakes a stopped plugin for: while the plugin
   * listens, the player does not stop it while idle (lazy activation), even
   * with upscaling off. Listen only while a window that shows the state is
   * open, and dispose of the listener when it closes. Players before 0.5.25 do not know the event: the listener
   * never fires and the SDK logs that the player refused the subscription.
   *
   * @capability video.upscaling
   * @param listener - Receives the new state.
   * @returns Stops listening; also when the scope that added it is
   *   disposed.
   * @throws `capability` (synchronously) The manifest does not declare
   *   `video.upscaling`.
   *
   * @example Show how upscaling runs while a window is open
   * The plugin's window shows the factor, the sizes and the GPU while it
   * is open; the listener goes when the window closes, so the plugin can
   * be stopped while idle again.
   * ```ts
   * // When the window opens:
   * const watch = plugin.video.upscaling.onChange((state) => {
   *   const video = state.video ? `${state.video.width}×${state.video.height}` : "no video";
   *   const area = state.area ? `${state.area.width}×${state.area.height}` : "—";
   *   console.log(`${video} → ${area}, ×${state.factor ?? 1}, ${state.gpu ?? "no GPU"}`);
   * });
   * // When it closes: stop listening (it keeps the plugin running).
   * await watch.dispose();
   * ```
   *
   * @player 0.5.25
   * @since 1.5.43
   */
  onChange(listener: (state: UpscalingState) => void): Disposable;
}
