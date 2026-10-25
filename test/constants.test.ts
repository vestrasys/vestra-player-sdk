/**
 * The exported tables the documentation is generated from: capabilities,
 * limits, binding names, the built-in commands and submenus. The player's
 * own tests check them against the player; these check that they are
 * consistent in themselves and that the SDK and the test host enforce them.
 */
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  BINDING_INPUTS,
  BUILTIN_COMMANDS,
  BUILTIN_SUBMENUS,
  CAPABILITY_INFO,
  MENU_IDS,
  MESSAGE_LIMIT,
  OSD_LIMITS,
  SECRET_LIMITS,
  startPlugin,
} from "../src/plugin/testing.ts";
import { API_VERSION, CAPABILITIES } from "../src/player-runtime.ts";
import { canonical } from "../src/plugin/bindings.ts";
import { HOST_GROUPS, MENU_KEYS } from "../src/i18n.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";

const code = (expected: string) => (error: unknown) =>
  (error as PluginError).code === expected;

async function started(capabilities: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "constants-"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.constants", capabilities }),
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

test("CAPABILITIES are the keys of CAPABILITY_INFO, in the player's order", () => {
  assert.equal(API_VERSION, "vestra/1");
  assert.deepEqual(CAPABILITIES, Object.keys(CAPABILITY_INFO));
  assert.deepEqual(CAPABILITIES, [
    "producer.av",
    "playback.read",
    "playback.control",
    "source.resolve",
    "events",
    "commands",
    "ui.window",
    "ui.mount",
    "ui.dialog",
    "plugins.manage",
    "processing.video",
    "processing.audio",
    "subtitles.read",
    "subtitles.control",
    "media.read",
    "media.control",
    "ui.osd",
    "clipboard",
    "window.control",
    "bindings.manage",
    "timeline.marks",
    "ui.drop",
    "ui.settings",
    "ui.theme",
    "secrets",
  ]);
  assert.ok(Object.isFrozen(CAPABILITY_INFO));
  assert.ok(Object.isFrozen(CAPABILITIES));
});

test("CAPABILITY_INFO: labels, highlighted ones and requirements", () => {
  const risky = CAPABILITIES.filter((name) => CAPABILITY_INFO[name]!.risky);
  assert.deepEqual(risky, [
    "plugins.manage",
    "clipboard",
    "bindings.manage",
    "secrets",
  ]);
  for (const [name, info] of Object.entries(CAPABILITY_INFO)) {
    assert.match(info.label, /^[A-Z][^\n]*[^.\s]$/, name);
    assert.ok(info.apis.length > 0, name);
    assert.equal(new Set(info.apis).size, info.apis.length, name);
    for (const needed of info.requires) {
      assert.ok(CAPABILITIES.includes(needed), `${name} requires ${needed}`);
      assert.notEqual(needed, name);
    }
  }
  // Only media.read and media.control share their wording.
  const labels = Object.values(CAPABILITY_INFO).map((info) => info.label);
  assert.equal(new Set(labels).size, labels.length - 1);
  assert.equal(
    CAPABILITY_INFO["media.read"]!.label,
    CAPABILITY_INFO["media.control"]!.label,
  );
});

test("CAPABILITY_INFO names members that exist", () => {
  const file = new URL("../src/plugin/types.ts", import.meta.url).pathname;
  const program = ts.createProgram([file], {
    allowImportingTsExtensions: true,
    noEmit: true,
    strict: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(file)!;
  const exports = checker.getExportsOfModule(
    checker.getSymbolAtLocation(source)!,
  );
  const typeOf = (name: string) => {
    const symbol = exports.find((each) => each.name === name);
    assert.ok(symbol, `types.ts exports ${name}`);
    return checker.getDeclaredTypeOfSymbol(symbol);
  };
  for (const [name, info] of Object.entries(CAPABILITY_INFO))
    for (const api of info.apis) {
      const [head, ...members] = api.split(".");
      assert.ok(members.length, `${name}: ${api} names a member`);
      let type = typeOf(head!);
      for (const member of members) {
        const property = type.getProperty(member);
        assert.ok(property, `${name}: ${api} exists`);
        type = checker.getTypeOfSymbol(property);
      }
    }
});

test("MESSAGE_LIMIT is 1 MiB", () => {
  assert.equal(MESSAGE_LIMIT, 1_048_576);
});

test("OSD_LIMITS bound osd.show and the information block", async () => {
  assert.ok(Object.isFrozen(OSD_LIMITS));
  const { plugin, host, errors, stop } = await started(["ui.osd"]);
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
  const { plugin, host, stop } = await started(["secrets"]);
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
