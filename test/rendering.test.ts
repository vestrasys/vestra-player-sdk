// plugin.rendering (SDK 1.5.35, player 0.5.13): the rendering choice, the
// rendering.manage capability and TestHost's model of the player.
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

test("rendering.manage: the player's table entry, last; rendering.state needs none", () => {
  const last = HOST_CAPABILITIES.capabilities.at(-1)!;
  assert.deepEqual(last, {
    label: "Choose GPU or software rendering and restart the player",
    methods: [
      { name: "rendering.setPreference", needs: "rendering.manage" },
      { name: "rendering.restart", needs: "rendering.manage" },
    ],
    name: "rendering.manage",
    requires: [],
    residency: "none",
    risky: true,
  });
  assert.deepEqual(hostMethod("rendering.state"), {
    name: "rendering.state",
    needs: null,
  });
  assert.deepEqual(CAPABILITY_INFO["rendering.manage"], {
    apis: ["Rendering.setPreference", "Rendering.restartPlayer"],
    requires: [],
    label: "Choose GPU or software rendering and restart the player",
    risky: true,
  });
});

test("state() needs no capability and reports the defaults of a GPU player", async () => {
  const { plugin, host, stop } = await started([]);
  assert.deepEqual(await plugin.rendering.state(), {
    mode: "gpu",
    reason: { code: "default", message: "GPU rendering is the default" },
    preference: "auto",
    nextMode: "gpu",
    nextReason: { code: "default", message: "GPU rendering is the default" },
    restartPending: false,
    gpu: { available: true, reason: null },
  });
  assert.deepEqual(host.calls.at(-1), {
    method: "rendering.state",
    params: {},
  });
  const system = await plugin.app.system();
  assert.equal(system.rendering, "gpu");
  assert.deepEqual(system.renderingReason, {
    code: "default",
    message: "GPU rendering is the default",
  });
  await stop();
});

test("setPreference and restartPlayer need rendering.manage", async () => {
  const { plugin, host, stop } = await started([]);
  await assert.rejects(
    plugin.rendering.setPreference("software"),
    code("capability"),
  );
  await assert.rejects(plugin.rendering.restartPlayer(), code("capability"));
  assert.equal(
    host.calls.some(
      (call) =>
        call.method !== "rendering.state" &&
        call.method.startsWith("rendering."),
    ),
    false,
  );
  assert.equal(host.rendering.preference, "auto");
  await stop();
});

test("setPreference saves the choice; restartPending follows it back and forth", async () => {
  const { plugin, host, stop } = await started(["rendering.manage"]);
  let state = await plugin.rendering.setPreference("software");
  assert.equal(state.mode, "gpu"); // the running player keeps its renderer
  assert.equal(state.preference, "software");
  assert.equal(state.nextMode, "software");
  assert.equal(state.nextReason.code, "preference");
  assert.equal(state.restartPending, true);
  assert.equal(host.rendering.preference, "software");
  assert.deepEqual(host.calls.at(-1), {
    method: "rendering.setPreference",
    params: { preference: "software" },
  });
  state = await plugin.rendering.setPreference("gpu");
  assert.equal(state.nextMode, "gpu");
  assert.equal(state.nextReason.code, "preference");
  assert.equal(state.restartPending, false);
  state = await plugin.rendering.setPreference("auto");
  assert.equal(state.nextReason.code, "default");
  assert.equal(state.restartPending, false);
  await assert.rejects(
    plugin.rendering.setPreference("vulkan" as never),
    code("invalid"),
  );
  await stop();
});

test("GPU unavailable: unsupported without a GPU renderer, unavailable when ruled out", async () => {
  const host = new TestHost();
  host.videoRender.gpu = false;
  host.rendering.startedWith = "software";
  host.rendering.reason = {
    code: "no-gpu-backend",
    message: "This player has no GPU renderer on Windows",
  };
  host.rendering.gpu = { available: false, reason: host.rendering.reason };
  const { plugin, stop } = await started(["rendering.manage"], host);
  let state = await plugin.rendering.state();
  assert.equal(state.mode, "software");
  assert.equal(state.nextMode, "software");
  assert.equal(state.nextReason.code, "no-gpu-backend");
  assert.deepEqual(state.gpu, {
    available: false,
    reason: {
      code: "no-gpu-backend",
      message: "This player has no GPU renderer on Windows",
    },
  });
  assert.equal(
    (await plugin.app.system()).renderingReason?.code,
    "no-gpu-backend",
  );
  await assert.rejects(plugin.rendering.setPreference("gpu"), {
    code: "unsupported",
    message: "This player has no GPU renderer on Windows",
  });
  // "auto" and "software" are always accepted.
  state = await plugin.rendering.setPreference("software");
  assert.equal(state.restartPending, false);
  host.rendering.gpu = {
    available: false,
    reason: {
      code: "denylist",
      message: "Driver 31.0.14005 is on the denylist",
    },
  };
  await assert.rejects(
    plugin.rendering.setPreference("gpu"),
    code("unavailable"),
  );
  assert.equal(host.rendering.preference, "software");
  await stop();
});

test("a run that fell back to software: restartPending stays false while the next start is GPU", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(
    ["processing.video", "playback.read", "events"],
    host,
  );
  host.failVideoRender("unsupported", "A window could not show GPU frames");
  const state = await plugin.rendering.state();
  assert.equal(state.mode, "software");
  assert.deepEqual(state.reason, {
    code: "window-fallback",
    message: "A window could not show GPU frames",
  });
  assert.equal(state.nextMode, "gpu");
  assert.equal(state.restartPending, false);
  await stop();
});

test("restartPlayer is recorded once; a second is busy; refusals can be injected", async () => {
  const { plugin, host, stop } = await started(["rendering.manage"]);
  host.handle("rendering.restart", () => {
    throw new HostError("failed", "the new player could not be started");
  });
  await assert.rejects(plugin.rendering.restartPlayer(), code("failed"));
  assert.equal(host.rendering.restarts, 0);
  host.reset("rendering.restart");
  assert.equal(await plugin.rendering.restartPlayer(), undefined);
  assert.equal(host.rendering.restarts, 1);
  await assert.rejects(plugin.rendering.restartPlayer(), code("busy"));
  assert.equal(host.rendering.restarts, 1);
  await stop();
});

test("an older player refuses the requests as unknown (unsupported)", async () => {
  const { plugin, host, stop } = await started([]);
  host.handle("rendering.state", () => {
    throw new HostError("unsupported", "unknown method");
  });
  await assert.rejects(plugin.rendering.state(), code("unsupported"));
  await stop();
});

/** The how-to's menu item, without the restart part. */
async function gpuItem(plugin: Plugin) {
  let state = await plugin.rendering.state();
  plugin.commands.add({
    id: "gpu-rendering",
    path: ["@settings", "GPU Rendering (Experimental)"],
    checked: () => state.nextMode === "gpu",
    enabled: () => state.gpu.available,
    reason: () => state.gpu.reason?.message ?? null,
    run: async () => {
      const choice = state.nextMode === "gpu" ? "software" : "gpu";
      state = await plugin.rendering.setPreference(choice);
    },
  });
}

test("a GPU menu item: toggling sets restartPending, toggling back clears it", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(gpuItem, {
    capabilities: ["commands", "rendering.manage"],
    host,
  });
  const item = host.command("gpu-rendering");
  assert.equal(item.state.checked, true); // "auto" on a GPU player
  await item.run();
  assert.equal(host.rendering.preference, "software");
  assert.equal(item.state.checked, false);
  assert.equal((await plugin.rendering.state()).restartPending, true);
  await item.run();
  assert.equal(host.rendering.preference, "gpu");
  assert.equal(item.state.checked, true);
  assert.equal((await plugin.rendering.state()).restartPending, false);
  await stop();
});

test("a GPU menu item: disabled with the player's reason when GPU is ruled out", async () => {
  const host = new TestHost();
  host.rendering.gpu = {
    available: false,
    reason: {
      code: "previous-crash",
      message: "GPU rendering crashed at the last start",
    },
  };
  const { stop } = await startPlugin(gpuItem, {
    capabilities: ["commands", "rendering.manage"],
    host,
  });
  await host.settle();
  const item = host.command("gpu-rendering");
  assert.equal(item.state.enabled, false);
  assert.equal(item.state.checked, false);
  assert.equal(item.state.reason, "GPU rendering crashed at the last start");
  await assert.rejects(item.run(), { code: "command" }); // disabled
  await stop();
});
