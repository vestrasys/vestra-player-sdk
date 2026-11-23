import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url);

test("the window shows sample.md, with the package as its base", async () => {
  const { host, stop } = await startPlugin(activate, { directory });
  await host.command("show").run();
  await host.settle();
  const documentWindow = host.window("document");
  assert.equal(documentWindow.visible, true);
  const doc = host.markdown(documentWindow.props.doc);
  assert.ok(doc);
  assert.match(doc.text, /^# Markdown example/);
  assert.equal(doc.base, fileURLToPath(directory));
  await stop();
});

test("only the open window keeps the plugin running", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: directory,
  });
  const keepsRunning = () => host.keepsRunning;
  await host.settle();
  assert.deepEqual(keepsRunning(), []);
  await host.command("show").run();
  await host.settle();
  assert.deepEqual(keepsRunning(), ["an open window (document)"]);
  host.window("document").userClose();
  await host.settle();
  assert.deepEqual(keepsRunning(), []);
  await stop();
});
