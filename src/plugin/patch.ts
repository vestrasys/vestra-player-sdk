/**
 * Row patches of array properties (player 0.6.0, feature `ui.patch`): the
 * diff between the rows last sent and the rows bound now, as `set`,
 * `insert`, `remove` and `move` operations by index. Internal; plugins see
 * none of it (the player's doc/architecture/large-lists.md §2).
 */
import { UI_VALUE_LIMITS } from "./values.ts";

/** The player feature that takes row patches. */
export const PATCH_FEATURE = "ui.patch";
/** The most operations one patch carries (the player's `MAX_PATCH_OPS`). */
export const PATCH_OPS = 1024;
/**
 * Fields that identify a row, in the order they are tried. A field is used
 * when every row has it, as a string or a number, and no two rows share it.
 */
export const KEY_FIELDS: readonly string[] = ["key", "id", "rowId", "row-id"];

export type RowKey = string | number;

/** One planned operation; `set` and `insert` name rows of the new array. */
export type PlannedOp =
  | { op: "set"; at: number; row: number }
  | { op: "insert"; at: number; rows: number[] }
  | { op: "remove"; at: number; count: number }
  | { op: "move"; from: number; count: number; to: number };

/** What one row counts toward the value limits (as a row of an array). */
export interface RowCount {
  values: number;
  text: number;
  /** Over a per-row limit (a string, the depth): the whole value is sent. */
  over: boolean;
}

/** An array as sent: each row's JSON, its key field and keys, its counts. */
export interface Rows {
  enc: string[];
  field: string | null;
  keys: RowKey[] | null;
  /** Filled in as patches need them. */
  counts: (RowCount | undefined)[];
}

const plain = (value: unknown): value is Record<string, unknown> => {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * The field that identifies `rows`, and each row's key; `null` when no
 * field of {@link KEY_FIELDS} does (rows are then matched by index).
 */
export function keyOf(
  rows: readonly unknown[],
): { field: string; keys: RowKey[] } | null {
  const first = rows[0];
  if (!plain(first)) return null;
  for (const field of KEY_FIELDS) {
    if (!(field in first)) continue;
    const keys: RowKey[] = [];
    const seen = new Set<RowKey>();
    let ok = true;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const key = plain(row) ? row[field] : undefined;
      if (
        (typeof key !== "string" && typeof key !== "number") ||
        seen.has(key)
      ) {
        ok = false;
        break;
      }
      seen.add(key);
      keys.push(key);
    }
    if (ok) return { field, keys };
  }
  return null;
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");

/**
 * What `row` counts toward the value limits as a row of an array (depth
 * 1), like `valueLimitProblem`: every value one, an image or document one,
 * strings and field names their UTF-8 bytes.
 */
export function countRow(row: unknown): RowCount {
  const count: RowCount = { values: 0, text: 0, over: false };
  const L = UI_VALUE_LIMITS;
  const text = (s: string) => {
    const n = bytes(s);
    if (n > L.stringBytes) count.over = true;
    count.text += n;
  };
  const walk = (value: unknown, depth: number) => {
    if (count.over) return;
    if (depth > L.depth) {
      count.over = true;
      return;
    }
    count.values += 1;
    if (value !== null && typeof value === "object") {
      const json = (value as { toJSON?: () => unknown }).toJSON;
      // An image or document handle: one value (its text counted by the
      // player, which a document row never reaches: those are sent whole).
      if (typeof json === "function") return;
    }
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) {
      if (value.length > L.arrayRows) count.over = true;
      for (const item of value) walk(item ?? null, depth + 1);
      return;
    }
    if (value !== null && typeof value === "object")
      for (const [name, item] of Object.entries(value)) {
        if (item === undefined || typeof item === "function") continue;
        text(name);
        walk(item, depth + 1);
      }
  };
  walk(row ?? null, 1);
  return count;
}

/** The new array is within the value limits (counted per row). */
export function withinLimits(counts: readonly RowCount[]) {
  const L = UI_VALUE_LIMITS;
  if (counts.length > L.arrayRows) return false;
  let values = 1;
  let text = 0;
  for (const count of counts) {
    if (count.over) return false;
    values += count.values;
    text += count.text;
  }
  return values <= L.values && text <= L.textBytes;
}

/** The longest increasing subsequence of `values`, as a set of indices. */
function increasing(values: readonly number[]): Set<number> {
  const tails: number[] = [];
  const before = new Int32Array(values.length).fill(-1);
  for (let i = 0; i < values.length; i++) {
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]!]! < values[i]!) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) before[i] = tails[lo - 1]!;
    tails[lo] = i;
  }
  const out = new Set<number>();
  for (let i = tails.at(-1) ?? -1; i >= 0; i = before[i]!) out.add(i);
  return out;
}

/**
 * The operations that turn the old rows into the new ones (`null`: more
 * than {@link PATCH_OPS} would be needed), and for each new row the old row
 * whose JSON it keeps (`-1`: a new or changed row). Keyed when both arrays
 * have keys from the same field; otherwise by index.
 */
export function diff(
  old: { enc: readonly string[]; keys: readonly RowKey[] | null },
  next: { enc: readonly string[]; keys: readonly RowKey[] | null },
): { ops: PlannedOp[]; from: Int32Array } | null {
  const from = new Int32Array(next.enc.length).fill(-1);
  const ops =
    old.keys && next.keys
      ? keyed(old.enc, old.keys, next.enc, next.keys, from)
      : byIndex(old.enc, next.enc, from);
  return ops && ops.length <= PATCH_OPS ? { ops, from } : null;
}

function byIndex(
  old: readonly string[],
  next: readonly string[],
  from: Int32Array,
): PlannedOp[] {
  const min = Math.min(old.length, next.length);
  let p = 0;
  while (p < min && old[p] === next[p]) from[p] = p++;
  let s = 0;
  while (s < min - p && old[old.length - 1 - s] === next[next.length - 1 - s]) {
    from[next.length - 1 - s] = old.length - 1 - s;
    s++;
  }
  const ops: PlannedOp[] = [];
  const middle = Math.min(old.length, next.length) - p - s;
  for (let i = p; i < p + middle; i++)
    if (old[i] === next[i]) from[i] = i;
    else ops.push({ op: "set", at: i, row: i });
  const at = p + middle;
  if (next.length > old.length)
    ops.push({
      op: "insert",
      at,
      rows: Array.from({ length: next.length - old.length }, (_, k) => at + k),
    });
  else if (old.length > next.length)
    ops.push({ op: "remove", at, count: old.length - next.length });
  return ops;
}

function keyed(
  oldEnc: readonly string[],
  oldKeys: readonly RowKey[],
  newEnc: readonly string[],
  newKeys: readonly RowKey[],
  from: Int32Array,
): PlannedOp[] | null {
  const sets: PlannedOp[] = [];
  const keep = (j: number, i: number) => {
    if (oldEnc[i] === newEnc[j]) from[j] = i;
    else sets.push({ op: "set", at: j, row: j });
  };
  const min = Math.min(oldKeys.length, newKeys.length);
  let p = 0;
  while (p < min && oldKeys[p] === newKeys[p]) keep(p, p++);
  let s = 0;
  while (
    s < min - p &&
    oldKeys[oldKeys.length - 1 - s] === newKeys[newKeys.length - 1 - s]
  ) {
    keep(newKeys.length - 1 - s, oldKeys.length - 1 - s);
    s++;
  }
  const oldEnd = oldKeys.length - s;
  const newEnd = newKeys.length - s;
  // The new middle's keys, by position (relative to p).
  const target = new Map<RowKey, number>();
  for (let j = p; j < newEnd; j++) target.set(newKeys[j]!, j - p);
  const ops: PlannedOp[] = [];
  // Removes, from the end so that indices stay valid; runs merged.
  const kept: RowKey[] = [];
  const oldAt = new Map<RowKey, number>();
  for (let i = oldEnd - 1; i >= p; i--) {
    if (target.has(oldKeys[i]!)) continue;
    const last = ops.at(-1);
    if (last?.op === "remove" && last.at === i + 1) {
      last.at = i;
      last.count++;
    } else ops.push({ op: "remove", at: i, count: 1 });
    if (ops.length > PATCH_OPS) return null;
  }
  for (let i = p; i < oldEnd; i++)
    if (target.has(oldKeys[i]!)) {
      oldAt.set(oldKeys[i]!, i);
      kept.push(oldKeys[i]!);
    }
  // Moves: every kept row outside a longest increasing run of target
  // positions goes right after the kept row before it in the new order.
  const positions = kept.map((key) => target.get(key)!);
  const stay = increasing(positions);
  if (kept.length - stay.size + ops.length > PATCH_OPS) return null;
  const stays = new Set<RowKey>();
  for (const index of stay) stays.add(kept[index]!);
  const current = kept.slice();
  let previous: RowKey | undefined;
  for (let j = p; j < newEnd; j++) {
    const key = newKeys[j]!;
    if (!oldAt.has(key)) continue;
    if (!stays.has(key)) {
      const at = current.indexOf(key);
      current.splice(at, 1);
      const to = previous === undefined ? 0 : current.indexOf(previous) + 1;
      current.splice(to, 0, key);
      if (at !== to)
        ops.push({ op: "move", from: p + at, count: 1, to: p + to });
    }
    previous = key;
  }
  // Inserts, from the top; runs merged.
  for (let j = p; j < newEnd; j++) {
    const key = newKeys[j]!;
    if (oldAt.has(key)) {
      keep(j, oldAt.get(key)!);
      continue;
    }
    const last = ops.at(-1);
    if (last?.op === "insert" && last.at + last.rows.length === j)
      last.rows.push(j);
    else ops.push({ op: "insert", at: j, rows: [j] });
    if (ops.length > PATCH_OPS) return null;
  }
  sets.sort((a, b) => (a as { at: number }).at - (b as { at: number }).at);
  for (const set of sets) {
    ops.push(set);
    if (ops.length > PATCH_OPS) return null;
  }
  return ops;
}

/**
 * Apply planned operations to a copy of `old` (the rows' JSON), taking new
 * rows from `next`: the check that a diff produces exactly the new rows.
 */
export function replay(
  old: readonly string[],
  ops: readonly PlannedOp[],
  next: readonly string[],
): string[] {
  const rows = old.slice();
  for (const op of ops)
    switch (op.op) {
      case "set":
        rows[op.at] = next[op.row]!;
        break;
      case "insert":
        rows.splice(op.at, 0, ...op.rows.map((j) => next[j]!));
        break;
      case "remove":
        rows.splice(op.at, op.count);
        break;
      case "move":
        rows.splice(op.to, 0, ...rows.splice(op.from, op.count));
        break;
    }
  return rows;
}

/** Apply wire operations to an array (the TestHost's copy of a value). */
export function applyOps<T>(
  rows: T[],
  ops: readonly (
    | { op: "set"; at: number; row: T }
    | { op: "insert"; at: number; rows: T[] }
    | { op: "remove"; at: number; count: number }
    | { op: "move"; from: number; count: number; to: number }
  )[],
): T[] {
  const out = rows.slice();
  for (const op of ops)
    switch (op.op) {
      case "set":
        out[op.at] = op.row;
        break;
      case "insert":
        out.splice(op.at, 0, ...op.rows);
        break;
      case "remove":
        out.splice(op.at, op.count);
        break;
      case "move":
        out.splice(op.to, 0, ...out.splice(op.from, op.count));
        break;
    }
  return out;
}
