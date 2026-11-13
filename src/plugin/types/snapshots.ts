// Media category: snapshots, capture and export jobs.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { MediaJob, WireExportCheck } from "../../media.ts";
import type { Disposable } from "./base.ts";
import type { Conditional } from "./playback.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { AppInfo } from "./base.ts";
import type { Player } from "./playback.ts";
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
   * A **stream copy** (`format: "copy"`) writes the video stream and the
   * snapshot's audio track as they are in the file, without decoding: lossless
   * and about as fast as the disk, but a copy can only begin on a keyframe. It
   * starts at the video's last keyframe at or before the snapshot time (its
   * first keyframe when the video itself starts later; keyframes an MP4 edit
   * list discards do not count) and is cut at `end`, where it may run a few
   * frames past `end`. An open GOP can write a frame or two that present before
   * the keyframe; `start` includes them. The finished job's `outcome` gives the
   * `start` and `end` actually written; a plugin that previews the cut (with
   * `plugin.tools.run` and ffprobe's packet flags, say) shows those once the
   * job is done. Copies need a raw snapshot (effects and burned-in subtitles
   * need a re-encode) and leave subtitle tracks and chapters out. `auto` writes
   * MP4 for H.264, HEVC, AV1 or MPEG-4 video with AAC, MP3, AC-3, E-AC-3 or
   * ALAC audio (or none), and MKV for anything else. A copy the player cannot
   * make (no video stream, a cover image, an external audio track, codecs `mp4`
   * cannot hold) ends `failed` with the code `unsupported`.
   *
   * @throws `released` (rejects) The snapshot was already released.
   * @throws `invalid` (rejects) Bad options (`quality` outside 1–100, a
   *   relative destination, a clip `end` not after the snapshot time or
   *   past the duration, an {@link ExportEncoding} value outside its set,
   *   `copy` from a processed snapshot).
   * @throws `busy` (rejects) This plugin runs 2 exports (or the player 8).
   * @throws `unavailable` (rejects) No FFmpeg, or the export worker could not
   *   start.
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
 * One frame as PNG, JPEG (`quality` 1–100, default 90) or BMP (24-bit), or a
 * clip: re-encoded as MP4 (`mp4`, frame-accurate, optional
 * {@link ExportEncoding}) or copied without re-encoding (`copy`, starting on a
 * keyframe).
 *
 * `destination` is never overwritten if it exists. The extension does not
 * choose the format (a copy's extension is set to its container).
 * `sampleTime` picks the frame (default: the snapshot time); `end` is the
 * clip's end in source seconds. On Windows the export worker needs FFmpeg
 * 6.1 or newer.
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
       * Encoder settings; without it, the settings before they existed.
       *
       * @since 1.6.10
       */
      encoding?: ExportEncoding;
    }
  | {
      /**
       * A clip copied stream by stream, without re-encoding: lossless and about
       * as fast as the disk. It starts on the video keyframe at or before the
       * snapshot time; see {@link Snapshot.export}.
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
 * The encoder settings of a re-encoded clip (`format: "mp4"`): a closed set of
 * values, never encoder arguments. Every field is optional; the defaults are
 * the settings clips had before: CRF 18, the fastest speed, the source's size
 * and frame rate, AAC 192 kb/s, one thread. A value outside its set rejects the
 * export with `invalid`. `videoBitrate: "source"` replaces the CRF with the
 * source's bitrate, for a "Same as source" preset.
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
   * playback. `auto` lets the player use more: half the logical processors, at
   * most 8, so playback and the interface keep their rate. Every export runs at
   * below-normal priority (as HandBrake and OBS run their encoders), with
   * either setting.
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
 * In addition:
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
 * - an export of parts ({@link MediaCapture.export}) also has
 *   `progress.part` (from 1) and `progress.parts` while it runs, and
 *   `facts.join` once written;
 *   it can also end with `source-missing` or `source-changed` (since
 *   1.7.8).
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
   * @throws `rejected` (rejects) The player did not accept the request.
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
   * @throws `disabled` (rejects) The plugin is stopping.
   * @since 1.0.0
   */
  refresh(): Promise<JobState>;
}

/**
 * `plugin.media`: snapshots and exports. Exports decode offline and do not disturb playback.
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
  /**
   * Remembered local files: tokens for files the user opened, kept across
   * restarts, for exports made later ({@link MediaCapture.export}) and for
   * opening them again ({@link MediaSources.open}).
   *
   * @since 1.7.8
   */
  readonly sources: MediaSources;
  /**
   * Export a clip whose input is ranges of remembered files instead of a
   * snapshot: one part is a clip of one file, several parts are joined in
   * the order given into one file. The same formats as a clip of a
   * snapshot ({@link ExportOptions}: `copy` and `mp4`), the same job
   * ({@link ExportJob}: the queue of 2 per plugin and 8 in the player,
   * `done`, `cancel`, `outcome`); a snapshot's export is unchanged.
   *
   * `format: "copy"` copies each part without re-encoding, from the video
   * keyframe at or before its start (as a copied clip), and needs every
   * part to have the same video codec, profile, codec data, size, frame
   * rate and pixel format and the same audio (or none):
   * {@link MediaCapture.exportCheck} says whether they do and, if not, why.
   * `format: "mp4"` re-encodes every part to H.264 + AAC at the first
   * part's size (square pixels) and frame rate under the
   * {@link ExportEncoding} ceilings, each picture scaled to fit and centred
   * on black, the sound resampled to 48 kHz stereo (silence for a part
   * without sound when another part has some).
   *
   * While it runs, `progress` covers the whole output (`done` and
   * `total` in seconds) and says which part is being written (`part`
   * from 1, of `parts`). A finished job's `facts.join` has the range each
   * part was written from. A part whose file is gone ends the job
   * `failed` with `source-missing`, a file changed since it was remembered
   * with `source-changed`, parts a copy cannot write together with `unsupported`.
   * Before writing, the player compares the free space with an estimate
   * (the parts' share of their files for a copy; the picture for a
   * re-encode) for the intermediate parts, kept in the player's own
   * temporary folder, and for the output beside `destination`; too little
   * ends the job `failed` with `no-space`. Cancelling removes everything
   * written so far, and what a crash leaves in the temporary folder goes
   * at the player's next start.
   *
   * @throws `invalid` (rejects) No part or more than 100, a part whose end
   *   is not after its start, parts longer than 24 hours in all, a relative
   *   destination, `encoding` with `copy` or `container` with `mp4`, an
   *   {@link ExportEncoding} value outside its set.
   * @throws `missing` (rejects) A part's token is not one of this
   *   plugin's references (forgotten, or another plugin's).
   * @throws `busy` (rejects) This plugin runs 2 exports (or the player 8).
   * @throws `unavailable` (rejects) No FFmpeg, or the export worker could not
   *   start.
   *
   * @example Export two ranges of remembered files as one file
   * Two parts from two files become one file, copied as they are when the
   * check allows it and re-encoded otherwise. `exportCheck` answers from
   * the remembered facts; the job then runs in the player's export worker
   * and `done` resolves with its terminal state.
   * ```ts
   * declare const intro: SourceReference, scene: SourceReference;
   * // ---cut---
   * const parts = [
   *   { source: intro.token, start: 0, end: 12 },
   *   { source: scene.token, start: 95.5, end: 130 },
   * ];
   * const check = await plugin.media.exportCheck(parts);
   * if (check.blocking.length > 0) return; // a file is missing, say
   * const job = await plugin.media.export({
   *   parts,
   *   destination: "/tmp/joined.mp4",
   *   format: check.copy.ok ? "copy" : "mp4",
   * });
   * const end = await job.done;
   * await plugin.osd.show("Export: {}", [end.status]);
   * ```
   *
   * @since 1.7.8
   */
  export(options: PartsExportOptions): Promise<ExportJob>;
  /**
   * Check an export before starting it, of parts or of a snapshot's clip:
   * what blocks it (a part whose file is missing or changed, an unknown
   * token, a range outside the file, a file without video), whether a
   * stream copy (`format: "copy"`) can write it and, if not, each
   * difference from the first part (`effects` for a processed snapshot,
   * whose effects need a re-encode), and what a re-encode (`format:
   * "mp4"`) writes (with `encoding`, under its ceilings). Parts are
   * numbered from 0 in the order given; `{ snapshot, end }` is one part,
   * the snapshot's clip from its time to `end`. For parts it reads the
   * facts remembered with each reference and looks at each file on disk
   * (nothing is decoded, so it is cheap enough to run on every change of
   * a list); for a snapshot it reads the held file's streams.
   *
   * @throws `invalid` (rejects) No part or more than 100, a time that is
   *   negative, past 24 hours (24 hours in all) or not finite, a snapshot
   *   `end` not after its time or past its duration, an invalid
   *   `encoding`.
   * @throws `released` (rejects) The snapshot was released.
   * @throws `busy` (rejects) This plugin has 4 checks or source requests
   *   running.
   *
   * @example Say why the fast export is not possible
   * The plugin shows a line under its list when the parts need a
   * re-encode. Each reason names the part, the field that differs and both
   * values, so the line can say "part 2 is 1920×818, part 1 is
   * 3840×1714".
   * ```ts
   * declare const parts: ExportPart[];
   * // ---cut---
   * const check = await plugin.media.exportCheck(parts);
   * if (!check.copy.ok) {
   *   // Parts count from 0; the first difference is enough for one line.
   *   const [first] = check.copy.reasons;
   *   if (first)
   *     console.log(`part ${first.part + 1} is ${first.value}, part 1 is ${first.expected}`);
   * }
   * ```
   *
   * @example Offer a fast cut of a snapshot only when it is possible
   * The Clip page greys its Fast button when a stream copy of the marked
   * range cannot be made. The same check takes a snapshot's clip: one part
   * from the snapshot time to `end`.
   * ```ts
   * declare const snapshot: Snapshot;
   * // ---cut---
   * const check = await plugin.media.exportCheck({ snapshot, end: snapshot.time + 20 });
   * const fast = check.copy.ok;
   * console.log(fast ? "Fast" : "Precise only");
   * ```
   *
   * @since 1.7.8
   */
  exportCheck(
    input: ExportPart[] | { snapshot: Snapshot; end: number },
    options?: {
      /** The re-encode's settings, for its size and frame rate. */
      encoding?: ExportEncoding;
    },
  ): Promise<ExportCheck>;
}

/**
 * A remembered local file, from {@link MediaSources}: its token and what the
 * player knows of it. Never its path or its content.
 *
 * @since 1.7.8
 * @category Media
 */
export interface SourceReference {
  /** The opaque token: this plugin's key for the file. Store it. */
  readonly token: string;
  /** The file's name, for display. */
  readonly name: string;
  /** Its duration in seconds. */
  readonly duration: number;
  /**
   * `ok`; `missing` when no file is at its path any more (moved, renamed,
   * deleted, a drive not connected); `changed` when the file there has
   * another size or modification time than when it was remembered.
   */
  readonly status: "ok" | "missing" | "changed";
  /** Its video stream (the default one), `null` for none. */
  readonly video: {
    /** FFmpeg's codec name (`h264`, `hevc`, `vp9`, …). */
    codec: string;
    /** Width in pixels as stored (before the sample aspect ratio). */
    width: number;
    /** Height in pixels. */
    height: number;
    /** Frames per second. */
    fps: number;
    /** FFmpeg's pixel format (`yuv420p`, …), `null` when unknown. */
    pixelFormat: string | null;
  } | null;
  /** Its audio stream (the default one), `null` for none. */
  readonly audio: {
    /** FFmpeg's codec name (`aac`, `opus`, …). */
    codec: string;
    /** Samples per second. */
    sampleRate: number;
    /** Channel count. */
    channels: number;
  } | null;
}

/**
 * `plugin.media.sources`: remembered local files. The player gives a
 * plugin a token for the file playing now; the token survives restarts
 * and stands for that file in {@link MediaCapture.export},
 * {@link MediaCapture.exportCheck} and {@link MediaSources.open}.
 *
 * Uses beyond exports: a bookmarks or history plugin keeps tokens to
 * reopen what the user watched at a position ({@link MediaSources.open},
 * with Locate… when a file moved), a resume plugin follows files across
 * renames, a compare plugin switches between two remembered files, a
 * chapters plugin keeps its marks per file without storing paths.
 *
 * @remarks
 * Tokens hide paths as an API convenience, not as a security boundary:
 * while the file plays, `player.state.source` shows its
 * path, and a plugin is an ordinary Node.js process, not sandboxed from
 * the file system, that can find files by other means. What a token gives is a
 * way to name the user's files without the plugin keeping their paths,
 * and to find them again after a move.
 *
 * Only the player makes tokens, and only for a local file that is
 * playing (the user opened it: the file dialog, a drop, the playlist, the
 * command line); a stream, an address or a plugin's own picture is
 * refused. A token belongs to the plugin that got it and means nothing to
 * another. It gives the file's name, duration and stream facts, never its
 * path or content. The player keeps the plugin's tokens in the profile
 * until the plugin forgets them or is uninstalled, at most 500 per plugin.
 * When a file has moved, {@link MediaSources.locate} lets the user find it
 * again in the player's own file dialog.
 *
 * @example Remember the playing file and check it later
 * The plugin keeps the token in its storage and checks the file before
 * using it. `remember` answers for the file playing now; `get` looks at
 * the file on disk again, so a moved file reads `missing`.
 * ```ts
 * const store = plugin.storage.json("parts", { defaults: { tokens: [] as string[] } });
 * const added = await plugin.media.sources.remember();
 * store.save({ tokens: [...store.value.tokens, added.token] });
 * // … after a restart:
 * const again = await plugin.media.sources.get(added.token);
 * if (again.status !== "ok") console.log(`${again.name} is ${again.status}`);
 * ```
 *
 * @since 1.7.8
 * @category Media
 */
export interface MediaSources {
  /**
   * A token for the file playing now (the same token again for the same
   * file as it is). Fails `unsupported` for a stream, an address or a
   * plugin's picture, `stale` when the source changed since `ifCurrent`.
   *
   * @throws `unsupported` (rejects) The source is not a local file, or the
   *   player cannot read its streams.
   * @throws `stale` (rejects) The source changed since `ifCurrent`.
   * @throws `limit` (rejects) The plugin holds 500 references; forget one.
   * @throws `busy` (rejects) This plugin has 4 source requests or checks
   *   running; try again when one has answered.
   * @throws `unavailable` (rejects) No FFmpeg to read the file with.
   *
   * @example Add the marked range to a list, with a thumbnail
   * The range the user marked becomes a part of the plugin's list. The
   * token stands for the file; the plugin keeps it with the times, and the
   * name is what the list shows. There is no thumbnail API: while the file
   * plays, the plugin captures the part's first frame
   * ({@link MediaCapture.capture}) and
   * exports it into its own data directory; `plugin.ui.image` shows it
   * scaled down.
   * ```ts
   * declare const list: { token: string; name: string; start: number; end: number; thumbnail: string }[];
   * declare const start: number, end: number;
   * // ---cut---
   * const file = await plugin.media.sources.remember();
   * // A new name each time: an export never overwrites a file.
   * const thumbnail = `${plugin.dataDirectory}/thumb-${file.token}-${Date.now()}.jpg`;
   * const snapshot = await plugin.media.capture({ at: start });
   * try {
   *   await (await snapshot.export({ format: "jpeg", destination: thumbnail, quality: 80 })).done;
   * } finally {
   *   await snapshot.dispose();
   * }
   * list.push({ token: file.token, name: file.name, start, end, thumbnail });
   * // In the row: plugin.ui.image(thumbnail, { maxSide: 64 })
   * ```
   *
   * @since 1.7.8
   */
  remember(options?: Conditional): Promise<SourceReference>;
  /**
   * The reference with its file looked at now: `status` says whether it
   * is still there as it was.
   *
   * @throws `missing` (rejects) Not one of this plugin's tokens.
   * @throws `busy` (rejects) This plugin has 4 source requests or checks
   *   running; try again when one has answered.
   *
   * @example Mark the parts whose file is gone
   * At start the plugin checks each remembered file once. A part whose file
   * was moved or deleted reads `missing`, and its row offers Locate.
   * ```ts
   * declare const tokens: string[];
   * // ---cut---
   * for (const token of tokens) {
   *   const file = await plugin.media.sources.get(token);
   *   if (file.status === "missing") console.log(`${file.name}: File missing`);
   * }
   * ```
   *
   * @since 1.7.8
   */
  get(token: string): Promise<SourceReference>;
  /**
   * Ask the user where the file is now: the player shows its own file
   * dialog (named after the file, opened in its old folder) and, when the
   * user picks a file, the token stands for that file from then on.
   * Resolves `null` when the user cancels.
   *
   * @throws `missing` (rejects) Not one of this plugin's tokens.
   * @throws `busy` (rejects) Another dialog of the player is open, or this
   *   plugin showed a Locate dialog less than 2 seconds ago.
   * @throws `unavailable` (rejects) No window to show the dialog in.
   * @throws `unsupported` (rejects) The player cannot read the chosen file's
   *   streams.
   *
   * @example Locate a moved file
   * The row's Locate… button asks the user for the file. The token keeps
   * its value, so every part that uses it works again.
   * ```ts
   * declare const token: string;
   * // ---cut---
   * const found = await plugin.media.sources.locate(token);
   * if (found) console.log(`${found.name} found again`);
   * ```
   *
   * @since 1.7.8
   */
  locate(token: string): Promise<SourceReference | null>;
  /**
   * The player forgets the token (an unknown one is ignored).
   *
   * @example Forget a file no part uses any more
   * When the last part from a file leaves the list, the plugin lets the
   * player forget the file, which frees one of its 500 references.
   * ```ts
   * declare const token: string;
   * // ---cut---
   * await plugin.media.sources.forget(token);
   * ```
   *
   * @throws `disabled` (rejects) The plugin is stopping.
   * @since 1.7.8
   */
  forget(token: string): Promise<void>;
  /**
   * Every reference this plugin holds, each with its file looked at now.
   *
   * @throws `busy` (rejects) This plugin has 4 source requests or checks
   *   running; try again when one has answered.
   *
   * @example Forget the references the list no longer uses
   * After the user cleared the list, the plugin forgets every file none of
   * its parts names. `list` gives all of the plugin's tokens, including
   * ones its own storage lost.
   * ```ts
   * declare const used: Set<string>;
   * // ---cut---
   * for (const file of await plugin.media.sources.list())
   *   if (!used.has(file.token)) await plugin.media.sources.forget(file.token);
   * ```
   *
   * @since 1.7.8
   */
  list(): Promise<SourceReference[]>;
  /**
   * Open the remembered file in the player and play it from `start`
   * seconds (default its beginning): the user's "preview this part". It
   * is an ordinary open, as {@link Player.open} of that file would be (the
   * current source is replaced; the playlist treats it as any open). The plugin names the file by its token instead of keeping
   * its path; that is a convenience, not a boundary: once the file plays,
   * `player.state.source` shows its path, as for any
   * open. Resolves once the file is loaded. A file that is gone or changed
   * is refused before anything opens.
   *
   * @throws `source-missing` (rejects) No file is at the token's path any
   *   more; offer {@link MediaSources.locate}.
   * @throws `source-changed` (rejects) The file changed since it was
   *   remembered; offer {@link MediaSources.locate}.
   * @throws `missing` (rejects) Not one of this plugin's tokens.
   * @throws `invalid` (rejects) `start` negative, or at or after the file's
   *   end.
   * @throws `replaced` (rejects) Another source replaced it before it
   *   loaded.
   * @throws `backend` (rejects) The player could not load the file.
   *
   * @example Preview a part on double-click
   * Double-clicking a row of the plugin's list plays that part's file from
   * the part's start. A file that has moved since is refused, and the row
   * then offers Locate….
   * ```ts
   * declare const part: { token: string; start: number };
   * // ---cut---
   * try {
   *   await plugin.media.sources.open(part.token, { start: part.start });
   * } catch (error) {
   *   // Moved or rewritten: the row shows "File missing · Locate…".
   *   if ((error as { code?: string }).code === "source-missing") console.log("missing");
   * }
   * ```
   *
   * @since 1.7.8
   */
  open(
    token: string,
    options?: {
      /** Seconds of the file to start at; default 0. */
      start?: number;
    },
  ): Promise<void>;
}

/**
 * One part of an export of remembered files: a range of one file, in its
 * own seconds.
 *
 * @since 1.7.8
 * @category Media
 */
export interface ExportPart {
  /**
   * The file's token ({@link SourceReference.token}), from
   * {@link MediaSources.remember}: a token, not a path.
   */
  source: string;
  /** Start, seconds of the file. */
  start: number;
  /** End, seconds of the file; after `start`. */
  end: number;
}

/**
 * Options of {@link MediaCapture.export}: the parts in order (1 to 100),
 * where to write the file (never over an existing one) and the format, as
 * for a clip of a snapshot ({@link ExportOptions}).
 *
 * The fields are a snapshot clip's: `destination`, `format` (`copy` or
 * `mp4`), `container` and `encoding` mean the same there, so moving an
 * export from a snapshot to parts changes only its input (`parts` instead
 * of the snapshot and `end`).
 *
 * @since 1.7.8
 * @category Media
 */
export type PartsExportOptions = {
  /** The parts, in the order they are written. */
  parts: ExportPart[];
  /** Absolute path of the new file. */
  destination: string;
} & (
  | {
      /**
       * Copy every part as it is (lossless, about as fast as the disk);
       * each part starts on the keyframe at or before its start.
       */
      format: "copy";
      /**
       * `auto` (default): MP4 when the codecs fit it, otherwise MKV (the
       * extension of `destination` follows). `mp4` fails `unsupported`
       * when they do not.
       */
      container?: "auto" | "mp4" | "mkv";
    }
  | {
      /** Re-encode every part to the first part's size and frame rate. */
      format: "mp4";
      /** The encoder settings, as for a clip. */
      encoding?: ExportEncoding;
    }
);

/**
 * The answer of {@link MediaCapture.exportCheck}.
 *
 * - `blocking`: problems that stop any export of the parts, each with its part (from 0)
 *   and `problem`: `unknown` (not this plugin's token), `missing`,
 *   `changed`, `noVideo` or `range` (outside the file; `duration` is the
 *   file's, or shorter than one frame).
 * - `copy`: `{ ok: true, container }` when a stream copy can write the
 *   parts, else `{ ok: false, reasons }`: each difference of a part from
 *   the first, `field` being `videoCodec`, `videoParams` (profile or codec
 *   data), `size` (`"1920×818"`), `fps`, `pixelFormat`, `audio` or `effects` (a processed snapshot)
 *   (`"aac 44100 Hz 1 ch"`, `"none"`), with the part's `value` and the
 *   first part's (`expected`).
 * - `encode`: what a re-encode writes: the first part's size and frame
 *   rate (under the encoding's ceilings) and 48 kHz stereo audio when any
 *   part has sound (`null` audio otherwise); `null` when the first part
 *   has no video.
 * - `duration`: the parts' total length in seconds.
 *
 * @since 1.7.8
 * @category Media
 */
export type ExportCheck = WireExportCheck;
