/**
 * Snapshots, export jobs and stream producers (`snapshot.*`, `jobs.*`,
 * `producer.*`).
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import { HostError } from "../../wire.ts";
import { localSocketPath } from "../local.ts";
import type { Json } from "../../wire.ts";
import type { SourceState, SourceStamp } from "../../source.ts";
import type { WireExportCheck, WireSourceReference } from "../../media.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";
import { isCurrentProducer } from "./media.ts";

/** `jobs.start`'s `encoding`, checked against the player's sets. */
export function validEncoding(value: Json | undefined): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const sets: Record<string, readonly Json[]> = {
    crf: Array.from({ length: 17 }, (_, i) => i + 14),
    speed: ["faster", "balanced", "smaller"],
    maxHeight: [1080, 720, 480],
    fps: [60, 30],
    audioBitrate: [128, 192, 256],
    threads: ["single", "auto"],
    videoBitrate: ["source"],
  };
  const fields = value as Record<string, Json>;
  if (fields.crf !== undefined && fields.videoBitrate !== undefined)
    return false;
  return Object.entries(value).every(
    ([key, v]) => sets[key]?.includes(v as Json) ?? false,
  );
}

/** Implements `TestHost.failStream`. */
export function failStream(
  host: TestHost,
  inner: Internals,
  producerId: number,
  message: string,
) {
  const producer = host.producers.get(producerId);
  if (!producer || !isCurrentProducer(host, inner, producerId))
    throw new Error(`producer ${producerId} is not the player's source`);
  host.setSource({
    phase: "error",
    terminalReason: { failed: message },
  } as Partial<SourceState>);
  producer.retired = true;
}

type ExportPartWire = { source: string; start: number; end: number };
type FileFacts = {
  duration: number;
  status: "ok" | "missing" | "changed";
  video: WireSourceReference["video"];
  audio: WireSourceReference["audio"];
};

/** The default handlers of this area's wire methods, by method name. */
export function jobsHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  /** A file's facts: `mediaFiles`, else a 1080p30 H.264 + AAC file. */
  const facts = (path: string): FileFacts => {
    const file = host.mediaFiles.get(path) ?? {};
    return {
      duration: file.duration ?? host.source.duration ?? 60,
      status: file.status ?? "ok",
      video:
        file.video === undefined
          ? {
              codec: "h264",
              width: 1920,
              height: 1080,
              fps: 30,
              pixelFormat: "yuv420p",
            }
          : file.video,
      audio:
        file.audio === undefined
          ? { codec: "aac", sampleRate: 48000, channels: 2 }
          : file.audio,
    };
  };
  const known = (token: Json | undefined) => {
    const value = String(token);
    if (!host.sourceReferences.has(value))
      throw new HostError("missing", "no such source reference");
    return value;
  };
  /** A file's version: what the player's size and modification time are. */
  const version = (path: string) => host.mediaFiles.get(path)?.version ?? 0;
  /** As the player: gone, rewritten since remembered, or as it was. */
  const status = (token: string): FileFacts["status"] => {
    const { path, version: was } = host.sourceReferences.get(token)!;
    const file = facts(path);
    if (file.status === "missing") return "missing";
    return file.status === "changed" || version(path) !== (was ?? 0)
      ? "changed"
      : "ok";
  };
  const describe = (token: string): WireSourceReference => {
    const { path } = host.sourceReferences.get(token)!;
    const file = facts(path);
    return {
      token,
      name: path.split(/[/\\]/).pop() ?? path,
      duration: file.duration,
      status: status(token),
      video: file.video,
      audio: file.audio,
    };
  };
  // The player's check (`media_sources::check`) over the fake facts.
  const exportCheck = (parts: ExportPartWire[]): WireExportCheck => {
    // The player's bounds (`media_sources::parts_valid`).
    if (
      !Array.isArray(parts) ||
      parts.length === 0 ||
      parts.length > 100 ||
      parts.some(
        (part) =>
          typeof part?.source !== "string" ||
          part.source === "" ||
          !Number.isFinite(part.start) ||
          !Number.isFinite(part.end) ||
          part.start < 0 ||
          part.end > 86400,
      ) ||
      parts.reduce((sum, part) => sum + Math.max(0, part.end - part.start), 0) >
        86400
    )
      throw new HostError(
        "invalid",
        "1–100 parts with a token and finite times from 0 to 86400 s (24 hours in all) required",
      );
    const blocking: WireExportCheck["blocking"] = [];
    const files = parts.map((part, index) => {
      const reference = host.sourceReferences.get(part.source);
      if (!reference) {
        blocking.push({ part: index, problem: "unknown" });
        return null;
      }
      const file = facts(reference.path);
      const now = status(part.source);
      if (now !== "ok") blocking.push({ part: index, problem: now });
      if (!file.video) blocking.push({ part: index, problem: "noVideo" });
      else if (
        part.end <= part.start ||
        part.end - part.start < 1 / file.video.fps - 1e-6 ||
        part.end > file.duration + 0.001
      )
        blocking.push({
          part: index,
          problem: "range",
          duration: file.duration,
        });
      return file;
    });
    const reasons: Extract<WireExportCheck["copy"], { ok: false }>["reasons"] =
      [];
    const first = files[0]?.video ? files[0] : null;
    const audio = (a: FileFacts["audio"]) =>
      a ? `${a.codec} ${a.sampleRate} Hz ${a.channels} ch` : "none";
    if (first?.video)
      files.forEach((file, part) => {
        if (part === 0 || !file?.video) return;
        const v = file.video;
        const f = first.video!;
        if (v.codec !== f.codec)
          reasons.push({
            part,
            field: "videoCodec",
            value: v.codec,
            expected: f.codec,
          });
        if (v.width !== f.width || v.height !== f.height)
          reasons.push({
            part,
            field: "size",
            value: `${v.width}×${v.height}`,
            expected: `${f.width}×${f.height}`,
          });
        if (v.fps !== f.fps)
          reasons.push({ part, field: "fps", value: v.fps, expected: f.fps });
        if (v.pixelFormat !== f.pixelFormat)
          reasons.push({
            part,
            field: "pixelFormat",
            value: v.pixelFormat,
            expected: f.pixelFormat,
          });
        if (audio(file.audio) !== audio(first.audio))
          reasons.push({
            part,
            field: "audio",
            value: audio(file.audio),
            expected: audio(first.audio),
          });
      });
    const mp4 =
      ["h264", "hevc", "av1", "mpeg4"].includes(first?.video?.codec ?? "") &&
      (!first?.audio ||
        ["aac", "mp3", "ac3", "eac3", "alac"].includes(first.audio.codec));
    return {
      blocking,
      copy:
        reasons.length > 0 || !first
          ? { ok: false, reasons }
          : { ok: true, container: mp4 ? "mp4" : "mkv" },
      encode: first?.video
        ? {
            width: first.video.width + (first.video.width % 2),
            height: first.video.height + (first.video.height % 2),
            fps: first.video.fps,
            audio: files.some((file) => file?.audio)
              ? { sampleRate: 48000, channels: 2 }
              : null,
          }
        : null,
      duration: parts.reduce(
        (sum, part) => sum + Math.max(0, part.end - part.start),
        0,
      ),
    };
  };
  const handlers: Record<string, Handler> = {
    "snapshot.capture": (p) => {
      const expected = p.expected as SourceStamp;
      if (
        expected.generation !== host.source.stamp.generation ||
        expected.intentVersion !== host.source.stamp.intentVersion
      )
        throw new HostError("stale", "source changed");
      const snapshotId = ++inner.next.snapshot;
      const snapshot = {
        snapshotId,
        kind: p.mode === "processed" ? "processed" : "raw",
        sourceStamp: expected,
        time: Number(p.time ?? host.source.position ?? 0),
        source: host.source.source ?? "",
        duration: host.source.duration ?? 0,
        audio: null,
        ...(p.mode === "processed"
          ? {
              presentation: { width: 1920, height: 1080 },
              processing: { revision: host.processing.configurationRevision },
            }
          : {}),
      };
      host.snapshots.set(snapshotId, snapshot);
      return snapshot;
    },
    "snapshot.state": (p) => host.snapshots.get(Number(p.snapshotId)) ?? null,
    "snapshot.release": (p) => void host.snapshots.delete(Number(p.snapshotId)),
    "jobs.start": (p) => {
      if (p.parts !== undefined) return startParts(p);
      if (!host.snapshots.has(Number(p.snapshotId)))
        throw new HostError("missing", "snapshot released");
      const kind = String(p.kind);
      const snapshot = host.snapshots.get(Number(p.snapshotId)) as {
        kind: string;
        time: number;
      };
      const clip = /^(rawMp4|processedMp4|rawCopy)$/.test(kind);
      if (
        !(/^(raw|processed)(Png|Jpeg|Bmp)$/.test(kind) || clip) ||
        (p.quality !== undefined && !kind.endsWith("Jpeg")) ||
        (p.encoding !== undefined &&
          (!kind.endsWith("Mp4") || !validEncoding(p.encoding))) ||
        (p.container !== undefined &&
          (kind !== "rawCopy" ||
            !["auto", "mp4", "mkv"].includes(String(p.container)))) ||
        (clip && typeof p.end !== "number") ||
        !kind.startsWith(snapshot.kind)
      )
        throw new HostError("invalid", `unknown job kind ${p.kind}`);
      host.exports.push(structuredClone(p));
      const jobId = ++inner.next.job;
      host.jobs.set(jobId, {
        jobId,
        status: "queued",
        publicationStarted: false,
        facts: null,
        outcome: null,
        progress: null,
      });
      inner.exportJobs.set(jobId, {
        destination: String(p.destination),
        // A copy starts 1 s early (on a "keyframe"), the player's own way of
        // saying the start moved; a re-encode starts on the frame.
        clip: clip
          ? {
              start:
                kind === "rawCopy"
                  ? Math.max(0, snapshot.time - 1)
                  : snapshot.time,
              end: Number(p.end),
              container:
                kind !== "rawCopy"
                  ? null
                  : p.container === "mkv"
                    ? "mkv"
                    : "mp4",
            }
          : null,
      });
      return { jobId, status: "queued", snapshotId: p.snapshotId! };
    },
    // Each read advances a job one step: queued → running → completed. A
    // clip reports half its progress while running.
    "jobs.state": (p) => {
      const job = host.jobs.get(Number(p.jobId));
      if (!job) throw new HostError("missing", "job");
      const current = structuredClone(job);
      const made = inner.exportJobs.get(job.jobId);
      const clip = made?.clip;
      const join = made?.join;
      if (job.status === "queued") {
        job.status = "running";
        if (clip) {
          const total = clip.end - clip.start;
          job.progress = { done: total / 2, total };
        }
        // A join is half written: in its middle part.
        if (join)
          job.progress = {
            done: join.total / 2,
            total: join.total,
            part: Math.ceil(join.parts / 2),
            parts: join.parts,
          };
      } else if (
        job.status === "running" &&
        join &&
        !host.exportFailure &&
        join.tokens.some((token) => status(token) !== "ok")
      ) {
        // As the player: a part whose file went or changed ends the job.
        const index = join.tokens.findIndex((token) => status(token) !== "ok");
        const gone = status(join.tokens[index]!) === "missing";
        Object.assign(job, {
          status: "failed",
          outcome: {
            error: {
              code: gone ? "source-missing" : "source-changed",
              message: `part ${index + 1} ${gone ? "is missing" : "changed since it was added"}`,
            },
          },
        });
      } else if (job.status === "running" && join && !host.exportFailure) {
        const destination =
          join.mode === "copy"
            ? made!.destination.replace(
                /(\.(mp4|m4v|mov|mkv|webm))?$/i,
                `.${join.container}`,
              )
            : made!.destination;
        Object.assign(job, {
          status: "completed",
          publicationStarted: true,
          facts: {
            join: {
              mode: join.mode,
              container: join.container,
              parts: join.written,
              target: null,
            },
          },
          outcome: { destination },
          progress: { done: join.total, total: join.total },
        });
      } else if (job.status === "running" && host.exportFailure)
        Object.assign(job, {
          status: "failed",
          outcome: { error: { ...host.exportFailure } },
        });
      else if (job.status === "running") {
        const destination =
          clip?.container === "mkv"
            ? made!.destination.replace(/(\.(mp4|m4v|mov|mkv|webm))?$/i, ".mkv")
            : clip?.container === "mp4"
              ? made!.destination.replace(
                  /(\.(mp4|m4v|mov|mkv|webm))?$/i,
                  ".mp4",
                )
              : "/tmp/output";
        Object.assign(job, {
          status: "completed",
          publicationStarted: true,
          outcome: clip
            ? { destination, start: clip.start, end: clip.end }
            : { destination },
          ...(job.progress
            ? {
                progress: {
                  done: job.progress.total,
                  total: job.progress.total,
                },
              }
            : {}),
        });
      } else if (job.status === "cancelling")
        Object.assign(job, {
          status: "cancelled",
          outcome: { cancelled: true },
        });
      return current;
    },
    "jobs.cancel": (p) => {
      const job = host.jobs.get(Number(p.jobId));
      if (!job) throw new HostError("missing", "job");
      if (["completed", "failed", "cancelled"].includes(job.status))
        return { jobId: job.jobId, cancel: "terminal" };
      job.status = "cancelling";
      return { jobId: job.jobId, cancel: "requested" };
    },
    "jobs.operation": () => ({ status: "unknown" }),
    "media.sources.reference": (p) => {
      const path = host.source.source;
      if (
        p.expected !== undefined &&
        ((p.expected as SourceStamp).generation !==
          host.source.stamp.generation ||
          (p.expected as SourceStamp).intentVersion !==
            host.source.stamp.intentVersion)
      )
        throw new HostError("stale", "source intent changed");
      if (
        !path ||
        path.includes("://") ||
        !["ready", "ended"].includes(host.source.phase) ||
        host.mediaFiles.get(path)?.status === "missing"
      )
        throw new HostError(
          "unsupported",
          "only a local file can be referenced",
        );
      // The same file as it is (path, size and time: `version`): its token.
      for (const [token, reference] of host.sourceReferences)
        if (
          reference.path === path &&
          (reference.version ?? 0) === version(path)
        )
          return describe(token);
      if (host.sourceReferences.size >= 500)
        throw new HostError("limit", "a plugin holds at most 500 references");
      const token = `src-${randomBytes(16).toString("hex")}`;
      host.sourceReferences.set(token, { path, version: version(path) });
      return describe(token);
    },
    "media.sources.resolve": (p) => describe(known(p.token)),
    "media.sources.list": () => [...host.sourceReferences.keys()].map(describe),
    "media.sources.forget": (p) =>
      void host.sourceReferences.delete(String(p.token)),
    // The player's own dialog: answered from `dialogAnswers` like a file
    // dialog (a one-path array picks that file, `null` cancels).
    "media.sources.locate": (p) => {
      const token = known(p.token);
      const answer = host.dialogAnswers.shift();
      if (answer === undefined)
        throw new Error("test host: no dialog answer queued");
      if (answer !== null && !Array.isArray(answer))
        throw new Error("test host: a confirm answer was queued");
      if (answer === null) return null;
      host.sourceReferences.set(token, {
        path: answer[0]!,
        version: version(answer[0]!),
      });
      return describe(token);
    },
    "jobs.check": (p) => {
      if (p.snapshotId === undefined)
        return exportCheck(p.parts as ExportPartWire[]);
      // A snapshot's clip: one part from the current file's facts.
      const snapshot = host.snapshots.get(Number(p.snapshotId)) as
        | { kind: string; time: number; duration: number; source: string }
        | undefined;
      if (!snapshot)
        throw new HostError("unknown-expired", "snapshot unavailable");
      const end = Number(p.end);
      if (!(end > snapshot.time && end <= snapshot.duration))
        throw new HostError(
          "invalid",
          "end must be after the snapshot time and within its duration",
        );
      const file = facts(snapshot.source);
      const fps = file.video?.fps ?? 30;
      const processed = snapshot.kind === "processed";
      return {
        blocking: file.video ? [] : [{ part: 0, problem: "noVideo" }],
        copy: processed
          ? {
              ok: false,
              reasons: [
                { part: 0, field: "effects", value: null, expected: null },
              ],
            }
          : { ok: true, container: "mp4" },
        encode: file.video
          ? {
              width: processed ? 1920 : file.video.width,
              height: processed ? 1080 : file.video.height,
              fps,
              audio: file.audio ? { sampleRate: 48000, channels: 2 } : null,
            }
          : null,
        duration: end - snapshot.time,
      } satisfies WireExportCheck;
    },
  };
  /** `jobs.start { parts }`: an export of remembered files' parts. */
  function startParts(p: Record<string, Json>) {
    const parts = p.parts as ExportPartWire[];
    const copy = p.kind === "rawCopy";
    if (
      !Array.isArray(parts) ||
      parts.length === 0 ||
      parts.length > 100 ||
      parts.some((part) => !(part.end > part.start)) ||
      parts.reduce((sum, part) => sum + (part.end - part.start), 0) > 86400 ||
      !["rawCopy", "rawMp4"].includes(String(p.kind)) ||
      p.snapshotId !== undefined ||
      p.end !== undefined ||
      p.sampleTime !== undefined ||
      p.quality !== undefined ||
      (p.encoding !== undefined && (copy || !validEncoding(p.encoding))) ||
      (p.container !== undefined && !copy)
    )
      throw new HostError("invalid", "invalid export of parts");
    parts.forEach((part, index) => {
      if (!host.sourceReferences.has(part.source))
        throw new HostError(
          "missing",
          `part ${index} names no source reference of this plugin`,
        );
    });
    const checked = exportCheck(parts);
    host.exports.push(structuredClone(p));
    const jobId = ++inner.next.job;
    host.jobs.set(jobId, {
      jobId,
      status: "queued",
      publicationStarted: false,
      facts: null,
      outcome: null,
      progress: null,
    });
    inner.exportJobs.set(jobId, {
      destination: String(p.destination),
      clip: null,
      join: {
        tokens: parts.map((part) => part.source),
        parts: parts.length,
        total: checked.duration,
        mode: copy ? "copy" : "mp4",
        container: !copy
          ? "mp4"
          : p.container === "mkv" ||
              (p.container !== "mp4" &&
                checked.copy.ok &&
                checked.copy.container === "mkv")
            ? "mkv"
            : "mp4",
        // A copy starts each part on a "keyframe" 1 s early, as clips do.
        written: parts.map((part) => ({
          start: copy ? Math.max(0, part.start - 1) : part.start,
          end: part.end,
        })),
      },
    });
    return { jobId, status: "queued" };
  }
  return {
    ...handlers,
    "producer.prepare": async () => {
      const id = ++inner.next.producer;
      const tcp = host.producerTransport === "tcp";
      const token = tcp ? randomBytes(32) : null;
      // A Unix socket, or a named pipe on Windows (`localSocketPath`).
      const path = localSocketPath(inner.scratch, `producer-${id}`);
      const producer = {
        id,
        receivedFrames: 0,
        videoFrames: 0,
        released: false,
        retired: false,
        droppedWhileSelected: false,
        path,
        admitted: !tcp,
        epoch: 1,
        pending: null as Json | null,
        acknowledged: true,
        active: false,
        server: createServer(),
      };
      producer.server.on("connection", (socket) => {
        let buffer: Buffer = Buffer.alloc(0);
        let admitted = !token;
        socket.on("data", (data: Buffer) => {
          buffer = Buffer.concat([buffer, data]);
          if (!admitted && token) {
            if (buffer.length < token.length) return;
            if (!buffer.subarray(0, token.length).equals(token))
              return void socket.destroy();
            admitted = producer.admitted = true;
            buffer = buffer.subarray(token.length);
          }
          while (buffer.length >= 32) {
            const length = buffer.readUInt32LE(24);
            if (buffer.length < 32 + length) break;
            if (buffer[4] === 1) producer.receivedFrames += length / 8;
            else producer.videoFrames++;
            buffer = buffer.subarray(32 + length);
          }
        });
        socket.on("error", () => {});
        socket.on("close", () => {
          if (isCurrentProducer(host, inner, producer.id))
            producer.droppedWhileSelected = true;
        });
      });
      let socket = path;
      if (tcp) {
        await new Promise<void>((resolve) =>
          producer.server.listen(0, "127.0.0.1", resolve),
        );
        const { port } = producer.server.address() as { port: number };
        socket = `tcp://127.0.0.1:${port}`;
      } else producer.server.listen(path);
      host.producers.set(id, producer);
      return {
        producerId: id,
        socket,
        ...(token ? { token: token.toString("hex") } : {}),
        epoch: 1,
        sampleRate: 48000,
        channels: 2,
        sampleFormat: "f32le",
        videoFormat: "rgba8",
        maxAudioFrames: 4800,
        audioCapacityFrames: 9600,
        videoCapacity: 8,
      };
    },
    "producer.state": (p) => {
      const producer = host.producers.get(Number(p.producerId));
      if (!producer) throw new HostError("missing", "producer");
      if (producer.retired || producer.released)
        throw new HostError("unavailable", "producer absent");
      const current = isCurrentProducer(host, inner, producer.id);
      return {
        input: null,
        pendingControl: producer.pending,
        producerId: producer.id,
        epoch: producer.epoch,
        acknowledged: producer.acknowledged,
        paused: host.source.paused,
        // The fake device consumes everything immediately.
        consumedFrames: producer.receivedFrames,
        underrunFrames: 0,
        deviceErrors: 0,
        health: "ok",
        xrunEvents: 0,
        deviceChangeEvents: 0,
        errorDetails: [],
        errorOverflow: 0,
        buffer: {},
        receivedFrames: producer.receivedFrames,
        hasVideo: producer.videoFrames > 0,
        error: null,
        active: producer.active && current,
      };
    },
    "producer.ack": (p) => {
      const control = (p.control ?? {}) as Record<string, Json>;
      const producer = host.producers.get(Number(control.producerId));
      if (!producer) throw new HostError("missing", "producer");
      if (producer.retired || producer.released)
        throw new HostError("stale", "producer control changed");
      producer.pending = null;
      producer.acknowledged = true;
      producer.epoch = Number(control.epoch);
      producer.active = true;
      return { status: "acknowledged", control };
    },
    "producer.ackInput": () => ({ status: "acknowledged", sequence: 0 }),
    "producer.release": (p) => {
      const producer = host.producers.get(Number(p.producerId));
      if (!producer) return;
      producer.released = true;
      producer.server.close();
    },
  };
}
