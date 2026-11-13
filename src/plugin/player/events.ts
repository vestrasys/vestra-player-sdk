/**
 * `plugin.player.on` (L1, refactor plan §2.2): one listener of one player
 * event, with the event's data as the player sent it. It is a plain
 * subscription of the connection (counted as a listener, its `why` naming where
 * the plugin added it), never a state copy: nothing is kept, nothing is
 * compared.
 */
import { failure } from "../errors.ts";
import type { ScopeImpl } from "../scope.ts";
import type { Disposable, EventPayload, HostEvent } from "../types.ts";

/**
 * The events a plugin subscribes to by name: every {@link HostEvent} (the
 * type keeps the list complete). None needs a capability.
 */
export const HOST_EVENTS: Readonly<Record<HostEvent, true>> = {
  "source.state": true,
  "playback.backend": true,
  "window.state": true,
  "packages.changed": true,
  "bindings.changed": true,
  "commands.keys": true,
  "timeline.changed": true,
  "appearance.changed": true,
  "resolvers.fileTypes": true,
  "video.upscaling.changed": true,
  "video.motion.changed": true,
};

/** `Player.on`'s arguments: a {@link HostEvent} name and a function. */
export function checkOn(
  event: unknown,
  listener: unknown,
): asserts event is HostEvent {
  if (typeof event !== "string" || !Object.hasOwn(HOST_EVENTS, event))
    throw failure(
      "invalid",
      `unknown event ${JSON.stringify(event)}; the events are ${Object.keys(HOST_EVENTS).join(", ")}`,
    );
  if (typeof listener !== "function")
    throw failure("invalid", "on takes an event name and a listener");
}

/** `Player.on`: `listener` hears each `event`, with a copy of its data. */
export function playerOn<E extends HostEvent>(
  scope: ScopeImpl,
  event: E,
  listener: (data: EventPayload<E>) => void,
): Disposable {
  checkOn(event, listener);
  const watch = scope.runtime.on(
    event,
    // A copy: the same data also feeds the SDK's own state copies.
    // No full pass after it (`runQuiet`): the listener pushes its own
    // values; `plugin.state` writes run the passes that concern them.
    (data) =>
      scope.runQuiet(listener, structuredClone(data) as EventPayload<E>),
  );
  const handle: Disposable = {
    dispose: async () => {
      scope.forget(handle);
      await watch.dispose();
    },
  };
  return scope.add(handle);
}
