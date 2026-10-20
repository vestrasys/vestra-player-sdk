import assert from "node:assert/strict";
import test from "node:test";
import { HostError } from "../../sdk/index.ts";
import { startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import type { Plugin, VideoFilter } from "../../sdk/plugin/index.ts";
import type { VideoNode } from "../../sdk/processing.ts";

const capabilities = [
  "playback.read",
  "playback.control",
  "events",
  "processing.video",
  "processing.audio",
];
const eq = (brightness: number): VideoNode[] => [
  { kind: "eq", brightness, contrast: 1, saturation: 1, gamma: 1 },
];

async function withFilter(host = new TestHost()) {
  let filter: VideoFilter | undefined;
  const started = await startPlugin(
    (plugin: Plugin) => {
      filter = plugin.video.filter("picture");
    },
    { capabilities, host },
  );
  return { ...started, filter: filter! };
}

test("a filter waits for ready media, then applies the latest value", async () => {
  const { host, filter, stop } = await withFilter();
  filter.set(eq(0.1));
  filter.set(eq(0.2));
  await host.settle();
  assert.equal(filter.status.state, "waiting");
  assert.equal(host.sent("processing.replace").length, 0);
  host.openElsewhere("/a.mp4");
  await host.settle();
  const sent = host.sent("processing.replace");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0]!.nodes, eq(0.2));
  assert.equal(sent[0]!.expectedGeneration, 1);
  assert.equal(filter.status.state, "applied");
  host.openElsewhere("/b.mp4");
  await host.settle();
  assert.equal(
    host.sent("processing.replace").length,
    1,
    "the host replays resources on reload",
  );
  await stop();
});

test("coalesces bursts to one in flight and the newest pending", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { filter, stop } = await withFilter(host);
  for (let i = 1; i <= 20; i++) filter.set(eq(i / 100));
  await host.settle();
  const sent = host.sent("processing.replace");
  assert.ok(sent.length <= 2, `sent ${sent.length}`);
  assert.deepEqual(sent.at(-1)!.nodes, eq(0.2));
  assert.deepEqual(
    sent.map((s) => s.revision),
    sent.map((_, i) => i + 1),
  );
  await stop();
});

test("a refusal is reported once and retried only on request", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.handle("processing.replace", () => {
    throw new HostError("unsupported", "no video stream");
  });
  const { filter, stop } = await withFilter(host);
  const statuses: string[] = [];
  filter.onStatus((status) => statuses.push(status.state));
  filter.set(eq(0.3));
  await host.settle();
  assert.equal(filter.status.state, "failed");
  assert.equal(
    filter.status.state === "failed" && filter.status.error.message,
    "no video stream",
  );
  host.reset("processing.replace");
  filter.retry();
  await host.settle();
  assert.equal(filter.status.state, "applied");
  assert.deepEqual(statuses, ["applying", "failed", "applying", "applied"]);
  await stop();
});

test("a lost reply is resolved with the operation token, never re-sent blindly", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { filter, stop } = await withFilter(host);
  // Executed by the host, but the reply is lost.
  host.handle("processing.replace", async (params) => {
    host.reset("processing.replace");
    await host.request("processing.replace", params);
    throw new Error("reply lost");
  });
  filter.set(eq(0.4));
  await host.settle();
  assert.equal(filter.status.state, "applied");
  assert.equal(host.sent("processing.operation").length, 1);
  // Never admitted: "unknown" means it did not execute; a new revision is safe.
  host.handle("processing.replace", () => {
    host.reset("processing.replace");
    throw new Error("reply lost");
  });
  filter.set(eq(0.5));
  await host.settle(250); // a refused-before-admission resend waits briefly
  assert.equal(filter.status.state, "applied");
  assert.deepEqual(
    host.processing.resources.get("video:picture")?.nodes,
    eq(0.5),
  );
  await stop();
});

test("backend faults surface as a failed status", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.processing.backendUncertain.video = "revocation cleanup uncertain";
  const { filter, stop } = await withFilter(host);
  filter.set(eq(0.1));
  await host.settle();
  assert.equal(filter.status.state, "failed");
  assert.equal(
    filter.status.state === "failed" && filter.status.error.code,
    "backend-uncertain",
  );
  await stop();
});

test("disposing a filter removes only its own contribution", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { filter, stop } = await withFilter(host);
  filter.set(eq(0.1));
  await host.settle();
  await filter.dispose();
  assert.deepEqual(host.processing.resources.get("video:picture")?.nodes, []);
  await stop();
});

test("audio filters carry their delay", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await startPlugin(() => {}, { capabilities, host });
  const filter = plugin.audio.filter("workbench");
  filter.set({ nodes: [{ kind: "volume", gainDb: -3 }], delayMs: 120 });
  await host.settle();
  assert.equal(host.sent("processing.replace")[0]!.offsetMs, 120);
  await stop();
});

test("subtitles: load uploads in chunks, selects, styles and removes", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["subtitles.read", "subtitles.control", "events"],
    host,
  });
  const srt = new Uint8Array(70 * 1024).fill(65);
  const track = await plugin.subtitles.load(srt);
  assert.equal(host.sent("subtitles.upload.append").length, 3);
  assert.equal(track.owned, true);
  assert.equal(plugin.subtitles.state?.selected?.id, track.id);
  const style = {
    fontId: "sans",
    fontSize: 40,
    color: "yellow" as const,
    outline: 2,
    marginPercent: 5,
    offsetMs: 0,
  };
  await plugin.subtitles.setStyle(style);
  assert.deepEqual(plugin.subtitles.state?.style, style);
  const before = plugin.subtitles.state!;
  await plugin.subtitles.select(null);
  await assert.rejects(
    plugin.subtitles.setStyle(null, { ifCurrent: before }),
    (e: HostError) => e.code === "stale",
  );
  await plugin.subtitles.remove(plugin.subtitles.state!.tracks[0]!);
  assert.equal(plugin.subtitles.state?.tracks.length, 0);
  await stop();
});

test("capture freezes the seen source and exports to completion", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({ position: 12, duration: 60 });
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: [
      "playback.read",
      "events",
      "media.read",
      "media.control",
      "subtitles.read",
    ],
    host,
  });
  const seen = plugin.player.state;
  const shot = await plugin.media.capture({
    processed: true,
    subtitles: false,
  });
  assert.equal(shot.kind, "processed");
  assert.equal(shot.time, 12);
  const job = await shot.export({ format: "png", destination: "/tmp/x.png" });
  const done = await job.done;
  assert.equal(done.status, "completed");
  assert.deepEqual(done.outcome, { destination: "/tmp/output" });
  await shot.dispose();
  assert.equal(host.snapshots.size, 0);
  host.openElsewhere("/b.mp4");
  await assert.rejects(
    plugin.media.capture({ ifCurrent: seen }),
    (e: HostError) => e.code === "stale",
  );
  await stop();
});

test("export jobs can be cancelled", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["playback.read", "events", "media.read", "media.control"],
    host,
  });
  const shot = await plugin.media.capture();
  const job = await shot.export({
    format: "mp4",
    destination: "/tmp/x.mp4",
    end: 5,
  });
  assert.equal(await job.cancel(), "requested");
  assert.equal((await job.done).status, "cancelled");
  await stop();
});

test("resolvers register and unregister with their scope", async () => {
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.resolvers.add({
        id: "demo",
        schemes: ["https"],
        hosts: ["example.com"],
        resolve: async (url) => ({
          kind: "media",
          originalUrl: url,
          primary: { url },
        }),
      });
    },
    { capabilities: ["source.resolve"] },
  );
  assert.equal(host.resolvers.has("demo"), true);
  await stop();
  assert.equal(host.resolvers.has("demo"), false);
});
