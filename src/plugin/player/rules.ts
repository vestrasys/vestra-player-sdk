/**
 * The player's rules for its controls that the SDK checks before asking
 * (L1, refactor plan §2.2): shared by `plugin.player`, `plugin.host` and
 * `TestHost`.
 */

/** A step-seek length the player accepts: 0.1–3600 seconds in tenths. */
export const validStep = (seconds: unknown): seconds is number =>
  typeof seconds === "number" &&
  Number.isFinite(seconds) &&
  seconds >= 0.1 &&
  seconds <= 3600 &&
  Math.abs(Math.round(seconds * 10) - seconds * 10) <= 1e-9;
