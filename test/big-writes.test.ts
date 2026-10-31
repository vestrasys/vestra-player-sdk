// Writes larger than one request (SDK 1.5.46, player 0.6.0, large lists
// P3): a whole array as its first rows and `insert` patches of the rest, a
// large patch as several, initial properties within one request. Every
// line stays within MESSAGE_LIMIT; the TestHost keeps whole props.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CHUNK_BYTES,
  chunkOps,
  prefixWithin,
  rowBytes,
} from "../src/plugin/patch.ts";
import type { WireOp } from "../src/plugin/patch.ts";
import {
  MESSAGE_LIMIT,
  startPlugin,
  TestHost,
  UI_VALUE_LIMITS,
} from "../src/plugin/testing.ts";
import type { Json } from "../src/wire.ts";
import type { Panel, Plugin } from "../src/plugin/types.ts";

/** About 390 bytes, like a playlist row of a local file. */
const row = (i: number, extra: Record<string, unknown> = {}) => ({
  id: `r${i}`,
  number: 0,
  label: `Show S${Math.floor(i / 100)}E${i % 100} — episode title number ${i}.mkv`,
  duration: "01:01:01",
  tooltip: `C:\\Videos\\Some Show\\Season ${Math.floor(i / 100)}\\Show S${Math.floor(i / 100)}E${i % 100} — episode title number ${i}.mkv`,
  problem: "",
  selected: false,
  current: false,
  played: false,
  failed: false,
  media: "video",
  detail: "C:\\Videos\\Some Show",
  thumb: null,
  ...extra,
});
const rows = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => row(from + i));

function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "big-writes-"));
  writeFileSync(
    join(directory, "list.slint"),
    "export global ListBridge { in property <[int]> rows; in property <string> total; }\nexport component List inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.big", capabilities: ["ui.mount"] }),
  );
  return directory;
}

/** Every request line the plugin sent, with its size. */
function recorded(host: TestHost) {
  const lines: {
    method: string;
    params: Record<string, Json>;
    bytes: number;
  }[] = [];
  const request = host.request.bind(host);
  host.request = (async (method: string, params: Record<string, Json> = {}) => {
    const bytes =
      Buffer.byteLength(JSON.stringify({ id: 1, method, params })) + 1;
    lines.push({ method, params, bytes });
    return request(method, params);
  }) as typeof host.request;
  return lines;
}

test("chunkOps: consecutive patches within the budget, the same result", () => {
  const big = rows(0, 6000);
  const ops: WireOp[] = [
    { op: "remove", at: 0, count: 3 },
    { op: "set", at: 1, row: row(99) },
    { op: "insert", at: 2, rows: big },
    { op: "move", from: 0, count: 1, to: 5 },
  ];
  const groups = chunkOps(ops);
  assert.ok(groups.length > 3);
  for (const group of groups) {
    const bytes = group.reduce(
      (sum, op) =>
        sum +
        (op.op === "insert"
          ? op.rows.reduce((s: number, r) => s + rowBytes(r), 0)
          : op.op === "set"
            ? rowBytes(op.row)
            : 0),
      0,
    );
    assert.ok(bytes <= CHUNK_BYTES, `${bytes}`);
  }
  // Applied in order, the parts give what the ops give.
  const apply = (list: unknown[], op: WireOp) => {
    if (op.op === "set") list[op.at] = op.row;
    else if (op.op === "insert") list.splice(op.at, 0, ...op.rows);
    else if (op.op === "remove") list.splice(op.at, op.count);
    else list.splice(op.to, 0, ...list.splice(op.from, op.count));
    return list;
  };
  const start = rows(10_000, 10_010);
  assert.deepEqual(
    groups.flat().reduce(apply, [...start]),
    ops.reduce(apply, [...start]),
  );
  assert.equal(prefixWithin([10, 10, 10], 25), 2);
  assert.equal(prefixWithin([40], 25), 1, "a row over the budget goes alone");
  assert.equal(prefixWithin([], 25), 0);
});

test("a whole list of 20,000 rows: lines within the limit, then patches as usual", async () => {
  assert.ok(UI_VALUE_LIMITS.arrayRows >= 50_000);
  const host = new TestHost();
  const lines = recorded(host);
  let list: ReturnType<typeof rows> = [];
  let panel!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows: list, total: String(list.length) }));
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  list = rows(0, 20_000);
  plugin.update();
  await host.settle();
  const writes = lines.filter((line) => line.method === "ui.setMount");
  assert.ok(writes.every((line) => line.bytes <= MESSAGE_LIMIT));
  const rowWrites = writes.filter((line) => line.params.property === "rows");
  // Sent after an empty list: whole (its first rows), then inserts.
  assert.ok(Array.isArray(rowWrites[0]!.params.value));
  assert.ok(rowWrites.length >= 10, `${rowWrites.length} writes`);
  for (const [i, line] of rowWrites.slice(1).entries()) {
    const patch = line.params.patch as unknown as {
      base: number;
      seq: number;
      ops: WireOp[];
    };
    const before = rowWrites[i]!.params;
    const previous = (before.seq ??
      (before.patch as unknown as { seq: number }).seq) as number;
    assert.equal(patch.base, previous, "each part applies on the one before");
    assert.deepEqual(
      patch.ops.map((op) => op.op),
      ["insert"],
    );
  }
  assert.deepEqual(host.mounted().props.rows, list);
  // A change after it: one small patch on the last part.
  lines.length = 0;
  list = list.map((r, i) => (i === 19_000 ? { ...r, selected: true } : r));
  plugin.update();
  await host.settle();
  const [patch] = lines.filter((line) => line.params.property === "rows");
  assert.deepEqual((patch!.params.patch as unknown as { ops: WireOp[] }).ops, [
    { op: "set", at: 19_000, row: list[19_000]! },
  ]);
  // A new list of 20,000: a patch of more than one request, in parts.
  lines.length = 0;
  list = rows(50_000, 70_000);
  plugin.update();
  await host.settle();
  const parts = lines.filter((line) => line.params.property === "rows");
  assert.ok(
    parts.length > 1 && parts.every((line) => line.bytes <= MESSAGE_LIMIT),
  );
  assert.deepEqual(host.mounted().props.rows, list);
  await stop();
});

test("initial properties: at most one request of rows, the rest follows", async () => {
  const host = new TestHost();
  const lines = recorded(host);
  const list = rows(0, 4000);
  let panel!: Panel;
  const { stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ rows: list, total: String(list.length) }));
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  assert.ok(lines.every((line) => line.bytes <= MESSAGE_LIMIT));
  const mount = lines.find((line) => line.method === "ui.mount")!;
  const initial = (mount.params.properties as Record<string, Json[]>).rows!;
  assert.ok(
    initial.length > 0 && initial.length < 4000,
    `${initial.length} rows`,
  );
  const rest = lines.filter((line) => line.method === "ui.setMount");
  assert.ok(rest.length >= 2);
  assert.equal((rest[0]!.params.patch as unknown as { base: number }).base, 0);
  assert.deepEqual(host.mounted().props.rows, list);
  await stop();
});
