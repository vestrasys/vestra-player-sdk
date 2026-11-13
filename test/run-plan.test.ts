// SDK 1.7.16 (Ask Vestra UX, step 3): `commands.run`'s `then`, the rest of
// a request's plan, asked for once before its first step; TestHost's model
// of the player's approval; and the lead's texts counted as shown.
import assert from "node:assert/strict";
import test from "node:test";
import { TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { Plugin } from "../src/plugin/index.ts";
import { COMMAND_RUN_LIMITS } from "../src/player-runtime.ts";
import { text } from "../src/plugin/language.ts";

// `then` is commands.run's plan, an array: not a thenable.
/* oxlint-disable unicorn/no-thenable */

const capabilities = ["commands", "commands.run", "palette.lead"];

/** The plugin's runs a second are 4 a ticket: wait for room. */
const nextSecond = () => new Promise((resolve) => setTimeout(resolve, 1000));

/** A built-in plugin with destructive, plain and Settings / Reset commands. */
async function started() {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 60, position: 0 });
  const ran: string[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      const add = (id: string, path: string[], destructive = false) =>
        plugin.commands.add({
          id,
          path,
          ...(destructive ? { destructive } : {}),
          run: () => void ran.push(id),
        });
      add("forget-all", ["Extras", "Forget All"], true);
      add("louder", ["Extras", "Louder"]);
      add("softer", ["Extras", "Softer"]);
      add("tune", ["@settings", "Tune"]);
      add("start-over", ["@reset", "Start Over"]);
      add("manage", ["Plugins", "Manage"]);
      add("old-tune", ["设置", "Old Tune"]);
      plugin.palette.lead({ title: "Ask", icon: "search-ai" });
    },
    { capabilities, host, builtin: true, id: "vestra.test" },
  );
  return { host, plugin, stop, ran };
}

test("the plan's limit is the player's: 8 commands, the run and 7 more", () => {
  assert.deepEqual(COMMAND_RUN_LIMITS, {
    plan: 8,
    perTicket: 30,
    perSecond: 4,
    perMinute: 120,
    ticketIdleMs: 120_000,
  });
});

test("then: one answer covers the whole plan, asked before the first step", async () => {
  const { host, plugin, stop, ran } = await started();
  const ticket = await host.runPaletteLead("louder, forget, softer");
  // The first step does not ask by itself; its plan does.
  host.dialogAnswers.push({ confirmed: true, checked: false });
  assert.deepEqual(
    await plugin.commands.run("vestra.test/louder", {
      ticket,
      step: 1,
      of: 3,
      then: ["vestra.test/forget-all", "vestra.test/softer"],
    }),
    { ran: true },
  );
  assert.equal(host.dialogAnswers.length, 0);
  // Sent as given.
  assert.deepEqual(
    host.calls.find((call) => call.method === "commands.run")!.params.then,
    ["vestra.test/forget-all", "vestra.test/softer"],
  );
  // The planned destructive step does not ask again (no answer queued).
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", {
      ticket,
      step: 2,
      of: 3,
    }),
    { ran: true },
  );
  await plugin.commands.run("vestra.test/softer", { ticket, step: 3, of: 3 });
  await host.settle();
  assert.deepEqual(ran, ["louder", "forget-all", "softer"]);
  // Its entry is used up: one more run of it asks on its own.
  await nextSecond();
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", { ticket }),
    { ran: false, declined: true },
  );
  assert.equal(host.dialogAnswers.length, 0);
  await stop();
});

test("then: Don't Run runs and remembers nothing; a command outside the plan asks", async () => {
  const { host, plugin, stop, ran } = await started();
  let ticket = await host.runPaletteLead("forget and louder");
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", {
      ticket,
      then: ["vestra.test/louder"],
    }),
    { ran: false, declined: true },
  );
  // Nothing remembered: the plan's destructive step asks again.
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", { ticket }),
    { ran: false, declined: true },
  );
  await host.settle();
  assert.deepEqual(ran, []);
  // An approved plan of louder and forget-all; Close is not in it.
  ticket = await host.runPaletteLead("louder, forget, close");
  host.dialogAnswers.push({ confirmed: true, checked: false });
  await plugin.commands.run("vestra.test/louder", {
    ticket,
    then: ["vestra.test/forget-all"],
  });
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.deepEqual(await plugin.commands.run("host/stop", { ticket }), {
    ran: false,
    declined: true,
  });
  assert.equal(host.dialogAnswers.length, 0);
  // A plan of which nothing asks asks nothing and remembers nothing.
  ticket = await host.runPaletteLead("louder and softer");
  await nextSecond();
  assert.deepEqual(
    await plugin.commands.run("vestra.test/louder", {
      ticket,
      then: ["vestra.test/softer", "vestra.test/softer"],
    }),
    { ran: true },
  );
  await stop();
});

test("then: a new plan replaces the rest of the earlier one; Don't ask again runs", async () => {
  const { host, plugin, stop, ran } = await started();
  const ticket = await host.runPaletteLead("two plans");
  // Run with "Don't ask again" checked: every command a test host lists is
  // built in, so nothing is remembered beyond the plan; it runs like Run.
  host.dialogAnswers.push({ confirmed: true, checked: true });
  await plugin.commands.run("vestra.test/louder", {
    ticket,
    then: ["vestra.test/forget-all", "host/stop"],
  });
  // A new plan forgets the rest of the earlier one and is asked for.
  host.dialogAnswers.push({ confirmed: true, checked: false });
  await plugin.commands.run("vestra.test/softer", {
    ticket,
    then: ["vestra.test/forget-all"],
  });
  assert.equal(host.dialogAnswers.length, 0);
  await plugin.commands.run("vestra.test/forget-all", { ticket });
  await nextSecond();
  // host/stop was only in the forgotten plan.
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.deepEqual(await plugin.commands.run("host/stop", { ticket }), {
    ran: false,
    declined: true,
  });
  await host.settle();
  assert.deepEqual(ran, ["louder", "softer", "forget-all"]);
  await stop();
});

test("then is checked like the player, and only runs count", async () => {
  const { host, plugin, stop } = await started();
  const ticket = await host.runPaletteLead("bad plans");
  const run = (then: unknown) =>
    plugin.commands.run("vestra.test/louder", {
      ticket,
      then: then as string[],
    });
  // The SDK refuses the shape before sending, in the player's words.
  for (const [bad, message] of [
    ["x", /then is an array of command ids/],
    [[1], /then has command ids: non-empty strings/],
    [[""], /then has command ids: non-empty strings/],
    [Array(8).fill("host/mute"), /then has at most 7 command ids/],
  ] as const)
    await assert.rejects(run(bad), { code: "invalid", message });
  // The player refuses an id that is not listed now, and the palette.
  await assert.rejects(run(["vestra.test/nope"]), {
    code: "missing",
    message: /vestra\.test\/nope/,
  });
  await assert.rejects(run(["host/palette"]), { code: "invalid" });
  // None of the above counted as a run (4 a second); 7 ids, null and [] run.
  assert.deepEqual(await run(Array(7).fill("host/mute")), { ran: true });
  assert.deepEqual(await run(null), { ran: true });
  assert.deepEqual(await run([]), { ran: true });
  await stop();
});

test("the test host checks then as the player does, for a client without the SDK", async () => {
  const { host, stop } = await started();
  const ticket = await host.runPaletteLead("raw");
  const run = (then: unknown) =>
    host.request("commands.run", {
      id: "vestra.test/louder",
      ticket,
      then: then as never,
    });
  await assert.rejects(run({}), { code: "invalid" });
  await assert.rejects(run(Array(8).fill("host/mute")), { code: "invalid" });
  await assert.rejects(run(["vestra.test/nope"]), { code: "missing" });
  assert.deepEqual(await run(null), { ran: true });
  await stop();
});

test("commands.list: the Settings and Reset menus ask first, a Plugins category does not", async () => {
  const { plugin, stop } = await started();
  const { commands } = await plugin.commands.list();
  const dangerous = (id: string) =>
    commands.find((each) => each.id === `vestra.test/${id}`)!.dangerous;
  assert.equal(dangerous("tune"), true);
  assert.equal(dangerous("start-over"), true);
  assert.equal(dangerous("manage"), false);
  // The old Chinese title of Settings: the whole path normalized.
  assert.equal(dangerous("old-tune"), true);
  assert.equal(dangerous("louder"), false);
  await stop();
});

test("palette.lead texts are counted as shown, on one line", async () => {
  const { host, plugin, stop } = await started();
  const lead = plugin.palette.lead({ title: "Ask", icon: "ai" });
  await lead.ready;
  // 9 characters of source, 90 as shown: refused like the player.
  const long = text("{}{}{}", ["x".repeat(30), "y".repeat(30), "z".repeat(30)]);
  await assert.rejects(
    lead.update({ title: "Ask", icon: "ai", status: { text: long } }),
    {
      code: "invalid",
      message: /status\.text must be 1–80 characters on one line/,
    },
  );
  await assert.rejects(
    lead.update({ title: "Ask", icon: "ai", status: { text: "two\nlines" } }),
    { code: "invalid", message: /on one line/ },
  );
  await lead.update({
    title: "Ask",
    icon: "ai",
    status: { text: "x".repeat(80) },
  });
  assert.ok(host.paletteLead!.status);
  await lead.dispose();
  await stop();
});

test("an empty then replaces the remaining plan", async () => {
  const { host, plugin, stop, ran } = await started();
  const ticket = await host.runPaletteLead("louder, then forget");
  host.dialogAnswers.push({ confirmed: true, checked: false });
  await plugin.commands.run("vestra.test/louder", {
    ticket,
    then: ["vestra.test/forget-all"],
  });
  // A new plan of softer alone: nothing in it asks, nothing is remembered.
  await plugin.commands.run("vestra.test/softer", { ticket, then: [] });
  assert.equal(host.dialogAnswers.length, 0);
  // forget-all was only in the replaced plan: it asks on its own.
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", { ticket }),
    { ran: false, declined: true },
  );
  assert.equal(host.dialogAnswers.length, 0);
  await host.settle();
  assert.deepEqual(ran, ["louder", "softer"]);
  await stop();
});

test("a run without then uses up an entry of the approved plan", async () => {
  const { host, plugin, stop, ran } = await started();
  const ticket = await host.runPaletteLead("louder, then forget");
  host.dialogAnswers.push({ confirmed: true, checked: false });
  await plugin.commands.run("vestra.test/louder", {
    ticket,
    then: ["vestra.test/forget-all"],
  });
  // then: null is no new plan: the planned run does not ask.
  assert.deepEqual(
    await plugin.commands.run("vestra.test/forget-all", { ticket, then: null }),
    { ran: true },
  );
  assert.equal(host.dialogAnswers.length, 0);
  await host.settle();
  assert.deepEqual(ran, ["louder", "forget-all"]);
  await stop();
});
