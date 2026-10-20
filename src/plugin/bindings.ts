/**
 * Binding syntax check, the same rules as the host's `bindings.rs` (the host
 * is authoritative). `commands.add` validates early so a typo fails in the
 * plugin's own tests; the test host uses `canonical` to match `press()`.
 *
 *   binding  = { modifier "+" } input        modifiers in order Ctrl, Alt, Shift, Cmd
 *   input    = key | "Mouse:" mouse
 */
import { failure } from "./runtime.ts";

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Cmd"] as const;
const NAMED = new Set([
  "Space",
  "Enter",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Insert",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Plus",
  // Numeric keypad: never matched by the main keyboard keys, nor they by these.
  ..."0123456789".split("").map((digit) => `Numpad${digit}`),
  "NumpadPlus",
  "NumpadMinus",
  "NumpadMultiply",
  "NumpadDivide",
  "NumpadEnter",
  "NumpadDecimal",
]);
const MOUSE = new Set([
  "LeftDoubleClick",
  "LeftDoubleClick:LeftHalf",
  "LeftDoubleClick:RightHalf",
  "MiddleClick",
  "X1",
  "X2",
  "WheelUp",
  "WheelDown",
  "WheelLeft",
  "WheelRight",
]);

type Kind = "letter" | "digit" | "named" | "symbol" | "mouse";

function kind(input: string): Kind | null {
  if (input.startsWith("Mouse:"))
    return MOUSE.has(input.slice(6)) ? "mouse" : null;
  if (/^[A-Z]$/.test(input)) return "letter";
  if (/^[0-9]$/.test(input)) return "digit";
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(input) || NAMED.has(input))
    return "named";
  // One printable, non-alphanumeric, non-space character; "+" is written Plus.
  if ([...input].length === 1 && /^[^\p{L}\p{N}\s+]$/u.test(input))
    return "symbol";
  return null;
}

/** Throws `invalid` unless `text` is a canonical binding; returns it unchanged. */
export function canonical(text: string): string {
  const parts = text.split("+");
  const input = parts.pop()!;
  const mods = parts;
  let last = -1;
  for (const mod of mods) {
    const index = MODIFIERS.indexOf(mod as (typeof MODIFIERS)[number]);
    if (index < 0)
      throw failure("invalid", `binding ${text}: unknown modifier ${mod}`);
    if (index <= last)
      throw failure(
        "invalid",
        `binding ${text}: modifiers go in the order Ctrl, Alt, Shift, Cmd, once each`,
      );
    last = index;
  }
  const type = kind(input);
  if (!type)
    throw failure("invalid", `binding ${text}: unknown input ${input}`);
  if (mods.includes("Shift") && (type === "symbol" || type === "digit"))
    throw failure(
      "invalid",
      `binding ${text}: write the character Shift produces instead of Shift+${input}`,
    );
  return text;
}

export function checkBindings(bindings: readonly string[]): string[] {
  const seen = new Set<string>();
  for (const binding of bindings) {
    canonical(binding);
    if (seen.has(binding))
      throw failure("invalid", `binding ${binding} is listed twice`);
    seen.add(binding);
  }
  return [...bindings];
}
