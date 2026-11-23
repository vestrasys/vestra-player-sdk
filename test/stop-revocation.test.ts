// SDK 1.11.0: what TestHost revokes at a plugin's stop is what the
// player revokes (host/lifecycle.rs `stop_run`, `keeps_shown_state`; the
// playback worker's `owner.parked` / `owner.disabled`). The plugin's own
// cleanup requests are not sent after `runtime.stop` (1.11.0).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/types.ts";

function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "revoke-"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.revoke" }),
  );
  return directory;
}

/** A plugin that holds every kind of thing, then the host's view of it. */
async function holding(host: TestHost) {
  host.openElsewhere("/a.mkv");
  host.setSource({ phase: "ready", duration: 60 });
  const started = await startPlugin(
    async (plugin: Plugin) => {
      const layer = plugin.timeline.layer();
      layer.set([{ time: 5, kind: "bookmark", title: "Here" }]);
      layer.setRanges([{ start: 1, end: 2, style: "region" }]);
      await plugin.window.setAlwaysOnTop(true);
      await plugin.window.setCursorAutoHide("playing");
      plugin.video.view().set({ zoom: 2 });
      plugin.video.render().set({ peakDetect: true });
    },
    { host, directory: packageWith() },
  );
  await host.settle();
  assert.equal(host.timeline.layers.has("test.revoke"), true);
  assert.equal(host.timeline.rangeLayers.has("test.revoke"), true);
  assert.equal(host.mainWindow.onTop, true);
  assert.equal(host.mainWindow.cursorAutoHide, "playing");
  assert.equal(host.videoView.owner, "test.revoke");
  assert.equal(host.videoRender.owner, "test.revoke");
  return started;
}

const shown = (host: TestHost) => ({
  layer: host.timeline.layers.has("test.revoke"),
  ranges: host.timeline.rangeLayers.has("test.revoke"),
  onTop: host.mainWindow.onTop,
  cursor: host.mainWindow.cursorAutoHide,
  view: host.videoView.owner,
  render: host.videoRender.owner,
});

test("standby keeps the timeline layer and the window settings, and releases the display layer and render options", async () => {
  const host = new TestHost();
  const { stop } = await holding(host);
  await host.park();
  assert.deepEqual(shown(host), {
    layer: true,
    ranges: true,
    onTop: true,
    cursor: "playing",
    view: null,
    render: null,
  });
  await stop({ reason: "disable" });
  assert.deepEqual(shown(host).layer, false, "the stop after it removes them");
});

for (const reason of [
  undefined,
  "disable",
  "failed",
  "uninstall",
  "reload",
  "upgrade",
  "quit",
  "host-lost",
] as const)
  test(`a stop (${reason ?? "no reason"}) removes everything, the kept state too`, async () => {
    const host = new TestHost();
    const { stop } = await holding(host);
    if (reason === undefined) await stop();
    else await stop({ reason });
    assert.deepEqual(shown(host), {
      layer: false,
      ranges: false,
      onTop: false,
      cursor: "fullscreen",
      view: null,
      render: null,
    });
  });

test("upgrade() removes the kept state as the player's upgrade does", async () => {
  const host = new TestHost();
  await holding(host);
  await host.upgrade(() => {});
  assert.equal(host.timeline.layers.has("test.revoke"), false);
  assert.equal(host.mainWindow.onTop, false);
});
