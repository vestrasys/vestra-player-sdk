import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url);

test("the window shows the sample document and opens web links", async () => {
  const host = new TestHost();
  const { stop } = await startPlugin(activate, { directory, host });
  try {
    await host.command("show").run();
    await host.settle();
    const doc = host.markdown(host.window("document").props.doc);
    assert.ok(doc);
    assert.match(doc.text, /^# Markdown example/);
    assert.equal(doc.base, fileURLToPath(directory));
    // No test image for the remote address: it shows its alt text.
    assert.deepEqual(doc.images, {});
    host.window("document").emit("openLink", "https://example.com/");
    await host.settle();
    assert.deepEqual(host.system.urls, ["https://example.com/"]);
    host.window("document").emit("openLink", "#tables");
    await host.settle();
    assert.deepEqual(host.osd, ["Link: #tables"]);
  } finally {
    await stop();
  }
});
