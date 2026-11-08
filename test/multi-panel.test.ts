import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { Panel } from "../src/plugin/types.ts";

/** A package with a bar and an adjust panel, `ui.mount` and `events`. */
function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "multi-"));
  writeFileSync(
    join(directory, "bar.slint"),
    "export global BarBridge { in property <string> time; callback seek(float); }\nexport component Bar inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "speed.slint"),
    "export global SpeedBridge { in property <float> rate; callback picked(float); }\nexport component Speed inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "test.playback",
      capabilities: ["ui.mount", "events", "commands"],
    }),
  );
  return directory;
}

test("one plugin mounts the bottom bar and an adjust panel; both work on their own", async () => {
  const host = new TestHost();
  let bar!: Panel;
  let speed!: Panel;
  const seeks: number[] = [];
  const picks: number[] = [];
  let rate = 1;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      bar = plugin.panels.mount("bottom", "bar.slint");
      bar.bind(() => ({ time: "00:10" }));
      bar.on("seek", (to: number) => seeks.push(to));
      speed = plugin.panels.mount("adjust", "speed.slint", { title: "Speed" });
      speed.bind(() => ({ rate }));
      speed.on("picked", (to: number) => {
        picks.push(to);
        rate = to;
      });
    },
    { host, directory: packageWith() },
  );
  await Promise.all([bar.ready, speed.ready]);
  await host.settle();
  // Two panels, each in its slot, each with its own bridge.
  assert.deepEqual([...host.panels.keys()], ["bottom", "adjust"]);
  assert.equal(host.mounted("bottom").props.time, "00:10");
  assert.equal(host.mounted("adjust").props.rate, 1);
  assert.throws(() => host.mounted(), /name the slot/);
  assert.equal(host.layout.adjust?.panels?.[0]?.title, "Speed");
  // A callback reaches the panel it came from.
  host.mounted("adjust").emit("picked", 1.5);
  host.mounted("bottom").emit("seek", 42);
  await host.settle();
  assert.deepEqual([picks, seeks], [[1.5], [42]]);
  assert.equal(host.mounted("adjust").props.rate, 1.5);
  assert.equal(host.mounted("bottom").props.time, "00:10");
  // Locks, state and toggle are per panel.
  speed.setInteraction({ dragging: true });
  await host.settle();
  assert.deepEqual(host.mounted("adjust").locks, {
    focused: false,
    dragging: true,
    popupOpen: false,
  });
  assert.equal(host.mounted("bottom").locks, null);
  await speed.toggle();
  assert.equal(host.layout.adjust?.preferred, true);
  assert.equal(host.layout.bottom?.preferred, true);
  assert.equal(speed.state?.active, true);
  // A second panel in the same slot is refused; another slot is fine.
  assert.throws(
    () => plugin.panels.mount("adjust", "speed.slint"),
    /already has a panel in the adjust/,
  );
  // Disposing one leaves the other.
  await speed.dispose();
  await host.settle();
  assert.deepEqual([...host.panels.keys()], ["bottom"]);
  assert.equal(host.layout.adjust, null);
  assert.equal(host.mounted().slot, "bottom");
  host.mounted().emit("seek", 7);
  await host.settle();
  assert.deepEqual(seeks, [42, 7]);
  // Stopping the plugin unmounts the rest.
  await stop();
  assert.equal(host.panels.size, 0);
});

test("a single panel keeps the old accessors and the old wire (no slot needed)", async () => {
  const host = new TestHost();
  let bar!: Panel;
  await startPlugin(
    (plugin: Plugin) => {
      bar = plugin.panels.mount("bottom", "bar.slint");
      bar.bind(() => ({ time: "00:01" }));
    },
    { host, directory: packageWith() },
  );
  await bar.ready;
  await host.settle();
  assert.equal(host.panel?.slot, "bottom");
  assert.equal(host.mounted().props.time, "00:01");
  // A player before 0.7.6 names only `$mount` in callbacks.
  const seen: number[] = [];
  bar.on("seek", (to: number) => seen.push(to));
  host.emit("ui.callback", { view: "$mount", callback: "seek", args: [3] });
  await host.settle();
  assert.deepEqual(seen, [3]);
});
