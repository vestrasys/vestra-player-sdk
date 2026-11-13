// The capability rule (the player's table + API_REQUESTS), the checker that
// applies it to a plugin's sources, `vestra-plugin check` and the TypeScript
// language-service plugin. Projects resolve @vestra-player/sdk from their
// node_modules (a junction to this repository), so dist/ must be built.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import { API_REQUESTS, SUBSCRIBED_EVENTS } from "../src/api-requests.ts";
import { CAPABILITY_INFO } from "../src/capabilities.ts";
import {
  addCapabilityEdit,
  CAPABILITY_DIAGNOSTIC,
  checkCapabilities,
  findUndeclaredCapabilities,
  isPluginSource,
} from "../src/capability-check.ts";
import {
  argumentRequests,
  capabilityInfo,
  hostMethod,
  memberNeeds,
  requestNeeds,
  requestsNeed,
  retiredCapabilities,
  RULES,
} from "../src/capability-rules.ts";
import type { CapabilityRules } from "../src/capability-rules.ts";
import { HOST_CAPABILITIES } from "../src/host-capabilities.ts";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "bin/vestra-plugin.mjs");

// ------------------------------------------------------------------ rules

test("requestNeeds follows the player's table", () => {
  assert.equal(requestNeeds("clipboard.writeText"), "clipboard");
  assert.equal(requestNeeds("secrets.get"), "credentials");
  assert.equal(requestNeeds("bindings.set"), "player");
  assert.equal(requestNeeds("rendering.restart"), "player");
  assert.equal(requestNeeds("appearance.set"), "player");
  assert.equal(requestNeeds("commands.run"), "plugins");
  // A prefix entry covers the prefix's other methods.
  assert.equal(requestNeeds("packages.uninstall"), "plugins");
  // An exact entry wins over a prefix: packages.list needs nothing.
  assert.equal(requestNeeds("packages.list"), null);
  // The plugin's own things, the playback session and every event need
  // nothing.
  for (const method of [
    "commands.register",
    "settings.register",
    "ui.open",
    "ui.mount",
    "osd.show",
    "source.submit",
    "source.state",
    "subtitles.select",
    "snapshot.capture",
    "jobs.start",
    "media.sources.open",
    "processing.replace",
    "video.upscaling.set",
    "video.motion.set",
    "palette.lead.set",
    "power.preventSleep",
    "storage.session.get",
    "events.subscribe",
    "events.unsubscribe",
  ])
    assert.equal(requestNeeds(method), null, method);
  assert.equal(requestNeeds("no.such.method"), undefined);
});

test("the table: eight capabilities, the retired names and a flat rule", () => {
  const names = HOST_CAPABILITIES.capabilities.map((c) => c.name);
  assert.deepEqual(names, [
    "player",
    "plugins",
    "clipboard",
    "credentials",
    "camera",
    "microphone",
    "screen",
    "notifications",
  ]);
  const methods = HOST_CAPABILITIES.groups.flatMap((group) => group.methods);
  const active = names.filter(
    (name) =>
      !HOST_CAPABILITIES.capabilities.find((c) => c.name === name)!.reserved,
  );
  // Every method needs nothing or one active capability, and every active
  // capability is needed by some method; a reserved one by none.
  for (const method of methods)
    assert.ok(
      method.needs === null || active.includes(method.needs),
      method.name,
    );
  assert.deepEqual(
    [...new Set(methods.map((m) => m.needs).filter(Boolean))].sort(),
    [...active].sort(),
  );
  assert.equal(new Set(methods.map((m) => m.name)).size, methods.length);
  // The names of SDK 1.7: none is a capability now, each replacement is an
  // active one. (clipboard kept its name and is not among them.)
  const retired = retiredCapabilities();
  assert.equal(Object.keys(retired).length, 30);
  for (const [old, now] of Object.entries(retired)) {
    assert.ok(!names.includes(old), old);
    assert.ok(now === null || active.includes(now), old);
  }
  assert.deepEqual(
    Object.entries(retired).filter(([, now]) => now !== null),
    [
      ["plugins.manage", "plugins"],
      ["bindings.manage", "player"],
      ["ui.theme", "player"],
      ["secrets", "credentials"],
      ["rendering.manage", "player"],
      ["commands.run", "plugins"],
    ],
  );
});

test("memberNeeds: what each member needs", () => {
  const names = (api: string) =>
    memberNeeds(api)?.map((need) => need.capability);
  assert.deepEqual(names("Bindings.set"), ["player"]);
  assert.deepEqual(names("Appearance.setLanguage"), ["player"]);
  assert.deepEqual(names("Rendering.restartPlayer"), ["player"]);
  assert.deepEqual(names("Packages.uninstall"), ["plugins"]);
  assert.deepEqual(names("Commands.run"), ["plugins"]);
  assert.deepEqual(names("Clipboard.readText"), ["clipboard"]);
  assert.deepEqual(names("Secrets.get"), ["credentials"]);
  // In the table, needing nothing.
  for (const api of [
    "Player.seek",
    "Player.openStream",
    "Player.onChange",
    "Plugin.audio.filter",
    "Plugin.video.filter",
    "MediaCapture.capture",
    "MediaSources.open",
    "Bindings.onChange",
    "Packages.onChange",
    "Palette.lead",
    "Commands.add",
    "Rendering.state",
  ])
    assert.deepEqual(names(api), [], api);
  assert.equal(names("Player.isCurrent"), undefined);
});

test("requestsNeed: each capability once, with the first request that needs it", () => {
  const rules: CapabilityRules = {
    host: HOST_CAPABILITIES,
    apis: {
      "Test.both": [
        { method: "source.state" },
        { method: "bindings.list" },
        { method: "clipboard.readText" },
        { method: "bindings.set" },
      ],
    },
  };
  assert.deepEqual(memberNeeds("Test.both", rules), [
    { capability: "player", method: "bindings.list" },
    { capability: "clipboard", method: "clipboard.readText" },
  ]);
  // plugin.wire.request by its method name.
  assert.deepEqual(argumentRequests("commands.run"), [
    { method: "commands.run" },
  ]);
  assert.equal(argumentRequests("no.such.method"), undefined);
  assert.deepEqual(requestsNeed(argumentRequests("commands.run")!), [
    { capability: "plugins", method: "commands.run" },
  ]);
});

test("API_REQUESTS names methods the player knows; a listener names a subscribed event", () => {
  for (const [api, requests] of Object.entries(API_REQUESTS))
    for (const request of requests) {
      assert.ok(
        hostMethod(request.method),
        `${api}: the player knows ${request.method}`,
      );
      // Parameters are only a listener's event name (the Events table).
      for (const [key, value] of Object.entries(request.params ?? {})) {
        assert.equal(request.method, "events.subscribe", api);
        assert.equal(key, "event", api);
        assert.ok(SUBSCRIBED_EVENTS.includes(value), `${api}: ${value}`);
      }
    }
});

test("CAPABILITY_INFO is built from the player's table and API_REQUESTS", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(CAPABILITY_INFO)),
    capabilityInfo(RULES),
  );
  assert.deepEqual(
    Object.keys(CAPABILITY_INFO),
    HOST_CAPABILITIES.capabilities.map((capability) => capability.name),
  );
  for (const capability of HOST_CAPABILITIES.capabilities) {
    const info = CAPABILITY_INFO[capability.name]!;
    assert.equal(info.label, capability.label);
    assert.equal(info.reserved, capability.reserved);
    // A reserved name opens nothing yet; an active one opens something.
    assert.equal(info.apis.length === 0, info.reserved, capability.name);
  }
  assert.ok(Object.isFrozen(CAPABILITY_INFO["player"]!.apis));
});

// ------------------------------------------------------------------ checker

const MANIFEST = {
  id: "me.check",
  version: "0.1.0",
  apiVersion: "vestra/1",
  entry: "main.ts",
};

/** A plugin project in a temporary directory, the SDK linked in. */
function project(
  files: Record<string, string>,
  capabilities: string[] = [],
  manifestText?: string,
) {
  const directory = mkdtempSync(join(tmpdir(), "vestra-capability-check-"));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "node_modules/@vestra-player"), {
    recursive: true,
  });
  symlinkSync(
    root,
    join(directory, "node_modules/@vestra-player/sdk"),
    "junction",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    manifestText ??
      `${JSON.stringify({ ...MANIFEST, capabilities }, null, 2)}\n`,
  );
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(directory, name, ".."), { recursive: true });
    writeFileSync(join(directory, name), text);
  }
  return directory;
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  types: [],
};

function check(
  source: string,
  capabilities: string[] = [],
  rules?: CapabilityRules,
) {
  const directory = project({ "main.ts": source }, capabilities);
  const file = join(directory, "main.ts");
  const program = ts.createProgram([file], OPTIONS);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  assert.deepEqual(errors, [], "the fixture type-checks");
  return findUndeclaredCapabilities(ts, program, {
    files: [file],
    capabilities,
    ...(rules ? { rules } : {}),
  }).map(
    (finding) =>
      `${finding.line}:${finding.column} ${finding.api} ${finding.capability}`,
  );
}

const lines = (...body: string[]) =>
  [
    'import type { Plugin } from "@vestra-player/sdk";',
    "export default async function activate(plugin: Plugin) {",
    ...body.map((line) => `  ${line}`),
    "}",
  ].join("\n");

test("checker: declared and undeclared", () => {
  const source = lines(
    'await plugin.clipboard.writeText("x");',
    'plugin.commands.add({ id: "a", title: "A", run() {} });',
  );
  assert.deepEqual(check(source, []), ["3:26 Clipboard.writeText clipboard"]);
  assert.deepEqual(check(source, ["clipboard"]), []);
});

test("checker: through aliases, destructuring, parameters and element access", () => {
  const source = [
    'import type { Plugin, Bindings } from "@vestra-player/sdk";',
    "const reset = (bindings: Bindings) => bindings.reset();",
    "export default async function activate(plugin: Plugin) {",
    "  const { bindings, secrets: vault } = plugin;",
    "  const b = bindings;",
    "  await b.list();",
    '  await vault.get("token");',
    "  const { setLanguage } = plugin.appearance;",
    "  void setLanguage;",
    '  await plugin.clipboard["readText"]();',
    "  await reset(plugin.bindings);",
    "  await plugin.player.seek(1);",
    "}",
  ].join("\n");
  assert.deepEqual(check(source, []), [
    "2:48 Bindings.reset player",
    "6:11 Bindings.list player",
    "7:15 Secrets.get credentials",
    "8:11 Appearance.setLanguage player",
    "10:26 Clipboard.readText clipboard",
  ]);
  assert.deepEqual(check(source, ["player", "clipboard", "credentials"]), []);
});

test("checker: listeners, filters and state need nothing", () => {
  const source = lines(
    "plugin.player.onChange(() => {});",
    "plugin.bindings.onChange(() => {});",
    "plugin.packages.onChange(() => {});",
    'plugin.audio.filter("a");',
    'plugin.video.filter("v");',
    "void plugin.player.state;",
    'plugin.panels.mount("sidebar", "ui/a.slint").onChange(() => {});',
  );
  assert.deepEqual(check(source, []), []);
});

test("checker: a test's own rules", () => {
  const rules: CapabilityRules = {
    host: HOST_CAPABILITIES,
    apis: {
      ...API_REQUESTS,
      "Player.refresh": [{ method: "clipboard.readText" }],
    },
  };
  const source = lines("await plugin.player.refresh();");
  assert.deepEqual(check(source, []), []);
  assert.deepEqual(check(source, [], rules), ["3:23 Player.refresh clipboard"]);
  assert.deepEqual(check(source, ["clipboard"], rules), []);
});

test("checker: members of returned objects and what is not detected", () => {
  const source = lines(
    'const candidate = await plugin.packages.validate("x");',
    "await candidate.install();",
    'const name = "set" as string;',
    "void (plugin.bindings as unknown as Record<string, unknown>)[name];",
    "const loose: any = plugin.bindings;",
    'loose.set({ plugin: "a", command: "b" }, []);',
  );
  // The candidate's members are not in the table: the call that returned it
  // already needs the capability.
  assert.deepEqual(check(source, []), ["3:43 Packages.validate plugins"]);
});

/** `checkCapabilities` on one file: findings and unchecked calls, as lines. */
function checkAll(source: string, capabilities: string[] = []) {
  const directory = project({ "main.ts": source }, capabilities);
  const file = join(directory, "main.ts");
  const program = ts.createProgram([file], OPTIONS);
  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
  assert.deepEqual(errors, [], "the fixture type-checks");
  const { findings, unchecked } = checkCapabilities(ts, program, {
    files: [file],
    capabilities,
  });
  return {
    findings: findings.map(
      (f) => `${f.line}:${f.column} ${f.api} ${f.method} ${f.capability}`,
    ),
    messages: findings.map((f) => f.message),
    unchecked: unchecked.map((u) => `${u.line}:${u.column} ${u.api}`),
  };
}

test("checker: plugin.wire.request by a literal method name (SDK 1.7.0)", () => {
  const source = lines(
    'await plugin.wire.request("ui.setMount", { property: "rate", value: "1.00×" });',
    'const method = "clipboard.readText";',
    "await plugin.wire.request(method);",
    'await plugin.wire.request("events.subscribe", { event: "bindings.changed", why: ["x"] });',
    'await plugin.wire.request("packages.uninstall", { id: "x" });',
    'await plugin.wire.request("packages.list");',
    'await plugin.wire.request("bindings.list");',
  );
  const result = checkAll(source);
  assert.deepEqual(result.findings, [
    "5:21 Wire.request clipboard.readText clipboard",
    "7:21 Wire.request packages.uninstall plugins",
    "9:21 Wire.request bindings.list player",
  ]);
  assert.match(
    result.messages[0]!,
    /^Wire\.request\("clipboard\.readText"\) needs the capability "clipboard", which manifest\.json does not declare$/,
  );
  assert.deepEqual(result.unchecked, []);
  assert.deepEqual(
    checkAll(source, ["clipboard", "player", "plugins"]).findings,
    [],
  );
});

test("checker: a method name it cannot read, one of several, or the player does not know, is unchecked", () => {
  const source = lines(
    "const pick = (name: string) => plugin.wire.request(name);",
    'void pick("ui.setMount");',
    'await plugin.wire.request("no.such.method");',
    'const either = Math.random() > 0.5 ? "osd.show" : "clipboard.readText";',
    "await plugin.wire.request(either);",
  );
  const result = checkAll(source);
  // A union could be any of its names: unchecked, not an error (review L5).
  assert.deepEqual(result.unchecked, [
    "3:46 Wire.request",
    "5:21 Wire.request",
    "7:21 Wire.request",
  ]);
  assert.deepEqual(result.findings, []);
});

test("checker: a member taken other than by a direct call is unchecked", () => {
  const source = lines(
    "const { request } = plugin.wire;",
    'await request("clipboard.readText");',
    'await plugin.wire["request"]("clipboard.readText");',
  );
  const result = checkAll(source);
  assert.deepEqual(result.unchecked, ["3:11 Wire.request"]);
  // A direct call by element access is checked as one.
  assert.deepEqual(result.findings, [
    "5:21 Wire.request clipboard.readText clipboard",
  ]);
});

test("checker: a listener's event name is not read: no event needs a capability", () => {
  const source = lines(
    'plugin.player.on("source.state", () => {});',
    'plugin.player.on("bindings.changed", () => {});',
    'plugin.wire.on("video.upscaling.changed", () => {});',
    'plugin.wire.on("commands.execute", () => {});',
    "const name: string = String(Date.now());",
    "plugin.wire.on(name, () => {});",
    "const on = plugin.player.on;",
    'on("bindings.changed", () => {});',
  );
  const result = checkAll(source);
  assert.deepEqual(result.findings, []);
  assert.deepEqual(result.unchecked, []);
});

test("checker: wire.commands.register needs nothing", () => {
  const source = lines(
    'plugin.wire.commands.register({ id: "a", declaration: { title: "A" } });',
  );
  assert.deepEqual(checkAll(source).findings, []);
});

test("vestra-plugin check lists unchecked calls without failing", () => {
  const directory = project(
    {
      "main.ts": lines(
        "const pick = (name: string) => plugin.wire.request(name);",
        'void pick("clipboard.readText");',
      ),
    },
    [],
  );
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, "check", ...args], {
      cwd: directory,
      encoding: "utf8",
    });
  const plain = run();
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.match(
    plain.stdout,
    /main\.ts:3:46: unchecked: Wire\.request with a method name that is not one literal/,
  );
  const json = run("--json");
  assert.equal(json.status, 0, json.stderr);
  const [entry] = JSON.parse(json.stdout) as {
    findings: unknown[];
    unchecked: { api: string; line: number }[];
  }[];
  assert.deepEqual(entry!.findings, []);
  assert.deepEqual(
    entry!.unchecked.map((u) => [u.api, u.line]),
    [["Wire.request", 3]],
  );
});

test("isPluginSource leaves out tests, dependencies and declarations", () => {
  const base = "C:/p/plugin";
  assert.ok(isPluginSource(base, "C:/p/plugin/main.ts"));
  assert.ok(isPluginSource(base, "c:\\p\\plugin\\src\\ui.mts"));
  assert.ok(!isPluginSource(base, "C:/p/plugin/tests/main.test.ts"));
  assert.ok(!isPluginSource(base, "C:/p/plugin/node_modules/x/index.ts"));
  assert.ok(!isPluginSource(base, "C:/p/plugin/types.d.ts"));
  assert.ok(!isPluginSource(base, "C:/p/other/main.ts"));
  assert.ok(isPluginSource("/p/plugin", "/p/plugin/a.ts"));
  assert.ok(!isPluginSource("/p/plugin", "/P/plugin/a.ts"));
});

test("addCapabilityEdit keeps the array's layout", () => {
  const apply = (text: string) => {
    const edit = addCapabilityEdit(ts, text, "clipboard");
    assert.ok(edit);
    return (
      text.slice(0, edit.start) +
      edit.newText +
      text.slice(edit.start + edit.length)
    );
  };
  assert.equal(
    apply('{ "capabilities": ["player"] }'),
    '{ "capabilities": ["player", "clipboard"] }',
  );
  assert.equal(
    apply('{ "capabilities": [] }'),
    '{ "capabilities": ["clipboard"] }',
  );
  assert.equal(
    apply('{\n  "capabilities": [\n    "player"\n  ]\n}'),
    '{\n  "capabilities": [\n    "player",\n    "clipboard"\n  ]\n}',
  );
  // CRLF stays CRLF.
  assert.equal(
    apply('{\r\n  "capabilities": [\r\n    "player"\r\n  ]\r\n}'),
    '{\r\n  "capabilities": [\r\n    "player",\r\n    "clipboard"\r\n  ]\r\n}',
  );
  assert.equal(addCapabilityEdit(ts, '{ "id": "x" }', "clipboard"), undefined);
});

// ------------------------------------------------------------------ CLI

test("vestra-plugin check fails on an undeclared capability, with --json", () => {
  const directory = project({
    "main.ts": lines('await plugin.clipboard.writeText("x");'),
    // Tests may use anything: startPlugin takes its own capabilities.
    "tests/main.test.ts": [
      'import { startPlugin } from "@vestra-player/sdk/testing";',
      'import activate from "../main.ts";',
      "const { plugin } = await startPlugin(activate, { capabilities: [] });",
      'await plugin.secrets.get("x");',
    ].join("\n"),
  });
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [cli, "check", ...args], {
      cwd: directory,
      encoding: "utf8",
    });
  const plain = run();
  assert.equal(plain.status, 1, plain.stdout + plain.stderr);
  assert.match(
    plain.stderr,
    /main\.ts:3:26: Clipboard\.writeText needs the capability "clipboard", which manifest\.json does not declare \(request clipboard\.writeText\)/,
  );
  assert.match(
    plain.stderr,
    /1 use of undeclared capabilities; add "clipboard"/,
  );
  assert.doesNotMatch(plain.stderr, /Secrets/);

  const json = run("--json");
  assert.equal(json.status, 1);
  const [entry] = JSON.parse(json.stdout) as {
    directory: string;
    findings: { api: string; capability: string; line: number }[];
    error: string;
  }[];
  assert.equal(entry!.directory, ".");
  assert.deepEqual(
    entry!.findings.map((f) => [f.api, f.capability, f.line]),
    [["Clipboard.writeText", "clipboard", 3]],
  );
  assert.match(entry!.error, /undeclared capabilities/);

  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  );
  manifest.capabilities.push("clipboard");
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  const fixed = run("--json");
  assert.equal(fixed.status, 0, fixed.stderr);
  assert.deepEqual(JSON.parse(fixed.stdout)[0].findings, []);
  const again = run();
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /capabilities declared for every API use/);
});

// ------------------------------------------------------------------ ts-plugin

test("the TypeScript plugin reports the finding and fixes the manifest", () => {
  const directory = project(
    { "main.ts": lines("await plugin.bindings.list();") },
    ["clipboard"],
  );
  const file = join(directory, "main.ts").replaceAll("\\", "/");
  const host: ts.LanguageServiceHost = {
    getScriptFileNames: () => [file],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = ts.sys.readFile(name);
      return text === undefined
        ? undefined
        : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => directory,
    getCompilationSettings: () => OPTIONS,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  };
  const service = ts.createLanguageService(host);
  // Loaded the way the TypeScript server loads it: require() by name.
  const factory = createRequire(join(directory, "package.json"))(
    "@vestra-player/sdk/ts-plugin",
  ) as (modules: { typescript: typeof ts }) => ts.server.PluginModule;
  const plugin = factory({ typescript: ts }).create({
    languageService: service,
    languageServiceHost: host,
    config: {},
  } as unknown as ts.server.PluginCreateInfo);

  const diagnostics = plugin
    .getSemanticDiagnostics(file)
    .filter((d) => d.code === CAPABILITY_DIAGNOSTIC);
  assert.equal(diagnostics.length, 1);
  const [diagnostic] = diagnostics;
  assert.equal(diagnostic!.category, ts.DiagnosticCategory.Error);
  assert.equal(
    diagnostic!.messageText,
    'Bindings.list needs the capability "player", which manifest.json does not declare',
  );
  const text = readFileSync(file, "utf8");
  assert.equal(
    text.slice(diagnostic!.start!, diagnostic!.start! + diagnostic!.length!),
    "list",
  );
  assert.ok(
    plugin.getSupportedCodeFixes(file).includes(String(CAPABILITY_DIAGNOSTIC)),
  );

  const fixes = plugin.getCodeFixesAtPosition(
    file,
    diagnostic!.start!,
    diagnostic!.start! + diagnostic!.length!,
    [CAPABILITY_DIAGNOSTIC],
    {},
    {},
  );
  const fix = fixes.find((each) => each.fixName === "vestraAddCapability");
  assert.ok(fix);
  assert.equal(fix.description, "Add 'player' to manifest.json");
  const [change] = fix.changes;
  assert.equal(resolve(change!.fileName), resolve(directory, "manifest.json"));
  let manifest = readFileSync(change!.fileName, "utf8");
  for (const edit of [...change!.textChanges].reverse())
    manifest =
      manifest.slice(0, edit.span.start) +
      edit.newText +
      manifest.slice(edit.span.start + edit.span.length);
  assert.deepEqual(JSON.parse(manifest).capabilities, ["clipboard", "player"]);
  writeFileSync(change!.fileName, manifest);
  assert.deepEqual(
    plugin
      .getSemanticDiagnostics(file)
      .filter((d) => d.code === CAPABILITY_DIAGNOSTIC),
    [],
  );
});

test("the TypeScript plugin leaves files without a manifest alone", () => {
  const directory = mkdtempSync(join(tmpdir(), "vestra-capability-none-"));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  const file = join(directory, "x.ts").replaceAll("\\", "/");
  writeFileSync(file, "export const x: number = 1;\n");
  const service = ts.createLanguageService({
    getScriptFileNames: () => [file],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) =>
      ts.ScriptSnapshot.fromString(ts.sys.readFile(name) ?? ""),
    getCurrentDirectory: () => directory,
    getCompilationSettings: () => OPTIONS,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
  });
  const factory = createRequire(import.meta.url)(
    join(root, "ts-plugin/index.js"),
  ) as (modules: { typescript: typeof ts }) => ts.server.PluginModule;
  const plugin = factory({ typescript: ts }).create({
    languageService: service,
    config: {},
  } as unknown as ts.server.PluginCreateInfo);
  assert.deepEqual(plugin.getSemanticDiagnostics(file), []);
});

// A real TypeScript server, as an editor runs it: the plugin comes from the
// project's tsconfig.json, and manifest.json is a file the server was never
// given (editors do not hand it JSON files).
test("the TypeScript plugin in a real tsserver: diagnostic and quick fix", async () => {
  const directory = project(
    {
      "main.ts": lines("await plugin.bindings.list();"),
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          target: "ES2023",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          skipLibCheck: true,
          types: [],
          plugins: [{ name: "@vestra-player/sdk/ts-plugin" }],
        },
        include: ["*.ts"],
      }),
    },
    ["clipboard"],
  );
  const file = join(directory, "main.ts").replaceAll("\\", "/");
  const server = spawn(
    process.execPath,
    [
      createRequire(import.meta.url).resolve("typescript/lib/tsserver.js"),
      // Plugins next to the project, as with the workspace's TypeScript.
      "--allowLocalPluginLoads",
      "--disableAutomaticTypingAcquisition",
    ],
    { stdio: ["pipe", "pipe", "inherit"] },
  );
  test.after(() => server.kill());
  let buffer = "";
  const waiting = new Map<number, (body: unknown) => void>();
  server.stdout.setEncoding("utf8");
  server.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (;;) {
      const header = /Content-Length: (\d+)\r\n\r\n/.exec(buffer);
      if (!header) return;
      const start = header.index + header[0].length;
      const bytes = Buffer.from(buffer.slice(start), "utf8");
      const length = Number(header[1]);
      if (bytes.length < length) return;
      const message = JSON.parse(bytes.subarray(0, length).toString("utf8"));
      buffer = bytes.subarray(length).toString("utf8");
      if (message.type === "response")
        waiting.get(message.request_seq)?.(message);
    }
  });
  let seq = 0;
  const request = (command: string, args: unknown) =>
    new Promise<{ success: boolean; message?: string; body?: unknown }>(
      (done) => {
        seq += 1;
        waiting.set(seq, done as (body: unknown) => void);
        server.stdin.write(
          `${JSON.stringify({ seq, type: "request", command, arguments: args })}\n`,
        );
      },
    );
  await request("open", { file, projectRootPath: directory });
  const diagnostics = await request("semanticDiagnosticsSync", { file });
  assert.ok(diagnostics.success, diagnostics.message ?? "");
  const ours = (
    diagnostics.body as {
      code: number;
      text: string;
      start: { line: number; offset: number };
      end: { line: number; offset: number };
    }[]
  ).filter((d) => d.code === CAPABILITY_DIAGNOSTIC);
  assert.equal(ours.length, 1, JSON.stringify(diagnostics.body));
  const [found] = ours;
  assert.match(found!.text, /Bindings\.list needs the capability "player"/);
  const fixes = await request("getCodeFixes", {
    file,
    startLine: found!.start.line,
    startOffset: found!.start.offset,
    endLine: found!.end.line,
    endOffset: found!.end.offset,
    errorCodes: [CAPABILITY_DIAGNOSTIC],
  });
  assert.ok(fixes.success, fixes.message ?? "");
  const fix = (
    fixes.body as {
      fixName: string;
      description: string;
      changes: { fileName: string; textChanges: unknown[] }[];
    }[]
  ).find((each) => each.fixName === "vestraAddCapability");
  assert.ok(fix, JSON.stringify(fixes.body));
  assert.equal(fix.description, "Add 'player' to manifest.json");
  assert.equal(
    resolve(fix.changes[0]!.fileName),
    resolve(directory, "manifest.json"),
  );
  server.stdin.end();
});
