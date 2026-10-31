/** Shared machinery behind every scope: invocation, update passes, events. */
import { createWire, HostError } from "../wire.ts";
import type {
  Json,
  LocalServices,
  Transport,
  UiCallback,
  Wire,
} from "../wire.ts";
import type {
  App,
  Disposable,
  Locale,
  PluginError,
  SystemInfo,
} from "./types.ts";
import { LOCALES } from "../i18n.ts";
import { basename, isAbsolute, relative } from "node:path";
import { fileURLToPath } from "node:url";

/** The SDK's own files (`src/` or `dist/`): left out of a call site. */
const SDK_DIRECTORY = fileURLToPath(new URL("..", import.meta.url));

/**
 * Why something listens, for the player's log line that says why a plugin
 * keeps running (`events.subscribe { why }`, player 0.5.21): computed
 * only when the player is told.
 */
export type Why = () => string;

/**
 * Events the player wakes a stopped plugin for (player 0.5.21): a listener
 * of one does not keep the plugin running. They follow deliberate changes
 * (an install, a key edit, the palette, a resolver), not playback.
 */
export const WAKE_EVENTS: readonly string[] = [
  "packages.changed",
  "bindings.changed",
  "appearance.changed",
  "resolvers.fileTypes",
];

/**
 * The state each event keeps current, and whether `plugin.when` can say
 * the same without the plugin running.
 */
const STATE: Record<string, { name: string; when: boolean }> = {
  "source.state": { name: "plugin.player.state", when: true },
  "window.state": { name: "plugin.window.state", when: true },
  "appearance.changed": { name: "plugin.appearance", when: true },
  "timeline.changed": { name: "plugin.timeline.marks", when: false },
  "playback.backend": { name: "plugin.subtitles.state", when: false },
  "resolvers.fileTypes": {
    name: "plugin.resolvers.fileTypes",
    when: false,
  },
};

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
 * One host event's listeners. `active` counts the plugin's own listeners
 * and holds (an `onChange`, a binding that read the state); the SDK's own
 * state mirrors do not count. The player is told whether anything but a
 * mirror listens (`events.subscribe { mirror }`, player 0.5.18): a plugin
 * whose subscriptions are all mirrors holds no listener and may be stopped
 * while idle; its state is read again when it starts.
 */
interface EventGroup {
  listeners: Set<Listener>;
  active: number;
  /** Why each active holder listens, in the order they came. */
  whys: Map<object, Why>;
  /** The reasons the player was last told, joined (to compare). */
  toldWhy?: string;
  off?: Promise<() => Promise<void>>;
  /** What the player was last told: `true` for a real listener. */
  told?: boolean;
}

/**
 * Per-plugin services. Scopes are thin views over this object; the flat RPC
 * clients stay private here so protocol fields never reach plugin code.
 */
export class Runtime {
  readonly host: Wire;
  readonly manifest: PluginManifest;
  readonly directory: string;
  /** Writable per-plugin data directory from the host, if it provided one. */
  readonly dataDirectory: string | undefined;
  /** Test doubles for local processes; the real system when absent. */
  readonly local: LocalServices | undefined;
  /** Registrations that activation must wait for before reporting ready. */
  readonly startup = new Set<Promise<unknown>>();
  #activating = true;
  readonly #transport: Transport;
  /** Each binding with the events whose state it read last time (held). */
  readonly #bindings = new Map<() => void, Map<string, Disposable>>();
  /** The events read by the binding being evaluated, with who read them. */
  #reads: Map<string, Why> | undefined;
  /** Who reads now (a command's field and where it was added). */
  #reader: Reader | undefined;
  #scheduled = false;
  readonly #events = new Map<string, EventGroup>();
  readonly views = new Map<string, (callback: string, args: Json[]) => void>();
  readonly commands = new Map<string, () => void>();
  readonly services = new Map<string, unknown>();
  /** `plugin.app`, from the start-up handshake; `system()` asks the player. */
  readonly app: App;
  /** `plugin.i18n.locale`, from the start-up handshake; English when unknown. */
  readonly locale: Locale;
  constructor(
    transport: Transport,
    manifest: PluginManifest,
    directory: string,
    dataDirectory?: string,
    app?: unknown,
  ) {
    this.#transport = transport;
    this.dataDirectory = dataDirectory;
    this.local = transport.local;
    this.host = createWire(transport);
    const host = this.host;
    this.app = appInfo(app, () => host.app.system() as Promise<SystemInfo>);
    this.locale = (LOCALES as readonly string[]).includes(
      transport.locale ?? "",
    )
      ? (transport.locale as Locale)
      : "en";
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
    const held = new Map<string, Disposable>();
    this.#bindings.set(evaluate, held);
    this.invalidate();
    return {
      dispose: async () => {
        if (this.#bindings.get(evaluate) !== held) return;
        this.#bindings.delete(evaluate);
        for (const hold of held.values()) await hold.dispose();
        held.clear();
      },
    };
  }
  /**
   * A service's state for `event` is read: a binding evaluated now depends
   * on it, so the event counts as listened to while the binding reads it.
   */
  reading(event: string) {
    const reads = this.#reads;
    if (!reads || reads.has(event)) return;
    const reader = this.#reader;
    const state = STATE[event];
    reads.set(event, () => {
      const read = state?.name ?? event;
      const site = reader?.where?.();
      const at = site ? ` (${site})` : "";
      if (!reader) return `a binding reads ${read}`;
      if (!reader.field) return `${reader.label} reads ${read}${at}`;
      const hint = state?.when ? " — use plugin.when" : "";
      return `${reader.label} is a function that reads ${read}${at}${hint}`;
    });
  }
  /**
   * Evaluate `read` as `label`, added at `where`: the state it reads is
   * reported as read by it. `field`: a command's `enabled` or `checked`,
   * which a `plugin.when` condition can replace.
   */
  reader<T>(
    label: string,
    where: (() => string | undefined) | undefined,
    read: () => T,
    field = false,
  ): T {
    const outer = this.#reader;
    this.#reader = { label, where, field };
    try {
      return read();
    } finally {
      this.#reader = outer;
    }
  }
  /**
   * Where the plugin's code called into the SDK: the first stack frame
   * outside the SDK, as a path relative to the plugin's directory and a
   * line (`main.ts:353`). Captured now, formatted when asked.
   */
  callSite(): () => string | undefined {
    const limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 40;
    const error = new Error();
    Error.stackTraceLimit = limit;
    let site: string | undefined | null = null;
    return () => {
      if (site === null) site = this.#site(error.stack ?? "");
      return site;
    };
  }
  #site(stack: string): string | undefined {
    for (const line of stack.split("\n").slice(1)) {
      const match = /\(?((?:file:\/\/)?[^()\s]+?):(\d+):\d+\)?\s*$/.exec(line);
      if (!match) continue;
      let file = match[1]!;
      if (file.startsWith("file:"))
        try {
          file = fileURLToPath(file);
        } catch {
          continue;
        }
      const sdk = relative(SDK_DIRECTORY, file);
      if (!isAbsolute(file) || !(sdk.startsWith("..") || isAbsolute(sdk)))
        continue;
      const inside = relative(this.directory, file);
      const shown =
        inside.startsWith("..") || isAbsolute(inside) ? basename(file) : inside;
      return `${shown.replaceAll("\\", "/")}:${match[2]}`;
    }
    return undefined;
  }
  /** Evaluate one binding, holding the events whose state it read. */
  #evaluate(evaluate: () => void, held: Map<string, Disposable>) {
    const reads = new Map<string, Why>();
    const outer = this.#reads;
    const reader = this.#reader;
    this.#reads = reads;
    this.#reader = undefined;
    try {
      evaluate();
    } finally {
      this.#reads = outer;
      this.#reader = reader;
      for (const [event, hold] of held)
        if (!reads.has(event)) {
          held.delete(event);
          void hold.dispose();
        }
      for (const [event, why] of reads)
        if (!held.has(event)) held.set(event, this.hold(event, why));
    }
  }
  /** Coalesce: one evaluation pass per microtask turn, however many changes. */
  invalidate() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => {
      this.#scheduled = false;
      for (const [evaluate, held] of [...this.#bindings]) {
        if (this.#bindings.get(evaluate) !== held) continue;
        try {
          this.#evaluate(evaluate, held);
        } catch (error) {
          console.error(`[${this.manifest.id}] binding failed:`, error);
        }
      }
    });
  }
  /**
   * Host events with one `events.subscribe` per name, however many listeners.
   * Without the `events` capability the listener simply never fires.
   * `mirror`: the SDK's own copy of the state (`plugin.player.state` and
   * the like), not a listener of the plugin's (see {@link EventGroup}).
   */
  on(
    event: string,
    listener: Listener,
    /** The capability the event needs; `null`: none. */
    needs: string | null = "events",
    mirror = false,
  ): Disposable {
    let entry = this.#events.get(event);
    const created = !entry;
    if (!entry) {
      entry = { listeners: new Set(), active: 0, whys: new Map() };
      this.#events.set(event, entry);
    }
    const group = entry;
    group.listeners.add(listener);
    const token = {};
    if (!mirror) {
      group.active++;
      group.whys.set(token, listenerWhy(this.callSite()));
    }
    if (created && (needs === null || this.can(needs))) {
      group.told = group.active > 0;
      const whys = group.told ? allWhys(group) : undefined;
      group.toldWhy = whys?.join("\n");
      group.off = this.host.events.subscribe(
        event as never,
        (data) => {
          for (const each of [...group.listeners]) each(data);
        },
        !group.told,
        whys,
      );
      this.starting(group.off, (error) =>
        console.error(`[${this.manifest.id}] subscribe ${event}:`, error),
      );
    } else this.#tell(event, group);
    let listening = true;
    return {
      dispose: async () => {
        if (!listening) return;
        listening = false;
        group.listeners.delete(listener);
        if (!mirror) group.active--;
        group.whys.delete(token);
        if (this.#events.get(event) !== group) return;
        if (group.listeners.size) return this.#tell(event, group);
        this.#events.delete(event);
        const off = await group.off?.catch(() => undefined);
        await off?.().catch(() => {});
      },
    };
  }
  /**
   * Count `event` as listened to while held: a watcher of a service's
   * state, a binding that reads it. Nothing when nothing subscribed to it
   * (no capability, or the service did not start).
   */
  hold(event: string, why?: Why): Disposable {
    const group = this.#events.get(event);
    if (!group) return { dispose: async () => {} };
    group.active++;
    const token = {};
    group.whys.set(token, why ?? listenerWhy(this.callSite()));
    this.#tell(event, group);
    let held = true;
    return {
      dispose: async () => {
        if (!held) return;
        held = false;
        group.active--;
        group.whys.delete(token);
        if (this.#events.get(event) === group) this.#tell(event, group);
      },
    };
  }
  /**
   * Tell the player when `group` changes between mirror and listener, and
   * why it listens when that changed.
   */
  #tell(event: string, group: EventGroup) {
    const off = group.off;
    if (!off) return;
    const active = group.active > 0;
    const whys = active ? allWhys(group) : undefined;
    const why = whys?.join("\n");
    if (group.told === active && group.toldWhy === why) return;
    group.told = active;
    group.toldWhy = why;
    // Part of activation while it runs: the player classifies the plugin
    // at its ready, which must see this mark. A failure is not one of
    // activation (an older player never refuses it).
    const told = off
      .then(() => this.host.events.listen(event as never, active, whys))
      .catch(() => {});
    this.starting(told, () => {});
  }
  /**
   * Why the plugin listens to each event it really listens to (mirrors
   * left out), as the player's log says it: for {@link TestHost} and
   * `vestra-plugin test`.
   */
  listening(): Map<string, string[]> {
    const result = new Map<string, string[]>();
    for (const [event, group] of this.#events)
      if (group.active > 0) result.set(event, allWhys(group));
    return result;
  }
  /** Raw transport events the host pushes without a subscription. */
  raw(event: string, listener: Listener): Disposable {
    const off = this.#transport.on(event, listener);
    return { dispose: async () => off() };
  }
}

/** Who reads a service's state in a binding (`Runtime.reader`). */
interface Reader {
  label: string;
  where: (() => string | undefined) | undefined;
  field: boolean;
}

/** A plugin listener's reason: where it was added. */
const listenerWhy =
  (site: () => string | undefined): Why =>
  () => {
    const at = site();
    return at ? `a listener added at ${at}` : "a listener";
  };

/** Every active holder's reason in `group`, in the order they came, once each. */
function allWhys(group: EventGroup): string[] {
  return [...new Set([...group.whys.values()].map((why) => why()))];
}

/** `plugin.app` from the start-up handshake (the runner's environment). */
export function appInfo(
  raw: unknown,
  system: () => Promise<SystemInfo> = () =>
    Promise.reject(failure("unavailable", "no player to ask")),
): App {
  const info = (raw ?? {}) as Partial<App>;
  const parts = (info.components ?? {}) as Partial<App["components"]>;
  const text = (value: unknown) => (typeof value === "string" ? value : null);
  const libav: Record<string, string> = {};
  for (const [name, version] of Object.entries(parts.libav ?? {}))
    if (typeof version === "string") libav[name] = version;
  const app = {
    version: text(info.version) ?? "0.0.0",
    build: text(info.build),
    components: Object.freeze({
      mpv: text(parts.mpv),
      libav: Object.freeze(libav),
      slint: text(parts.slint) ?? "",
    }),
  };
  // A method, not data: kept out of comparisons and JSON of the facts.
  Object.defineProperty(app, "system", { value: system, enumerable: false });
  return Object.freeze(app) as App;
}
