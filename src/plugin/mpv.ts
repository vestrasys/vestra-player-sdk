/**
 * `plugin.mpv`: the mpv pass-through (L1). The checks here are the
 * player's own, made early with the same table (`src/mpv.ts`); what only
 * the player can tell (another plugin's label, mpv's answer) is its.
 */
import {
  mpvCommandProblem,
  mpvCommandRefusal,
  mpvNameProblem,
  mpvPropertyRefusal,
} from "../mpv.ts";
import type { Json } from "../wire.ts";
import type { Connection } from "./connection.ts";
import { failure } from "./errors.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Disposable, Mpv, MpvValue } from "./types.ts";

type Listener = (value: MpvValue) => void;

/** One per plugin: the properties observed and their listeners. */
class Observers {
  readonly #runtime: Connection;
  readonly #names = new Map<string, Set<Listener>>();
  #started = false;
  constructor(runtime: Connection) {
    this.#runtime = runtime;
  }
  /** One `mpv.observe` per name, however many listeners. */
  add(name: string, listener: Listener, report: (error: unknown) => void) {
    if (!this.#started) {
      this.#started = true;
      // Sent to the plugin that observes: no subscription of its own.
      this.#runtime.raw("mpv.property", (data) => {
        const event = data as { name: string; value: MpvValue };
        for (const each of [...(this.#names.get(event.name) ?? [])])
          each(event.value);
      });
    }
    let listeners = this.#names.get(name);
    if (!listeners) {
      listeners = new Set();
      this.#names.set(name, listeners);
      this.#runtime.starting(
        this.#runtime.host.mpv.observeProperty(name),
        report,
      );
    }
    listeners.add(listener);
  }
  async remove(name: string, listener: Listener) {
    const listeners = this.#names.get(name);
    if (!listeners?.delete(listener) || listeners.size) return;
    this.#names.delete(name);
    await this.#runtime.host.mpv.unobserveProperty(name).catch(() => {});
  }
}

export const mpv = (scope: ScopeImpl): Mpv => {
  const named = (name: unknown, write: boolean) => {
    const problem = mpvNameProblem(name);
    if (problem) throw failure("invalid", problem);
    const refused = mpvPropertyRefusal(name as string, write);
    if (refused) throw failure("refused", refused);
    return name as string;
  };
  const observers = () =>
    scope.runtime.service("mpv.observers", () => new Observers(scope.runtime));
  return {
    async command(args) {
      const problem = mpvCommandProblem(args);
      if (problem) throw failure("invalid", problem);
      const refused = mpvCommandRefusal(args);
      if (refused) throw failure("refused", refused);
      const answer = await scope.runtime.host.mpv.command([...args]);
      return (answer?.result ?? null) as MpvValue;
    },
    async get(name) {
      const answer = await scope.runtime.host.mpv.get(named(name, false));
      return (answer?.value ?? null) as MpvValue;
    },
    async set(name, value) {
      const property = named(name, true);
      if (value === undefined) throw failure("invalid", "set takes a value");
      await scope.runtime.host.mpv.set(property, value as Json);
    },
    observe(name, listener) {
      const property = named(name, false);
      if (typeof listener !== "function")
        throw failure(
          "invalid",
          "observe takes a property name and a listener",
        );
      // Like `player.on`: no full update pass after it.
      const deliver: Listener = (value) => scope.runQuiet(listener, value);
      observers().add(property, deliver, (error) => scope.report(error));
      const handle: Disposable = {
        dispose: async () => {
          scope.forget(handle);
          await observers().remove(property, deliver);
        },
      };
      return scope.add(handle);
    },
  };
};
