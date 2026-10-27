import assert from "node:assert/strict";
import test from "node:test";
import {
  BAR_BUTTON_ICONS,
  BAR_BUTTON_LIMITS,
  startPlugin,
} from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";

const invalid = (run: () => unknown) =>
  assert.throws(run, (error: { code?: string }) => {
    assert.equal(error.code, "invalid");
    return true;
  });

test("a command's bar button: listed, clicked like its menu item, refused while disabled, gone after dispose", async () => {
  let runs = 0;
  let enabled = true;
  let open!: { dispose(): Promise<void> };
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      open = plugin.commands.add({
        id: "open",
        path: ["Plugin Store…"],
        button: { icon: "store", order: 200 },
        enabled: () => enabled,
        reason: () => (enabled ? null : "Offline"),
        run: () => void runs++,
      });
    },
    { capabilities: ["commands"] },
  );
  const [button] = host.barButtons;
  assert.ok(button);
  assert.deepEqual(
    {
      command: button.command,
      icon: button.icon,
      image: button.image,
      order: button.order,
      enabled: button.enabled,
      checked: button.checked,
      tooltip: button.tooltip,
    },
    {
      command: "open",
      icon: "store",
      image: false,
      order: 200,
      enabled: true,
      checked: false,
      tooltip: "Plugin Store",
    },
  );
  await button.click();
  assert.equal(runs, 1);
  enabled = false;
  plugin.update();
  await host.settle();
  const [disabled] = host.barButtons;
  assert.equal(disabled?.enabled, false);
  assert.equal(disabled?.tooltip, "Plugin Store\nOffline");
  await assert.rejects(disabled!.click(), { code: "command" });
  assert.equal(runs, 1);
  await open.dispose();
  await host.settle();
  assert.deepEqual(host.barButtons, []);
  await assert.rejects(disabled!.click(), { code: "missing" });
  await stop();
});

test("bar buttons are checked as the player checks them", async () => {
  const { host, plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["commands"],
  });
  const add = (button: unknown, path: string[] = ["Thing"]) =>
    plugin.commands.add({
      id: `c${Math.random()}`,
      path,
      button: button as never,
      run() {},
    });
  invalid(() => add({ icon: "store", order: 1 }, []));
  invalid(() => add({ icon: "shopping-bag", order: 1 }));
  invalid(() => add({ icon: "store", order: -1 }));
  invalid(() => add({ icon: "store", order: BAR_BUTTON_LIMITS.maxOrder + 1 }));
  invalid(() => add({ icon: "store", order: 1.5 }));
  invalid(() => add("store"));
  // An image of the plugin is an icon too.
  const image = plugin.ui.image("/plugin/icon.png", { maxSide: 32 });
  plugin.commands.add({
    id: "image",
    path: ["Image Thing"],
    button: { icon: image, order: 5 },
    run() {},
  });
  // The second button of the same plugin stays a menu item only.
  plugin.commands.add({
    id: "second",
    path: ["Second"],
    button: { icon: "ai", order: 1 },
    run() {},
  });
  await host.settle();
  assert.deepEqual(
    host.barButtons.map((button) => [
      button.command,
      button.icon,
      button.image,
    ]),
    [["image", "/plugin/icon.png", true]],
  );
  assert.ok(host.commands.has("second"));
  assert.ok(BAR_BUTTON_ICONS.includes("ai"));
  await stop();
});

test("a command without a button sends no button field (older players refuse it)", async () => {
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({ id: "plain", path: ["Plain"], run() {} });
    },
    { capabilities: ["commands"] },
  );
  assert.equal("button" in host.command("plain").declaration, false);
  assert.deepEqual(host.barButtons, []);
  await stop();
});
