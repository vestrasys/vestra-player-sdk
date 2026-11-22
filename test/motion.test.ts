// plugin.video.motion (SDK 1.7.19, player 0.8.1): motion smoothing (the
// GPU's frame-rate converter), the video.motion capability and TestHost's
// model of the player.
import assert from "node:assert/strict";
import test from "node:test";
import { HostError, TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { MotionMode, MotionState } from "../src/plugin/types.ts";

async function started(capabilities: string[], host = new TestHost()) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities, host },
  );
  return { ...result, plugin };
}
const code = (expected: string) => (error: HostError) =>
  error.code === expected;

test("the default model: both modes work, off until asked; set applies", async () => {
  const { plugin, host, stop } = await started(["video.motion"]);
  assert.deepEqual(await plugin.video.motion("amd").state(), {
    engine: "amd",
    mode: "off",
    active: "off",
    double: null,
    display: null,
    searchMode: null,
    sourceFps: 24,
    outputFps: null,
    displayFps: 60,
    gpu: "AMD Radeon 780M Graphics",
    inChain: false,
  });
  const state = await plugin.video.motion("amd").set("display");
  assert.equal(state.mode, "display");
  assert.equal(state.active, "display");
  assert.equal(state.searchMode, "native");
  assert.equal(state.outputFps, 48);
  assert.equal(host.motion.mode, "display");
  assert.deepEqual(
    host.calls
      .filter((c) => c.method === "video.motion.set")
      .map((c) => c.params),
    [{ engine: "amd", mode: "display" }],
  );
  assert.equal((await plugin.video.motion("amd").set("off")).active, "off");
  await stop();
});

test("set refuses an unknown mode before sending it", async () => {
  const { plugin, host, stop } = await started(["video.motion"]);
  for (const mode of ["triple", "", 2, null])
    await assert.rejects(
      plugin.video.motion("amd").set(mode as MotionMode),
      code("invalid"),
    );
  assert.ok(!host.calls.some((call) => call.method === "video.motion.set"));
  await stop();
});

test("set is unsupported for a mode that cannot work in this run; passing reasons are kept", async () => {
  const host = new TestHost();
  host.motion.display = {
    code: "rendering",
    message: "Match Display needs GPU rendering",
  };
  host.motion.double = {
    code: "rate",
    message: "24 fps doubled is 48 fps on a 60 Hz display",
  };
  const { plugin, stop } = await started(["video.motion"], host);
  await assert.rejects(
    plugin.video.motion("amd").set("display"),
    (error: HostError) =>
      error.code === "unsupported" &&
      error.message ===
        "motion smoothing cannot work here: Match Display needs GPU rendering",
  );
  assert.equal(host.motion.mode, "off", "nothing changed");
  // A rate can pass with the next video: kept, not active.
  const state = await plugin.video.motion("amd").set("double");
  assert.equal(state.mode, "double");
  assert.equal(state.active, "off");
  assert.equal(state.double?.code, "rate");
  // Starting GPU rendering can pass too.
  host.motion.renderingStarting = true;
  assert.equal(
    (await plugin.video.motion("amd").set("display")).mode,
    "display",
  );
  // No AMD GPU: refused.
  host.motion.double = { code: "no-gpu", message: "no AMD GPU" };
  await assert.rejects(
    plugin.video.motion("amd").set("double"),
    code("unsupported"),
  );
  // Off: always.
  assert.equal((await plugin.video.motion("amd").set("off")).mode, "off");
  await stop();
});

test("onChange delivers the state with this plugin's mode", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(["video.motion"], host);
  const seen: MotionState[] = [];
  const watch = plugin.video
    .motion("amd")
    .onChange((state) => seen.push(state));
  await host.settle();
  assert.ok(host.listening.has("video.motion.changed"));
  await plugin.video.motion("amd").set("double");
  host.motion.performance = true;
  host.motion.outputFps = 47.9;
  host.motionChanged();
  await host.settle();
  assert.deepEqual(seen, [
    {
      engine: "amd",
      active: "double",
      double: null,
      display: null,
      searchMode: "performance",
      sourceFps: 24,
      outputFps: 47.9,
      displayFps: 60,
      gpu: "AMD Radeon 780M Graphics",
      inChain: true,
      mode: "double",
    },
  ]);
  // The player turned it off for this video.
  host.motion.double = {
    code: "overload",
    message: "the GPU could not keep up",
  };
  host.motionChanged();
  await host.settle();
  // (deepEqual above narrowed `seen`.)
  const second = (seen as MotionState[])[1];
  assert.equal(second?.active, "off");
  assert.equal(second?.mode, "double", "the request stays");
  assert.equal(second?.double?.code, "overload");
  await watch.dispose();
  await host.settle();
  assert.ok(!host.subscriptions.has("video.motion.changed"));
  host.motionChanged();
  await host.settle();
  assert.equal(seen.length, 2, "nothing after dispose");
  await stop();
});

test("engines: amd and nvidia each have their own state, others are invalid; events reach their engine only", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(["video.motion"], host);
  assert.throws(() => plugin.video.motion("intel" as "amd"), code("invalid"));
  const nvidia = await plugin.video.motion("nvidia").set("double");
  assert.equal(nvidia.engine, "nvidia");
  assert.equal(nvidia.active, "double");
  assert.equal(nvidia.gpu, "NVIDIA GeForce RTX 4070 Laptop GPU");
  assert.equal(host.nvidiaMotion.mode, "double");
  assert.equal(host.motion.mode, "off", "AMD's engine is another one");
  // A run-long reason refuses the mode, as for AMD.
  host.nvidiaMotion.display = { code: "no-gpu", message: "no NVIDIA GPU" };
  await assert.rejects(
    plugin.video.motion("nvidia").set("display"),
    code("unsupported"),
  );
  assert.equal((await plugin.video.motion("nvidia").set("off")).mode, "off");
  // Each listener hears its own engine's changes.
  const heard: string[] = [];
  plugin.video.motion("nvidia").onChange((state) => heard.push(state.engine));
  plugin.video.motion("amd").onChange((state) => heard.push(state.engine));
  await host.settle();
  host.motionChanged();
  await host.settle();
  assert.deepEqual(heard.sort(), ["amd", "nvidia"]);
  await stop();
});

test("one converter at a time: the other engine's modes wait with other-engine until it is off", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(["video.motion"], host);
  // Another plugin holds AMD's converter.
  host.motion.mode = "double";
  const waiting = await plugin.video.motion("nvidia").set("double");
  assert.equal(waiting.active, "off");
  assert.equal(waiting.double?.code, "other-engine");
  assert.match(String(waiting.double?.message), /^AMD motion smoothing is on/);
  assert.equal(host.nvidiaMotion.mode, "double", "kept: not a run-long reason");
  // AMD's off: NVIDIA's request applies.
  host.motion.mode = "off";
  const running = await plugin.video.motion("nvidia").state();
  assert.equal(running.active, "double");
  assert.equal(running.double, null);
  // Now NVIDIA holds it, and AMD waits.
  host.motion.mode = "double";
  const amd = await plugin.video.motion("amd").state();
  assert.equal(amd.double?.code, "other-engine");
  assert.match(String(amd.double?.message), /^NVIDIA motion smoothing is on/);
  await stop();
});
