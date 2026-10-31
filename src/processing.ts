/**
 * Processing chains for the player's video and audio filters. Applied means
 * the backend accepted the chain, not that a frame with it is visible yet.
 */
import { isAbsolute } from "node:path";
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
 * @example Brighten, sharpen and rotate the picture
 * The video plays a little brighter and more saturated, slightly sharper
 * and turned a quarter clockwise. The nodes run in array order; `set` sends
 * the whole chain as this plugin's desired value (last write wins), and the
 * player applies it to every source until it changes, needing
 * `processing.video`, `playback.read` and `events`.
 * ```ts
 * const chain: VideoNode[] = [
 *   // Live fields: moving them later changes the picture in place.
 *   { kind: "eq", brightness: 0.05, contrast: 1.1, saturation: 1.2, gamma: 1 },
 *   // Not live: changing `amount` later rebuilds the stage (a one-frame stall).
 *   { kind: "sharpen", amount: 0.5, size: "small" },
 *   { kind: "transform", rotate: 90, flipH: false, flipV: false },
 * ];
 * plugin.video.filter("picture").set(chain);
 * ```
 *
 * @since 1.0.0
 * @category Processing
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
  /**
   * Deinterlacing. `interlaced` and `all` are FFmpeg BWDIF in the chain;
   * `field` doubles the frame rate.
   *
   * `when: "auto"` (player 0.5.4) is the player's own deinterlacer instead:
   * decided per frame from the decoder's interlaced flag, with the decoder's
   * hardware deinterlacer where frames stay on the GPU; progressive frames
   * pass untouched. It needs no frames in memory, so a chain with only this
   * node keeps zero-copy hardware decoding (any other node still needs a
   * copy back to memory). It always outputs one frame per field, so it
   * takes `output: "field"` only (`"frame"` fails with `invalid`). It runs
   * before every plugin's chain wherever it is written, and is shared: on
   * while any plugin's chain has one. A chain with it has no other
   * `deinterlace` node. Snapshots and exports deinterlace the same frames
   * with BWDIF at field rate. Players before 0.5.4 refuse `auto` with
   * `invalid`.
   */
  | {
      /** The node type. */
      kind: "deinterlace";
      /**
       * `interlaced`: only frames flagged interlaced; `all`: every frame;
       * `auto`: the player's deinterlacer, on frames flagged interlaced.
       */
      when: "interlaced" | "all" | "auto";
      /**
       * One frame per frame, or one per field (double rate); `when: "auto"`
       * takes `field` only.
       */
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
    }
  /**
   * A convolution matrix of your own per plane (FFmpeg `convolution`, SDK
   * 1.5.39, player 0.5.20): sharpen, blur, emboss or detect edges with a
   * 3×3, 5×5 or 7×7 kernel, or a row or column kernel. `planes[i]` is
   * plane `i` of the decoded picture: for the usual YUV video 0 is luma
   * (brightness), 1 and 2 are the colour planes, 3 is alpha. A missing
   * entry or `null` leaves that plane as it is; at least one entry has a
   * matrix. Players before 0.5.20 refuse the kind with `invalid`.
   */
  | {
      /** The node type. */
      kind: "convolution";
      /** 1–4 entries, by plane; `null` passes the plane through. */
      planes: (ConvolutionPlane | null)[];
    }
  /**
   * Recolour the picture with a 3D look-up table (FFmpeg `lut3d`, SDK
   * 1.5.39, player 0.5.20): a `.cube` file the plugin ships in its package
   * or wrote to its {@link Plugin.dataDirectory}. The player reads the file
   * when the chain is set (and again for each new source, snapshot or
   * export), so it must stay there while the chain uses it. The table is
   * applied to RGB; the player converts the picture to RGB and back.
   * Players before 0.5.20 refuse the kind with `invalid`.
   */
  | {
      /** The node type. */
      kind: "lut3d";
      /**
       * Absolute path of a `.cube` file (`LUT_3D_SIZE` 2–65, at most
       * 16 MiB) inside the plugin's package directory or data directory
       * after following links; a path with `[` or `]` is refused. Outside
       * those: `invalid`; a file that does not exist: `missing`.
       */
      file: string;
      /** How colours between the table's points are computed; `tetrahedral` is FFmpeg's default. */
      interpolation:
        "nearest" | "trilinear" | "tetrahedral" | "pyramid" | "prism";
    };
/**
 * One plane's kernel of a `convolution` {@link VideoNode}: each output
 * sample is `(sum of matrix × neighbourhood) × rdiv + bias`, clipped to the
 * sample range.
 *
 * @since 1.5.39
 * @category Processing
 */
export type ConvolutionPlane = {
  /**
   * `square`: `matrix` is a 3×3, 5×5 or 7×7 kernel, row by row (9, 25 or
   * 49 entries); `row` / `column`: a horizontal / vertical kernel with an
   * odd number of entries up to 49.
   */
  mode: "square" | "row" | "column";
  /** Integers −1024–1024 (FFmpeg reads whole numbers only). */
  matrix: number[];
  /**
   * Multiplier 0–256; 0 divides by the sum of the matrix (by 1 when it
   * sums to 0), which keeps the brightness of a blur.
   */
  rdiv: number;
  /** Added after the multiplication, 0–65535 in the plane's sample units (128 is mid grey for 8-bit video). */
  bias: number;
};
/**
 * The player's bounds for the video primitives of SDK 1.5.39 (player
 * 0.5.20): `convolution` and `lut3d` {@link VideoNode}s and the shader
 * channel (`plugin.video.shaders()`). Values beyond them fail with
 * `invalid`; more shaders than `shaders` fail with `limit`.
 *
 * @example Refuse a shader list the player would not take
 * The plugin checks a shader list against the player's limit before it
 * sets it, and says so on the OSD instead of waiting for a `limit` failure.
 * The limit counts every plugin's shaders, so the player still decides.
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * declare const files: string[];
 * // ---cut---
 * import { VIDEO_PROCESSING_LIMITS } from "@vestra-player/sdk/testing";
 *
 * if (files.length > VIDEO_PROCESSING_LIMITS.shaders)
 *   void plugin.osd.show("Too many shaders");
 * else plugin.video.shaders().set(files);
 * ```
 *
 * @since 1.5.39
 * @category Testing
 */
export const VIDEO_PROCESSING_LIMITS = Object.freeze({
  /** Shaders across every plugin's `plugin.video.shaders()` handles (16). */
  shaders: 16,
  /** Bytes of one shader file (16 MiB). */
  shaderBytes: 16 * 1024 * 1024,
  /** Bytes of a shader handle's id (128). */
  shaderIdBytes: 128,
  /** Bytes of one `lut3d` `.cube` file (16 MiB). */
  lutBytes: 16 * 1024 * 1024,
  /** Largest `LUT_3D_SIZE` of a `lut3d` file, points per axis (65). */
  lutSize: 65,
  /** Bytes of a `lut3d` file path (4096). */
  lutPathBytes: 4096,
  /** Largest magnitude of a `convolution` matrix entry (1024). */
  matrixValue: 1024,
  /** Largest `convolution` `rdiv` (256). */
  rdiv: 256,
  /** Largest `convolution` `bias` (65535). */
  bias: 65535,
});
/**
 * One node of an {@link AudioFilter} chain, by `kind`. Values outside the
 * ranges fail with `invalid`; "live" fields change in place while playing.
 *
 * @example Lift the voices and play in mono
 * Speech around 1 kHz is 3 dB louder and both speakers play the same mixed
 * channel. `set` sends this plugin's whole audio chain (the nodes in order,
 * plus an optional `delayMs`); the player joins it with other plugins'
 * chains and applies it to every source (`processing.audio`,
 * `playback.read`, `events`).
 * ```ts
 * plugin.audio.filter("sound").set({
 *   nodes: [
 *     { kind: "equalizer", frequency: 1000, q: 1, gainDb: 3 }, // +3 dB at 1 kHz
 *     { kind: "channels", mode: "mono" }, // both channels get (L + R) / 2
 *   ],
 * });
 * ```
 *
 * @since 1.0.0
 * @category Processing
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
/** Value ranges, the same as the host's `src/host/src/playback/effects.rs` (the host is authoritative). */
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
  deinterlace: {
    when: ["interlaced", "all", "auto"],
    output: ["frame", "field"],
  },
  reframe: { mode: ["crop", "pad"], aspect: [0.25, 4], x: [-1, 1], y: [-1, 1] },
  frameBlend: { fps: [24, 120] },
  // Checked by `convolutionProblem` / `lutProblem` below.
  convolution: { planes: [] },
  lut3d: {
    file: [],
    interpolation: ["nearest", "trilinear", "tetrahedral", "pyramid", "prism"],
  },
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
  "convolution",
  "lut3d",
]);

/** `convolution` nodes: the player's rules (`effects.rs ConvolutionPlane`). */
function convolutionProblem(planes: unknown): string | null {
  if (!Array.isArray(planes) || planes.length < 1 || planes.length > 4)
    return "convolution planes must have 1 to 4 entries";
  if (planes.every((plane) => plane === null))
    return "convolution needs at least one plane with a matrix";
  const limits = VIDEO_PROCESSING_LIMITS;
  for (const [index, plane] of planes.entries()) {
    if (plane === null) continue;
    if (typeof plane !== "object" || Array.isArray(plane))
      return `convolution plane ${index} must be an object or null`;
    const fields = Object.keys(plane as object);
    const unknown = fields.find(
      (field) => !["mode", "matrix", "rdiv", "bias"].includes(field),
    );
    if (unknown) return `convolution plane ${index}: unknown field ${unknown}`;
    const { mode, matrix, rdiv, bias } = plane as Record<string, unknown>;
    if (!["square", "row", "column"].includes(mode as string))
      return `convolution plane ${index}: mode must be square, row or column`;
    if (!Array.isArray(matrix))
      return `convolution plane ${index}: matrix must be an array of integers`;
    const sized =
      mode === "square"
        ? [9, 25, 49].includes(matrix.length)
        : matrix.length % 2 === 1 && matrix.length <= 49;
    if (!sized)
      return `convolution plane ${index}: a square matrix has 9, 25 or 49 entries, a row or column an odd number up to 49 (got ${matrix.length})`;
    if (
      matrix.some(
        (value) =>
          !Number.isInteger(value) || Math.abs(value) > limits.matrixValue,
      )
    )
      return `convolution plane ${index}: matrix entries must be integers in -${limits.matrixValue}..${limits.matrixValue}`;
    const outside = (value: unknown, max: number) =>
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > max;
    if (outside(rdiv, limits.rdiv))
      return `convolution plane ${index} rdiv must be finite in 0..=${limits.rdiv}`;
    if (outside(bias, limits.bias))
      return `convolution plane ${index} bias must be finite in 0..=${limits.bias}`;
  }
  return null;
}

/**
 * Whether `text` has a control character as Rust's `char::is_control`
 * sees one (C0, DEL and C1: U+0000–U+001F, U+007F–U+009F).
 */
export function hasControl(text: string): boolean {
  return [...text].some((c) => {
    const code = c.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code <= 0x9f);
  });
}
/**
 * The form of a `lut3d` path (the player's `effects.rs lut_path`); where
 * the file is and what it holds the player checks when the request arrives
 * (the test host too, `TestHost.fileRoots`).
 */
export function lutPathProblem(file: unknown): string | null {
  const max = VIDEO_PROCESSING_LIMITS.lutPathBytes;
  if (
    typeof file !== "string" ||
    Buffer.byteLength(file) > max ||
    hasControl(file)
  )
    return `lut3d file must be a path of at most ${max} bytes without control characters`;
  if (/[[\]]/.test(file)) return "lut3d file path must not contain [ or ]";
  if (!isAbsolute(file)) return "lut3d file must be an absolute path";
  if (!/\.cube$/i.test(file)) return "lut3d file must be a .cube file";
  return null;
}

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
    if (node.kind === "convolution") {
      const problem = convolutionProblem(
        (node as unknown as { planes: unknown }).planes,
      );
      if (problem) return problem;
      continue;
    }
    if (node.kind === "lut3d") {
      const problem = lutPathProblem(
        (node as unknown as { file: unknown }).file,
      );
      if (problem) return problem;
    }
    for (const [field, allowed] of Object.entries(rule)) {
      if (allowed.length === 0) continue;
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
    if (
      node.kind === "deinterlace" &&
      (node as unknown as { when: string }).when === "auto" &&
      (node as unknown as { output: string }).output !== "field"
    )
      return "deinterlace when auto outputs one frame per field: output must be field";
  }
  const deinterlace = nodes.filter(
    (node) => node.kind === "deinterlace",
  ) as unknown as { when: string }[];
  if (
    deinterlace.length > 1 &&
    deinterlace.some((node) => node.when === "auto")
  )
    return "a chain with a deinterlace node when auto has no other deinterlace node";
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
