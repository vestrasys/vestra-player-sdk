import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, UI_VALUE_LIMITS } from "../src/plugin/testing.ts";
import { valueLimitProblem } from "../src/plugin/values.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";
import type { Json } from "../src/wire.ts";

/** A package with one sidebar panel and one window file. */
function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "limits-"));
  writeFileSync(
    join(directory, "list.slint"),
    "export global ListBridge { in property <bool> tabbed; }\nexport component List inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "win.slint"),
    "export component Win inherits Window {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "test.limits",
      capabilities: ["ui.mount", "ui.window", "events"],
    }),
  );
  return directory;
}

/** The D1 row: 8 fields, so 9 values. */
const row = (i: number) => ({
  title: String(i),
  folder: "",
  duration: "",
  key: "",
  selected: false,
  current: false,
  missing: false,
  probing: false,
});
const rows = (count: number) => Array.from({ length: count }, (_, i) => row(i));
const fitting = Math.floor(UI_VALUE_LIMITS.values / 9) - 1;
const filled = <T>(length: number, value: T): T[] =>
  Array.from({ length }, () => value);

test("TestHost refuses a panel write over the value limits with limit, like the player", async () => {
  let count = 10;
  const errors: PluginError[] = [];
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      const panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows: rows(count) }));
    },
    { directory: packageWith() },
  );
  assert.equal((host.mounted().props.rows as Json[]).length, 10);
  // The largest list that fits is accepted.
  count = fitting;
  plugin.update();
  await host.settle();
  assert.equal((host.mounted().props.rows as Json[]).length, fitting);
  assert.equal(errors.length, 0);
  // D1: past the limit the write fails loudly; the panel keeps what it showed.
  count = 3000;
  plugin.update();
  await host.settle();
  assert.equal((host.mounted().props.rows as Json[]).length, fitting);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, "limit");
  assert.match(errors[0]!.message, /^rows: UI (object|array) cannot fit/);
  await stop();
});

test("initial properties over the limits: a panel leaves the property out and reports it, a window fails show", async () => {
  // D1 at start-up: a restored 3000-row list. The panel still mounts (a
  // failed mount during activation would fail the plugin); onError hears it.
  const directory = packageWith();
  const errors: PluginError[] = [];
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      plugin.panels
        .mount("sidebar", "list.slint")
        .set({ rows: rows(3000), title: "List" });
    },
    { directory },
  );
  assert.deepEqual(host.mounted().props, { title: "List" });
  assert.deepEqual(
    errors.map((e) => e.code),
    ["limit"],
  );
  assert.match(errors[0]!.message, /^rows: UI /);
  const window = plugin.windows.create("win.slint");
  window.set({ items: filled(UI_VALUE_LIMITS.arrayRows + 1, 0) });
  await assert.rejects(
    window.show(),
    (error: PluginError) =>
      error.code === "limit" &&
      /items: UI array exceeds 4096 rows/.test(error.message),
  );
  await stop();
});

test("valueLimitProblem follows the player's rules", () => {
  const L = UI_VALUE_LIMITS;
  let deep: Json = null;
  for (let i = 0; i < L.depth; i++) deep = [deep];
  assert.equal(valueLimitProblem(deep), null);
  assert.match(valueLimitProblem([deep]) ?? "", /depth exceeds 8/);
  assert.equal(valueLimitProblem(filled(L.arrayRows, null)), null);
  assert.match(
    valueLimitProblem(filled(L.arrayRows + 1, null)) ?? "",
    /exceeds 4096 rows/,
  );
  // root + 4 arrays + nulls = the total.
  const last = L.values - 5 - 3 * L.arrayRows;
  const exact = [0, 0, 0, 0].map((_, i) =>
    filled(i < 3 ? L.arrayRows : last, null),
  );
  assert.equal(valueLimitProblem(exact), null);
  exact[3]!.push(null);
  assert.match(valueLimitProblem(exact) ?? "", /node/);
  // Bytes, not characters; field names count.
  assert.equal(valueLimitProblem("段".repeat(L.stringBytes / 3)), null);
  assert.match(
    valueLimitProblem("段".repeat(L.stringBytes / 3 + 1)) ?? "",
    /string or field name exceeds/,
  );
  const part = "x".repeat(L.stringBytes);
  assert.equal(valueLimitProblem(filled(15, part)), null);
  assert.match(
    valueLimitProblem({ [part]: filled(16, part) }) ?? "",
    /text exceeds/,
  );
  // An image is checked when used; a document is one value and its text.
  assert.equal(valueLimitProblem({ $vestraImage: "/a.png", ref: 1 }), null);
  const doc = (n: number) => ({
    $vestraMarkdown: { text: "x".repeat(n), base: null, images: {} },
    ref: 1,
  });
  assert.equal(valueLimitProblem([doc(200_000), doc(200_000)]), null);
  assert.match(
    valueLimitProblem(filled(6, doc(200_000))) ?? "",
    /text exceeds/,
  );
});

test("ui.error from the player reaches onError with its code", async () => {
  const errors: PluginError[] = [];
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
    },
    { directory: packageWith() },
  );
  host.emit("ui.error", { code: "missing", message: "cover: no such file" });
  host.emit("ui.error", { message: "ui-prepare: floating panel" });
  await host.settle();
  assert.deepEqual(
    errors.map((e) => [e.code, e.message]),
    [
      ["missing", "cover: no such file"],
      ["ui", "ui-prepare: floating panel"],
    ],
  );
  await stop();
});

test("a nested image counts as one value, like the player (SDK 1.5.19)", () => {
  const image = (n: number): Json => ({ $vestraImage: "/i.png", ref: n });
  const rows = (count: number): Json =>
    Array.from({ length: count }, (_, n) => ({ icon: image(n) }));
  // 1 + 4096 × (struct + image) = 8193 values: fits (as objects it would
  // be 1 + 4096 × 4 and over the limit).
  assert.equal(valueLimitProblem(rows(4096)), null);
  assert.equal(
    valueLimitProblem([
      { icon: { $vestraImage: "/i.png", ref: 1, maxSide: 64 } },
    ]),
    null,
  );
});
