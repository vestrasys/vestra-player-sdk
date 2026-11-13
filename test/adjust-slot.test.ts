import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { Panel } from "../src/plugin/types.ts";

/** A package with one panel file, `ui.mount` and `events`. */
function packageWith(id = "test.wheels") {
  const directory = mkdtempSync(join(tmpdir(), "adjust-"));
  writeFileSync(
    join(directory, "wheels.slint"),
    "export global WheelsBridge { in property <float> lift; }\nexport component Wheels inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id, capabilities: [] }),
  );
  return directory;
}

test("an adjust panel is a tab of the adjust column, which starts hidden", async () => {
  const host = new TestHost();
  host.mountOther("adjust", "vestra.video", { title: "Picture" });
  let wheels!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      wheels = plugin.panels.mount("adjust", "wheels.slint", {
        title: "Wheels",
      });
    },
    { host, directory: packageWith() },
  );
  await wheels.ready;
  // The position is read when first used.
  void plugin.panels.adjust.state;
  await host.settle();
  assert.equal(host.mounted().slot, "adjust");
  assert.deepEqual(plugin.panels.adjust.state, {
    preferred: false,
    effective: false,
    reason: "userHidden",
    detached: false,
  });
  assert.deepEqual(plugin.panels.adjust.panels, [
    { plugin: "vestra.video", title: "Picture", active: true },
    { plugin: "test.wheels", title: "Wheels", active: false },
  ]);
  assert.equal(wheels.state?.reason, "otherTab");
  // The sidebar and the adjust column are separate positions.
  assert.equal(plugin.panels.sidebar.state, null);
  await stop();
});

test("Panel.toggle opens the column at this tab and closes it when it is shown", async () => {
  const host = new TestHost();
  host.mountOther("adjust", "vestra.audio", { title: "Audio" });
  let wheels!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      wheels = plugin.panels.mount("adjust", "wheels.slint");
    },
    { host, directory: packageWith() },
  );
  const adjust = plugin.panels.adjust;
  await wheels.toggle();
  assert.deepEqual(
    [host.layout.adjust?.preferred, host.layout.adjust?.owner],
    [true, 1],
  );
  assert.equal(wheels.state?.effective, true);
  assert.deepEqual(host.keepsRunning, ["its adjust tab is the current tab"]);
  await wheels.toggle();
  assert.equal(host.layout.adjust?.preferred, false);
  assert.deepEqual(
    host.keepsRunning,
    [],
    "a closed column keeps nothing running",
  );
  // The position: activate, setVisible, toggle, as the sidebar's.
  await adjust.activate("vestra.audio");
  assert.equal(wheels.state?.reason, "otherTab");
  await adjust.setVisible(true);
  assert.equal(adjust.state?.effective, true);
  await adjust.toggle();
  assert.equal(adjust.state?.preferred, false);
  // It never detaches (the type has no setDetached; the player refuses it).
  const raw = adjust as unknown as {
    setDetached(detached: boolean): Promise<void>;
  };
  await assert.rejects(raw.setDetached(true), { code: "invalid" });
  await stop();
});

test("a player that refuses the slot fails the activation; a layout without adjust reads null", async () => {
  const host = new TestHost();
  // An older player: layout.state has no adjust, ui.mount knows no such slot.
  host.handle("layout.state", () => ({
    bottom: host.layout.bottom,
    sidebar: host.layout.sidebar,
  }));
  host.handle("ui.mount", () => {
    throw new HostError("invalid", "unknown mount slot");
  });
  // A failed mount fails the activation, as any refused mount does: hence
  // `minPlayerVersion: "0.7.6"`, so older players do not load the plugin.
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.panels.mount("adjust", "wheels.slint");
      },
      { host, directory: packageWith() },
    ),
    { code: "invalid" },
  );
  // A layout without `adjust` (no field on the wire) reads as no position.
  // A real older player has no `plugin.panels.adjust` at all: it builds the
  // plugin object with its own SDK.
  const reader = new TestHost();
  reader.handle("layout.state", () => ({
    bottom: reader.layout.bottom,
    sidebar: reader.layout.sidebar,
  }));
  const { plugin, stop } = await startPlugin(() => {}, {
    host: reader,
    directory: packageWith("test.reader"),
  });
  void plugin.panels.adjust.state;
  await reader.settle();
  assert.equal(plugin.panels.adjust.state, null);
  assert.equal(plugin.panels.adjust.panels, null);
  await stop();
});

test("in fullscreen toggle switches a column as in a window; only show() pops it out", async () => {
  const host = new TestHost();
  host.mountOther("sidebar", "vestra.playlist");
  let wheels!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      wheels = plugin.panels.mount("adjust", "wheels.slint");
    },
    { host, directory: packageWith() },
  );
  await wheels.show();
  // Fullscreen: both columns on, collapsed at the right edge.
  host.setMainWindow({ fullscreen: true });
  await host.settle();
  assert.equal(wheels.state?.reason, "fullscreen");
  // Toggle (its key, Alt+n): on, so off; nothing popped out.
  await wheels.toggle();
  assert.deepEqual(
    [host.layout.adjust?.preferred, host.layout.adjust?.reason],
    [false, "userHidden"],
  );
  assert.deepEqual(host.sent("layout.set").at(-1), {
    slot: "adjust",
    visible: false,
  });
  // Toggle again: on, still collapsed; the right edge reveals it.
  await wheels.toggle();
  assert.deepEqual(
    [host.layout.adjust?.preferred, host.layout.adjust?.effective],
    [true, false],
  );
  assert.equal(host.sent("layout.set").at(-1)?.reveal, false);
  host.popSidebar(true);
  await host.settle();
  assert.equal(wheels.state?.effective, true);
  // Popped out and toggled off: in at once.
  await wheels.toggle();
  assert.equal(host.layout.adjust?.effective, false);
  // show() still pops it out, as documented.
  host.popSidebar(false);
  await wheels.show();
  assert.equal(host.layout.adjust?.effective, true);
  // PanelSlot.toggle alike: off, then on without popping out.
  await plugin.panels.sidebar.toggle();
  assert.equal(host.layout.sidebar?.preferred, false);
  await plugin.panels.sidebar.toggle();
  assert.deepEqual(
    [host.layout.sidebar?.preferred, host.layout.sidebar?.effective],
    [true, false],
  );
  await stop();
});
