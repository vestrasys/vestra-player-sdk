/**
 * A tiny 5×7 bitmap font: digits, a few symbols and the capitals the
 * overlay needs. No font files, no dependencies, no allocation per call.
 */

/** A picture to draw on: one packed RGBA pixel per element (see video.ts). */
export interface Surface {
  readonly data: Uint32Array;
  readonly width: number;
  readonly height: number;
}

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;

// #region glyphs
/**
 * Seven rows per glyph, top to bottom; bit 4 is the leftmost column.
 * "0" for example:
 *
 *     0x0e  . # # # .
 *     0x11  # . . . #
 *     0x13  # . . # #
 *     0x15  # . # . #
 *     0x19  # # . . #
 *     0x11  # . . . #
 *     0x0e  . # # # .
 */
const GLYPHS: Record<string, readonly number[]> = {
  "0": [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  "1": [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  "2": [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  "3": [0x1f, 0x02, 0x04, 0x02, 0x01, 0x11, 0x0e],
  "4": [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  "5": [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  "6": [0x06, 0x08, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  "7": [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  "8": [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  "9": [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x02, 0x0c],
  ":": [0x00, 0x0c, 0x0c, 0x00, 0x0c, 0x0c, 0x00],
  ".": [0x00, 0x00, 0x00, 0x00, 0x00, 0x0c, 0x0c],
  "-": [0x00, 0x00, 0x00, 0x1f, 0x00, 0x00, 0x00],
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x11, 0x19, 0x15, 0x13, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x15, 0x0a],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
};

/** The same table indexed by character code, so drawing never builds strings. */
const FONT: (readonly number[] | undefined)[] = [];
for (const [char, rows] of Object.entries(GLYPHS))
  FONT[char.charCodeAt(0)] = rows;
// #endregion glyphs

/** Horizontal distance from one character to the next: glyph plus one column. */
export const advance = (scale: number) => (GLYPH_WIDTH + 1) * scale;

// #region draw
/** Draw one character with its top-left corner at (x, y); unknown characters draw nothing. */
export function drawChar(
  surface: Surface,
  code: number,
  x: number,
  y: number,
  scale: number,
  color: number,
): void {
  const rows = FONT[code];
  if (!rows) return; // a space, or a glyph this font does not have
  const { data, width, height } = surface;
  for (let row = 0; row < GLYPH_HEIGHT; row++) {
    const bits = rows[row]!;
    for (let column = 0; column < GLYPH_WIDTH; column++) {
      if (!(bits & (0x10 >> column))) continue;
      // Each font pixel becomes a scale × scale block.
      for (let dy = 0; dy < scale; dy++) {
        const py = y + row * scale + dy;
        if (py < 0 || py >= height) continue;
        const start = Math.max(0, x + column * scale);
        const end = Math.min(width, x + (column + 1) * scale);
        if (start < end) data.fill(color, py * width + start, py * width + end);
      }
    }
  }
}

/** Draw `text` (a string literal: no allocation) and return the x after it. */
export function drawText(
  surface: Surface,
  text: string,
  x: number,
  y: number,
  scale: number,
  color: number,
): number {
  for (let i = 0; i < text.length; i++) {
    drawChar(surface, text.charCodeAt(i), x, y, scale, color);
    x += advance(scale);
  }
  return x;
}

/**
 * Draw a non-negative integer, zero-padded to at least `digits` digits,
 * without turning it into a string first. Returns the x after it.
 */
export function drawNumber(
  surface: Surface,
  value: number,
  digits: number,
  x: number,
  y: number,
  scale: number,
  color: number,
): number {
  let n = Math.max(0, Math.floor(value));
  let count = 1;
  for (let rest = Math.floor(n / 10); rest > 0; rest = Math.floor(rest / 10))
    count++;
  count = Math.max(count, digits);
  // Right to left: the last digit is n % 10, then n / 10 % 10, …
  for (let i = count - 1; i >= 0; i--) {
    drawChar(surface, 48 + (n % 10), x + i * advance(scale), y, scale, color); // 48 = "0"
    n = Math.floor(n / 10);
  }
  return x + count * advance(scale);
}
// #endregion draw
