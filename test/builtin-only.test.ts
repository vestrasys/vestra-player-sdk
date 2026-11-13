// Built-in-only requests (SDK 1.7.9, player 0.7.6): `plugin.commands.list` /
// `run` and `plugin.palette.lead`, with TestHost's model of the player's
// tickets, rates and confirmation. The player refuses them to a plugin that
// is not built in (by identity, not by a declaration since 1.9.0).
import assert from "node:assert/strict";
import test from "node:test";
import { TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";

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
    { host, builtin, id: "vestra.test" },
  );
  return { host, plugin, stop, runs, ran: () => ran };
}

test("a plugin that is not built in is refused with capability", async () => {
  const errors: PluginError[] = [];
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => void errors.push(error));
      plugin.palette.lead({ title: "Ask", icon: "ai" });
    },
    { host },
  );
  await assert.rejects(plugin.commands.list(), { code: "capability" });
  await assert.rejects(plugin.commands.run("host/mute", { ticket: "t" }), {
    code: "capability",
  });
  // The row's refusal reaches onError; activation went on.
  assert.deepEqual(
    errors.map((error) => error.code),
    ["capability"],
  );
  assert.equal(host.paletteLead, null);
  await stop();
  // Built in, nothing declared (1.9.0): the player answers.
  const bare = await startPlugin(() => {}, { builtin: true });
  assert.ok((await bare.plugin.commands.list()).commands.length > 0);
  await bare.plugin.palette.lead({ title: "A", icon: "ai" }).ready;
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
  for (const state of ["working", "done", "failed", "note"] as const) {
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
    { code: "invalid", message: /status\.state is one of/ },
  );
  // Refused: the row stays as last set.
  assert.deepEqual(host.paletteLead!.status, {
    text: "Done · Mute",
    state: "note",
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
