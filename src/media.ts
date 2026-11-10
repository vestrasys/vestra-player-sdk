/** Finite media jobs. Native-subtitle freezing remains pending. */
import type { Transport } from "./wire.ts";
import type {
  SourceStamp,
  SourceAudioTrack,
  SourceOperation,
} from "./source.ts";
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
    /** A stream copy: what was copied and from where. */
    copy?: {
      container: "mp4" | "mkv";
      videoCodec: string;
      audioCodec: string | null;
      /** The keyframe the copy starts on, source seconds. */
      keyframe: number;
      /** FFmpeg's input seek, the keyframe rounded down to a microsecond. */
      seek: number;
      written: { start: number; end: number };
    };
    /** An export of parts (`jobs.start { parts }`): how it was written. */
    join?: {
      mode: "copy" | "mp4";
      container: "mp4" | "mkv";
      /** Each part as written, in seconds of its own file. */
      parts: { start: number; end: number }[];
      /** A re-encode: the output size and frame rate. */
      target: { width: number; height: number; fps: number } | null;
    };
  };
  outcome:
    | null
    | {
        destination: string;
        /** Clips: first frame, source seconds. */
        start?: number;
        /** Clips: end of the last frame, source seconds. */
        end?: number;
      }
    | { error: { code: string; message: string } }
    | { cancelled: true };
  /**
   * Seconds of a clip written and to write while FFmpeg runs; `null` while
   * unknown.
   */
  progress?: {
    done: number;
    total: number;
    /** An export of parts: the part being written, from 1. */
    part?: number;
    /** An export of parts: how many parts. */
    parts?: number;
  } | null;
};
/** The wire form of `ExportEncoding` (`jobs.start`). */
export type WireEncoding = {
  crf?: number;
  speed?: "faster" | "balanced" | "smaller";
  maxHeight?: 1080 | 720 | 480;
  fps?: 60 | 30;
  audioBitrate?: 128 | 192 | 256;
  threads?: "single" | "auto";
  videoBitrate?: "source";
};
/** A source reference as the player describes it (`media.sources.*`). */
export type WireSourceReference = {
  token: string;
  name: string;
  duration: number;
  status: "ok" | "missing" | "changed";
  video: {
    codec: string;
    width: number;
    height: number;
    fps: number;
    pixelFormat: string | null;
  } | null;
  audio: { codec: string; sampleRate: number; channels: number } | null;
};
/** One part of an export (`jobs.start { parts }`, `jobs.check`). */
export type WireExportPart = { source: string; start: number; end: number };
/** The answer of `jobs.check`. */
export type WireExportCheck = {
  blocking: {
    part: number;
    problem: "unknown" | "missing" | "changed" | "noVideo" | "range";
    /** `range`: the file's duration. */
    duration?: number;
  }[];
  copy:
    | { ok: true; container: "mp4" | "mkv" }
    | {
        ok: false;
        reasons: {
          part: number;
          field:
            | "videoCodec"
            | "videoParams"
            | "size"
            | "fps"
            | "pixelFormat"
            | "audio"
            | "effects";
          value: string | number | null;
          expected: string | number | null;
        }[];
      };
  encode: {
    width: number;
    height: number;
    fps: number;
    audio: { sampleRate: 48000; channels: 2 } | null;
  } | null;
  duration: number;
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
          | {
              kind: "rawPng" | "processedPng" | "rawBmp" | "processedBmp";
              sampleTime?: number;
            }
          | {
              kind: "rawJpeg" | "processedJpeg";
              sampleTime?: number;
              /** 1–100, default 90. */
              quality?: number;
            }
          | {
              kind: "rawMp4" | "processedMp4";
              end: number;
              /** The encoder settings used. */
              encoding?: WireEncoding;
            }
          | {
              /** Stream copy. */
              kind: "rawCopy";
              end: number;
              container?: "auto" | "mp4" | "mkv";
            }
        ),
      ) =>
        transport.request<{
          jobId: number;
          status: "queued";
          snapshotId: number;
        }>("jobs.start", options),
      state: (jobId: number) =>
        transport.request<MediaJob>("jobs.state", { jobId }),
      cancel: (jobId: number, operationId: number) =>
        transport.request<{
          jobId: number;
          cancel: "requested" | "tooLate" | "terminal";
        }>("jobs.cancel", { jobId, operationId }),
      operation: (operationId: number) =>
        transport.request<MediaOperation>("jobs.operation", { operationId }),
      /** `jobs.start` with parts of remembered files instead of a snapshot. */
      startParts: (
        options: {
          operationId: number;
          parts: WireExportPart[];
          destination: string;
        } & (
          | { kind: "rawCopy"; container?: "auto" | "mp4" | "mkv" }
          | { kind: "rawMp4"; encoding?: WireEncoding }
        ),
      ) =>
        transport.request<{ jobId: number; status: "queued" }>(
          "jobs.start",
          options,
        ),
      check: (parts: WireExportPart[], encoding?: WireEncoding) =>
        transport.request<WireExportCheck>(
          "jobs.check",
          encoding === undefined ? { parts } : { parts, encoding },
        ),
      /** `jobs.check` of a snapshot's clip (to `end`) instead of parts. */
      checkSnapshot: (
        snapshotId: number,
        end: number,
        encoding?: WireEncoding,
      ) =>
        transport.request<WireExportCheck>(
          "jobs.check",
          encoding === undefined
            ? { snapshotId, end }
            : { snapshotId, end, encoding },
        ),
    },
    mediaSources: {
      remember: (expected?: SourceStamp) =>
        transport.request<WireSourceReference>(
          "media.sources.remember",
          expected === undefined ? {} : { expected },
        ),
      get: (token: string) =>
        transport.request<WireSourceReference>("media.sources.get", {
          token,
        }),
      locate: (token: string) =>
        transport.request<WireSourceReference | null>("media.sources.locate", {
          token,
        }),
      forget: (token: string) =>
        transport.request<void>("media.sources.forget", { token }),
      list: () =>
        transport.request<WireSourceReference[]>("media.sources.list", {}),
      /** An `open` submit of the file, under the player service's operation id. */
      open: (options: { token: string; operationId: number; start?: number }) =>
        transport.request<SourceOperation>("media.sources.open", options),
    },
  };
}
