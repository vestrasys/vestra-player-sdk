/** Experimental finite media jobs. Native-subtitle freezing remains pending. */
import type { Transport } from "./wire.ts";
import type { SourceStamp, SourceAudioTrack } from "./source.ts";
import type { VideoNode, AudioNode } from "./processing.ts";
import type {
  SubtitleStamp,
  SubtitleStyle,
  SubtitleTrack,
} from "./subtitles.ts";
export type RawSnapshot = {
  snapshotId: number;
  kind: "raw";
  sourceStamp: SourceStamp;
  time: number;
  source: string;
  container: string;
  sizeBytes: number;
  timeline: {
    domain: "mpv-media";
    validation: "pending-worker-origin-match";
    containerStartTime: number;
  };
  /** Backend metadata estimate; sample availability and clip video coverage are validated by worker. */
  duration: number;
  videoStreamIndex: number;
  audio: SourceAudioTrack | null;
  includeSubtitles: boolean;
  preroll: "source-zero-to-start" | null;
};
export type ProcessedSnapshot = Omit<RawSnapshot, "kind"> & {
  kind: "processed";
  processing: {
    revision: number;
    audioOffsetMs: number;
    video: { manifestId: string; resourceId: string; nodes: VideoNode[] }[];
    audio: { manifestId: string; resourceId: string; nodes: AudioNode[] }[];
  };
  subtitle:
    | null
    | ({
        selectionStamp: SubtitleStamp;
        presentationRevision: number;
        track: SubtitleTrack;
        style: SubtitleStyle;
        font: {
          fontId: string;
          family: string;
          postscript: string;
          faceIndex: number;
          digest: string;
          sizeBytes: number;
        };
      } & (
        | {
            kind: "external";
            canonical: { format: "srt"; digest: string };
            derived: { format: "webvtt"; digest: string };
            coverageValidated: true;
          }
        | {
            kind: "native";
            native: {
              trackId: number;
              streamIndex: number;
              codec: "subrip" | "srt";
              timeline: "pending-file-origin-validation";
            };
            coverageValidated: false;
          }
      ));
  presentation: { width: number; height: number };
  /** Frozen confirmed owned offset. PNG itself contains no audio. */
  audioOffsetMs: number;
};
export type Snapshot = RawSnapshot | ProcessedSnapshot;
export type AudioChoice =
  { kind: "selected" } | { kind: "none" } | { kind: "track"; trackId: number };
export type RawCapture = {
  operationId: number;
  expected: SourceStamp;
  time?: number;
  mode?: "raw";
  audio?: AudioChoice;
};
export type ProcessedCapture = {
  operationId: number;
  expected: SourceStamp;
  time?: number;
  mode: "processed";
  expectedProcessingRevision: number;
  audio?: AudioChoice;
} & (
  | {
      includeSubtitles?: true;
      expectedSubtitle: {
        selection: SubtitleStamp;
        presentationRevision: number;
      };
    }
  | {
      includeSubtitles: false;
      expectedSubtitle?: {
        selection: SubtitleStamp;
        presentationRevision: number;
      };
    }
);
export type MediaJob = {
  jobId: number;
  status:
    "queued" | "running" | "cancelling" | "completed" | "failed" | "cancelled";
  publicationStarted: boolean;
  facts: null | {
    descriptorVersion: string;
    ffmpegVersion: string;
    libavfilterVersion: string;
    videoStreamIndex: number;
    range: { start: number; end: number | null; interval: string };
    preroll: string | null;
    hasAudio: boolean;
    audioTiming: string;
    processed: boolean;
    sourceTimeline?: {
      domain: "mpv-media";
      validation: "normalized-origin-matched" | "unsupported-file-origin";
      containerStartTime: number | null;
      expectedContainerStartTime: number;
    };
    nativeSubtitle?: {
      codec: "subrip" | "srt";
      streamIndex: number;
      canonical: { format: "srt"; digest: string };
      derived: { format: "webvtt"; digest: string };
      cueCount: number;
      coverageValidated: true;
    };
    output?: { streams: unknown[]; format: { duration: string } };
  };
  outcome:
    | null
    | { destination: string }
    | { error: { code: string; message: string } }
    | { cancelled: true };
};
export type MediaOperation =
  | { status: "pending" | "unknown" | "unknownExpired" }
  | { status: "completed"; result: unknown }
  | { status: "failed"; error: { code: string; message: string } };
export function mediaClients(transport: Transport) {
  function capture(options: RawCapture): Promise<RawSnapshot>;
  function capture(options: ProcessedCapture): Promise<ProcessedSnapshot>;
  function capture(options: RawCapture | ProcessedCapture): Promise<Snapshot>;
  function capture(options: RawCapture | ProcessedCapture): Promise<Snapshot> {
    return transport.request<Snapshot>("snapshot.capture", options);
  }
  return {
    snapshot: {
      capture,
      state: (snapshotId: number) =>
        transport.request<Snapshot>("snapshot.state", { snapshotId }),
      release: (snapshotId: number, operationId: number) =>
        transport.request<void>("snapshot.release", {
          snapshotId,
          operationId,
        }),
    },
    jobs: {
      start: (
        options: {
          operationId: number;
          snapshotId: number;
          destination: string;
        } & (
          | { kind: "rawPng" | "processedPng"; sampleTime?: number }
          | { kind: "rawMp4" | "processedMp4"; end: number }
        ),
      ) =>
        transport.request<{
          jobId: number;
          status: "queued";
          snapshotId: number;
        }>("jobs.start", options),
      state: (jobId: number) =>
        transport.request<MediaJob>("jobs.state", { jobId }),
      list: () => transport.request<MediaJob[]>("jobs.list"),
      cancel: (jobId: number, operationId: number) =>
        transport.request<{
          jobId: number;
          cancel: "requested" | "tooLate" | "terminal";
        }>("jobs.cancel", { jobId, operationId }),
      operation: (operationId: number) =>
        transport.request<MediaOperation>("jobs.operation", { operationId }),
    },
  };
}
