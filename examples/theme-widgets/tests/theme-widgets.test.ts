import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("the sliders report the level; Default resets it", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url),
  });
  await host.command("open").run();
  const window = host.window("theme-widgets");
  assert.equal(window.props.label, "Level 50");

  window.emit("level-changed", 0.8); // the user drags a slider
  await host.settle();
  assert.equal(window.props.label, "Level 80");

  window.emit("reset"); // the user presses Default
  await host.settle();
  assert.equal(window.props.level, 0.5);
  assert.equal(window.props.label, "Level 50");
  await stop();
});
