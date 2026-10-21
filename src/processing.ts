/**
 * Processing chains for the player's video and audio filters. Applied means
 * the backend accepted the chain, not that a frame with it is visible yet.
 */
import type { Transport } from "./wire.ts";
/**
 * One node of a {@link VideoFilter} chain, by `kind`. Values outside the
 * ranges below fail with `invalid`. Fields marked "live" change in place
 * while playing; changing any other field rebuilds the stage (the picture
 * may stall for one frame), so drive sliders with live fields.
 *
 * Nodes act after the player's own orientation handling (container
 * rotation): a portrait video is upright before `transform` runs. At most
 * 64 nodes across all plugins.
 *
 * @example
 * ```ts
 * const chain: VideoNode[] = [
 *   { kind: "eq", brightness: 0.05, contrast: 1.1, saturation: 1.2, gamma: 1 },
 *   { kind: "sharpen", amount: 0.5, size: "small" },
 *   { kind: "transform", rotate: 90, flipH: false, flipV: false },
 * ];
 * plugin.video.filter("picture").set(chain);
 * ```
 */
export type VideoNode =
  /** FFmpeg `eq`; every field is live. */
  | {
      /** The node type. */
      kind: "eq";
      /** −1–1, 0 = unchanged. */
      brightness: number;
      /** 0–2, 1 = unchanged. */
      contrast: number;
      /** 0–2, 1 = unchanged. */
      saturation: number;
      /** 0.5–2, 1 = unchanged. */
      gamma: number;
    }
  /** Gaussian blur (FFmpeg `gblur`). */
  | {
      /** The node type. */
      kind: "gblur";
      /** 0–10 (live). */
      sigma: number;
      /** Always 3. */
      steps: 3;
    }
  /** Hue rotation; changes in place while playing. */
  | {
      /** The node type. */
      kind: "hue";
      /** −180–180 (live). */
      degrees: number;
    }
  /** unsharp: 3×3 (`small`) or 7×7 (`large`) luma matrix. */
  | {
      /** The node type. */
      kind: "sharpen";
      /** 0–2. */
      amount: number;
      /** Matrix size. */
      size: "small" | "large";
    }
  /** hqdn3d strengths. */
  | {
      /** The node type. */
      kind: "denoise";
      /** 0–20 (0 = off). */
      lumaSpatial: number;
      /** 0–20 (0 = off). */
      chromaSpatial: number;
      /** 0–20 (0 = off). */
      lumaTemporal: number;
      /** 0–20 (0 = off). */
      chromaTemporal: number;
    }
  /** FFmpeg `deblock`. */
  | {
      /** The node type. */
      kind: "deblock";
      /** Filter strength. */
      strength: "weak" | "strong";
    }
  /** FFmpeg `deband`. */
  | {
      /** The node type. */
      kind: "deband";
      /** 0.003–0.5, the same for all four planes. */
      threshold: number;
      /** Integer 1–64. */
      range: number;
    }
  /** Applied after the player's own source orientation. */
  | {
      /** The node type. */
      kind: "transform";
      /** Clockwise degrees; applied before the flips. */
      rotate: 0 | 90 | 180 | 270;
      /** Mirror horizontally. */
      flipH: boolean;
      /** Mirror vertically. */
      flipV: boolean;
    }
  /** BWDIF; `field` doubles the frame rate. */
  | {
      /** The node type. */
      kind: "deinterlace";
      /** `interlaced`: only frames flagged interlaced; `all`: every frame. */
      when: "interlaced" | "all";
      /** One frame per frame, or one per field (double rate). */
      output: "frame" | "field";
    }
  /** Crop to / pad to a display aspect; x, y place it (−1 left/top … 1 right/bottom). */
  | {
      /** The node type. */
      kind: "reframe";
      /** Crop the picture, or pad it with black bars. */
      mode: "crop" | "pad";
      /** Target display aspect 0.25–4. */
      aspect: number;
      /** −1 (left) … 0 (centre) … 1 (right). */
      x: number;
      /** −1 (top) … 0 (centre) … 1 (bottom). */
      y: number;
    }
  /**
   * Blended frame-rate conversion (FFmpeg `framerate`), an integer 24–120.
   * At most one across all plugins; the player runs it after every chain.
   */
  | {
      /** The node type. */
      kind: "frameBlend";
      /** Output frame rate, integer 24–120. */
      fps: number;
    };
/**
 * One node of an {@link AudioFilter} chain, by `kind`. Values outside the
 * ranges fail with `invalid`; "live" fields change in place while playing.
 *
 * @example
 * ```ts
 * plugin.audio.filter("sound").set({
 *   nodes: [
 *     { kind: "equalizer", frequency: 1000, q: 1, gainDb: 3 },
 *     { kind: "channels", mode: "mono" },
 *   ],
 * });
 * ```
 */
export type AudioNode =
  /** FFmpeg `volume`. */
  | {
      /** The node type. */
      kind: "volume";
      /** −60–0 dB (live). */
      gainDb: number;
    }
  /** One peaking equalizer band (FFmpeg `equalizer`). */
  | {
      /** The node type. */
      kind: "equalizer";
      /** Centre frequency 20–20000 Hz. */
      frequency: number;
      /** Always 1. */
      q: 1;
      /** −6–6 dB (live). */
      gainDb: number;
    }
  /** Treble shelf (FFmpeg `treble`). */
  | {
      /** The node type. */
      kind: "treble";
      /** Always 3000 Hz. */
      frequency: 3000;
      /** Always 0.5. */
      slope: 0.5;
      /** 0–6 dB (live). */
      gainDb: number;
    }
  /** Dynamic loudness normalization (FFmpeg `dynaudnorm`); every field is live. */
  | {
      /** The node type. */
      kind: "dynaudnorm";
      /** On or off. */
      enabled: boolean;
      /** Maximum gain 1–4. */
      maxGain: number;
      /** Target peak 0.5–0.95. */
      peak: number;
    }
  /** Routing on a stereo mix (more channels are mixed down first). */
  | {
      /** The node type. */
      kind: "channels";
      /** `stereo` leaves it unchanged. */
      mode: "stereo" | "left" | "right" | "mono" | "swap";
    };

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
  frameBlend: { fps: [24, 120] },
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
  "frameBlend",
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
    if (
      node.kind === "frameBlend" &&
      !Number.isInteger((node as unknown as { fps: number }).fps)
    )
      return "frameBlend.fps must be an integer";
  }
  if (nodes.filter((node) => node.kind === "frameBlend").length > 1)
    return "only one frameBlend node across all plugins";
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
