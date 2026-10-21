import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import type { Plugin } from "../../sdk/plugin/index.ts";
import { nodeProblem } from "../../sdk/processing.ts";

const capabilities = ["playback.read", "events", "processing.video"];

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
