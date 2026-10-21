import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import type { Plugin } from "../../sdk/plugin/index.ts";
import { nodeProblem } from "../../sdk/processing.ts";

const capabilities = ["playback.read", "events", "processing.video"];

const state = (view: { status: { state: string } }) => view.status.state;

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

test("frameBlend: integer 24–120, at most one across every chain", async () => {
  assert.equal(
    nodeProblem("video", [{ kind: "frameBlend", fps: 48 } as never]),
    null,
  );
  for (const fps of [23, 121, 47.5, Number.NaN])
    assert.ok(nodeProblem("video", [{ kind: "frameBlend", fps } as never]));
  assert.match(
    nodeProblem("video", [
      { kind: "frameBlend", fps: 48 },
      { kind: "frameBlend", fps: 60 },
    ] as never)!,
    /only one frameBlend/,
  );
  assert.match(
    nodeProblem("audio", [{ kind: "frameBlend", fps: 48 } as never])!,
    /unknown audio node/,
  );

  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await started(host);
  const smooth = plugin.video.filter("smooth");
  smooth.set([{ kind: "frameBlend", fps: 48 }]);
  await host.settle();
  assert.equal(smooth.status.state, "applied");
  // A second filter of the same plugin (or another plugin) cannot add one.
  const again = plugin.video.filter("again");
  again.set([
    { kind: "eq", brightness: 0, contrast: 1, saturation: 1, gamma: 1 },
    { kind: "frameBlend", fps: 60 },
  ]);
  await host.settle();
  assert.equal(again.status.state, "failed");
  assert.equal(
    again.status.state === "failed" && again.status.error.code,
    "invalid",
  );
  // Clearing the first one frees the slot.
  smooth.set([]);
  await host.settle();
  again.retry();
  await host.settle();
  assert.equal(again.status.state, "applied");
  await stop();
});

test("video.view: owned by the first caller, merged writes, invalid stays local, dispose restores", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  const errors: string[] = [];
  plugin.onError((error) => errors.push(error.code));
  const view = plugin.video.view();
  assert.throws(() => plugin.video.view(), /one display layer/);
  await host.settle();
  // No media yet: kept and written, reported as waiting.
  assert.equal(state(view), "waiting");
  assert.equal(host.videoView.owner, host.manifestId);
  const states: string[] = [];
  view.onStatus((status) => states.push(status.state));
  host.openElsewhere("/a.mp4");
  await host.settle();
  assert.equal(state(view), "applied", "applied once media is ready");
  view.set({ aspect: 4 / 3 });
  view.set({ fit: "fill", zoom: 2 });
  await host.settle();
  assert.deepEqual(host.videoView.values, {
    aspect: 4 / 3,
    fit: "fill",
    zoom: 2,
    panX: 0,
    panY: 0,
  });
  assert.equal(state(view), "applied");
  // Out of range: failed at once with invalid, nothing sent, values kept.
  const sent = host.sent("video.view.set").length;
  view.set({ zoom: 5 });
  assert.equal(state(view), "failed");
  assert.deepEqual(errors, ["invalid"]);
  view.set({ scaleX: 1 } as never);
  assert.equal(host.sent("video.view.set").length, sent);
  assert.equal(host.videoView.values.zoom, 2);
  assert.ok(states.includes("applying"));
  await view.dispose();
  assert.equal(host.videoView.owner, null);
  assert.equal(host.videoView.values.zoom, 1, "defaults back");
  // Free again for this plugin.
  const again = plugin.video.view();
  await host.settle();
  assert.equal(again.status.state, "applied");
  await stop();
});

test("video.view: another owner means conflict until it lets go", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setVideoViewOwner("probe");
  const { plugin, stop } = await started(host);
  const errors: string[] = [];
  plugin.onError((error) => errors.push(error.code));
  const view = plugin.video.view();
  await host.settle();
  assert.equal(state(view), "failed");
  assert.equal(
    view.status.state === "failed" && view.status.error.code,
    "conflict",
  );
  view.set({ aspect: 1.5 });
  await host.settle();
  assert.equal(state(view), "failed", "still held");
  host.setVideoViewOwner(null);
  view.set({ fit: "stretch" });
  await host.settle();
  assert.equal(state(view), "applied");
  assert.equal(host.videoView.owner, host.manifestId);
  assert.equal(host.videoView.values.aspect, 1.5, "the merged value");
  assert.deepEqual(errors, ["conflict", "conflict"]);
  await stop();
});
