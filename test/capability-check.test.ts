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
import { API_REQUESTS } from "../src/api-requests.ts";
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
  RULES,
} from "../src/capability-rules.ts";
import type { CapabilityRules } from "../src/capability-rules.ts";
import { HOST_CAPABILITIES } from "../src/host-capabilities.ts";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "bin/vestra-plugin.mjs");
const none = () => false;

// ------------------------------------------------------------------ rules

test("requestNeeds follows the player's rules", () => {
  assert.equal(requestNeeds("clipboard.writeText", {}, none), "clipboard");
  // A prefix entry covers the prefix's other methods.
  assert.equal(requestNeeds("packages.uninstall", {}, none), "plugins.manage");
  assert.equal(requestNeeds("settings.register", {}, none), "ui.settings");
  // An exact entry wins over a prefix: packages.list needs nothing.
  assert.equal(requestNeeds("packages.list", {}, none), null);
  assert.equal(requestNeeds("storage.session.get", {}, none), null);
  assert.equal(requestNeeds("no.such.method", {}, none), undefined);
});

test("requestNeeds: Needs::Param by event name and by processing stage", () => {
  const subscribe = (event: string) =>
    requestNeeds("events.subscribe", { event }, none);
  assert.equal(subscribe("source.state"), "events");
  assert.equal(subscribe("bindings.changed"), "bindings.manage");
  assert.equal(subscribe("packages.changed"), null);
  const replace = (stage: string) =>
    requestNeeds("processing.replace", { stage }, none);
  assert.equal(replace("video"), "processing.video");
  assert.equal(replace("audio"), "processing.audio");
  // Without the parameter: the rule's `otherwise`.
  assert.equal(requestNeeds("events.subscribe", undefined, none), "events");
});

test("requestNeeds: Needs::IfDeclared", () => {
  const operation = (declared: string[]) =>
    requestNeeds("source.operation", {}, (name) => declared.includes(name));
  assert.equal(operation([]), "playback.read");
  assert.equal(operation(["playback.read"]), "playback.read");
  assert.equal(operation(["playback.control"]), "playback.control");
});

test("memberNeeds: direct needs, requires and the IfDeclared request", () => {
  const names = (api: string, declared: string[] = []) =>
    memberNeeds(api, declared)?.map((need) =>
      need.requiredBy
        ? `${need.capability}<${need.requiredBy}`
        : need.capability,
    );
  // source.operation is decided as if playback.control were declared.
  assert.deepEqual(names("Player.seek"), ["playback.control"]);
  assert.deepEqual(names("Player.openStream"), [
    "producer.av",
    "playback.control<producer.av",
  ]);
  assert.deepEqual(names("Plugin.audio.filter"), [
    "processing.audio",
    "playback.read<processing.audio",
    "events<processing.audio",
  ]);
  assert.deepEqual(names("Plugin.video.filter"), [
    "processing.video",
    "playback.read<processing.video",
    "events",
  ]);
  // media.read and media.control require each other: no loop.
  assert.deepEqual(names("MediaCapture.capture"), [
    "media.read",
    "media.control<media.read",
  ]);
  assert.deepEqual(names("Bindings.onChange"), ["bindings.manage"]);
  assert.deepEqual(names("Packages.onChange"), []);
  assert.equal(names("Player.isCurrent"), undefined);
});

test("memberNeeds: a member whose only request is IfDeclared", () => {
  const rules: CapabilityRules = {
    host: HOST_CAPABILITIES,
    apis: { "Player.query": [{ method: "source.operation" }] },
  };
  const names = (declared: string[]) =>
    memberNeeds("Player.query", declared, rules)?.map((n) => n.capability);
  assert.deepEqual(names([]), ["playback.read"]);
  assert.deepEqual(names(["playback.control"]), ["playback.control"]);
});

test("memberNeeds: IfDeclared rules read each other's answers until they settle (MediaSources.open)", () => {
  const names = (api: string, declared: string[]) =>
    memberNeeds(api, declared)?.map((need) => need.capability);
  const missing = (api: string, declared: string[]) =>
    names(api, declared)?.filter((name) => !declared.includes(name));
  // media.sources.open asks for playback.control until it is declared,
  // then for media.sources; source.operation then needs playback.control,
  // not playback.read.
  assert.deepEqual(names("MediaSources.open", []), [
    "media.sources",
    "playback.control",
  ]);
  assert.deepEqual(missing("MediaSources.open", ["media.sources"]), [
    "playback.control",
  ]);
  assert.deepEqual(missing("MediaSources.open", ["playback.control"]), [
    "media.sources",
  ]);
  assert.deepEqual(
    missing("MediaSources.open", ["media.sources", "playback.control"]),
    [],
  );
  // Members that settled in one round are unchanged.
  for (const declared of [[], ["playback.read"], ["playback.control"]]) {
    assert.deepEqual(names("Player.seek", declared), ["playback.control"]);
    assert.deepEqual(names("Player.open", declared), ["playback.control"]);
  }
  assert.deepEqual(names("MediaSources.list", []), ["media.sources"]);
  // Each need names the request that first asked for it: playback.control
  // is media.sources.open's, not source.operation's (which asks for it only
  // once it counts as declared).
  const methods = (declared: string[]) =>
    memberNeeds("MediaSources.open", declared)?.map(
      (need) => `${need.capability}:${need.method}`,
    );
  assert.deepEqual(methods([]), [
    "media.sources:media.sources.open",
    "playback.control:media.sources.open",
  ]);
  assert.deepEqual(methods(["media.sources"]), [
    "media.sources:media.sources.open",
    "playback.control:media.sources.open",
  ]);
  // Two rules that answer each other in turn: every round's needs are kept.
  const rules: CapabilityRules = {
    host: {
      ...HOST_CAPABILITIES,
      uncapable: [
        ...HOST_CAPABILITIES.uncapable,
        {
          name: "test.flip",
          needs: {
            ifDeclared: "clipboard",
            // oxlint-disable-next-line unicorn/no-thenable -- IfDeclared's field
            then: "events",
            otherwise: "clipboard",
          },
        },
        {
          name: "test.flop",
          needs: {
            ifDeclared: "events",
            // oxlint-disable-next-line unicorn/no-thenable -- IfDeclared's field
            then: "playback.read",
            otherwise: "events",
          },
        },
      ],
    },
    apis: { "Test.both": [{ method: "test.flip" }, { method: "test.flop" }] },
  };
  const both = memberNeeds("Test.both", [], rules)?.map((n) => n.capability);
  assert.ok(
    both?.includes("clipboard") && both.includes("events"),
    String(both),
  );
});

test("requestsNeed: a lone media.sources.open (plugin.wire.request) needs both, the rounds only adding", () => {
  // Alone, the rule answers playback.control with nothing declared and
  // media.sources once playback.control is: the needs keep both.
  const requests = argumentRequests("method", "media.sources.open");
  assert.deepEqual(requests, [{ method: "media.sources.open" }]);
  const names = (declared: string[]) =>
    requestsNeed(requests!, declared).map((need) => need.capability);
  assert.deepEqual(names([]), ["media.sources", "playback.control"]);
  assert.deepEqual(names(["media.sources"]), [
    "media.sources",
    "playback.control",
  ]);
  assert.deepEqual(names(["playback.control"]), ["media.sources"]);
  assert.deepEqual(names(["media.sources", "playback.control"]), [
    "media.sources",
  ]);
});

test("API_REQUESTS names methods the player knows, with the parameters its rules read", () => {
  for (const [api, requests] of Object.entries(API_REQUESTS))
    for (const request of requests) {
      const entry = hostMethod(request.method);
      assert.ok(entry, `${api}: the player knows ${request.method}`);
      const needs = entry.needs;
      if (typeof needs === "object" && needs !== null && "param" in needs)
        assert.ok(
          request.params?.[needs.param] !== undefined,
          `${api}: ${request.method} gives "${needs.param}"`,
        );
      for (const key of Object.keys(request.params ?? {}))
        assert.ok(
          typeof needs === "object" && needs !== null && "param" in needs
            ? needs.param === key
            : false,
          `${api}: ${request.method} has no rule reading "${key}"`,
        );
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
    assert.equal(info.risky, capability.risky);
    assert.deepEqual(info.requires, capability.requires);
  }
  assert.ok(Object.isFrozen(CAPABILITY_INFO["events"]!.apis));
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
  capabilities: string[] = ["commands"],
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
  capabilities: string[] = ["commands"],
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
      `${finding.line}:${finding.column} ${finding.api} ${finding.capability}${finding.requiredBy ? `<${finding.requiredBy}` : ""}`,
  );
}

const lines = (...body: string[]) =>
  [
    'import type { Plugin, Player, Panel } from "@vestra-player/sdk";',
    "export default async function activate(plugin: Plugin) {",
    ...body.map((line) => `  ${line}`),
    "}",
  ].join("\n");

test("checker: declared and undeclared", () => {
  const source = lines(
    'await plugin.clipboard.writeText("x");',
    'plugin.commands.add({ id: "a", title: "A", run() {} });',
  );
  assert.deepEqual(check(source, ["commands"]), [
    "3:26 Clipboard.writeText clipboard",
  ]);
  assert.deepEqual(check(source, ["commands", "clipboard"]), []);
});

test("checker: through aliases, destructuring, parameters and element access", () => {
  const source = [
    'import type { Plugin, Player } from "@vestra-player/sdk";',
    "const seek = (player: Player) => player.seek(1);",
    "export default async function activate(plugin: Plugin) {",
    "  const { player, secrets: vault } = plugin;",
    "  const p = player;",
    "  await p.setPaused(true);",
    '  await vault.get("token");',
    "  const { setRate } = plugin.player;",
    "  void setRate;",
    '  await plugin.clipboard["readText"]();',
    "  await seek(plugin.player);",
    "}",
  ].join("\n");
  assert.deepEqual(check(source, []), [
    "2:41 Player.seek playback.control",
    "6:11 Player.setPaused playback.control",
    "7:15 Secrets.get secrets",
    "8:11 Player.setRate playback.control",
    "10:26 Clipboard.readText clipboard",
  ]);
});

test("checker: listeners by event name, filters by stage, requires", () => {
  const source = lines(
    "plugin.player.onChange(() => {});",
    "plugin.bindings.onChange(() => {});",
    "plugin.packages.onChange(() => {});",
    'plugin.audio.filter("a");',
    'plugin.video.filter("v");',
  );
  assert.deepEqual(check(source, []), [
    "3:17 Player.onChange events",
    "4:19 Bindings.onChange bindings.manage",
    "6:16 Plugin.audio.filter processing.audio",
    "6:16 Plugin.audio.filter playback.read<processing.audio",
    "6:16 Plugin.audio.filter events<processing.audio",
    "7:16 Plugin.video.filter processing.video",
    "7:16 Plugin.video.filter playback.read<processing.video",
    "7:16 Plugin.video.filter events",
  ]);
  assert.deepEqual(
    check(source, [
      "events",
      "bindings.manage",
      "processing.audio",
      "processing.video",
      "playback.read",
    ]),
    [],
  );
});

test("checker: Needs::IfDeclared against the manifest", () => {
  const rules: CapabilityRules = {
    host: HOST_CAPABILITIES,
    apis: {
      ...API_REQUESTS,
      "Player.refresh": [{ method: "source.operation" }],
    },
  };
  const source = lines("await plugin.player.refresh();");
  assert.deepEqual(check(source, [], rules), [
    "3:23 Player.refresh playback.read",
  ]);
  assert.deepEqual(check(source, ["playback.read"], rules), []);
  assert.deepEqual(check(source, ["playback.control"], rules), []);
});

test("checker: members of returned objects, getters and what is not detected", () => {
  const source = lines(
    'const panel: Panel = plugin.panels.mount("sidebar", "ui/a.slint");',
    "panel.onChange(() => {});",
    "void plugin.player.state;",
    'const name = "open" as string;',
    "void (plugin.player as unknown as Record<string, unknown>)[name];",
    "const loose: any = plugin.player;",
    'loose.open("x");',
  );
  assert.deepEqual(check(source, ["ui.mount"]), [
    "4:9 Panel.onChange events",
    "5:22 Player.state playback.read",
  ]);
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
      (f) =>
        `${f.line}:${f.column} ${f.api} ${f.method} ${f.capability}${f.requiredBy ? `<${f.requiredBy}` : ""}`,
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
    'await plugin.wire.request("producer.prepare", {});',
    'await plugin.wire.request("packages.list");',
  );
  const result = checkAll(source);
  assert.deepEqual(result.findings, [
    "3:21 Wire.request ui.setMount ui.mount",
    "5:21 Wire.request clipboard.readText clipboard",
    "6:21 Wire.request events.subscribe bindings.manage",
    "7:21 Wire.request producer.prepare producer.av",
    "7:21 Wire.request producer.prepare playback.control<producer.av",
  ]);
  assert.match(
    result.messages[0]!,
    /^Wire\.request\("ui\.setMount"\) needs the capability "ui\.mount", which manifest\.json does not declare$/,
  );
  assert.deepEqual(result.unchecked, []);
  assert.deepEqual(
    checkAll(source, [
      "ui.mount",
      "clipboard",
      "bindings.manage",
      "producer.av",
      "playback.control",
    ]).findings,
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
    'const kind = Math.random() > 0.5 ? "bindings.changed" : "source.state";',
    "plugin.player.on(kind, () => {});",
  );
  const result = checkAll(source);
  // A union could be any of its names: unchecked, not an error (review L5).
  assert.deepEqual(result.unchecked, [
    "3:46 Wire.request",
    "5:21 Wire.request",
    "7:21 Wire.request",
    "9:17 Player.on",
  ]);
  assert.deepEqual(result.findings, []);
});

test("checker: a member taken other than by a direct call is unchecked", () => {
  const source = lines(
    "const { request } = plugin.wire;",
    'await request("clipboard.readText");',
    "const on = plugin.player.on;",
    'on("bindings.changed", () => {});',
    "const { on: listen } = plugin.wire;",
    'listen("source.state", () => {});',
    'await plugin.wire["request"]("clipboard.readText");',
  );
  const result = checkAll(source);
  assert.deepEqual(result.unchecked, [
    "3:11 Wire.request",
    "5:28 Player.on",
    "7:11 Wire.on",
  ]);
  // A direct call by element access is checked as one.
  assert.deepEqual(result.findings, [
    "9:21 Wire.request clipboard.readText clipboard",
  ]);
});

test("checker: player.on and wire.on by a literal event name (SDK 1.7.0)", () => {
  const source = lines(
    'plugin.player.on("source.state", () => {});',
    'plugin.player.on("bindings.changed", () => {});',
    'plugin.player.on("packages.changed", () => {});',
    'plugin.wire.on("video.upscaling.changed", () => {});',
    'plugin.wire.on("commands.execute", () => {});',
    "const name: string = String(Date.now());",
    "plugin.wire.on(name, () => {});",
  );
  const result = checkAll(source);
  assert.deepEqual(result.findings, [
    "3:17 Player.on events.subscribe events",
    "4:17 Player.on events.subscribe bindings.manage",
    "6:15 Wire.on events.subscribe video.upscaling",
  ]);
  // `commands.execute` arrives unasked: nothing to declare.
  assert.deepEqual(result.unchecked, ["9:15 Wire.on"]);
  assert.deepEqual(
    checkAll(source, ["events", "bindings.manage", "video.upscaling"]).findings,
    [],
  );
});

test("checker: wire.commands.register needs commands", () => {
  const source = lines(
    'plugin.wire.commands.register({ id: "a", declaration: { title: "A" } });',
  );
  assert.deepEqual(checkAll(source).findings, [
    "3:24 WireCommands.register commands.register commands",
  ]);
});

test("checker: media.sources.open without playback.control names media.sources.open", () => {
  const source = lines('await plugin.media.sources.open("x");');
  for (const declared of [[], ["media.sources"]])
    assert.deepEqual(
      checkAll(source, declared).findings.filter((f) =>
        f.endsWith("playback.control"),
      ),
      ["3:30 MediaSources.open media.sources.open playback.control"],
    );
  const directory = project({ "main.ts": source }, ["media.sources"]);
  const run = spawnSync(process.execPath, [cli, "check"], {
    cwd: directory,
    encoding: "utf8",
  });
  assert.equal(run.status, 1, run.stdout + run.stderr);
  assert.match(
    run.stderr,
    /main\.ts:3:30: MediaSources\.open needs the capability "playback\.control", which manifest\.json does not declare \(request media\.sources\.open\)/,
  );
  assert.doesNotMatch(run.stderr, /source\.operation/);
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
    const edit = addCapabilityEdit(ts, text, "events");
    assert.ok(edit);
    return (
      text.slice(0, edit.start) +
      edit.newText +
      text.slice(edit.start + edit.length)
    );
  };
  assert.equal(
    apply('{ "capabilities": ["commands"] }'),
    '{ "capabilities": ["commands", "events"] }',
  );
  assert.equal(
    apply('{ "capabilities": [] }'),
    '{ "capabilities": ["events"] }',
  );
  assert.equal(
    apply('{\n  "capabilities": [\n    "commands"\n  ]\n}'),
    '{\n  "capabilities": [\n    "commands",\n    "events"\n  ]\n}',
  );
  // CRLF stays CRLF.
  assert.equal(
    apply('{\r\n  "capabilities": [\r\n    "commands"\r\n  ]\r\n}'),
    '{\r\n  "capabilities": [\r\n    "commands",\r\n    "events"\r\n  ]\r\n}',
  );
  assert.equal(addCapabilityEdit(ts, '{ "id": "x" }', "events"), undefined);
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
    { "main.ts": lines("plugin.player.onChange(() => {});") },
    ["commands"],
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
    'Player.onChange needs the capability "events", which manifest.json does not declare',
  );
  const text = readFileSync(file, "utf8");
  assert.equal(
    text.slice(diagnostic!.start!, diagnostic!.start! + diagnostic!.length!),
    "onChange",
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
  assert.equal(fix.description, "Add 'events' to manifest.json");
  const [change] = fix.changes;
  assert.equal(resolve(change!.fileName), resolve(directory, "manifest.json"));
  let manifest = readFileSync(change!.fileName, "utf8");
  for (const edit of [...change!.textChanges].reverse())
    manifest =
      manifest.slice(0, edit.span.start) +
      edit.newText +
      manifest.slice(edit.span.start + edit.span.length);
  assert.deepEqual(JSON.parse(manifest).capabilities, ["commands", "events"]);
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
      "main.ts": lines("plugin.player.onChange(() => {});"),
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
    ["commands"],
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
  assert.match(found!.text, /Player\.onChange needs the capability "events"/);
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
  assert.equal(fix.description, "Add 'events' to manifest.json");
  assert.equal(
    resolve(fix.changes[0]!.fileName),
    resolve(directory, "manifest.json"),
  );
  server.stdin.end();
});
