// plugin.mpv (SDK 1.8.0): the pass-through's contract. The members and
// their messages, the refusal table (src/mpv.ts, shared with the player),
// filter label ownership, observers, and TestHost's model of them.
import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_INFO,
  startPlugin,
  TestHost,
} from "../src/plugin/testing.ts";
import type { MpvValue, Plugin, PluginError } from "../src/plugin/index.ts";
import { hostMethod } from "../src/capability-rules.ts";
import { HOST_CAPABILITIES } from "../src/host-capabilities.ts";
import { CAPABILITIES } from "../src/player-runtime.ts";
import {
  MPV_LIMITS,
  MPV_RULES,
  mpvCommandProblem,
  mpvCommandRefusal,
  mpvPropertyRefusal,
} from "../src/mpv.ts";

async function started(
  capabilities: string[] = ["mpv"],
  host = new TestHost(),
) {
  const errors: PluginError[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => void errors.push(error));
    },
    { capabilities, host, id: "test.mpv" },
  );
  return { host, plugin, stop, errors };
}
const code = (expected: string, message?: RegExp) => (error: PluginError) =>
  error.code === expected && (!message || message.test(error.message));

test("mpv is one risky capability of its own: the table's row, its five methods and CAPABILITY_INFO", () => {
  // The row as the player generates it: the last one of its table.
  assert.deepEqual(HOST_CAPABILITIES.capabilities.at(-1), {
    builtinOnly: false,
    label:
      "Control the playback engine (mpv) directly: send its commands and change its options",
    methods: [
      { name: "mpv.command", needs: "mpv" },
      { name: "mpv.get", needs: "mpv" },
      { name: "mpv.set", needs: "mpv" },
      { name: "mpv.observe", needs: "mpv" },
      { name: "mpv.unobserve", needs: "mpv" },
    ],
    name: "mpv",
    requires: [],
    residency: "live",
    risky: true,
  });
  for (const name of [
    "mpv.command",
    "mpv.get",
    "mpv.set",
    "mpv.observe",
    "mpv.unobserve",
  ])
    assert.deepEqual(hostMethod(name), { name, needs: "mpv" });
  assert.deepEqual(CAPABILITY_INFO["mpv"], {
    apis: ["Mpv.command", "Mpv.get", "Mpv.set", "Mpv.observe"],
    requires: [],
    label:
      "Control the playback engine (mpv) directly: send its commands and change its options",
    risky: true,
    builtinOnly: false,
  });
  assert.equal(CAPABILITIES.at(-1), "mpv");
  // It opens no member of another module, and no other capability opens
  // one of its own.
  for (const [name, info] of Object.entries(CAPABILITY_INFO))
    if (name !== "mpv")
      assert.ok(!info.apis.some((api) => api.startsWith("Mpv.")), name);
});

test("without mpv every member fails capability and nothing is sent", async () => {
  const { host, plugin, stop } = await started([]);
  await assert.rejects(
    plugin.mpv.command(["drop-buffers"]),
    code("capability"),
  );
  await assert.rejects(plugin.mpv.get("deband"), code("capability"));
  await assert.rejects(plugin.mpv.set("deband", true), code("capability"));
  assert.throws(
    () => plugin.mpv.observe("deband", () => {}),
    code("capability"),
  );
  assert.ok(!host.calls.some((call) => call.method.startsWith("mpv.")));
  await stop();
});

test("command, get and set go to mpv as they are", async () => {
  const { host, plugin, stop } = await started();
  host.mpv.properties.set("hwdec-current", "d3d11va");
  assert.equal(await plugin.mpv.command(["drop-buffers"]), null);
  await plugin.mpv.command(["set", "deband", "yes"]);
  await plugin.mpv.command([
    "cycle-values",
    "!reverse",
    "scale",
    "bilinear",
    "spline36",
  ]);
  await plugin.mpv.command(["add", "deband-iterations", 1]);
  assert.deepEqual(host.mpv.commands, [
    ["drop-buffers"],
    ["set", "deband", "yes"],
    ["cycle-values", "!reverse", "scale", "bilinear", "spline36"],
    ["add", "deband-iterations", 1],
  ]);
  assert.deepEqual(
    host.calls.find((c) => c.method === "mpv.command"),
    {
      method: "mpv.command",
      params: { args: ["drop-buffers"] },
    },
  );
  assert.equal(await plugin.mpv.get("hwdec-current"), "d3d11va");
  await plugin.mpv.set("deband", true);
  assert.equal(await plugin.mpv.get("deband"), true);
  await plugin.mpv.set("options/scale", "ewa_lanczossharp");
  assert.equal(host.mpv.properties.get("options/scale"), "ewa_lanczossharp");
  // mpv's own error, passed on.
  await assert.rejects(
    plugin.mpv.get("no-such-property"),
    code("backend", /^mpv: property not found$/),
  );
  await stop();
});

test("the shape is checked before anything is sent (invalid)", async () => {
  const { host, plugin, stop } = await started();
  const bad = [
    [],
    "drop-buffers",
    [1],
    ["no-osd set deband yes"],
    ["set", "deband", null],
    ["set", "deband", { on: true }],
    ["set", "deband", Number.NaN],
    Array(MPV_LIMITS.args + 1).fill("ignore"),
  ];
  for (const args of bad)
    await assert.rejects(
      plugin.mpv.command(args as never),
      code("invalid"),
      JSON.stringify(args),
    );
  assert.equal(mpvCommandProblem(Array(MPV_LIMITS.args).fill("ignore")), null);
  for (const name of ["", "has space", 5, "x".repeat(MPV_LIMITS.nameChars + 1)])
    await assert.rejects(plugin.mpv.get(name as string), code("invalid"));
  await assert.rejects(
    plugin.mpv.set("deband", undefined as unknown as MpvValue),
    code("invalid"),
  );
  assert.throws(
    () => plugin.mpv.observe("deband", undefined as never),
    code("invalid"),
  );
  assert.ok(!host.calls.some((call) => call.method.startsWith("mpv.")));
  await stop();
});

test("refused: every command and property of the table, by its category's words", async () => {
  const { host, plugin, stop } = await started();
  for (const [name, category] of Object.entries(MPV_RULES.commands))
    await assert.rejects(
      plugin.mpv.command([name, "x"]),
      (error: PluginError) =>
        error.code === "refused" &&
        error.message ===
          `mpv command ${JSON.stringify(name)} is refused: ${MPV_RULES.categories[category]}`,
      name,
    );
  for (const [name, category] of Object.entries(MPV_RULES.properties)) {
    const message = `mpv property ${JSON.stringify(name)} is refused: ${MPV_RULES.categories[category]}`;
    await assert.rejects(plugin.mpv.set(name, "x"), code("refused"), name);
    assert.equal(mpvPropertyRefusal(name, true), message);
    // The commands that write a property are checked as a write of it.
    for (const writer of MPV_RULES.writers)
      assert.equal(mpvCommandRefusal([writer, name, "x"]), message, writer);
    // A read is refused only for the clipboard.
    assert.equal(
      mpvPropertyRefusal(name, false) !== null,
      category === "clipboard",
      name,
    );
  }
  assert.ok(!host.calls.some((call) => call.method.startsWith("mpv.")));
  await stop();
});

test("refused: prefixes, option paths, sub-properties and cycle-values' !reverse", () => {
  const refused = (name: string) => mpvPropertyRefusal(name, true) !== null;
  for (const name of [
    "input-ipc-server",
    "input-default-bindings",
    "load-scripts",
    "screenshot-directory",
    "watch-later-directory",
    "sub-font-size",
    "secondary-sub-pos",
    "playlist-pos",
    "autofit-larger",
    "clipboard-backends",
    "options/pause",
    "file-local-options/vf",
    "clipboard/text",
    // What the player writes itself.
    "interpolation",
    "keepaspect",
    "panscan",
    "video-rotate",
    "lavfi-complex",
  ])
    assert.ok(refused(name), name);
  for (const [name, category] of [
    ["hook-add", "clients"],
    ["hook-continue", "clients"],
    ["sub-step", "managed"],
  ] as const)
    assert.equal(MPV_RULES.commands[name], category, name);
  // A message to a filter without a label is a wrong shape, not a refusal.
  for (const name of ["vf-command", "af-command"]) {
    for (const args of [[name], [name, 1, "x"], [name, true]])
      assert.equal(
        mpvCommandProblem(args),
        "vf-command and af-command take a filter label as their first argument",
        JSON.stringify(args),
      );
    assert.equal(mpvCommandProblem([name, "crisp", "strength", "0.4"]), null);
  }
  // The first matching prefix decides: a control channel, not input.
  assert.match(
    mpvPropertyRefusal("input-ipc-server", true)!,
    /control channel/,
  );
  for (const name of [
    "deband",
    "scale",
    "tscale",
    "video-params/w",
    "estimated-vf-fps",
    "demuxer-max-bytes",
    "subs-with-matching-audio",
  ])
    assert.ok(!refused(name), name);
  assert.match(
    mpvCommandRefusal(["cycle-values", "!reverse", "pause", "yes", "no"])!,
    /^mpv property "pause" is refused/,
  );
  assert.equal(
    mpvCommandRefusal(["cycle-values", "deband", "yes", "no"]),
    null,
  );
  // Reading what the player manages is fine.
  assert.equal(mpvPropertyRefusal("pause", false), null);
  assert.equal(mpvPropertyRefusal("vf", false), null);
  // A command the table does not name goes to mpv.
  for (const name of [
    "drop-buffers",
    "expand-text",
    "print-text",
    "ignore",
    "ao-reload",
  ])
    assert.equal(mpvCommandRefusal([name]), null, name);
});

test("a command's name is looked up as mpv reads it (_ for -); the refusal keeps the caller's spelling; properties are not folded", async () => {
  const { host, plugin, stop } = await started();
  assert.equal(
    mpvCommandRefusal(["quit_watch_later"]),
    'mpv command "quit_watch_later" is refused: it ends the player',
  );
  await assert.rejects(
    plugin.mpv.command(["quit_watch_later"]),
    code(
      "refused",
      /^mpv command "quit_watch_later" is refused: it ends the player$/,
    ),
  );
  // Every command of the table, spelled with underscores.
  for (const [name, category] of Object.entries(MPV_RULES.commands)) {
    const spelled = name.replaceAll("-", "_");
    assert.equal(
      mpvCommandRefusal([spelled, "x"]),
      `mpv command ${JSON.stringify(spelled)} is refused: ${MPV_RULES.categories[category]}`,
      spelled,
    );
  }
  // The writers: checked as a write of their property.
  assert.match(
    mpvCommandRefusal(["cycle_values", "!reverse", "pause", "yes", "no"])!,
    /^mpv property "pause" is refused/,
  );
  assert.match(
    mpvCommandRefusal(["change_list", "vf", "append", "hflip"])!,
    /^mpv property "vf" is refused/,
  );
  assert.equal(
    mpvCommandRefusal(["cycle_values", "deband", "yes", "no"]),
    null,
  );
  // The filter messages: the missing label, the owner's label.
  for (const name of ["vf_command", "af_command"]) {
    assert.equal(
      mpvCommandProblem([name]),
      "vf-command and af-command take a filter label as their first argument",
    );
    assert.match(
      mpvCommandRefusal([name, "vestra-motion", "x", "y"])!,
      new RegExp(`^mpv command "${name}" is refused: a plugin changes only`),
    );
    assert.equal(mpvCommandRefusal([name, "crisp", "x", "y"]), null);
  }
  // Nothing else is folded: mpv knows no command of another case.
  assert.equal(mpvCommandRefusal(["QUIT"]), null);
  assert.equal(mpvCommandRefusal(["SET", "pause", "yes"]), null);
  // A property's name is looked up as written: mpv does not fold it, and
  // an underscore is part of a sub-path (user-data/my_key).
  for (const name of ["sub_delay", "Pause", "PAUSE", "input_ipc_server"])
    assert.equal(mpvPropertyRefusal(name, true), null, name);
  assert.equal(mpvCommandRefusal(["set", "sub_delay", "1"]), null);
  assert.ok(!host.calls.some((call) => call.method.startsWith("mpv.")));
  await stop();
});

test("the label all is reserved (mpv reads it as every filter); ALL and all2 are ordinary labels", async () => {
  const { host, plugin, stop } = await started();
  assert.deepEqual([...MPV_RULES.reservedLabels], ["all"]);
  assert.equal(MPV_RULES.reservedLabel, "vestra-");
  for (const stage of ["vf", "af"]) {
    for (const args of [
      [stage, "add", "@all:hflip"],
      [stage, "add", "@all"],
      [stage, "toggle", "@all"],
      [stage, "remove", "@all"],
      [`${stage}-command`, "all", "strength", "0.4"],
      [`${stage}_command`, "all", "strength", "0.4"],
    ])
      await assert.rejects(
        plugin.mpv.command(args),
        code("refused", /a plugin changes only its own labelled filters/),
        JSON.stringify(args),
      );
    assert.equal(host.mpv.labels.size, 0);
    for (const label of ["ALL", "all2", "All", "overall"]) {
      await plugin.mpv.command([stage, "add", `@${label}:hflip`]);
      assert.equal(host.mpv.labels.get(`${stage}/${label}`), "test.mpv");
      await plugin.mpv.command([`${stage}-command`, label, "x", "y"]);
      await plugin.mpv.command([stage, "remove", `@${label}`]);
    }
  }
  assert.equal(host.mpv.labels.size, 0);
  await stop();
});

test("the P2 additions: what the player writes or reports itself, and the prefixes in the player's order", () => {
  for (const [name, category] of [
    ["use-filedir-conf", "code"],
    ["volume-gain", "managed"],
    ["ao-volume", "managed"],
    ["ao-mute", "managed"],
    ["shuffle", "managed"],
    ["chapter-list", "managed"],
    ["video-crop", "managed"],
    ["video-scale-x", "managed"],
    ["video-scale-y", "managed"],
    ["alang", "managed"],
    ["slang", "managed"],
    ["vlang", "managed"],
  ] as const) {
    assert.equal(MPV_RULES.properties[name], category, name);
    assert.equal(
      mpvPropertyRefusal(name, true),
      `mpv property ${JSON.stringify(name)} is refused: ${MPV_RULES.categories[category]}`,
    );
    // Reading stays open.
    assert.equal(mpvPropertyRefusal(name, false), null, name);
  }
  assert.deepEqual(Object.entries(MPV_RULES.propertyPrefixes), [
    ["input-ipc-", "clients"],
    ["input-", "input"],
    ["load-", "code"],
    ["clipboard-", "clipboard"],
    ["screenshot-", "files"],
    ["watch-later-", "files"],
    ["playlist-", "managed"],
    ["autofit", "managed"],
    ["video-align-", "managed"],
    ["sub-", "managed"],
    ["secondary-sub-", "managed"],
  ]);
  for (const name of ["video-align-x", "video-align-y"])
    assert.match(mpvPropertyRefusal(name, true)!, /manages/, name);
  // Not in the table: mpv answers for it.
  assert.equal(mpvPropertyRefusal("video-margin-ratio-left", true), null);
});

test("filters: only the plugin's own labelled filter; the player's labels and whole-chain changes are refused", async () => {
  const { host, plugin, stop } = await started();
  for (const stage of ["vf", "af"]) {
    await plugin.mpv.command([stage, "add", "@crisp:lavfi=[cas=strength=0.6]"]);
    assert.equal(host.mpv.labels.get(`${stage}/crisp`), "test.mpv");
    await plugin.mpv.command([`${stage}-command`, "crisp", "strength", "0.4"]);
    await plugin.mpv.command([stage, "toggle", "@crisp"]);
    assert.equal(host.mpv.labels.has(`${stage}/crisp`), false);
    await plugin.mpv.command([stage, "pre", "@first:hflip"]);
    await plugin.mpv.command([stage, "remove", "@first"]);
    assert.equal(host.mpv.labels.size, 0);
    for (const args of [
      [stage, "add", "hflip"], // no label
      [stage, "add", "@vestra-owned:lavfi=[hflip]"], // the player's
      [stage, "remove", "@vestra-upscale"],
      [stage, "set", "@mine:hflip"], // replaces the chain
      [stage, "clr", ""],
      [stage, "del", "0"],
      [stage, "add", `@${"x".repeat(MPV_LIMITS.labelChars + 1)}:hflip`],
      [stage, "add", "@bad label:hflip"],
      [stage, "add"],
      [`${stage}-command`, "vestra-motion", "x", "y"],
    ])
      await assert.rejects(
        plugin.mpv.command(args),
        code("refused", /a plugin changes only its own labelled filters/),
        JSON.stringify(args),
      );
  }
  // The chain as a whole is the player's.
  await assert.rejects(
    plugin.mpv.set("vf", "hflip"),
    code("refused", /manages/),
  );
  await assert.rejects(
    plugin.mpv.command(["change-list", "vf", "append", "hflip"]),
    code("refused", /manages/),
  );
  // Another plugin's label.
  host.mpv.labels.set("vf/theirs", "someone.else");
  for (const operation of ["add", "toggle", "remove"])
    await assert.rejects(
      plugin.mpv.command(["vf", operation, "@theirs:hflip"]),
      code("conflict", /@theirs belongs to someone\.else/),
    );
  assert.equal(host.mpv.labels.get("vf/theirs"), "someone.else");
  await stop();
});

test("observe: the current value first, then each change; one request per name; ends with the handle", async () => {
  const { host, plugin, stop, errors } = await started();
  host.mpv.properties.set("estimated-vf-fps", 23.976);
  const seen: MpvValue[] = [];
  const also: MpvValue[] = [];
  const first = plugin.mpv.observe("estimated-vf-fps", (value) =>
    seen.push(value),
  );
  const second = plugin.mpv.observe("estimated-vf-fps", (value) =>
    also.push(value),
  );
  await host.settle();
  assert.deepEqual(seen, [23.976]);
  assert.deepEqual(host.sent("mpv.observe"), [{ name: "estimated-vf-fps" }]);
  host.setMpvProperty("estimated-vf-fps", 59.94);
  // The plugin's own set reaches its observers too, as mpv's change does.
  await plugin.mpv.set("estimated-vf-fps", 60);
  host.setMpvProperty("container-fps", 24); // not observed
  await host.settle();
  assert.deepEqual(seen, [23.976, 59.94, 60]);
  assert.deepEqual(also, seen);
  await first.dispose();
  assert.deepEqual(host.sent("mpv.unobserve"), [], "a listener is left");
  host.setMpvProperty("estimated-vf-fps", 30);
  await host.settle();
  assert.deepEqual(seen, [23.976, 59.94, 60]);
  assert.deepEqual(also.at(-1), 30);
  await second.dispose();
  assert.deepEqual(host.sent("mpv.unobserve"), [{ name: "estimated-vf-fps" }]);
  assert.equal(host.mpv.observed.size, 0);
  // A property without a value: null.
  const none: MpvValue[] = [];
  plugin.mpv.observe("video-params/w", (value) => none.push(value));
  await host.settle();
  assert.deepEqual(none, [null]);
  // The clipboard is not read through mpv.
  assert.throws(
    () => plugin.mpv.observe("clipboard/text", () => {}),
    code("refused"),
  );
  assert.deepEqual(errors, []);
  await stop();
});

test("observe: at most 64 properties (limit, through onError); the scope ends its observers", async () => {
  const host = new TestHost();
  const errors: PluginError[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => void errors.push(error));
    },
    { capabilities: ["mpv"], host },
  );
  const scope = plugin.scope();
  for (let i = 0; i < MPV_LIMITS.observed; i++)
    scope.mpv.observe(`user-data/n${i}`, () => {});
  await host.settle();
  assert.equal(host.mpv.observed.size, MPV_LIMITS.observed);
  assert.deepEqual(errors, []);
  plugin.mpv.observe("user-data/one-more", () => {});
  await host.settle();
  assert.deepEqual(
    (errors as PluginError[]).map((error) => error.code),
    ["limit"],
  );
  await scope.dispose();
  await host.settle();
  assert.equal(host.mpv.observed.size, 0);
  await stop();
});

test("TestHost applies the same table to a raw request (plugin.wire.request)", async () => {
  const { host, plugin, stop } = await started();
  await assert.rejects(
    plugin.wire.request("mpv.command", { args: ["run", "calc.exe"] }),
    code("refused", /^mpv command "run" is refused: it starts a program/),
  );
  await assert.rejects(
    plugin.wire.request("mpv.set", { name: "pause", value: true }),
    code("refused"),
  );
  await assert.rejects(
    plugin.wire.request("mpv.command", { args: "quit" }),
    code("invalid"),
  );
  assert.deepEqual(host.mpv.commands, []);
  await stop();
});

test("the table: every category is used, every name is lower case, limits are the documented ones", () => {
  const used = new Set([
    ...Object.values(MPV_RULES.commands),
    ...Object.values(MPV_RULES.properties),
    ...Object.values(MPV_RULES.propertyPrefixes),
    "filters",
  ]);
  assert.deepEqual([...used].sort(), Object.keys(MPV_RULES.categories).sort());
  for (const name of [
    ...Object.keys(MPV_RULES.commands),
    ...Object.keys(MPV_RULES.properties),
    ...Object.keys(MPV_RULES.propertyPrefixes),
    ...MPV_RULES.writers,
  ])
    assert.match(name, /^[a-z0-9-]+$/, name);
  // The ruling's examples.
  for (const name of [
    "run",
    "subprocess",
    "load-script",
    "screenshot-to-file",
    "write-watch-later-config",
    "quit",
  ])
    assert.ok(name in MPV_RULES.commands, name);
  assert.ok(mpvPropertyRefusal("input-ipc-server", true));
  assert.deepEqual(MPV_LIMITS, {
    args: 32,
    nameChars: 128,
    labelChars: 64,
    observed: 64,
    observeIntervalMs: 100,
  });
  assert.ok(Object.isFrozen(MPV_RULES.commands) && Object.isFrozen(MPV_LIMITS));
});
