/** Subtitle wire types; source pixels and renderer confirmation remain distinct. */
import type { TextJson } from "./i18n.ts";
import type { Transport } from "./wire.ts";
export type SubtitleTrack =
  | { kind: "embedded"; id: number }
  | {
      kind: "external";
      owner: number;
      resourceId: string;
      contentRevision: number;
    };
export type SubtitleStamp = {
  generation: number;
  revision: number;
};
/**
 * A subtitle style layer ({@link Subtitles.setStyle}). Sizes are at the
 * 1080p reference height and scale with the video. Each plugin has one
 * layer; when several plugins set one, the effective style is the layer of
 * the plugin whose manifest id sorts last (the order of the calls does not
 * matter). It also applies to the secondary subtitle.
 *
 * @example Show large yellow subtitles a quarter second earlier
 * Subtitles turn yellow at size 44 on a 60 % opaque box, 6 % above the
 * bottom of the video, and appear 250 ms earlier. `refresh` reads the
 * subtitle state from the player, whose `fonts` lists the font ids a style
 * may name; `setStyle` then sends this plugin's style layer
 * (`subtitles.control`, `subtitles.read`). It shows unless another plugin
 * with a manifest id that sorts later has a layer too: the player picks the
 * effective layer by manifest id, not by which call came last.
 * ```ts
 * const { fonts } = await plugin.subtitles.refresh();
 * if (!fonts.length) return; // no font to name: leave the style alone
 * const style: SubtitleStyle = {
 *   fontId: fonts[0]!.id, // a font the player offers
 *   fontSize: 44, // at the 1080p reference height; scales with the video
 *   color: "yellow",
 *   outline: 2,
 *   marginPercent: 6, // bottom margin, % of the video height
 *   offsetMs: -250, // negative: shown earlier
 *   box: 60, // background box opacity
 * };
 * await plugin.subtitles.setStyle(style);
 * ```
 */
export type SubtitleStyle = {
  /** A font id from {@link SubtitlesState.fonts}. */
  fontId: string;
  /** 16–72. */
  fontSize: number;
  /** Text colour. */
  color: "white" | "yellow" | "cyan";
  /** Outline width 0–4. */
  outline: number;
  /** Bottom margin 2–15 % of the video height. */
  marginPercent: number;
  /**
   * Timing offset in milliseconds, −600000…600000 (±10 minutes); positive
   * shows the subtitles later. Outside the range the player refuses the
   * style with `invalid`.
   */
  offsetMs: number;
  /** Bold text; default false. */
  bold?: boolean;
  /** Shadow offset 0–4 at the 1080p reference height. */
  shadow?: number;
  /** Background box opacity 0–100; `null` or omitted: no box (the shadow applies). */
  box?: number | null;
  /** `keep` (default): ASS scripts keep their own styling; `force`: this style replaces it. */
  assOverride?: "keep" | "force";
  /** Where the secondary subtitle sits; default `top`. */
  secondaryPosition?: "top" | "aboveMain";
};
export interface SubtitleState {
  presentation: {
    revision: number;
    referenceHeight: 1080;
    layers: {
      owner: number;
      manifestId: string;
      revision: number;
      style: SubtitleStyle;
    }[];
    effective: {
      owner: number;
      manifestId: string;
      revision: number;
      style: SubtitleStyle;
    } | null;
    confirmation: "waiting" | "applied" | "uncertain";
    fonts: {
      id: string;
      family: string;
      resolution: "fixedFace";
      snapshotEligible: true;
      digest: string;
      faceIndex: 0;
    }[];
    actualFont: {
      fontId: string;
      family: string;
      postscript: string;
      faceIndex: 0;
      digest: string;
      sizeBytes: number;
    };
    snapshotEligible: boolean;
    coverageCheckedOnCapture: true;
  };
  source: { generation: number; phase: string };
  confirmation: "waiting" | "applied" | "uncertain";
  error: string | null;
  selection: {
    stamp: SubtitleStamp;
    target: SubtitleTrack | null;
    /** The secondary subtitle (optional so older fixtures still type-check). */
    secondary?: SubtitleTrack | null;
  };
  tracks: {
    target: SubtitleTrack;
    title: string;
    language: string | null;
    styleSupported: boolean;
    styleReason: string | null;
    // Round 2; optional so older test fixtures still type-check.
    codec?: string | null;
    text?: boolean;
    streamIndex?: number | null;
  }[];
  resources: {
    owner: number;
    resourceId: string;
    revision: number;
    format: "srt" | "ass";
    digest: string;
    sizeBytes: number;
    cues: number;
    derived: { format: "webvtt" | "ass"; digest: string };
  }[];
}
export interface SubtitleUpload {
  generation: number;
  expectedBytes: number;
  receivedBytes: number;
  complete: boolean;
}
export function subtitleClient(transport: Transport) {
  return {
    operation: (operationId: number) =>
      transport.request<
        | { status: "pending" | "unknown" | "unknownExpired" }
        | { status: "completed"; result: SubtitleState }
        | { status: "failed"; error: { code: string; message: string } }
      >("subtitles.operation", { operationId }),
    state: () => transport.request<SubtitleState>("subtitles.state"),
    /** Property application is not a visible-frame or exact-font identity fence. */
    style: (options: {
      operationId: number;
      revision: number;
      expected: SubtitleStamp;
      style: SubtitleStyle | null;
    }) => transport.request<SubtitleState>("subtitles.style", options),
    begin: (uploadId: number, generation: number, expectedBytes: number) =>
      transport.request<SubtitleUpload>("subtitles.upload.begin", {
        uploadId,
        generation,
        expectedBytes,
      }),
    append: (uploadId: number, offset: number, base64: string) =>
      transport.request<SubtitleUpload>("subtitles.upload.append", {
        uploadId,
        offset,
        base64,
      }),
    discard: (uploadId: number) =>
      transport.request<void>("subtitles.upload.discard", { uploadId }),
    /** Atomic registration plus selection. inputOrigin guards a translation's original content revision. */
    commit: (options: {
      operationId: number;
      uploadId: number;
      sha256: string;
      resourceId: string;
      revision: number;
      expected: SubtitleStamp;
      inputOrigin?: SubtitleTrack;
      format?: "srt" | "ass";
      /** Source text is data; a text value is shown translated (player 0.4.3). */
      title?: string | TextJson;
      select?: "primary" | "secondary" | "none";
    }) => transport.request<SubtitleState>("subtitles.commit", options),
    select: (
      target: SubtitleTrack | null,
      expected: SubtitleStamp,
      operationId: number,
      role: "primary" | "secondary" = "primary",
    ) =>
      transport.request<SubtitleState>("subtitles.select", {
        target,
        expected,
        operationId,
        // The default is left out: the request stays what older hosts accept.
        ...(role === "secondary" ? { role } : {}),
      }),
    remove: (
      resourceId: string,
      expected: SubtitleStamp,
      operationId: number,
    ) =>
      transport.request<SubtitleState>("subtitles.remove", {
        resourceId,
        expected,
        operationId,
      }),
  };
}
