/**
 * The generator's settings: what the control window edits, what `frame()`
 * reads, and what is saved between runs. Plain data, no SDK types.
 */

// #region format
/** Frame size in pixels. Every frame is WIDTH × HEIGHT × 4 bytes of RGBA. */
export const WIDTH = 640;
export const HEIGHT = 360;
/**
 * Frame rate as a fraction (30000/1001 would be NTSC's 29.97). The player
 * has no frame-rate setting for a stream: the rate follows from how many
 * audio samples each frame carries (see `FrameClock`).
 */
export const FPS = { num: 30, den: 1 } as const;
/** The only sample rate a stream accepts: 48 kHz, stereo, 32-bit float. */
export const SAMPLE_RATE = 48_000;
// #endregion format

/** Tone frequency range in Hz (the frequency slider is logarithmic). */
export const MIN_HZ = 20;
export const MAX_HZ = 5_000;
/** Level range in dBFS (0 dB = full scale). */
export const MIN_DB = -60;
export const MAX_DB = 0;

// #region controls
export const PATTERNS = ["bars", "grid", "scope"] as const;
export const WAVEFORMS = ["sine", "square", "saw", "noise"] as const;
export const FILTERS = ["off", "mono", "swap", "treble"] as const;

export type Pattern = (typeof PATTERNS)[number];
export type Waveform = (typeof WAVEFORMS)[number];
export type FilterChoice = (typeof FILTERS)[number];

/** Everything the user can change while the generator runs. */
export interface Controls {
  pattern: Pattern;
  waveform: Waveform;
  /** Tone frequency in Hz, MIN_HZ–MAX_HZ. Ignored while `sweep` is on. */
  frequency: number;
  /** Glide from MIN_HZ to MAX_HZ and start again. */
  sweep: boolean;
  /** Output level in dBFS, MIN_DB–MAX_DB. */
  levelDb: number;
  mute: boolean;
  /** −1 = left only, 0 = centre, 1 = right only. */
  balance: number;
  /** The player-side audio filter (see filter.ts). */
  filter: FilterChoice;
}

export const DEFAULTS: Controls = {
  pattern: "bars",
  waveform: "sine",
  frequency: 1_000,
  sweep: false,
  levelDb: -18,
  mute: false,
  balance: 0,
  filter: "off",
};
// #endregion controls

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

/** `storage.json` validator: a saved file from an older version falls back to DEFAULTS. */
export function isControls(value: unknown): value is Controls {
  const c = value as Controls;
  return (
    typeof c === "object" &&
    c !== null &&
    PATTERNS.includes(c.pattern) &&
    WAVEFORMS.includes(c.waveform) &&
    FILTERS.includes(c.filter) &&
    typeof c.sweep === "boolean" &&
    typeof c.mute === "boolean" &&
    Number.isFinite(c.frequency) &&
    c.frequency >= MIN_HZ &&
    c.frequency <= MAX_HZ &&
    Number.isFinite(c.levelDb) &&
    c.levelDb >= MIN_DB &&
    c.levelDb <= MAX_DB &&
    Number.isFinite(c.balance) &&
    Math.abs(c.balance) <= 1
  );
}

// #region slider
/**
 * The frequency slider runs 0–1 on a logarithmic scale: equal slider
 * distances are equal musical intervals (20 → 200 Hz takes as much room as
 * 500 → 5000 Hz), which is how we hear pitch.
 */
export const frequencyAt = (position: number) =>
  MIN_HZ * (MAX_HZ / MIN_HZ) ** clamp(position, 0, 1);
export const positionOf = (hz: number) =>
  Math.log(hz / MIN_HZ) / Math.log(MAX_HZ / MIN_HZ);
// #endregion slider

/** Clamp a window value into its range; NaN (a broken callback argument) keeps `fallback`. */
export function bounded(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}
