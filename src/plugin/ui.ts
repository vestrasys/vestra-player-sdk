/** Tool windows, docked panels and system dialogs. */
import { readFileSync } from "node:fs";
import { basename, extname, resolve } from "node:path";
import { Latest, quiet } from "./runtime.ts";
import type { Json } from "../index.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  Dialogs,
  Disposable,
  Panel,
  PanelVisibility,
  Panels,
  Props,
  View,
  Window,
  Windows,
} from "./types.ts";

/** Slint names are kebab-case; plugin code may use camelCase. */
export const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const encode = (props: Props) =>
  Object.fromEntries(Object.entries(props).map(([k, v]) => [kebab(k), v]));

/** Property and callback plumbing shared by windows and panels. */
abstract class ViewBase implements View {
  protected readonly scope: ScopeImpl;
  protected readonly handlers = new Map<string, (...args: Json[]) => unknown>();
  readonly #values = new Map<string, Json>();
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
  protected snapshot(): Record<string, Json> {
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
    this.#failed.clear();
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
        let pending: [string, Json][];
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
              await this.write(key, value);
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
    scope.add(this);
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
      const initial = this.snapshot();
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
    this.scope.runtime.views.delete(this.#id);
  }
}

/** Find `export component X` / `export global Y` so most mounts need no names. */
function exported(directory: string, file: string, kind: string) {
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
  #visibility: PanelVisibility | null = null;
  readonly #listeners = new Set<(visibility: PanelVisibility) => void>();
  readonly #locks = { focused: false, dragging: false, popupOpen: false };
  readonly #interaction: Latest<Locks>;
  #reading = false;
  #again = false;
  constructor(
    scope: ScopeImpl,
    slot: "bottom" | "sidebar",
    file: string,
    options: { component?: string; global?: string },
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
          const properties = this.snapshot();
          await runtime.host.ui.mount({
            slot,
            file,
            component,
            global,
            properties,
          });
          this.#mounted = true;
          this.shown(properties);
          this.flush();
          await this.#read();
        })(),
        (error) => scope.report(error),
      )
      .then(() => {});
    quiet(this.ready);
    scope.add(runtime.on("window.state", () => void this.#read()));
  }
  get visibility() {
    return this.#visibility;
  }
  protected live() {
    return this.#mounted && !this.closed;
  }
  protected write(property: string, value: Json) {
    return this.scope.runtime.host.ui.setMount(property, value);
  }
  /** One `ui.mountState` in flight; window events during it trigger one more. */
  async #read() {
    if (!this.#mounted || this.closed) return;
    if (this.#reading) {
      this.#again = true;
      return;
    }
    this.#reading = true;
    try {
      do {
        this.#again = false;
        // The host answers "pending" until the layout is confirmed; keep the last value.
        const state = await this.scope.runtime.host.ui
          .mountState()
          .catch(() => null);
        if (!state || this.closed) continue;
        const next = {
          preferred: state.preferred,
          effective: state.effective,
          reason: state.reason,
        };
        if (JSON.stringify(next) === JSON.stringify(this.#visibility)) continue;
        this.#visibility = next;
        for (const listener of this.#listeners) this.scope.run(listener, next);
        this.scope.update();
      } while (this.#again);
    } finally {
      this.#reading = false;
    }
  }
  onVisibility(listener: (visibility: PanelVisibility) => void) {
    this.#listeners.add(listener);
    return this.scope.onDispose(() => {
      this.#listeners.delete(listener);
    });
  }
  async setVisible(visible: boolean) {
    await this.ready;
    await this.scope.runtime.host.ui.showMount(visible);
    await this.#read();
  }
  async toggle() {
    await this.ready;
    const current = await this.scope.runtime.host.ui
      .mountState()
      .catch(() => null);
    await this.setVisible(
      !(current?.preferred ?? this.#visibility?.preferred ?? true),
    );
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

export const panels = (scope: ScopeImpl): Panels => ({
  mount: (slot, file, options = {}) =>
    new PanelHandle(scope, slot, file, options),
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
    openFile: async (options) => (await open("openFile", options))[0] ?? null,
    openFiles: (options) => open("openFiles", options),
    openDirectory: async (options) =>
      (await open("openDirectory", options))[0] ?? null,
    saveFile: async (options) => (await open("saveFile", options))[0] ?? null,
  };
};
