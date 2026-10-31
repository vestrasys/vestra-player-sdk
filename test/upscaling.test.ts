// plugin.video.upscaling (SDK 1.5.37, player 0.5.16): the GPU's video
// upscaler, the video.upscaling capability and TestHost's model of the
// player.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_INFO,
  HostError,
  startPlugin,
  TestHost,
} from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
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

test("video.upscaling: the player's table entry, last; not risky, live", () => {
  const last = HOST_CAPABILITIES.capabilities.at(-1)!;
  assert.deepEqual(last, {
    label: "Upscale the video with the GPU's video upscaler",
    methods: [
      { name: "video.upscaling.state", needs: "video.upscaling" },
      { name: "video.upscaling.set", needs: "video.upscaling" },
    ],
    name: "video.upscaling",
    requires: [],
    residency: "live",
    risky: false,
  });
  assert.deepEqual(hostMethod("video.upscaling.state"), {
    name: "video.upscaling.state",
    needs: "video.upscaling",
  });
  assert.deepEqual(CAPABILITY_INFO["video.upscaling"], {
    apis: ["VideoUpscaling.state", "VideoUpscaling.set"],
    requires: [],
    label: "Upscale the video with the GPU's video upscaler",
    risky: false,
  });
});

test("state and set need video.upscaling and send nothing without it", async () => {
  const { plugin, host, stop } = await started([]);
  await assert.rejects(plugin.video.upscaling.state(), code("capability"));
  await assert.rejects(plugin.video.upscaling.set(true), code("capability"));
  assert.ok(
    !host.calls.some((call) => call.method.startsWith("video.upscaling")),
  );
  assert.equal(host.upscaling.checked, false);
  await stop();
});

test("the default model: available, off, nothing checked until asked", async () => {
  const { plugin, host, stop } = await started(["video.upscaling"]);
  assert.equal(host.upscaling.checked, false, "starting checks nothing");
  assert.deepEqual(await plugin.video.upscaling.state(), {
    available: true,
    reason: null,
    enabled: false,
    requested: false,
    factor: null,
  });
  assert.equal(host.upscaling.checked, true);
  assert.deepEqual(host.calls.at(-1), {
    method: "video.upscaling.state",
    params: {},
  });
  // On: requested at the factor the player would use.
  assert.deepEqual(await plugin.video.upscaling.set(true), {
    available: true,
    reason: null,
    enabled: true,
    requested: true,
    factor: 2,
  });
  assert.deepEqual(host.calls.at(-1), {
    method: "video.upscaling.set",
    params: { enabled: true },
  });
  // A video already shown at its own size: on, nothing requested.
  host.upscaling.factor = 1;
  const state = await plugin.video.upscaling.state();
  assert.equal(state.enabled, true);
  assert.equal(state.requested, false);
  assert.equal(state.factor, null);
  // Off.
  assert.equal((await plugin.video.upscaling.set(false)).enabled, false);
  assert.equal(host.upscaling.enabled, false);
  await stop();
});

test("set refuses a non-boolean before sending it", async () => {
  const { plugin, host, stop } = await started(["video.upscaling"]);
  await assert.rejects(
    plugin.video.upscaling.set("yes" as unknown as boolean),
    code("invalid"),
  );
  assert.ok(!host.calls.some((call) => call.method === "video.upscaling.set"));
  await stop();
});

test("set(true) is unsupported where upscaling cannot work; decoding is accepted", async () => {
  const host = new TestHost();
  host.upscaling.reason = {
    code: "rendering",
    message: "upscaling needs GPU rendering",
  };
  const { plugin, stop } = await started(["video.upscaling"], host);
  const state = await plugin.video.upscaling.state();
  assert.equal(state.available, false);
  assert.deepEqual(state.reason, {
    code: "rendering",
    message: "upscaling needs GPU rendering",
  });
  await assert.rejects(plugin.video.upscaling.set(true), (error: HostError) => {
    assert.equal(error.code, "unsupported");
    assert.match(error.message, /needs GPU rendering/);
    return true;
  });
  assert.equal(host.upscaling.enabled, false, "nothing changed");
  assert.equal((await plugin.video.upscaling.set(false)).enabled, false);
  // A reason that can pass during the run: kept, nothing requested yet.
  host.upscaling.reason = {
    code: "decoding",
    message: "the video is decoded with copy-back",
  };
  const kept = await plugin.video.upscaling.set(true);
  assert.equal(kept.enabled, true);
  assert.equal(kept.requested, false);
  assert.equal(kept.factor, null);
  host.upscaling.reason = null;
  assert.equal((await plugin.video.upscaling.state()).requested, true);
  await stop();
});

test("a refusal injected with handle reaches the plugin", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(["video.upscaling"], host);
  host.handle("video.upscaling.set", () => {
    throw new HostError("backend", "playback worker stopped");
  });
  await assert.rejects(plugin.video.upscaling.set(true), code("backend"));
  await stop();
});
