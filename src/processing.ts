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
  | { kind: "gblur"; sigma: number; steps: 3 }
  /** Hue rotation; changes in place while playing. */
  | { kind: "hue"; degrees: number }
  /** unsharp: 3×3 (`small`) or 7×7 (`large`) luma matrix. */
  | { kind: "sharpen"; amount: number; size: "small" | "large" }
  /** hqdn3d strengths. */
  | {
      kind: "denoise";
      lumaSpatial: number;
      chromaSpatial: number;
      lumaTemporal: number;
      chromaTemporal: number;
    }
  | { kind: "deblock"; strength: "weak" | "strong" }
  | { kind: "deband"; threshold: number; range: number }
  /** Applied after the player's own source orientation. */
  | {
      kind: "transform";
      rotate: 0 | 90 | 180 | 270;
      flipH: boolean;
      flipV: boolean;
    }
  /** BWDIF; `field` doubles the frame rate. */
  | {
      kind: "deinterlace";
      when: "interlaced" | "all";
      output: "frame" | "field";
    }
  /** Crop to / pad to a display aspect; x, y place it (−1 left/top … 1 right/bottom). */
  | {
      kind: "reframe";
      mode: "crop" | "pad";
      aspect: number;
      x: number;
      y: number;
    };
export type AudioNode =
  | { kind: "volume"; gainDb: number }
  | { kind: "equalizer"; frequency: number; q: 1; gainDb: number }
  | { kind: "treble"; frequency: 3000; slope: 0.5; gainDb: number }
  | { kind: "dynaudnorm"; enabled: boolean; maxGain: number; peak: number }
  /** Routing on a stereo mix (more channels are mixed down first). */
  | { kind: "channels"; mode: "stereo" | "left" | "right" | "mono" | "swap" };

type Rule = Record<
  string,
  [number, number] | readonly (string | number | boolean)[]
>;
const BOOL = [true, false] as const;
/** Value ranges, the same as the host's `effects.rs` (the host is authoritative). */
const RULES: Record<string, Rule> = {
  eq: {
    brightness: [-1, 1],
    contrast: [0, 2],
    saturation: [0, 2],
    gamma: [0.5, 2],
  },
  gblur: { sigma: [0, 10], steps: [3] },
  hue: { degrees: [-180, 180] },
  sharpen: { amount: [0, 2], size: ["small", "large"] },
  denoise: {
    lumaSpatial: [0, 20],
    chromaSpatial: [0, 20],
    lumaTemporal: [0, 20],
    chromaTemporal: [0, 20],
  },
  deblock: { strength: ["weak", "strong"] },
  deband: { threshold: [0.003, 0.5], range: [1, 64] },
  transform: { rotate: [0, 90, 180, 270], flipH: BOOL, flipV: BOOL },
  deinterlace: { when: ["interlaced", "all"], output: ["frame", "field"] },
  reframe: { mode: ["crop", "pad"], aspect: [0.25, 4], x: [-1, 1], y: [-1, 1] },
  volume: { gainDb: [-60, 0] },
  equalizer: { frequency: [20, 20000], q: [1], gainDb: [-6, 6] },
  treble: { frequency: [3000], slope: [0.5], gainDb: [0, 6] },
  dynaudnorm: { enabled: BOOL, maxGain: [1, 4], peak: [0.5, 0.95] },
  channels: { mode: ["stereo", "left", "right", "mono", "swap"] },
};
const VIDEO = new Set([
  "eq",
  "gblur",
  "hue",
  "sharpen",
  "denoise",
  "deblock",
  "deband",
  "transform",
  "deinterlace",
  "reframe",
]);

/**
 * Why `nodes` would be refused (`null` when valid): unknown kinds or fields,
 * values out of range, more than 64 nodes. Used by the test host.
 */
export function nodeProblem(
  stage: "video" | "audio",
  nodes: readonly { kind: string }[],
): string | null {
  if (nodes.length > 64) return "chain limit: 64 nodes";
  for (const node of nodes) {
    const rule = RULES[node.kind];
    if (!rule || VIDEO.has(node.kind) !== (stage === "video"))
      return `unknown ${stage} node ${node.kind}`;
    const fields = Object.keys(node).filter((key) => key !== "kind");
    for (const field of fields)
      if (!(field in rule)) return `${node.kind}: unknown field ${field}`;
    for (const [field, allowed] of Object.entries(rule)) {
      const value = (node as Record<string, unknown>)[field];
      const ok =
        allowed.length === 2 &&
        typeof allowed[0] === "number" &&
        typeof allowed[1] === "number" &&
        typeof value === "number"
          ? Number.isFinite(value) && value >= allowed[0] && value <= allowed[1]
          : allowed.includes(value as never);
      if (!ok) return `${node.kind}.${field} out of range`;
    }
    if (
      node.kind === "deband" &&
      !Number.isInteger((node as unknown as { range: number }).range)
    )
      return "deband.range must be an integer";
  }
  return null;
}
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
