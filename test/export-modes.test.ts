import assert from "node:assert/strict";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { ExportJob, JobState } from "../src/plugin/index.ts";
import type { Json } from "../src/wire.ts";

const capabilities = ["playback.read", "events", "media.read", "media.control"];

async function started(position = 12) {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({ position, duration: 60 });
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: [...capabilities, "subtitles.read"],
    host,
  });
  return { host, plugin, stop };
}

/** Every state the job goes through, in order. */
async function states(job: ExportJob) {
  const seen: JobState[] = [];
  job.onChange((state) => seen.push(state));
  const done = await job.done;
  return { seen, done };
}

test("a stream copy is a rawCopy job that reports progress and the range written", async () => {
  const { host, plugin, stop } = await started();
  const shot = await plugin.media.capture();
  const job = await shot.export({
    format: "copy",
    destination: "/tmp/clip.mov",
    end: 20,
    container: "mkv",
  });
  const { seen, done } = await states(job);
  assert.deepEqual(host.exports.at(-1), {
    operationId: host.exports.at(-1)!.operationId,
    snapshotId: host.exports.at(-1)!.snapshotId,
    destination: "/tmp/clip.mov",
    kind: "rawCopy",
    end: 20,
    container: "mkv",
  });
  const running = seen.find((state) => state.status === "running");
  assert.deepEqual(running?.progress, { done: 4.5, total: 9 });
  assert.equal(done.status, "completed");
  // TestHost snaps a copy 1 s back, as if to a keyframe; the extension
  // follows the container.
  assert.deepEqual(done.outcome, {
    destination: "/tmp/clip.mkv",
    start: 11,
    end: 20,
  });
  assert.deepEqual(done.progress, { done: 9, total: 9 });
  await stop();
});

test("auto names a copy .mp4 and a re-encode keeps its start", async () => {
  const { host, plugin, stop } = await started();
  const shot = await plugin.media.capture();
  const copy = await (
    await shot.export({ format: "copy", destination: "/tmp/a", end: 15 })
  ).done;
  assert.equal(host.exports.at(-1)!.container, undefined);
  assert.deepEqual(copy.outcome, {
    destination: "/tmp/a.mp4",
    start: 11,
    end: 15,
  });
  const precise = await (
    await shot.export({ format: "mp4", destination: "/tmp/b.mp4", end: 15 })
  ).done;
  assert.deepEqual(precise.outcome, {
    destination: "/tmp/output",
    start: 12,
    end: 15,
  });
  // A frame has no progress and no range.
  const frame = await (
    await shot.export({ format: "png", destination: "/tmp/c.png" })
  ).done;
  assert.equal(frame.progress, null);
  assert.deepEqual(frame.outcome, { destination: "/tmp/output" });
  await stop();
});

test("a copy needs a raw snapshot and a known container", async () => {
  const { plugin, stop } = await started();
  const processed = await plugin.media.capture({
    processed: true,
    subtitles: false,
  });
  await assert.rejects(
    processed.export({ format: "copy", destination: "/tmp/x.mp4", end: 20 }),
    (e: HostError) => e.code === "invalid" && /raw snapshot/.test(e.message),
  );
  const raw = await plugin.media.capture();
  await assert.rejects(
    raw.export({
      format: "copy",
      destination: "/tmp/x.mp4",
      end: 20,
      container: "mov" as "mp4",
    }),
    (e: HostError) => e.code === "invalid",
  );
  await stop();
});

test("encoding options go to the player and are checked against its sets", async () => {
  const { host, plugin, stop } = await started();
  const shot = await plugin.media.capture();
  const encoding = {
    crf: 26,
    speed: "smaller",
    maxHeight: 720,
    fps: 30,
    audioBitrate: 128,
    threads: "auto",
  } as const;
  await (
    await shot.export({
      format: "mp4",
      destination: "/tmp/x.mp4",
      end: 20,
      encoding,
    })
  ).done;
  assert.deepEqual(host.exports.at(-1)!.encoding, encoding);
  // Undefined fields are left out, as JSON would.
  await shot.export({
    format: "mp4",
    destination: "/tmp/y.mp4",
    end: 20,
    encoding: { crf: undefined, fps: 60 },
  });
  assert.deepEqual(host.exports.at(-1)!.encoding, { fps: 60 });
  // "Same as source": a bitrate target instead of a CRF.
  await shot.export({
    format: "mp4",
    destination: "/tmp/s.mp4",
    end: 20,
    encoding: { videoBitrate: "source", maxHeight: 1080 },
  });
  assert.deepEqual(host.exports.at(-1)!.encoding, {
    videoBitrate: "source",
    maxHeight: 1080,
  });
  for (const bad of [
    { crf: 13 },
    { crf: 18.5 },
    { maxHeight: 2160 },
    { fps: 24 },
    { audioBitrate: 320 },
    { speed: "ultrafast" },
    { threads: 4 },
    { preset: "veryfast" },
    { videoBitrate: "5000k" },
    { crf: 20, videoBitrate: "source" },
  ])
    await assert.rejects(
      shot.export({
        format: "mp4",
        destination: "/tmp/z.mp4",
        end: 20,
        encoding: bad as never,
      }),
      (e: HostError) => e.code === "invalid",
      JSON.stringify(bad),
    );
  // TestHost refuses at the wire what the player refuses.
  const snapshotId = Number(host.exports.at(-1)!.snapshotId);
  const wrongs: Record<string, Json>[] = [
    { kind: "rawCopy", encoding: {} },
    { kind: "rawMp4", container: "mkv" },
    { kind: "rawCopy", container: "mov" },
    { kind: "processedCopy" },
    { kind: "rawCopy", end: null },
    { kind: "rawMp4", encoding: { crf: 20, videoBitrate: "source" } },
  ];
  for (const wrong of wrongs)
    await assert.rejects(
      host.request("jobs.start", {
        operationId: 99,
        snapshotId,
        destination: "/tmp/w.mp4",
        end: 20,
        ...wrong,
      }),
      (e: HostError) => e.code === "invalid",
      JSON.stringify(wrong),
    );
  await stop();
});

test("TestHost can make exports fail as the player reports it", async () => {
  const { host, plugin, stop } = await started();
  host.exportFailure = {
    code: "unsupported",
    message: "unsupported: pcm_s16le cannot be stream-copied into MP4",
  };
  const shot = await plugin.media.capture();
  const done = await (
    await shot.export({
      format: "copy",
      destination: "/tmp/x.mp4",
      end: 20,
      container: "mp4",
    })
  ).done;
  assert.equal(done.status, "failed");
  assert.deepEqual(done.outcome, {
    error: {
      code: "unsupported",
      message: "unsupported: pcm_s16le cannot be stream-copied into MP4",
    },
  });
  await stop();
});
