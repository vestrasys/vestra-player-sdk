/**
 * The transport side of the fake player: the event bus (`on`, `emit`),
 * `settle`, `close`, event subscriptions and the residency report.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { rmSync } from "node:fs";
import { HostError } from "../../wire.ts";
import { WAKE_EVENTS } from "../runtime.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";

export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * Refusals for a position or resolver another plugin holds: not activation
 * failures (`startPlugin`).
 */
export const takenErrors = new WeakSet<Error>();

export const taken = (message: string) => {
  const error = new HostError("conflict", message);
  takenErrors.add(error);
  return error;
};

/** Lines `vestra-plugin test` printed already (one per plugin and reasons). */
export const told = new Set<string>();

/**
 * Under `vestra-plugin test` (`VESTRA_PLUGIN_RESIDENCY=1`): say once per
 * test file why the plugin would keep running after it starts.
 */
export function tellResidency(host: TestHost) {
  if (process.env.VESTRA_PLUGIN_RESIDENCY !== "1") return;
  const reasons = host.keepsRunning;
  if (!reasons.length) return;
  const line = `${host.manifestId} keeps running while idle (lazy activation): ${reasons.join("; ")}`;
  if (told.has(line)) return;
  told.add(line);
  console.log(`# ${line}`);
}

/** Implements `TestHost.on`. */
export function on(
  _host: TestHost,
  inner: Internals,
  event: string,
  listener: (data: unknown) => void,
) {
  const group = inner.listeners.get(event) ?? new Set();
  group.add(listener);
  inner.listeners.set(event, group);
  return () => {
    group.delete(listener);
  };
}

/** Implements `TestHost.emit`. */
export function emit(
  host: TestHost,
  inner: Internals,
  event: string,
  data: unknown,
) {
  if (
    [
      "source.state",
      "playback.backend",
      "window.state",
      "timeline.changed",
      "appearance.changed",
    ].includes(event) &&
    !host.subscriptions.has(event)
  )
    return;
  for (const listener of [...(inner.listeners.get(event) ?? [])])
    listener(data);
}

/** Implements `TestHost.settle`. */
export async function settle(_host: TestHost, inner: Internals, ms = 0) {
  const deadline = Date.now() + ms;
  for (let idle = 0; idle < 3;) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 1));
    idle = inner.inFlight === 0 && Date.now() >= deadline ? idle + 1 : 0;
  }
}

/** Implements `TestHost.close`. */
export function close(host: TestHost, inner: Internals) {
  for (const producer of host.producers.values()) producer.server.close();
  // Cleanup never fails a test: on Windows a file a closing handle still
  // holds makes the removal fail now and then (`ENOTEMPTY`, `EBUSY`,
  // `EPERM`); retry, then leave the directory to the system's cleanup.
  try {
    rmSync(inner.scratch, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  } catch {
    // Left in the temporary directory.
  }
}

/** Implements `TestHost.keepsRunning`. */
export function keepsRunning(host: TestHost, _inner: Internals): string[] {
  const reasons: string[] = [];
  for (const event of host.listening)
    if (!WAKE_EVENTS.includes(event))
      for (const why of host.listeningWhy.get(event) ?? ["a listener"])
        reasons.push(`listens to ${event}: ${why}`);
  // A sidebar panel is never live (player 0.7.3): the current tab keeps
  // the plugin running as busy work, a background tab not at all. The
  // adjust column's current tab only while the column is open (0.7.6).
  for (const panel of host.panels.values()) {
    if (panel.slot === "sidebar") {
      if (host.layout.sidebar?.owner === 1)
        reasons.push("its sidebar tab is the current tab");
    } else if (panel.slot === "adjust") {
      if (host.layout.adjust?.owner === 1 && host.layout.adjust.preferred)
        reasons.push("its adjust tab is the current tab");
    } else reasons.push("a mounted panel");
  }
  for (const [id, window] of host.windows)
    if (window.visible) reasons.push(`an open window (${id})`);
  return reasons;
}

/** The default handlers of this area's wire methods, by method name. */
export function transportHandlers(
  host: TestHost,
  _inner: Internals,
): Record<string, Handler> {
  return {
    "events.subscribe": (p) => {
      const event = String(p.event);
      host.subscriptions.add(event);
      if (p.mirror === true) host.listening.delete(event);
      else host.listening.add(event);
      if (p.mirror !== true && Array.isArray(p.why))
        host.listeningWhy.set(event, p.why.map(String));
      else host.listeningWhy.delete(event);
    },
    "events.unsubscribe": (p) => {
      host.subscriptions.delete(String(p.event));
      host.listening.delete(String(p.event));
      host.listeningWhy.delete(String(p.event));
    },
  };
}
