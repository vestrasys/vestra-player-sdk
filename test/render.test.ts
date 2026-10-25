import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import { renderProblem } from "../src/plugin/view.ts";

const capabilities = ["playback.read", "events", "processing.video"];
const state = (handle: { status: { state: string } }) => handle.status.state;
const code = (handle: {
  status: { state: string; error?: { code: string } };
}) => handle.status.error?.code;

async function started(host = new TestHost()) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities, host },
  );
  return { ...result, plugin };
}

function shaderFile() {
  const dir = mkdtempSync(join(tmpdir(), "vestra-shader-"));
  const path = join(dir, "invert.glsl");
  writeFileSync(
    path,
    "//!HOOK MAIN\n//!BIND HOOKED\nvec4 hook() { return HOOKED_tex(HOOKED_pos); }\n",
  );
  return { path, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("renderProblem: the player's ranges and shapes", () => {
  assert.equal(
    renderProblem({
      toneMapping: "bt.2390",
      targetPeak: 203,
      peakDetect: true,
      shaders: ["/a/b.glsl"],
      interpolation: false,
    }),
    null,
  );
  for (const values of [
    { toneMapping: "aces" },
    { targetPeak: 99 },
    { targetPeak: 401 },
    { peakDetect: "yes" },
    { interpolation: 1 },
    { shaders: "a.glsl" },
    { shaders: ["relative.glsl"] },
    { shaders: Array.from({ length: 17 }, (_, i) => `/s/${i}.glsl`) },
    { scale: "ewa" },
    [1],
  ])
    assert.ok(renderProblem(values), JSON.stringify(values));
});

test("video.render: owned by the first caller, merged writes, invalid stays local, dispose restores", async () => {
  const host = new TestHost();
  const shader = shaderFile();
  const { plugin, stop } = await started(host);
  const errors: string[] = [];
  plugin.onError((error) => errors.push(error.code));
  const render = plugin.video.render();
  assert.throws(() => plugin.video.render(), /one render options/);
  await host.settle();
  assert.equal(state(render), "waiting");
  assert.equal(host.videoRender.owner, host.manifestId);
  host.openElsewhere("/hdr.mkv");
  await host.settle();
  assert.equal(state(render), "applied");
  render.set({ toneMapping: "hable", targetPeak: 300 });
  render.set({ shaders: [shader.path], interpolation: true });
  await host.settle();
  assert.deepEqual(host.videoRender.values, {
    toneMapping: "hable",
    targetPeak: 300,
    peakDetect: true,
    shaders: [shader.path],
    interpolation: true,
  });
  const sent = host.sent("video.render.set").length;
  render.set({ targetPeak: 1000 });
  assert.equal(state(render), "failed");
  assert.deepEqual(errors, ["invalid"]);
  assert.equal(host.sent("video.render.set").length, sent, "nothing sent");
  // A file that is gone: the player refuses it.
  render.set({ shaders: ["/nonexistent/vestra.glsl"] });
  await host.settle();
  assert.equal(code(render), "invalid");
  assert.equal(host.videoRender.values.shaders[0], shader.path, "kept");
  await render.dispose();
  assert.equal(host.videoRender.owner, null);
  assert.equal(host.videoRender.values.toneMapping, "auto", "defaults back");
  // The view and the render options are separate handles.
  const view = plugin.video.view();
  const again = plugin.video.render();
  await host.settle();
  assert.equal(state(again), "applied");
  assert.equal(state(view), "applied");
  await stop();
  shader.done();
});

test("video.render: software rendering is unsupported; pushed failures reach the owner", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.videoRender.gpu = false;
  const { plugin, stop } = await started(host);
  const errors: string[] = [];
  plugin.onError((error) => errors.push(error.code));
  const render = plugin.video.render();
  await host.settle();
  assert.equal(state(render), "failed");
  assert.equal(code(render), "unsupported");
  assert.equal(host.videoRender.owner, null, "not taken");
  // GPU again (a test choice; the player never switches back): set retries.
  host.videoRender.gpu = true;
  render.set({ toneMapping: "off" });
  await host.settle();
  assert.equal(state(render), "applied");
  host.failVideoRender("failed", "shader compile failed: ERROR: 0:39: x");
  await host.settle();
  assert.equal(code(render), "failed");
  assert.match(
    render.status.state === "failed" ? render.status.error.message : "",
    /ERROR: 0:39/,
  );
  host.failVideoRender(
    "unsupported",
    "the player switched to software rendering",
  );
  await host.settle();
  assert.equal(code(render), "unsupported");
  assert.deepEqual(errors, ["unsupported", "failed", "unsupported"]);
  await stop();
});

test("video.render: another owner means conflict until it lets go", async () => {
  const host = new TestHost();
  host.setVideoRenderOwner("probe");
  const { plugin, stop } = await started(host);
  plugin.onError(() => {});
  const render = plugin.video.render();
  await host.settle();
  assert.equal(code(render), "conflict");
  host.failVideoRender("failed", "not ours");
  await host.settle();
  assert.equal(code(render), "conflict", "pushes go to the owner only");
  host.setVideoRenderOwner(null);
  render.set({ peakDetect: false });
  await host.settle();
  assert.equal(host.videoRender.owner, host.manifestId);
  assert.equal(host.videoRender.values.peakDetect, false);
  await stop();
});

test("stats: hwdec and transfer pass through, null when absent", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  host.stats = {
    ...host.stats,
    backend: "libmpv · GPU 渲染（OpenGL）",
    video: {
      codec: "hevc",
      width: 3840,
      height: 2160,
      fps: 24,
      hwdec: "videotoolbox",
      transfer: "pq",
    },
  };
  const stats = await plugin.player.stats();
  assert.equal(stats.video?.hwdec, "videotoolbox");
  assert.equal(stats.video?.transfer, "pq");
  host.stats = {
    ...host.stats,
    video: { codec: "h264", width: 1, height: 1, fps: null },
  };
  const older = await plugin.player.stats();
  assert.equal(older.video?.hwdec, null);
  assert.equal(older.video?.transfer, null);
  assert.equal(older.video?.decoding, null);
  await stop();
});

test("stats: presentedFps and decoding pass through; decoding follows hwdec for older players", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  assert.equal(
    (await plugin.player.stats()).presentedFps,
    null,
    "TestHost default",
  );
  host.stats = {
    ...host.stats,
    presentedFps: 29.5,
    video: {
      codec: "av1",
      width: 3840,
      height: 2160,
      fps: 60,
      hwdec: "d3d11va-copy",
      decoding: "hardware",
    },
  };
  let stats = await plugin.player.stats();
  assert.equal(stats.presentedFps, 29.5);
  assert.equal(stats.video?.decoding, "hardware");
  assert.equal(stats.video?.hwdec, "d3d11va-copy");
  // A player before 0.5.1 sends neither: presentedFps is null, decoding comes from hwdec.
  const { presentedFps: _, ...older } = host.stats;
  host.stats = {
    ...older,
    video: { codec: "h264", width: 1, height: 1, fps: 24, hwdec: "no" },
  };
  stats = await plugin.player.stats();
  assert.equal(stats.presentedFps, null);
  assert.equal(stats.video?.decoding, "software");
  host.stats = {
    ...older,
    video: {
      codec: "h264",
      width: 1,
      height: 1,
      fps: 24,
      hwdec: "videotoolbox",
    },
  };
  assert.equal((await plugin.player.stats()).video?.decoding, "hardware");
  await stop();
});
