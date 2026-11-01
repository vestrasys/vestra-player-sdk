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

/**
 * The fields of the SDK's state copies that a binding or listener read, by
 * state (`player`: `plugin.player.state`). An empty set: the state was
 * taken whole (no field read was seen), so any change of it counts.
 */
export type Deps = Map<string, Set<string>>;
/** A change of the SDK's state copies: the fields that changed, by state. */
export type Change = ReadonlyMap<string, ReadonlySet<string>>;

/** Whether something that read `deps` may see a different result after `change`. */
function affected(deps: Deps, change: Change) {
  for (const [key, fields] of change) {
    const read = deps.get(key);
    if (!read) continue;
    if (read.size === 0) return true;
    for (const field of fields) if (read.has(field)) return true;
  }
  return false;
}

/** Add `from` to `into` (an empty set, the whole state, wins). */
function merge(into: Deps, from: Deps) {
  for (const [key, fields] of from) {
    const set = into.get(key);
    if (!set) into.set(key, new Set(fields));
    else if (set.size && fields.size)
      for (const field of fields) set.add(field);
    else set.clear();
  }
}

/**
 * The longest a binding waits for a full pass while precise passes skip
 * it: state a plugin changes outside code the SDK runs (its own timer,
 * without `update()`) still shows within about this long.
 */
export const SAFETY_PASS_MS = 1000;

/**
 * The player's answers to a declaration that refuse that one declaration
 * (a command's path, texts or count): during activation they skip it
 * instead of failing the plugin (`Runtime.declaring`, SDK 1.5.49).
 */
const DECLARATION_REFUSALS: ReadonlySet<string> = new Set([
  "invalid",
  "conflict",
  "limit",
]);

/** How the plugin is run: the player's runner, or `TestHost`. */
export interface RuntimeOptions {
  /**
   * A declaration the player refuses during activation fails activation
   * (`startPlugin`, so a plugin's tests show it) instead of being logged,
   * reported to `onError` and skipped (the player's runner).
   */
  strictDeclarations?: boolean;
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
  /** `RuntimeOptions.strictDeclarations`. */
  readonly #strict: boolean;
  /** Declarations skipped during activation: reported once it completes. */
  readonly #refusals: (() => void)[] = [];
  readonly #transport: Transport;
  /** Each binding with the events whose state it read last time (held). */
  readonly #bindings = new Map<() => void, Binding>();
  /** The events read by the binding being evaluated, with who read them. */
  #reads: Map<string, Why> | undefined;
  /** Who reads now (a command's field and where it was added). */
  #reader: Reader | undefined;
  #scheduled = false;
  /** The next pass evaluates every binding (not only a state copy changed). */
  #full = false;
  /** State copy changes since the last pass (a precise pass, unless `#full`). */
  #pending = new Map<string, Set<string>>();
  /** The change the running precise pass is for; `undefined` in a full pass. */
  #pass: Change | undefined;
  /** The state copy fields read by what is being evaluated now. */
  #deps: Deps | undefined;
  /** Each part's reads and fields last time (`part`). */
  readonly #parts = new WeakMap<
    object,
    { reads: Map<string, Why>; deps: Deps }
  >();
  /** A precise pass skipped something: a full pass follows (`SAFETY_PASS_MS`). */
  #safety: ReturnType<typeof setTimeout> | undefined;
  /** The running pass skipped a binding or a part. */
  #skipped = false;
  /** The plugin was disposed: no safety pass is armed any more. */
  #stopped = false;
  readonly #events = new Map<string, EventGroup>();
  readonly views = new Map<string, (callback: string, args: Json[]) => void>();
  readonly commands = new Map<string, () => void>();
  readonly services = new Map<string, unknown>();
  /** `plugin.app`, from the start-up handshake; `system()` asks the player. */
  readonly app: App;
  /** `plugin.i18n.locale`, from the start-up handshake; English when unknown. */
  readonly locale: Locale;
  /**
   * Protocol additions the player advertises at start-up (`features` in the
   * handshake's app data, player 0.6.0): `ui.patch` (row patches of
   * property writes). Not part of the plugin API; empty for older players.
   */
  readonly features: ReadonlySet<string>;
  constructor(
    transport: Transport,
    manifest: PluginManifest,
    directory: string,
    dataDirectory?: string,
    app?: unknown,
    options: RuntimeOptions = {},
  ) {
    this.#transport = transport;
    this.#strict = options.strictDeclarations ?? false;
    this.dataDirectory = dataDirectory;
    this.local = transport.local;
    this.host = createWire(transport);
    const host = this.host;
    this.app = appInfo(app, () => host.app.system() as Promise<SystemInfo>);
    const features = (app as { features?: unknown } | null | undefined)
      ?.features;
    this.features = new Set(
      Array.isArray(features)
        ? features.filter((name): name is string => typeof name === "string")
        : [],
    );
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
  /**
   * A declaration the player checks on its own (`what`: "command x"),
   * started like `starting`. In the player's runner a refusal of it during
   * activation (`invalid`, `conflict`, `limit`) does not fail the plugin:
   * it is logged, skipped and reported to the scope once activation
   * completes, so an `onError` added anywhere in `activate` hears it (SDK
   * 1.5.49; VS Code logs a bad contribution and activates the extension).
   * Under `strictDeclarations` (TestHost) it fails activation as before.
   */
  declaring<T>(
    work: Promise<T>,
    what: string,
    report: (error: unknown) => void,
  ): Promise<T> {
    if (!this.#activating || this.#strict) return this.starting(work, report);
    const settled = work.then(
      () => {},
      (error: unknown) => {
        if (
          !(error instanceof HostError) ||
          !DECLARATION_REFUSALS.has(error.code)
        )
          throw error;
        console.error(
          `[${this.manifest.id}] ${what} skipped, the player refused it (${error.code}): ${error.message}`,
        );
        this.#refusals.push(() => report(error));
      },
    );
    // Observed now: `activated()` may come after `activate` awaits, and
    // its `allSettled` still sees the rejection.
    settled.catch(() => {});
    this.startup.add(settled);
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
    for (const report of this.#refusals.splice(0)) report();
  }
  bind(evaluate: () => void): Disposable {
    const held = new Map<string, Disposable>();
    const binding: Binding = { held, deps: new Map() };
    this.#bindings.set(evaluate, binding);
    this.invalidate();
    return {
      dispose: async () => {
        if (this.#bindings.get(evaluate) !== binding) return;
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
   * A field of the SDK's copy of a state (`key`) is read; without `field`,
   * the state is taken (`plugin.player.state`). What is being evaluated
   * then depends on it: a precise pass after a change of that field runs
   * it again.
   */
  depends(key: string, field?: string) {
    const deps = this.#deps;
    if (!deps) return;
    let fields = deps.get(key);
    if (!fields) deps.set(key, (fields = new Set()));
    if (field !== undefined) fields.add(field);
  }
  /**
   * Evaluate one part of the binding being evaluated (one `view.bind`
   * function), identified by `token`. A precise pass skips it when nothing
   * it read last time changed, and returns `undefined`; what it read then
   * still counts for the binding.
   */
  part<T>(token: object, read: () => T): { value: T } | undefined {
    const last = this.#parts.get(token);
    const outerReads = this.#reads;
    const outerDeps = this.#deps;
    if (last && this.#pass && !affected(last.deps, this.#pass)) {
      this.#skipped = true;
      if (outerReads)
        for (const [event, why] of last.reads)
          if (!outerReads.has(event)) outerReads.set(event, why);
      if (outerDeps) merge(outerDeps, last.deps);
      return undefined;
    }
    const reads = new Map<string, Why>();
    const deps: Deps = new Map();
    this.#reads = outerReads && reads;
    this.#deps = deps;
    try {
      return { value: read() };
    } finally {
      this.#reads = outerReads;
      this.#deps = outerDeps;
      this.#parts.set(token, { reads, deps });
      if (outerReads)
        for (const [event, why] of reads)
          if (!outerReads.has(event)) outerReads.set(event, why);
      if (outerDeps) merge(outerDeps, deps);
    }
  }
  /**
   * Run plugin code (a state listener) and return the state copy fields it
   * read; they are not counted as a binding's.
   */
  observe<T>(run: () => T): { value: T; deps: Deps } {
    const outerReads = this.#reads;
    const outerDeps = this.#deps;
    const deps: Deps = new Map();
    this.#reads = undefined;
    this.#deps = deps;
    try {
      return { value: run(), deps };
    } finally {
      this.#reads = outerReads;
      this.#deps = outerDeps;
    }
  }
  /**
   * Whether code that read `deps` while `change` was delivered needs a full
   * pass after it: it read a field that changed, or no field of that state
   * at all (so the SDK cannot tell what it depends on).
   */
  needsFull(deps: Deps, change: Change) {
    for (const key of change.keys()) {
      const read = deps.get(key);
      if (!read || read.size === 0) return true;
    }
    return affected(deps, change);
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
  #evaluate(evaluate: () => void, binding: Binding) {
    const held = binding.held;
    const reads = new Map<string, Why>();
    const deps: Deps = new Map();
    const outer = this.#reads;
    const outerDeps = this.#deps;
    const reader = this.#reader;
    this.#reads = reads;
    this.#deps = deps;
    this.#reader = undefined;
    try {
      evaluate();
    } finally {
      this.#reads = outer;
      this.#deps = outerDeps;
      this.#reader = reader;
      binding.deps = deps;
      for (const [event, hold] of held)
        if (!reads.has(event)) {
          held.delete(event);
          void hold.dispose();
        }
      for (const [event, why] of reads)
        if (!held.has(event)) held.set(event, this.hold(event, why));
    }
  }
  /**
   * A full pass: every binding is evaluated. Requested after plugin code
   * the SDK ran, by `plugin.update()`, and on any change other than a state
   * copy's fields. Coalesced: one pass per microtask turn, however many
   * requests.
   */
  invalidate() {
    this.#full = true;
    this.#schedule();
  }
  /**
   * Fields of the SDK's copy of a state (`key`) changed: a precise pass
   * evaluates only the bindings (and view bind functions) that read one of
   * them, unless a full pass is due anyway.
   */
  changed(key: string, fields: Iterable<string>) {
    let set = this.#pending.get(key);
    if (!set) this.#pending.set(key, (set = new Set()));
    for (const field of fields) set.add(field);
    this.#schedule();
  }
  #schedule() {
    if (this.#scheduled) return;
    this.#scheduled = true;
    queueMicrotask(() => this.#run());
  }
  /**
   * One pass. A precise pass that skips anything arms a full pass
   * `SAFETY_PASS_MS` later (unless a full pass comes first), for plugin
   * state changed outside code the SDK ran.
   */
  #run() {
    this.#scheduled = false;
    const full = this.#full;
    const change: Change = this.#pending;
    this.#full = false;
    this.#pending = new Map();
    if (full) {
      clearTimeout(this.#safety);
      this.#safety = undefined;
    }
    this.#skipped = false;
    for (const [evaluate, binding] of [...this.#bindings]) {
      if (this.#bindings.get(evaluate) !== binding) continue;
      if (!full && !affected(binding.deps, change)) {
        this.#skipped = true;
        continue;
      }
      this.#pass = full ? undefined : change;
      try {
        this.#evaluate(evaluate, binding);
      } catch (error) {
        console.error(`[${this.manifest.id}] binding failed:`, error);
      } finally {
        this.#pass = undefined;
      }
    }
    if (this.#skipped && !this.#safety && !this.#stopped) {
      this.#safety = setTimeout(() => {
        this.#safety = undefined;
        this.invalidate();
      }, SAFETY_PASS_MS);
      this.#safety.unref?.();
    }
  }
  /** The plugin was disposed: cancel the pending safety pass, arm no more. */
  stop() {
    this.#stopped = true;
    clearTimeout(this.#safety);
    this.#safety = undefined;
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

/** One `Runtime.bind` registration. */
interface Binding {
  /** The events whose state it read last time, held. */
  held: Map<string, Disposable>;
  /** The state copy fields it read last time. */
  deps: Deps;
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
