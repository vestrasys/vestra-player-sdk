/**
 * `plugin.when`: conditions on the player's own state that the player
 * evaluates for a command's `enabled` and `checked` (player 0.5.21). The
 * wire form is `commands.register` / `commands.update` `when`.
 */
import type {
  Condition,
  LanguagePreference,
  PlayerState,
  ThemeId,
  When,
} from "./types.ts";
import { LOCALES } from "../i18n.ts";
import { THEMES } from "./appearance.ts";

/** A condition in the wire form: an object of exactly one key. */
export type ConditionJson =
  | { phase: PlayerState["phase"][] }
  | { paused: boolean }
  | { kind: PlayerState["kind"] }
  | { can: keyof PlayerState["can"] }
  | { fullscreen: boolean }
  | { theme: ThemeId }
  | { language: LanguagePreference }
  | { all: ConditionJson[] }
  | { any: ConditionJson[] }
  | { not: ConditionJson };

/** What conditions read, in the SDK's names. */
export interface ConditionFacts {
  phase: PlayerState["phase"];
  paused: boolean;
  kind: PlayerState["kind"];
  can: Readonly<Record<string, boolean>>;
  fullscreen: boolean;
  theme: string;
  language: string;
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

const make = (json: ConditionJson) => new ConditionImpl(json);

/** The one `plugin.when` (conditions hold no plugin state). */
export const WHEN: When = Object.freeze({
  open: make({ not: { phase: ["empty"] } }),
  ready: make({ phase: ["ready"] }),
  playing: make({ all: [{ phase: ["ready"] }, { paused: false }] }),
  paused: make({ all: [{ phase: ["ready"] }, { paused: true }] }),
  stream: make({ kind: "stream" }),
  fullscreen: make({ fullscreen: true }),
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
});

/** Evaluate a wire condition as the player does (for the test host). */
export function evaluate(json: ConditionJson, facts: ConditionFacts): boolean {
  if ("phase" in json) return json.phase.includes(facts.phase);
  if ("paused" in json) return facts.paused === json.paused;
  if ("kind" in json) return facts.kind === json.kind;
  if ("can" in json) return facts.can[json.can] === true;
  if ("fullscreen" in json) return facts.fullscreen === json.fullscreen;
  if ("theme" in json) return facts.theme === json.theme;
  if ("language" in json) return facts.language === json.language;
  if ("all" in json) return json.all.every((each) => evaluate(each, facts));
  if ("any" in json) return json.any.some((each) => evaluate(each, facts));
  return !evaluate(json.not, facts);
}
