/**
 * Triggers in the fake player (1.10.0, events-and-triggers.md §4.11): the
 * conditions a plugin hands over, kept and evaluated by the player's rules
 * (`evaluateTruth`, the agreement table), a virtual clock that moves the
 * playback position and the wall clock (`advance`), standby and wake
 * (`park`), and an upgrade (`upgrade`: unnamed conditions cleared, named
 * kept).
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state. Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import type { Json } from "../../wire.ts";
import { WAKE_EVENTS } from "../connection.ts";
import { TIMELINE_LIMITS } from "../timeline.ts";
import { TRIGGER_LIMITS } from "../triggers.ts";
import { evaluateTruth, matchedRange, positionLists } from "../when.ts";
import type { ConditionFacts, ConditionJson, PositionJson } from "../when.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";

/**
 * One kept trigger condition, as `TestHost.triggers` lists it.
 *
 * @since 1.10.0
 * @category Testing
 */
export interface KeptTrigger {
  /** The trigger: its name, or its place among the unnamed ones. */
  readonly trigger: number | string;
  /** The condition in the wire form. */
  readonly when: Json;
  /** Its sequence number. */
  readonly seq: number;
  /** It holds now ("entered"). */
  readonly entered: boolean;
}

interface Kept {
  trigger: number | string;
  when: ConditionJson;
  seq: number;
  /** The source its position list belongs to. */
  bound: number | null;
  /** Entered, with the range it is in. */
  entered: { range: number | null } | null;
  /** The run that gave it. */
  run: number;
}

/** What the player keeps for the plugin's triggers. */
class TriggerState {
  readonly kept = new Map<string, Kept>();
  seq = 0;
  /** The run (process generation): a park, a wake and an upgrade start one. */
  run = 1;
  /** How many unnamed triggers this version declared. */
  unnamed: number | null = null;
  /** The virtual wall clock (Unix ms). */
  now = Date.now();
  parked = false;
  /** The wake events the plugin listened to when it was parked. */
  wakes = new Set<string>();
  /** What waits for the next start: (merge key, event, data). */
  backlog: [string, string, unknown][] = [];
  waking: Promise<void> | undefined;
  /** The backlog is delivered now (at the woken plugin's ready). */
  flushing = false;
  /** Starts the plugin again (`startPlugin`); `entry`: other code (an upgrade). */
  start: ((entry?: (plugin: never) => unknown) => Promise<void>) | undefined;
  /** Stops the running plugin with a reason. */
  stop: ((reason: string) => Promise<void>) | undefined;
  /** Evaluating: no evaluation inside another. */
  busy = false;
}

const states = new WeakMap<TestHost, TriggerState>();
export function triggerState(host: TestHost): TriggerState {
  let state = states.get(host);
  if (!state) {
    state = new TriggerState();
    states.set(host, state);
  }
  return state;
}

const key = (trigger: number | string) => JSON.stringify(trigger);

/** The facts the player's conditions read, from the host. */
export function conditionFacts(
  host: TestHost,
  state?: TriggerState,
): ConditionFacts {
  const source = host.source;
  const capabilities = source.capabilities;
  const target = host.subtitles.selection.target as {
    kind: string;
    id?: number;
    owner?: number;
    resourceId?: string;
    contentRevision?: number;
  } | null;
  return {
    phase: source.phase,
    paused: source.paused,
    kind: source.kind === "producer" ? "stream" : "media",
    can: {
      pause: capabilities.pause,
      seek: capabilities.seek,
      rate: capabilities.rate,
      restart: capabilities.restart,
      close: capabilities.close,
      snapshot: capabilities.snapshotSource,
      next: source.sequence?.next === true,
      previous: source.sequence?.previous === true,
    },
    fullscreen: host.mainWindow.fullscreen,
    theme: host.appearance,
    language: host.language,
    duration: typeof source.duration === "number" ? source.duration : null,
    volume: source.output.volume,
    rate: source.rate,
    muted: source.output.muted,
    audioTrack: source.audioTracks?.find((t) => t.selected)?.trackId ?? null,
    subtitleTrack: !target
      ? null
      : target.kind === "embedded"
        ? `embedded:${target.id}`
        : `external:${target.owner}:${target.resourceId}:${target.contentRevision}`,
    audioDevice: source.audioOutput?.active ?? null,
    looping: !!source.loop,
    maximized: host.mainWindow.maximized && !host.mainWindow.fullscreen,
    pip: host.mainWindow.pictureInPicture.active,
    sourceId: source.stamp.generation,
    position: source.position,
    time: (state ?? triggerState(host)).now,
  };
}

/** The player's refusal of a condition it cannot keep, in its words. */
function check(json: unknown): ConditionJson {
  if (!json || typeof json !== "object" || Object.keys(json).length !== 1)
    throw new HostError("invalid", "a condition is an object with one key");
  const condition = json as ConditionJson;
  if (positionLists(condition) > 1)
    throw new HostError("invalid", "a condition has at most one position list");
  const lists = (c: ConditionJson): PositionJson[] =>
    "position" in c
      ? [c.position]
      : "all" in c
        ? c.all.flatMap(lists)
        : "any" in c
          ? c.any.flatMap(lists)
          : "not" in c
            ? lists(c.not)
            : [];
  for (const list of lists(condition))
    if (list.ranges.length > TIMELINE_LIMITS.ranges)
      throw new HostError(
        "limit",
        `a position list holds at most ${TIMELINE_LIMITS.ranges} ranges`,
      );
  return condition;
}

function parseTrigger(value: unknown): number | string {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) {
    if (value >= TRIGGER_LIMITS.triggers)
      throw new HostError(
        "limit",
        `a plugin has at most ${TRIGGER_LIMITS.triggers} triggers`,
      );
    return value;
  }
  if (
    typeof value === "string" &&
    value.length > 0 &&
    [...value].length <= TRIGGER_LIMITS.nameChars
  )
    return value;
  throw new HostError("invalid", "trigger is a name or a place");
}

/** The position list of `when`, if it has one. */
function listOf(when: ConditionJson): PositionJson | null {
  if ("position" in when) return when.position;
  if ("all" in when) return when.all.map(listOf).find((l) => l) ?? null;
  if ("any" in when) return when.any.map(listOf).find((l) => l) ?? null;
  if ("not" in when) return listOf(when.not);
  return null;
}

/** The nearest time bound of `when` after `now`. */
function nextTime(when: ConditionJson, now: number): number | null {
  const nearest = (values: (number | null | undefined)[]) => {
    let best: number | null = null;
    for (const value of values)
      if (
        typeof value === "number" &&
        value > now &&
        (best === null || value < best)
      )
        best = value;
    return best;
  };
  if ("time" in when) return nearest([when.time.min, when.time.max]);
  if ("all" in when) return nearest(when.all.map((c) => nextTime(c, now)));
  if ("any" in when) return nearest(when.any.map((c) => nextTime(c, now)));
  if ("not" in when) return nextTime(when.not, now);
  return null;
}

/** One flip, as the player sends it. */
function notify(
  host: TestHost,
  inner: Internals,
  kept: Kept,
  edge: "enter" | "leave",
  range: number | null,
) {
  const data: Record<string, unknown> = {
    trigger: kept.trigger,
    seq: kept.seq,
    edge,
    state: structuredClone(host.source),
  };
  const list = listOf(kept.when);
  if (range !== null && list) {
    const [start, end] = list.ranges[range]!;
    data.range = { start, end: end ?? null, index: range };
  }
  deliver(
    host,
    inner,
    `triggers.fired ${key(kept.trigger)} ${edge}`,
    "triggers.fired",
    data,
  );
}

/** Evaluates `only` (or every kept condition) and sends what flipped (T1, T10). */
export function evaluateTriggers(
  host: TestHost,
  inner: Internals,
  only?: Kept,
) {
  const state = triggerState(host);
  if (state.busy) return;
  state.busy = true;
  try {
    const facts = conditionFacts(host, state);
    for (const kept of only ? [only] : [...state.kept.values()]) {
      const truth = evaluateTruth(kept.when, { ...facts, bound: kept.bound });
      const was = kept.entered;
      if (!was && truth.holds) {
        kept.entered = { range: truth.range };
        notify(host, inner, kept, "enter", truth.range);
      } else if (was && !truth.holds) {
        kept.entered = null;
        notify(host, inner, kept, "leave", was.range);
      } else if (was && truth.holds && was.range !== truth.range) {
        kept.entered = { range: truth.range };
        notify(host, inner, kept, "leave", was.range);
        notify(host, inner, kept, "enter", truth.range);
      }
    }
  } finally {
    state.busy = false;
  }
}

/** Sends one notification or wake event; held, and a wake, while parked. */
function deliver(
  host: TestHost,
  inner: Internals,
  merge: string,
  event: string,
  data: unknown,
) {
  const state = triggerState(host);
  if (!state.parked && !state.waking) {
    host.emit(event, data);
    return;
  }
  // The backlog keeps the newest of each key, in their order (§4.9).
  state.backlog = state.backlog.filter(([other]) => other !== merge);
  state.backlog.push([merge, event, data]);
  wake(host, inner);
}

/** Starts a parked plugin and delivers what waits for it, at its ready. */
function wake(host: TestHost, inner: Internals) {
  const state = triggerState(host);
  if (state.waking || !state.parked || !state.start) return;
  const start = state.start;
  inner.inFlight++;
  state.waking = (async () => {
    try {
      state.parked = false;
      await start();
      state.flushing = true;
      for (;;) {
        const next = state.backlog.shift();
        if (!next) break;
        host.emit(next[1], next[2]);
        await new Promise((resolve) => setImmediate(resolve));
      }
    } finally {
      state.flushing = false;
      state.waking = undefined;
      inner.inFlight--;
    }
  })();
  state.waking.catch((error) => console.error("# TestHost wake:", error));
}

/**
 * `emit` of `event`: the trigger conditions are evaluated first for the
 * player's own state changes; a wake event for a parked plugin that listened
 * to it is held and wakes it (`true`: not delivered now).
 */
export function hearEvent(
  host: TestHost,
  inner: Internals,
  event: string,
  data: unknown,
): boolean {
  if (
    event === "source.state" ||
    event === "window.state" ||
    event === "appearance.changed"
  )
    evaluateTriggers(host, inner);
  const state = states.get(host);
  if (!state || state.flushing || (!state.parked && !state.waking))
    return false;
  // Starting: what is not a wake event reaches it now, as the player sends
  // it; a wake event waits behind what woke it.
  if (!state.wakes.has(event)) return state.parked;
  const source = (data as { state?: { stamp?: { generation?: number } } })
    ?.state?.stamp?.generation;
  const merge = event.startsWith("source.") ? `${event} ${source}` : event;
  deliver(host, inner, merge, event, data);
  return true;
}

/** `TestHost.triggers`. */
export function keptTriggers(host: TestHost): KeptTrigger[] {
  return [...triggerState(host).kept.values()].map((kept) =>
    Object.freeze({
      trigger: kept.trigger,
      when: structuredClone(kept.when) as Json,
      seq: kept.seq,
      entered: kept.entered !== null,
    }),
  );
}

/** `TestHost.advance`: the clock and, while playing, the position move by `ms`. */
export async function advance(host: TestHost, inner: Internals, ms: number) {
  if (!(ms >= 0) || !Number.isFinite(ms))
    throw new TypeError("advance takes a number of milliseconds, 0 or more");
  const state = triggerState(host);
  let left = ms;
  let moved = false;
  for (let guard = 0; guard < 100_000; guard++) {
    const source = host.source;
    const running =
      source.phase === "ready" && !source.paused && source.position !== null;
    const rate = source.rate > 0 ? source.rate : 1;
    const position = source.position ?? 0;
    // The next place a condition can change at: a boundary of a position
    // list bound to this source, or a time bound.
    let step = left;
    let boundary: number | null = null;
    if (running)
      for (const kept of state.kept.values()) {
        const list = listOf(kept.when);
        if (!list || kept.bound !== source.stamp.generation) continue;
        for (const [start, end] of list.ranges)
          for (const at of [start - (list.lead ?? 0), end ?? Infinity])
            if (at > position) {
              const wait = ((at - position) / rate) * 1000;
              if (wait <= step) {
                step = wait;
                boundary = at;
              }
            }
      }
    let timed = false;
    for (const kept of state.kept.values()) {
      const due = nextTime(kept.when, state.now);
      if (due !== null && due - state.now <= step) {
        step = due - state.now;
        boundary = running ? boundary : null;
        timed = true;
      }
    }
    state.now += step;
    left -= step;
    if (running && step > 0) {
      const at =
        boundary !== null && !timed
          ? boundary
          : position + (rate * step) / 1000;
      host.source = { ...host.source, position: at };
      moved = true;
    }
    evaluateTriggers(host, inner);
    await host.settle();
    if (left <= 0) break;
  }
  // The position as the player's next state push says it.
  if (moved) host.setSource({ position: host.source.position });
}

/** `TestHost.park`: the player puts the plugin in standby. */
export async function park(host: TestHost, _inner: Internals) {
  const state = triggerState(host);
  if (state.parked) return;
  if (!state.stop)
    throw new Error("park needs a plugin started with startPlugin");
  state.wakes = new Set(
    [...host.subscriptions].filter((event) => WAKE_EVENTS.includes(event)),
  );
  await state.stop("idle");
  state.parked = true;
  state.run++;
}

/** `TestHost.upgrade`: another version replaces the plugin (§4.2). */
export async function upgrade(
  host: TestHost,
  _inner: Internals,
  entry?: (plugin: never) => unknown,
) {
  const state = triggerState(host);
  if (!state.start || !state.stop)
    throw new Error("upgrade needs a plugin started with startPlugin");
  if (!state.parked) await state.stop("upgrade");
  for (const [id, kept] of [...state.kept])
    if (typeof kept.trigger === "number") state.kept.delete(id);
  state.unnamed = null;
  state.parked = false;
  state.run++;
  await state.start(entry);
  await host.settle();
}

/**
 * What a replaced condition keeps of "entered" (the player's
 * `Triggers::set`): a range list for the same source whose position is
 * still in the very range it was entered with (the same start, end and
 * lead; its place may move) stays entered, so the replacement sends no
 * second `enter`; anything else is entered anew at once (T3, T6).
 */
function carried(
  host: TestHost,
  old: Kept | undefined,
  when: ConditionJson,
  bound: number | null,
): Kept["entered"] {
  if (!old?.entered || old.entered.range === null || bound === null)
    return null;
  if (old.bound !== bound) return null;
  const before = listOf(old.when);
  const after = listOf(when);
  if (!before || !after || (before.lead ?? 0) !== (after.lead ?? 0))
    return null;
  const truth = evaluateTruth(when, { ...conditionFacts(host), bound });
  if (!truth.holds || truth.range === null) return null;
  const was = before.ranges[old.entered.range];
  const now = after.ranges[truth.range];
  return was &&
    now &&
    was[0] === now[0] &&
    (was[1] ?? null) === (now[1] ?? null)
    ? { range: truth.range }
    : null;
}

/** The default handlers of this area's wire methods, by method name. */
export function triggersHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    "triggers.set": (p) => {
      const state = triggerState(host);
      const trigger = parseTrigger(p.trigger);
      const when = check(p.when);
      const bound = listOf(when) ? host.source.stamp.generation : null;
      const id = key(trigger);
      const kept = state.kept.get(id);
      if (
        kept &&
        JSON.stringify(kept.when) === JSON.stringify(when) &&
        kept.bound === bound
      ) {
        kept.run = state.run;
        return { seq: kept.seq };
      }
      if (!kept && state.kept.size >= TRIGGER_LIMITS.triggers)
        throw new HostError(
          "limit",
          `a plugin keeps at most ${TRIGGER_LIMITS.triggers} trigger conditions`,
        );
      // Still in the range it was entered with: entered, under the same
      // number (its `enter` may still be on its way to the plugin).
      const entered = carried(host, kept, when, bound);
      const fresh: Kept = {
        trigger,
        when: structuredClone(when),
        seq: entered && kept ? kept.seq : ++state.seq,
        bound,
        entered,
        run: state.run,
      };
      state.kept.set(id, fresh);
      // After the answer, as the plugin sees it: entered at once (T3).
      setImmediate(() => evaluateTriggers(host, inner, fresh));
      return { seq: fresh.seq };
    },
    "triggers.off": (p) => {
      const state = triggerState(host);
      state.kept.delete(key(parseTrigger(p.trigger)));
      return { seq: ++state.seq };
    },
    "triggers.declare": (p) => {
      const state = triggerState(host);
      const names = Array.isArray(p.names) ? p.names.map(String) : [];
      const unnamed = typeof p.unnamed === "number" ? p.unnamed : 0;
      for (const [id, kept] of [...state.kept]) {
        const drop =
          typeof kept.trigger === "string"
            ? !names.includes(kept.trigger)
            : kept.run !== state.run &&
              (kept.trigger >= unnamed ||
                (state.unnamed !== null && state.unnamed !== unnamed));
        if (drop) state.kept.delete(id);
      }
      state.unnamed = unnamed;
      return null;
    },
  };
}

/** `matchedRange` for tests of the host's position lists. */
export { matchedRange };
