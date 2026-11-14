/**
 * `plugin.trigger(name?)` (1.10.0, events-and-triggers.md §3.1, §4.1):
 * triggers declared in the synchronous part of `activate()`, their
 * conditions handed to the player (`triggers.set`, `triggers.off`), and the
 * player's `triggers.fired` notifications routed to their `enter` and
 * `leave`.
 *
 * Identity: an unnamed trigger is its place among the unnamed ones (the
 * order `activate()` declares them in), a named one its name. At the end of
 * the synchronous part the player is told which names and how many unnamed
 * ones were declared (`triggers.declare`), so it can drop a kept condition
 * nobody declares any more (T14).
 *
 * Sequence numbers (T6): each `set` and `off` answers one; a notification
 * with an older one than the trigger's newest answer is dropped, and one
 * that arrives while a `set` or `off` is in flight waits for its answer.
 */
import { HostError } from "../wire.ts";
import { failure } from "./errors.ts";
import { playerOf } from "./player.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Condition, Trigger, TriggerEvent } from "./types.ts";
import { conditionJson, positionLists } from "./when.ts";
import type { SourceState } from "../source.ts";

/**
 * The player's limits on triggers (`plugin.trigger`): how many a plugin
 * declares and the player keeps conditions for, and how long a name is.
 * A 65th trigger throws `limit`; the player refuses a 65th kept condition
 * with `limit` too. A position list holds at most `TIMELINE_LIMITS.ranges`
 * ranges.
 *
 * @example Stay within the limit
 * ```ts
 * import { TRIGGER_LIMITS } from "@vestra-player/sdk/testing";
 *
 * const names = ["sleep", "wake"].slice(0, TRIGGER_LIMITS.triggers);
 * ```
 *
 * @since 1.10.0
 *
 * @category Testing
 */
export const TRIGGER_LIMITS = Object.freeze({
  /** Triggers a plugin declares, and conditions the player keeps for it. */
  triggers: 64,
  /** Characters of a trigger's name. */
  nameChars: 64,
});

/** The player's notification (`triggers.fired`), wire form. */
interface Fired {
  trigger: number | string;
  seq: number;
  edge: "enter" | "leave";
  state: SourceState;
  range?: { start: number; end: number | null; index: number };
}

class TriggerImpl implements Trigger {
  readonly id: number | string;
  readonly #registry: TriggerRegistry;
  readonly #scope: ScopeImpl;
  #enter: ((event: TriggerEvent) => unknown) | undefined;
  #leave: ((event: TriggerEvent) => unknown) | undefined;
  /** The newest sequence number the player answered. */
  #known = 0;
  /** `set` and `off` requests without an answer yet. */
  #inFlight = 0;
  /** Notifications that came while one was in flight. */
  #held: Fired[] = [];
  /** The handlers run one after another (T9). */
  #chain: Promise<void> = Promise.resolve();
  constructor(
    registry: TriggerRegistry,
    scope: ScopeImpl,
    id: number | string,
  ) {
    this.#registry = registry;
    this.#scope = scope;
    this.id = id;
  }
  get handled() {
    return this.#enter !== undefined || this.#leave !== undefined;
  }
  firesOn(condition: Condition): Trigger {
    const when = conditionJson(condition);
    if (positionLists(when) > 1)
      throw new TypeError("a condition has at most one position list");
    this.#send(
      this.#registry.runtime.host.triggers.set(this.id, when as never),
    );
    return this;
  }
  enter(fn: (event: TriggerEvent) => unknown): Trigger {
    if (typeof fn !== "function") throw new TypeError("enter takes a function");
    this.#enter = fn;
    return this;
  }
  leave(fn: (event: TriggerEvent) => unknown): Trigger {
    if (typeof fn !== "function") throw new TypeError("leave takes a function");
    this.#leave = fn;
    return this;
  }
  off(): Trigger {
    this.#send(this.#registry.runtime.host.triggers.off(this.id));
    return this;
  }
  #send(request: Promise<{ seq: number }>) {
    this.#inFlight++;
    request.then(
      ({ seq }) => {
        this.#known = Math.max(this.#known, seq);
        this.#settled();
      },
      (error: unknown) => {
        this.#settled();
        if (!(error instanceof HostError && error.code === "disabled"))
          this.#scope.report(error);
      },
    );
  }
  #settled() {
    this.#inFlight--;
    if (this.#inFlight > 0) return;
    for (const fired of this.#held.splice(0)) this.fired(fired);
  }
  /** A notification for this trigger. */
  fired(fired: Fired) {
    if (this.#inFlight > 0) {
      this.#held.push(fired);
      return;
    }
    if (fired.seq < this.#known) return;
    if (!this.handled) {
      this.#registry.unhandled(fired.trigger);
      return;
    }
    const fn = fired.edge === "enter" ? this.#enter : this.#leave;
    if (!fn) return;
    const state = playerOf(this.#registry.runtime).sourceEvent(
      "triggers.fired",
      { state: fired.state },
    ) as { state: TriggerEvent["state"] };
    const event: TriggerEvent = Object.freeze(
      fired.range
        ? { state: state.state, range: Object.freeze({ ...fired.range }) }
        : { state: state.state },
    );
    const scope = this.#scope;
    this.#chain = this.#chain.then(async () => {
      if (scope.disposed) return;
      try {
        await fn(event);
      } catch (error) {
        scope.report(error);
      } finally {
        scope.update();
      }
    });
  }
}

/** One plugin's triggers (a runtime service). */
export class TriggerRegistry {
  readonly runtime: Runtime;
  /** `activate()`'s synchronous part runs (`PluginInstance.activate`). */
  #declaring = false;
  /** That part is over: notifications go to their triggers. */
  #declared = false;
  readonly #byId = new Map<number | string, TriggerImpl>();
  #unnamed = 0;
  /** Notifications that came before the triggers were declared. */
  #early: Fired[] = [];
  constructor(runtime: Runtime) {
    this.runtime = runtime;
    runtime.raw("triggers.fired", (data) => this.#fired(data as Fired));
  }
  /** `activate()` begins: triggers may be declared until `end`. */
  begin() {
    this.#declaring = true;
  }
  /**
   * The synchronous part of `activate()` is over: the player learns what
   * was declared (only when something was), and what came early is
   * delivered.
   */
  end() {
    this.#declaring = false;
    this.#declared = true;
    if (this.#byId.size) {
      const names = [...this.#byId.keys()].filter(
        (id): id is string => typeof id === "string",
      );
      this.runtime.host.triggers
        .declare(names, this.#unnamed)
        .catch((error) => {
          if (!(error instanceof HostError && error.code === "disabled"))
            console.error(
              `[${this.runtime.manifest.id}] triggers.declare:`,
              error,
            );
        });
    }
    for (const fired of this.#early.splice(0)) this.#fired(fired);
  }
  /**
   * `plugin.trigger(name?)` of `scope`. Only the plugin itself declares
   * triggers, not a sub-scope (`plugin.scope()`): a trigger's condition is
   * the plugin's, kept by the player beyond any one run, while a sub-scope
   * is disposed within a run, and a kept condition whose functions went
   * with it would go on waking the plugin for nothing.
   */
  declare(scope: ScopeImpl, name?: string): Trigger {
    if (!this.#declaring)
      throw new Error(
        "plugin.trigger() is called only in the synchronous part of activate(), before its first await",
      );
    if (!scope.root)
      throw new Error(
        "plugin.trigger() is called on the plugin, not on a scope made with plugin.scope()",
      );
    if (this.#byId.size >= TRIGGER_LIMITS.triggers)
      throw failure(
        "limit",
        `a plugin has at most ${TRIGGER_LIMITS.triggers} triggers`,
      );
    let id: number | string;
    if (name === undefined) id = this.#unnamed++;
    else {
      if (
        typeof name !== "string" ||
        name.length === 0 ||
        [...name].length > TRIGGER_LIMITS.nameChars ||
        /\p{Cc}/u.test(name)
      )
        throw failure(
          "invalid",
          `a trigger's name is 1–${TRIGGER_LIMITS.nameChars} characters`,
        );
      if (this.#byId.has(name))
        throw failure("invalid", `a trigger named "${name}" exists already`);
      id = name;
    }
    const trigger = new TriggerImpl(this, scope, id);
    this.#byId.set(id, trigger);
    return trigger;
  }
  /** Nobody handles `trigger`'s notifications (T14): the player drops its condition. */
  unhandled(trigger: number | string) {
    this.runtime.host.triggers.off(trigger, true).catch(() => {});
  }
  #fired(fired: Fired) {
    if (!this.#declared) {
      this.#early.push(fired);
      return;
    }
    const trigger = this.#byId.get(fired.trigger);
    if (trigger) trigger.fired(fired);
    else this.unhandled(fired.trigger);
  }
}

/** The triggers of `runtime`'s plugin. */
export const triggersOf = (runtime: Runtime) =>
  runtime.service("triggers", () => new TriggerRegistry(runtime));
