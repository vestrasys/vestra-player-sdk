/**
 * `plugin.when`: conditions on the player's own state that the player
 * evaluates: a command's `enabled` and `checked`, and since 1.10.0 a
 * trigger's condition (`plugin.trigger().firesOn`). The wire form is
 * `commands.register` / `commands.update` `when` and `triggers.set` `when`.
 */
import type {
  Condition,
  LanguagePreference,
  PlayerState,
  PositionRange,
  ThemeId,
  When,
} from "./types.ts";
import { LOCALES } from "../i18n.ts";
import { THEMES } from "./appearance.ts";
import { failure } from "./errors.ts";
import { TIMELINE_LIMITS } from "./timeline.ts";

/** A numeric atom's interval: `min ≤ value < max`, at least one bound. */
export type IntervalJson = {
  min?: number;
  max?: number;
};

/** A position list in the wire form: `[start, end?]` pairs, and a lead. */
export type PositionJson = {
  ranges: ([number] | [number, number | null])[];
  lead?: number;
};

/** A condition in the wire form: an object of exactly one key. */
export type ConditionJson =
  | { phase: PlayerState["phase"][] }
  | { paused: boolean }
  | { kind: PlayerState["kind"] }
  | { can: keyof PlayerState["can"] }
  | { fullscreen: boolean }
  | { theme: ThemeId }
  | { language: LanguagePreference }
  | { duration: IntervalJson }
  | { volume: IntervalJson }
  | { rate: IntervalJson }
  | { audioTrack: number }
  | { subtitleTrack: string }
  | { audioDevice: string }
  | { muted: boolean }
  | { maximized: boolean }
  | { pip: boolean }
  | { looping: boolean }
  | { time: IntervalJson }
  | { position: PositionJson }
  | { all: ConditionJson[] }
  | { any: ConditionJson[] }
  | { not: ConditionJson };

/**
 * What conditions read, in the SDK's names. The fields added in 1.10.0 are
 * optional: missing, a fact reads as unknown (false).
 */
export interface ConditionFacts {
  phase: PlayerState["phase"];
  paused: boolean;
  kind: PlayerState["kind"];
  can: Readonly<Record<string, boolean>>;
  fullscreen: boolean;
  theme: string;
  language: string;
  /** Seconds; `null` while unknown. */
  duration?: number | null;
  volume?: number;
  rate?: number;
  muted?: boolean;
  audioTrack?: number | null;
  subtitleTrack?: string | null;
  audioDevice?: string | null;
  looping?: boolean;
  maximized?: boolean;
  pip?: boolean;
  /** The current source's id. */
  sourceId?: number;
  /** The position; `null` without one. */
  position?: number | null;
  /** The wall clock, Unix milliseconds. */
  time?: number;
  /** The source a position list was bound to (T12). */
  bound?: number | null;
}

const PHASES: readonly PlayerState["phase"][] = [
  "empty",
  "loading",
  "ready",
  "ended",
  "error",
];
const CONTROLS: readonly (keyof PlayerState["can"])[] = [
  "pause",
  "seek",
  "rate",
  "restart",
  "close",
  "snapshot",
  "next",
  "previous",
];

class ConditionImpl implements Condition {
  readonly #json: ConditionJson;
  constructor(json: ConditionJson) {
    this.#json = json;
    Object.freeze(this);
  }
  and(...others: Condition[]): Condition {
    return new ConditionImpl({
      all: [this.#json, ...others.map(conditionJson)],
    });
  }
  or(...others: Condition[]): Condition {
    return new ConditionImpl({
      any: [this.#json, ...others.map(conditionJson)],
    });
  }
  not(): Condition {
    return new ConditionImpl({ not: this.#json });
  }
  toJSON(): ConditionJson {
    return this.#json;
  }
  static json(condition: ConditionImpl) {
    return condition.#json;
  }
}

/** Whether `value` is a condition made by `plugin.when`. */
export const isCondition = (value: unknown): value is Condition =>
  value instanceof ConditionImpl;

/** A condition's wire form; throws for anything else. */
export function conditionJson(condition: Condition): ConditionJson {
  if (!(condition instanceof ConditionImpl))
    throw new TypeError("a condition comes from plugin.when");
  return ConditionImpl.json(condition);
}

/** Whether a wire condition reads the position or the clock (a trigger's only). */
export function readsPositionOrTime(json: ConditionJson): boolean {
  if ("position" in json || "time" in json) return true;
  if ("all" in json) return json.all.some(readsPositionOrTime);
  if ("any" in json) return json.any.some(readsPositionOrTime);
  if ("not" in json) return readsPositionOrTime(json.not);
  return false;
}

/** How many position lists a wire condition has (at most one is allowed). */
export function positionLists(json: ConditionJson): number {
  if ("position" in json) return 1;
  if ("all" in json) return json.all.reduce((n, c) => n + positionLists(c), 0);
  if ("any" in json) return json.any.reduce((n, c) => n + positionLists(c), 0);
  if ("not" in json) return positionLists(json.not);
  return 0;
}

const make = (json: ConditionJson) => new ConditionImpl(json);

const finite = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** A numeric atom's `{ min?, max? }`, checked. */
function interval(name: string, bounds: unknown): IntervalJson {
  const shape = `${name} takes { min?, max? }: finite numbers, at least one, min < max`;
  if (!bounds || typeof bounds !== "object") throw new TypeError(shape);
  const { min, max, ...rest } = bounds as Record<string, unknown>;
  if (Object.keys(rest).length) throw new TypeError(shape);
  if (min === undefined && max === undefined) throw new TypeError(shape);
  if (
    (min !== undefined && !finite(min)) ||
    (max !== undefined && !finite(max))
  )
    throw new TypeError(shape);
  if (finite(min) && finite(max) && min >= max) throw new TypeError(shape);
  const json: IntervalJson = {};
  if (min !== undefined) json.min = min as number;
  if (max !== undefined) json.max = max as number;
  return json;
}

function identity(name: string, id: unknown): string {
  if (typeof id !== "string" || id.length === 0 || id.length > 256)
    throw new TypeError(`${name} takes an id (a string of 1–256 characters)`);
  return id;
}

/** `when.position.in`'s ranges and lead in the wire form. */
function positionList(
  ranges: Iterable<PositionRange>,
  options: { lead?: number } = {},
): PositionJson {
  const list = [...(ranges ?? [])];
  if (list.length > TIMELINE_LIMITS.ranges)
    throw failure(
      "limit",
      `a position list holds at most ${TIMELINE_LIMITS.ranges} ranges`,
    );
  const pairs = list.map((range): [number] | [number, number] => {
    const { start, end } = (range ?? {}) as Partial<PositionRange>;
    if (!finite(start) || start < 0)
      throw new TypeError(
        "a range starts at a finite number of seconds, 0 or more",
      );
    if (end === undefined || end === null) return [start];
    if (!finite(end) || end <= start)
      throw new TypeError("a range ends after its start");
    return [start, end];
  });
  const json: PositionJson = { ranges: pairs };
  const lead = options?.lead;
  if (lead !== undefined) {
    if (!finite(lead) || lead < 0)
      throw new TypeError("lead is a number of seconds, 0 or more");
    json.lead = lead;
  }
  return json;
}

/** The one `plugin.when` (conditions hold no plugin state). */
export const WHEN: When = Object.freeze({
  open: make({ not: { phase: ["empty"] } }),
  ready: make({ phase: ["ready"] }),
  playing: make({ all: [{ phase: ["ready"] }, { paused: false }] }),
  paused: make({ all: [{ phase: ["ready"] }, { paused: true }] }),
  stream: make({ kind: "stream" }),
  fullscreen: make({ fullscreen: true }),
  muted: make({ muted: true }),
  maximized: make({ maximized: true }),
  pip: make({ pip: true }),
  looping: make({ looping: true }),
  phase(...phases: PlayerState["phase"][]) {
    if (!phases.length || phases.some((phase) => !PHASES.includes(phase)))
      throw new TypeError(`phase is one or more of ${PHASES.join(", ")}`);
    return make({ phase: [...phases] });
  },
  can(control: keyof PlayerState["can"]) {
    if (!CONTROLS.includes(control))
      throw new TypeError(`can is one of ${CONTROLS.join(", ")}`);
    return make({ can: control });
  },
  theme(theme: ThemeId) {
    if (!THEMES.includes(theme))
      throw new TypeError(
        `theme is ${THEMES.map((t) => `"${t}"`).join(" or ")}`,
      );
    return make({ theme });
  },
  language(language: LanguagePreference) {
    if (
      language !== "system" &&
      !(LOCALES as readonly string[]).includes(language)
    )
      throw new TypeError(
        `language is "system" or one of ${LOCALES.map((l) => `"${l}"`).join(", ")}`,
      );
    return make({ language });
  },
  duration: (bounds: { min?: number; max?: number }) =>
    make({ duration: interval("duration", bounds) }),
  volume: (bounds: { min?: number; max?: number }) =>
    make({ volume: interval("volume", bounds) }),
  rate: (bounds: { min?: number; max?: number }) =>
    make({ rate: interval("rate", bounds) }),
  time: (bounds: { min?: number; max?: number }) =>
    make({ time: interval("time", bounds) }),
  audioTrack(id: number) {
    if (!Number.isInteger(id))
      throw new TypeError("audioTrack takes a track id (an integer)");
    return make({ audioTrack: id });
  },
  subtitleTrack: (id: string) =>
    make({ subtitleTrack: identity("subtitleTrack", id) }),
  audioDevice: (id: string) =>
    make({ audioDevice: identity("audioDevice", id) }),
  position: Object.freeze({
    in: (ranges: Iterable<PositionRange>, options?: { lead?: number }) =>
      make({ position: positionList(ranges, options) }),
  }),
});

/** One evaluation: whether it holds and, when its position list does, the range. */
export interface Truth {
  holds: boolean;
  /** The index of the range the position is in, when its position list holds. */
  range: number | null;
}

/**
 * The range of `list` the position `at` is in (`start − lead ≤ at < end`):
 * the earliest start when several are, as the player does.
 */
export function matchedRange(list: PositionJson, at: number): number | null {
  const lead = list.lead ?? 0;
  let found: number | null = null;
  let earliest = Infinity;
  list.ranges.forEach(([start, end], index) => {
    const from = start - lead;
    if (from <= at && at < (end ?? Infinity) && from < earliest) {
      earliest = from;
      found = index;
    }
  });
  return found;
}

/** Evaluate a wire condition as the player does, with its range (the test host). */
export function evaluateTruth(
  json: ConditionJson,
  facts: ConditionFacts,
): Truth {
  const plain = (holds: boolean): Truth => ({ holds, range: null });
  const inside = (bounds: IntervalJson, value: number | null | undefined) =>
    typeof value === "number" &&
    (bounds.min === undefined || bounds.min <= value) &&
    (bounds.max === undefined || value < bounds.max);
  if ("phase" in json) return plain(json.phase.includes(facts.phase));
  if ("paused" in json) return plain(facts.paused === json.paused);
  if ("kind" in json) return plain(facts.kind === json.kind);
  if ("can" in json) return plain(facts.can[json.can] === true);
  if ("fullscreen" in json) return plain(facts.fullscreen === json.fullscreen);
  if ("theme" in json) return plain(facts.theme === json.theme);
  if ("language" in json) return plain(facts.language === json.language);
  if ("duration" in json) return plain(inside(json.duration, facts.duration));
  if ("volume" in json) return plain(inside(json.volume, facts.volume ?? 100));
  if ("rate" in json) return plain(inside(json.rate, facts.rate ?? 1));
  if ("time" in json) return plain(inside(json.time, facts.time));
  if ("audioTrack" in json)
    return plain((facts.audioTrack ?? null) === json.audioTrack);
  if ("subtitleTrack" in json)
    return plain((facts.subtitleTrack ?? null) === json.subtitleTrack);
  if ("audioDevice" in json)
    return plain((facts.audioDevice ?? null) === json.audioDevice);
  if ("muted" in json) return plain((facts.muted ?? false) === json.muted);
  if ("maximized" in json)
    return plain((facts.maximized ?? false) === json.maximized);
  if ("pip" in json) return plain((facts.pip ?? false) === json.pip);
  if ("looping" in json)
    return plain((facts.looping ?? false) === json.looping);
  if ("position" in json) {
    const position = facts.position;
    const range =
      typeof position === "number" &&
      facts.bound !== null &&
      facts.bound !== undefined &&
      facts.bound === facts.sourceId
        ? matchedRange(json.position, position)
        : null;
    return { holds: range !== null, range };
  }
  if ("all" in json) {
    let range: number | null = null;
    for (const each of json.all) {
      const truth = evaluateTruth(each, facts);
      if (!truth.holds) return plain(false);
      range ??= truth.range;
    }
    return { holds: true, range };
  }
  if ("any" in json) {
    const truth = plain(false);
    for (const each of json.any) {
      const one = evaluateTruth(each, facts);
      truth.holds ||= one.holds;
      truth.range ??= one.range;
    }
    return truth;
  }
  return plain(!evaluateTruth(json.not, facts).holds);
}

/** Evaluate a wire condition as the player does (for the test host). */
export function evaluate(json: ConditionJson, facts: ConditionFacts): boolean {
  return evaluateTruth(json, facts).holds;
}
