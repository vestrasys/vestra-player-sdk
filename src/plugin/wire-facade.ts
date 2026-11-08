/**
 * `plugin.wire` (SDK 1.7.0; doc/specs/sdk-refactor.md §3.3 and §4 Step 3
 * in the player repository): the protocol (L0) and the primitives (L1)
 * behind one experimental member, for the plugin's own direct messages.
 * Not to be confused with `src/wire.ts` (later `src/wire/`), the L0 code
 * itself: this file hands out access to it, and is the only file under
 * `src/plugin/` that sends a request by a method name it was given
 * (`scripts/check-layers.mjs`, rule 7).
 *
 * - `request`: `Connection.request`, the transport as is; the player
 *   checks capabilities. Two methods are guarded, refused with `invalid`:
 *   `events.subscribe` without `why` or `mirror` would make the player
 *   misjudge whether the plugin listens (lazy activation), and
 *   `events.unsubscribe` would end the SDK's own subscription to the
 *   event. A marked `events.subscribe` goes as given; the SDK does not
 *   count it (its own subscriptions and marks know nothing of it).
 * - `on`: a {@link HostEvent} through `Connection.on`, always a listener
 *   with its `why`, never a mirror (as `player.on`); any other name through
 *   `Connection.raw`, no subscription.
 * - `view(v)`: the view writer's direct track (`view/writer.ts`), reached
 *   through the `DIRECT` key so that no view class (and with it the binder)
 *   is loaded here.
 * - `commands.register`: one `commands.register` with the plugin's own
 *   declaration, waited for during activation as a declaration
 *   (`Connection.declaring`, so `strictDeclarations` applies), then
 *   `commands.update` with the next revision on each `update`.
 */
import { failure, quiet } from "./errors.ts";
import { Latest } from "./latest.ts";
import { EVENT_NEEDS } from "./player/events.ts";
import { DIRECT } from "./view/writer.ts";
import type { DirectWrites } from "./view/writer.ts";
import type { CommandDeclaration, CommandState } from "../commands.ts";
import type { Json } from "../wire.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  Disposable,
  HostEvent,
  View,
  Wire,
  WireCommand,
  WireCommandOptions,
  WireCommandState,
  WireView,
} from "./types.ts";

/**
 * `events.subscribe` parameters that say why the plugin listens: a list of
 * reasons (`why`, a listener) or `mirror: true` (only a copy of the state).
 */
function marked(params: Json | undefined): boolean {
  if (params === null || typeof params !== "object" || Array.isArray(params))
    return false;
  if (params.mirror === true) return true;
  const why = params.why;
  return (
    Array.isArray(why) &&
    why.length > 0 &&
    why.every((line) => typeof line === "string")
  );
}

/** Unregistrations in flight per plugin: re-registering an id waits for its removal. */
const removals = new WeakMap<object, Map<string, Promise<void>>>();

class RawCommand implements WireCommand {
  readonly id: string;
  readonly ready: Promise<void>;
  readonly #scope: ScopeImpl;
  #state: CommandState;
  #revision = 1;
  #registered = false;
  #disposed = false;
  readonly #run: () => void;
  readonly #updates: Latest<{ state: CommandState; when?: Json }>;
  constructor(scope: ScopeImpl, options: WireCommandOptions) {
    const runtime = scope.runtime;
    const { id, declaration, state, when, run } = (options ??
      {}) as Partial<WireCommandOptions>;
    if (typeof id !== "string" || id === "")
      throw failure("invalid", "register takes an id: a non-empty string");
    if (
      declaration === null ||
      typeof declaration !== "object" ||
      Array.isArray(declaration)
    )
      throw failure(
        "invalid",
        `command ${id}: declaration is an object, as commands.register takes it`,
      );
    if (run !== undefined && typeof run !== "function")
      throw failure("invalid", `command ${id}: run is a function`);
    if (runtime.commands.has(id))
      throw failure("conflict", `command ${id} is already declared`);
    this.id = id;
    this.#scope = scope;
    const initial: CommandState = {
      enabled: true,
      checked: null,
      busy: false,
      reason: null,
      ...(state as Partial<CommandState> | undefined),
    };
    this.#state = initial;
    let pending = removals.get(runtime);
    if (!pending) removals.set(runtime, (pending = new Map()));
    const previous = pending.get(id);
    const registration = (async () => {
      await previous;
      await runtime.host.commands.register(
        id,
        1,
        declaration as unknown as CommandDeclaration,
        initial,
        when === undefined ? undefined : (when as never),
      );
      this.#registered = true;
    })();
    this.ready = quiet(
      runtime
        .declaring(registration, `command ${id}`, (error) =>
          scope.report(error),
        )
        .then(() => {}),
    );
    this.#updates = new Latest(async ({ state: next, when: conditions }) => {
      await this.ready.catch(() => {
        throw failure("missing", `command ${id} is not registered`);
      });
      await runtime.host.commands.update(
        id,
        ++this.#revision,
        next,
        conditions === undefined ? undefined : (conditions as never),
      );
    });
    this.#run = () => {
      if (!this.#disposed && run) scope.run(run);
    };
    runtime.commands.set(id, this.#run);
    scope.add(this);
  }
  async update(state: WireCommandState, when?: Json): Promise<void> {
    if (state === null || typeof state !== "object")
      throw failure("invalid", `command ${this.id}: update takes a state`);
    if (this.#disposed)
      throw failure("missing", `command ${this.id} was disposed`);
    this.#state = { ...this.#state, ...(state as Partial<CommandState>) };
    await this.#updates.push(
      when === undefined
        ? { state: this.#state }
        : { state: this.#state, when },
    );
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    const runtime = this.#scope.runtime;
    if (runtime.commands.get(this.id) === this.#run)
      runtime.commands.delete(this.id);
    this.#updates.stop();
    const pending = removals.get(runtime)!;
    const removal = (async () => {
      await this.ready.catch(() => {});
      if (this.#registered)
        await runtime.host.commands.unregister(this.id).catch(() => {});
    })();
    pending.set(this.id, removal);
    await removal;
    if (pending.get(this.id) === removal) pending.delete(this.id);
  }
}

/** `plugin.wire` for one scope. */
export const wire = (scope: ScopeImpl): Wire => ({
  request<T = unknown>(method: string, params?: Json): Promise<T> {
    if (typeof method !== "string" || method === "")
      throw failure("invalid", "request takes a method name");
    if (method === "events.subscribe" && !marked(params))
      throw failure(
        "invalid",
        "events.subscribe needs why (a list of reasons) or mirror: true, or the player misjudges whether the plugin listens; use plugin.wire.on, which sends why",
      );
    // The player keeps one subscription per event name: a raw unsubscribe
    // would end the SDK's own (state copies, `player.on`, `wire.on`).
    if (method === "events.unsubscribe")
      throw failure(
        "invalid",
        "events.unsubscribe would end the SDK's own subscription to the event too; use the Disposable from plugin.wire.on",
      );
    return scope.runtime.request<T>(method, params);
  },
  on(event: HostEvent | (string & {}), listener: (data: unknown) => void) {
    if (typeof event !== "string" || event === "")
      throw failure("invalid", "on takes an event name and a listener");
    if (typeof listener !== "function")
      throw failure("invalid", "on takes an event name and a listener");
    // A copy: the same data also feeds the SDK's own state copies. No full
    // pass after it (`runQuiet`), as for `player.on`.
    const deliver = (data: unknown) =>
      scope.runQuiet(listener, structuredClone(data));
    const watch: Disposable = Object.hasOwn(EVENT_NEEDS, event)
      ? scope.runtime.on(event, deliver, EVENT_NEEDS[event as HostEvent])
      : scope.runtime.raw(event, deliver);
    const handle: Disposable = {
      dispose: async () => {
        scope.forget(handle);
        await watch.dispose();
      },
    };
    return scope.add(handle);
  },
  view(view: View): WireView {
    const direct =
      view !== null && typeof view === "object"
        ? (view as { [DIRECT]?: (scope: ScopeImpl) => DirectWrites })[DIRECT]
        : undefined;
    if (typeof direct !== "function")
      throw failure(
        "invalid",
        "view takes a window, panel or settings page of this plugin",
      );
    return direct.call(view, scope);
  },
  commands: {
    register: (options) => new RawCommand(scope, options),
  },
});
