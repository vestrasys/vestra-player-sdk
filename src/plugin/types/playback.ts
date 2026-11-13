// Playback category: the timeline and the player.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { Disposable, PluginError } from "./base.ts";
import type { Bindable } from "./commands.ts";
import type { Text } from "./ui-locale.ts";
import type { CommandKeys } from "../../commands.ts";
import type { SourceState } from "../../source.ts";
import type {
  PackageInfo,
  WindowFacts,
  WireMotionState,
  WireTimeline,
  WireUpscalingState,
} from "../../wire.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Host } from "./commands.ts";
import type { PluginInfo } from "./packages.ts";
import type { MediaCapture } from "./snapshots.ts";
import type { FileResolverOptions, Resolver } from "./sources.ts";
import type { View } from "./ui-content.ts";
import type { Scope, WindowState } from "./base.ts";
/* oxlint-enable no-unused-vars */

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
 * How a timeline range is drawn; readers choose colours by it.
 *
 * - `"selection"`: a span the user picked to act on, such as a clip to
 *   export. The player's seek bar draws it in the accent colour.
 * - `"region"`: a part of the media the plugin describes, such as an intro
 *   or a chapter's span. Drawn dimmer, under selections.
 *
 * @since 1.6.9
 * @category Playback
 */
export type RangeStyle = "selection" | "region";

/**
 * One range on the seek bar.
 *
 * @since 1.6.9
 * @category Playback
 */
export interface TimelineRange {
  /** Seconds from the start. */
  readonly start: number;
  /** Seconds from the start, after `start`. */
  readonly end: number;
  /** How it is drawn. */
  readonly style: RangeStyle;
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
   * with `ifCurrent`, a write for another source is dropped silently. A title
   * is data (a chapter's or bookmark's own name), or a {@link Text} the player
   * translates (`text("Chapter {}", [n])`); other plugins read the shown
   * string.
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
  /**
   * Replace the layer's ranges (last write wins; `[]` clears them), spans of
   * the media drawn on the seek bar. The marks and the ranges of a layer are
   * replaced on their own: `set` keeps the ranges and `setRanges` keeps the
   * marks. Disposing the layer, its scope or stopping the plugin removes both,
   * and a new source clears every layer.
   *
   * At most 100 ranges (`TIMELINE_LIMITS.ranges`), `0 ≤ start < end`, `end`
   * within the media while its duration is known, titles ≤ 100 characters.
   * Ranges may overlap. Failures go to `onError`; with `ifCurrent`, a
   * write for another source is dropped silently. A title is data or a
   * {@link Text} the player translates, as in `set`.
   *
   * @example Show the clip range on the seek bar while a panel is open
   * The span the user picked shows on the seek bar in the accent colour
   * while the plugin's tab is showing, and goes when it is not. Two point
   * marks would show the ends but not the span between them.
   * ```ts
   * declare const panel: Panel;
   * declare const clip: { start: number; end: number };
   * // ---cut---
   * const layer = plugin.timeline.layer();
   * // Only while the tab is on screen; [] takes the range away.
   * const show = () =>
   *   layer.setRanges(
   *     panel.state?.effective
   *       ? [{ start: clip.start, end: clip.end, style: "selection", title: "Clip" }]
   *       : [],
   *     { ifCurrent: plugin.player.state },
   *   );
   * panel.onChange(show);
   * ```
   *
   * @capability timeline.marks
   * @since 1.6.9
   */
  setRanges(
    ranges: {
      start: number;
      end: number;
      style: RangeStyle;
      title?: string | Text;
    }[],
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
 * any plugin can read. To run code when they change, listen with
 * `plugin.player.on("timeline.changed", …)` (needs `events`): `marks` and
 * `ranges` already hold the event's lists when the listener runs.
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
   * Every layer's ranges merged, by start (`playback.read`). Empty on a new
   * source. Kept current like `marks` (with `events`): read it in a
   * {@link View.bind} function and the view follows it.
   *
   * @example Draw the published ranges in a seek bar of your own
   * A bottom bar draws a band for every range on the seek bar, whoever
   * published it, as fractions of the duration.
   * ```ts
   * declare const bar: View;
   * // ---cut---
   * bar.bind(() => {
   *   // Reading `ranges` here runs the binding again when they change.
   *   const duration = plugin.player.state.duration ?? 0;
   *   return {
   *     ranges: duration
   *       ? plugin.timeline.ranges.map((range) => ({
   *           from: range.start / duration,
   *           to: range.end / duration,
   *           selection: range.style === "selection",
   *         }))
   *       : [],
   *   };
   * });
   * ```
   *
   * @capability playback.read
   * @since 1.6.9
   */
  readonly ranges: readonly TimelineRange[];
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
 * @see {@link Player.state}, [Control playback](../../../docs/guides/control-playback.md)
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
 * @see [Control playback](../../../docs/guides/control-playback.md)
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
 * @see [Keep a slider responsive while dragging](../../../docs/guides/slider.md)
 * @since 1.0.0
 * @category Playback
 */
export interface Scrub {
  /**
   * Seek within the gesture. Resolves `true` when this target was applied,
   * `false` when a newer target superseded it or the gesture ended. Rejects
   * on a host failure.
   *
   * `keyframes: true`: land on the last keyframe at or before `seconds` instead
   * of decoding up to that exact frame. The picture appears at once on any file
   * (tens of milliseconds instead of seconds on 4K video with keyframes far
   * apart), up to one keyframe interval before the target; the position the
   * player reports is the keyframe's. Use it when the user chose keyframe seeks
   * (the same switch as {@link Player.setStepSeek}), and the exact seek
   * otherwise. The player sends a repeated target of the same gesture only once
   * while the seek is still running (a click is a press and a release), but an
   * exact seek to the target of a keyframe seek is always sent. Omitted or
   * `false`: exact, as before.
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
   * declare const generatorWindow: Window;
   * // ---cut---
   * generatorWindow.onClose(() => stream.stop());
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
   * The rendering path: "libmpv · GPU 渲染（OpenGL）" (GPU on macOS, the
   * default there), "libmpv · GPU 渲染（Direct3D）" (GPU on Windows, when
   * turned on; version 0.5.14 and later) or "libmpv · 软件渲染" (software: Windows by
   * default, Linux, headless, fallback). The strings are the player's
   * display text in the interface language (shown here in Chinese).
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
   * the player cannot measure it (no window, the first second).
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
    /** Frames per second (after a `frameBlend` node: the output rate; motion smoothing's doubling is not counted). */
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
 * @see [Control playback](../../../docs/guides/control-playback.md)
 * @since 1.0.0
 * @category Playback
 */
export interface Player {
  /**
   * Latest state; always newer than anything delivered before.
   *
   * With `events` the SDK follows the player's events for this copy from
   * the plugin's start; without it the copy moves only with the start-up
   * read and the plugin's own calls (`playback.read`).
   */
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
   * Listen to one event of the player, with its data as the player sent
   * it: no state copy, no comparison.
   *
   * @remarks
   * `event` is one of the {@link HostEvent} names (`"source.state"`,
   * `"window.state"`, `"timeline.changed"`…), whatever part of the plugin
   * API it concerns; `listener` gets a copy of that event's data, typed
   * {@link EventPayload} (`source.state`: the player's source state, with
   * `rate`, `paused`, `position`, `stamp`…). Each subscription counts as a
   * listener of the plugin: the player keeps the plugin running while one
   * exists (unless the event is one the player wakes a stopped plugin for),
   * and its log names where the plugin added it
   * (`a listener added at main.ts:12`). Every name, its payload and its
   * capability: [Events](../../../docs/reference/events.md).
   *
   * Unlike {@link Player.onChange} it does not start the SDK's copy of the
   * state: `plugin.player.state` is not kept current by it, and the
   * listener runs for every event, changed or not. Three events are the
   * exception: `commands.keys`, `timeline.changed` and `appearance.changed`
   * start the copy they keep current (`plugin.commands.keys`,
   * `plugin.timeline.marks` and `ranges`, `plugin.appearance.theme` and
   * `language`), which stays for the plugin's life as a copy (not a
   * listener: it keeps no plugin running), and the copy takes each event
   * before the listener runs, so the listener reads the new values there.
   * The listener hears only the player's events, never the copy's own first
   * read: take the starting value once after activation, or read the copy
   * in a {@link View.bind} function, which follows both. It suits pushing
   * values yourself (`view.set` from the listener) or reading a field the
   * SDK does not expose. Errors go to {@link Scope.onError}, as for every
   * handler; unlike the others, no full update pass follows it, so bound
   * values do not re-evaluate on every event: a write to a
   * {@link Scope.state} field re-runs only its readers, and
   * {@link Scope.update} re-runs everything.
   *
   * Each event needs a capability: `events` for most, `bindings.manage` for
   * `bindings.changed`, `commands` for `commands.keys`, `video.upscaling` for
   * `video.upscaling.changed`, `video.motion` for `video.motion.changed`,
   * none for `packages.changed`. Without it the
   * listener never runs (for `events`, a warning in the log says so). Added
   * during `activate`, that fails the activation.
   *
   * @param event - The event's name.
   * @param listener - Receives each event's data.
   * @returns A handle that stops listening; it is disposed with the scope.
   *
   * @throws `invalid` (throws) `event` is not a {@link HostEvent} name, or
   *   `listener` is not a function.
   *
   * @capability That of the event: `events`, or `bindings.manage`,
   * `commands`, `video.upscaling`, `video.motion` for the events named above.
   *
   * @example Push the speed to a panel as it changes
   * A bottom panel shows the playback speed. The listener gets each
   * `source.state` event's data and writes the text with `set`; no update
   * pass runs and the SDK keeps no copy of the state for this.
   * ```ts
   * const bar = plugin.panels.mount("bottom", "ui/bar.slint");
   * plugin.player.on("source.state", (s) => bar.set({ rate: `${s.rate.toFixed(2)}×` }));
   * ```
   *
   * @see [Tutorial](../../../docs/tutorial/index.md)
   * @since 1.7.0
   */
  on<E extends HostEvent>(
    event: E,
    listener: (data: EventPayload<E>) => void,
  ): Disposable;
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
   * Jump to `seconds`. After the end (`phase: "ended"`) the player leaves
   * the end there and plays on, unless the end was reached while paused or
   * by a frame step; a seek at or past the end leaves it ended and paused.
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
   * @see [Keep a slider responsive while dragging](../../../docs/guides/slider.md)
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
   * and `canPrevious` are evaluated again after every handler the SDK runs
   * (and after a player state change if they read a changed field), and while they return false the player disables its items ("No next
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
   * `keyframes: true`: the step seeks (`seek-backward` / `seek-forward`,
   * including {@link Host.run} with `seconds` and the picture-in-picture skips)
   * land on a keyframe instead of the exact time: forward on the first keyframe
   * at or after position + step, backward on the last at or before position −
   * step, and they always move. Presses during a seek add up and continue from
   * where it landed; the on-screen text shows the landed time. Sources without
   * moving video seek exactly, and so does a step seek after the end. {@link Player.seek}, chapters, loops and
   * {@link Player.step} are unaffected, and so is a scrub unless it asks for
   * keyframes itself ({@link Scrub.seek} with `keyframes: true`). Omitted or
   * `false`: exact seeks, as before. `seconds` and `keyframes` are written as a
   * pair: the newest call sets both.
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

// ------------------------------------------------------------------ events

/**
 * The events a plugin can listen to with {@link Player.on}, by the name
 * the player gives them.
 *
 * @remarks
 * The same names the SDK subscribes to for its own copies of the player's
 * state (`plugin.player.state`, `plugin.window.state`,
 * `plugin.timeline.marks`…). {@link EventPayloads} says what each one
 * carries. A name outside this list is refused with `invalid`.
 *
 * @example Name the event a listener follows
 * A plugin logs each change of its own key labels. The name completes in
 * the editor, and the listener's parameter takes the type of that event's
 * data.
 * ```ts
 * const event: HostEvent = "commands.keys";
 * plugin.player.on(event, (data) => console.log("keys changed", data));
 * ```
 *
 * @since 1.7.0
 * @category Playback
 */
export type HostEvent =
  | "source.state"
  | "playback.backend"
  | "window.state"
  | "packages.changed"
  | "bindings.changed"
  | "commands.keys"
  | "timeline.changed"
  | "appearance.changed"
  | "resolvers.fileTypes"
  | "video.upscaling.changed"
  | "video.motion.changed";

/**
 * The data each {@link HostEvent} carries, as the player sends it: the
 * listener of {@link Player.on} gets a copy.
 *
 * @remarks
 * These are the player's wire shapes, not the SDK's views of them: field
 * names and units are the player's (`source.state` names the source
 * generation `stamp.generation`, where {@link PlayerState} says
 * `sourceId`). They follow the player's protocol and can gain fields with
 * a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface EventPayloads {
  /** The player's source: phase, position, rate, volume, its stamp (what {@link PlayerState} is made from). */
  "source.state": SourceState;
  /** A playback backend event: the backend's name for it (`event`) and the source generation it belongs to. */
  "playback.backend": {
    /** The source generation it belongs to. */
    currentSession: number;
    /** The backend's name for the event. */
    event: string;
  };
  /** The main window: fullscreen, maximized, video area, picture-in-picture (what {@link WindowState} is made from). */
  "window.state": WindowFacts;
  /** Every installed plugin, after an install, an uninstall or a change of one (needs no capability). */
  "packages.changed": PackageInfo[];
  /** A key binding changed somewhere; read them again with `plugin.bindings.list()`. */
  "bindings.changed": null;
  /** The key labels of this plugin's own commands, with the binding table's revision. */
  "commands.keys": CommandKeys;
  /** Every timeline mark and range, after any plugin or the player changed one. */
  "timeline.changed": WireTimeline;
  /** The palette changed (`theme`), or the interface language the user saved (`language`; the oldest players send no language). */
  "appearance.changed": {
    /** The palette now (`ThemeId`; a newer player may name one this SDK does not list). */
    theme: string;
    /** The interface language the user saved, `"system"` or a locale (absent from the oldest players). */
    language?: string;
  };
  /** The file extensions the plugins' file resolvers claim now. */
  "resolvers.fileTypes": {
    /** The extensions, lower case without the dot. */
    fileTypes: string[];
  };
  /** The AI upscaling state, without this plugin's own `enabled`. */
  "video.upscaling.changed": Omit<WireUpscalingState, "enabled">;
  /** Motion smoothing's state, without this plugin's own `mode`. */
  "video.motion.changed": Omit<WireMotionState, "mode">;
}

/**
 * The data of event `E`, as the listener of {@link Player.on} gets it.
 *
 * @example Type a listener kept apart from the call
 * A function that handles the player's source state is written on its
 * own and passed to `on` later. `EventPayload` gives its parameter the
 * type of that event's data.
 * ```ts
 * const showRate = (s: EventPayload<"source.state">) => void plugin.osd.show("{}×", [s.rate]);
 * plugin.player.on("source.state", showRate);
 * ```
 *
 * @since 1.7.0
 * @category Playback
 */
export type EventPayload<E extends HostEvent> = EventPayloads[E];

// ---------------------------------------------------------------- mpv pass-through (mpv)

/**
 * A value of mpv, as JSON: what a property holds, a command returns or an
 * argument of `set` is (mpv's "node": nothing, a flag, a number, a string,
 * a list or a map of them).
 *
 * @since 1.8.0
 * @category Playback
 */
export type MpvValue =
  null | boolean | number | string | MpvValue[] | { [key: string]: MpvValue };

/**
 * `plugin.mpv`: mpv's own commands and properties, sent to the player's
 * mpv as they are. Needs the capability `mpv`, which the store shows the
 * user before installing.
 *
 * @example Turn mpv's debanding on and show whether it took effect
 * A plugin offers mpv's `deband` option, which the plugin API has no member
 * for. `set` writes the property and `get` reads it back; the names and
 * the values are mpv's.
 * ```ts
 * await plugin.mpv.set("deband", true);
 * const on = await plugin.mpv.get("deband");
 * await plugin.osd.show(on ? "Debanding on" : "Debanding off");
 * ```
 *
 * @remarks
 * The channel is the SDK's contract: four members, their errors, what is
 * refused and who owns what. The names, the arguments and what they do are
 * mpv's, as its manual describes them for the mpv the player ships
 * ([commands](https://mpv.io/manual/stable/#list-of-input-commands),
 * [properties](https://mpv.io/manual/stable/#properties),
 * [options](https://mpv.io/manual/stable/#options)); they can change with
 * a player version, which the SDK does not track. Prefer a typed member
 * where one exists ({@link Player}, {@link Scope.video}, {@link Scope.subtitles}):
 * it is checked, tested by {@link "@vestra-player/sdk/testing"!TestHost | TestHost} and reaches snapshots and
 * exports, which a filter added here does not.
 *
 * Refused with code `refused` (the message names the command or property
 * and why): what starts a program, loads scripts or configuration, opens a
 * control channel, makes the player write or delete files, ends the player,
 * drives its keyboard and mouse, reaches the clipboard, or changes what the
 * player manages itself (the source and the playlist, the position, the
 * tracks, the output, the window, the subtitle style, the renderer options
 * of {@link Scope.video}, its own filters). A plugin does the first four with
 * Node; the last has a typed member. Reading is not refused, except the
 * clipboard. The full table is in [mpv](../../../docs/reference/mpv.md).
 *
 * Filters: `["vf", "add", "@label:…"]` (and `af`; `add`, `pre`, `toggle`,
 * `remove`) with a label of the plugin's own, not starting with `vestra-`
 * and not `all`.
 * A labelled filter belongs to the plugin that added it: another plugin
 * cannot change it (`conflict`), and the player removes it when the plugin
 * stops. The player's own filters (the typed chains of {@link Scope.video},
 * the upscaler, motion smoothing) stay in the chain beside it.
 *
 * A property a plugin set keeps its value after the plugin stops, until
 * the player quits (what the capability `mpv` discloses); a plugin that
 * wants it back sets it back. Observers end with the plugin. A filter
 * or an observer keeps the plugin running.
 *
 * @capability mpv
 * @see [mpv](../../../docs/reference/mpv.md)
 * @since 1.8.0
 * @category Playback
 */
export interface Mpv {
  /**
   * Run an mpv command: its name, then its arguments, as mpv's manual lists
   * them. Resolves with the command's result (`null` for most).
   *
   * @param args - The command's name and its arguments: strings, numbers
   *   or booleans. The first is the command itself: mpv would take a
   *   prefix word (`no-osd`, `async`, `raw`…) off the front and run what
   *   follows, so the channel refuses one there (`invalid`). Arguments are
   *   not expanded (`${property}` stays text).
   * @returns What the command returns.
   *
   * @example Add a filter of the plugin's own and remove it again
   * A plugin sharpens the picture with an FFmpeg filter the typed chain
   * does not offer, and takes it out when the user switches it off. The
   * label makes the filter the plugin's: the player removes it by itself
   * when the plugin stops.
   * ```ts
   * await plugin.mpv.command(["vf", "add", "@crisp:lavfi=[cas=strength=0.6]"]);
   * // later
   * await plugin.mpv.command(["vf", "remove", "@crisp"]);
   * ```
   *
   * @capability mpv
   * @throws `capability` (rejects) The manifest does not declare `mpv`.
   * @throws `invalid` (rejects) Not an array of a name and up to 31
   *   arguments, or an argument that is not a string, number or boolean.
   * @throws `refused` (rejects) A command the channel does not carry; the
   *   message names it and why.
   * @throws `conflict` (rejects) A filter label another plugin owns.
   * @throws `backend` (rejects) mpv failed the command; `message` is
   *   mpv's error ("mpv: invalid parameter").
   * @since 1.8.0
   */
  command(args: readonly (string | number | boolean)[]): Promise<MpvValue>;
  /**
   * Read an mpv property now.
   *
   * @param name - The property, as mpv names it (`"estimated-vf-fps"`,
   *   `"video-params/w"`).
   * @returns Its value.
   *
   * @example Show the decoder in use
   * A statistics panel reads which hardware decoder mpv uses now.
   * `get` resolves with mpv's value: here a string, `"no"` without one.
   * ```ts
   * const decoder = await plugin.mpv.get("hwdec-current");
   * await plugin.osd.show("Decoder: {}", [String(decoder)]);
   * ```
   *
   * @capability mpv
   * @throws `capability` (rejects) The manifest does not declare `mpv`.
   * @throws `invalid` (rejects) Not a property name.
   * @throws `refused` (rejects) The clipboard's properties.
   * @throws `backend` (rejects) mpv has no such property, or it has no
   *   value now ("mpv: property not found", "mpv: property unavailable").
   * @since 1.8.0
   */
  get(name: string): Promise<MpvValue>;
  /**
   * Set an mpv property (or option). It keeps the value after the plugin
   * stops, until the player quits.
   *
   * @param name - The property, as mpv names it.
   * @param value - Its new value, in the type mpv has for it.
   *
   * @example Use a sharper scaler while a panel is open
   * A plugin switches mpv's scaler and puts the old one back when its
   * panel closes. The value is read first, since `set` does not undo
   * itself.
   * ```ts
   * const before = await plugin.mpv.get("scale");
   * await plugin.mpv.set("scale", "ewa_lanczossharp");
   * // when the panel closes
   * await plugin.mpv.set("scale", before);
   * ```
   *
   * @capability mpv
   * @throws `capability` (rejects) The manifest does not declare `mpv`.
   * @throws `invalid` (rejects) Not a property name, or no value.
   * @throws `refused` (rejects) A property the channel does not carry; the
   *   message names it and why.
   * @throws `backend` (rejects) mpv refused the value or has no such
   *   property; `message` is mpv's error.
   * @since 1.8.0
   */
  set(name: string, value: MpvValue): Promise<void>;
  /**
   * Hear an mpv property's value now and after each change. The player
   * sends the newest value at most every 100 ms. While a listener exists
   * the player keeps the plugin running.
   *
   * @param name - The property, as mpv names it.
   * @param listener - Receives the value: first the current one, then
   *   each change.
   * @returns A handle that stops listening; it is disposed with the scope.
   *
   * @example Follow the frame rate after filters
   * A panel shows the frame rate mpv measures behind its filter chain.
   * The listener runs with the current value and again whenever it
   * changes; a failure to observe goes to `plugin.onError`.
   * ```ts
   * declare const panel: Panel;
   * // ---cut---
   * plugin.mpv.observe("estimated-vf-fps", (fps) => {
   *   panel.set({ fps: typeof fps === "number" ? fps.toFixed(1) : "—" });
   * });
   * ```
   *
   * @capability mpv
   * @throws `capability` (throws) The manifest does not declare `mpv`.
   * @throws `invalid` (throws) Not a property name, or no listener.
   * @throws `refused` (throws) The clipboard's properties.
   * @throws `limit` (through `onError`) More than 64 properties observed
   *   by this plugin.
   * @since 1.8.0
   */
  observe(name: string, listener: (value: MpvValue) => void): Disposable;
}
