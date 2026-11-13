/**
 * Video and audio processing, video view/render/shader ownership, rendering
 * and AI upscaling, with the player's validation of files and cubes.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  realpathSync,
} from "node:fs";
import { statSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { HostError } from "../../wire.ts";
import type {
  Json,
  WireMotionState,
  WireRenderingState,
  WireUpscalingState,
} from "../../wire.ts";
import { nodeProblem, VIDEO_PROCESSING_LIMITS } from "../../processing.ts";
import { shaderIdProblem, shaderListProblem } from "../shaders.ts";
import { renderProblem, viewProblem } from "../view.ts";
import type {
  MotionMode,
  RenderingMode,
  RenderingReason,
  RenderSettings,
  UpscalingDecodingCause,
  UpscalingPlugin,
  UpscalingReason,
  ViewSettings,
} from "../types.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";

/**
 * The player's `playback/plugin_files.rs`: a file the plugin names for its
 * video processing is an absolute path inside one of `roots` after
 * following links, a regular file of at most `max` bytes. Returns the real
 * path or throws the player's error.
 */
export function ownFile(
  path: string,
  roots: string[],
  what: string,
  max: number,
) {
  if (!isAbsolute(path))
    throw new HostError("invalid", `${what} path must be absolute: ${path}`);
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    throw new HostError("missing", `${what} not found: ${path}`);
  }
  const inside = roots.some((root) => {
    let base: string;
    try {
      base = realpathSync(root);
    } catch {
      return false;
    }
    const rel = relative(base, real);
    return rel === "" || (!/^\.\.([\\/]|$)/.test(rel) && !isAbsolute(rel));
  });
  if (!inside)
    throw new HostError(
      "invalid",
      `${what} must be in the plugin's package or data directory: ${path}`,
    );
  const stat = statSync(real);
  if (!stat.isFile())
    throw new HostError("invalid", `${what} is not a file: ${path}`);
  if (stat.size > max)
    throw new HostError(
      "invalid",
      `${what} is larger than ${max / 1024 / 1024} MiB: ${path}`,
    );
  return real;
}

/** The `LUT_3D_SIZE` check of `plugin_files::lut` on the first 64 KiB. */
export function cubeProblem(file: string): string | null {
  const buffer = Buffer.alloc(64 * 1024);
  const fd = openSync(file, "r");
  let read: number;
  try {
    read = readSync(fd, buffer, 0, buffer.length, 0);
  } finally {
    closeSync(fd);
  }
  for (const line of buffer.subarray(0, read).toString("utf8").split("\n")) {
    const [word, value] = line.trim().split(/\s+/);
    if (word === "LUT_3D_SIZE") {
      const size = Number(value);
      return Number.isInteger(size) &&
        size >= 2 &&
        size <= VIDEO_PROCESSING_LIMITS.lutSize
        ? null
        : `LUT_3D_SIZE must be 2 to ${VIDEO_PROCESSING_LIMITS.lutSize}`;
    }
    if (word === "LUT_1D_SIZE") return "a 1D LUT; lut3d needs LUT_3D_SIZE";
    if (word !== undefined && word !== "" && Number.isFinite(Number(word)))
      break;
  }
  return "no LUT_3D_SIZE line before the data";
}

export function processingState(host: TestHost, _inner: Internals) {
  const list = (stage: string) =>
    [...host.processing.resources]
      .filter(([, value]) => value.stage === stage)
      .map(([key, value]) => ({
        owner: 1,
        revision: value.revision,
        resource: {
          manifestId: host.manifestId,
          resourceId: key.split(":")[1]!,
          nodes: value.nodes,
        },
        ...(stage === "audio" ? { offsetMs: value.offsetMs ?? 0 } : {}),
      }));
  return {
    configurationRevision: host.processing.configurationRevision,
    audioOffsetMs: 0,
    source: {
      generation: host.source.stamp.generation,
      phase: host.source.phase,
      load: null,
      stages: {},
    },
    video: list("video"),
    audio: list("audio"),
    backendUncertain: host.processing.backendUncertain,
  };
}

/** `video.upscaling.state` from {@link TestHost.upscaling}. */
export function upscalingState(
  host: TestHost,
  _inner: Internals,
  check = true,
): WireUpscalingState {
  if (check) host.upscaling.checked = true;
  const { enabled, factor } = host.upscaling;
  // `set(false)` before any check: the player answers without checking.
  const reason = host.upscaling.checked
    ? host.upscaling.reason
    : {
        code: "unchecked",
        message:
          "the player has not checked the GPU yet; state() or set(true) checks it",
      };
  const requested = enabled && reason === null && factor !== null && factor > 1;
  const { video, area, gpu, hwdecCurrent } = host.upscaling;
  return {
    available: reason === null,
    reason: reason
      ? (structuredClone(reason) as WireUpscalingState["reason"])
      : null,
    enabled,
    requested,
    factor: requested ? factor : null,
    video: video ? { ...video } : null,
    area: area ? { ...area } : null,
    gpu,
    hwdecCurrent,
    inChain: requested,
  };
}

/** `rendering.state` from {@link TestHost.rendering} and `videoRender.gpu`. */
export function renderingState(
  host: TestHost,
  _inner: Internals,
): WireRenderingState {
  const { reason, preference, startedWith, gpu } = host.rendering;
  // The player's order (render_mode.rs decide): no windows or no GPU
  // renderer first, then the preference `software`, then what keeps GPU
  // rendering off (denylist, crash), else GPU with the reason `default`
  // (also when the preference is `gpu`).
  const system =
    !gpu.available &&
    (gpu.reason?.code === "headless" || gpu.reason?.code === "no-gpu-backend");
  const next: { mode: RenderingMode; reason: RenderingReason } = system
    ? { mode: "software", reason: gpu.reason! }
    : preference === "software"
      ? {
          mode: "software",
          reason: {
            code: "preference",
            message: "chosen in the player's settings",
          },
        }
      : !gpu.available
        ? {
            mode: "software",
            reason: gpu.reason ?? {
              code: "default",
              message: "nothing rules GPU rendering out",
            },
          }
        : {
            mode: "gpu",
            reason: {
              code: "default",
              message: "nothing rules GPU rendering out",
            },
          };
  return {
    mode: host.videoRender.gpu ? "gpu" : "software",
    reason: { ...reason },
    preference,
    nextMode: next.mode,
    nextReason: { ...next.reason },
    restartPending: next.mode !== startedWith,
    gpu: {
      available: gpu.available,
      reason: gpu.available || !gpu.reason ? null : { ...gpu.reason },
    },
  };
}

/** Implements `TestHost.failVideoRender`. */
export function failVideoRender(
  host: TestHost,
  _inner: Internals,
  code: "failed" | "unsupported" | "previous-crash",
  message: string,
) {
  if (code === "unsupported") {
    host.videoRender.gpu = false;
    host.rendering.reason = { code: "window-fallback", message };
  }
  if (host.videoRender.owner === host.manifestId)
    host.emit("video.render.status", {
      state: "failed",
      error: { code, message },
    });
  // The player tells every shader handle too (`failVideoShaders`).
  // and, like the player, removes their lists.
  if (code === "unsupported") {
    for (const [id, paths] of host.videoShaders.handles)
      if (paths.length > 0)
        host.emit("video.shaders.status", {
          id,
          state: "failed",
          error: { code, message },
        });
    host.videoShaders.handles.clear();
  }
}

/** Implements `TestHost.failVideoShaders`. */
export function failVideoShaders(
  host: TestHost,
  _inner: Internals,
  id: string,
  message: string,
  code: "failed" | "previous-crash" = "failed",
) {
  if ((host.videoShaders.handles.get(id)?.length ?? 0) > 0)
    host.emit("video.shaders.status", {
      id,
      state: "failed",
      error: { code, message },
    });
}

/** Implements `TestHost.upscalingDecoding`. */
export function upscalingDecoding(
  host: TestHost,
  _inner: Internals,
  cause: UpscalingDecodingCause,
  plugins: readonly UpscalingPlugin[] = [],
): UpscalingReason {
  const needs =
    "upscaling needs it decoded on the GPU that renders it (d3d11va)";
  const names = plugins.map((p) => p.name);
  const because =
    names.length === 0
      ? "for example because a video filter needs the frames in memory"
      : names.length === 1
        ? `because the video filter of ${names[0]} needs the frames in memory`
        : `because the video filters of ${names.join(", ")} need the frames in memory`;
  const [message, current] =
    cause === "copy-back"
      ? [
          `the video is decoded with copy-back (auto-copy-safe), ${because}; ${needs}`,
          "d3d11va-copy",
        ]
      : cause === "hwdec-off"
        ? [
            "hardware decoding is off; upscaling needs the video decoded on the GPU that renders it (d3d11va)",
            "no",
          ]
        : cause === "software"
          ? [`this video is decoded in software; ${needs}`, "no"]
          : [`this video is decoded with nvdec; ${needs}`, "nvdec"];
  const reason: UpscalingReason =
    cause === "copy-back"
      ? {
          code: "decoding",
          message,
          cause,
          plugins: plugins.map(({ id, name }) => ({ id, name })),
        }
      : { code: "decoding", message, cause };
  host.upscaling.reason = reason;
  host.upscaling.hwdecCurrent = current;
  return reason;
}

/** `video.motion.state` from {@link TestHost.motion}. */
/** The player's message for the reserved engine (as playback/motion.rs). */
const NO_NVIDIA = {
  code: "engine",
  message:
    "this player has no NVIDIA frame-rate converter; motion smoothing works with AMD's (engine amd)",
};

/** `video.motion.state` of the reserved `nvidia` engine: every mode `engine`. */
function nvidiaState(host: TestHost): WireMotionState {
  return {
    engine: "nvidia",
    mode: "off",
    active: "off",
    double: { ...NO_NVIDIA },
    display: { ...NO_NVIDIA },
    searchMode: null,
    sourceFps: host.motion.sourceFps,
    outputFps: null,
    displayFps: host.motion.displayFps,
    gpu: null,
    inChain: false,
  };
}

/** The engine a request names, checked as the player does. */
function engineOf(p: Record<string, unknown>): "amd" | "nvidia" {
  if (p.engine !== "amd" && p.engine !== "nvidia")
    throw new HostError("invalid", 'engine must be "amd" or "nvidia"');
  return p.engine;
}

export function motionState(host: TestHost): WireMotionState {
  const { mode, double, display, sourceFps, displayFps, gpu } = host.motion;
  const reasonOf = (wanted: MotionMode) =>
    wanted === "double" ? double : wanted === "display" ? display : null;
  const works = mode !== "off" && reasonOf(mode) === null && sourceFps !== null;
  const active: MotionMode = works ? mode : "off";
  const copy = (reason: typeof double) =>
    reason ? (structuredClone(reason) as WireMotionState["double"]) : null;
  return {
    engine: "amd",
    mode,
    active,
    double: copy(double),
    display: copy(display),
    searchMode: works
      ? host.motion.performance
        ? "performance"
        : "native"
      : null,
    sourceFps,
    outputFps: works
      ? (host.motion.outputFps ?? Math.round(sourceFps * 20) / 10)
      : null,
    displayFps,
    gpu,
    inChain: works,
  };
}

/** The reason codes that hold for the whole run (`set` rejects them). */
const MOTION_FIXED = [
  "engine",
  "platform",
  "no-gpu",
  "runtime",
  "filter",
  "rendering",
];

/** The default handlers of this area's wire methods, by method name. */
export function processingHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    // As the player 0.5.13 (see TestHost.rendering for the model).
    "rendering.state": () => renderingState(host, inner),
    "rendering.setPreference": (p) => {
      const preference = p.preference;
      if (
        preference !== "auto" &&
        preference !== "gpu" &&
        preference !== "software"
      )
        throw new HostError(
          "invalid",
          'preference must be "auto", "gpu" or "software"',
        );
      const { available, reason } = host.rendering.gpu;
      if (preference === "gpu" && !available)
        throw new HostError(
          reason?.code === "no-gpu-backend" || reason?.code === "headless"
            ? "unsupported"
            : "unavailable",
          reason?.message ?? "GPU rendering cannot be chosen",
        );
      host.rendering.preference = preference;
      return renderingState(host, inner);
    },
    "rendering.restart": () => {
      if (host.rendering.restarts > 0)
        throw new HostError("busy", "a restart is already under way");
      host.rendering.restarts++;
      return null;
    },
    // As the player 0.5.16 (see TestHost.upscaling for the model).
    "video.upscaling.state": () => upscalingState(host, inner),
    "video.upscaling.set": (p) => {
      if (typeof p.enabled !== "boolean")
        throw new HostError("invalid", "enabled must be a boolean");
      const { reason, renderingStarting } = host.upscaling;
      // Off: always, without the GPU check.
      if (!p.enabled) {
        host.upscaling.enabled = false;
        return upscalingState(host, inner, false);
      }
      const passes =
        reason?.code === "decoding" ||
        (reason?.code === "rendering" && renderingStarting);
      if (reason && !passes) {
        host.upscaling.checked = true;
        throw new HostError(
          "unsupported",
          `video upscaling cannot work here: ${reason.message}`,
        );
      }
      host.upscaling.enabled = true;
      return upscalingState(host, inner);
    },
    // As the player 0.8.1 (see TestHost.motion for the model).
    "video.motion.state": (p) =>
      engineOf(p) === "amd" ? motionState(host) : nvidiaState(host),
    "video.motion.set": (p) => {
      const engine = engineOf(p);
      const mode = p.mode;
      if (mode !== "off" && mode !== "double" && mode !== "display")
        throw new HostError(
          "invalid",
          'mode must be "off", "double" or "display"',
        );
      if (engine === "nvidia") {
        if (mode !== "off")
          throw new HostError(
            "unsupported",
            `motion smoothing cannot work here: ${NO_NVIDIA.message}`,
          );
        return nvidiaState(host);
      }
      if (mode !== "off") {
        const reason = host.motion[mode];
        const passes =
          reason?.code === "rendering" && host.motion.renderingStarting;
        if (reason && MOTION_FIXED.includes(reason.code) && !passes)
          throw new HostError(
            "unsupported",
            `motion smoothing cannot work here: ${reason.message}`,
          );
      }
      host.motion.mode = mode;
      return motionState(host);
    },
    "video.view.set": (p) => {
      const owner = host.videoView.owner;
      if (owner !== null && owner !== host.manifestId)
        throw new HostError(
          "conflict",
          "another plugin owns the display layer",
        );
      const problem = viewProblem(p.values);
      if (problem) throw new HostError("invalid", problem);
      host.videoView.owner = host.manifestId;
      host.videoView.values = {
        ...host.videoView.values,
        ...(p.values as Partial<ViewSettings>),
      };
      return { state: host.source.phase === "ready" ? "applied" : "waiting" };
    },
    "video.view.release": () => {
      if (host.videoView.owner === host.manifestId)
        host.setVideoViewOwner(null);
      return null;
    },
    "video.render.set": (p) => {
      // The player's crash guard comes first (`processing_video.rs`).
      const listed = (p.values as { shaders?: unknown } | null)?.shaders;
      if (
        host.previousCrash !== null &&
        Array.isArray(listed) &&
        listed.length > 0
      )
        throw new HostError("previous-crash", host.previousCrash);
      if (!host.videoRender.gpu)
        throw new HostError(
          "unsupported",
          "render options need GPU rendering; the player renders in software",
        );
      const owner = host.videoRender.owner;
      if (owner !== null && owner !== host.manifestId)
        throw new HostError(
          "conflict",
          "another plugin owns the render options",
        );
      const problem = renderProblem(p.values);
      if (problem) throw new HostError("invalid", problem);
      const values = p.values as Partial<RenderSettings>;
      const missing = values.shaders?.find((path) => !existsSync(path));
      if (missing !== undefined)
        throw new HostError(
          "invalid",
          `shader file does not exist: ${missing}`,
        );
      host.videoRender.owner = host.manifestId;
      host.videoRender.values = { ...host.videoRender.values, ...values };
      return { state: host.source.phase === "ready" ? "applied" : "waiting" };
    },
    "video.render.release": () => {
      if (host.videoRender.owner === host.manifestId)
        host.setVideoRenderOwner(null);
      return null;
    },
    // The player's request layer and `video_shaders.rs`.
    "video.shaders.set": (p) => {
      const idProblem = shaderIdProblem(p.id);
      if (idProblem) throw new HostError("invalid", idProblem);
      if (
        !Array.isArray(p.paths) ||
        p.paths.some((path) => typeof path !== "string")
      )
        throw new HostError("invalid", "paths must be an array of paths");
      const id = p.id as string;
      const list = p.paths as string[];
      const listProblem = shaderListProblem(list);
      if (listProblem?.startsWith("at most"))
        throw new HostError("limit", listProblem);
      const paths = list.map((path) =>
        ownFile(
          path,
          host.fileRoots,
          "shader",
          VIDEO_PROCESSING_LIMITS.shaderBytes,
        ),
      );
      // The player's crash guard, after the files are checked.
      if (paths.length > 0 && host.previousCrash !== null)
        throw new HostError("previous-crash", host.previousCrash);
      if (paths.length > 0 && !host.videoRender.gpu)
        throw new HostError(
          "unsupported",
          "shaders need GPU rendering; the player renders in software",
        );
      const mine = [...host.videoShaders.handles]
        .filter(([other]) => other !== id)
        .reduce((sum, [, held]) => sum + held.length, 0);
      const others = mine + host.videoShaders.others;
      if (others + paths.length > VIDEO_PROCESSING_LIMITS.shaders)
        throw new HostError(
          "limit",
          `at most ${VIDEO_PROCESSING_LIMITS.shaders} shaders across all plugins: ${others} are in use, this list has ${paths.length}`,
        );
      if (paths.length > 0) host.videoShaders.handles.set(id, paths);
      else host.videoShaders.handles.delete(id);
      return { state: host.source.phase === "ready" ? "applied" : "waiting" };
    },
    "processing.state": () => processingState(host, inner),
    "processing.replace": (p) => {
      const stage = String(p.stage);
      const key = `${stage}:${p.resourceId}`;
      const token = `${key}:${p.revision}`;
      const finish = (outcome: {
        status: "completed" | "failed";
        result?: Json;
        error?: { code: string; message: string };
      }) => {
        host.processing.book.set(token, outcome);
        if (outcome.error)
          throw new HostError(outcome.error.code, outcome.error.message);
        return outcome.result;
      };
      if (host.processing.backendUncertain[stage as "video"])
        return finish({
          status: "failed",
          error: {
            code: "backend-uncertain",
            message: host.processing.backendUncertain[stage as "video"]!,
          },
        });
      // The same node and delay rules as the player.
      const problem = nodeProblem(
        stage as "video" | "audio",
        (p.nodes ?? []) as { kind: string }[],
      );
      // frameBlend: at most one across every chain (this plugin's others too).
      const blends = [...host.processing.resources]
        .filter(([other]) => other !== key)
        .flatMap(([, resource]) => resource.nodes as { kind: string }[])
        .concat((p.nodes ?? []) as { kind: string }[])
        .filter((node) => node.kind === "frameBlend").length;
      const blend =
        !problem && blends > 1
          ? "only one frameBlend node across all plugins"
          : null;
      const offset = Number(p.offsetMs ?? 0);
      const delay =
        stage === "audio" &&
        (!Number.isInteger(offset) ||
          Math.abs(offset) > 10_000 ||
          offset % 10 !== 0)
          ? "audio offsetMs must be -10000..10000 in 10ms increments"
          : null;
      if (problem || blend || delay)
        return finish({
          status: "failed",
          error: { code: "invalid", message: (problem ?? blend ?? delay)! },
        });
      // `lut3d` files: the plugin's own `.cube` files (`plugin_files.rs`).
      if (stage === "video")
        for (const node of (p.nodes ?? []) as { kind: string; file?: string }[])
          if (node.kind === "lut3d") {
            let cube: string | null;
            try {
              const real = ownFile(
                node.file!,
                host.fileRoots,
                "lut3d file",
                VIDEO_PROCESSING_LIMITS.lutBytes,
              );
              cube = /\.cube$/i.test(real)
                ? cubeProblem(real)
                : "lut3d file must be a .cube file";
            } catch (error) {
              const { code, message } = error as HostError;
              return finish({ status: "failed", error: { code, message } });
            }
            if (cube)
              return finish({
                status: "failed",
                error: {
                  code: "invalid",
                  message: `lut3d file ${node.file}: ${cube}`,
                },
              });
          }
      if (host.source.phase !== "ready")
        return finish({
          status: "failed",
          error: { code: "unavailable", message: "source must be ready" },
        });
      // An empty chain removes the resource (audio: with no delay either).
      const removal =
        ((p.nodes ?? []) as Json[]).length === 0 &&
        (stage === "video" || offset === 0);
      // A generated stream's frames never reach the player's filters.
      if (host.source.kind === "producer" && !removal)
        return finish({
          status: "failed",
          error: {
            code: "unsupported",
            message:
              "generated streams (openStream) do not pass through the player's filters; the chain applies to the next media the player decodes",
          },
        });
      if (p.expectedGeneration !== host.source.stamp.generation)
        return finish({
          status: "failed",
          error: { code: "stale", message: "source generation changed" },
        });
      const old = host.processing.resources.get(key);
      if (old && Number(p.revision) <= old.revision)
        return finish({
          status: "failed",
          error: { code: "stale", message: "resource revision must increase" },
        });
      if (removal) host.processing.resources.delete(key);
      else
        host.processing.resources.set(key, {
          stage,
          revision: Number(p.revision),
          nodes: p.nodes!,
          ...(stage === "audio" ? { offsetMs: Number(p.offsetMs ?? 0) } : {}),
        });
      host.processing.configurationRevision++;
      return finish({
        status: "completed",
        result: {
          stage,
          revision: p.revision!,
          generation: host.source.stamp.generation,
          status: "applied",
        },
      });
    },
    "processing.operation": (p) =>
      host.processing.book.get(`${p.stage}:${p.resourceId}:${p.revision}`) ?? {
        status: "unknown",
      },
  };
}
