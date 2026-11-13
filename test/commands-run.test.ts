// `plugin.commands.list` / `run` (capability `plugins`) and
// `plugin.palette.lead` (no capability), with TestHost's model of the
// player's tickets, rates and confirmation. Until SDK 1.8.0 both were for
// built-in plugins only (`commands.run`, `palette.lead`).
import assert from "node:assert/strict";
import test from "node:test";
import {
  CAPABILITY_INFO,
  startPlugin,
  TestHost,
} from "../src/plugin/testing.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";
import { manifestProblems } from "../src/manifest.ts";
import { retiredCapabilities } from "../src/capability-rules.ts";
import { PALETTE_LEAD_LIMITS, PALETTE_LEAD_STATES } from "../src/commands.ts";
import type { PaletteLeadOptions } from "../src/plugin/index.ts";

const capabilities = ["plugins"];

/** A plugin with one lead and two commands of its own; `builtin` as asked. */
async function started(builtin = true) {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 60, position: 0 });
  const runs: { query: string; ticket: string; status: boolean }[] = [];
  let ran = 0;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({
        id: "forget-all",
        path: ["Extras", "Forget All"],
        destructive: true,
        run: () => void ran++,
      });
      plugin.commands.add({
        id: "louder",
        path: ["Extras", "Louder"],
        run: () => void ran++,
      });
      plugin.commands.add({
        id: "off",
        path: ["Extras", "Off"],
        enabled: false,
        reason: "Nothing to do",
        run: () => {},
      });
      plugin.palette
        .lead({ title: "Ask", icon: "search-ai" })
        .onRun((run) => void runs.push(run));
    },
    { capabilities, host, builtin, id: "vestra.test" },
  );
  return { host, plugin, stop, runs, ran: () => ran };
}

test("commands.list and run need plugins; the lead needs nothing; no built-in-only flag", () => {
  for (const api of ["Commands.list", "Commands.run"])
    assert.ok(CAPABILITY_INFO["plugins"]!.apis.includes(api), api);
  for (const info of Object.values(CAPABILITY_INFO)) {
    assert.equal("builtinOnly" in info, false);
    assert.equal(info.apis.includes("Palette.lead"), false);
  }
  for (const retired of ["commands.run", "palette.lead"])
    assert.equal(retired in CAPABILITY_INFO, false, retired);
});

test("a plugin that is not built in may use them; list and run need plugins", async () => {
  const errors: PluginError[] = [];
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => void errors.push(error));
      plugin.palette.lead({ title: "Ask", icon: "ai" });
    },
    { capabilities, host },
  );
  const { commands } = await plugin.commands.list();
  assert.ok(commands.some((each) => each.id === "host/mute"));
  // Reaches the player: refused for its ticket, not for a capability.
  await assert.rejects(plugin.commands.run("host/mute", { ticket: "t" }), {
    code: "ticket",
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(host.paletteLead, { title: "Ask", icon: "ai" });
  await stop();
  // Undeclared: list and run are refused before the player is asked; the
  // lead needs no capability.
  const bare = await startPlugin(() => {}, { capabilities: [] });
  await assert.rejects(bare.plugin.commands.list(), { code: "capability" });
  await assert.rejects(bare.plugin.commands.run("host/mute", { ticket: "t" }), {
    code: "capability",
  });
  assert.deepEqual(bare.host.sent("commands.list"), []);
  const lead = bare.plugin.palette.lead({ title: "A", icon: "ai" });
  await lead.ready;
  assert.deepEqual(bare.host.paletteLead, { title: "A", icon: "ai" });
  await bare.stop();
});

test("the lead row, its run event and the ticket of each request", async () => {
  const { host, plugin, stop, runs, ran } = await started();
  assert.deepEqual(host.paletteLead, { title: "Ask", icon: "search-ai" });
  const ticket = await host.runPaletteLead("louder", { keep: true });
  assert.deepEqual(runs, [
    { query: "louder", keep: true, ticket, status: false },
  ]);
  assert.deepEqual(
    await plugin.commands.run("vestra.test/louder", {
      ticket,
      step: 1,
      of: 2,
    }),
    { ran: true },
  );
  await host.settle();
  assert.equal(ran(), 1);
  assert.equal(host.osd.at(-1), "vestra.test · 1/2 · Extras: Louder");
  await plugin.commands.run("host/mute", { ticket });
  assert.deepEqual(host.coreRuns, ["mute"]);
  // A newer request ends the earlier ticket; done ends the newer one.
  const next = await host.runPaletteLead("", { status: true });
  assert.equal(runs.at(-1)!.status, true);
  await assert.rejects(plugin.commands.run("host/mute", { ticket }), {
    code: "ticket",
  });
  await assert.rejects(plugin.commands.run("host/mute", { ticket: "" }), {
    code: "ticket",
  });
  const lead = plugin.palette.lead({ title: "Ask", icon: "ai" });
  await lead.ready;
  await lead.done(next);
  await assert.rejects(plugin.commands.run("host/mute", { ticket: next }), {
    code: "ticket",
  });
  await lead.dispose();
  assert.equal(host.paletteLead, null);
  await stop();
});

test("the lead's status state: sent only when set, checked like the player", async () => {
  const { host, plugin, stop } = await started();
  const lead = plugin.palette.lead({
    title: "Ask",
    icon: "ai",
    status: { text: "Planning…" },
  });
  await lead.ready;
  assert.deepEqual(host.paletteLead, {
    title: "Ask",
    icon: "ai",
    status: { text: "Planning…" },
  });
  for (const state of [
    "working",
    "done",
    "failed",
    "note",
    "stopped",
  ] as const) {
    await lead.update({
      title: "Ask",
      icon: "ai",
      status: { text: "Done · Mute", state },
    });
    assert.deepEqual(host.paletteLead!.status, { text: "Done · Mute", state });
  }
  await assert.rejects(
    lead.update({
      title: "Ask",
      icon: "ai",
      status: { text: "Done", state: "finished" as "done" },
    }),
    {
      code: "invalid",
      message: "status.state is one of working, done, failed, note, stopped",
    },
  );
  // Refused: the row stays as last set.
  assert.deepEqual(host.paletteLead!.status, {
    text: "Done · Mute",
    state: "stopped",
  });
  assert.deepEqual(
    [...PALETTE_LEAD_STATES],
    ["working", "done", "failed", "note", "stopped"],
  );
  await lead.dispose();
  await stop();
});

test("the lead's status texts: an end state holds two lines, the strip's own text is for a working status (SDK 1.8.0)", async () => {
  const { host, plugin, stop } = await started();
  const lead = plugin.palette.lead({ title: "Ask", icon: "ai" });
  await lead.ready;
  const set = (status: NonNullable<PaletteLeadOptions["status"]>) =>
    lead.update({ title: "Ask", icon: "ai", status });
  assert.deepEqual(PALETTE_LEAD_LIMITS, {
    title: 40,
    placeholder: 60,
    empty: 80,
    note: 40,
    statusText: 80,
    statusEndText: 160,
    statusNote: 40,
    statusStrip: 80,
  });
  // Working: 80 characters, with or without the state.
  await set({ text: "a".repeat(80) });
  for (const state of [undefined, "working"] as const)
    await assert.rejects(
      set({ text: "a".repeat(81), ...(state ? { state } : {}) }),
      {
        code: "invalid",
        message: "status.text must be 1–80 characters on one line",
      },
    );
  // An end state: 160, still on one line (the strip wraps it).
  for (const state of ["done", "failed", "note", "stopped"] as const) {
    await set({ text: "a".repeat(160), state });
    await assert.rejects(set({ text: "a".repeat(161), state }), {
      code: "invalid",
      message: "status.text must be 1–160 characters on one line",
    });
    await assert.rejects(set({ text: "one\ntwo", state }), {
      code: "invalid",
    });
  }
  // The strip's own text: sent only when set, 1–80, working only.
  await set({ text: "Vestra is working · Planning…", strip: "Planning…" });
  assert.deepEqual(host.paletteLead!.status, {
    text: "Vestra is working · Planning…",
    strip: "Planning…",
  });
  await set({ text: "Working", strip: "Planning…", state: "working" });
  await assert.rejects(set({ text: "Working", strip: "a".repeat(81) }), {
    code: "invalid",
    message: "status.strip must be 1–80 characters on one line",
  });
  await assert.rejects(set({ text: "Working", strip: "" }), {
    code: "invalid",
  });
  await assert.rejects(set({ text: "Stopped", strip: "x", state: "stopped" }), {
    code: "invalid",
    message: "status.strip is for a working status",
  });
  await set({ text: "Stopped", state: "stopped" });
  assert.deepEqual(host.paletteLead!.status, {
    text: "Stopped",
    state: "stopped",
  });
  await lead.dispose();
  await stop();
});

test("commands.run asks before a destructive command and follows the palette's checks", async () => {
  const { host, plugin, stop, ran } = await started();
  const ticket = await host.runPaletteLead("forget everything");
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", { ticket }),
    { ran: false, declined: true },
  );
  host.dialogAnswers.push({ confirmed: true, checked: false });
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", { ticket }),
    { ran: true },
  );
  await host.settle();
  assert.equal(ran(), 1);
  await assert.rejects(plugin.commands.run("vestra.test/off", { ticket }), {
    code: "disabled",
    message: "Nothing to do",
  });
  await assert.rejects(plugin.commands.run("vestra.test/nope", { ticket }), {
    code: "missing",
  });
  for (const options of [{ step: 1 }, { step: 3, of: 2 }, { step: 0, of: 1 }])
    await assert.rejects(
      plugin.commands.run("host/mute", { ticket, ...options }),
      { code: "invalid" },
    );
  // 4 a second per ticket (two runs above counted).
  await plugin.commands.run("host/mute", { ticket });
  await plugin.commands.run("host/mute", { ticket });
  await assert.rejects(plugin.commands.run("host/mute", { ticket }), {
    code: "limit",
  });
  await stop();
});

test("commands.list is the palette's table", async () => {
  const { plugin, stop } = await started();
  const { revision, commands } = await plugin.commands.list();
  const row = (id: string) => commands.find((each) => each.id === id);
  assert.deepEqual(row("vestra.test/forget-all"), {
    id: "vestra.test/forget-all",
    label: "Extras: Forget All",
    labelSource: "Extras: Forget All",
    title: "Forget All",
    category: "Extras",
    path: ["Extras", "Forget All"],
    place: "Menu",
    keys: [],
    plugin: "vestra.test",
    builtin: true,
    enabled: true,
    checkable: false,
    radio: false,
    group: "domain",
    busy: false,
    dangerous: true,
  });
  assert.equal(row("vestra.test/louder")!.dangerous, false);
  assert.equal(row("vestra.test/off")!.reason, "Nothing to do");
  assert.equal(row("host/stop")!.dangerous, true);
  assert.equal(row("host/mute")!.plugin, "Vestra Player");
  // The same table, the same revision.
  assert.equal((await plugin.commands.list()).revision, revision);
  await stop();
});

test("destructive is sent only when set", async () => {
  const { host, stop } = await started();
  assert.equal(host.command("forget-all").declaration.destructive, true);
  assert.equal("destructive" in host.command("louder").declaration, false);
  await stop();
});

test("vestra-plugin check: a retired capability names its replacement; reserved and unknown names", () => {
  const problems = (capabilities: string[], id = "someone.ask") =>
    manifestProblems(
      {
        id,
        version: "1.0.0",
        apiVersion: "vestra/1",
        entry: "main.js",
        capabilities,
      },
      ".",
    ).problems;
  assert.deepEqual(
    problems(["player", "plugins", "clipboard", "credentials"]),
    [],
  );
  assert.deepEqual(problems([]), []);
  // Renamed or folded into a boundary: the name to declare instead, in the
  // player's own words.
  assert.deepEqual(problems(["commands.run"]), [
    'capability "commands.run" was retired: declare "plugins" instead',
  ]);
  assert.deepEqual(problems(["secrets", "bindings.manage", "ui.theme"]), [
    'capability "secrets" was retired: declare "credentials" instead',
    'capability "bindings.manage" was retired: declare "player" instead',
    'capability "ui.theme" was retired: declare "player" instead',
  ]);
  // Needs nothing now, for a built-in plugin's id too.
  for (const id of ["someone.ask", "vestra.ask"])
    assert.deepEqual(problems(["events", "palette.lead"], id), [
      'capability "events" was retired: what it allowed needs no capability now, remove it',
      'capability "palette.lead" was retired: what it allowed needs no capability now, remove it',
    ]);
  // `clipboard` kept its name.
  assert.deepEqual(problems(["clipboard"]), []);
  // Every old name is refused, and is no capability; every replacement is one.
  const retired = retiredCapabilities();
  for (const [old, now] of Object.entries(retired)) {
    assert.equal(old in CAPABILITY_INFO, false, old);
    if (now !== null) assert.equal(CAPABILITY_INFO[now]?.reserved, false, old);
    assert.equal(problems([old]).length, 1, old);
  }
  assert.equal(Object.keys(retired).length, 30);
  // A reserved name is accepted, as by the player, with a reminder.
  const reserved = manifestProblems(
    {
      id: "someone.ask",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.js",
      capabilities: ["camera", "player"],
    },
    ".",
  );
  assert.deepEqual(reserved.problems, []);
  assert.deepEqual(
    reserved.hints.filter((hint) => hint.startsWith("camera")),
    [
      "camera: reserved for a later player API; no member needs it yet, and the store would show it to the user: remove it",
    ],
  );
  assert.deepEqual(problems(["network"]), [
    "unknown capabilities network (the capabilities are player, plugins, clipboard, credentials, camera, microphone, screen, notifications)",
  ]);
});
