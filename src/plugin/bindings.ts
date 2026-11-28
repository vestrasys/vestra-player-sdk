/**
 * Binding syntax check, the same rules as the host's `bindings.rs` (the host
 * is authoritative). `commands.add` validates early so a typo fails in the
 * plugin's own tests; the test host uses `canonical` to match `press()`.
 *
 *   binding  = { modifier "+" } input        modifiers in order Ctrl, Alt, Shift, Cmd
 *   input    = key | "Mouse:" mouse | media | "Gamepad:" gamepad
 *
 * Media keys and gamepad inputs take no modifiers.
 */
import { failure } from "./errors.ts";
import type { ScopeImpl } from "./scope.ts";
import type { BindingRef, Bindings } from "./types.ts";

/**
 * The names a binding (`CommandOptions.bindings`, `Bindings.set`) is made
 * of, as the player's binding parser accepts them. A binding is
 * `{ modifier "+" } input`: modifiers in the order of `modifiers`, each at
 * most once, then one input. An input is a name of `letters`, `digits`,
 * `functionKeys`, `named`, `mouse`, `media` or `gamepad`, or one other
 * printable character that is not a letter, digit, space or `+` (`">"`,
 * `"["`, `"/"`), written as typed, never with `Shift` (`">"`, not
 * `"Shift+."`; `"!"`, not `"Shift+1"`). A `media` or `gamepad` input
 * takes no modifiers (`"Gamepad:A"`, never `"Ctrl+Gamepad:A"`). Anything
 * else fails with code `invalid`. The player's tests check that these
 * agree with the player.
 *
 * Menus and tooltips show no media, gamepad or mouse binding as a
 * command's shortcut (`plugin.commands.keys` lists none of them). In the
 * options window, where keys reach no command, a media key or gamepad
 * input arrives at the focused element as a Slint key event whose text is
 * U+F7FF followed by its name (`"Gamepad:A"`), so that a
 * settings page's `FocusScope` can record it; a text field ignores it.
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
 * const { modifiers, letters, digits, functionKeys, named, mouse, media, gamepad } =
 *   BINDING_INPUTS;
 * const names = new Set([...letters, ...functionKeys, ...named, ...mouse]);
 * // Media keys and gamepad inputs stand alone: no modifiers.
 * const devices = new Set<string>([...media, ...gamepad]);
 * function isBinding(binding: string): boolean {
 *   // "Ctrl++" is not a binding: the + key is written "Plus".
 *   const parts = binding.split("+");
 *   const input = parts.pop()!;
 *   if (devices.has(input)) return parts.length === 0;
 *   const order = parts.map((m) => (modifiers as readonly string[]).indexOf(m));
 *   // Each modifier known, at most once, in the listed order.
 *   if (order.some((at, i) => at < 0 || (i > 0 && at <= order[i - 1]!)))
 *     return false;
 *   if (names.has(input)) return true; // letters are upper case: "A"
 *   const typed = digits.includes(input) || /^[^\p{L}\p{N}\p{C}\s+]$/u.test(input);
 *   // ">" rather than "Shift+.": the character already says Shift.
 *   return typed && !parts.includes("Shift");
 * }
 * for (const binding of ["Ctrl+Shift+PageUp", "Alt+Mouse:WheelUp", ">", "Gamepad:A"])
 *   assert.ok(isBinding(binding), binding);
 * for (const binding of ["Shift+Ctrl+A", "Ctrl+a", "Shift+.", "Ctrl+Gamepad:A"])
 *   assert.ok(!isBinding(binding), binding);
 * ```
 *
 * @since 1.5.14
 *
 * @category Testing
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
   * Mouse inputs on the video area; the side buttons `Mouse:X1` (back) and
   * `Mouse:X2` (forward) anywhere in the main window or the floating sidebar
   * window, except while a menu is open. `:LeftHalf` and `:RightHalf` tell the
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
  /**
   * Media keys, while a player window has the focus: wherever the focus is
   * in the window, except while a menu is open. No modifiers. On macOS the
   * system gives media keys to its Now Playing session, so the player
   * receives none there today.
   * @since 1.12.0
   */
  media: ["MediaPlayPause", "MediaNext", "MediaPrevious", "MediaStop"],
  /**
   * Gamepad inputs, from any connected controller while a player window
   * has the focus, except while a menu is open. By position with Xbox
   * names, as SDL and mpv name them: `A` is the bottom face button, `Back`
   * the left centre button (View, Select, Share), `LeftShoulder` the upper
   * and `LeftTrigger` the lower left button, `LeftStick` a press of the
   * stick; a stick direction fires past half its travel. A held input
   * repeats like a held key (for commands with `repeat`). No modifiers.
   * @since 1.12.0
   */
  gamepad: [
    "Gamepad:A",
    "Gamepad:B",
    "Gamepad:X",
    "Gamepad:Y",
    "Gamepad:DpadUp",
    "Gamepad:DpadDown",
    "Gamepad:DpadLeft",
    "Gamepad:DpadRight",
    "Gamepad:LeftShoulder",
    "Gamepad:RightShoulder",
    "Gamepad:LeftTrigger",
    "Gamepad:RightTrigger",
    "Gamepad:Start",
    "Gamepad:Back",
    "Gamepad:LeftStick",
    "Gamepad:RightStick",
    "Gamepad:LeftStickUp",
    "Gamepad:LeftStickDown",
    "Gamepad:LeftStickLeft",
    "Gamepad:LeftStickRight",
    "Gamepad:RightStickUp",
    "Gamepad:RightStickDown",
    "Gamepad:RightStickLeft",
    "Gamepad:RightStickRight",
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
const DEVICES = new Set<string>([
  ...BINDING_INPUTS.media,
  ...BINDING_INPUTS.gamepad,
]);

/** A media key or gamepad input: no modifiers, no menu label. */
export const isDeviceInput = (input: string): boolean => DEVICES.has(input);

type Kind = "letter" | "digit" | "named" | "symbol" | "mouse" | "device";

function kind(input: string): Kind | null {
  if (input.startsWith("Mouse:")) return MOUSE.has(input) ? "mouse" : null;
  if (DEVICES.has(input)) return "device";
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
  if (type === "device" && mods.length)
    throw failure("invalid", `binding ${text}: ${input} takes no modifiers`);
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

/** `plugin.bindings`: the table and the user overlay. */
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
        category: info.category ?? null,
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
      null,
    );
    return scope.add({
      dispose: async () => {
        scope.forget(watch);
        await watch.dispose();
      },
    });
  },
});

/** Named keys whose label is not their name (the player's `label_in`). */
const NAMED_LABELS: Readonly<Record<string, string>> = {
  ArrowLeft: "←",
  ArrowRight: "→",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Escape: "Esc",
  PageUp: "PgUp",
  PageDown: "PgDn",
  Delete: "Del",
  Plus: "+",
  NumpadPlus: "Num+",
  NumpadMinus: "Num-",
  NumpadMultiply: "Num*",
  NumpadDivide: "Num/",
  NumpadEnter: "NumEnter",
  NumpadDecimal: "Num.",
};

/**
 * How the player's menus write a canonical binding (`bindings.rs`
 * `label_in`), for `TestHost`'s `commands.keys`: `Ctrl+O` and arrows as
 * ← → ↑ ↓ (`Esc`, `PgUp`, `Num5`); on macOS (`mac`) symbols in Apple's
 * order ⌃⌥⇧⌘, a `Ctrl` binding as ⌘ (it answers to ⌘ there) and ⌃ only
 * next to ⌘. `null` for a binding menus do not show: a mouse, media key or
 * gamepad binding, and a `Cmd` one outside macOS.
 */
export function keyLabel(binding: string, mac: boolean): string | null {
  if (binding.startsWith("Mouse:") || isDeviceInput(binding)) return null;
  const parts = binding.split("+");
  const input = parts.pop()!;
  const has = (mod: string) => parts.includes(mod);
  const [ctrl, alt, shift, cmd] = ["Ctrl", "Alt", "Shift", "Cmd"].map(has);
  if (cmd && !mac) return null;
  const mods = mac
    ? `${ctrl && cmd ? "⌃" : ""}${alt ? "⌥" : ""}${shift ? "⇧" : ""}${ctrl || cmd ? "⌘" : ""}`
    : parts.map((mod) => `${mod}+`).join("");
  const digit = /^Numpad(\d)$/.exec(input)?.[1];
  return mods + (NAMED_LABELS[input] ?? (digit ? `Num${digit}` : input));
}
