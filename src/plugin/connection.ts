/**
 * The plugin's connection to the player (L1, refactor plan §2.2): the
 * transport and its typed client (`host`), event subscriptions counted per
 * name with their `why`/`mirror` marks (`on`, `hold`, `raw`), the
 * activation state machine (`starting`, `declaring`, `activated`) and what
 * the start-up handshake said (`app`, `locale`, `features`). It knows
 * nothing of update passes (`passes.ts`); `Runtime` (`runtime.ts`) adds them.
 */
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
  StopReason,
  SystemInfo,
} from "./types.ts";
import { LOCALES } from "../i18n.ts";
import { failure } from "./errors.ts";
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
  // Player 0.7.6: sent to a plugin whose own keys changed and, from SDK
  // 1.6.16, to every listener when a player command (`host/<id>`) is
  // rebound, which wakes each parked listener.
  "commands.keys",
  "appearance.changed",
  "resolvers.fileTypes",
];

export interface PluginManifest {
  id: string;
  capabilities: string[];
}

/**
 * The player's answers to a declaration that refuse that one declaration
 * (a command's path, texts or count): during activation they skip it
 * instead of failing the plugin (`Connection.declaring`, SDK 1.5.49).
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

/** The reasons `StopReason` names; anything else reads as `undefined`. */
const STOP_REASONS: ReadonlySet<string> = new Set<StopReason>([
  "quit",
  "disable",
  "uninstall",
  "reload",
  "upgrade",
  "idle",
  "failed",
  "host-lost",
]);

/** A stop reason the runner passed on, if this SDK knows it. */
export function stopReason(value: unknown): StopReason | undefined {
  return typeof value === "string" && STOP_REASONS.has(value)
    ? (value as StopReason)
    : undefined;
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
  /** It needs `events`, which the manifest does not declare: nothing arrives. */
  unheard?: boolean;
}

/**
 * Per-plugin connection to the player. Scopes reach it through `Runtime`;
 * the flat RPC clients stay private here so protocol fields never reach
 * plugin code.
 */
export class Connection {
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
  readonly #events = new Map<string, EventGroup>();
  /** The missing `events` warning was given (once per plugin). */
  #warnedEvents = false;
  readonly views = new Map<string, (callback: string, args: Json[]) => void>();
  readonly commands = new Map<string, () => void>();
  readonly services = new Map<string, unknown>();
  /**
   * Set when the player stops the plugin (`PluginInstance.dispose`), before
   * the root scope is disposed: `DisposeInfo` and `plugin.stopReason`.
   */
  stopping: { reason: StopReason | undefined } | undefined;
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
      const event = data as UiCallback & { slot?: string };
      // A panel's callback names its slot (player 0.7.6: one panel per
      // slot); older players name only `"$mount"`, and the plugin has one.
      const view =
        event.view === "$mount"
          ? event.slot
            ? `panel:${event.slot}`
            : [...this.views.keys()].find((key) => key.startsWith("panel:"))
          : event.view;
      if (view) this.views.get(view)?.(event.callback, event.args);
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
    if (created && needs === "events" && !this.can(needs)) group.unheard = true;
    if (!mirror && group.unheard) this.#warnUnheard(event);
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
    if (group.unheard) this.#warnUnheard(event);
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
   * A development warning, once per plugin, no behaviour change (SDK
   * 1.6.12): the plugin follows `event` (an `onChange`, a `bind` that reads
   * the state) without the `events` capability, so changes made elsewhere
   * (the user, the player, another plugin) never reach it; the state moves
   * only after its own calls.
   */
  #warnUnheard(event: string) {
    if (this.#warnedEvents) return;
    this.#warnedEvents = true;
    console.warn(
      `[${this.manifest.id}] follows ${event} (onChange, or a bind() that reads the state) without the "events" capability: changes made elsewhere will not reach it, only its own calls refresh the state. Declare "events" in manifest.json.`,
    );
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
