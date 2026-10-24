import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { Panel } from "../src/plugin/types.ts";

/** A package with one panel file, `ui.mount` and `events`. */
function packageWith(id = "test.list") {
  const directory = mkdtempSync(join(tmpdir(), "tabs-"));
  writeFileSync(
    join(directory, "list.slint"),
    "export global ListBridge { in property <bool> tabbed; }\nexport component List inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id, capabilities: ["ui.mount", "events", "commands"] }),
  );
  return directory;
}

test("a second sidebar panel is a tab: ready resolves, state says otherTab", async () => {
  const host = new TestHost();
  host.mountOther("sidebar", "vestra.playlist", { title: "播放列表" });
  let list!: Panel;
  const seen: (string | null)[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      list = plugin.panels.mount("sidebar", "list.slint", {
        title: "Example list",
      });
      list.onChange((state) => seen.push(state?.reason ?? null));
    },
    { host, directory: packageWith() },
  );
  await list.ready;
  await host.settle();
  assert.deepEqual(list.state, {
    active: false,
    preferred: true,
    effective: false,
    reason: "otherTab",
    detached: false,
  });
  assert.deepEqual(plugin.panels.sidebar.panels, [
    { plugin: "vestra.playlist", title: "播放列表", active: true },
    { plugin: "test.list", title: "Example list", active: false },
  ]);
  // A menu on a background tab is refused.
  const item = plugin.commands.add({ id: "x", title: "X", run: () => {} });
  await assert.rejects(list.showMenu([item], { x: 1, y: 1 }), {
    code: "unavailable",
  });
  // The user clicks the tab.
  host.selectTab("test.list");
  await host.settle();
  assert.equal(list.state?.active, true);
  assert.equal(list.state?.effective, true);
  assert.equal(seen.at(-1), null);
  await list.showMenu([item], { x: 1, y: 1 });
  // The other tab goes away: this one stays current.
  host.unmountOther("vestra.playlist");
  await host.settle();
  assert.equal(plugin.panels.sidebar.panels?.length, 1);
  await stop();
});

test("Panel.toggle brings a background tab forward, hides a shown one, shows a hidden one", async () => {
  const host = new TestHost();
  host.mountOther("sidebar", "vestra.playlist");
  let list!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      list = plugin.panels.mount("sidebar", "list.slint");
    },
    { host, directory: packageWith() },
  );
  const sidebar = plugin.panels.sidebar;
  await list.toggle();
  assert.equal(host.layout.sidebar?.owner, 1, "now the current tab");
  assert.equal(host.layout.sidebar?.preferred, true, "the sidebar stays shown");
  await list.toggle();
  assert.equal(host.layout.sidebar?.preferred, false);
  assert.equal(list.state?.reason, "userHidden");
  // Hidden with the other tab current: toggle shows this one.
  await sidebar.activate("vestra.playlist");
  assert.equal(list.state?.reason, "otherTab");
  await list.toggle();
  assert.deepEqual(
    [host.layout.sidebar?.preferred, host.layout.sidebar?.owner],
    [true, 1],
  );
  await sidebar.activate("vestra.playlist");
  await list.show();
  assert.equal(list.state?.effective, true);
  await assert.rejects(sidebar.activate("nobody"), { code: "missing" });
  await stop();
});

test("a taken bottom bar or backdrop rejects ready with conflict but activation succeeds", async () => {
  const host = new TestHost();
  host.mountOther("bottom", "vestra.playback");
  let bar!: Panel;
  const started = await startPlugin(
    (plugin: Plugin) => {
      bar = plugin.panels.mount("bottom", "list.slint");
    },
    { host, directory: packageWith() },
  );
  await assert.rejects(bar.ready, {
    code: "conflict",
    message: "底栏已被 vestra.playback 使用",
  });
  assert.equal(bar.state, null);
  await started.stop();

  const other = new TestHost();
  other.mountOther("backdrop", "vestra.visualizer");
  let backdrop!: Panel;
  const second = await startPlugin(
    (plugin: Plugin) => {
      backdrop = plugin.panels.mount("backdrop", "list.slint");
    },
    { host: other, directory: packageWith() },
  );
  await assert.rejects(backdrop.ready, { code: "conflict" });
  await second.stop();
});

test("a sole panel's state is its position's, and the backdrop cannot be shown by a plugin", async () => {
  let list!: Panel;
  let backdrop: Panel | undefined;
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      list = plugin.panels.mount("sidebar", "list.slint");
    },
    { directory: packageWith() },
  );
  // Read when first used, like `PanelSlot.state`.
  const first = list.state;
  assert.equal(first, null);
  await host.settle();
  assert.deepEqual(list.state, {
    active: true,
    preferred: true,
    effective: true,
    reason: null,
    detached: false,
  });
  await list.toggle();
  assert.equal(list.state?.reason, "userHidden");
  await list.dispose();
  assert.equal(list.state, null);
  await stop();
  const second = await startPlugin(
    (plugin: Plugin) => {
      backdrop = plugin.panels.mount("backdrop", "list.slint");
    },
    { directory: packageWith() },
  );
  void backdrop?.state;
  await second.host.settle();
  assert.equal(backdrop?.state?.effective, true);
  await assert.rejects(backdrop!.show(), { code: "invalid" });
  await second.stop();
});
