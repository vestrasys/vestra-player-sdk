import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url); // manifest.json and locales/

test("English: the texts as written", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory,
    locale: "en",
  });
  const counter = host.command("counter");
  assert.deepEqual(counter.display.path, ["Tools", "Counter…"]);
  await counter.run();
  host.window("counter").emit("add");
  await host.settle();
  assert.deepEqual(host.osd, ["Count: 1"]);
  await stop();
});

test("Simplified Chinese: the menu and the message from locales/zh-Hans.po", async () => {
  const { host, plugin, stop } = await startPlugin(activate, {
    directory,
    locale: "zh-Hans",
  });
  assert.equal(plugin.i18n.locale, "zh-Hans");
  const counter = host.command("counter");
  // The key stays English; the menu shows the translation.
  assert.deepEqual(counter.declaration.path, ["Tools", "Counter…"]);
  assert.deepEqual(counter.display.path, ["工具", "计数器…"]);
  await counter.run();
  const window = host.window("counter");
  window.emit("add");
  window.emit("add");
  await host.settle();
  assert.equal(window.props["count"], 2);
  assert.deepEqual(host.osd, ["计数：1", "计数：2"]);
  await stop();
});
