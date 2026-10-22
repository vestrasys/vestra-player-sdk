import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url);

test("radio rates, repeat binding, a menu-less command and the osd", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { stop } = await startPlugin(activate, { directory, host });
  const rate = host.command("rate-2").declaration;
  assert.ok("radio" in rate && rate.radio && rate.group === "examples");
  assert.deepEqual(host.command("last").declaration.path, [
    "Examples",
    "Last speed: 1×",
  ]);
  await host.command("rate-2").run();
  assert.equal(host.command("rate-2").state.checked, true);
  assert.deepEqual(
    host.command("last").declaration.path,
    ["Examples", "Last speed: 2×"],
    "rebuilt with the new title",
  );
  assert.match(
    readFileSync(join(host.dataDirectory, "settings.json"), "utf8"),
    /"speed":2/,
  );
  assert.equal(host.osd.at(-1), "Speed: 2×");
  await host.press("Ctrl+Alt+ArrowUp");
  assert.equal(host.osd.at(-1), "Volume: 105%");
  const where = host.command("where").declaration;
  assert.deepEqual("path" in where && where.path, []);
  await host.press("Ctrl+Alt+W");
  assert.equal(host.osd.at(-1), "Position: 0 s");
  assert.deepEqual(host.conflicts, []);
  await stop();
});

test("next/previous follow the provider's flags; the sidebar state is shared", async () => {
  const host = new TestHost();
  const { stop } = await startPlugin(activate, { directory, host });
  assert.equal(host.command("next").state.enabled, false);
  await assert.rejects(host.step("next"), { code: "unavailable" });
  assert.equal(
    host.command("detach").state.enabled,
    false,
    "no sidebar mounted",
  );
  // Another plugin's sidebar and sequence, as the test host sees them.
  host.layout.sidebar = {
    owner: 9,
    preferred: true,
    effective: true,
    reason: null,
    detached: false,
  };
  host.emit("window.state", {});
  await host.request("sequence.set", {
    flags: { canNext: true, canPrevious: false },
  });
  await host.settle();
  assert.equal(host.command("next").state.enabled, true);
  assert.equal(host.command("sidebar").state.checked, true);
  await host.press("Ctrl+Alt+D");
  assert.equal(host.layout.sidebar.detached, true);
  assert.equal(host.command("detach").state.checked, true);
  await host.command("sidebar").run();
  assert.equal(host.layout.sidebar.preferred, false);
  await stop();
});
