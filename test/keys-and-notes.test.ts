// SDK 1.5.12: keys bound to a disabled command pass on (as the player);
// TRANSLATORS notes on entries of `as const` tables.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Plugin } from "../src/index.ts";
import { startPlugin } from "../src/plugin/testing.ts";
import { parsePo } from "../src/i18n.ts";

test("a disabled command lets its key pass to the next one bound to it", async () => {
  const ran: string[] = [];
  let ready = false;
  const { host, plugin, stop } = await startPlugin(
    (p: Plugin) => {
      const add = (
        id: string,
        bindings: string[],
        extra: { focus?: "panel"; reason?: string } = {},
      ) =>
        p.commands.add({
          id,
          title: id,
          bindings,
          enabled: () => ready,
          ...extra,
          run: () => void ran.push(id),
        });
      add("first", ["Q"]);
      p.commands.add({
        id: "second",
        title: "second",
        bindings: ["Q"],
        run: () => void ran.push("second"),
      });
      add("panel-only", ["W"], { focus: "panel" });
      p.commands.add({
        id: "global-w",
        title: "global-w",
        bindings: ["W"],
        run: () => void ran.push("global-w"),
      });
      add("saving", ["S"], { reason: "Nothing to save" });
      add("quiet", ["Ctrl+Shift+F9"]);
    },
    { capabilities: ["commands"] },
  );
  // The winner is disabled: the command it shadowed takes the key.
  assert.equal(await host.press("Q"), "ran");
  // The focused panel's disabled command yields to the global one.
  assert.equal(await host.press("W", { panel: true }), "ran");
  assert.deepEqual(ran, ["second", "global-w"]);
  // Only a disabled command holds it: its reason shows, the key is eaten.
  assert.equal(await host.press("S"), "reason");
  assert.equal(host.osd.at(-1), "Nothing to save");
  // Without a reason the key goes on to the focused control.
  assert.equal(await host.press("Ctrl+Shift+F9"), "passed");
  await assert.rejects(host.press("Ctrl+Shift+F8"), /nothing is bound/);
  // Enabled again, the winner takes its key back.
  ready = true;
  plugin.update();
  await host.settle();
  assert.equal(await host.press("Q"), "ran");
  assert.deepEqual(ran.at(-1), "first");
  await stop();
});

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "bin/vestra-plugin.mjs");

test("a TRANSLATORS comment on an as const table entry reaches the .pot", () => {
  const dir = mkdtempSync(join(tmpdir(), "vestra-notes-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "node_modules/@vestra-player"), { recursive: true });
  symlinkSync(root, join(dir, "node_modules/@vestra-player/sdk"), "junction");
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id: "me.notes",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["ui.osd"],
    }),
  );
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(
    join(dir, "main.ts"),
    `import type { Plugin } from "@vestra-player/sdk";
const REASONS = {
  // TRANSLATORS: the download took longer than 30 seconds.
  timeout: "Connection timed out",
  dns: "Server not found",
  nested: {
    /* TRANSLATORS: a proxy refused the request. */
    proxy: "Proxy refused",
  },
} as const;
const STEPS = [
  // TRANSLATORS: the first step of the installer.
  "Download",
  "Install",
] as const;
const plain = {
  // TRANSLATORS: not a table (no as const), so not read.
  word: "Elsewhere",
};
export default async function activate(plugin: Plugin) {
  const key = Date.now() > 0 ? "timeout" : "dns";
  const step = STEPS[Date.now() % 2]!;
  await plugin.osd.show("Download failed: {}", [plugin.i18n.text(REASONS[key])]);
  await plugin.osd.show(REASONS.nested.proxy);
  await plugin.osd.show(step);
  void plain;
}
`,
  );
  const result = spawnSync(process.execPath, [cli, "i18n", "extract"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const notes = Object.fromEntries(
    parsePo(
      readFileSync(join(dir, "locales/messages.pot"), "utf8"),
    ).entries.map((e) => [e.id, e.notes]),
  );
  assert.deepEqual(notes["Connection timed out"], [
    "the download took longer than 30 seconds.",
  ]);
  assert.deepEqual(notes["Server not found"], []);
  assert.deepEqual(notes["Proxy refused"], ["a proxy refused the request."]);
  assert.deepEqual(notes["Download"], ["the first step of the installer."]);
  assert.deepEqual(notes["Install"], []);
  assert.equal(notes["Elsewhere"], undefined);
});
