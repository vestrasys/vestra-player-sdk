// Row patches of array properties (player 0.6.0, feature `ui.patch`): the
// SDK's diff, its key detection and index fallback, and the TestHost's
// fidelity to the player (base/seq, stale, limits, whole props).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  applyOps,
  countRow,
  diff,
  keyOf,
  PATCH_OPS,
  replay,
  withinLimits,
} from "../src/plugin/patch.ts";
import type { PlannedOp } from "../src/plugin/patch.ts";
import {
  HostError,
  startPlugin,
  TestHost,
  UI_VALUE_LIMITS,
} from "../src/plugin/testing.ts";
import type { Json } from "../src/wire.ts";
import type { Panel, Plugin, Window } from "../src/plugin/types.ts";

const row = (key: string, extra: Record<string, unknown> = {}) => ({
  rowId: key,
  label: `row ${key}`,
  selected: false,
  ...extra,
});
const enc = (rows: unknown[]) => rows.map((r) => JSON.stringify(r));

/** Diff `old` → `next` (keyed when both have keys) and check by replaying. */
function check(old: unknown[], next: unknown[]) {
  const a = keyOf(old);
  const b = keyOf(next);
  const keyed = a && b && a.field === b.field;
  const plan = diff(
    { enc: enc(old), keys: keyed ? a.keys : null },
    { enc: enc(next), keys: keyed ? b.keys : null },
  );
  assert.ok(plan, "a plan");
  assert.deepEqual(replay(enc(old), plan.ops, enc(next)), enc(next));
  // `from` names old rows of the same JSON only.
  plan.from.forEach((i, j) => {
    if (i >= 0) assert.equal(enc(old)[i], enc(next)[j]);
  });
  return plan.ops;
}
const kinds = (ops: PlannedOp[]) => ops.map((op) => op.op);

test("key detection: key, id, rowId or row-id, unique, strings or numbers", () => {
  assert.equal(keyOf([{ key: "a" }, { key: "b" }])?.field, "key");
  assert.equal(keyOf([{ id: 1 }, { id: 2 }])?.field, "id");
  assert.deepEqual(keyOf([row("a"), row("b")]), {
    field: "rowId",
    keys: ["a", "b"],
  });
  assert.equal(keyOf([{ "row-id": "a" }])?.field, "row-id");
  // The first candidate every row has wins; a failing one is skipped.
  assert.equal(
    keyOf([
      { key: "a", id: 1 },
      { key: "a", id: 2 },
    ])?.field,
    "id",
  );
  // Not detected: duplicates, a missing key, another key type, non-objects.
  assert.equal(keyOf([{ id: 1 }, { id: 1 }]), null);
  assert.equal(keyOf([{ id: 1 }, { name: "x" }]), null);
  assert.equal(keyOf([{ id: true }]), null);
  assert.equal(keyOf([{ id: null }]), null);
  assert.equal(keyOf(["a", "b"]), null);
  assert.equal(keyOf([[1], [2]]), null);
  assert.equal(keyOf([]), null);
  class Handle {
    id = 1;
  }
  assert.equal(keyOf([new Handle()]), null, "class instances are not rows");
});

test("keyed diff: one changed row is one set; moves follow a longest run", () => {
  const rows = Array.from({ length: 200 }, (_, i) => row(String(i)));
  const selected = rows.map((r, i) =>
    i === 17 ? { ...r, selected: true } : r,
  );
  assert.deepEqual(check(rows, selected), [{ op: "set", at: 17, row: 17 }]);
  assert.deepEqual(check(rows, rows), []);
  // The last row moved to the top: one move, not 199.
  const top = [rows[199]!, ...rows.slice(0, 199)];
  assert.deepEqual(check(rows, top), [
    { op: "move", from: 199, count: 1, to: 0 },
  ]);
  // The first row moved to the end.
  assert.deepEqual(kinds(check(rows, [...rows.slice(1), rows[0]!])), ["move"]);
  // Two rows swapped: one move.
  const swapped = rows.slice();
  [swapped[10], swapped[20]] = [swapped[20]!, swapped[10]!];
  assert.deepEqual(kinds(check(rows, swapped)), ["move", "move"]);
  // A window of 200 rows shifted by 7: one remove, one insert of 7 rows.
  const window = (first: number) =>
    Array.from({ length: 200 }, (_, i) => row(String(first + i)));
  assert.deepEqual(check(window(0), window(7)), [
    { op: "remove", at: 0, count: 7 },
    {
      op: "insert",
      at: 193,
      rows: [193, 194, 195, 196, 197, 198, 199],
    },
  ]);
  assert.deepEqual(kinds(check(window(7), window(0))), ["remove", "insert"]);
  // Rows removed and added in the middle, one changed, others moved.
  const old = ["a", "b", "c", "d", "e", "f", "g"].map((k) => row(k));
  const next = [
    row("a"),
    row("f"),
    row("x"),
    row("c", { selected: true }),
    row("b"),
    row("y"),
    row("g"),
  ];
  const ops = check(old, next);
  assert.deepEqual(kinds(ops).sort(), [
    "insert",
    "insert",
    "move",
    "move",
    "remove",
    "set",
  ]);
  // Ops in the order the player applies them: removes, moves, inserts, sets.
  const order = { remove: 0, move: 1, insert: 2, set: 3 };
  for (let i = 1; i < ops.length; i++)
    assert.ok(order[ops[i - 1]!.op] <= order[ops[i]!.op]);
  // Everything replaced (no key in common) still replays.
  check(
    old,
    ["p", "q"].map((k) => row(k)),
  );
  check(old, []);
  check([], old);
  // Many random edits: the replay always gives the new rows.
  let seed = 7;
  const random = (n: number) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  for (let round = 0; round < 200; round++) {
    const a = Array.from({ length: random(30) }, (_, i) => row(`k${i}`));
    const b = a.filter(() => random(4) !== 0);
    for (let i = random(5); i > 0; i--)
      b.splice(random(b.length + 1), 0, row(`n${round}-${i}`));
    for (let i = random(5); i > 0 && b.length > 1; i--) {
      const [moved] = b.splice(random(b.length), 1);
      b.splice(random(b.length + 1), 0, moved!);
    }
    if (b.length) b[random(b.length)] = { ...b[0]!, label: "changed" };
    if (new Set(b.map((r) => r.rowId)).size === b.length) check(a, b);
  }
});

test("index fallback: prefix and suffix trimmed, sets, one insert or remove", () => {
  const rows = ["a", "b", "c", "d", "e"];
  assert.deepEqual(check(rows, ["a", "b", "c", "d", "e", "f", "g"]), [
    { op: "insert", at: 5, rows: [5, 6] },
  ]);
  assert.deepEqual(check(rows, ["a", "b"]), [
    { op: "remove", at: 2, count: 3 },
  ]);
  assert.deepEqual(check(rows, ["a", "x", "b", "c", "d", "e"]), [
    { op: "insert", at: 1, rows: [1] },
  ]);
  assert.deepEqual(check(rows, ["a", "c", "d", "e"]), [
    { op: "remove", at: 1, count: 1 },
  ]);
  assert.deepEqual(check(rows, ["a", "B", "c", "D", "e"]), [
    { op: "set", at: 1, row: 1 },
    { op: "set", at: 3, row: 3 },
  ]);
  // Images (no key): by index.
  const images = [
    { $vestraImage: "/a.png", ref: 1 },
    { $vestraImage: "/b.png", ref: 2 },
  ];
  assert.deepEqual(
    check(images, [images[0], { $vestraImage: "/c.png", ref: 3 }]),
    [{ op: "set", at: 1, row: 1 }],
  );
  // Keys of another field than before, or none: by index.
  assert.equal(keyOf([{ name: 1 }]), null);
});

test("too many operations: no patch (the whole value is sent)", () => {
  const old = Array.from({ length: 3000 }, (_, i) => `r${i}`);
  const next = old.map((r, i) => (i % 2 ? r : `${r}!`));
  assert.equal(diff({ enc: old, keys: null }, { enc: next, keys: null }), null);
  assert.equal(PATCH_OPS, 1024);
});

test("limit counts per row agree with the player's for the whole value", () => {
  const rows = [row("a"), { id: 1, tags: ["x", "y"], nested: { a: null } }];
  const counts = rows.map(countRow);
  const values = 1 + counts.reduce((sum, c) => sum + c.values, 0);
  assert.equal(values, 1 + 4 + 7);
  assert.ok(withinLimits(counts));
  const L = UI_VALUE_LIMITS;
  const many = Array.from({ length: L.arrayRows + 1 }, () => countRow(1));
  assert.equal(withinLimits(many), false);
  const fields = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [`f${i}`, i]),
  );
  const wide = Array.from({ length: 1000 }, () => countRow(row("x", fields)));
  assert.equal(withinLimits(wide), false, "over the values limit");
  assert.equal(countRow("x".repeat(L.stringBytes + 1)).over, true);
});

test("applyOps applies wire operations in order", () => {
  assert.deepEqual(
    applyOps(
      ["a", "b", "c", "d"],
      [
        { op: "remove", at: 0, count: 1 },
        { op: "move", from: 2, count: 1, to: 0 },
        { op: "insert", at: 1, rows: ["x"] },
        { op: "set", at: 3, row: "C" },
      ],
    ),
    ["d", "x", "b", "C"],
  );
});

/** A package with a panel, a window and a settings page, each with `rows`. */
function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "patches-"));
  writeFileSync(
    join(directory, "list.slint"),
    "export global ListBridge { in property <[int]> rows; }\nexport component List inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "test.patches",
      capabilities: ["ui.mount", "ui.window", "ui.settings"],
    }),
  );
  return directory;
}

/** Every property write the plugin sent. */
function recorded(host: TestHost) {
  const writes: { method: string; params: Record<string, Json> }[] = [];
  const request = host.request.bind(host);
  host.request = (async (method: string, params: Record<string, Json> = {}) => {
    if (["ui.setMount", "ui.set", "settings.set"].includes(method))
      writes.push({ method, params });
    return request(method, params);
  }) as typeof host.request;
  return writes;
}

test("a bound list sends patches, the TestHost keeps whole props", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let rows = Array.from({ length: 200 }, (_, i) => row(String(i)));
  let total = "200";
  let panel!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows, total }));
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  assert.equal(writes.length, 0, "the initial properties are the baseline");
  // One row selected: one patch of one set, applying on the initial (0).
  rows = rows.map((r, i) => (i === 3 ? { ...r, selected: true } : r));
  plugin.update();
  await host.settle();
  assert.deepEqual(writes.at(-1), {
    method: "ui.setMount",
    params: {
      property: "rows",
      patch: {
        base: 0,
        seq: 1,
        ops: [{ op: "set", at: 3, row: rows[3]! }],
      },
    },
  });
  assert.deepEqual(host.mounted().props.rows, rows);
  // Unchanged: nothing is sent; a scalar is compared without stringify.
  writes.length = 0;
  plugin.update();
  await host.settle();
  assert.equal(writes.length, 0);
  total = "201";
  plugin.update();
  await host.settle();
  assert.deepEqual(writes, [
    {
      method: "ui.setMount",
      params: { property: "total", value: "201", seq: 2 },
    },
  ]);
  // The window shifts: a remove and an insert, applying on seq 1.
  writes.length = 0;
  rows = Array.from({ length: 200 }, (_, i) => row(String(i + 5)));
  plugin.update();
  await host.settle();
  const patch = (writes[0]!.params as Record<string, Json>)
    .patch as unknown as {
    base: number;
    ops: { op: string }[];
  };
  assert.equal(patch.base, 1);
  assert.deepEqual(
    patch.ops.map((op) => op.op),
    ["remove", "insert"],
  );
  assert.deepEqual(host.mounted().props.rows, rows);
  await stop();
});

test("stale: the SDK sends the whole value at once", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let rows = [row("a"), row("b")];
  let panel!: Panel;
  const errors: unknown[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }));
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  // The player's record differs (a write the SDK does not know about).
  const request = host.request.bind(host);
  let once = true;
  host.request = (async (method: string, params: Record<string, Json> = {}) => {
    if (method === "ui.setMount" && params.patch && once) {
      once = false;
      writes.push({ method, params });
      throw new HostError("stale", "stale");
    }
    return request(method, params);
  }) as typeof host.request;
  rows = [row("a", { selected: true }), row("b")];
  plugin.update();
  await host.settle();
  assert.ok(writes.at(-2)!.params.patch, "a patch first");
  assert.deepEqual(writes.at(-1)!.params, {
    property: "rows",
    value: rows,
    seq: 2,
  });
  assert.deepEqual(host.mounted().props.rows, rows);
  assert.deepEqual(errors, [], "stale is not an error");
  // The next change patches on the whole write.
  rows = [row("a", { selected: true }), row("b", { selected: true })];
  plugin.update();
  await host.settle();
  assert.equal((writes.at(-1)!.params.patch as { base: number }).base, 2);
  await stop();
});

test("the TestHost checks patches as the player does", async () => {
  const host = new TestHost();
  let panel!: Panel;
  const { stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint", {});
      panel.set({ rows: [1, 2, 3] });
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  const write = (patch: Json) =>
    host.request("ui.setMount", { property: "rows", patch });
  await assert.rejects(write({ base: 5, seq: 9, ops: [] }), { code: "stale" });
  await assert.rejects(
    write({ base: 0, seq: 1, ops: [{ op: "set", at: 3, row: 1 }] }),
    { code: "invalid" },
  );
  await assert.rejects(write({ base: 0, seq: 0, ops: [] }), {
    code: "invalid",
  });
  await assert.rejects(
    write({
      base: 0,
      seq: 1,
      ops: [
        { op: "insert", at: 0, rows: Array(UI_VALUE_LIMITS.arrayRows).fill(0) },
      ],
    }),
    { code: "limit" },
  );
  await assert.rejects(
    host.request("ui.setMount", {
      property: "missing",
      patch: { base: 0, seq: 1, ops: [] },
    }),
    { code: "stale" },
  );
  await write({
    base: 0,
    seq: 4,
    ops: [
      { op: "move", from: 2, count: 1, to: 0 },
      { op: "set", at: 1, row: 10 },
    ],
  });
  assert.deepEqual(host.mounted().props.rows, [3, 10, 2]);
  await assert.rejects(write({ base: 0, seq: 5, ops: [] }), { code: "stale" });
  await write({ base: 4, seq: 5, ops: [{ op: "remove", at: 0, count: 3 }] });
  assert.deepEqual(host.mounted().props.rows, []);
  await stop();
});

test("windows and settings pages patch too; an old player gets whole values", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let rows = ["a", "b", "c"].map((k) => row(k));
  let window!: Window;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      window = plugin.windows.create("list.slint", { id: "w" });
      window.bind(() => ({ rows }));
      plugin.settings
        .page("list.slint", { id: "p", category: "general", title: "P" })
        .bind(() => ({ rows }));
    },
    { host, directory: packageWith() },
  );
  await window.show();
  await host.settle();
  rows = [row("c"), row("a"), row("b")];
  plugin.update();
  await host.settle();
  assert.deepEqual(
    writes.map((w) => [w.method, Object.keys(w.params.patch ?? {}).length > 0]),
    [
      ["ui.set", true],
      ["settings.set", true],
    ],
  );
  assert.deepEqual(host.windows.get("w")!.props.rows, rows);
  assert.deepEqual(host.settings.pages.get("p")!.props.rows, rows);
  await stop();

  // A player without the feature: whole values, no seq.
  const old = new TestHost();
  (old as unknown as { app: object }).app = { ...old.app, features: [] };
  const oldWrites = recorded(old);
  rows = [row("a")];
  let panel!: Panel;
  const second = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }));
    },
    { host: old, directory: packageWith() },
  );
  await panel.ready;
  await old.settle();
  rows = [row("a", { selected: true })];
  second.plugin.update();
  await old.settle();
  assert.deepEqual(oldWrites, [
    { method: "ui.setMount", params: { property: "rows", value: rows } },
  ]);
  await second.stop();
});

test("whole values where a patch cannot apply: empty, documents, a failed write", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let rows: unknown[] = [];
  let panel!: Panel;
  const errors: unknown[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }) as never);
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  // Rows into an empty array: whole (the player could not type them).
  rows = [row("a")];
  plugin.update();
  await host.settle();
  assert.ok("value" in writes.at(-1)!.params);
  // Over the limits: whole, refused with limit as before.
  rows = Array.from({ length: UI_VALUE_LIMITS.arrayRows + 1 }, (_, i) =>
    row(`${i}`),
  );
  plugin.update();
  await host.settle();
  assert.ok("value" in writes.at(-1)!.params);
  assert.equal((errors[0] as { code?: string }).code, "limit");
  // After the failure the next write is whole again.
  rows = [row("a"), row("b")];
  plugin.update();
  await host.settle(300);
  assert.ok("value" in writes.at(-1)!.params);
  assert.deepEqual(host.mounted().props.rows, rows);
  // A Markdown document in a row: whole.
  const doc = await plugin.ui.markdown("**x**");
  rows = [{ ...row("a"), body: doc }, row("b")];
  plugin.update();
  await host.settle();
  assert.ok("value" in writes.at(-1)!.params);
  await stop();
});
