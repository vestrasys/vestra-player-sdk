/**
 * The mpv pass-through (`mpv.command`, `mpv.get`, `mpv.set`,
 * `mpv.observe`, `mpv.unobserve`): the player's refusals from the shared
 * table (`src/mpv.ts`), a record of what was sent, a store of property
 * values and the owners of filter labels. No mpv: a command does nothing
 * but be recorded.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import {
  MPV_LIMITS,
  mpvCommandProblem,
  mpvCommandRefusal,
  mpvFilterChange,
  mpvNameProblem,
  mpvPropertyRefusal,
} from "../../mpv.ts";
import { HostError } from "../../wire.ts";
import type { Json } from "../../wire.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";

/** The property a request names, checked as the player checks it. */
function property(name: Json | undefined, write: boolean): string {
  const problem = mpvNameProblem(name);
  if (problem) throw new HostError("invalid", problem);
  const refused = mpvPropertyRefusal(name as string, write);
  if (refused) throw new HostError("refused", refused);
  return name as string;
}

/** Implements `TestHost.setMpvProperty`. */
export function setMpvProperty(host: TestHost, name: string, value: Json) {
  host.mpv.properties.set(name, value);
  if (host.mpv.observed.has(name)) host.emit("mpv.property", { name, value });
}

/** The default handlers of this area's wire methods, by method name. */
export function mpvHandlers(
  host: TestHost,
  _inner: Internals,
): Record<string, Handler> {
  return {
    "mpv.command": (p) => {
      const problem = mpvCommandProblem(p.args);
      if (problem) throw new HostError("invalid", problem);
      const args = p.args as (string | number | boolean)[];
      const refused = mpvCommandRefusal(args);
      if (refused) throw new HostError("refused", refused);
      // A filter label has one owner; the player removes a stopped
      // plugin's filters, a test host has only the one plugin.
      const change = mpvFilterChange(args);
      if (change) {
        const key = `${change.stage}/${change.label}`;
        const owner = host.mpv.labels.get(key);
        if (owner !== undefined && owner !== host.manifestId)
          throw new HostError(
            "conflict",
            `the filter label @${change.label} belongs to ${owner}`,
          );
        const remove =
          change.operation === "remove" ||
          (change.operation === "toggle" && owner !== undefined);
        if (remove) host.mpv.labels.delete(key);
        else host.mpv.labels.set(key, host.manifestId);
      }
      host.mpv.commands.push([...args]);
      return { result: null };
    },
    "mpv.get": (p) => {
      const name = property(p.name, false);
      if (!host.mpv.properties.has(name))
        throw new HostError("backend", "mpv: property not found");
      return { value: host.mpv.properties.get(name)! };
    },
    "mpv.set": (p) => {
      const name = property(p.name, true);
      if (p.value === undefined)
        throw new HostError("invalid", "set takes a value");
      setMpvProperty(host, name, p.value);
    },
    "mpv.observe": (p) => {
      const name = property(p.name, false);
      if (
        !host.mpv.observed.has(name) &&
        host.mpv.observed.size >= MPV_LIMITS.observed
      )
        throw new HostError(
          "limit",
          `a plugin observes at most ${MPV_LIMITS.observed} mpv properties`,
        );
      host.mpv.observed.add(name);
      // The current value first, as mpv sends it (nothing: null).
      queueMicrotask(() => {
        if (host.mpv.observed.has(name))
          host.emit("mpv.property", {
            name,
            value: host.mpv.properties.get(name) ?? null,
          });
      });
    },
    "mpv.unobserve": (p) => {
      host.mpv.observed.delete(property(p.name, false));
    },
  };
}
