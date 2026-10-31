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
import type { UpscalingState } from "../src/plugin/types.ts";
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
// The default model's monitoring fields (player 0.5.25): 1080p on a 4K area.
const monitoring = (inChain: boolean) => ({
  video: { width: 1920, height: 1080, displayWidth: 1920, displayHeight: 1080 },
  area: { width: 3840, height: 2160 },
  gpu: "NVIDIA GeForce RTX 4070 Laptop GPU",
  hwdecCurrent: "d3d11va",
  inChain,
});

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
    apis: [
      "VideoUpscaling.state",
      "VideoUpscaling.set",
      "VideoUpscaling.onChange",
    ],
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
    ...monitoring(false),
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
    ...monitoring(true),
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

test("set(false) checks nothing; before any check it reports unchecked", async () => {
  const { plugin, host, stop } = await started(["video.upscaling"]);
  const state = await plugin.video.upscaling.set(false);
  assert.equal(host.upscaling.checked, false, "no GPU check");
  assert.equal(state.available, false);
  assert.equal(state.reason?.code, "unchecked");
  assert.equal(state.enabled, false);
  // The first state() checks.
  assert.equal((await plugin.video.upscaling.state()).available, true);
  assert.equal(host.upscaling.checked, true);
  await stop();
});

test("set(true) keeps the request while GPU rendering is still starting", async () => {
  const host = new TestHost();
  host.upscaling.reason = {
    code: "rendering",
    message: "upscaling needs GPU rendering, which is starting",
  };
  host.upscaling.renderingStarting = true;
  const { plugin, stop } = await started(["video.upscaling"], host);
  const kept = await plugin.video.upscaling.set(true);
  assert.equal(kept.enabled, true);
  assert.equal(kept.requested, false);
  // Software rendering for the rest of the run: refused.
  host.upscaling.renderingStarting = false;
  await plugin.video.upscaling.set(false);
  await assert.rejects(plugin.video.upscaling.set(true), code("unsupported"));
  await stop();
});

// ------------------------------------------------ SDK 1.5.43, player 0.5.25

test("a decoding reason says its cause; copy-back names the plugins", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(["video.upscaling"], host);
  const video = { id: "vestra.video", name: "Picture Adjustments" };
  for (const [cause, current] of [
    ["copy-back", "d3d11va-copy"],
    ["hwdec-off", "no"],
    ["software", "no"],
    ["other-hwdec", "nvdec"],
  ] as const) {
    const faked = host.upscalingDecoding(cause, [video]);
    const state = await plugin.video.upscaling.state();
    assert.equal(state.available, false);
    assert.equal(state.reason?.code, "decoding");
    assert.equal(state.reason?.cause, cause);
    assert.deepEqual(state.reason, faked);
    assert.equal(state.hwdecCurrent, current);
    // Plugins only with copy-back, as the player sends them.
    if (cause === "copy-back") {
      assert.deepEqual(state.reason?.plugins, [video]);
      assert.match(
        state.reason!.message,
        /because the video filter of Picture Adjustments needs the frames in memory/,
      );
    } else assert.equal(state.reason && "plugins" in state.reason, false);
    // Decoding can pass: set(true) keeps the request.
    assert.equal((await plugin.video.upscaling.set(true)).enabled, true);
    await plugin.video.upscaling.set(false);
  }
  // Copy-back nobody's filter chose: an empty list.
  host.upscalingDecoding("copy-back");
  assert.deepEqual((await plugin.video.upscaling.state()).reason?.plugins, []);
  await stop();
});

test("onChange needs video.upscaling and delivers the state with this plugin's enabled", async () => {
  const none = await started([]);
  assert.throws(
    () => none.plugin.video.upscaling.onChange(() => {}),
    code("capability"),
  );
  await none.stop();

  const host = new TestHost();
  const { plugin, stop } = await started(["video.upscaling"], host);
  const seen: UpscalingState[] = [];
  const watch = plugin.video.upscaling.onChange((state) => seen.push(state));
  await host.settle();
  assert.ok(host.listening.has("video.upscaling.changed"));
  assert.deepEqual(
    host.calls.find((c) => c.method === "events.subscribe")?.params.event,
    "video.upscaling.changed",
  );
  await plugin.video.upscaling.set(true);
  host.upscaling.area = { width: 2560, height: 1440 };
  host.upscaling.factor = 1.33;
  host.upscalingChanged();
  await host.settle();
  assert.deepEqual(
    [...seen],
    [
      {
        available: true,
        reason: null,
        requested: true,
        factor: 1.33,
        ...monitoring(true),
        area: { width: 2560, height: 1440 },
        enabled: true,
      },
    ],
  );
  // Off, then the copy-back cause arrives with the plugins.
  await plugin.video.upscaling.set(false);
  host.upscalingDecoding("copy-back", [
    { id: "vestra.video", name: "Picture Adjustments" },
  ]);
  host.upscalingChanged();
  await host.settle();
  const last = seen[seen.length - 1];
  assert.equal(last?.enabled, false);
  assert.deepEqual(last?.reason?.plugins, [
    { id: "vestra.video", name: "Picture Adjustments" },
  ]);
  await watch.dispose();
  await host.settle();
  assert.ok(!host.subscriptions.has("video.upscaling.changed"));
  host.upscalingChanged();
  await host.settle();
  assert.equal(seen.length, 2, "nothing after dispose");
  await stop();
});

test("video.upscaling.changed needs video.upscaling (the player's table)", () => {
  // The event needs video.upscaling, not events.
  const needs = hostMethod("events.subscribe")?.needs as {
    cases: Record<string, string | null>;
  };
  assert.equal(needs.cases["video.upscaling.changed"], "video.upscaling");
});
