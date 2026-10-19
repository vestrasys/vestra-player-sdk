/** Stage D candidate; source pixels and renderer confirmation remain distinct. */
import type { Transport } from "./index.ts";
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
export type SubtitleStyle = {
  fontId: string;
  fontSize: number;
  color: "white" | "yellow" | "cyan";
  outline: number;
  marginPercent: number;
  offsetMs: number;
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
  selection: { stamp: SubtitleStamp; target: SubtitleTrack | null };
  tracks: {
    target: SubtitleTrack;
    title: string;
    language: string | null;
    styleSupported: boolean;
    styleReason: string | null;
  }[];
  resources: {
    owner: number;
    resourceId: string;
    revision: number;
    format: "srt";
    digest: string;
    sizeBytes: number;
    cues: number;
    derived: { format: "webvtt"; digest: string };
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
    uploadState: (uploadId: number) =>
      transport.request<SubtitleUpload>("subtitles.upload.status", {
        uploadId,
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
    }) => transport.request<SubtitleState>("subtitles.commit", options),
    select: (
      target: SubtitleTrack | null,
      expected: SubtitleStamp,
      operationId: number,
    ) =>
      transport.request<SubtitleState>("subtitles.select", {
        target,
        expected,
        operationId,
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
