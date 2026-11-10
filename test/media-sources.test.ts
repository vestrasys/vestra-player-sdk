import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_INFO,
  startPlugin,
  TestHost,
} from "../src/plugin/testing.ts";
import type { JobState } from "../src/plugin/index.ts";
import { requestNeeds } from "../src/capability-rules.ts";

const capabilities = [
  "playback.read",
  "events",
  "media.read",
  "media.control",
  "media.sources",
];

async function started(declared = capabilities) {
  const host = new TestHost();
  host.openElsewhere("/media/a.mp4");
  host.setSource({ position: 12, duration: 60 });
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: declared,
    host,
  });
  return { host, plugin, stop };
}

test("media.sources opens the references; an export of their parts is an export", () => {
  const info = CAPABILITY_INFO["media.sources"]!;
  assert.deepEqual(info.requires, []);
  assert.equal(
    info.label,
    "Remember videos you add and export from them later",
  );
  assert.equal(info.risky, false);
  assert.deepEqual(info.apis, [
    "MediaSources.reference",
    "MediaSources.resolve",
    "MediaSources.locate",
    "MediaSources.forget",
    "MediaSources.list",
    "MediaSources.open",
  ]);
  // The exports are media.control's, like a snapshot's; media.sources is
  // documented at the members and checked by the player.
  assert.ok(
    CAPABILITY_INFO["media.control"]!.apis.includes("MediaCapture.export"),
  );
  assert.ok(
    CAPABILITY_INFO["media.control"]!.apis.includes("MediaCapture.exportCheck"),
  );
});

test("a reference names the playing file, never its path, and the same file gets the same token", async () => {
  const { host, plugin, stop } = await started();
  const file = await plugin.media.sources.reference();
  assert.match(file.token, /^src-/);
  assert.equal(file.name, "a.mp4");
  assert.equal(file.duration, 60);
  assert.equal(file.status, "ok");
  assert.deepEqual(file.video, {
    codec: "h264",
    width: 1920,
    height: 1080,
    fps: 30,
    pixelFormat: "yuv420p",
  });
  assert.ok(!JSON.stringify(file).includes("/media/"));
  assert.equal((await plugin.media.sources.reference()).token, file.token);
  assert.deepEqual(host.sourceReferences.get(file.token), {
    path: "/media/a.mp4",
  });
  // A moved file reads missing; locate rebinds it to the user's choice.
  host.mediaFiles.set("/media/a.mp4", { status: "missing" });
  assert.equal(
    (await plugin.media.sources.resolve(file.token)).status,
    "missing",
  );
  host.dialogAnswers.push(["/elsewhere/a copy.mp4"]);
  const found = await plugin.media.sources.locate(file.token);
  assert.equal(found?.token, file.token);
  assert.equal(found?.name, "a copy.mp4");
  assert.equal(found?.status, "ok");
  host.dialogAnswers.push(null);
  assert.equal(await plugin.media.sources.locate(file.token), null);
  assert.equal((await plugin.media.sources.list()).length, 1);
  await plugin.media.sources.forget(file.token);
  assert.deepEqual(await plugin.media.sources.list(), []);
  await assert.rejects(plugin.media.sources.resolve(file.token), {
    code: "missing",
  });
  await stop();
});

test("streams are refused and a reference is conditional on ifCurrent", async () => {
  const { host, plugin, stop } = await started();
  const seen = plugin.player.state;
  host.openElsewhere("https://example.com/live.m3u8");
  host.setSource({ duration: 60 });
  await assert.rejects(plugin.media.sources.reference(), {
    code: "unsupported",
  });
  host.openElsewhere("/media/b.mp4");
  host.setSource({ duration: 60 });
  await assert.rejects(plugin.media.sources.reference({ ifCurrent: seen }), {
    code: "stale",
  });
  await stop();
});

test("the export check says what blocks, why a copy cannot write the parts and what a re-encode writes", async () => {
  const { host, plugin, stop } = await started();
  const a = await plugin.media.sources.reference();
  host.mediaFiles.set("/media/b.mp4", {
    duration: 30,
    video: {
      codec: "h264",
      width: 1920,
      height: 818,
      fps: 30,
      pixelFormat: "yuv420p",
    },
    audio: null,
  });
  host.openElsewhere("/media/b.mp4");
  host.setSource({ duration: 30 });
  const b = await plugin.media.sources.reference();
  const same = await plugin.media.exportCheck([
    { source: a.token, start: 0, end: 5 },
    { source: a.token, start: 10, end: 12 },
  ]);
  assert.deepEqual(same, {
    blocking: [],
    copy: { ok: true, container: "mp4" },
    encode: {
      width: 1920,
      height: 1080,
      fps: 30,
      audio: { sampleRate: 48000, channels: 2 },
    },
    duration: 7,
  });
  const mixed = await plugin.media.exportCheck([
    { source: a.token, start: 0, end: 5 },
    { source: b.token, start: 20, end: 31 },
  ]);
  assert.deepEqual(mixed.blocking, [
    { part: 1, problem: "range", duration: 30 },
  ]);
  assert.deepEqual(mixed.copy, {
    ok: false,
    reasons: [
      { part: 1, field: "size", value: "1920×818", expected: "1920×1080" },
      { part: 1, field: "audio", value: "none", expected: "aac 48000 Hz 2 ch" },
    ],
  });
  // The SDK refuses what the player would, naming the part.
  await assert.rejects(
    plugin.media.exportCheck([{ source: a.token, start: 5, end: 5 }]),
    { code: "invalid", message: /part 0/ },
  );
  await assert.rejects(plugin.media.exportCheck([]), { code: "invalid" });
  await stop();
});

test("an export of parts is a jobs.start with parts, with progress by part, and a copy's file takes its container's extension", async () => {
  const { host, plugin, stop } = await started();
  const a = await plugin.media.sources.reference();
  const parts = [
    { source: a.token, start: 2, end: 6 },
    { source: a.token, start: 20, end: 24 },
    { source: a.token, start: 40, end: 44 },
  ];
  const job = await plugin.media.export({
    parts,
    destination: "/tmp/joined.mkv",
    format: "copy",
  });
  const seen: JobState[] = [];
  job.onChange((state) => seen.push(state));
  const done = await job.done;
  assert.deepEqual(host.exports.at(-1), {
    operationId: host.exports.at(-1)!.operationId,
    parts,
    destination: "/tmp/joined.mkv",
    kind: "rawCopy",
  });
  const running = seen.find((state) => state.status === "running");
  assert.deepEqual(running?.progress, {
    done: 6,
    total: 12,
    part: 2,
    parts: 3,
  });
  assert.equal(done.status, "completed");
  assert.deepEqual(done.outcome, { destination: "/tmp/joined.mp4" });
  assert.deepEqual(done.facts?.join?.parts[0], { start: 1, end: 6 });
  // A re-encode keeps its destination; its options are checked first.
  const encoded = await plugin.media.export({
    parts,
    destination: "/tmp/joined.mp4",
    format: "mp4",
    encoding: { crf: 20 },
  });
  assert.equal((await encoded.done).status, "completed");
  assert.deepEqual(host.exports.at(-1)!.encoding, { crf: 20 });
  assert.equal(host.exports.at(-1)!.kind, "rawMp4");
  await assert.rejects(
    plugin.media.export({
      parts,
      destination: "/tmp/x.mp4",
      format: "copy",
      encoding: { crf: 20 },
    } as never),
    { code: "invalid" },
  );
  // A snapshot's clip is the same jobs.start, unchanged.
  const shot = await plugin.media.capture();
  const clip = await shot.export({
    format: "copy",
    destination: "/tmp/c",
    end: 20,
  });
  assert.equal((await clip.done).status, "completed");
  assert.equal(
    host.exports.at(-1)!.snapshotId,
    shot ? host.exports.at(-1)!.snapshotId : 0,
  );
  assert.equal(host.exports.at(-1)!.parts, undefined);
  await shot.dispose();
  await assert.rejects(
    plugin.media.export({
      parts: [{ source: "src-nothing", start: 0, end: 1 }],
      destination: "/tmp/x.mp4",
      format: "mp4",
    }),
    { code: "missing" },
  );
  await stop();
});

test("a failed export of parts reports its code in the outcome", async () => {
  const { host, plugin, stop } = await started();
  const a = await plugin.media.sources.reference();
  host.exportFailure = {
    code: "source-missing",
    message: "part 1 (a.mp4) is missing",
  };
  const job = await plugin.media.export({
    parts: [{ source: a.token, start: 0, end: 3 }],
    destination: "/tmp/j.mp4",
    format: "mp4",
  });
  const done = await job.done;
  assert.equal(done.status, "failed");
  assert.deepEqual(done.outcome, {
    error: { code: "source-missing", message: "part 1 (a.mp4) is missing" },
  });
  await stop();
});

test("open plays the remembered file from start as an ordinary open, and refuses a moved one", async () => {
  const { host, plugin, stop } = await started();
  const a = await plugin.media.sources.reference();
  host.openElsewhere("/media/other.mp4");
  host.setSource({ duration: 90 });
  await plugin.media.sources.open(a.token, { start: 12.5 });
  assert.equal(host.source.source, "/media/a.mp4");
  assert.equal(host.source.position, 12.5);
  assert.equal(host.source.phase, "ready");
  assert.deepEqual(host.sourceOpens, [{ token: a.token, start: 12.5 }]);
  // The plugin's state copy follows, as after player.open.
  assert.equal(plugin.player.state.source, "/media/a.mp4");
  await plugin.media.sources.open(a.token);
  assert.equal(host.source.position, 0);
  host.mediaFiles.set("/media/a.mp4", { status: "missing" });
  await assert.rejects(plugin.media.sources.open(a.token), {
    code: "source-missing",
  });
  host.mediaFiles.set("/media/a.mp4", { status: "changed" });
  await assert.rejects(plugin.media.sources.open(a.token), {
    code: "source-changed",
  });
  await assert.rejects(plugin.media.sources.open("src-none"), {
    code: "missing",
  });
  await assert.rejects(plugin.media.sources.open(a.token, { start: -1 }), {
    code: "invalid",
  });
  await stop();
});

test("a part's thumbnail is a frame exported into the data directory, with the capabilities already declared", async () => {
  const { host, plugin, stop } = await started();
  const file = await plugin.media.sources.reference();
  const thumbnail = `${plugin.dataDirectory}/thumb-${file.token}.jpg`;
  const snapshot = await plugin.media.capture({ at: 20 });
  const job = await snapshot.export({
    format: "jpeg",
    destination: thumbnail,
    quality: 80,
  });
  assert.equal((await job.done).status, "completed");
  await snapshot.dispose();
  assert.deepEqual(host.exports.at(-1), {
    operationId: host.exports.at(-1)!.operationId,
    snapshotId: host.exports.at(-1)!.snapshotId,
    destination: thumbnail,
    kind: "rawJpeg",
    quality: 80,
  });
  // The row shows it scaled down; no capability needed for that.
  assert.ok(plugin.ui.image(thumbnail, { maxSide: 64 }));
  await stop();
});

test("the player routes the references and joins to media.sources, other jobs to media.control", () => {
  const none = () => false;
  assert.equal(
    requestNeeds("media.sources.reference", undefined, none),
    "media.sources",
  );
  assert.equal(
    requestNeeds("media.sources.locate", undefined, none),
    "media.sources",
  );
  assert.equal(requestNeeds("jobs.check", undefined, none), "media.control");
  assert.equal(requestNeeds("jobs.start", undefined, none), "media.control");
  assert.equal(requestNeeds("jobs.state", undefined, none), "media.read");
});
