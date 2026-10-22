/**
 * The `frame()` side of the stream: one call = one video frame plus the
 * audio that plays while it is on screen.
 */
import type { StreamFrame } from "@vestra-player/sdk";
import { Oscillator } from "./audio.ts";
import { FPS, HEIGHT, SAMPLE_RATE, WIDTH } from "./controls.ts";
import type { Controls } from "./controls.ts";
import { Renderer } from "./video.ts";

// #region clock
/**
 * How many audio sample frames go with each video frame.
 *
 * The stream's timeline is its audio: the player plays the samples at
 * 48 kHz and shows each picture when the audio reaches it. So a frame that
 * carries 1600 samples lasts 1600 / 48000 s = 1/30 s. When 48000 / fps is
 * not a whole number (29.97 fps needs 1601.6), the frames alternate between
 * 1601 and 1602 samples so that the total never drifts from the exact time.
 */
export class FrameClock {
  /** Index of the next frame. */
  #frame = 0;
  readonly #num: number;
  readonly #den: number;
  constructor(fps: { num: number; den: number }) {
    this.#num = fps.num;
    this.#den = fps.den;
  }
  /** The exact sample at which frame `n` starts, rounded down. */
  #start(n: number) {
    return Math.floor((n * SAMPLE_RATE * this.#den) / this.#num);
  }
  /** Fewest and most samples a frame can carry (equal for 30 fps). */
  get min() {
    return Math.floor((SAMPLE_RATE * this.#den) / this.#num);
  }
  get max() {
    return Math.ceil((SAMPLE_RATE * this.#den) / this.#num);
  }
  /** Frames handed out so far. */
  get count() {
    return this.#frame;
  }
  /** Take the next frame: returns its sample count. */
  next(): number {
    const n = this.#frame++;
    return this.#start(n + 1) - this.#start(n);
  }
}
// #endregion clock

// #region generator
export class SignalGenerator {
  readonly #clock = new FrameClock(FPS);
  readonly #oscillator = new Oscillator();
  readonly #renderer = new Renderer(WIDTH, HEIGHT);
  /** Two views of one buffer, for the two possible frame lengths. */
  readonly #short: Float32Array;
  readonly #long: Float32Array;
  /** The object handed to the SDK, reused for every frame. */
  readonly #out: StreamFrame;
  /** Read on every frame; the control window edits it in place. */
  readonly controls: Controls;

  constructor(controls: Controls) {
    this.controls = controls;
    const audio = new Float32Array(2 * this.#clock.max);
    this.#short = audio.subarray(0, 2 * this.#clock.min);
    this.#long = audio;
    this.#out = { video: this.#renderer.pixels, audio: this.#long };
  }

  /** Frames produced so far. */
  get frames() {
    return this.#clock.count;
  }

  /** The `frame` callback of `openStream`. Allocates nothing. */
  frame(): StreamFrame {
    const index = this.#clock.count; // this frame's number, for the timecode
    const samples = this.#clock.next();
    const audio = samples === this.#clock.min ? this.#short : this.#long;
    // Audio first: the oscilloscope draws the samples of this very frame.
    this.#oscillator.render(audio, samples, this.controls);
    this.#renderer.draw(
      index,
      audio,
      this.controls,
      this.#oscillator.frequency,
    );
    this.#out.audio = audio;
    return this.#out;
  }
}
// #endregion generator
