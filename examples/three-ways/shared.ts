/**
 * What the three styles share: the speed steps, a stand-in emulator that
 * makes 60 frames a second, the list's rows and the player's form of a
 * command declaration (style C). Walkthrough: docs/tutorial/index.md.
 */
import type { StreamFrame } from "@vestra-player/sdk";

// #region speed
const RATES = [0.5, 1, 1.5, 2];
/** The speed after `rate` when cycling: 0.5 → 1 → 1.5 → 2 → 0.5. */
export const nextRate = (rate: number) =>
  RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
/** The panel's text for a speed: "1.50×". */
export const speedText = (rate: number) => `${rate.toFixed(2)}×`;
// #endregion speed

/** The emulator's picture size and frame rate. */
export const WIDTH = 256;
export const HEIGHT = 240;
export const FPS = 60;

/**
 * A stand-in for an emulator core (VestraNES runs a NES core the same
 * way): each `step()` runs one frame and returns its picture and sound.
 */
export class Emulator {
  /** Frames run since the start. */
  frame = 0;
  readonly #video = new Uint8Array(WIDTH * HEIGHT * 4).fill(255);
  /** One frame of silence: 48000 / 60 = 800 stereo samples. */
  readonly #audio = new Float32Array((2 * 48000) / FPS);

  step(): StreamFrame {
    this.frame++;
    const shade = this.frame % 256; // the picture fades from black to white
    const video = this.#video;
    for (let i = 0; i < video.length; i += 4)
      video[i] = video[i + 1] = video[i + 2] = shade; // alpha stays 255
    return { video: this.#video, audio: this.#audio };
  }

  /** The status line: what the window shows. */
  status() {
    return `Frame ${this.frame} · ${FPS} fps`;
  }
}

/** One row of the long list (a type, so it is a JSON value). */
export type Entry = { id: string; label: string; played: boolean };
/** The long list's length. */
export const LIST_SIZE = 20_000;
/** `count` rows, each with a unique `id`, none played. */
export const entries = (count: number): Entry[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    label: `Entry ${i + 1}`,
    played: false,
  }));

/**
 * A command declaration in the player's own form, for
 * `plugin.wire.commands.register` (style C): what `commands.add` builds
 * from its options.
 */
export const declaration = (path: string[], bindings: string[] = []) => ({
  title: path.at(-1)!,
  path,
  order: 0,
  group: "domain",
  radio: false,
  bindings,
  focus: null,
  repeat: false,
});
