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
  DIFF_OPS,
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
  // SDK 1.5.46: a diff may plan up to DIFF_OPS (sent as patches of at most
  // PATCH_OPS each); beyond, or more than PATCH_OPS moves, the whole value.
  const old = Array.from({ length: 3000 }, (_, i) => `r${i}`);
  const next = old.map((r, i) => (i % 2 ? r : `${r}!`));
  assert.equal(
    diff({ enc: old, keys: null }, { enc: next, keys: null })?.ops.length,
    1500,
  );
  const many = Array.from({ length: DIFF_OPS * 2 + 2 }, (_, i) => `r${i}`);
  const every = many.map((r, i) => (i % 2 ? r : `${r}!`));
  assert.equal(
    diff({ enc: many, keys: null }, { enc: every, keys: null }),
    null,
  );
  const keys = old.map((_, i) => i);
  const shuffled = [...keys].sort((a, b) => (a % 7) - (b % 7) || a - b);
  assert.equal(
    diff(
      { enc: old, keys },
      { enc: shuffled.map((i) => old[i]!), keys: shuffled },
    ),
    null,
    "more than PATCH_OPS moves",
  );
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
  const wide = Array.from({ length: Math.ceil(L.values / 20) }, () =>
    countRow(row("x", fields)),
  );
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

test("limit counts: handles are one value, other toJSON objects count as their JSON, holes as null", () => {
  // Any other object with toJSON (a Date) counts as what it returns.
  const date = new Date(0);
  assert.deepEqual(countRow({ when: date }), countRow({ when: date.toJSON() }));
  const custom = { toJSON: () => [1, 2, 3] };
  assert.deepEqual(countRow({ x: custom }), countRow({ x: [1, 2, 3] }));
  assert.equal(countRow({ x: custom }).values, 5);
  // A toJSON leaving a field out (undefined) drops the field, as JSON does.
  assert.deepEqual(
    countRow({ a: 1, gone: { toJSON: () => undefined } }),
    countRow({ a: 1 }),
  );
  // An image handle is one value; a document one value and its text.
  assert.deepEqual(
    countRow({ __vestraImage: true, path: "/a/very/long/path.png" }),
    {
      values: 1,
      text: 0,
      over: false,
    },
  );
  assert.deepEqual(countRow({ __vestraMarkdown: true, text: "héllo" }), {
    values: 1,
    text: 6,
    over: false,
  });
  // A hole counts as null.
  // eslint-disable-next-line no-sparse-arrays
  assert.deepEqual(countRow([1, , 3]), countRow([1, null, 3]));
});

test("sparse arrays: compared and patched as JSON writes them (holes are null)", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  // eslint-disable-next-line no-sparse-arrays
  let rows: unknown[] = [row("a"), , row("c")];
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
  assert.deepEqual(host.mounted().props.rows, [row("a"), null, row("c")]);
  plugin.update();
  await host.settle();
  assert.equal(writes.length, 0, "the same sparse rows are unchanged");
  // eslint-disable-next-line no-sparse-arrays
  rows = [row("a", { selected: true }), , row("c")];
  plugin.update();
  await host.settle();
  assert.deepEqual((writes.at(-1)!.params.patch as { ops: Json[] }).ops, [
    { op: "set", at: 0, row: row("a", { selected: true }) },
  ]);
  // A hole that a patch carries is null, not a missing row.
  // eslint-disable-next-line no-sparse-arrays
  rows = [row("a"), , , row("c")];
  plugin.update();
  await host.settle();
  assert.deepEqual(host.mounted().props.rows, [row("a"), null, null, row("c")]);
  assert.deepEqual(errors, []);
  await stop();
});

test("an unchanged array costs its encoding alone: keys are read for a write only", async () => {
  const host = new TestHost();
  let reads = 0;
  const counted = (key: string) => {
    const out: Record<string, unknown> = { label: key };
    Object.defineProperty(out, "rowId", {
      enumerable: true,
      get: () => (reads++, key),
    });
    return out;
  };
  const rows = Array.from({ length: 50 }, (_, i) => counted(String(i)));
  let panel!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }) as never);
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  reads = 0;
  plugin.update();
  await host.settle();
  assert.equal(reads, rows.length, "one read per row (its JSON), no key pass");
  await stop();
});

test("released images: refused in rows a patch keeps too, as in a whole write", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  const directory = packageWith();
  const scope: { dispose(): Promise<void> }[] = [];
  let rows: unknown[] = [];
  let panel!: Panel;
  const errors: unknown[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      const images = plugin.scope();
      scope.push(images);
      rows = [
        { ...row("a"), icon: images.ui.image(join(directory, "a.png")) },
        row("b"),
      ];
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }) as never);
    },
    { host, directory },
  );
  await panel.ready;
  await host.settle();
  await scope[0]!.dispose();
  writes.length = 0;
  rows = [rows[0], row("b", { selected: true })];
  plugin.update();
  await host.settle();
  assert.equal(writes.length, 0, "nothing is sent");
  assert.equal((errors[0] as { code?: string }).code, "invalid");
  assert.match(String((errors[0] as Error).message), /released/);
  await stop();
});

test("two stale answers in a row: the property is sent whole until the view shows its initial properties again", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let rows = [row("a"), row("b")];
  let panel!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }));
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  const request = host.request.bind(host);
  host.request = (async (method: string, params: Record<string, Json> = {}) => {
    if (method === "ui.setMount" && params.patch) {
      writes.push({ method, params });
      throw new HostError("stale", "stale");
    }
    return request(method, params);
  }) as typeof host.request;
  const kinds = async () => {
    writes.length = 0;
    rows = rows.map((r) => ({ ...r, selected: !r.selected }));
    plugin.update();
    await host.settle();
    return writes.map((w) => ("patch" in w.params ? "patch" : "value"));
  };
  assert.deepEqual(await kinds(), ["patch", "value"]);
  assert.deepEqual(await kinds(), ["patch", "value"]);
  assert.deepEqual(await kinds(), ["value"]);
  assert.deepEqual(await kinds(), ["value"]);
  await stop();
});

test("the TestHost counts the rows a patch keeps: successive patches cannot pass the totals", async () => {
  const host = new TestHost();
  let panel!: Panel;
  const L = UI_VALUE_LIMITS;
  const big = "x".repeat(L.stringBytes);
  const rows = Array.from({ length: L.textBytes / L.stringBytes }, () => big);
  const { stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint", {});
      panel.set({ rows: rows.slice(0, 1) });
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  // One row per patch: each is small, their sum reaches the text total.
  for (let seq = 1; seq < rows.length; seq++)
    await host.request("ui.setMount", {
      property: "rows",
      patch: {
        base: seq - 1,
        seq,
        ops: [{ op: "insert", at: 0, rows: [big] }],
      },
    });
  await assert.rejects(
    host.request("ui.setMount", {
      property: "rows",
      patch: {
        base: rows.length - 1,
        seq: rows.length,
        ops: [{ op: "insert", at: 0, rows: ["y"] }],
      },
    }),
    { code: "limit", message: /text exceeds/ },
  );
  assert.equal((host.mounted().props.rows as Json[]).length, rows.length);
  await stop();
});

test("deep-frozen rows bound again are not encoded again; rows that can change always are", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  const frozen = (key: string, extra: Record<string, unknown> = {}) =>
    Object.freeze({ ...row(key), tags: Object.freeze(["x"]), ...extra });
  const nested = { text: "before" };
  let shown = "a";
  const getter = Object.freeze(
    Object.defineProperty({ rowId: "getter" }, "label", {
      enumerable: true,
      get: () => shown,
    }),
  );
  const plain = row("plain");
  const shallow = Object.freeze({ ...row("shallow"), nested });
  let rows: unknown[] = [
    ...Array.from({ length: 50 }, (_, i) => frozen(String(i))),
    getter,
    plain,
    shallow,
  ];
  const settledRows = new Set(rows.slice(0, 50));
  let panel!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }) as never);
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  const stringify = JSON.stringify;
  let encoded = 0;
  JSON.stringify = ((value: unknown, ...rest: never[]) => {
    if (settledRows.has(value)) encoded++;
    return stringify(value, ...rest);
  }) as typeof JSON.stringify;
  try {
    // Seen once, then verified and kept: from then on taken from the cache.
    for (let pass = 0; pass < 2; pass++) {
      plugin.update();
      await host.settle();
    }
    encoded = 0;
    plugin.update();
    await host.settle();
    assert.equal(encoded, 0, "kept rows are not encoded again");
    assert.equal(writes.length, 0, "and nothing changed");
    // A changed row is a new object: one set, the others still kept.
    const changed = frozen("7", { selected: true });
    rows = rows.map((r, i) => (i === 7 ? changed : r));
    plugin.update();
    await host.settle();
    assert.equal(encoded, 0);
    assert.deepEqual(
      (writes.at(-1)!.params.patch as unknown as { ops: unknown[] }).ops,
      [{ op: "set", at: 7, row: changed }],
    );
  } finally {
    JSON.stringify = stringify;
  }
  // A frozen row with a getter, a mutable row and a frozen row holding a
  // mutable object are encoded on every pass: their changes are sent.
  shown = "b";
  (plain as { label: string }).label = "changed";
  nested.text = "after";
  writes.length = 0;
  plugin.update();
  await host.settle();
  const ops = (
    writes.at(-1)!.params.patch as unknown as {
      ops: { op: string; at: number }[];
    }
  ).ops;
  assert.deepEqual(
    ops.map((op) => [op.op, op.at]),
    [
      ["set", 50],
      ["set", 51],
      ["set", 52],
    ],
  );
  assert.deepEqual(host.mounted().props.rows, JSON.parse(JSON.stringify(rows)));
  await stop();
});

/** Counts `JSON.stringify` calls on the given values while `run` runs. */
async function stringified(values: Set<unknown>, run: () => Promise<void>) {
  const stringify = JSON.stringify;
  let count = 0;
  JSON.stringify = ((value: unknown, ...rest: never[]) => {
    if (values.has(value)) count++;
    return stringify(value, ...rest);
  }) as typeof JSON.stringify;
  try {
    await run();
  } finally {
    JSON.stringify = stringify;
  }
  return count;
}

test("a kept frozen row holding an image is still refused once its scope is released", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  const directory = packageWith();
  const scope: { dispose(): Promise<void> }[] = [];
  let rows: unknown[] = [];
  let panel!: Panel;
  const errors: unknown[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      const images = plugin.scope();
      scope.push(images);
      rows = [
        Object.freeze({
          ...row("a"),
          icon: images.ui.image(join(directory, "a.png")),
        }),
        Object.freeze(row("b")),
      ];
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }) as never);
    },
    { host, directory },
  );
  await panel.ready;
  await host.settle();
  // Seen, then kept.
  const kept = new Set([rows[0]]);
  for (let pass = 0; pass < 2; pass++) {
    plugin.update();
    await host.settle();
  }
  const count = await stringified(kept, async () => {
    plugin.update();
    await host.settle();
  });
  assert.equal(count, 0, "the image row is taken from the cache");
  await scope[0]!.dispose();
  writes.length = 0;
  rows = [rows[0], Object.freeze(row("b", { selected: true }))];
  plugin.update();
  await host.settle();
  assert.equal(writes.length, 0, "nothing is sent");
  assert.equal((errors[0] as { code?: string }).code, "invalid");
  assert.match(String((errors[0] as Error).message), /released/);
  await stop();
});

test("frozen rows holding a Date or a Map are not kept; a toJSON on Object.prototype turns the cache off", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  const when = new Date(0);
  const dated = Object.freeze({ ...row("dated"), when });
  const mapped = Object.freeze({ ...row("mapped"), map: new Map() });
  const plain = Array.from({ length: 10 }, (_, i) =>
    Object.freeze(row(String(i))),
  );
  const rows: unknown[] = [dated, mapped, ...plain];
  let panel!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows }) as never);
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  for (let pass = 0; pass < 2; pass++) {
    plugin.update();
    await host.settle();
  }
  const pass = async () => {
    plugin.update();
    await host.settle();
  };
  assert.equal(await stringified(new Set([dated, mapped]), pass), 2);
  assert.equal(await stringified(new Set(plain), pass), 0, "plain rows kept");
  // A Date changes inside a frozen row: the change is sent.
  when.setTime(1000);
  writes.length = 0;
  await pass();
  const ops = (
    writes.at(-1)!.params.patch as unknown as {
      ops: { op: string; at: number }[];
    }
  ).ops;
  assert.deepEqual(
    ops.map((op) => [op.op, op.at]),
    [["set", 0]],
  );
  // A `toJSON` on Object.prototype: every row is encoded again.
  Object.defineProperty(Object.prototype, "toJSON", {
    value: function (this: unknown) {
      return this;
    },
    configurable: true,
    writable: true,
  });
  try {
    assert.equal(await stringified(new Set(plain), pass), plain.length);
  } finally {
    delete (Object.prototype as { toJSON?: unknown }).toJSON;
  }
  assert.equal(await stringified(new Set(plain), pass), 0, "kept again");
  await stop();
});
