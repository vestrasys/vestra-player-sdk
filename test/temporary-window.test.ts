// Temporary windows (SDK 1.10.1, player 0.10.3): `plugin.app.openWindow`
// (built-in only) and `plugin.app.temporary`, with TestHost's model of the
// player's refusals in a temporary window.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";

test("openWindow: refused with capability unless built in; files checked as the player does", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "vestra-window-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "a.mkv");
  writeFileSync(file, "x");

  const outside = await startPlugin(() => {}, {});
  await assert.rejects(outside.plugin.app.openWindow([file]), {
    code: "capability",
  });
  assert.deepEqual(outside.host.openedWindows, []);
  await outside.stop();

  const host = new TestHost();
  const { plugin, stop } = await startPlugin(() => {}, {
    host,
    builtin: true,
    id: "vestra.test",
  });
  for (const [paths, code] of [
    [[], "invalid"],
    [["a.mkv"], "invalid"],
    [Array(65).fill(file), "invalid"],
    [[join(dir, "gone.mkv")], "missing"],
    [[dir], "missing"],
  ] as const)
    await assert.rejects(plugin.app.openWindow(paths), { code }, `${paths}`);
  const { pid } = await plugin.app.openWindow([file, file]);
  assert.deepEqual(host.openedWindows, [{ paths: [file, file], pid }]);
  // A method, not one of the facts.
  assert.equal(Object.keys(plugin.app).includes("openWindow"), false);
  await stop();
});

test("temporary: absent in a main window; in a temporary one, the keychain and the library refuse changes", async () => {
  const main = await startPlugin(() => {}, {});
  assert.equal(main.plugin.app.temporary, undefined);
  assert.equal("temporary" in main.plugin.app, false);
  await main.stop();

  const host = new TestHost();
  host.app.temporary = true;
  host.secrets.set("token", "kept");
  host.setPackages([
    ...host.packages,
    {
      id: "someone.demo",
      version: "1.0.0",
      origin: "installed",
      state: "running",
      error: null,
      directory: "/test-host/packages/someone.demo",
      builtin: false,
      source: { kind: "file" },
      dataDirectory: null,
    },
  ]);
  const { plugin, stop } = await startPlugin(() => {}, { host });
  assert.equal(plugin.app.temporary, true);
  assert.equal(await plugin.secrets.get("token"), "kept");
  await assert.rejects(plugin.secrets.set("token", "new"), {
    code: "unavailable",
  });
  await assert.rejects(plugin.secrets.delete("token"), {
    code: "unavailable",
  });
  assert.equal(host.secrets.get("token"), "kept");
  await assert.rejects(plugin.packages.setEnabled("someone.demo", false), {
    code: "unavailable",
  });
  await assert.rejects(plugin.packages.uninstall("someone.demo"), {
    code: "unavailable",
  });
  assert.deepEqual(host.packageCalls, []);
  await stop();
});
