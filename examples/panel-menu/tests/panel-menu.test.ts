import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";
import activateB from "../main-b.ts";
import activateC from "../main-c.ts";

const directory = new URL("..", import.meta.url);

// The same behaviour from each entry file: style A (main.ts), B and C.
for (const [style, entry] of [
  ["A", activate],
  ["B", activateB],
  ["C", activateC],
] as const) {
  test(`a right-click opens the panel's own menu (style ${style})`, async () => {
    const { host, stop } = await startPlugin(entry, { directory });
    const panel = host.mounted();
    panel.emit("select", 2); // the right button goes down on the third row…
    panel.emit("context-menu", 40, 60); // …and comes up
    await host.settle();
    assert.deepEqual(host.menus.at(-1), {
      items: ["first", null, "remove"],
      x: 40,
      y: 60,
    });
    await stop();
  });

  test(`the menu's commands change the list (style ${style})`, async () => {
    const { host, stop } = await startPlugin(entry, { directory });
    const panel = host.mounted();
    panel.emit("select", 1);
    await host.command("remove").run();
    await host.settle();
    assert.deepEqual(panel.props.rows, ["First item", "Third item"]);
    assert.equal(panel.props.selected, 1);
    await host.command("first").run();
    await host.settle();
    assert.equal(panel.props.selected, 0);
    await stop();
  });
}
