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

/** A wide D1 row: 16 fields, so 17 values (rows of 9 values would meet the
 * rows limit before the values total). */
const row = (i: number) => ({
  title: String(i),
  folder: "",
  duration: "",
  key: "",
  selected: false,
  current: false,
  missing: false,
  probing: false,
  a: "",
  b: "",
  c: "",
  d: "",
  e: false,
  f: false,
  g: false,
  h: false,
});
const rows = (count: number) => Array.from({ length: count }, (_, i) => row(i));
const fitting = Math.floor(UI_VALUE_LIMITS.values / 17) - 1;
const over = Math.floor(UI_VALUE_LIMITS.values / 17) + 1;
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
  count = over;
  plugin.update();
  await host.settle();
  assert.equal((host.mounted().props.rows as Json[]).length, fitting);
  assert.equal(errors.length, 1);
  assert.equal(errors[0]!.code, "limit");
  assert.match(errors[0]!.message, /^rows: UI /);
  await stop();
});

test("initial properties over the limits: a panel leaves the property out and reports it, a window fails show", async () => {
  // D1 at start-up: a restored list over the limits. The panel still mounts (a
  // failed mount during activation would fail the plugin); onError hears it.
  const directory = packageWith();
  const errors: PluginError[] = [];
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      plugin.panels
        .mount("sidebar", "list.slint")
        .set({ rows: rows(over), title: "List" });
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
      new RegExp(
        `items: UI array exceeds ${UI_VALUE_LIMITS.arrayRows} rows`,
      ).test(error.message),
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
    new RegExp(`exceeds ${L.arrayRows} rows`),
  );
  // root + (full + 1) arrays + nulls = the total.
  const full = Math.floor((L.values - 2) / (L.arrayRows + 1));
  const last = L.values - 2 - full - full * L.arrayRows;
  const exact = Array.from({ length: full + 1 }, (_, i) =>
    filled(i < full ? L.arrayRows : last, null),
  );
  assert.equal(valueLimitProblem(exact), null);
  exact[full]!.push(null);
  assert.match(valueLimitProblem(exact) ?? "", /node/);
  // Bytes, not characters; field names count.
  assert.equal(valueLimitProblem("段".repeat(L.stringBytes / 3)), null);
  assert.match(
    valueLimitProblem("段".repeat(L.stringBytes / 3 + 1)) ?? "",
    /string or field name exceeds/,
  );
  const part = "x".repeat(L.stringBytes);
  const parts = L.textBytes / L.stringBytes;
  assert.equal(valueLimitProblem(filled(parts - 1, part)), null);
  assert.match(
    valueLimitProblem({ [part]: filled(parts, part) }) ?? "",
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
    valueLimitProblem(filled(Math.ceil(L.textBytes / 200_000), doc(200_000))) ??
      "",
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
