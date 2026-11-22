/**
 * `plugin.player.on` (L1, refactor plan §2.2): one listener of one player
 * event, with the event's data as the player sent it. It is a plain
 * subscription of the connection (counted as a listener, its `why` naming where
 * the plugin added it), never a state copy: nothing is kept, nothing is
 * compared.
 */
import { failure } from "../errors.ts";
import type { Needs } from "../connection.ts";
import type { ScopeImpl } from "../scope.ts";
import type {
  Disposable,
  EventPayload,
  FactEvent,
  HostEvent,
  SourceEvent,
} from "../types.ts";

/**
 * Every event a plugin listens to by name, and when its group is
 * subscribed at the player (`Needs`): `"held"` only while a listener, a
 * hold or a stream holds it (the SDK's own copy of a frequent state never
 * subscribes on its own); `null` from its first entry, a copy included.
 * A plugin listener subscribes its event either way.
 */
export const EVENT_NEEDS: Readonly<
  Record<HostEvent | SourceEvent | FactEvent, Needs>
> = {
  "source.state": "held",
  "playback.backend": "held",
  "window.state": "held",
  "packages.changed": null,
  "bindings.changed": null,
  "commands.keys": null,
  "timeline.changed": "held",
  "appearance.changed": "held",
  "resolvers.fileTypes": "held",
  "video.upscaling.changed": null,
  "video.motion.changed": null,
  "source.opening": null,
  "source.ready": null,
  "source.ended": null,
  "video.reconfigured": null,
  "audio.reconfigured": null,
  "audio.tracks.changed": null,
  "subtitles.changed": null,
  "window.changed": null,
  "layout.changed": null,
  "audio.devices.changed": null,
  "app.started": null,
};

/** `Player.on`'s arguments: a {@link HostEvent} name and a function. */
export function checkOn(
  event: unknown,
  listener: unknown,
): asserts event is HostEvent | SourceEvent | FactEvent {
  if (typeof event !== "string" || !Object.hasOwn(EVENT_NEEDS, event))
    throw failure(
      "invalid",
      `unknown event ${JSON.stringify(event)}; the events are ${Object.keys(EVENT_NEEDS).join(", ")}`,
    );
  if (typeof listener !== "function")
    throw failure("invalid", "on takes an event name and a listener");
}

/**
 * The discrete source events (player 0.10.0): their `state` reaches the
 * listener as a `PlayerState`, not in the wire shape.
 */
export const SOURCE_EVENTS: ReadonlySet<string> = new Set<SourceEvent>([
  "source.opening",
  "source.ready",
  "source.ended",
]);

/**
 * The second batch of events (SDK 1.11.0): a fact that changed, once per
 * change. Some reach the listener in the SDK's shape (the scope converts
 * them, `ScopeImpl.fact`).
 */
export const FACT_EVENTS: ReadonlySet<string> = new Set<FactEvent>([
  "video.reconfigured",
  "audio.reconfigured",
  "audio.tracks.changed",
  "subtitles.changed",
  "window.changed",
  "layout.changed",
  "audio.devices.changed",
  "app.started",
]);

/**
 * `Player.on`: `listener` hears each `event`, with a copy of its data;
 * `convert` (the source and fact events) turns the copy into what the
 * listener gets.
 */
export function playerOn<E extends HostEvent>(
  scope: ScopeImpl,
  event: E | SourceEvent | FactEvent,
  listener: (data: EventPayload<E>) => void,
  convert: (data: unknown) => unknown = (data) => data,
): Disposable {
  checkOn(event, listener);
  const watch = scope.runtime.on(
    event,
    // A copy: the same data also feeds the SDK's own state copies.
    // No full pass after it (`runQuiet`): the listener pushes its own
    // values; `plugin.state` writes run the passes that concern them.
    (data) =>
      scope.runQuiet(
        listener,
        convert(structuredClone(data)) as EventPayload<E>,
      ),
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
