/**
 * The blur example's model: the saved settings, the presets, the filter chain
 * and the status line. Pure functions with no player calls, so main.ts stays
 * about wiring and these are easy to test.
 */
import type { FilterStatus, VideoNode } from "@vestra-player/sdk";

// #region settings
/** Everything the plugin remembers in `<dataDirectory>/blur.json`. */
export interface BlurSettings {
  /** Blur is on. */
  enabled: boolean;
  /** Blur strength: the Gaussian sigma, 0–10. */
  sigma: number;
  /** Options page: turn blur back on at startup when it was on at exit. */
  restoreOnStart: boolean;
  /** Options page: show on-screen messages. */
  messages: boolean;
}

export const DEFAULTS: BlurSettings = {
  enabled: false,
  sigma: 4,
  restoreOnStart: false,
  messages: true,
};

/** Accept a saved file only if every field has the right type. */
export function isBlurSettings(value: unknown): value is BlurSettings {
  const v = value as Partial<BlurSettings> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.enabled === "boolean" &&
    typeof v.sigma === "number" &&
    Number.isFinite(v.sigma) &&
    typeof v.restoreOnStart === "boolean" &&
    typeof v.messages === "boolean"
  );
}
// #endregion settings

// #region chain
/** The `gblur` node accepts sigma 0–10; anything else fails with `invalid`. */
export const MAX_SIGMA = 10;

export const clampSigma = (value: number) =>
  Math.min(MAX_SIGMA, Math.max(0, Number.isFinite(value) ? value : 0));

/** The video chain for these settings: one `gblur` node, or none when off. */
export function chain(settings: BlurSettings): VideoNode[] {
  if (!settings.enabled) return [];
  return [{ kind: "gblur", sigma: clampSigma(settings.sigma), steps: 3 }];
}
// #endregion chain

// #region presets
/** The quality presets of the window's drop-down; the last entry is "Custom". */
export const PRESETS = [
  { label: "Light", sigma: 2 },
  { label: "Medium", sigma: 5 },
  { label: "Strong", sigma: 9 },
] as const;

export const PRESET_LABELS = [...PRESETS.map((p) => p.label), "Custom"];

/** The drop-down index for a strength: a preset when it matches, else "Custom". */
export function presetIndex(sigma: number): number {
  const index = PRESETS.findIndex((p) => Math.abs(p.sigma - sigma) < 0.05);
  return index === -1 ? PRESETS.length : index;
}
// #endregion presets

// #region status
/** One line for the window: what the filter is doing right now. */
export function statusLine(
  enabled: boolean,
  status: FilterStatus,
): { status: string; failed: boolean } {
  if (status.state === "failed" && status.error.code === "unsupported")
    return { status: "Not available for generated streams", failed: false };
  if (status.state === "failed")
    return { status: `Failed: ${status.error.message}`, failed: true };
  if (status.state === "waiting")
    return { status: "Waiting for a video to play", failed: false };
  if (status.state === "applying")
    return { status: "Applying…", failed: false };
  return { status: enabled ? "Applied" : "Off", failed: false };
}
// #endregion status

/** "4.0": strengths are shown with one decimal. */
export const formatSigma = (sigma: number) => clampSigma(sigma).toFixed(1);
