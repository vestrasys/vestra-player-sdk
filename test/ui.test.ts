import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import type { Plugin } from "../../sdk/plugin/index.ts";

test("commands register once, follow bound state and dispatch run", async () => {
  let ready = false;
  let runs = 0;
  const { host, plugin, stop } = await startPlugin((plugin: Plugin) => {
    plugin.commands.add({
      id: "demo.open",
      path: ["视频", "画面调节…"],
      enabled: () => ready,
      reason: () => (ready ? null : "等待媒体"),
      run: () => {
        runs++;
      },
    });
  });
  const command = host.command("demo.open");
  assert.deepEqual(command.declaration, {
    title: "画面调节…",
    path: ["视频", "画面调节…"],
    order: 0,
    group: "domain",
    radio: false,
    bindings: [],
    focus: null,
    repeat: false,
  });
  assert.equal(command.state.enabled, false);
  await assert.rejects(command.run(), /disabled/);
  ready = true;
  plugin.update();
  await host.settle();
  assert.equal(command.state.enabled, true);
  assert.equal(command.state.reason, null);
  assert.equal(command.revision, 2);
  await command.run();
  assert.equal(runs, 1);
  plugin.update();
  await host.settle();
  assert.equal(command.revision, 2, "unchanged state is not resent");
  await stop();
  assert.equal(host.commands.has("demo.open"), false, "stopping removes it");
});

test("a failed registration fails activation", async () => {
  const host = new TestHost();
  host.handle("commands.register", () => {
    throw new Error("menu path collides");
  });
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({ id: "x", path: ["文件", "x"], run() {} });
      },
      { host },
    ),
    /collides/,
  );
});

test("handler errors reach the nearest onError", async () => {
  const errors: string[] = [];
  const { host, stop } = await startPlugin((plugin: Plugin) => {
    plugin.onError((error) => errors.push(error.message));
    const feature = plugin.scope();
    feature.commands.add({
      id: "fail",
      path: ["文件", "fail"],
      run: async () => {
        throw new Error("boom");
      },
    });
  });
  await host.command("fail").run();
  assert.deepEqual(errors, ["boom"]);
  await stop();
});

test("windows open lazily with current props and only bound callbacks", async () => {
  let brightness = 0;
  const seen: unknown[][] = [];
  const { host, plugin, stop } = await startPlugin((plugin: Plugin) => {
    const window = plugin.windows.create("picture.slint");
    window.bind(() => ({ brightness, effectEnabled: true }));
    window.on("adjust", (field: string, value: number) => {
      seen.push([field, value]);
      brightness = value;
    });
    window.on("hideTool", () => window.hide());
    plugin.commands.add({
      id: "open",
      path: ["视频", "open"],
      run: () => window.show(),
    });
  });
  assert.equal(host.windows.size, 0, "nothing opens before show()");
  await host.command("open").run();
  const window = host.window("picture");
  assert.deepEqual(window.callbacks, ["adjust", "hide-tool"]);
  assert.deepEqual(window.props, { brightness: 0, "effect-enabled": true });
  window.emit("adjust", "brightness", 40);
  await host.settle();
  assert.deepEqual(seen, [["brightness", 40]]);
  assert.equal(window.props.brightness, 40);
  window.emit("hideTool");
  await host.settle();
  assert.equal(window.visible, false);
  await host.command("open").run();
  assert.equal(
    host.sent("ui.open").length,
    1,
    "a second show() reuses the window",
  );
  assert.equal(window.visible, true);
  void plugin;
  await stop();
  assert.equal(host.windows.size, 0, "disposal closes the window");
});

test("binding a window callback after it opened is refused", async () => {
  const { host, plugin, stop } = await startPlugin((plugin: Plugin) => {
    plugin.windows.create("tool.slint");
  });
  const window = plugin.windows.create("other.slint");
  await window.show();
  assert.throws(() => window.on("late", () => {}), /before the first show/);
  void host;
  await stop();
});

test("a closed window reopens with the current properties", async () => {
  let status = "a";
  const { host, plugin, stop } = await startPlugin(() => {});
  const window = plugin.windows.create("status.slint");
  window.bind(() => ({ status }));
  await window.show();
  await window.close();
  status = "b";
  plugin.update();
  await window.show();
  assert.equal(host.window("status").props.status, "b");
  await stop();
});

test("panels infer component and bridge and sync props", async () => {
  const directory = mkdtempSync(join(tmpdir(), "panel-"));
  writeFileSync(
    join(directory, "bar.slint"),
    "export global Bridge { in-out property <string> status; callback action(string); }\nexport component Bar inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "panel.test", capabilities: ["ui.mount", "events"] }),
  );
  let label = "未打开媒体";
  const actions: string[] = [];
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      const bar = plugin.panels.mount("bottom", "bar.slint");
      bar.bind(() => ({ sourceLabel: label }));
      bar.on("action", (name: string) => actions.push(name));
    },
    { directory },
  );
  const panel = host.mounted();
  assert.equal(panel.component, "Bar");
  assert.equal(host.sent("ui.mount")[0]!.global, "Bridge");
  assert.deepEqual(panel.props, { "source-label": "未打开媒体" });
  panel.emit("action", "open");
  await host.settle();
  assert.deepEqual(actions, ["open"]);
  label = "movie.mp4";
  plugin.update();
  await host.settle();
  assert.equal(panel.props["source-label"], "movie.mp4");
  void plugin;
  await stop();
});

test("panel interaction locks merge", async () => {
  const directory = mkdtempSync(join(tmpdir(), "panel-"));
  writeFileSync(
    join(directory, "side.slint"),
    "export global B {}\nexport component S inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "panel.toggle", capabilities: ["ui.mount"] }),
  );
  let panelHandle: ReturnType<Plugin["panels"]["mount"]> | undefined;
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      panelHandle = plugin.panels.mount("sidebar", "side.slint");
    },
    { directory },
  );
  const panel = panelHandle!;
  panel.setInteraction({ focused: true });
  panel.setInteraction({ dragging: true });
  await host.settle();
  assert.deepEqual(host.mounted().locks, {
    focused: true,
    dragging: true,
    popupOpen: false,
  });
  await stop();
});

test("dialogs return paths or null", async () => {
  const { host, plugin, stop } = await startPlugin(() => {});
  host.dialogAnswers.push(["/tmp/a.mp4"], null, ["/x", "/y"]);
  assert.equal(
    await plugin.dialogs.openFile({ title: "打开媒体" }),
    "/tmp/a.mp4",
  );
  assert.equal(await plugin.dialogs.saveFile({ fileName: "a.png" }), null);
  assert.deepEqual(await plugin.dialogs.openFiles(), ["/x", "/y"]);
  await stop();
});

test("disposing a child scope releases only its handles", async () => {
  const { host, plugin, stop } = await startPlugin(() => {});
  const feature = plugin.scope();
  const tool = feature.windows.create("tool.slint");
  const keep = plugin.windows.create("keep.slint");
  await tool.show();
  await keep.show();
  await feature.dispose();
  assert.deepEqual([...host.windows.keys()], ["keep"]);
  await stop();
});

test("user edits of in-out properties survive other callbacks; set() pulls a control back", async () => {
  let label = "a";
  const { host, plugin, stop } = await startPlugin(() => {});
  const window = plugin.windows.create("edit.slint");
  window.bind(() => ({ label }));
  window.set({ editorValue: "00:30" });
  window.on("other", () => {
    label = "b";
  });
  window.on("ping", () => {});
  await window.show();
  const fake = host.window("edit");
  fake.props["editor-value"] = "1:05"; // the user types
  fake.emit("other");
  fake.emit("ping");
  await host.settle();
  assert.equal(
    fake.props["editor-value"],
    "1:05",
    "an unchanged desired value is not resent",
  );
  assert.equal(fake.props.label, "b", "a changed bound value is sent");
  window.set({ editorValue: "00:30" }); // the same value written again is sent
  await host.settle();
  assert.equal(fake.props["editor-value"], "00:30");
  await stop();
});

test("a failing window write backs off instead of spinning through onError", async () => {
  let status = "ok";
  const { host, plugin, stop } = await startPlugin(() => {});
  const window = plugin.windows.create("broken.slint");
  window.bind(() => ({ status }));
  const errors: string[] = [];
  plugin.onError((error) => {
    errors.push(error.message);
    window.set({ status: `窗口更新失败：${error.message}` });
  });
  await window.show();
  host.handle("ui.set", () => {
    throw new HostError("ui", "view gone");
  });
  status = "changed";
  plugin.update();
  await host.settle(400);
  const writes = host.sent("ui.set").length;
  assert.ok(writes <= 4, `ui.set attempted ${writes} times`);
  assert.equal(errors.length, 1, "the same failure is reported once");
  await host.settle(300);
  assert.ok(host.sent("ui.set").length <= writes + 2, "no tight retry loop");
  host.reset("ui.set");
  status = "recovered";
  plugin.update();
  await host.settle(1100);
  assert.equal(host.window("broken").props.status, "recovered");
  await stop();
});
