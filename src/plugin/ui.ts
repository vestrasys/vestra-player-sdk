/** Tool windows, docked panels and system dialogs. */
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { failure, Latest, quiet } from "./runtime.ts";
import { dropsOf } from "./drops.ts";
import type { Json } from "../wire.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Runtime } from "./runtime.ts";
import type { LayoutSlot } from "../wire.ts";
import type {
  BackdropSlot,
  Command,
  Dialogs,
  Disposable,
  ImageRef,
  Panel,
  PanelSlot,
  Panels,
  PropValue,
  SidebarSlot,
  SlotState,
  Props,
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
  constructor(scope: ScopeImpl, path: string) {
    this.#scope = scope;
    this.path = path;
  }
  /** Released with its scope: writing it is `invalid`. */
  get released() {
    return this.#scope.disposed;
  }
  toJSON(): Json {
    return { $vestraImage: this.path, ref: this.#ref };
  }
}

/** A property value as sent: images in wire form; released ones refused. */
function wireValue(value: PropValue): Json {
  if (!(value instanceof ImageHandle)) return value as Json;
  if (value.released)
    throw failure(
      "invalid",
      `image ${value.path} was released with the scope that created it`,
    );
  return value.toJSON();
}

export const ui = (scope: ScopeImpl): Ui => ({
  image(path) {
    if (typeof path !== "string" || !path)
      throw failure("invalid", "ui.image needs a file path");
    return new ImageHandle(scope, path);
  },
});

/** Property and callback plumbing shared by windows, panels and settings pages. */
export abstract class ViewBase implements View {
  protected readonly scope: ScopeImpl;
  protected readonly handlers = new Map<string, (...args: Json[]) => unknown>();
  readonly #values = new Map<string, PropValue>();
  readonly #binders = new Set<() => Props>();
  /** What the host currently shows, as far as this side knows. */
  #sent = new Map<string, string>();
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
  protected abstract write(property: string, value: Json): Promise<void>;
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
    this.#binders.add(props);
    this.scope.update();
    return this.scope.onDispose(() => {
      this.#binders.delete(props);
    });
  }
  /** Current desired properties (bound values win over earlier `set`). */
  protected snapshot(): Record<string, PropValue> {
    for (const binder of this.#binders) {
      try {
        for (const [key, value] of Object.entries(encode(binder())))
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
    this.#sent = new Map(
      Object.entries(values).map(([k, v]) => [k, JSON.stringify(v)]),
    );
    this.#forced.clear();
    for (const key of Object.keys(values)) this.#failed.delete(key);
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
        let pending: [string, PropValue][];
        do {
          pending = [...this.#values].filter(([key, value]) => {
            const encoded = JSON.stringify(value);
            if (this.#failed.get(key) === encoded) return false;
            return this.#forced.has(key) || this.#sent.get(key) !== encoded;
          });
          for (const [key, value] of pending) {
            if (!this.live()) return;
            const encoded = JSON.stringify(value);
            this.#forced.delete(key);
            try {
              await this.write(key, wireValue(value));
              this.#sent.set(key, encoded);
              this.#failed.delete(key);
              this.#backoff = 0;
              this.#broken = false;
            } catch (error) {
              failed = true;
              // Report the start of a failing streak only.
              if (!this.#broken) failure ??= error;
              this.#broken = true;
              this.#failed.set(key, encoded);
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
      throw new Error(`window ${id} already exists; pass a distinct id`);
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
  protected write(property: string, value: Json) {
    return this.scope.runtime.host.ui.set(this.#id, property, value);
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
  protected write(property: string, value: Json) {
    return this.scope.runtime.host.ui.setMount(property, value);
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
  }
}

export const windows = (scope: ScopeImpl): Windows => ({
  create: (file, options) =>
    new WindowHandle(scope, file, options?.id ?? basename(file, extname(file))),
});

type Layout = {
  bottom: SlotState | null;
  sidebar: SlotState | null;
  backdrop: { readonly effective: boolean } | null;
};

/**
 * Both positions, one per plugin: read with `layout.state` after every
 * `window.state` event (one read in flight; events during it cause one more)
 * and after this plugin's own changes. Started on first use.
 */
class LayoutService {
  readonly #runtime: Runtime;
  state: Layout = { bottom: null, sidebar: null, backdrop: null };
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
    this.#runtime.on("window.state", () => void this.read());
    void this.read();
  }
  watch(listener: (layout: Layout) => void) {
    this.start();
    this.#listeners.add(listener);
    return { dispose: async () => void this.#listeners.delete(listener) };
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
        const next = {
          bottom: view(raw.bottom),
          sidebar: view(raw.sidebar),
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
    change: { visible?: boolean; detached?: boolean },
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
    onChange(listener) {
      let last = JSON.stringify(service().state[name]);
      const watch = service().watch((layout) => {
        const next = JSON.stringify(layout[name]);
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
    options: { title?: string; fileName?: string } = {},
  ) => {
    const result = await scope.runtime.host.dialogs.open({ kind, ...options });
    return result.cancelled ? [] : result.paths;
  };
  return {
    async confirm(options) {
      const { message, detail, confirm, cancel, destructive, checkbox } =
        options ?? ({} as never);
      const length = (text: unknown, min: number, max: number) =>
        typeof text === "string" &&
        [...text].length >= min &&
        [...text].length <= max;
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
      const answer = await scope.runtime.host.dialogs.confirm({
        message,
        confirm,
        ...(detail === undefined ? {} : { detail }),
        ...(cancel === undefined ? {} : { cancel }),
        ...(destructive === undefined ? {} : { destructive }),
        ...(checkbox === undefined ? {} : { checkbox }),
      });
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
