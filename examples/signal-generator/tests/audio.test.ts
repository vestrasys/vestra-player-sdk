// The oscillator on its own: waveform shapes, levels, balance, and no clicks.
import assert from "node:assert/strict";
import test from "node:test";
import { Oscillator, SWEEP_SECONDS, gainOf } from "../audio.ts";
import { DEFAULTS, MAX_HZ, MIN_HZ, SAMPLE_RATE } from "../controls.ts";
import type { Controls } from "../controls.ts";
import { rms } from "./harness.ts";

const FRAME = 1600; // one 30 fps frame
const controls = (patch: Partial<Controls> = {}): Controls => ({
  ...DEFAULTS,
  frequency: 1000,
  levelDb: 0,
  ...patch,
});

/** Render `seconds` of audio in frame-sized blocks, the way the stream does. */
function render(oscillator: Oscillator, c: Controls, seconds: number) {
  const out = new Float32Array(2 * SAMPLE_RATE * seconds);
  const block = new Float32Array(2 * FRAME);
  for (let offset = 0; offset < out.length; offset += block.length) {
    oscillator.render(block, FRAME, c);
    out.set(block, offset);
  }
  return out;
}

/** Steady state: drop the first frame, where the gain ramps up from silence. */
const steady = (audio: Float32Array) => audio.subarray(2 * FRAME);

// #region waveform
test("a 1 kHz sine crosses zero upwards 1000 times a second at RMS 1/√2", () => {
  const audio = render(new Oscillator(), controls(), 1);
  let rising = 0;
  for (let i = 2; i < audio.length; i += 2)
    if (audio[i - 2]! <= 0 && audio[i]! > 0) rising++;
  assert.ok(Math.abs(rising - 1000) <= 1, `${rising} rising zero crossings`);
  assert.ok(Math.abs(rms(steady(audio), 0) - Math.SQRT1_2) < 1e-3);
  assert.deepEqual(
    rms(steady(audio), 0),
    rms(steady(audio), 1),
    "centred: both channels equal",
  );
});
// #endregion waveform

test("square, saw and noise have their textbook RMS and stay within ±1", () => {
  const expected = {
    square: 1,
    saw: 1 / Math.sqrt(3),
    noise: 1 / Math.sqrt(3),
  };
  for (const [waveform, value] of Object.entries(expected)) {
    const audio = steady(
      render(
        new Oscillator(),
        controls({ waveform: waveform as Controls["waveform"] }),
        1,
      ),
    );
    assert.ok(
      Math.abs(rms(audio, 0) - value) < 0.01,
      `${waveform}: ${rms(audio, 0)}`,
    );
    assert.ok(
      audio.every((v) => Math.abs(v) <= 1),
      `${waveform} within ±1`,
    );
  }
});

test("level is in dBFS, mute ramps to silence, balance attenuates the other side", () => {
  const level = steady(
    render(new Oscillator(), controls({ levelDb: -20 }), 0.5),
  );
  assert.ok(
    Math.abs(rms(level, 0) - 0.1 * Math.SQRT1_2) < 1e-4,
    "−20 dB = 0.1 × amplitude",
  );
  assert.ok(Math.abs(gainOf(-6) - 0.501) < 1e-3);

  const muted = steady(render(new Oscillator(), controls({ mute: true }), 0.5));
  assert.ok(muted.every((v) => v === 0));

  const left = steady(render(new Oscillator(), controls({ balance: -1 }), 0.5));
  assert.equal(rms(left, 1), 0, "right silent");
  assert.ok(Math.abs(rms(left, 0) - Math.SQRT1_2) < 1e-3, "left at full level");
});

// #region continuity
test("changing frequency or level mid-stream never jumps (no clicks)", () => {
  const oscillator = new Oscillator();
  const block = new Float32Array(2 * FRAME);
  const c = controls({ frequency: 440 });
  let previous = 0;
  let worst = 0;
  const run = () => {
    oscillator.render(block, FRAME, c);
    for (let i = 0; i < block.length; i += 2) {
      worst = Math.max(worst, Math.abs(block[i]! - previous));
      previous = block[i]!;
    }
  };
  for (let i = 0; i < 4; i++) run();
  c.frequency = 2000; // phase continues: only the step per sample grows
  run();
  c.levelDb = -40; // gain glides across one frame
  run();
  c.levelDb = 0;
  run();
  // A 2 kHz sine at full scale moves at most 2π·2000/48000 ≈ 0.26 per sample.
  // A restarted phase or an instant gain change would jump by up to 2.
  assert.ok(
    worst < (2 * Math.PI * 2000) / SAMPLE_RATE + 0.01,
    `largest step ${worst}`,
  );
});
// #endregion continuity

test("the sweep glides from 20 Hz to 5 kHz in 10 s and starts again", () => {
  const oscillator = new Oscillator();
  const block = new Float32Array(2 * FRAME);
  const c = controls({ sweep: true });
  const frames = (SWEEP_SECONDS * SAMPLE_RATE) / FRAME;
  let highest = 0;
  for (let i = 0; i < frames - 1; i++) {
    oscillator.render(block, FRAME, c);
    highest = Math.max(highest, oscillator.frequency);
  }
  assert.ok(highest > MAX_HZ * 0.95 && highest < MAX_HZ, `reached ${highest}`);
  oscillator.render(block, FRAME, c);
  oscillator.render(block, FRAME, c);
  assert.ok(oscillator.frequency < MIN_HZ * 1.1, "wrapped to the bottom");
});
