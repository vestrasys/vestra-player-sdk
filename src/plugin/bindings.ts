/**
 * Binding syntax check, the same rules as the host's `bindings.rs` (the host
 * is authoritative). `commands.add` validates early so a typo fails in the
 * plugin's own tests; the test host uses `canonical` to match `press()`.
 *
 *   binding  = { modifier "+" } input        modifiers in order Ctrl, Alt, Shift, Cmd
 *   input    = key | "Mouse:" mouse
 */
import { failure } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { BindingRef, Bindings } from "./types.ts";

/**
 * The names a binding (`CommandOptions.bindings`, `Bindings.set`) is made
 * of, as the player's binding parser accepts them. A binding is
 * `{ modifier "+" } input`: modifiers in the order of `modifiers`, each at
 * most once, then one input. An input is a name of `letters`, `digits`,
 * `functionKeys`, `named` or `mouse`, or one other printable character that
 * is not a letter, digit, space or `+` (`">"`, `"["`, `"/"`), written as
 * typed, never with `Shift` (`">"`, not `"Shift+."`; `"!"`, not
 * `"Shift+1"`). Anything else fails with code `invalid`. The player's tests
 * check that these agree with the player.
 *
 * @example Check in a test that the plugin's default keys are well formed
 * The test fails on a binding the player would refuse with `invalid`, such
 * as modifiers out of order or a misspelt key name. `isBinding` applies the
 * same grammar as the player's parser: the part after the last `+` is the
 * input, everything before it modifiers in the order of `modifiers`; an
 * input is a listed name or one other printable character, and `Shift`
 * never goes with a digit or such a character.
 * ```ts
 * import assert from "node:assert/strict";
 * import { BINDING_INPUTS } from "@vestra-player/sdk/testing";
 *
 * const { modifiers, letters, digits, functionKeys, named, mouse } = BINDING_INPUTS;
 * const names = new Set([...letters, ...functionKeys, ...named, ...mouse]);
 * function isBinding(binding: string): boolean {
 *   // "Ctrl++" is not a binding: the + key is written "Plus".
 *   const parts = binding.split("+");
 *   const input = parts.pop()!;
 *   const order = parts.map((m) => (modifiers as readonly string[]).indexOf(m));
 *   // Each modifier known, at most once, in the listed order.
 *   if (order.some((at, i) => at < 0 || (i > 0 && at <= order[i - 1]!)))
 *     return false;
 *   if (names.has(input)) return true; // letters are upper case: "A"
 *   const typed = digits.includes(input) || /^[^\p{L}\p{N}\p{C}\s+]$/u.test(input);
 *   // ">" rather than "Shift+.": the character already says Shift.
 *   return typed && !parts.includes("Shift");
 * }
 * for (const binding of ["Ctrl+Shift+PageUp", "Alt+Mouse:WheelUp", ">"])
 *   assert.ok(isBinding(binding), binding);
 * for (const binding of ["Shift+Ctrl+A", "Ctrl+a", "Shift+."])
 *   assert.ok(!isBinding(binding), binding);
 * ```
 *
 * @since 1.5.14
 */
export const BINDING_INPUTS = Object.freeze({
  /**
   * Modifiers, in the order a binding writes them. `Cmd` is ⌘ on macOS and
   * the Windows logo key on Windows; on macOS `Ctrl` also matches ⌘.
   */
  modifiers: ["Ctrl", "Alt", "Shift", "Cmd"],
  /** Letter keys, by key name whatever the case: `A` to `Z`. */
  letters: [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"],
  /** Digit keys of the main keyboard: `0` to `9`. */
  digits: [..."0123456789"],
  /** Function keys: `F1` to `F24`. */
  functionKeys: Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
  /**
   * Other named keys, matched by the physical key. `Plus` is the `+` key
   * however it is typed; the `Numpad…` names are the numeric keypad only,
   * never the main keyboard.
   */
  named: [
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
    ...Array.from({ length: 10 }, (_, digit) => `Numpad${digit}`),
    "NumpadPlus",
    "NumpadMinus",
    "NumpadMultiply",
    "NumpadDivide",
    "NumpadEnter",
    "NumpadDecimal",
  ],
  /**
   * Mouse inputs on the video area. `:LeftHalf` and `:RightHalf` tell the
   * halves of the video apart for a double click.
   */
  mouse: [
    "Mouse:LeftClick",
    "Mouse:LeftDoubleClick",
    "Mouse:LeftDoubleClick:LeftHalf",
    "Mouse:LeftDoubleClick:RightHalf",
    "Mouse:MiddleClick",
    "Mouse:X1",
    "Mouse:X2",
    "Mouse:WheelUp",
    "Mouse:WheelDown",
    "Mouse:WheelLeft",
    "Mouse:WheelRight",
  ],
} as const satisfies Record<string, readonly string[]>);

const MODIFIERS: readonly string[] = BINDING_INPUTS.modifiers;
const NAMED = new Set<string>([
  ...BINDING_INPUTS.functionKeys,
  ...BINDING_INPUTS.named,
]);
const MOUSE = new Set<string>(BINDING_INPUTS.mouse);
const LETTERS = new Set<string>(BINDING_INPUTS.letters);
const DIGITS = new Set<string>(BINDING_INPUTS.digits);

type Kind = "letter" | "digit" | "named" | "symbol" | "mouse";

function kind(input: string): Kind | null {
  if (input.startsWith("Mouse:")) return MOUSE.has(input) ? "mouse" : null;
  if (LETTERS.has(input)) return "letter";
  if (DIGITS.has(input)) return "digit";
  if (NAMED.has(input)) return "named";
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
    const index = MODIFIERS.indexOf(mod);
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

const reference = (ref: BindingRef): BindingRef => {
  if (
    typeof ref?.plugin !== "string" ||
    typeof ref.command !== "string" ||
    !ref.plugin ||
    !ref.command
  )
    throw failure("invalid", "a binding ref names plugin and command");
  return { plugin: ref.plugin, command: ref.command };
};

/** `plugin.bindings` (`bindings.manage`): the table and the user overlay. */
export const bindingsApi = (scope: ScopeImpl): Bindings => ({
  async list() {
    const table = await scope.runtime.host.bindings.list();
    return {
      commands: table.commands.map((info) => ({
        plugin: info.plugin,
        command: info.command,
        title: info.title,
        path: info.path,
        key: info.key ?? null,
        scope: info.scope,
        defaults: info.defaults,
        current: info.current,
        overridden: info.overridden,
        shadowed: info.shadowed,
        labels: info.labels,
      })),
      orphans: table.orphans,
    };
  },
  async set(ref, inputs) {
    const { plugin, command } = reference(ref);
    if (!Array.isArray(inputs) || inputs.length > 16)
      throw failure("invalid", "inputs is a list of at most 16 bindings");
    await scope.runtime.host.bindings.set(
      plugin,
      command,
      checkBindings(inputs),
    );
  },
  async reset(ref) {
    await scope.runtime.host.bindings.reset(
      ref === undefined ? undefined : reference(ref),
    );
  },
  onChange(listener) {
    const watch = scope.runtime.on(
      "bindings.changed",
      () => scope.run(listener),
      "bindings.manage",
    );
    return scope.add({
      dispose: async () => {
        scope.forget(watch);
        await watch.dispose();
      },
    });
  },
});
