// Subtitles category: subtitle tracks and the subtitles module.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { SubtitleStyle } from "../../subtitles.ts";
import type { Disposable } from "./base.ts";
import type { Text } from "./ui-locale.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { PlayerState } from "./playback.ts";
/* oxlint-enable no-unused-vars */

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
 * `plugin.subtitles`: tracks, uploads and style. Changes read the current
 * selection first.
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
 * or the backend changes and after this plugin's own
 * changes, so a selection the user or another plugin changed shows only
 * after `refresh()`. A change without `ifCurrent` reads the state first
 * and applies to it; pass `ifCurrent` to make it fail with `stale` when the
 * selection changed since that state. Each change is one operation the
 * player confirms; `select`, `remove` and `setStyle` resolve with the new
 * state, `load` with the new track.
 *
 * @capability None.
 *
 * @see [Load subtitles from a plugin](../../../docs/guides/subtitles.md)
 * @since 1.0.0
 * @category Subtitles
 */
export interface Subtitles {
  /** `null` until first read. */
  readonly state: SubtitlesState | null;
  /**
   * The subtitle state changed.
   *
   * @capability None.
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
   * @capability None.
   * @throws `disabled` (rejects) The plugin is stopping.
   *
   * @example Count the subtitle tracks of the file
   * The plugin reads how many subtitle tracks the file has before building a
   * menu. `refresh` asks the player and resolves with the current state;
   * `state` holds it afterwards.
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
   * @capability None.
   * @throws `stale` (rejects) With `ifCurrent`: the source or the subtitle
   *   selection changed since that state.
   * @throws `invalid` (rejects) An unknown track; as secondary, a bitmap
   *   track or the primary one; as primary, the current secondary.
   * @throws `missing` (rejects) The track is not in the current source.
   * @throws `unavailable` (rejects) Nothing loaded, or the source is still
   *   loading or not yet confirmed.
   * @throws `busy` (rejects) Too many subtitle operations at once.
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
   * Upload a subtitle file's bytes (UTF-8 SRT, or ASS/SSA with `format: "ass"`)
   * for the current source; select it unless `select: "none"`. `title` (1–200
   * characters) names the track: data, or a {@link Text} the player translates
   * (`text("{} · {}", [text("Simplified Chinese"), file])`). Aborting `signal`
   * before the commit discards the upload (rejects with AbortError); once the
   * commit was sent it completes.
   *
   * Limits: SRT ≤ 2 MiB and ≤ 10,000 cues; ASS ≤ 2 MiB with `[Script Info]`
   * and `[Events]` and 1–20,000 `Dialogue:` lines. Convert other formats
   * (VTT, SAMI) to SRT first. Per source, a plugin has at most 4 loaded
   * tracks at once and loads at most 16 files (removed ones count), and
   * every plugin together at most 16 tracks; see `SUBTITLE_LIMITS` in
   * `@vestra-player/sdk/testing`.
   *
   * @capability None.
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
   * @capability None.
   * @throws `invalid` (rejects) The track was not loaded by this plugin.
   * @throws `stale` (rejects) With `ifCurrent`: the source changed since
   *   that state.
   * @throws `unavailable` (rejects) Nothing is loaded, or the source is
   *   still loading.
   * @throws `busy` (rejects) Too many subtitle operations at once.
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
   * @capability None.
   * @throws `invalid` (rejects) A field out of range.
   * @throws `unsupported` (rejects) A font that is not in `state.fonts`, or a
   *   primary subtitle that is a bitmap track.
   * @throws `stale` (rejects) With `ifCurrent`: the subtitle state changed
   *   since that state.
   * @throws `unavailable` (rejects) Nothing is loaded, or the source is
   *   still loading.
   * @throws `busy` (rejects) Too many subtitle operations at once.
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
