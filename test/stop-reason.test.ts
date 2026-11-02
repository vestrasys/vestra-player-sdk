// SDK 1.5.54: why the plugin stops (`plugin.stopReason`, the `onDispose`
// cleanups' `DisposeInfo`), TestHost `stop({ reason })` and `disconnect()`,
// the crash guard's `previous-crash` for plugin shaders (player 0.6.3) and
// a temporary directory removal that never fails a test.
import assert from "node:assert/strict";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import { createPlugin } from "../src/plugin/index.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { DisposeInfo, PluginError } from "../src/plugin/types.ts";

async function started(host = new TestHost(), capabilities: string[] = []) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities, host },
  );
  return { ...result, plugin };
}

test("stop reason: stop({ reason }) reaches stopReason and every cleanup", async () => {
  const { plugin, stop } = await started();
  const seen: (DisposeInfo & { during?: string })[] = [];
  const child = plugin.scope();
  child.onDispose((info) => {
    seen.push({ ...info, during: plugin.stopReason });
  });
  plugin.onDispose((info) => {
    seen.push(info);
  });
  // The zero-argument form still works.
  let plain = 0;
  plugin.onDispose(() => {
    plain++;
  });
  assert.equal(plugin.stopReason, undefined, "nothing while running");
  await stop({ reason: "idle" });
  assert.equal(plain, 1);
  assert.deepEqual(seen, [
    { stopping: true, reason: "idle" },
    { stopping: true, reason: "idle", during: "idle" },
  ]);
  assert.equal(plugin.stopReason, "idle");
});

test("stop reason: none from an older player, and a child scope disposed by the plugin", async () => {
  const { plugin, stop } = await started();
  const child = plugin.scope();
  const infos: DisposeInfo[] = [];
  child.onDispose((info) => {
    infos.push(info);
  });
  await child.dispose();
  assert.deepEqual(infos, [{ stopping: false }]);
  plugin.onDispose((info) => {
    infos.push(info);
  });
  await stop();
  assert.deepEqual(infos[1], { stopping: true });
  assert.equal(plugin.stopReason, undefined);
});

test("stop reason: stop works as a then callback (its argument is ignored)", async () => {
  const { plugin, stop } = await started();
  let reason: unknown = "unset";
  plugin.onDispose((info) => {
    reason = info.reason;
  });
  await Promise.resolve().then(stop);
  assert.equal(reason, undefined);
});

test("stop reason: disconnect() is host-lost and requests are refused", async () => {
  const host = new TestHost();
  const { plugin, disconnect } = await started(host, ["ui.osd"]);
  let refused: string | undefined;
  plugin.onDispose(async (info) => {
    assert.equal(info.reason, "host-lost");
    await plugin.osd.show("bye").catch((error: PluginError) => {
      refused = error.code;
    });
  });
  await disconnect();
  assert.equal(plugin.stopReason, "host-lost");
  assert.equal(refused, "disabled");
});

test("stop reason: the runtime keeps known reasons only, and the first one", async () => {
  const host = new TestHost();
  const instance = await createPlugin(
    host,
    { id: "test.plugin", capabilities: [] },
    process.cwd(),
  );
  await instance.dispose({ reason: "restart-everything" });
  assert.equal(instance.plugin.stopReason, undefined, "unknown reads as none");
  await instance.dispose({ reason: "quit" });
  assert.equal(instance.plugin.stopReason, undefined, "the first stop wins");
  host.close();
  const other = await createPlugin(
    new TestHost(),
    { id: "test.plugin", capabilities: [] },
    process.cwd(),
  );
  await other.dispose({ reason: "upgrade" });
  assert.equal(other.plugin.stopReason, "upgrade");
});

test("previous-crash: shader lists and render shaders are refused, clearing works", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await started(host, [
    "playback.read",
    "events",
    "processing.video",
  ]);
  const file = join(plugin.dataDirectory, "a.glsl");
  writeFileSync(file, "//!HOOK MAIN\n");
  host.previousCrash = "plugin shaders are off for this start";
  const errors: string[] = [];
  plugin.onError((error) => errors.push((error as PluginError).code));
  const shaders = plugin.video.shaders("x");
  shaders.set([file]);
  await host.settle();
  assert.equal(shaders.status.state, "failed");
  assert.equal(
    (shaders.status as { error: PluginError }).error.code,
    "previous-crash",
  );
  assert.equal(
    (shaders.status as { error: PluginError }).error.message,
    "plugin shaders are off for this start",
  );
  assert.equal(host.videoShaders.handles.size, 0);
  shaders.clear();
  await host.settle();
  assert.notEqual(shaders.status.state, "failed", "clearing still works");
  const render = plugin.video.render();
  render.set({ shaders: [file] });
  await host.settle();
  assert.equal(
    (render.status as { error?: PluginError }).error?.code,
    "previous-crash",
  );
  render.set({ shaders: [], interpolation: true });
  await host.settle();
  assert.notEqual(render.status.state, "failed", "no shaders: accepted");
  assert.deepEqual(
    errors.filter((code) => code === "previous-crash").length,
    2,
  );
  host.previousCrash = null;
  shaders.set([file]);
  await host.settle();
  assert.notEqual(shaders.status.state, "failed");
  // failVideoShaders takes the code to push (default `failed`).
  host.failVideoShaders("x", "off", "previous-crash");
  await host.settle();
  assert.equal(
    (shaders.status as { error: PluginError }).error.code,
    "previous-crash",
  );
  await stop();
});

test("close: removes the temporary directory and may be called twice", async () => {
  const host = new TestHost();
  const data = host.dataDirectory;
  const { stop } = await started(host);
  assert.ok(existsSync(data));
  await stop();
  assert.ok(!existsSync(data));
  host.close(); // twice: nothing left, nothing thrown
});
