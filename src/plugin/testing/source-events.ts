/**
 * The discrete source events of the test host: `source.opening`,
 * `source.ready` and `source.ended`, derived from two consecutive source
 * states by the player's rules (player `src/host/src/source_events.rs`;
 * the cases of its tests are repeated in test/source-events.test.ts).
 *
 * A playthrough is one load of a source (`stamp.generation`, `cycle`); it
 * is in playback while `loading` or `ready`. One that leaves playback gets
 * `ended` (its last state: the state that says it ended, or the last one
 * before a replacement or a close); a new one gets `opening`, then
 * `ready`. A new cycle of the same source that is not loading is a seek
 * away from the end: it plays on, nothing opens. The test host's restart
 * goes to `ready` at once, so it says it is a new load (`reload`).
 *
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import type { SourceState } from "../../source.ts";

export type SourceEventName =
  "source.opening" | "source.ready" | "source.ended";

const inPlayback = (s: SourceState) =>
  s.source !== null && (s.phase === "loading" || s.phase === "ready");
const samePlaythrough = (a: SourceState, b: SourceState) =>
  a.stamp.generation === b.stamp.generation && a.cycle === b.cycle;

/** `source.ended`'s data for a playthrough that ended in `state`. */
function endedIn(state: SourceState) {
  const reason = state.terminalReason;
  if (state.phase === "error")
    return reason !== null && typeof reason === "object"
      ? { state, reason: "error", error: reason.failed }
      : { state, reason: "error" };
  return {
    state,
    reason: reason === "natural" || reason === "replaced" ? reason : "stopped",
  };
}

/** The events `next` adds to `previous`, in order. */
export function sourceEvents(
  previous: SourceState,
  next: SourceState,
  reload = false,
): [SourceEventName, unknown][] {
  const events: [SourceEventName, unknown][] = [];
  const open = next.source !== null;
  const same = samePlaythrough(previous, next);
  const resumed =
    !reload &&
    previous.source !== null &&
    previous.stamp.generation === next.stamp.generation &&
    previous.cycle !== next.cycle &&
    previous.phase === "ended" &&
    next.phase !== "loading";
  const begins = open && !same && !resumed;
  if (inPlayback(previous) && !(same && inPlayback(next))) {
    if (same && open) events.push(["source.ended", endedIn(next)]);
    else if (!open && next.stamp.generation === previous.stamp.generation)
      events.push(["source.ended", { state: previous, reason: "stopped" }]);
    else events.push(["source.ended", { state: previous, reason: "replaced" }]);
  }
  if (begins) {
    events.push([
      "source.opening",
      {
        state: next,
        previous:
          previous.source !== null
            ? { sourceId: previous.stamp.generation }
            : null,
      },
    ]);
    if (next.phase === "ready" || next.phase === "ended")
      events.push(["source.ready", { state: next }]);
    if (next.phase === "ended" || next.phase === "error")
      events.push(["source.ended", endedIn(next)]);
  } else if (same && previous.phase === "loading" && open) {
    if (next.phase === "ready" || next.phase === "ended")
      events.push(["source.ready", { state: next }]);
    // Loading straight to its end: ready, then ended.
    const at = events.findIndex(([name]) => name === "source.ended");
    if (next.phase === "ended" && at >= 0) events.push(...events.splice(at, 1));
  }
  return events;
}

/**
 * `source.ended` with `reason: "quit"` for a source in playback (the
 * player quits; only a running plugin gets it).
 */
export function quitEvent(state: SourceState) {
  return inPlayback(state) ? { state, reason: "quit" } : null;
}
