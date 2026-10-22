import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("Tools → Hello shows an on-screen message", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url), // reads manifest.json
  });
  const hello = host.command("hello");
  assert.deepEqual("path" in hello.declaration && hello.declaration.path, [
    "Tools",
    "Hello",
  ]);
  await hello.run();
  assert.deepEqual(host.osd, ["Hello"]);
  await stop();
});
