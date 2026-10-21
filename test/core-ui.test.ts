import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import { canonical } from "../../sdk/plugin/bindings.ts";
import type { Plugin } from "../../sdk/plugin/index.ts";

function packageWith(
  capabilities: string[],
  files: Record<string, string> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "vestra-core-ui-"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "core.ui", capabilities }),
  );
  for (const [name, text] of Object.entries(files))
    writeFileSync(join(directory, name), text);
  return directory;
}
const panelFile = {
  "side.slint":
    "export global Bridge { callback menu(float, float); }\nexport component Side inherits Rectangle {}",
};

test("binding syntax follows the host rules", () => {
  for (const ok of [
    "Space",
    "Ctrl+O",
    "Ctrl+Alt+Shift+Cmd+F24",
    "Shift+E",
    ">",
    "Plus",
    "Mouse:WheelUp",
    "Mouse:LeftDoubleClick:LeftHalf",
  ])
    assert.equal(canonical(ok), ok);
  for (const bad of [
    "space",
    "Shift+Ctrl+O",
    "Ctrl+Ctrl+O",
    "Shift+>",
    "Shift+1",
    "Ctrl++",
    "F25",
    "Mouse:RightClick",
    "ab",
  ])
    assert.throws(() => canonical(bad), { code: "invalid" }, bad);
});

test("declarations are sent in full with defaults", async () => {
  const { host, plugin, stop } = await startPlugin((plugin: Plugin) => {
    plugin.commands.add({ id: "old", path: ["文件", "旧"], run() {} });
    plugin.commands.add({
      id: "new",
      path: ["打开文件…"],
      order: 100,
      group: "open",
      bindings: ["Ctrl+O", "F3"],
      repeat: true,
      run() {},
    });
    plugin.commands.add({
      id: "hidden",
      title: "全选",
      focus: "panel",
      bindings: ["Ctrl+A"],
      run() {},
    });
  });
  assert.deepEqual(host.command("old").declaration, {
    title: "旧",
    path: ["文件", "旧"],
    order: 0,
    group: "domain",
    radio: false,
    bindings: [],
    focus: null,
    repeat: false,
  });
  assert.deepEqual(host.command("new").declaration, {
    title: "打开文件…",
    path: ["打开文件…"],
    order: 100,
    group: "open",
    radio: false,
    bindings: ["Ctrl+O", "F3"],
    focus: null,
    repeat: true,
  });
  assert.deepEqual(host.command("hidden").declaration, {
    title: "全选",
    path: [],
    order: 0,
    group: "domain",
    radio: false,
    bindings: ["Ctrl+A"],
    focus: "panel",
    repeat: false,
  });
  await host.press("Ctrl+A", { panel: true });
  assert.throws(() => plugin.commands.add({ id: "x", run() {} }), {
    code: "invalid",
  });
  assert.throws(
    () =>
      plugin.commands.add({
        id: "y",
        path: ["a"],
        bindings: ["Shift+>"],
        run() {},
      }),
    { code: "invalid" },
  );
  assert.throws(
    () => plugin.commands.add({ id: "z", path: ["a"], order: 1.5, run() {} }),
    { code: "invalid" },
  );
  await stop();
});

test("slot state is shared and changes through the host; showMenu sends command ids", async () => {
  const directory = packageWith(["ui.mount", "events", "commands"], panelFile);
  let own: ReturnType<Plugin["panels"]["mount"]> | undefined;
  const changes: unknown[] = [];
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      own = plugin.panels.mount("sidebar", "side.slint", { title: "列表" });
      plugin.panels.sidebar.onChange((state) => changes.push(state));
    },
    { directory },
  );
  await own!.ready;
  host.emit("window.state", {});
  await host.settle();
  const sidebar = plugin.panels.sidebar;
  assert.deepEqual(sidebar.state, {
    preferred: true,
    effective: true,
    reason: null,
    detached: false,
  });
  assert.equal(plugin.panels.bottom.state, null);
  await sidebar.toggle();
  assert.equal(sidebar.state?.preferred, false);
  await sidebar.setDetached(true);
  assert.equal(sidebar.state?.detached, true);
  assert.equal(changes.length, 3);
  await assert.rejects(plugin.panels.bottom.setVisible(true), {
    code: "missing",
  });
  const command = plugin.commands.add({
    id: "remove",
    title: "移除",
    run() {},
  });
  await own!.showMenu([command, null], { x: 3, y: 4 });
  assert.deepEqual(host.menus, [{ items: ["remove", null], x: 3, y: 4 }]);
  assert.equal(host.sent("ui.mount")[0]!.title, "列表");
  await stop();
});

test("fullscreen collapses the attached sidebar to the edge; the edge and setVisible pop it out", async () => {
  const directory = packageWith(["ui.mount", "events"], panelFile);
  let own: ReturnType<Plugin["panels"]["mount"]> | undefined;
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      own = plugin.panels.mount("sidebar", "side.slint");
      plugin.panels.sidebar.onChange(() => {});
    },
    { directory },
  );
  await own!.ready;
  const sidebar = plugin.panels.sidebar;
  host.setMainWindow({ fullscreen: true });
  await host.settle();
  assert.deepEqual(sidebar.state, {
    preferred: true,
    effective: false,
    reason: "fullscreen",
    detached: false,
  });
  host.popSidebar(true);
  await host.settle();
  assert.equal(sidebar.state?.effective, true);
  assert.equal(sidebar.state?.reason, null);
  host.popSidebar(false);
  await sidebar.setVisible(false);
  host.popSidebar(true); // Hidden by preference: the edge does nothing.
  await host.settle();
  assert.equal(sidebar.state?.reason, "userHidden");
  await sidebar.setVisible(true); // F6 in fullscreen pops it out at once.
  assert.equal(sidebar.state?.effective, true);
  host.setMainWindow({ fullscreen: false });
  await host.settle();
  assert.deepEqual(sidebar.state, {
    preferred: true,
    effective: true,
    reason: null,
    detached: false,
  });
  await stop();
});

test("osd lines, one osd panel per plugin, cleared on dispose", async () => {
  const directory = packageWith(["ui.osd"]);
  const { host, plugin, stop } = await startPlugin(() => {}, { directory });
  await plugin.osd.show("音量: 80%");
  assert.deepEqual(host.osd, ["音量: 80%"]);
  await assert.rejects(plugin.osd.show(""), { code: "invalid" });
  const scope = plugin.scope();
  const panel = scope.osd.panel();
  assert.throws(() => plugin.osd.panel(), /only one osd panel/);
  panel.set("a\nb");
  await host.settle();
  assert.equal(host.osdPanel, "a\nb");
  await scope.dispose();
  assert.equal(host.osdPanel, null);
  plugin.osd.panel().set("again");
  await host.settle();
  assert.equal(host.osdPanel, "again");
  await stop();
});

test("sequence provider flags follow bindings; next/previous route to it; stats", async () => {
  const host = new TestHost();
  let index = 0;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.player.provideSequence({
        canNext: () => index < 2,
        canPrevious: () => index > 0,
        next: () => void index++,
        previous: () => void index--,
      });
    },
    {
      host,
      directory: packageWith(["playback.read", "playback.control", "events"]),
    },
  );
  await host.settle();
  assert.deepEqual(host.sequence, { canNext: true, canPrevious: false });
  assert.equal(plugin.player.state.can.next, true);
  assert.equal(plugin.player.state.can.previous, false);
  await plugin.player.next();
  await host.settle();
  assert.equal(index, 1);
  assert.deepEqual(host.sequence, { canNext: true, canPrevious: true });
  assert.equal(plugin.player.state.can.previous, true);
  await plugin.player.next();
  await host.settle();
  await assert.rejects(plugin.player.next(), { code: "unavailable" });
  assert.throws(() =>
    plugin.player.provideSequence({
      canNext: false,
      canPrevious: false,
      next() {},
      previous() {},
    }),
  );
  host.stats = { ...host.stats, session: 7 };
  assert.equal((await plugin.player.stats()).session, 7);
  await stop();
  assert.equal(host.sequence, null, "the provider is released on stop");
});

test("dispose removes a command; a list rebuilt in a scope re-adds the same ids", async () => {
  const { host, plugin, stop } = await startPlugin(() => {});
  let tracks = plugin.scope();
  const build = (titles: string[]) =>
    titles.forEach((title, i) =>
      tracks.commands.add({
        id: `track.${i}`,
        path: ["字幕", "选择字幕", title],
        order: 300 + i,
        run() {},
      }),
    );
  build(["中文", "English"]);
  await host.settle();
  assert.deepEqual([...host.commands.keys()], ["track.0", "track.1"]);
  await tracks.dispose();
  tracks = plugin.scope();
  build(["日本語"]);
  await host.settle();
  assert.deepEqual([...host.commands.keys()], ["track.0"]);
  assert.deepEqual(host.command("track.0").declaration.path, [
    "字幕",
    "选择字幕",
    "日本語",
  ]);
  assert.equal(host.sent("commands.unregister").length, 2);
  // Dispose and re-add at once: the new registration waits for the removal.
  const once = plugin.commands.add({ id: "once", title: "一次", run() {} });
  await host.settle();
  void once.dispose();
  plugin.commands.add({ id: "once", title: "两次", run() {} });
  await host.settle();
  assert.equal(host.command("once").declaration.title, "两次");
  await stop();
});

test("dataDirectory is a writable directory kept across restarts when passed again", async () => {
  const { writeFileSync: write, readFileSync: read } = await import("node:fs");
  const first = await startPlugin(() => {});
  const directory = first.plugin.dataDirectory;
  write(join(directory, "settings.json"), '{"folder":"/tmp"}');
  const keep = mkdtempSync(join(tmpdir(), "vestra-data-"));
  write(join(keep, "settings.json"), '{"folder":"/x"}');
  await first.stop();
  const again = await startPlugin(() => {}, { dataDirectory: keep });
  assert.equal(
    read(join(again.plugin.dataDirectory, "settings.json"), "utf8"),
    '{"folder":"/x"}',
  );
  await again.stop();
  const { createPlugin } = await import("../../sdk/plugin/index.ts");
  const bare = await createPlugin(
    new TestHost(),
    { id: "x", capabilities: [] },
    process.cwd(),
  );
  assert.throws(() => bare.plugin.dataDirectory, { code: "unavailable" });
  await bare.dispose();
});
