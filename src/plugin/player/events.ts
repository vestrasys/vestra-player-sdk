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
 * The capability each event needs, as the player checks `events.subscribe`
 * (`HOST_CAPABILITIES`: by event, otherwise `events`); `null`: none.
 */
export const EVENT_NEEDS: Readonly<Record<HostEvent, string | null>> = {
  "source.state": "events",
  "playback.backend": "events",
  "window.state": "events",
  "packages.changed": null,
  "bindings.changed": "bindings.manage",
  "commands.keys": "commands",
  "timeline.changed": "events",
  "appearance.changed": "events",
  "resolvers.fileTypes": "events",
  "video.upscaling.changed": "video.upscaling",
};

/** `Player.on`'s arguments: a {@link HostEvent} name and a function. */
export function checkOn(
  event: unknown,
  listener: unknown,
): asserts event is HostEvent {
  if (typeof event !== "string" || !Object.hasOwn(EVENT_NEEDS, event))
    throw failure(
      "invalid",
      `unknown event ${JSON.stringify(event)}; the events are ${Object.keys(EVENT_NEEDS).join(", ")}`,
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
    EVENT_NEEDS[event],
  );
  const handle: Disposable = {
    dispose: async () => {
      scope.forget(handle);
      await watch.dispose();
    },
  };
  return scope.add(handle);
}
