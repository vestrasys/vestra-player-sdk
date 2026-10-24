/**
 * Signal generator: Open ▸ Signal generator plays colour bars and a 1 kHz
 * sine tone that this plugin generates; choosing it again stops them.
 * Walkthrough: docs/examples/signal-generator.md.
 */
// #region format
import type { Plugin, Stream, StreamFrame } from "@vestra-player/sdk";

export const WIDTH = 640;
export const HEIGHT = 360;
/** 29.97 fps, the NTSC frame rate: 48000 / FPS is not a whole number. */
export const FPS = 30000 / 1001;
/** Every stream's audio is 48 kHz stereo, 32-bit float. */
const SAMPLE_RATE = 48000;
const FREQUENCY = 1000; // Hz
const LEVEL = 0.25; // amplitude, −12 dBFS
// #endregion format

// #region bars
/** Seven vertical 75 % colour bars as RGBA bytes, row by row from the top left. */
function colourBars(): Uint8Array {
  const colours: [number, number, number][] = [
    [191, 191, 191], // grey
    [191, 191, 0], // yellow
    [0, 191, 191], // cyan
    [0, 191, 0], // green
    [191, 0, 191], // magenta
    [191, 0, 0], // red
    [0, 0, 191], // blue
  ];
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const [r, g, b] = colours[Math.floor((x * 7) / WIDTH)]!;
      const i = (y * WIDTH + x) * 4; // the first byte of pixel (x, y)
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = 255; // alpha: opaque
    }
  }
  return pixels;
}
// #endregion bars

// #region frame
const video = colourBars(); // the picture never changes: draw it once
/** Room for the longest frame: 1602 stereo samples. */
const audio = new Float32Array(2 * Math.ceil(SAMPLE_RATE / FPS));
let owed = 0; // the fraction of a sample carried over to the next frame
let phase = 0; // position in the current sine cycle, 0 ≤ phase < 1

/** The `frame` callback of openStream: one picture and its audio. */
export function frame(): StreamFrame {
  // 48000 / 29.97 = 1601.6 samples: 1601 or 1602, never drifting.
  owed += SAMPLE_RATE / FPS;
  const samples = Math.floor(owed);
  owed -= samples;

  for (let i = 0; i < samples; i++) {
    const value = LEVEL * Math.sin(2 * Math.PI * phase);
    audio[2 * i] = value; // left
    audio[2 * i + 1] = value; // right
    phase += FREQUENCY / SAMPLE_RATE;
    if (phase >= 1) phase -= 1;
  }
  return { video, audio: audio.subarray(0, 2 * samples) };
}
// #endregion frame

// #region start-stop
export default function activate(plugin: Plugin) {
  let stream: Stream | undefined; // the running stream
  let starting = false;

  async function start() {
    starting = true;
    try {
      stream = await plugin.player.openStream({
        width: WIDTH,
        height: HEIGHT,
        frame, // the player calls it whenever it needs the next frame
      });
      // Another source replaced the stream, or it failed.
      stream.onStop(() => (stream = undefined));
    } finally {
      starting = false;
    }
  }

  async function stop() {
    const running = stream;
    stream = undefined;
    await running?.stop();
  }
  // #endregion start-stop

  // #region command
  plugin.commands.add({
    id: "signal-generator",
    path: ["@open", "Signal generator"], // the player's Open menu, in any language
    checked: () => stream !== undefined,
    run: () => {
      if (starting) return;
      return stream ? stop() : start();
    },
  });
  // #endregion command
}
