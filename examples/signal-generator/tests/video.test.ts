// The picture: pixel layout, colour bars, the bitmap font and the oscilloscope.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS } from "../controls.ts";
import { GLYPH_HEIGHT, drawNumber, drawText } from "../font.ts";
import { Renderer, rgb } from "../video.ts";
import { pixel } from "./harness.ts";

const W = 640;
const H = 360;
const silence = new Float32Array(2 * 1600);

test("rgb() packs a pixel so that its bytes read R, G, B, A", () => {
  const renderer = new Renderer(4, 1);
  renderer.data[1] = rgb(10, 20, 30);
  assert.deepEqual([...renderer.pixels.subarray(4, 8)], [10, 20, 30, 255]);
});

test("colour bars: 75 % white on the left, blue on the right, then the reverse strip", () => {
  const renderer = new Renderer(W, H);
  renderer.draw(0, silence, { ...DEFAULTS, pattern: "bars" }, 1000);
  assert.deepEqual(pixel(renderer.pixels, W, 20, 100), [191, 191, 191, 255]);
  assert.deepEqual(pixel(renderer.pixels, W, W - 20, 100), [0, 0, 191, 255]);
  assert.deepEqual(
    pixel(renderer.pixels, W, 20, 255),
    [0, 0, 191, 255],
    "reverse blue strip",
  );
  assert.deepEqual(
    pixel(renderer.pixels, W, 150, 300),
    [235, 235, 235, 255],
    "100 % white in the bottom row",
  );
  // The timecode box (from row 323) halves what is under it.
  assert.deepEqual(
    pixel(renderer.pixels, W, 150, 324),
    [117, 117, 117, 255],
    "shaded white",
  );
});

test("drawText draws the 5×7 glyphs scaled; unknown characters draw nothing", () => {
  const surface = { data: new Uint32Array(40 * 10), width: 40, height: 10 };
  const white = rgb(255, 255, 255);
  const end = drawText(surface, "1?", 0, 0, 1, white);
  assert.equal(end, 12, "two characters, 6 px each");
  // "1": top row 0x04 = only the middle column.
  const row = (y: number) =>
    [...surface.data.subarray(y * 40, y * 40 + 12)]
      .map((p) => (p ? "#" : "."))
      .join("");
  assert.equal(row(0), "..#.........");
  assert.equal(row(GLYPH_HEIGHT - 1), ".###........");
  assert.equal(
    drawNumber(surface, 7, 3, 0, 0, 1, white),
    18,
    "zero-padded to three digits",
  );
});

test("the oscilloscope draws the frame's own left channel in the top half", () => {
  const renderer = new Renderer(W, H);
  // A full-scale square wave on the left, silence on the right.
  const audio = new Float32Array(2 * 1600);
  for (let i = 0; i < 1600; i++)
    audio[2 * i] = Math.floor(i / 100) % 2 ? -1 : 1;
  renderer.draw(0, audio, { ...DEFAULTS, pattern: "scope" }, 1000);
  const trace = rgb(80, 255, 120);
  const column = (x: number) => {
    const rows: number[] = [];
    for (let y = 0; y < H / 2; y++)
      if (renderer.data[y * W + x] === trace) rows.push(y);
    return rows;
  };
  // Amplitude H/4 − 6 = 84 px around row 90: +1 at row 6, −1 at row 174.
  const tops = new Set<number>();
  for (let x = 0; x < W; x++) for (const y of column(x)) tops.add(y);
  assert.ok(tops.has(6) && tops.has(174), "both extremes drawn");
  const right = rgb(255, 196, 64);
  assert.ok(
    renderer.data.subarray(W * 270, W * 271).includes(right),
    "silent right channel: flat line at its centre",
  );
});
