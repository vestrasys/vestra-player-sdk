// The capability scan (SDK 1.8.0): capability-scan.json is complete (every
// method of the public API and every method of the player's capability
// table is in exactly one list), and `vestra-plugin scan` reports the
// categories a plugin's code uses, by type and, for JavaScript, by name.
// The scan is tooling: nothing here touches the capabilities or TestHost.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { CAPABILITY_INFO } from "../src/capabilities.ts";
import {
  requestCategory,
  SCAN_CATEGORIES,
  scanTable,
} from "../src/capability-scan.ts";
import { HOST_CAPABILITIES } from "../src/host-capabilities.ts";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "bin/vestra-plugin.mjs");
const table = scanTable();
const lists = [
  ...SCAN_CATEGORIES.map((name) => ({ name, list: table.categories[name] })),
  { name: "none", list: table.none },
];

/**
 * Every method of the public API, from the API surface snapshot: the
 * method members of the interfaces `@vestra-player/sdk` exports
 * (`Clipboard.readText`), and the methods of a member that is an object
 * (`Scope.video.filter`). Data fields and options are not members that act.
 */
function surfaceMethods(): string[] {
  const methods = new Set<string>();
  const method = /^(\w+)\??(?:<[^(]*>)?\(/;
  for (const line of readFileSync(
    join(root, "test/fixtures/api-surface.txt"),
    "utf8",
  ).split("\n")) {
    const member =
      /^@vestra-player\/sdk InterfaceDeclaration (\w+) :: (.*)$/.exec(line);
    if (!member) continue;
    const [, owner, signature] = member;
    const own = method.exec(signature!);
    if (own) methods.add(`${owner}.${own[1]}`);
    const object = /^(?:readonly )?(\w+)\??: \{ (.*) \};$/.exec(signature!);
    for (const part of object?.[2]!.split("; ") ?? []) {
      const nested = method.exec(part);
      if (nested) methods.add(`${owner}.${object![1]}.${nested[1]}`);
    }
  }
  return [...methods];
}

/** Where a name is listed: the names of the lists that have it. */
const listed = (kind: "members" | "requests", name: string) =>
  lists.filter(({ list }) => list[kind].includes(name)).map(({ name }) => name);

test("capability-scan.json: the eight categories and none, each list sorted and without repeats", () => {
  assert.equal(table.version, 1);
  assert.deepEqual(Object.keys(table.categories), [...SCAN_CATEGORIES]);
  assert.deepEqual(
    [...SCAN_CATEGORIES],
    [
      "player",
      "plugins",
      "clipboard",
      "credentials",
      "camera",
      "microphone",
      "screen",
      "notifications",
    ],
  );
  for (const { name, list } of lists) {
    assert.match(list.about, /^[A-Z].*\.$/, name);
    for (const kind of ["members", "requests"] as const) {
      assert.deepEqual(
        list[kind],
        [...new Set(list[kind])].sort(),
        `${name}.${kind} is sorted, each name once`,
      );
    }
  }
});

test("every method of the public API is in exactly one list, and every listed member exists", () => {
  const methods = surfaceMethods();
  assert.ok(methods.length > 190, `${methods.length} methods in the snapshot`);
  for (const probe of [
    "Clipboard.readText",
    "Mpv.command",
    "Scope.video.filter",
  ])
    assert.ok(methods.includes(probe), probe);
  const problems: string[] = [];
  for (const member of methods) {
    const where = listed("members", member);
    if (where.length === 0)
      problems.push(
        `${member} is in no list of capability-scan.json: add it to the category whose boundary it crosses, or to none`,
      );
    if (where.length > 1)
      problems.push(`${member} is in ${where.join(" and ")}: keep one`);
  }
  for (const { name, list } of lists)
    for (const member of list.members)
      if (!methods.includes(member))
        problems.push(
          `${name} lists ${member}, which is not a method of the public API: remove it`,
        );
  assert.deepEqual(problems, []);
});

test("every method of the player's capability table is in exactly one list of requests, and every listed request exists", () => {
  const methods = [
    ...HOST_CAPABILITIES.capabilities.flatMap((each) => each.methods),
    ...HOST_CAPABILITIES.uncapable,
  ].map((each) => each.name);
  const problems: string[] = [];
  for (const method of methods) {
    const where = listed("requests", method);
    if (where.length !== 1)
      problems.push(
        `${method} is in ${where.length ? where.join(" and ") : "no list"}: one list of requests in capability-scan.json`,
      );
  }
  for (const { name, list } of lists)
    for (const request of list.requests)
      if (!methods.includes(request))
        problems.push(
          `${name} lists the request ${request}, which the player's table does not have: remove it`,
        );
  assert.deepEqual(problems, []);
});

test("a request by name has the category of its method: exact first, then the prefix", () => {
  assert.equal(requestCategory("clipboard.readText"), "clipboard");
  assert.equal(requestCategory("secrets.get"), "credentials");
  assert.equal(requestCategory("mpv.set"), "player");
  assert.equal(requestCategory("mpv.get"), null);
  // packages.* acts on other plugins; packages.list, listed by name, reads.
  assert.equal(requestCategory("packages.install"), "plugins");
  assert.equal(requestCategory("packages.uninstall"), "plugins");
  assert.equal(requestCategory("packages.list"), null);
  assert.equal(requestCategory("settings.register"), null);
  assert.equal(requestCategory("no.such.method"), undefined);
});

test("the members of the risky capabilities: what changes or reaches is in a category, what only reads is in none", () => {
  const category = (member: string) => listed("members", member)[0];
  const risky = Object.entries(CAPABILITY_INFO).filter(
    ([, info]) => info.risky,
  );
  assert.deepEqual(
    Object.fromEntries(
      risky.map(([name, info]) => [
        name,
        Object.fromEntries(info.apis.map((api) => [api, category(api)])),
      ]),
    ),
    {
      "plugins.manage": {
        "Packages.validate": "plugins",
        "Packages.validateArchive": "plugins",
        "Packages.setEnabled": "plugins",
        "Packages.reload": "plugins",
        "Packages.uninstall": "plugins",
      },
      clipboard: {
        "Clipboard.readText": "clipboard",
        "Clipboard.writeText": "clipboard",
        "Clipboard.writeImage": "clipboard",
      },
      "bindings.manage": {
        "Bindings.list": "none",
        "Bindings.set": "player",
        "Bindings.reset": "player",
        "Bindings.onChange": "none",
      },
      secrets: {
        "Secrets.get": "credentials",
        "Secrets.set": "credentials",
        "Secrets.delete": "credentials",
      },
      "rendering.manage": {
        "Rendering.setPreference": "player",
        "Rendering.restartPlayer": "player",
      },
      "commands.run": {
        "Commands.list": "none",
        "Commands.run": "plugins",
      },
      mpv: {
        "Mpv.command": "player",
        "Mpv.get": "none",
        "Mpv.set": "player",
        "Mpv.observe": "none",
      },
    },
  );
  // The install itself is on the candidate that validate returns.
  assert.equal(category("PackageCandidate.install"), "plugins");
  // Not risky capabilities, but the user's own settings.
  assert.equal(category("Appearance.set"), "player");
  assert.equal(category("Appearance.setLanguage"), "player");
  // No member reaches these today.
  for (const empty of [
    "camera",
    "microphone",
    "screen",
    "notifications",
  ] as const)
    assert.deepEqual(
      [table.categories[empty].members, table.categories[empty].requests],
      [[], []],
      empty,
    );
});

// ---------------------------------------------------------------- the CLI

/** A plugin directory with the given files (no SDK installed in it). */
function project(id: string, files: Record<string, string>) {
  const directory = mkdtempSync(join(tmpdir(), "vestra-plugin-scan-"));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  const entry = Object.keys(files).find((file) => /main\.\w+$/.test(file));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id,
      version: "1.2.3",
      apiVersion: "vestra/1",
      entry,
      capabilities: [],
    }),
  );
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(dirname(join(directory, file)), { recursive: true });
    writeFileSync(join(directory, file), text);
  }
  return directory;
}

function scan(...directories: string[]) {
  const run = spawnSync(process.execPath, [cli, "scan", ...directories], {
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

const TYPED = [
  'import type { Plugin } from "@vestra-player/sdk";',
  'import { token } from "./lib/keys.ts";',
  "export default async function activate(plugin: Plugin) {",
  "  const { clipboard: board } = plugin;", // 4
  "  await board.readText();", // 5: an alias
  "  const { set } = plugin.mpv;", // 6: destructured
  '  await set("deband", true);',
  '  await plugin.mpv.get("deband");', // reads: none
  '  await plugin.wire.request("packages.install", { path: "x" });', // 9
  "  await token(plugin.secrets);",
  "  await plugin.player.seek(3);", // the playback session: none
  '  plugin.commands.add({ id: "copy", title: "Copy", run: () => {} });',
  "}",
].join("\n");
const KEYS = [
  'import type { Secrets } from "@vestra-player/sdk";',
  'export const token = (secrets: Secrets) => secrets["get"]("token");', // 2
].join("\n");

test("scan by type: aliases, destructuring, element access, a parameter's type, a request by name", () => {
  const directory = project("me.typed", {
    "main.ts": TYPED,
    "lib/keys.ts": KEYS,
    // Not the plugin's production code.
    "tests/main.test.ts":
      'import type { Plugin } from "@vestra-player/sdk";\nexport const t = (p: Plugin) => p.bindings.set("a", []);',
  });
  const { version } = JSON.parse(
    readFileSync(join(root, "package.json"), "utf8"),
  );
  assert.deepEqual(scan(directory), {
    scan: 1,
    sdk: version,
    plugin: "me.typed",
    version: "1.2.3",
    uses: ["player", "plugins", "clipboard", "credentials"],
    method: "types",
    files: { types: 2, names: 0 },
    evidence: {
      player: [{ member: "Mpv.set", file: "main.ts", line: 6, by: "types" }],
      plugins: [
        { request: "packages.install", file: "main.ts", line: 9, by: "types" },
      ],
      clipboard: [
        { member: "Clipboard.readText", file: "main.ts", line: 5, by: "types" },
      ],
      credentials: [
        { member: "Secrets.get", file: "lib/keys.ts", line: 2, by: "types" },
      ],
    },
    unchecked: [],
    notes: [],
  });
});

test("scan by type: nothing used is an empty list; a request the scan cannot name is unchecked", () => {
  const quiet = project("me.quiet", {
    "main.ts": [
      'import type { Plugin } from "@vestra-player/sdk";',
      "export default async function activate(plugin: Plugin) {",
      '  plugin.commands.add({ id: "hello", title: "Hello", run: () => plugin.osd.show("Hello") });',
      "  await plugin.player.setPaused(true);",
      "  plugin.bindings.onChange(() => {});",
      "  await plugin.commands.list();",
      "}",
    ].join("\n"),
  });
  const result = scan(quiet);
  assert.deepEqual(
    [result.uses, result.evidence, result.unchecked, result.method],
    [[], {}, [], "types"],
  );
  const raw = project("me.raw", {
    "main.ts": [
      'import type { Plugin } from "@vestra-player/sdk";',
      "export default async function activate(plugin: Plugin, name: string) {",
      "  await plugin.wire.request(name);", // 3
      '  await plugin.wire.request("no.such.method");', // 4
      "  const { request } = plugin.wire;", // 5
      '  const fixed = "clipboard.writeText" as const;',
      '  await plugin.wire.request(fixed, { text: "x" });', // 7
      "}",
    ].join("\n"),
  });
  const found = scan(raw);
  assert.deepEqual(found.uses, ["clipboard"]);
  assert.deepEqual(found.evidence.clipboard, [
    { request: "clipboard.writeText", file: "main.ts", line: 7, by: "types" },
  ]);
  assert.deepEqual(
    found.unchecked.map((each: { line: number }) => each.line),
    [3, 4, 5],
  );
  assert.match(found.unchecked[1].message, /"no\.such\.method"/);
  assert.equal(found.notes.length, 1);
  assert.match(found.notes[0], /unchecked/);
});

const SCRIPT = [
  "export default async function activate(plugin) {",
  "  const { bindings, commands: { run } } = plugin;", // 2: Commands.run
  '  await bindings.set("x", ["Ctrl+K"]);', // 3
  '  await plugin.clipboard.writeText("hi");', // 4
  "  const { uninstall } = plugin.packages;", // 5
  '  await plugin.wire.request("rendering.restart");', // 6
  '  cache.set("a", 1);', // not a module of plugin
  "  await plugin.player.seek(3);",
  "}",
].join("\n");

test("scan by name (JavaScript, best effort): members on their module's name, requests of a literal; the result says so", () => {
  const directory = project("me.script", { "main.js": SCRIPT });
  const result = scan(directory);
  assert.deepEqual(result.uses, ["player", "plugins", "clipboard"]);
  assert.equal(result.method, "names");
  assert.deepEqual(result.files, { types: 0, names: 1 });
  assert.deepEqual(result.evidence, {
    player: [
      { member: "Bindings.set", file: "main.js", line: 3, by: "names" },
      { request: "rendering.restart", file: "main.js", line: 6, by: "names" },
    ],
    plugins: [
      { member: "Commands.run", file: "main.js", line: 2, by: "names" },
      { member: "Packages.uninstall", file: "main.js", line: 5, by: "names" },
    ],
    clipboard: [
      { member: "Clipboard.writeText", file: "main.js", line: 4, by: "names" },
    ],
  });
  assert.equal(result.notes.length, 1);
  assert.match(result.notes[0], /scanned by name have no types/);
});

test("scan: TypeScript and JavaScript together is mixed; a built package is read in dist/; several directories give an array", () => {
  const mixed = project("me.mixed", {
    "main.ts": TYPED,
    "lib/keys.ts": KEYS,
    "vendor-free/old.js":
      'export const copy = (plugin) => plugin.clipboard.writeImage("a.png");',
    // dist/ is the build of the sources above: not read again.
    "dist/main.js": SCRIPT,
  });
  const result = scan(mixed);
  assert.equal(result.method, "mixed");
  assert.deepEqual(result.files, { types: 2, names: 1 });
  assert.deepEqual(result.uses, [
    "player",
    "plugins",
    "clipboard",
    "credentials",
  ]);
  assert.deepEqual(
    result.evidence.clipboard.map((each: { by: string }) => each.by),
    ["types", "names"],
  );
  const built = project("me.built", { "dist/main.js": SCRIPT });
  const many = scan(mixed, built);
  assert.ok(Array.isArray(many));
  assert.deepEqual(
    many.map((each: { directory: string; plugin: string; method: string }) => [
      each.directory,
      each.plugin,
      each.method,
    ]),
    [
      [mixed, "me.mixed", "mixed"],
      [built, "me.built", "names"],
    ],
  );
  assert.deepEqual(many[1].uses, ["player", "plugins", "clipboard"]);
  assert.equal(many[1].evidence.clipboard[0].file, "dist/main.js");
});

test("scan: TypeScript that imports no SDK types is read by name, and says so; no manifest fails", () => {
  const untyped = project("me.untyped", {
    "main.ts":
      'export default async function activate(plugin: any) {\n  await plugin.secrets.set("token", "x");\n}',
  });
  const result = scan(untyped);
  assert.deepEqual(result.uses, ["credentials"]);
  assert.equal(result.method, "names");
  assert.deepEqual(result.files, { types: 0, names: 1 });
  assert.match(result.notes[0], /import no types of @vestra-player\/sdk/);
  const empty = mkdtempSync(join(tmpdir(), "vestra-plugin-scan-"));
  test.after(() => rmSync(empty, { recursive: true, force: true }));
  const run = spawnSync(process.execPath, [cli, "scan", empty], {
    encoding: "utf8",
  });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /no manifest\.json/);
  assert.equal(run.stdout, "");
});
