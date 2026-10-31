/** Tool windows, docked panels and system dialogs. */
import { shownText, templateArgs } from "./osd.ts";
import { isTextValue } from "../i18n.ts";
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { failure, Latest, quiet } from "./runtime.ts";
import { dropsOf } from "./drops.ts";
import { MarkdownHandle, markdown, remoteImageFile } from "./markdown.ts";
import { HostError } from "../wire.ts";
import type { Json, PropertyWrite, RowOp } from "../wire.ts";
import {
  countRow,
  diff,
  keyOf,
  PATCH_FEATURE,
  replay,
  withinLimits,
} from "./patch.ts";
import type { RowCount, RowKey, Rows } from "./patch.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Runtime } from "./runtime.ts";
import type { LayoutSlot } from "../wire.ts";
import type {
  BackdropSlot,
  Command,
  Dialogs,
  Disposable,
  ImageOptions,
  ImageRef,
  Panel,
  PanelSlot,
  PanelState,
  Panels,
  PropValue,
  SidebarSlot,
  SlotPanel,
  SlotState,
  Props,
  TextValue,
  Ui,
  View,
  Window,
  Windows,
} from "./types.ts";

/** Slint names are kebab-case; plugin code may use camelCase. */
export const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const encode = (props: Props) =>
  Object.fromEntries(Object.entries(props).map(([k, v]) => [kebab(k), v]));

let images = 0;

/**
 * `plugin.ui.image`. The wire form (`{ $vestraImage: path, ref }`) is an
 * internal detail; `ref` makes every call a new value, so a file rewritten
 * under the same path is sent (and decoded) again. The player checks the
 * path on every use, so a hand-made wire value gains nothing.
 */
export class ImageHandle implements ImageRef {
  readonly path: string;
  readonly __vestraImage = true as const;
  readonly #scope: ScopeImpl;
  readonly #ref = ++images;
  readonly #maxSide: number | undefined;
  constructor(scope: ScopeImpl, path: string, maxSide?: number) {
    this.#scope = scope;
    this.path = path;
    this.#maxSide = maxSide;
  }
  /** Released with its scope: writing it is `invalid`. */
  get released() {
    return this.#scope.disposed;
  }
  toJSON(): Json {
    // `maxSide` only when given: players before 0.5.1 refuse the field.
    return this.#maxSide === undefined
      ? { $vestraImage: this.path, ref: this.#ref }
      : { $vestraImage: this.path, ref: this.#ref, maxSide: this.#maxSide };
  }
}

/** `ImageOptions.maxSide`, checked: an integer 1–4096 or absent. */
export function imageSide(options: ImageOptions | undefined) {
  const side = options?.maxSide;
  if (side === undefined) return undefined;
  if (!Number.isInteger(side) || side < 1 || side > 4096)
    throw failure("invalid", "maxSide must be an integer 1–4096");
  return side;
}

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
  rows?: {
    enc: string[];
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
/** Each row of an array as `JSON.stringify` writes it; a hole is `null`. */
const encodeRows = (rows: readonly unknown[]) => Array.from(rows, encodeRow);

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
        enc: encodeRows(value),
        field: keyed?.field ?? null,
        keys: keyed?.keys ?? null,
        counts: [],
      },
    };
  }
  return { kind: "json", enc: JSON.stringify(value) };
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
  if (next.enc.some((row) => row.includes('"$vestraMarkdown"'))) return null;
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
    if (plan.from[j]! >= 0 && next.enc[j]!.includes('"$vestraImage"'))
      wireValue(rows[j] ?? null);
  const counts = next.enc.map((_, j) => {
    const from = plan.from[j]!;
    return (from >= 0 ? sent.counts[from] : undefined) ?? countRow(rows[j]);
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

export const ui = (scope: ScopeImpl): Ui => ({
  image(path, options) {
    if (typeof path !== "string" || !path)
      throw failure("invalid", "ui.image needs a file path");
    return new ImageHandle(scope, path, imageSide(options));
  },
  async remoteImage(url, options) {
    if (typeof url !== "string" || !url.startsWith("https://"))
      throw failure("invalid", "ui.remoteImage needs an https: address");
    const side = imageSide(options);
    const file = await remoteImageFile(scope.runtime, url);
    return new ImageHandle(scope, file, side);
  },
  markdown: (text, options) => markdown(scope, text, options),
});

/** Property and callback plumbing shared by windows, panels and settings pages. */
export abstract class ViewBase implements View {
  protected readonly scope: ScopeImpl;
  protected readonly handlers = new Map<string, (...args: Json[]) => unknown>();
  readonly #values = new Map<string, PropValue>();
  /** Each binding, with where the plugin added it (for the player's log). */
  readonly #binders = new Map<
    () => Props,
    { site: () => string | undefined; token: object }
  >();
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
  /** Written by `set()`: sent even if equal to what was sent before. */
  readonly #forced = new Set<string>();
  /** The last value of each property whose write failed; not retried until it changes. */
  readonly #failed = new Map<string, string>();
  #backoff = 0;
  /** A write failed and none succeeded since: further failures stay quiet. */
  #broken = false;
  #retry: ReturnType<typeof setTimeout> | undefined;
  #flushing = false;
  #binding: Disposable;
  protected closed = false;
  constructor(scope: ScopeImpl) {
    this.scope = scope;
    this.#binding = scope.runtime.bind(() => this.evaluate());
  }
  protected abstract live(): boolean;
  protected abstract write(
    property: string,
    write: PropertyWrite,
  ): Promise<void>;
  /** The player takes row patches (and `seq` on whole writes). */
  get #patches() {
    return this.scope.runtime.features.has(PATCH_FEATURE);
  }
  /**
   * Initial properties in wire form. A released image is left out (the
   * property keeps its default) and reported, like a failed write.
   */
  protected wired(values: Record<string, PropValue>): Record<string, Json> {
    const out: Record<string, Json> = {};
    for (const [key, value] of Object.entries(values)) {
      try {
        out[key] = wireValue(value);
      } catch (error) {
        this.#failed.set(key, JSON.stringify(value));
        this.scope.report(error);
      }
    }
    return out;
  }
  on<A extends Json[]>(callback: string, handler: (...args: A) => unknown) {
    const name = kebab(callback);
    this.handlers.set(name, handler as (...args: Json[]) => unknown);
    return this.scope.onDispose(() => {
      if (this.handlers.get(name) === handler) this.handlers.delete(name);
    });
  }
  set(props: Props) {
    for (const [key, value] of Object.entries(encode(props))) {
      this.#values.set(key, value);
      this.#forced.add(key);
      this.#failed.delete(key); // an explicit write is tried again (after any back-off)
    }
    this.flush();
  }
  bind(props: () => Props) {
    // `token` names this binding of this view in the runtime's read
    // tracking: the same function bound to two views is two parts.
    this.#binders.set(props, {
      site: this.scope.runtime.callSite(),
      token: {},
    });
    this.scope.update();
    return this.scope.onDispose(() => {
      this.#binders.delete(props);
    });
  }
  /**
   * Current desired properties (bound values win over earlier `set`). A
   * precise pass (`Runtime.part`) skips a bind function that read none of
   * the changed state: its last values stay.
   */
  protected snapshot(): Record<string, PropValue> {
    const runtime = this.scope.runtime;
    for (const [binder, { site, token }] of this.#binders) {
      try {
        // Encoded inside the part: what encoding reads counts as the
        // function's (a state object it returned).
        const result = runtime.part(token, () =>
          encode(runtime.reader("a view's bind", site, binder)),
        );
        if (!result) continue;
        for (const [key, value] of Object.entries(result.value))
          this.#values.set(key, value);
      } catch (error) {
        this.scope.report(error);
      }
    }
    return Object.fromEntries(this.#values);
  }
  protected evaluate() {
    if (this.closed) return;
    this.snapshot();
    this.flush();
  }
  /** The host already shows these values (e.g. sent as initial properties). */
  protected shown(values: Record<string, Json>) {
    const patches = this.#patches;
    this.#sent = new Map(
      Object.entries(values).map(([k, v]) => [k, sentOf(v, patches)]),
    );
    this.#bases = new Map(
      patches ? Object.keys(values).map((key) => [key, 0]) : [],
    );
    this.#stales.clear();
    this.#forced.clear();
    for (const key of Object.keys(values)) this.#failed.delete(key);
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
      // diff against those last sent.
      const enc = encodeRows(value);
      const signature = () => `[${enc.join(",")}]`;
      const changed =
        sent?.kind === "rows"
          ? !sameRows(sent.rows.enc, enc)
          : sent?.kind !== "json" || sent.enc !== signature();
      // Keys only for a write: an unchanged array costs its encoding alone.
      let keys: ReturnType<typeof keyOf> | undefined;
      const keyed = () => (keys === undefined ? (keys = keyOf(value)) : keys);
      return {
        key,
        value,
        changed,
        signature,
        rows: { enc, keyed },
        sent: (counts = []) => ({
          kind: "rows",
          rows: {
            enc,
            field: keyed()?.field ?? null,
            keys: keyed()?.keys ?? null,
            counts,
          },
        }),
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
   * of the property is whole.
   */
  async #send(pending: Pending): Promise<Sent> {
    const { key, value } = pending;
    if (!this.#patches) {
      await this.write(key, { value: wireValue(value) });
      return pending.sent();
    }
    const base = this.#bases.get(key);
    this.#bases.delete(key);
    const sent = this.#sent.get(key);
    const plan =
      base !== undefined &&
      sent?.kind === "rows" &&
      pending.rows &&
      (this.#stales.get(key) ?? 0) < 2
        ? rowPatch(sent.rows, pending.rows, value as PropValue[])
        : null;
    if (plan) {
      const seq = ++this.#seq;
      try {
        await this.write(key, { patch: { base: base!, seq, ops: plan.ops } });
        this.#bases.set(key, seq);
        this.#stales.delete(key);
        return pending.sent(plan.counts);
      } catch (error) {
        if (!(error instanceof HostError && error.code === "stale"))
          throw error;
        this.#stales.set(key, (this.#stales.get(key) ?? 0) + 1);
      }
    }
    const seq = ++this.#seq;
    await this.write(key, { value: wireValue(value), seq });
    this.#bases.set(key, seq);
    return pending.sent();
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
  protected flush() {
    if (this.#flushing || this.#retry || !this.live()) return;
    this.#flushing = true;
    void (async () => {
      let failed = false;
      let failure: unknown;
      try {
        let pending: Pending[];
        do {
          pending = [];
          for (const [key, value] of this.#values) {
            const encoded = this.#encode(key, value);
            const failedAs = this.#failed.get(key);
            if (failedAs !== undefined && failedAs === encoded.signature())
              continue;
            if (this.#forced.has(key) || encoded.changed) pending.push(encoded);
          }
          for (const encoded of pending) {
            if (!this.live()) return;
            const key = encoded.key;
            this.#forced.delete(key);
            try {
              this.#sent.set(key, await this.#send(encoded));
              this.#failed.delete(key);
              this.#backoff = 0;
              this.#broken = false;
            } catch (error) {
              failed = true;
              // Report the start of a failing streak only.
              if (!this.#broken) failure ??= error;
              this.#broken = true;
              this.#failed.set(key, encoded.signature());
            }
          }
        } while (pending.length && !failed && this.live());
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
      if (failure !== undefined) this.scope.report(failure);
    })();
  }
  protected dispatch(callback: string, args: Json[]) {
    if (this.closed) return;
    const handler = this.handlers.get(callback);
    if (handler) this.scope.run(handler, ...args);
    else this.scope.update();
  }
  protected async release() {
    this.closed = true;
    clearTimeout(this.#retry);
    await this.#binding.dispose();
  }
}

class WindowHandle extends ViewBase implements Window {
  readonly #id: string;
  readonly #file: string;
  #opened = false;
  #queue: Promise<unknown> = Promise.resolve();
  constructor(scope: ScopeImpl, file: string, id: string) {
    if (scope.runtime.views.has(id))
      throw failure(
        "conflict",
        `window ${id} already exists; pass a distinct id`,
      );
    super(scope);
    this.#file = file;
    this.#id = id;
    scope.runtime.views.set(id, (callback, args) =>
      this.dispatch(callback, args),
    );
    // The user closed it with the title bar: the host already dropped it.
    this.#closedByUser = scope.runtime.raw("ui.closed", (data) => {
      if ((data as { view?: string }).view !== this.#id || !this.#opened)
        return;
      this.#opened = false;
      for (const listener of [...this.#closeListeners])
        this.scope.run(listener);
      this.scope.update();
    });
    scope.add(this);
  }
  readonly #closeListeners = new Set<() => unknown>();
  readonly #closedByUser: Disposable;
  onClose(listener: () => unknown): Disposable {
    this.#closeListeners.add(listener);
    return this.scope.onDispose(() => {
      this.#closeListeners.delete(listener);
    });
  }
  get opened() {
    return this.#opened;
  }
  protected live() {
    return this.#opened && !this.closed;
  }
  protected write(property: string, write: PropertyWrite) {
    return this.scope.runtime.host.ui.set(this.#id, property, write);
  }
  on<A extends Json[]>(callback: string, handler: (...args: A) => unknown) {
    // The host forwards only callbacks named when the window opens.
    if (this.#opened && !this.handlers.has(kebab(callback)))
      throw new Error(
        `bind window handler ${callback} before the first show()`,
      );
    return super.on(callback, handler);
  }
  /** Window RPCs run strictly in order; a failure does not block later calls. */
  #serial<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(task, task);
    this.#queue = next.catch(() => {});
    return next;
  }
  show() {
    return this.#serial(async () => {
      if (this.closed) return;
      const ui = this.scope.runtime.host.ui;
      if (this.#opened) return ui.show(this.#id, true);
      const initial = this.wired(this.snapshot());
      await ui.open(this.#id, this.#file, initial, [...this.handlers.keys()]);
      this.#opened = true;
      this.shown(initial);
      this.flush();
    });
  }
  hide() {
    return this.#serial(async () => {
      if (this.#opened) await this.scope.runtime.host.ui.show(this.#id, false);
    });
  }
  close() {
    return this.#serial(async () => {
      if (!this.#opened) return;
      this.#opened = false;
      await this.scope.runtime.host.ui.close(this.#id);
    });
  }
  async dispose() {
    if (this.closed) return;
    this.scope.forget(this);
    await this.close().catch(() => {});
    await this.release();
    await this.#closedByUser.dispose();
    this.#closeListeners.clear();
    this.scope.runtime.views.delete(this.#id);
  }
}

/** Find `export component X` / `export global Y` so most mounts need no names. */
export function exported(directory: string, file: string, kind: string) {
  const text = readFileSync(resolve(directory, file), "utf8");
  const names = [
    ...text.matchAll(new RegExp(`export\\s+${kind}\\s+([\\w-]+)`, "g")),
  ].map((m) => m[1]!);
  if (names.length !== 1)
    throw new Error(
      `${file}: name the ${kind} to mount (found ${names.length})`,
    );
  return names[0]!;
}

type Locks = { focused: boolean; dragging: boolean; popupOpen: boolean };

class PanelHandle extends ViewBase implements Panel {
  readonly ready: Promise<void>;
  readonly #slot: "bottom" | "sidebar" | "backdrop";
  #mounted = false;
  readonly #locks = { focused: false, dragging: false, popupOpen: false };
  readonly #interaction: Latest<Locks>;
  constructor(
    scope: ScopeImpl,
    slot: "bottom" | "sidebar" | "backdrop",
    file: string,
    options: { component?: string; global?: string; title?: string },
  ) {
    if (scope.runtime.views.has("$mount"))
      throw new Error("a plugin can mount only one panel");
    super(scope);
    this.#slot = slot;
    const runtime = scope.runtime;
    runtime.views.set("$mount", (callback, args) =>
      this.dispatch(callback, args),
    );
    this.#interaction = new Latest((locks) =>
      runtime.host.ui.interaction(locks),
    );
    const component =
      options.component ?? exported(runtime.directory, file, "component");
    const global =
      options.global ?? exported(runtime.directory, file, "global");
    scope.add(this);
    this.ready = runtime
      .starting(
        (async () => {
          // Let handlers and bindings declared right after mount() join in.
          await Promise.resolve();
          const properties = this.wired(this.snapshot());
          await runtime.host.ui.mount({
            slot,
            file,
            component,
            global,
            ...(options.title === undefined ? {} : { title: options.title }),
            properties,
          });
          this.#mounted = true;
          this.shown(properties);
          this.flush();
          // The position's state changed: refresh it if this plugin reads it.
          await layoutOf(runtime).refresh();
        })(),
        (error) => scope.report(error),
      )
      .then(() => {});
    quiet(this.ready);
  }
  protected live() {
    return this.#mounted && !this.closed;
  }
  protected write(property: string, write: PropertyWrite) {
    return this.scope.runtime.host.ui.setMount(property, write);
  }
  get state(): PanelState | null {
    const service = layoutOf(this.scope.runtime);
    service.start();
    return this.live()
      ? panelState(service.state, this.#slot, this.scope.runtime.manifest.id)
      : null;
  }
  onChange(listener: (state: PanelState | null) => void) {
    const scope = this.scope;
    let last = JSON.stringify(this.state);
    const watch = layoutOf(scope.runtime).watch(() => {
      const state = this.state;
      const next = JSON.stringify(state);
      if (next === last) return;
      last = next;
      scope.run(listener, state);
    });
    return scope.add({
      dispose: async () => {
        scope.forget(watch);
        await watch.dispose();
      },
    });
  }
  async show() {
    await this.ready;
    if (this.#slot === "backdrop")
      throw failure("invalid", "the player shows the backdrop by itself");
    await layoutOf(this.scope.runtime).set(this.#slot, {
      active: this.scope.runtime.manifest.id,
      visible: true,
    });
  }
  async toggle() {
    await this.ready;
    if (this.#slot === "backdrop")
      throw failure("invalid", "the player shows the backdrop by itself");
    await layoutOf(this.scope.runtime).read();
    const state = this.state;
    if (state?.preferred && state.active)
      await layoutOf(this.scope.runtime).set(this.#slot, { visible: false });
    else await this.show();
  }
  async showMenu(items: (Command | null)[], at: { x: number; y: number }) {
    await this.ready;
    await this.scope.runtime.host.ui.menu(
      items.map((item) => item?.id ?? null),
      at.x,
      at.y,
    );
  }
  onDrop(listener: Parameters<Panel["onDrop"]>[0]) {
    const watch = dropsOf(this.scope.runtime).listen(this.scope, (event) =>
      this.scope.run(listener, event),
    );
    return this.scope.add({ dispose: () => watch.dispose() });
  }
  setInteraction(locks: Partial<Locks>) {
    Object.assign(this.#locks, locks);
    this.#interaction
      .push({ ...this.#locks })
      .catch((error) => this.scope.report(error));
  }
  async dispose() {
    if (this.closed) return;
    this.scope.forget(this);
    this.#interaction.stop();
    if (this.#mounted)
      await this.scope.runtime.host.ui.unmount().catch(() => {});
    this.#mounted = false;
    await this.release();
    this.scope.runtime.views.delete("$mount");
    // Listeners of `onChange` hear `null`.
    this.scope.runtime.invalidate();
    await layoutOf(this.scope.runtime).refresh();
  }
}

/** One panel's view of its position (`Panel.state`). */
function panelState(
  layout: Layout,
  slot: "bottom" | "sidebar" | "backdrop",
  plugin: string,
): PanelState | null {
  if (slot === "backdrop")
    return (
      layout.backdrop && {
        active: true,
        preferred: true,
        effective: layout.backdrop.effective,
        reason: null,
        detached: false,
      }
    );
  const state = layout[slot];
  if (!state) return null;
  // Players without tabs (no `panels`): the position holds this panel only.
  const panels = layout.tabs[slot];
  const own = panels?.find((panel) => panel.plugin === plugin);
  if (panels && !own) return null;
  const active = own?.active ?? true;
  return {
    active,
    preferred: state.preferred,
    effective: state.effective && active,
    reason: active ? state.reason : "otherTab",
    detached: state.detached,
  };
}

export const windows = (scope: ScopeImpl): Windows => ({
  create: (file, options) =>
    new WindowHandle(scope, file, options?.id ?? basename(file, extname(file))),
});

type Layout = {
  bottom: SlotState | null;
  sidebar: SlotState | null;
  /** `PanelSlot.panels` (null from players without tabs). */
  tabs: {
    bottom: readonly SlotPanel[] | null;
    sidebar: readonly SlotPanel[] | null;
  };
  backdrop: { readonly effective: boolean } | null;
};

/**
 * Both positions, one per plugin: read with `layout.state` after every
 * `window.state` event (one read in flight; events during it cause one more)
 * and after this plugin's own changes. Started on first use.
 */
class LayoutService {
  readonly #runtime: Runtime;
  state: Layout = {
    bottom: null,
    sidebar: null,
    tabs: { bottom: null, sidebar: null },
    backdrop: null,
  };
  readonly #listeners = new Set<(layout: Layout) => void>();
  #started = false;
  #reading = false;
  #again = false;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
  }
  /** Read again, but only once something in this plugin uses the state. */
  async refresh() {
    if (this.#started) await this.read();
  }
  start() {
    if (this.#started || !this.#runtime.can("ui.mount")) return;
    this.#started = true;
    // A mirror: panels listen through `watch`.
    this.#runtime.on("window.state", () => void this.read(), "events", true);
    void this.read();
  }
  watch(listener: (layout: Layout) => void) {
    this.start();
    this.#listeners.add(listener);
    const held = this.#runtime.hold("window.state");
    return {
      dispose: async () => {
        this.#listeners.delete(listener);
        await held.dispose();
      },
    };
  }
  async read() {
    if (this.#reading) {
      this.#again = true;
      return;
    }
    this.#reading = true;
    try {
      do {
        this.#again = false;
        // "pending" until the host confirmed the layout: keep the last value.
        const raw = await this.#runtime.host.layout.state().catch(() => null);
        if (!raw) continue;
        const view = (slot: LayoutSlot | null): SlotState | null =>
          slot && {
            preferred: slot.preferred,
            effective: slot.effective,
            reason: slot.reason,
            detached: slot.detached,
          };
        const tabs = (slot: LayoutSlot | null): readonly SlotPanel[] | null =>
          slot?.panels
            ? Object.freeze(
                slot.panels.map((panel) =>
                  Object.freeze({
                    plugin: panel.plugin,
                    title: panel.title,
                    active: panel.owner === slot.owner,
                  }),
                ),
              )
            : null;
        const next = {
          bottom: view(raw.bottom),
          sidebar: view(raw.sidebar),
          tabs: { bottom: tabs(raw.bottom), sidebar: tabs(raw.sidebar) },
          backdrop: raw.backdrop
            ? Object.freeze({ effective: raw.backdrop.effective === true })
            : null,
        };
        if (JSON.stringify(next) === JSON.stringify(this.state)) continue;
        this.state = next;
        for (const listener of [...this.#listeners]) listener(next);
        this.#runtime.invalidate();
      } while (this.#again);
    } finally {
      this.#reading = false;
    }
  }
  async set(
    slot: "bottom" | "sidebar",
    change: { visible?: boolean; detached?: boolean; active?: string },
  ) {
    this.start();
    await this.#runtime.host.layout.set({ slot, ...change });
    await this.read();
  }
}

const layoutOf = (runtime: Runtime) =>
  runtime.service("layout", () => new LayoutService(runtime));

function slot(scope: ScopeImpl, name: "bottom"): PanelSlot;
function slot(scope: ScopeImpl, name: "sidebar"): SidebarSlot;
function slot(scope: ScopeImpl, name: "bottom" | "sidebar"): SidebarSlot {
  const service = () => layoutOf(scope.runtime);
  return {
    get state() {
      service().start();
      return service().state[name];
    },
    get panels() {
      service().start();
      return service().state.tabs[name];
    },
    onChange(listener) {
      const seen = (layout: Layout) =>
        JSON.stringify([layout[name], layout.tabs[name]]);
      let last = seen(service().state);
      const watch = service().watch((layout) => {
        const next = seen(layout);
        if (next === last) return;
        last = next;
        scope.run(listener, layout[name]);
      });
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
    setVisible: (visible) => service().set(name, { visible }),
    async toggle() {
      await service().read();
      const current = service().state[name];
      await service().set(name, { visible: !(current?.preferred ?? true) });
    },
    setDetached: (detached) => service().set(name, { detached }),
    activate: (plugin) => service().set(name, { active: plugin }),
  };
}

function backdrop(scope: ScopeImpl): BackdropSlot {
  const service = () => layoutOf(scope.runtime);
  return {
    get state() {
      service().start();
      return service().state.backdrop;
    },
    onChange(listener) {
      let last = JSON.stringify(service().state.backdrop);
      const watch = service().watch((layout) => {
        const next = JSON.stringify(layout.backdrop);
        if (next === last) return;
        last = next;
        scope.run(listener, layout.backdrop);
      });
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
  };
}

export const panels = (scope: ScopeImpl): Panels => ({
  mount: (position, file, options = {}) =>
    new PanelHandle(scope, position, file, options),
  bottom: slot(scope, "bottom"),
  sidebar: slot(scope, "sidebar"),
  backdrop: backdrop(scope),
});

export const dialogs = (scope: ScopeImpl): Dialogs => {
  const open = async (
    kind: "openFile" | "openFiles" | "openDirectory" | "saveFile",
    options: { title?: TextValue; fileName?: TextValue } = {},
  ) => {
    const result = await scope.runtime.host.dialogs.open({
      kind,
      ...(options.title === undefined
        ? {}
        : { title: shownText(options.title, undefined, "title") }),
      ...(options.fileName === undefined
        ? {}
        : { fileName: shownText(options.fileName, undefined, "fileName") }),
    });
    return result.cancelled ? [] : result.paths;
  };
  return {
    async confirm(options) {
      const { message, detail, confirm, cancel, destructive, checkbox, args } =
        options ?? ({} as never);
      const values = templateArgs(args);
      // A string's length is checked here; a text value's (shown) length by
      // the player.
      const length = (text: unknown, min: number, max: number) =>
        isTextValue(text) ||
        (typeof text === "string" &&
          [...text].length >= min &&
          [...text].length <= max);
      if (
        !length(message, 1, 200) ||
        !length(confirm, 1, 40) ||
        (detail !== undefined && !length(detail, 0, 2000)) ||
        (cancel !== undefined && !length(cancel, 1, 40)) ||
        (checkbox !== undefined && !length(checkbox, 1, 40)) ||
        (destructive !== undefined && typeof destructive !== "boolean")
      )
        throw failure(
          "invalid",
          "confirm needs message 1–200, confirm/cancel/checkbox 1–40, detail ≤ 2000 characters",
        );
      // `args` fills the string templates; a text value carries its own.
      const shown = (text: TextValue, what: string) =>
        shownText(text, undefined, what);
      const answer = await scope.runtime.host.dialogs.confirm({
        message: shown(message, "message"),
        confirm: shown(confirm, "confirm"),
        ...(detail === undefined ? {} : { detail: shown(detail, "detail") }),
        ...(cancel === undefined ? {} : { cancel: shown(cancel, "cancel") }),
        ...(destructive === undefined ? {} : { destructive }),
        ...(checkbox === undefined
          ? {}
          : { checkbox: shown(checkbox, "checkbox") }),
        ...(values === undefined ? {} : { args: values }),
      } as { [key: string]: Json });
      return {
        confirmed: answer.confirmed === true,
        checked: answer.checked === true,
      };
    },
    openFile: async (options) => (await open("openFile", options))[0] ?? null,
    openFiles: (options) => open("openFiles", options),
    openDirectory: async (options) =>
      (await open("openDirectory", options))[0] ?? null,
    saveFile: async (options) => (await open("saveFile", options))[0] ?? null,
  };
};
