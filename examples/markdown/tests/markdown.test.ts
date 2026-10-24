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
  const window = host.window("document");
  assert.equal(window.visible, true);
  const doc = host.markdown(window.props.doc);
  assert.ok(doc);
  assert.match(doc.text, /^# Markdown example/);
  assert.equal(doc.base, fileURLToPath(directory));
  await stop();
});
