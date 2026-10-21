import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";

function packageDir(capabilities: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "r3b-"));
  writeFileSync(
    join(directory, "art.slint"),
    "export global Art { in property <image> cover; in property <string> caption; }\nexport component Backdrop inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.r3b", capabilities }),
  );
  return directory;
}

test("timeline: layers merge, last write wins, a new source clears them", async () => {
  const host = new TestHost();
  host.setTimelineLayer("other.plugin", [{ time: 5, kind: "chapter" }]);
  let seen: readonly { time: number }[] = [];
  const errors: PluginError[] = [];
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      seen = p.timeline.marks;
      p.onError((error) => errors.push(error));
    },
    {
      capabilities: ["playback.read", "events", "timeline.marks"],
      host,
    },
  );
  // Read before activation.
  assert.deepEqual(
    seen.map((m) => m.time),
    [5],
  );
  const changes: number[] = [];
  plugin.timeline.onChange((marks) => changes.push(marks.length));
  await host.settle();
  host.openElsewhere("/a.mkv");
  host.setSource({ duration: 60 });
  await host.settle();
  assert.deepEqual(
    plugin.timeline.marks,
    [],
    "a new source clears every layer",
  );
  const layer = plugin.timeline.layer();
  assert.throws(() => plugin.timeline.layer(), /one timeline layer/);
  layer.set([{ time: 30, kind: "bookmark", title: "B" }]);
  layer.set([
    { time: 40, kind: "bookmark", title: "B" },
    { time: 10, kind: "chapter" },
  ]);
  await host.settle();
  assert.deepEqual(plugin.timeline.marks, [
    { time: 10, kind: "chapter", title: null, plugin: "test.plugin" },
    { time: 40, kind: "bookmark", title: "B", plugin: "test.plugin" },
  ]);
  assert.equal(changes.at(-1), 2);
  // Out of range: invalid, to onError; a stale ifCurrent is dropped silently.
  layer.set([{ time: 61, kind: "chapter" }]);
  await host.settle();
  assert.equal(errors.at(-1)?.code, "invalid");
  const before = plugin.player.state;
  host.openElsewhere("/b.mkv");
  await host.settle();
  layer.set([{ time: 1, kind: "marker" }], { ifCurrent: before });
  await host.settle();
  assert.equal(host.timeline.layers.get("test.plugin"), undefined);
  assert.equal(errors.length, 1);
  layer.set([{ time: 1, kind: "marker" }]);
  await host.settle();
  await layer.dispose();
  await host.settle();
  assert.deepEqual(plugin.timeline.marks, []);
  await stop();
});

test("ui.image: wire references, new value per call, released with its scope", async () => {
  const errors: PluginError[] = [];
  const directory = packageDir(["ui.mount", "events"]);
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.onError((error) => errors.push(error));
    },
    { directory },
  );
  const cover = join(plugin.dataDirectory, "cover.png");
  const panel = plugin.panels.mount("backdrop", "art.slint");
  panel.set({ cover: plugin.ui.image(cover), caption: "A" });
  await panel.ready;
  await host.settle();
  assert.equal(host.imagePath(host.mounted().props.cover), cover);
  assert.equal(host.mounted().slot, "backdrop");
  // The same path again is a new value, so a rewritten file is sent again.
  const writes = host.sent("ui.setMount").length;
  panel.set({ cover: plugin.ui.image(cover) });
  await host.settle();
  assert.equal(host.sent("ui.setMount").length, writes + 1);
  assert.equal(host.images.length, 2);
  // A released scope's image is refused before anything is sent.
  const child = plugin.scope();
  const old = child.ui.image(cover);
  await child.dispose();
  panel.set({ cover: old });
  await host.settle();
  assert.equal(errors.at(-1)?.code, "invalid");
  assert.equal(host.sent("ui.setMount").length, writes + 1);
  assert.throws(() => plugin.ui.image(""), /file path/);
  await stop();
});

test("backdrop: one at a time, state follows the player", async () => {
  const host = new TestHost();
  const directory = packageDir(["ui.mount", "events"]);
  const states: (boolean | null)[] = [];
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      p.panels.backdrop.onChange((state) =>
        states.push(state?.effective ?? null),
      );
      p.panels.mount("backdrop", "art.slint");
    },
    { directory, host },
  );
  await host.settle();
  assert.deepEqual(plugin.panels.backdrop.state, { effective: true });
  host.setBackdropEffective(false);
  await host.settle();
  assert.deepEqual(plugin.panels.backdrop.state, { effective: false });
  assert.deepEqual(states, [true, false]);
  assert.deepEqual(host.backdrop, { owner: "test.r3b", effective: false });
  // G-16a: opening the next source shows the backdrop while it loads.
  host.openElsewhere("https://example.com/b.mp4", "loading");
  await host.settle();
  assert.deepEqual(plugin.panels.backdrop.state, { effective: true });
  assert.deepEqual(states, [true, false, true]);
  await stop();
});
