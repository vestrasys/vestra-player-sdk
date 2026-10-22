/**
 * The tone generator: a phase-accumulator oscillator that writes
 * interleaved stereo float samples into a buffer it is given.
 */
import { MAX_HZ, MIN_HZ, SAMPLE_RATE } from "./controls.ts";
import type { Controls, Waveform } from "./controls.ts";

/** A full sweep from MIN_HZ to MAX_HZ takes this many seconds. */
export const SWEEP_SECONDS = 10;
/**
 * The sweep is exponential: every sample multiplies the frequency by the
 * same factor, so each octave takes the same time.
 */
const SWEEP_STEP = (MAX_HZ / MIN_HZ) ** (1 / (SWEEP_SECONDS * SAMPLE_RATE));

/** dBFS to a linear amplitude factor: −6 dB ≈ 0.5, −20 dB = 0.1. */
export const gainOf = (db: number) => 10 ** (db / 20);

// #region oscillator
export class Oscillator {
  /** Position inside the current cycle, 0 ≤ phase < 1. Survives every control change. */
  #phase = 0;
  /** The channel gains reached at the end of the previous buffer. */
  #left = 0;
  #right = 0;
  /** The sweep's current frequency. */
  #sweepHz = MIN_HZ;
  /** The frequency of the last sample written, for the overlay. */
  #hz = MIN_HZ;
  /** xorshift32 state for the noise waveform (deterministic, allocation-free). */
  #seed = 0x9e3779b9;

  /** The frequency the oscillator is producing now, in Hz. */
  get frequency() {
    return this.#hz;
  }

  /**
   * Write `frames` stereo sample frames (2 × `frames` floats, L R L R …) into
   * `out`, continuing exactly where the previous call stopped.
   */
  render(out: Float32Array, frames: number, controls: Controls): void {
    // Target channel gains: level, mute and balance all end up here.
    const gain = controls.mute ? 0 : gainOf(controls.levelDb);
    const left = gain * Math.min(1, 1 - controls.balance);
    const right = gain * Math.min(1, 1 + controls.balance);
    // Ramp from the previous gains to the targets across this buffer.
    const leftStep = (left - this.#left) / frames;
    const rightStep = (right - this.#right) / frames;
    const wave = controls.waveform;
    const sweep = controls.sweep;
    let hz = sweep ? this.#sweepHz : controls.frequency;
    let phase = this.#phase;
    let l = this.#left;
    let r = this.#right;
    for (let i = 0; i < frames; i++) {
      const value = this.#sample(wave, phase);
      l += leftStep;
      r += rightStep;
      out[2 * i] = value * l;
      out[2 * i + 1] = value * r;
      // Advance by one sample's worth of cycles; wrap to stay in [0, 1).
      phase += hz / SAMPLE_RATE;
      if (phase >= 1) phase -= 1;
      if (sweep) {
        hz *= SWEEP_STEP;
        if (hz >= MAX_HZ) hz = MIN_HZ;
      }
    }
    this.#phase = phase;
    this.#left = left; // exactly the target: no rounding drift between buffers
    this.#right = right;
    this.#hz = hz;
    if (sweep) this.#sweepHz = hz;
    else this.#sweepHz = MIN_HZ; // turning sweep on starts at the bottom
  }

  /** One sample of `wave` at `phase`, in −1…1. */
  #sample(wave: Waveform, phase: number): number {
    switch (wave) {
      case "sine":
        return Math.sin(2 * Math.PI * phase);
      case "square":
        return phase < 0.5 ? 1 : -1;
      case "saw":
        return 2 * phase - 1;
      case "noise": {
        // xorshift32: three shifts and xors give a full-period 32-bit sequence.
        let x = this.#seed;
        x ^= x << 13;
        x ^= x >>> 17;
        x ^= x << 5;
        this.#seed = x >>> 0;
        return this.#seed / 0x80000000 - 1;
      }
    }
  }
}
// #endregion oscillator
