import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("the sliders report the level; Default resets it", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url),
  });
  await host.command("open").run();
  const themeWidgetsWindow = host.window("theme-widgets");
  assert.equal(themeWidgetsWindow.props.label, "Level 50");

  themeWidgetsWindow.emit("level-changed", 0.8); // the user drags a slider
  await host.settle();
  assert.equal(themeWidgetsWindow.props.label, "Level 80");

  themeWidgetsWindow.emit("reset"); // the user presses Default
  await host.settle();
  assert.equal(themeWidgetsWindow.props.level, 0.5);
  assert.equal(themeWidgetsWindow.props.label, "Level 50");
  await stop();
});

test("the key caps show the current keys and follow the user's changes", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url),
  });
  await host.command("open").run();
  await host.settle();
  const themeWidgetsWindow = host.window("theme-widgets");
  assert.equal(themeWidgetsWindow.props["level-down"], "F7");
  assert.equal(themeWidgetsWindow.props["level-up"], "F8");

  await host.press("F8"); // the key does what the slider does
  assert.equal(themeWidgetsWindow.props.label, "Level 55");

  host.rebind("level.up", ["Shift+F8"]); // the user picks another key
  host.rebind("level.down", []); // and clears this one
  await host.settle();
  assert.equal(themeWidgetsWindow.props["level-up"], "⇧F8"); // a Mac by default
  assert.equal(themeWidgetsWindow.props["level-down"], ""); // no cap
  await stop();
});
