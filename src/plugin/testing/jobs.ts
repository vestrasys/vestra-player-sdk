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

/** The default handlers of this area's wire methods, by method name. */
export function jobsHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
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
      if (job.status === "queued") {
        job.status = "running";
        if (clip) {
          const total = clip.end - clip.start;
          job.progress = { done: total / 2, total };
        }
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
