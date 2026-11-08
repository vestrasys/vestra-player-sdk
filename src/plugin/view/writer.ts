/**
 * The view writer (L1, a primitive; doc/specs/sdk-refactor.md §2.2 in the
 * player repository): a view's properties as last sent, and the write path
 * from a value to `ui.set` / `ui.setMount` / `settings.set` — encoding,
 * comparison with what was sent, row patches (planned by `patch.ts`),
 * parts of large writes (`more`), the value limits, `stale` fallback and
 * the back-off after a failed write. It knows nothing of update passes or
 * bindings: the binder (`binder.ts`, L2) puts values in, the view
 * (`base.ts`) says where a write goes.
 *
 * Two modes (SDK 1.7.0, refactor Step 2). Until the view's first `bind()`
 * (`track()`), the writer serves `set()` alone: each value is sent whole
 * (limits checked, large arrays in parts with `more`, one write in
 * flight per view), only the properties `set()` named are looked at, and
 * no row-patch base is kept, so nothing is diffed. Once tracked it is the
 * binder's: every value is compared with what was sent and arrays become
 * row patches where one applies; a `set()` then takes the same path, so
 * mixed use stays consistent. Patch planning stays here, used only in the
 * tracked mode: it needs what was sent and the player's base, which are
 * this writer's, and moving it above would split one property's write
 * state across two layers.
 */
import { HostError } from "../../wire.ts";
import type { Json, PropertyWrite, RowOp } from "../../wire.ts";
import { MarkdownHandle } from "../markdown.ts";
import {
  countRow,
  diff,
  keyOf,
  CHUNK_BYTES,
  chunkOps,
  prefixWithin,
  jsonBytes,
  rowBytes,
  replay,
  withinLimits,
} from "../patch.ts";
import type { RowCount, RowKey, Rows } from "../patch.ts";
import { UI_VALUE_LIMITS, valueLimitProblem } from "../values.ts";
import type { PropValue, Props } from "../types.ts";
import { failure } from "../errors.ts";
import { ImageHandle } from "./image.ts";

/** Slint names are kebab-case; plugin code may use camelCase. */
export const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
export const encode = (props: Props) =>
  Object.fromEntries(Object.entries(props).map(([k, v]) => [kebab(k), v]));

/**
 * A property value as sent: images and documents in wire form, at any depth
 * (released ones refused wherever they are), like the player.
 */
function wireValue(value: PropValue): Json {
  if (value instanceof MarkdownHandle) {
    if (value.released)
      throw failure(
        "invalid",
        "Markdown document was released with the scope that created it",
      );
    return value.toJSON();
  }
  if (value instanceof ImageHandle) {
    if (value.released)
      throw failure(
        "invalid",
        `image ${value.path} was released with the scope that created it`,
      );
    return value.toJSON();
  }
  // Array.from: a hole is `null`, as `JSON.stringify` writes it.
  if (Array.isArray(value))
    return Array.from(value, (item) => wireValue(item ?? null));
  if (value !== null && typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [key, item] of Object.entries(value))
      out[key] = wireValue(item as PropValue);
    return out;
  }
  return value;
}

/** A property as last sent, compared without `JSON.stringify` where it can be. */
type Sent =
  | { kind: "value"; value: string | number | boolean | null }
  | { kind: "json"; enc: string }
  | { kind: "rows"; rows: Rows };

/** A property's value now, encoded for comparison and sending. */
interface Pending {
  key: string;
  value: PropValue;
  /** It differs from what was sent. */
  changed: boolean;
  /** `JSON.stringify(value)`, computed when needed (a failed write's mark). */
  signature: () => string;
  /**
   * Rows of an array (player feature `ui.patch`): each row's JSON, and its
   * keys (computed when a patch needs them).
   */
  rows?: Encoded & {
    keyed: () => { field: string; keys: RowKey[] } | null;
  };
  /** What to remember once written (rows: with their limit counts, if known). */
  sent: (counts?: (RowCount | undefined)[]) => Sent;
}

/** Scalars compared by value. Non-finite numbers are JSON `null`: compared as JSON. */
const isPrimitive = (
  value: unknown,
): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

/** A row as `JSON.stringify` writes it inside an array. */
const encodeRow = (row: unknown) => JSON.stringify(row) ?? "null";

/** What a row's encoding holds: a Markdown document, an image. */
const HAS_MARKDOWN = 1;
const HAS_IMAGE = 2;
const marksOf = (enc: string) =>
  (enc.includes('"$vestraMarkdown"') ? HAS_MARKDOWN : 0) |
  (enc.includes('"$vestraImage"') ? HAS_IMAGE : 0);

/**
 * The encoding of a row object that can never change (SDK 1.5.47): its
 * JSON, what it holds, and its limit counts once a patch needed them.
 */
interface Settled {
  enc: string;
  marks: number;
  count?: RowCount;
}
/**
 * Row encodings by row object, shared by every property (a row's JSON does
 * not depend on where it is bound). Only rows that cannot change are kept
 * ({@link settled}): a plugin that mutates its rows in place sees no
 * difference, and one that keeps unchanged rows as the same deep-frozen
 * objects skips encoding them on every pass. Weak: a row the plugin drops
 * goes with its entry.
 */
const settledRows = new WeakMap<object, Settled>();
/**
 * Frozen rows seen once. A frozen row is verified and kept on its second
 * pass, so rows frozen afresh on every pass cost one set entry, not a
 * verification each.
 */
const seenRows = new WeakSet<object>();
/** Frozen rows that can still change (a mutable part, a getter): never kept. */
const unsettledRows = new WeakSet<object>();

/**
 * `value` can never change what `JSON.stringify` writes for it: a primitive,
 * an image or document handle (their wire form is fixed when made), or a
 * frozen plain object or array whose own enumerable properties are data
 * properties (no getter, no own `toJSON`) holding such values. Freezing
 * fixes the properties and the prototype for good, so the answer holds as
 * long as the object lives.
 */
function settled(value: unknown, depth: number): boolean {
  if (value === null || typeof value !== "object")
    return typeof value !== "function";
  if (value instanceof ImageHandle || value instanceof MarkdownHandle)
    return true;
  if (depth > UI_VALUE_LIMITS.depth || !Object.isFrozen(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  if (
    Array.isArray(value)
      ? proto !== Array.prototype
      : proto !== Object.prototype && proto !== null
  )
    return false;
  // An own `toJSON`, enumerable or not, is called by `JSON.stringify`.
  if (Object.prototype.hasOwnProperty.call(value, "toJSON")) return false;
  for (const key of Object.keys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property)) return false;
    if (!settled(property.value, depth + 1)) return false;
  }
  return true;
}

/** A row's encoding and marks, from {@link settledRows} when it is kept. */
function rowEncoding(row: unknown, cache: boolean): Settled {
  if (cache && row !== null && typeof row === "object") {
    // A kept row is frozen: looked up first, `isFrozen` only on a miss.
    const kept = settledRows.get(row);
    if (kept) return kept;
  }
  if (
    cache &&
    row !== null &&
    typeof row === "object" &&
    Object.isFrozen(row)
  ) {
    const enc = encodeRow(row);
    const entry: Settled = { enc, marks: marksOf(enc) };
    if (!seenRows.has(row)) seenRows.add(row);
    else if (!unsettledRows.has(row)) {
      if (settled(row, 1)) settledRows.set(row, entry);
      else unsettledRows.add(row);
    }
    return entry;
  }
  const enc = encodeRow(row);
  return { enc, marks: marksOf(enc) };
}

/** An array's rows as `JSON.stringify` writes them (a hole is `null`), and what each holds. */
interface Encoded {
  enc: string[];
  marks: Uint8Array;
  /** Some row holds a Markdown document. */
  markdown: boolean;
  /** The cache was usable (no `toJSON` on the shared prototypes). */
  cache: boolean;
}

/** Each row of an array as `JSON.stringify` writes it; a hole is `null`. */
function encodeRows(rows: readonly unknown[]): Encoded {
  // A `toJSON` added to the shared prototypes would change any row's JSON:
  // then nothing is taken from (or kept in) the cache.
  const cache =
    !("toJSON" in Object.prototype) && !("toJSON" in Array.prototype);
  const enc: string[] = [];
  const marks = new Uint8Array(rows.length);
  let markdown = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rowEncoding(rows[i], cache);
    enc[i] = row.enc;
    marks[i] = row.marks;
    if (row.marks & HAS_MARKDOWN) markdown = true;
  }
  return { enc, marks, markdown, cache };
}

/** A row's limit counts, kept with its encoding when the row cannot change. */
function rowCount(row: unknown, cache: boolean): RowCount {
  const kept =
    cache && row !== null && typeof row === "object"
      ? settledRows.get(row)
      : undefined;
  if (!kept) return countRow(row);
  return (kept.count ??= countRow(row));
}

function sameRows(a: readonly string[], b: readonly string[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** An initial property (wire form) as sent. */
function sentOf(value: Json, patches: boolean): Sent {
  if (isPrimitive(value)) return { kind: "value", value };
  if (Array.isArray(value) && patches) {
    const keyed = keyOf(value);
    return {
      kind: "rows",
      rows: {
        enc: encodeRows(value).enc,
        field: keyed?.field ?? null,
        keys: keyed?.keys ?? null,
        counts: [],
      },
    };
  }
  return { kind: "json", enc: JSON.stringify(value) };
}

/**
 * A write sent in parts stopped because its view closed or showed its
 * initial properties again: not a failure.
 */
class Abandoned extends Error {}
/** The wire key of a Markdown document: rows holding one are never sent in parts. */ const MARKDOWN_KEY =
  '"$vestraMarkdown"';

/** A row larger than one request can carry (`limit`). */
const rowTooLarge = (key: string, bytes: number) =>
  new HostError(
    "limit",
    `${key}: a row of ${bytes} bytes is larger than one request takes (${CHUNK_BYTES} bytes)`,
  );

/** Refuse a patch carrying a row larger than one request, before sending it. */
function tooLarge(key: string, ops: readonly RowOp[]) {
  for (const op of ops) {
    const rows = op.op === "set" ? [op.row] : op.op === "insert" ? op.rows : [];
    for (const row of rows) {
      const bytes = rowBytes(row);
      if (bytes > CHUNK_BYTES) throw rowTooLarge(key, bytes);
    }
  }
}

/**
 * The row patch from `sent` to `next` (the bound `rows`), in wire form, and
 * the new rows' limit counts; `null` when the whole value is to be sent:
 * nothing to type the rows by (no rows sent), a Markdown document in a row
 * (the player merges documents in place), too many operations, a value over
 * the limits (the player refuses it whole, as before), or no change (an
 * explicit `set()` of the same value).
 */
function rowPatch(
  sent: Rows,
  next: NonNullable<Pending["rows"]>,
  rows: readonly PropValue[],
): { ops: RowOp[]; counts: (RowCount | undefined)[] } | null {
  if (sent.enc.length === 0) return null;
  if (next.markdown) return null;
  const nextKeyed = sent.field === null ? null : next.keyed();
  const keyed = nextKeyed !== null && nextKeyed.field === sent.field;
  const plan = diff(
    { enc: sent.enc, keys: keyed ? sent.keys : null },
    { enc: next.enc, keys: keyed ? nextKeyed.keys : null },
  );
  if (!plan || plan.ops.length === 0) return null;
  // A released image is refused wherever it is, as in a whole write: the
  // rows the patch does not carry are checked too (those holding images).
  for (let j = 0; j < rows.length; j++)
    if (plan.from[j]! >= 0 && next.marks[j]! & HAS_IMAGE)
      wireValue(rows[j] ?? null);
  const counts = next.enc.map((_, j) => {
    const from = plan.from[j]!;
    return (
      (from >= 0 ? sent.counts[from] : undefined) ??
      rowCount(rows[j], next.cache)
    );
  });
  if (!withinLimits(counts as RowCount[])) return null;
  // The ops must give exactly the new rows (a guard against this diff's bugs).
  if (!sameRows(replay(sent.enc, plan.ops, next.enc), next.enc)) return null;
  const ops = plan.ops.map((op): RowOp => {
    switch (op.op) {
      case "set":
        return { op: "set", at: op.at, row: wireValue(rows[op.row] ?? null) };
      case "insert":
        return {
          op: "insert",
          at: op.at,
          rows: op.rows.map((j) => wireValue(rows[j] ?? null)),
        };
      default:
        return op;
    }
  });
  return { ops, counts };
}

/** Where a {@link ViewWriter}'s writes go, and what it asks of its view. */
export interface WriterTarget {
  /** The view shows its properties: writes may be sent. */
  live(): boolean;
  /** Send one property write to the player. */
  write(property: string, write: PropertyWrite): Promise<void>;
  /** Report a failure (the plugin's error handler and the player's log). */
  report(error: unknown): void;
  /** The player takes row patches (and `seq` on whole writes). */
  patches(): boolean;
}

/**
 * One view's properties: their values now, what the player shows as far as
 * this side knows, and the writes that bring the one to the other.
 */
export class ViewWriter {
  readonly #target: WriterTarget;
  readonly #values = new Map<string, PropValue>();
  /** What the host currently shows, as far as this side knows. */
  #sent = new Map<string, Sent>();
  /**
   * Row patches (player feature `ui.patch`): each property's last write the
   * player confirmed, by `seq` (0: the initial properties). A patch applies
   * on it; a property without one is sent whole.
   */
  #bases = new Map<string, number>();
  /**
   * Patches of a property answered `stale` in a row: after two, the
   * property is sent whole until the view shows its initial properties again.
   */
  readonly #stales = new Map<string, number>();
  #seq = 0;
  /** Counts the times the view showed its initial properties (`shown`). */
  #generation = 0;
  /** Written by `set()`: sent even if equal to what was sent before. */
  readonly #forced = new Set<string>();
  /** The last value of each property whose write failed; not retried until it changes. */
  readonly #failed = new Map<string, string>();
  #backoff = 0;
  /** A write failed and none succeeded since: further failures stay quiet. */
  #broken = false;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #flushing = false;
  /**
   * The view was bound (`track()`): every value is compared with what was
   * sent and arrays are patched. Before, only `set()` values are sent,
   * whole, and no patch base is kept.
   */
  #tracked = false;
  constructor(target: WriterTarget) {
    this.#target = target;
  }
  /**
   * The view's first `bind()`: compare and patch from now on. What was
   * sent before is known as whole values, so the first patchable write of
   * an array goes whole and patches follow it.
   */
  track() {
    this.#tracked = true;
  }
  /** Row patches apply: the player takes them and the view is bound. */
  get #patching() {
    return this.#tracked && this.#patches;
  }
  /** The player takes row patches (and `seq` on whole writes). */
  get #patches() {
    return this.#target.patches();
  }
  /**
   * Initial properties in wire form. A released image is left out (the
   * property keeps its default) and reported, like a failed write. With a
   * player that takes row patches, the arrays of one request carry at most
   * {@link CHUNK_BYTES} of rows together (SDK 1.5.46): an array over that
   * goes with its first rows, and the first flush sends the rest as patches.
   * An array over the value limits is refused here, as the player would
   * refuse it whole: left out and reported (a panel, a settings page), or,
   * with `refuse` (a window's `show`), thrown.
   */
  wired(
    values: Record<string, PropValue>,
    refuse = false,
  ): Record<string, Json> {
    const out: Record<string, Json> = {};
    let room = CHUNK_BYTES;
    for (const [key, value] of Object.entries(values)) {
      let wire: Json;
      try {
        wire = wireValue(value);
      } catch (error) {
        this.#failed.set(key, JSON.stringify(value));
        this.#target.report(error);
        continue;
      }
      if (this.#patches && Array.isArray(wire)) {
        const sizes = wire.map(rowBytes);
        const total = sizes.reduce((a, b) => a + b, 0);
        if (total > room && !JSON.stringify(wire).includes(MARKDOWN_KEY)) {
          const largest = sizes.reduce((a, b) => Math.max(a, b), 0);
          const problem = valueLimitProblem(wire);
          if (problem || largest > CHUNK_BYTES) {
            const error = problem
              ? new HostError("limit", `${key}: ${problem}`)
              : rowTooLarge(key, largest);
            if (refuse) throw error;
            this.#failed.set(key, JSON.stringify(value));
            this.#target.report(error);
            continue;
          }
          const count = room > 0 ? prefixWithin(sizes, room) : 0;
          wire = wire.slice(0, count);
          room -= sizes.slice(0, count).reduce((a, b) => a + b, 0);
        } else room -= total;
      }
      out[key] = wire;
    }
    return out;
  }
  /** `View.set`: each value is sent once even if equal to what was sent. */
  set(props: Props) {
    for (const [key, value] of Object.entries(encode(props))) {
      this.#values.set(key, value);
      this.#forced.add(key);
      this.#failed.delete(key); // an explicit write is tried again (after any back-off)
    }
    this.flush();
  }
  /** A bound value (Slint name): sent by the next flush if it changed. */
  assign(key: string, value: PropValue) {
    this.#values.set(key, value);
  }
  /** Every property's value now, by Slint name. */
  values(): Record<string, PropValue> {
    return Object.fromEntries(this.#values);
  }
  /** The host already shows these values (e.g. sent as initial properties). */
  shown(values: Record<string, Json>) {
    this.#generation++;
    const patches = this.#patching;
    this.#sent = new Map(
      Object.entries(values).map(([k, v]) => [k, sentOf(v, patches)]),
    );
    this.#bases = new Map(
      patches ? Object.keys(values).map((key) => [key, 0]) : [],
    );
    this.#stales.clear();
    this.#forced.clear();
    for (const key of Object.keys(values)) this.#failed.delete(key);
    // Not bound, a flush sends only what is marked: mark every value the
    // view does not show as it is now, such as a `set()` made while the view
    // was opening (after its initial properties were taken) or an initial
    // array cut to one request's size (`wired`), whose rest goes now.
    if (!this.#tracked)
      for (const [key, value] of this.#values)
        if (this.#encode(key, value).changed) this.#forced.add(key);
  }
  /** `value` encoded, and whether it differs from what was sent. */
  #encode(key: string, value: PropValue): Pending {
    const sent = this.#sent.get(key);
    if (isPrimitive(value)) {
      // Compared as it is: no `JSON.stringify` for the scalars of a pass.
      const changed =
        sent?.kind === "value"
          ? sent.value !== value
          : sent?.kind !== "json" || sent.enc !== JSON.stringify(value);
      return {
        key,
        value,
        changed,
        signature: () => JSON.stringify(value),
        sent: () => ({ kind: "value", value }),
      };
    }
    if (Array.isArray(value) && this.#patches) {
      // Row by row: the same work as one `JSON.stringify`, and the rows to
      // diff against those last sent. Rows that cannot change (deep-frozen
      // objects bound again, SDK 1.5.47) are taken from `settledRows`.
      const encoded = encodeRows(value);
      const { enc } = encoded;
      const signature = () => `[${enc.join(",")}]`;
      const changed =
        sent?.kind === "rows"
          ? !sameRows(sent.rows.enc, enc)
          : sent?.kind !== "json" || sent.enc !== signature();
      // Keys only for a write: an unchanged array costs its encoding alone.
      let keys: ReturnType<typeof keyOf> | undefined;
      const keyed = () => (keys === undefined ? (keys = keyOf(value)) : keys);
      // Not bound: remembered as its JSON, for a later bind() to compare
      // with; no rows or keys are kept until patches can follow.
      const tracked = this.#tracked;
      return {
        key,
        value,
        changed,
        signature,
        rows: { ...encoded, keyed },
        sent: (counts = []) =>
          tracked
            ? {
                kind: "rows",
                rows: {
                  enc,
                  field: keyed()?.field ?? null,
                  keys: keyed()?.keys ?? null,
                  counts,
                },
              }
            : { kind: "json", enc: signature() },
      };
    }
    const enc = JSON.stringify(value);
    return {
      key,
      value,
      changed: sent?.kind !== "json" || sent.enc !== enc,
      signature: () => enc,
      sent: () => ({ kind: "json", enc }),
    };
  }
  /**
   * Write one property: a row patch when the player takes them and one
   * applies (else the whole value); a `stale` patch is followed by the whole
   * value at once. The base is forgotten on any failure, so the next write
   * of the property is whole. A write larger than one request
   * ({@link CHUNK_BYTES} of rows, SDK 1.5.46) is sent in parts: a whole
   * array as its first rows and `insert` patches of the rest, a patch as
   * several, each applying on the one before.
   */
  async #send(pending: Pending): Promise<Sent> {
    const { key, value } = pending;
    if (!this.#patches) {
      await this.#target.write(key, { value: wireValue(value) });
      return pending.sent();
    }
    const generation = this.#generation;
    const base = this.#bases.get(key);
    this.#bases.delete(key);
    const sent = this.#sent.get(key);
    let plan =
      base !== undefined &&
      sent?.kind === "rows" &&
      pending.rows &&
      (this.#stales.get(key) ?? 0) < 2
        ? rowPatch(sent.rows, pending.rows, value as PropValue[])
        : null;
    // A patch sent in several never passes the row limit midway (the diff
    // removes before it inserts; checked anyway); otherwise whole.
    if (plan && sent?.kind === "rows") {
      let length = sent.rows.enc.length;
      for (const op of plan.ops) {
        if (op.op === "insert") length += op.rows.length;
        else if (op.op === "remove") length -= op.count;
        if (length > UI_VALUE_LIMITS.arrayRows) {
          plan = null;
          break;
        }
      }
    }
    if (plan) {
      tooLarge(key, plan.ops);
      const [first, ...rest] = chunkOps(plan.ops);
      const seq = ++this.#seq;
      let applied = false;
      try {
        await this.#target.write(key, {
          patch: { base: base!, seq, ops: first! },
        });
        applied = true;
      } catch (error) {
        if (!(error instanceof HostError && error.code === "stale"))
          throw error;
        this.#stales.set(key, (this.#stales.get(key) ?? 0) + 1);
      }
      if (applied) {
        this.#stales.delete(key);
        await this.#parts(key, seq, rest, false, generation);
        return pending.sent(plan.counts);
      }
    }
    const seq = ++this.#seq;
    // Rows holding Markdown documents go whole, as before: the player
    // merges documents in place and takes no parts of them.
    if (Array.isArray(value) && pending.rows && !pending.rows.markdown) {
      const sizes = pending.rows.enc.map(jsonBytes);
      const count = prefixWithin(sizes, CHUNK_BYTES);
      if (count < value.length) {
        const rows = value as PropValue[];
        // Over the limits, or a row larger than one request: refused here,
        // as the player would refuse the whole value, before any part is
        // sent (a part refused midway would leave the list half sent).
        const problem = valueLimitProblem(wireValue(value));
        if (problem) throw new HostError("limit", `${key}: ${problem}`);
        const largest = sizes.reduce((a, b) => Math.max(a, b), 0);
        if (largest > CHUNK_BYTES) throw rowTooLarge(key, largest);
        // Every part but the last carries `more`: the player holds them
        // and writes the whole value at the last, so a list it shows is
        // written once (player 0.6.0).
        await this.#target.write(key, {
          value: wireValue(rows.slice(0, count) as PropValue),
          seq,
          more: true,
        });
        const insert: RowOp = {
          op: "insert",
          at: count,
          rows: rows.slice(count).map((row) => wireValue(row ?? null)),
        };
        await this.#parts(key, seq, chunkOps([insert]), true, generation);
        return pending.sent();
      }
    }
    await this.#target.write(key, { value: wireValue(value), seq });
    // A base for the next patch, once the view is bound.
    if (this.#tracked) this.#bases.set(key, seq);
    return pending.sent();
  }
  /**
   * The rest of a write sent in parts: each patch applies on the one
   * before (`base`), and the property's base is the last one's; with
   * `more`, every part but the last says so. A failure leaves no base: the
   * next write of the property is whole. When the view closed or showed its
   * initial properties again meanwhile (`generation`), the rest is dropped
   * quietly ({@link Abandoned}): the view's next flush sends what it shows.
   */
  async #parts(
    key: string,
    base: number,
    groups: RowOp[][],
    more: boolean,
    generation: number,
  ) {
    let last = base;
    for (const [i, ops] of groups.entries()) {
      if (!this.#target.live() || this.#generation !== generation)
        throw new Abandoned();
      const seq = ++this.#seq;
      try {
        await this.#target.write(key, {
          patch: { base: last, seq, ops },
          ...(more && i < groups.length - 1 ? { more: true } : {}),
        });
      } catch (error) {
        // Refused because the view went meanwhile: not a failure.
        if (!this.#target.live() || this.#generation !== generation)
          throw new Abandoned();
        throw error;
      }
      last = seq;
    }
    if (this.#tracked) this.#bases.set(key, last);
  }
  /**
   * Send what changed. A bound value is sent when it differs from the last one
   * sent; a `set()` value is always sent once. Nothing is resent merely
   * because a callback arrived, so text the user typed into an in-out
   * property survives other callbacks (call `set()` to pull a control back).
   * A failed bound value is not repeated until it changes; an explicit `set()`
   * is, after a back-off (0.25 s doubling to 30 s). Only the first failure of
   * a failing streak is reported, so an error handler that writes a status to
   * a broken view cannot spin.
   */
  flush() {
    if (this.#flushing || this.#retry || !this.#target.live()) return;
    this.#flushing = true;
    void (async () => {
      let failed = false;
      let failure: unknown;
      try {
        let pending: Pending[];
        do {
          pending = [];
          // Not bound: only what `set()` named is sent (whole), nothing is
          // compared. Bound: every value against what was sent.
          const keys = this.#tracked ? this.#values.keys() : [...this.#forced];
          for (const key of keys) {
            if (!this.#values.has(key)) continue;
            const value = this.#values.get(key) as PropValue;
            const encoded = this.#encode(key, value);
            const failedAs = this.#failed.get(key);
            if (failedAs !== undefined && failedAs === encoded.signature())
              continue;
            if (this.#forced.has(key) || encoded.changed) pending.push(encoded);
          }
          for (const encoded of pending) {
            if (!this.#target.live()) return;
            const key = encoded.key;
            this.#forced.delete(key);
            try {
              this.#sent.set(key, await this.#send(encoded));
              this.#failed.delete(key);
              this.#backoff = 0;
              this.#broken = false;
            } catch (error) {
              // The view closed or showed its initial properties again while
              // a write was sent in parts: nothing failed (the next flush
              // sends what the view shows).
              if (error instanceof Abandoned) {
                queueMicrotask(() => this.flush());
                return;
              }
              failed = true;
              // Report the start of a failing streak only.
              if (!this.#broken) failure ??= error;
              this.#broken = true;
              this.#failed.set(key, encoded.signature());
            }
          }
        } while (pending.length && !failed && this.#target.live());
      } finally {
        this.#flushing = false;
      }
      if (!failed) return;
      this.#backoff = Math.min(Math.max(250, this.#backoff * 2), 30_000);
      this.#retry = setTimeout(() => {
        this.#retry = undefined;
        this.flush();
      }, this.#backoff);
      this.#retry.unref?.();
      if (failure !== undefined) this.#target.report(failure);
    })();
  }
  /** The view closed: no retry after a back-off. */
  stop() {
    clearTimeout(this.#retry);
  }
}
