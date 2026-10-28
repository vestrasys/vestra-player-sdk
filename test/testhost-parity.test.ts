// TestHost behaves like the player where tests can tell the difference:
// a disabled core action run from its menu record rejects with `command`,
// and a key held only by disabled commands looks at the first of them.
import assert from "node:assert/strict";
import test from "node:test";
import type { Plugin } from "../src/index.ts";
import { startPlugin } from "../src/plugin/testing.ts";

test("a disabled core action rejects with command, like the player's menu", async () => {
  const { host, stop } = await startPlugin(() => {}, {
    capabilities: ["commands"],
  });
  try {
    // Nothing is open: play/pause is disabled.
    assert.equal(host.coreAction("play-pause").state.enabled, false);
    await assert.rejects(host.coreAction("play-pause").run(), {
      code: "command",
    });
  } finally {
    await stop();
  }
});

test("press: only the first disabled command decides", async () => {
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({
        id: "first",
        title: "First",
        bindings: ["Ctrl+K"],
        enabled: false,
        run() {},
      });
      plugin.commands.add({
        id: "second",
        title: "Second",
        bindings: ["Ctrl+K"],
        enabled: false,
        reason: "Not now",
        run() {},
      });
    },
    { capabilities: ["commands"] },
  );
  try {
    // The first has no reason: the key passes, the second's reason is not shown.
    assert.equal(await host.press("Ctrl+K"), "passed");
    assert.deepEqual(host.osd, []);
  } finally {
    await stop();
  }
});
