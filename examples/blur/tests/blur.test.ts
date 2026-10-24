import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

/** Start the plugin with a video already playing. */
async function start() {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 60 });
  return startPlugin(activate, {
    directory: new URL("..", import.meta.url), // reads manifest.json
    host,
  });
}

/** The video chain the player holds for this plugin (`[]` when there is none). */
function chain(host: TestHost) {
  const [resource] = host.processing.resources.values();
  return resource?.nodes ?? [];
}

test("Video ▸ Blur… opens the window; the slider blurs the video", async () => {
  const { host, stop } = await start();
  const command = host.command("blur");
  assert.deepEqual("path" in command.declaration && command.declaration.path, [
    "@video",
    "Blur…",
  ]);
  await command.run();
  const window = host.window("blur");
  assert.equal(window.visible, true);

  window.emit("strength-changed", 4);
  await host.settle();
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 4, steps: 3 }]);
  assert.equal(window.props["problem"], "");
  await stop();
});

test("strength 0 removes the blur", async () => {
  const { host, stop } = await start();
  await host.command("blur").run();
  const window = host.window("blur");
  window.emit("strength-changed", 6.5);
  await host.settle();
  window.emit("strength-changed", 0.02); // rounds to 0
  await host.settle();
  assert.deepEqual(chain(host), []);
  assert.equal(host.processing.resources.size, 0);
  await stop();
});

test("stopping the plugin withdraws the blur", async () => {
  const { host, stop } = await start();
  await host.command("blur").run();
  host.window("blur").emit("strength-changed", 3);
  await host.settle();
  assert.equal(host.processing.resources.size, 1);
  await stop();
  assert.equal(host.processing.resources.size, 0);
});
