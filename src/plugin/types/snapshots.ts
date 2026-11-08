// Media category: snapshots, capture and export jobs.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { MediaJob } from "../../media.ts";
import type { Disposable } from "./base.ts";
import type { Conditional } from "./playback.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { AppInfo } from "./base.ts";
/* oxlint-enable no-unused-vars */

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
   * A **stream copy** (`format: "copy"`, player 0.7.6) writes the video
   * stream and the snapshot's audio track as they are in the file, without
   * decoding: lossless and about as fast as the disk, but a copy can only
   * begin on a keyframe. It starts at the video's last keyframe at or before
   * the snapshot time (its first keyframe when the video itself starts
   * later; keyframes an MP4 edit list discards do not count) and is cut at
   * `end`, where it may run a few frames past `end`. An open GOP can write
   * a frame or two that present before the keyframe; `start` includes them.
   * The finished job's `outcome` gives the `start` and `end` actually
   * written; a plugin that previews the cut (with `plugin.tools.run`
   * and ffprobe's packet flags, say) shows those once the job is done.
   * Copies need a raw snapshot (effects and burned-in subtitles need a
   * re-encode) and leave subtitle tracks and chapters out. `auto` writes
   * MP4 for H.264, HEVC, AV1 or MPEG-4 video with AAC, MP3, AC-3, E-AC-3 or
   * ALAC audio (or none), and MKV for anything else. A copy the player
   * cannot make (no video stream, a cover image, an external audio track,
   * codecs `mp4` cannot hold) ends `failed` with the code `unsupported`.
   *
   * @capability media.read and media.control
   * @throws `released` (rejects) The snapshot was already released.
   * @throws `invalid` (rejects) Bad options (`quality` outside 1–100, a
   *   relative destination, a clip `end` not after the snapshot time or
   *   past the duration, an {@link ExportEncoding} value outside its set,
   *   `copy` from a processed snapshot).
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
   * @example Cut without re-encoding and report where it starts
   * The clip is copied as it is in the file. A copy starts on a keyframe,
   * so the OSD says where it actually starts; a file the player cannot
   * copy ends with `unsupported`, and the plugin offers a re-encode instead.
   * ```ts
   * declare const snapshot: Snapshot;
   * // ---cut---
   * const job = await snapshot.export({ format: "copy", destination: "/tmp/clip.mp4", end: snapshot.time + 20 });
   * const state = await job.done;
   * const outcome = state.outcome;
   * // The copy starts on a keyframe: outcome.start says where.
   * if (outcome && "destination" in outcome)
   *   await plugin.osd.show("Saved {} from {} s", [outcome.destination, (outcome.start ?? snapshot.time).toFixed(1)]);
   * // Codecs the container cannot hold, a cover image, …
   * else if (outcome && "error" in outcome && outcome.error.code === "unsupported")
   *   await plugin.osd.show("Fast cut is not possible for this file");
   * ```
   *
   * @since 1.0.0
   */
  export(options: ExportOptions): Promise<ExportJob>;
}

/**
 * One frame as PNG, JPEG (`quality` 1–100, default 90) or BMP (24-bit), or
 * a clip: re-encoded as MP4 (`mp4`, frame-accurate, optional
 * {@link ExportEncoding}) or copied without re-encoding (`copy`, player
 * 0.7.6, starting on a keyframe).
 *
 * `destination` is never overwritten if it exists. The extension does not
 * choose the format (a copy's extension is set to its container).
 * `sampleTime` picks the frame (default: the snapshot time); `end` is the
 * clip's end in source seconds. On Windows the export worker needs FFmpeg
 * 6.1 or newer.
 *
 * **Which players have `copy`, `encoding` and the progress and range of
 * a job**: player 0.7.6 and later. Declare `"minPlayerVersion": "0.7.6"`,
 * or, to keep older players and offer these only where they exist, compare
 * {@link AppInfo.version | plugin.app.version} with `0.7.6`, as for any
 * newer API. Do not probe by trying: on an older player the `plugin`
 * object comes from that player's own, older SDK, which rejects `copy` with
 * `invalid` but builds a re-encode request without the `encoding` it does
 * not know, so the clip is encoded with the fixed settings and no error.
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
      /** A clip from the snapshot time, re-encoded as H.264 + AAC. */
      format: "mp4";
      /** Absolute path of the new file. */
      destination: string;
      /** Clip end, source seconds. */
      end: number;
      /**
       * Encoder settings (player 0.7.6); without it, the settings before
       * they existed.
       *
       * @since 1.6.10
       */
      encoding?: ExportEncoding;
    }
  | {
      /**
       * A clip copied stream by stream, without re-encoding (player 0.7.6):
       * lossless and about as fast as the disk. It starts on the video
       * keyframe at or before the snapshot time; see {@link Snapshot.export}.
       *
       * @since 1.6.10
       */
      format: "copy";
      /**
       * Absolute path of the new file. The player gives it the extension of
       * the container it writes (`.mp4` or `.mkv`); the finished job's
       * `outcome.destination` is the actual path.
       */
      destination: string;
      /** Clip end, source seconds. */
      end: number;
      /**
       * `auto` (default): MP4 when the codecs fit it, otherwise MKV. `mp4`
       * fails with `unsupported` when they do not; `mkv` always writes MKV.
       */
      container?: "auto" | "mp4" | "mkv";
    };

/**
 * The encoder settings of a re-encoded clip (`format: "mp4"`, player
 * 0.7.6): a closed set of values, never encoder arguments. Every field is
 * optional; the defaults are the settings clips had before: CRF 18, the
 * fastest speed, the source's size and frame rate, AAC 192 kb/s, one thread.
 * A value outside its set rejects the export with `invalid`. `videoBitrate:
 * "source"` replaces the CRF with the source's bitrate, for a "Same as
 * source" preset.
 *
 * @example A small file
 * A 720p, 30 fps clip at a lower quality, encoded with the cores the player
 * can spare.
 * ```ts
 * declare const snapshot: Snapshot;
 * // ---cut---
 * // Each field is a ceiling or a choice from a closed set.
 * const job = await snapshot.export({
 *   format: "mp4",
 *   destination: "/tmp/small.mp4",
 *   end: snapshot.time + 30,
 *   encoding: { crf: 26, maxHeight: 720, fps: 30, audioBitrate: 128, threads: "auto" },
 * });
 * ```
 *
 * @since 1.6.10
 * @category Media
 */
export interface ExportEncoding {
  /**
   * H.264 quality, an integer 14–30 (x264's CRF): lower is a better picture
   * and a bigger file. Default 18.
   */
  crf?: number;
  /**
   * Encoding effort: `faster` (default), `balanced` or `smaller` (slower,
   * a smaller file at the same quality); x264's `veryfast`, `medium` and
   * `slow`.
   */
  speed?: "faster" | "balanced" | "smaller";
  /**
   * The tallest picture: a taller one is scaled down to this height,
   * keeping its shape; a shorter one is left as it is. Default: the
   * source's size.
   */
  maxHeight?: 1080 | 720 | 480;
  /**
   * The highest frame rate: a faster source drops frames to it; a slower
   * one is left as it is. Default: the source's rate.
   */
  fps?: 60 | 30;
  /** AAC audio bitrate in kb/s. Default 192. */
  audioBitrate?: 128 | 192 | 256;
  /**
   * `single` (default) encodes on one thread, leaving the other cores to
   * playback. `auto` lets the player use more: half the logical
   * processors, at most 8, so playback and the interface keep their rate.
   * From player 0.7.6 every export runs at below-normal priority (as
   * HandBrake and OBS run their encoders), with either setting.
   */
  threads?: "single" | "auto";
  /**
   * `source`: aim at the source video's average bitrate instead of a
   * quality level (peaks up to 1.5 times it), so the file comes out about
   * the size of that stretch of the source: a "Same as source" preset. Not
   * together with `crf` (`invalid`). A source whose bitrate the player
   * cannot tell ends the job `failed` with `unsupported`.
   */
  videoBitrate?: "source";
}

/**
 * An export job's state. `status` is `queued`, `running`, `cancelling`,
 * `completed`, `failed` or `cancelled`; once terminal, `outcome` is
 * `{ destination }`, `{ error: { code, message } }` or `{ cancelled: true }`.
 * `facts` describes what the worker produced (versions, range, streams).
 *
 * From player 0.7.6:
 * - a finished clip's `outcome` also has `start` and `end`, the source
 *   times of its first frame and of the end of its last frame as written: a
 *   copy's earliest written frame (its keyframe, or the leading frames of
 *   an open GOP) and actual end; a re-encode's start and start
 *   plus the encoded length.
 * - `progress` is `{ done, total }` in seconds of the clip while FFmpeg
 *   writes it (at most 4 updates a second; the SDK reads it about every
 *   350 ms), `null` while unknown: before writing starts, and always for a
 *   frame. Show an indeterminate bar then. After `done` reaches `total` the
 *   player still checks the file before the job completes.
 * - `error.code` is `export-failed`, or `unsupported` for an export the
 *   player cannot make as asked (a stream copy it cannot make, a
 *   `videoBitrate: "source"` whose source bitrate it cannot tell).
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
