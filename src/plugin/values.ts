/** The player's limits on one property value, for {@link TestHost}. */
import type { Json } from "../wire.ts";

/**
 * The player's limits on one property value (a `PropValue` as written
 * by `View.set` or `View.bind`, or an initial property of a
 * window, panel or settings page). The player's tests check that these
 * agree with the player; {@link TestHost} enforces them the same way.
 *
 * A value over a limit is refused whole with code `limit` (the property
 * keeps what it showed) and reported to `Scope.onError`: a write by
 * `View.set` or `View.bind` as described there. As an initial property it
 * makes `Window.show` reject; a panel or settings page opens without it and
 * the failure goes to the plugin's `onError`.
 *
 * They bound the work one write costs the player's interface thread; they
 * are not meant as list sizes to aim for. A list that can grow without
 * bound (a playlist, a history) should send the rows near the view and say
 * how many there are, not the whole list.
 *
 * @example Send a long playlist as a window of rows
 * A list view shows any number of entries while each write stays small:
 * the plugin sends only the rows around the scroll position plus the total,
 * and the view reports where it scrolled to. After the `scrolled` handler
 * returns, the SDK evaluates the `bind` function again and sends the new
 * window. Each row object and each of its fields count as one value toward
 * `values`, and so does the array holding them.
 * ```ts
 * declare const entries: { title: string; duration: number }[];
 * import type { View } from "@vestra-player/sdk";
 * declare const list: View;
 * // ---cut---
 * import { UI_VALUE_LIMITS } from "@vestra-player/sdk/testing";
 *
 * // 200 rows, or fewer if the limits were smaller: 2 fields per row make
 * // 3 values (the row and its fields), plus 1 for the array.
 * const size = Math.min(
 *   200,
 *   UI_VALUE_LIMITS.arrayRows,
 *   Math.floor((UI_VALUE_LIMITS.values - 1) / 3),
 * );
 * let first = 0;
 * list.bind(() => ({
 *   total: entries.length,
 *   rows: entries.slice(first, first + size),
 * }));
 * // The Slint view reports its first visible row; the window follows it.
 * list.on("scrolled", (row: number) => {
 *   first = Math.max(0, row - Math.floor(size / 2));
 * });
 * ```
 *
 * @since 1.5.10
 */
export const UI_VALUE_LIMITS = {
  /** Nesting depth; the value itself is depth 0 (8). */
  depth: 8,
  /**
   * Values in all, counting every array, object, string, number, boolean
   * and null, the value itself included; a Markdown document is one
   * (16384).
   */
  values: 16384,
  /** Rows of one array (4096). */
  arrayRows: 4096,
  /** UTF-8 bytes of one string or object field name (64 KiB). */
  stringBytes: 64 * 1024,
  /**
   * UTF-8 bytes of all strings and field names together, the text of the
   * value's Markdown documents included (1 MiB).
   */
  textBytes: 1024 * 1024,
} as const;

const L = UI_VALUE_LIMITS;
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const isObject = (value: Json): value is { [key: string]: Json } =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Text of a Markdown document in wire form, or `null` for other JSON. */
function documentText(value: Json): string | null {
  if (!isObject(value)) return null;
  const doc = value.$vestraMarkdown;
  return isObject(doc) && typeof doc.text === "string" ? doc.text : null;
}

/**
 * The player's runtime image limits (`host/src/ui_image.rs`): a file's
 * bytes and sides, the decoded pixels each plugin caches, and (SDK 1.5.19,
 * player 0.5.1) the decoded pixels the nested images of one view may show.
 */
export const IMAGE_LIMITS = Object.freeze({
  /** The largest image file the player reads, in bytes. */
  fileBytes: 16 * 1024 * 1024,
  /** The longest side, in pixels, the player accepts for an image file. */
  side: 4096,
  /** The decoded pixel bytes the player caches for each plugin's images. */
  pluginBytes: 64 * 1024 * 1024,
  /** The decoded pixel bytes the nested images of one view may show (player 0.5.1). */
  viewBytes: 32 * 1024 * 1024,
});

/**
 * Why the player would refuse `value` (in wire form) as a property value,
 * or `null`. The same checks, order and messages as the player's
 * conversion (`host/src/ui_values.rs`). An image reference as the whole
 * value is not counted (the player loads it instead).
 */
export function valueLimitProblem(value: Json): string | null {
  if (isObject(value) && "$vestraImage" in value) return null;
  const budget = { values: 0, text: 0 };
  const text = (s: string) => {
    const n = bytes(s);
    if (n > L.stringBytes)
      return `UI string or field name exceeds ${L.stringBytes} bytes`;
    if (budget.text + n > L.textBytes)
      return `UI value text exceeds ${L.textBytes} total bytes`;
    budget.text += n;
    return null;
  };
  const walk = (value: Json, depth: number): string | null => {
    if (depth > L.depth)
      return `UI value depth exceeds ${L.depth} (root is depth 0)`;
    if (budget.values === L.values)
      return `UI value exceeds ${L.values} total nodes`;
    budget.values += 1;
    // An image (nested from SDK 1.5.19) is one value, like a document.
    if (isObject(value) && "$vestraImage" in value) return null;
    const doc = documentText(value);
    if (doc !== null) {
      const n = bytes(doc);
      if (budget.text + n > L.textBytes)
        return `UI value text exceeds ${L.textBytes} total bytes`;
      budget.text += n;
      return null;
    }
    if (typeof value === "string") return text(value);
    if (Array.isArray(value)) {
      if (value.length > L.arrayRows)
        return `UI array exceeds ${L.arrayRows} rows`;
      if (value.length > L.values - budget.values)
        return "UI array cannot fit in remaining node budget";
      for (const item of value) {
        const problem = walk(item, depth + 1);
        if (problem) return problem;
      }
      return null;
    }
    if (isObject(value)) {
      const entries = Object.entries(value);
      if (entries.length > L.values - budget.values)
        return "UI object cannot fit in remaining node budget";
      for (const [name, item] of entries) {
        const problem = text(name) ?? walk(item, depth + 1);
        if (problem) return problem;
      }
    }
    return null;
  };
  return walk(value, 0);
}
