/** Shared machinery behind every scope: invocation, update passes, events. */
import { createWire, HostError } from "../wire.ts";
import type { Json, Transport, UiCallback, Wire } from "../wire.ts";
import type { Disposable, PluginError } from "./types.ts";

export interface PluginManifest {
  id: string;
  capabilities: string[];
}

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function toError(error: unknown): PluginError {
  if (error instanceof Error) {
    const coded = error as PluginError;
    if (typeof coded.code !== "string")
      Object.defineProperty(coded, "code", {
        value: error.name === "AbortError" ? "aborted" : "error",
        enumerable: false,
        writable: true,
      });
    return coded;
  }
  return new HostError("error", String(error));
}

export const failure = (code: string, message: string = code): PluginError =>
  new HostError(code, message);

/** Host replies are definite; anything else (lost reply, client timeout) is not. */
export const uncertain = (error: unknown) =>
  !(error instanceof HostError) || error.code === "timeout";

/** Mark a promise as observed so an unused `ready` never crashes the runner. */
export function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

export const same = (a: Json | undefined, b: Json | undefined) =>
  JSON.stringify(a) === JSON.stringify(b);

/** One value in flight, only the newest waiting. Each push learns its fate. */
export class Latest<T> {
  #queued: { value: T; settle: (ok: boolean, error?: unknown) => void }[] = [];
  #running = false;
  #stopped = false;
  readonly #send: (value: T) => Promise<void>;
  constructor(send: (value: T) => Promise<void>) {
    this.#send = send;
  }
  push(value: T): Promise<boolean> {
    if (this.#stopped) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      for (const older of this.#queued.splice(0)) older.settle(false);
      this.#queued.push({
        value,
        settle: (ok, error) =>
          error === undefined ? resolve(ok) : reject(error),
      });
      if (!this.#running) void this.#drain();
    });
  }
  stop() {
    this.#stopped = true;
    for (const older of this.#queued.splice(0)) older.settle(false);
  }
  async #drain() {
    this.#running = true;
    try {
      let next;
      while ((next = this.#queued.shift()) && !this.#stopped) {
        try {
          await this.#send(next.value);
          next.settle(true);
        } catch (error) {
          next.settle(false, error);
        }
      }
    } finally {
      this.#running = false;
    }
  }
}

type Listener = (data: unknown) => void;

/**
 * Per-plugin services. Scopes are thin views over this object; the flat RPC
 * clients stay private here so protocol fields never reach plugin code.
 */
export class Runtime {
  readonly host: Wire;
  readonly manifest: PluginManifest;
  readonly directory: string;
  /** Registrations that activation must wait for before reporting ready. */
  readonly startup = new Set<Promise<unknown>>();
  #activating = true;
  readonly #transport: Transport;
  readonly #bindings = new Set<() => void>();
  #scheduled = false;
  readonly #events = new Map<
    string,
    { listeners: Set<Listener>; off?: Promise<() => Promise<void>> }
  >();
  readonly views = new Map<string, (callback: string, args: Json[]) => void>();
  readonly commands = new Map<string, () => void>();
  readonly services = new Map<string, unknown>();
  constructor(
    transport: Transport,
    manifest: PluginManifest,
    directory: string,
  ) {
    this.#transport = transport;
    this.host = createWire(transport);
    this.manifest = manifest;
    this.directory = directory;
    transport.on("ui.callback", (data) => {
      const event = data as UiCallback;
      this.views.get(event.view)?.(event.callback, event.args);
    });
    transport.on("commands.execute", (data) => {
      this.commands.get((data as { id: string }).id)?.();
    });
  }
  can(capability: string) {
    return this.manifest.capabilities.includes(capability);
  }
  /** Lazily created singletons shared by every scope of this plugin. */
  service<T>(name: string, create: () => T): T {
    if (!this.services.has(name)) this.services.set(name, create());
    return this.services.get(name) as T;
  }
  /**
   * Registrations started while `activate` runs must succeed before the
   * plugin reports ready; later ones report failures to their scope.
   */
  starting<T>(work: Promise<T>, report: (error: unknown) => void): Promise<T> {
    if (this.#activating) this.startup.add(work);
    else work.catch(report);
    work.catch(() => {});
    return work;
  }
  async activated() {
    while (this.startup.size) {
      const pending = [...this.startup];
      this.startup.clear();
      for (const result of await Promise.allSettled(pending))
        if (result.status === "rejected") throw result.reason;
    }
    this.#activating = false;
  }
  bind(evaluate: () => void): Disposable {
    this.#bindings.add(evaluate);
    this.invalidate();
    return {
      dispose: async () => {
        this.#bindings.delete(evaluate);
      },
    };
  }
  /** Coalesce: one evaluation pass per microtask turn, however many changes. */
  invalidate() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      for (const evaluate of this.#bindings) {
        try {
          evaluate();
        } catch (error) {
          console.error(`[${this.manifest.id}] binding failed:`, error);
        }
      }
    });
  }
  /**
   * Host events with one `events.subscribe` per name, however many listeners.
   * Without the `events` capability the listener simply never fires.
   */
  on(event: string, listener: Listener): Disposable {
    let entry = this.#events.get(event);
    if (!entry) {
      entry = { listeners: new Set() };
      this.#events.set(event, entry);
      if (this.can("events")) {
        const group = entry;
        entry.off = this.host.events.subscribe(event as never, (data) => {
          for (const each of [...group.listeners]) each(data);
        });
        this.starting(entry.off, (error) =>
          console.error(`[${this.manifest.id}] subscribe ${event}:`, error),
        );
      }
    }
    entry.listeners.add(listener);
    const group = entry;
    return {
      dispose: async () => {
        group.listeners.delete(listener);
        if (group.listeners.size || this.#events.get(event) !== group) return;
        this.#events.delete(event);
        const off = await group.off?.catch(() => undefined);
        await off?.().catch(() => {});
      },
    };
  }
  /** Raw transport events the host pushes without a subscription. */
  raw(event: string, listener: Listener): Disposable {
    const off = this.#transport.on(event, listener);
    return { dispose: async () => off() };
  }
}
