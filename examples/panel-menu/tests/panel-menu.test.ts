import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("right-click opens this plugin's commands; panel keys; sequence provider", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url),
  });
  const panel = host.mounted();
  assert.equal(host.sent("ui.mount")[0]!.title, "Example list");
  panel.emit("select", 2);
  panel.emit("context-menu", 40, 60);
  await host.settle();
  assert.deepEqual(host.menus.at(-1), {
    items: ["first", null, "remove"],
    x: 40,
    y: 60,
  });
  await assert.rejects(
    host.press("Home"),
    /nothing is bound/,
    "panel bindings need panel focus",
  );
  await host.press("Home", { panel: true });
  assert.equal(panel.props.selected, 0);
  assert.deepEqual(host.sequence, { canNext: true, canPrevious: false });
  await host.step("next");
  await host.settle();
  assert.equal(panel.props.selected, 1);
  await host.press("Delete", { panel: true });
  await host.settle();
  assert.deepEqual(panel.props.rows, ["First item", "Third item"]);
  await stop();
});
