import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url);

test("the speeds are radio items in their own group", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4"); // a file is open, so the speed can change
  const { stop } = await startPlugin(activate, { directory, host });
  const half = host.command("rate-0.5").declaration;
  assert.ok("radio" in half && half.radio);
  assert.equal(half.group, "speeds");
  assert.equal(host.command("rate-1").state.checked, true);

  await host.command("rate-2").run();
  await host.settle();
  assert.equal(host.command("rate-2").state.checked, true);
  assert.equal(host.command("rate-1").state.checked, false);
  await stop();
});

test("the status item is added again with a new title", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  const { stop } = await startPlugin(activate, { directory, host });
  assert.deepEqual(host.command("speed").declaration.path, [
    "Examples",
    "Speed: 1×",
  ]);
  await host.command("rate-1.5").run();
  await host.settle();
  assert.deepEqual(host.command("speed").declaration.path, [
    "Examples",
    "Speed: 1.5×",
  ]);
  await stop();
});
