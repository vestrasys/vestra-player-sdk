/** Stage D candidate. Applied is backend acceptance, not a visible-frame fence. */
import type { Transport } from "./wire.ts";
export type VideoNode =
  | {
      kind: "eq";
      brightness: number;
      contrast: number;
      saturation: number;
      gamma: number;
    }
  | { kind: "gblur"; sigma: number; steps: 3 };
export type AudioNode =
  | { kind: "volume"; gainDb: number }
  | { kind: "equalizer"; frequency: number; q: 1; gainDb: number }
  | { kind: "treble"; frequency: 3000; slope: 0.5; gainDb: number }
  | { kind: "dynaudnorm"; enabled: boolean; maxGain: number; peak: number };
export type ProcessingChange = {
  resourceId: string;
  revision: number;
  expectedGeneration: number;
} & (
  | { stage: "video"; nodes: VideoNode[] }
  | { stage: "audio"; nodes: AudioNode[]; offsetMs?: number }
);
export interface ProcessingResource<N> {
  owner: number;
  revision: number;
  resource: { manifestId: string; resourceId: string; nodes: N[] };
  /** Present on audio resources. */
  offsetMs?: number;
}
export interface ProcessingState {
  configurationRevision: number;
  /** Sum of owned offsets, excluding device volume/mute. */
  audioOffsetMs: number;
  source: {
    generation: number;
    phase: "" | "empty" | "loading" | "ready" | "ended" | "error";
    /** Actual accepted FileLoaded identity; cycle here is load cycle, not a later seek cycle. */
    load: { entry: number; generation: number; cycle: number } | null;
    stages: Partial<
      Record<
        "video" | "audio",
        { status: "waiting" | "applied" | "uncertain"; error: string | null }
      >
    >;
  };
  video: ProcessingResource<VideoNode>[];
  audio: ProcessingResource<AudioNode>[];
  /** Revocation may leave backend cleanup uncertain. Such a stage blocks updates. */
  backendUncertain: Partial<Record<"video" | "audio", string>>;
}
export interface ProcessingApplied {
  stage: "video" | "audio";
  revision: number;
  generation: number;
  status: "applied";
}
export type ProcessingToken = {
  stage: "video" | "audio";
  resourceId: string;
  revision: number;
};
export type ProcessingOperation =
  | { status: "pending" | "unknown" | "unknownExpired" }
  | { status: "completed"; result: ProcessingApplied }
  | { status: "failed"; error: { code: string; message: string } };
export function processingClient(transport: Transport) {
  return {
    state: () => transport.request<ProcessingState>("processing.state"),
    /** Token is (stage, resourceId, revision). Fix it before sending. A dynamic
     * rejection consumes this token; never change its payload on retry. */
    replace: (change: ProcessingChange) =>
      transport.request<ProcessingApplied>("processing.replace", change),
    operation: (token: ProcessingToken) =>
      transport.request<ProcessingOperation>("processing.operation", token),
  };
}
