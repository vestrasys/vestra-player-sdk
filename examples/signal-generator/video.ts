/**
 * The picture: three test patterns and a text overlay, drawn into one
 * reusable RGBA buffer.
 */
import { FPS } from "./controls.ts";
import type { Controls, Waveform } from "./controls.ts";
import { GLYPH_HEIGHT, advance, drawNumber, drawText } from "./font.ts";
import type { Surface } from "./font.ts";

// #region pixels
/**
 * A stream frame is `width × height × 4` bytes: R, G, B, A for each pixel,
 * row by row from the top-left corner. Writing four bytes per pixel is
 * slow, so the renderer also views the same memory as a Uint32Array: one
 * element per pixel. On a little-endian CPU (x86-64 and ARM64: every system
 * the player runs on) the first byte in memory is the lowest byte of the
 * number, so a pixel is the number 0xAABBGGRR.
 */
const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
if (!LITTLE_ENDIAN) throw new Error("signal-generator expects a little-endian CPU");

/** An opaque pixel from 0–255 components. `>>> 0` keeps it an unsigned 32-bit number. */
export const rgb = (r: number, g: number, b: number) =>
  (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
// #endregion pixels

const BLACK = rgb(16, 16, 16);
const WHITE = rgb(235, 235, 235);

// #region bars
/**
 * SMPTE-style colour bars (after SMPTE EG 1): seven 75 % bars, a strip of
 * reversed blue bars, then −I, white, +Q, black and a PLUGE (just below,
 * at and just above black). Values are 8-bit approximations for a quick
 * visual check, not a calibration reference.
 */
function colourBars(width: number, height: number): Uint32Array {
  const top = [
    rgb(191, 191, 191), rgb(191, 191, 0), rgb(0, 191, 191), rgb(0, 191, 0),
    rgb(191, 0, 191), rgb(191, 0, 0), rgb(0, 0, 191),
  ];
  const middle = [
    rgb(0, 0, 191), BLACK, rgb(191, 0, 191), BLACK,
    rgb(0, 191, 191), BLACK, rgb(191, 191, 191),
  ];
  // Bottom row in 1/12 bar widths: four blocks of 5/4 bar, three PLUGE
  // steps of 1/3 bar, then one bar of black (84 twelfths = 7 bars).
  const bottom: [number, number][] = [
    [15, rgb(0, 33, 76)], [15, WHITE], [15, rgb(50, 0, 106)], [15, BLACK],
    [4, rgb(7, 7, 7)], [4, BLACK], [4, rgb(25, 25, 25)], [12, BLACK],
  ];
  const bars = new Uint32Array(width * height);
  const topEnd = Math.round((height * 2) / 3);
  const middleEnd = Math.round(height * 0.75);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let color: number;
      if (y < middleEnd) {
        const bar = Math.floor((x * 7) / width);
        color = (y < topEnd ? top : middle)[bar]!;
      } else {
        let twelfth = (x * 84) / width;
        let i = 0;
        while (twelfth >= bottom[i]![0]) twelfth -= bottom[i++]![0];
        color = bottom[i]![1];
      }
      bars[y * width + x] = color;
    }
  }
  return bars;
}
// #endregion bars

const LABELS: Record<Waveform, string> = {
  sine: "SINE",
  square: "SQUARE",
  saw: "SAW",
  noise: "NOISE",
};
const SCOPE_BG = rgb(6, 14, 8);
const SCOPE_GRID = rgb(22, 46, 26);
const SCOPE_AXIS = rgb(40, 84, 46);
const TRACE_LEFT = rgb(80, 255, 120);
const TRACE_RIGHT = rgb(255, 196, 64);

export class Renderer implements Surface {
  /** The bytes handed to the SDK. */
  readonly pixels: Uint8Array;
  /** The same memory, one element per pixel. */
  readonly data: Uint32Array;
  readonly width: number;
  readonly height: number;
  /** The bars never change: draw them once, copy them per frame. */
  readonly #bars: Uint32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
    this.data = new Uint32Array(this.pixels.buffer);
    this.#bars = colourBars(width, height);
  }

  // #region draw
  /** Draw frame number `frame`; `audio` is this frame's interleaved stereo audio. */
  draw(frame: number, audio: Float32Array, controls: Controls, hz: number): void {
    switch (controls.pattern) {
      case "bars":
        this.data.set(this.#bars); // one memcpy: by far the cheapest pattern
        break;
      case "grid":
        this.#grid(frame);
        break;
      case "scope":
        this.#scope(audio);
        break;
    }
    this.#overlay(frame, controls, hz);
  }
  // #endregion draw

  // #region grid
  /** A colour ramp that scrolls, a grid that drifts and a bar that sweeps across every 2 s. */
  #grid(frame: number) {
    const { data, width, height } = this;
    const shift = frame * 4;
    const gridX = (frame * 2) % 40;
    const gridY = frame % 40;
    const barX = Math.floor(((frame % 60) / 60) * width);
    for (let y = 0; y < height; y++) {
      const g = Math.floor((y * 255) / height);
      const row = y * width;
      const onRow = (y + gridY) % 40 === 0;
      for (let x = 0; x < width; x++) {
        let color: number;
        if (x >= barX && x < barX + 8) color = rgb(255, 230, 0);
        else if (onRow || (x + gridX) % 40 === 0) color = rgb(255, 255, 255);
        else {
          const r = (((x + shift) * 255) / width) & 255;
          color = rgb(r, g, 255 - r);
        }
        data[row + x] = color;
      }
    }
  }
  // #endregion grid

  // #region scope
  /**
   * An oscilloscope of this frame's own audio: left channel in the top
   * half, right channel in the bottom half.
   */
  #scope(audio: Float32Array) {
    const { data, width, height } = this;
    data.fill(SCOPE_BG);
    // Graticule: 10 divisions across, centre lines brighter.
    for (let i = 1; i < 10; i++) this.#column(Math.floor((i * width) / 10), 0, height - 1, SCOPE_GRID);
    for (let eighth = 1; eighth < 8; eighth++) {
      const row = Math.floor((eighth * height) / 8) * width;
      // Rows 2/8 and 6/8 are the zero lines of the two traces.
      data.fill(eighth % 4 === 2 ? SCOPE_AXIS : SCOPE_GRID, row, row + width);
    }

    // Trigger: start at the first rising zero crossing in the first half of
    // the frame, so a steady tone stands still instead of drifting.
    const frames = audio.length / 2;
    const span = Math.floor(frames / 2);
    let start = 0;
    for (let i = 1; i < frames - span; i++) {
      const before = audio[2 * i - 2]! + audio[2 * i - 1]!;
      const now = audio[2 * i]! + audio[2 * i + 1]!;
      if (before <= 0 && now > 0) {
        start = i;
        break;
      }
    }
    this.#trace(audio, 0, start, span, height / 4, TRACE_LEFT);
    this.#trace(audio, 1, start, span, (3 * height) / 4, TRACE_RIGHT);
  }

  /**
   * One channel (`channel` 0 = left, 1 = right) of `span` samples from
   * `start`, centred on row `middle`. Each column draws the range between
   * the lowest and highest sample that falls into it, which connects the
   * points and still shows a 5 kHz tone as a filled band.
   */
  #trace(audio: Float32Array, channel: number, start: number, span: number, middle: number, color: number) {
    const { width, height } = this;
    const amplitude = height / 4 - 6;
    for (let x = 0; x < width; x++) {
      const from = start + Math.floor((x * span) / width);
      const to = start + Math.floor(((x + 1) * span) / width); // inclusive: joins the next column
      let low = Infinity;
      let high = -Infinity;
      for (let i = from; i <= to; i++) {
        const value = audio[2 * i + channel]!;
        if (value < low) low = value;
        if (value > high) high = value;
      }
      this.#column(x, Math.round(middle - high * amplitude), Math.round(middle - low * amplitude), color);
    }
  }
  // #endregion scope

  /** A vertical line from row `top` to row `bottom` (inclusive). */
  #column(x: number, top: number, bottom: number, color: number) {
    const { data, width, height } = this;
    for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y++) data[y * width + x] = color;
  }

  /** Halve the brightness of a rectangle so text on it stays readable over any pattern. */
  #shade(x0: number, y0: number, x1: number, y1: number) {
    const { data, width } = this;
    for (let y = y0; y < y1; y++)
      for (let i = y * width + x0; i < y * width + x1; i++)
        data[i] = ((data[i]! >>> 1) & 0x7f7f7f7f) | 0xff000000; // R, G, B / 2; alpha stays 255
  }

  // #region overlay
  /**
   * Top: what the tone is doing ("SINE 1000 HZ -18 DB"). Bottom: the
   * timecode HH:MM:SS:FF and the frame counter. Drawn from numbers digit
   * by digit, so the overlay allocates no strings.
   */
  #overlay(frame: number, controls: Controls, hz: number) {
    const { width, height } = this;
    const white = rgb(255, 255, 255);
    // Top line, scale 2: 12 px per character, 14 px high.
    this.#shade(8, 8, width - 8, 8 + GLYPH_HEIGHT * 2 + 8);
    let x = drawText(this, LABELS[controls.waveform], 16, 12, 2, white);
    if (controls.sweep) x = drawText(this, " SWEEP", x, 12, 2, white);
    x = drawNumber(this, Math.round(hz), 1, x + advance(2), 12, 2, white);
    x = drawText(this, " HZ", x, 12, 2, white);
    if (controls.mute) drawText(this, "  MUTE", x, 12, 2, rgb(255, 80, 80));
    else {
      const db = Math.round(controls.levelDb);
      x = drawText(this, db < 0 ? "  -" : "  ", x, 12, 2, white);
      x = drawNumber(this, Math.abs(db), 1, x, 12, 2, white);
      drawText(this, " DB", x, 12, 2, white);
    }

    // Bottom line: timecode at scale 3, frame counter at scale 2.
    const fps = Math.round(FPS.num / FPS.den); // non-drop-frame timecode
    const seconds = Math.floor(frame / fps);
    const top = height - 8 - GLYPH_HEIGHT * 3 - 8;
    this.#shade(8, top, width - 8, height - 8);
    x = drawNumber(this, Math.floor(seconds / 3600), 2, 16, top + 4, 3, white);
    x = drawText(this, ":", x, top + 4, 3, white);
    x = drawNumber(this, Math.floor(seconds / 60) % 60, 2, x, top + 4, 3, white);
    x = drawText(this, ":", x, top + 4, 3, white);
    x = drawNumber(this, seconds % 60, 2, x, top + 4, 3, white);
    x = drawText(this, ":", x, top + 4, 3, white);
    x = drawNumber(this, frame % fps, 2, x, top + 4, 3, white);
    x = drawText(this, "  FRAME ", x, top + 11, 2, white);
    drawNumber(this, frame, 6, x, top + 11, 2, white);
  }
  // #endregion overlay
}
