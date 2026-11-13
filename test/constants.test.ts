/**
 * The exported tables the documentation is generated from: limits, binding names, the built-in commands and submenus. The player's
 * own tests check them against the player; these check that they are
 * consistent in themselves and that the SDK and the test host enforce them.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  BINDING_INPUTS,
  BUILTIN_COMMANDS,
  BUILTIN_SUBMENUS,
  MENU_IDS,
  MESSAGE_LIMIT,
  OSD_LIMITS,
  SECRET_LIMITS,
} from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import { API_VERSION } from "../src/player-runtime.ts";
import { canonical } from "../src/plugin/bindings.ts";
import { HOST_GROUPS, MENU_KEYS } from "../src/i18n.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";

const code = (expected: string) => (error: unknown) =>
  (error as PluginError).code === expected;

async function started() {
  const directory = mkdtempSync(join(tmpdir(), "constants-"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.constants" }),
  );
  const errors: unknown[] = [];
  let plugin!: Plugin;
  const run = await startPlugin(
    (p) => {
      plugin = p;
      p.onError((error) => errors.push(error));
    },
    { directory },
  );
  return { ...run, plugin, errors };
}

test("API_VERSION is vestra/1", () => {
  assert.equal(API_VERSION, "vestra/1");
});

test("MESSAGE_LIMIT is 1 MiB", () => {
  assert.equal(MESSAGE_LIMIT, 1_048_576);
});

test("OSD_LIMITS bound osd.show and the information block", async () => {
  assert.ok(Object.isFrozen(OSD_LIMITS));
  const { plugin, host, errors, stop } = await started();
  try {
    await plugin.osd.show("x".repeat(OSD_LIMITS.messageChars));
    await assert.rejects(
      plugin.osd.show("x".repeat(OSD_LIMITS.messageChars + 1)),
      code("invalid"),
    );
    const panel = plugin.osd.panel();
    const lines = (count: number) =>
      Array.from({ length: count }, (_, i) => `${i}`).join("\n");
    panel.set(lines(OSD_LIMITS.panelLines));
    await host.settle();
    assert.equal(host.osdPanel, lines(OSD_LIMITS.panelLines));
    assert.equal(errors.length, 0);
    panel.set(lines(OSD_LIMITS.panelLines + 1));
    await host.settle();
    panel.set("x".repeat(OSD_LIMITS.panelBytes + 1));
    await host.settle();
    for (const columns of [
      OSD_LIMITS.minColumns - 1,
      OSD_LIMITS.maxColumns + 1,
    ])
      panel.set("x", null, { maxColumns: columns });
    panel.set("abcdefghijk", null, { maxColumns: OSD_LIMITS.minColumns });
    await host.settle();
    assert.equal(errors.length, 4);
    assert.ok(errors.every(code("invalid")));
    assert.equal(host.osdPanel, "abcdefg…");
  } finally {
    await stop();
  }
});

test("SECRET_LIMITS bound names and values", async () => {
  assert.ok(Object.isFrozen(SECRET_LIMITS));
  const { plugin, host, stop } = await started();
  try {
    const name = "a".repeat(SECRET_LIMITS.nameChars);
    await plugin.secrets.set(name, "x".repeat(SECRET_LIMITS.valueBytes));
    await assert.rejects(plugin.secrets.get(`${name}a`), code("invalid"));
    await assert.rejects(
      plugin.secrets.set("k", "x".repeat(SECRET_LIMITS.valueBytes + 1)),
      code("invalid"),
    );
    // The test host keeps the player's count of names per plugin.
    for (let i = 1; i < SECRET_LIMITS.names; i++)
      host.secrets.set(`n${i}`, "v");
    await assert.rejects(plugin.secrets.set("one-more", "v"), code("limit"));
  } finally {
    await stop();
  }
});

test("BINDING_INPUTS are exactly the inputs a binding accepts", () => {
  const { modifiers, letters, digits, functionKeys, named, mouse } =
    BINDING_INPUTS;
  assert.deepEqual(modifiers, ["Ctrl", "Alt", "Shift", "Cmd"]);
  assert.equal(letters.length, 26);
  assert.equal(digits.length, 10);
  assert.deepEqual([functionKeys[0], functionKeys.at(-1)], ["F1", "F24"]);
  const all = [...letters, ...digits, ...functionKeys, ...named, ...mouse];
  assert.equal(new Set(all).size, all.length);
  for (const input of all) {
    assert.equal(canonical(input), input);
    assert.equal(canonical(`Ctrl+Alt+Cmd+${input}`), `Ctrl+Alt+Cmd+${input}`);
  }
  for (const input of [...letters, ...functionKeys, ...named, ...mouse])
    assert.equal(canonical(`Shift+${input}`), `Shift+${input}`);
  // Symbols are written as typed, never with Shift.
  for (const symbol of [">", "[", "/", "!", "`"])
    assert.equal(canonical(symbol), symbol);
  const refused = [
    "F25",
    "F0",
    "Mouse:X3",
    "Mouse:RightClick",
    "a",
    "+",
    "Numpad10",
    "Shift+1",
    "Shift+>",
    "Alt+Ctrl+A",
    "Meta+A",
    "Ctrl+Ctrl+A",
  ];
  for (const binding of refused)
    assert.throws(() => canonical(binding), code("invalid"), binding);
});

test("BUILTIN_SUBMENUS: key paths of the built-in plugins' submenus", () => {
  assert.ok(Object.isFrozen(BUILTIN_SUBMENUS));
  const keys = BUILTIN_SUBMENUS.map((menu) => menu.path.join("\u0000"));
  assert.equal(new Set(keys).size, keys.length);
  const tops = MENU_IDS.map((id) => MENU_KEYS[id]!);
  let rank = 0;
  for (const { path, plugins } of BUILTIN_SUBMENUS) {
    assert.ok(path.length >= 1);
    assert.ok(plugins.length >= 1);
    for (const id of plugins) assert.match(id, /^vestra\.[a-z-]+$/);
    for (const segment of path) {
      assert.equal(segment, segment.trim());
      assert.ok(segment && !segment.startsWith("@") && !segment.includes("▸"));
    }
    // Keys, not menu ids; never one of the player's own groups.
    assert.ok(!HOST_GROUPS.includes(path.join("/")), path.join(" ▸ "));
    // Every enclosing submenu is listed too (a built-in menu is not).
    const parent = path.slice(0, -1);
    if (parent.length > (tops.includes(path[0]!) ? 1 : 0))
      assert.ok(keys.includes(parent.join("\u0000")), path.join(" ▸ "));
    // In menu order: built-in menus as MENU_IDS, then top-level submenus.
    const at = tops.includes(path[0]!) ? tops.indexOf(path[0]!) : tops.length;
    assert.ok(at >= rank, path.join(" ▸ "));
    rank = at;
  }
});

test("BUILTIN_COMMANDS: owners, key paths and canonical bindings", () => {
  assert.ok(Object.isFrozen(BUILTIN_COMMANDS));
  const ids = BUILTIN_COMMANDS.map((c) => `${c.owner}/${c.id}`);
  assert.equal(new Set(ids).size, ids.length);
  const paths = BUILTIN_COMMANDS.filter((c) => c.path.length).map((c) =>
    c.path.join("\u0000"),
  );
  assert.equal(new Set(paths).size, paths.length);
  let outside = false;
  for (const command of BUILTIN_COMMANDS) {
    assert.ok(Object.isFrozen(command) && Object.isFrozen(command.bindings));
    assert.ok(
      command.owner === "host" || /^vestra\.[a-z-]+$/.test(command.owner),
    );
    assert.ok(command.id && command.title);
    for (const binding of command.bindings)
      assert.equal(canonical(binding), binding);
    for (const segment of command.path)
      assert.ok(segment === segment.trim() && !segment.startsWith("@"));
    if (command.path.length) {
      assert.equal(command.path.at(-1), command.title);
      // Commands outside the menu come last.
      assert.ok(!outside, command.id);
    } else outside = true;
  }
  // The submenus they form are the built-in submenus plus the player's own.
  const submenus = new Set<string>();
  const tops = MENU_IDS.map((id) => MENU_KEYS[id]!);
  for (const { path } of BUILTIN_COMMANDS)
    for (let depth = 1; depth < path.length; depth++) {
      const key = path.slice(0, depth).join("/");
      if (
        !(depth === 1 && tops.includes(path[0]!)) &&
        !HOST_GROUPS.includes(key)
      )
        submenus.add(key);
    }
  assert.deepEqual(
    [...submenus].sort(),
    BUILTIN_SUBMENUS.map((menu) => menu.path.join("/")).sort(),
  );
});

test("THEMES (plugin.appearance's hand-written list) are THEME_PALETTES' palettes, the default first", async () => {
  // THEME_PALETTES is the SDK's copy of the player's palettes (the player's
  // agreement test checks it against theme.rs); THEMES must name the same.
  const { THEME_PALETTES } = await import("../src/palettes.ts");
  const { THEMES } = await import("../src/plugin/appearance.ts");
  assert.deepEqual([...THEMES], Object.keys(THEME_PALETTES));
  assert.equal(THEMES[0], "vestra");
});

test("THEME_PALETTES: both palettes have every Theme colour; vestra is palette.slint's", async () => {
  const { THEME_PALETTES } = await import("../src/palettes.ts");
  const { readFileSync } = await import("node:fs");
  const read = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");
  const defaults = Object.fromEntries(
    [
      ...read("../slint/palette.slint").matchAll(
        /in property <color> ([\w-]+): (#[0-9a-f]{6});/g,
      ),
    ].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual({ ...THEME_PALETTES.vestra }, defaults);
  const theme = read("../slint/vestra/theme.slint");
  const tokens = [
    ...theme.matchAll(/out property <color> [\w-]+: VestraPalette\.([\w-]+);/g),
  ].map((m) => m[1]);
  assert.ok(tokens.length > 0);
  for (const palette of Object.values(THEME_PALETTES)) {
    assert.deepEqual(Object.keys(palette).sort(), Object.keys(defaults).sort());
    for (const token of tokens)
      assert.match(palette[token as keyof typeof palette], /^#[0-9a-f]{6}$/);
  }
});
