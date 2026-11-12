// plugin.video.motion (SDK 1.7.19, player 0.8.1): motion smoothing (the
// GPU's frame-rate converter), the video.motion capability and TestHost's
// model of the player.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_INFO,
  HostError,
  startPlugin,
  TestHost,
} from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { MotionMode, MotionState } from "../src/plugin/types.ts";
import { HOST_CAPABILITIES } from "../src/host-capabilities.ts";
import { hostMethod } from "../src/capability-rules.ts";

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

test("video.motion: the player's table entry; not risky, live", () => {
  const entry = HOST_CAPABILITIES.capabilities.find(
    (capability) => capability.name === "video.motion",
  )!;
  assert.deepEqual(entry, {
    label: "Smooth motion with the GPU's frame-rate converter",
    methods: [
      { name: "video.motion.state", needs: "video.motion" },
      { name: "video.motion.set", needs: "video.motion" },
    ],
    name: "video.motion",
    requires: [],
    residency: "live",
    risky: false,
    builtinOnly: false,
  });
  assert.deepEqual(hostMethod("video.motion.set"), {
    name: "video.motion.set",
    needs: "video.motion",
  });
  assert.deepEqual(CAPABILITY_INFO["video.motion"], {
    apis: ["VideoMotion.state", "VideoMotion.set", "VideoMotion.onChange"],
    requires: [],
    label: "Smooth motion with the GPU's frame-rate converter",
    risky: false,
    builtinOnly: false,
  });
  // The event needs video.motion, not events.
  const needs = hostMethod("events.subscribe")?.needs as {
    cases: Record<string, string | null>;
  };
  assert.equal(needs.cases["video.motion.changed"], "video.motion");
});

test("state and set need video.motion and send nothing without it", async () => {
  const { plugin, host, stop } = await started([]);
  await assert.rejects(plugin.video.motion("amd").state(), code("capability"));
  await assert.rejects(
    plugin.video.motion("amd").set("double"),
    code("capability"),
  );
  assert.throws(
    () => plugin.video.motion("amd").onChange(() => {}),
    code("capability"),
  );
  assert.ok(!host.calls.some((call) => call.method.startsWith("video.motion")));
  await stop();
});

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

test("engines: amd works, nvidia is reserved, others are invalid; events reach their engine only", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(["video.motion"], host);
  assert.throws(() => plugin.video.motion("intel" as "amd"), code("invalid"));
  const nvidia = await plugin.video.motion("nvidia").state();
  assert.equal(nvidia.engine, "nvidia");
  assert.equal(nvidia.double?.code, "engine");
  assert.equal(nvidia.display?.code, "engine");
  await assert.rejects(
    plugin.video.motion("nvidia").set("double"),
    code("unsupported"),
  );
  assert.equal((await plugin.video.motion("nvidia").set("off")).mode, "off");
  // A listener of the reserved engine hears nothing of AMD's changes.
  const heard: string[] = [];
  plugin.video.motion("nvidia").onChange((state) => heard.push(state.engine));
  plugin.video.motion("amd").onChange((state) => heard.push(state.engine));
  await host.settle();
  host.motionChanged();
  await host.settle();
  assert.deepEqual(heard, ["amd"]);
  await stop();
});
