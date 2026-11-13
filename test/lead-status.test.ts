// Palette lead status additions (SDK 1.8.0): the end state "stopped", an
// end state's text of up to 160 characters, and the strip's own text
// (`status.strip`) for a working status. What 1.7.20 accepted and refused
// stays as it was (test/builtin-only.test.ts); this file covers only the
// additions and the order they are checked in.
import assert from "node:assert/strict";
import test from "node:test";
import { TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { PaletteLeadOptions, Plugin } from "../src/plugin/index.ts";
import { PALETTE_LEAD_LIMITS, PALETTE_LEAD_STATES } from "../src/commands.ts";
import * as runtime from "../src/player-runtime.ts";

async function started() {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin((_plugin: Plugin) => {}, {
    capabilities: ["commands", "commands.run", "palette.lead"],
    host,
    builtin: true,
    id: "vestra.test",
  });
  const lead = plugin.palette.lead({ title: "Ask", icon: "ai" });
  await lead.ready;
  const set = (
    status: NonNullable<PaletteLeadOptions["status"]>,
    icon: PaletteLeadOptions["icon"] = "ai",
  ) => lead.update({ title: "Ask", icon, status });
  return { host, lead, plugin, set, stop };
}

test("the limits and the states are data shared with the player (./runtime)", () => {
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
  assert.deepEqual(
    [...PALETTE_LEAD_STATES],
    ["working", "done", "failed", "note", "stopped"],
  );
  assert.equal(runtime.PALETTE_LEAD_LIMITS, PALETTE_LEAD_LIMITS);
  assert.equal(runtime.PALETTE_LEAD_STATES, PALETTE_LEAD_STATES);
});

test('status.state "stopped" is an end state; the refusal names it', async () => {
  const { host, lead, set, stop } = await started();
  await set({ text: "Stopped", state: "stopped" });
  assert.deepEqual(host.paletteLead!.status, {
    text: "Stopped",
    state: "stopped",
  });
  assert.deepEqual(host.sent("palette.lead.set").at(-1), {
    title: "Ask",
    icon: "ai",
    status: { text: "Stopped", state: "stopped" },
  });
  await assert.rejects(set({ text: "Done", state: "finished" as "done" }), {
    code: "invalid",
    message: "status.state is one of working, done, failed, note, stopped",
  });
  // Refused: the row stays as last set.
  assert.deepEqual(host.paletteLead!.status, {
    text: "Stopped",
    state: "stopped",
  });
  await lead.dispose();
  await stop();
});

test("status.text: 80 characters while working, 160 for an end state, on one line", async () => {
  const { lead, set, stop } = await started();
  // Working, with or without the state: as before.
  await set({ text: "a".repeat(80) });
  await set({ text: "a".repeat(80), state: "working" });
  for (const state of [undefined, "working"] as const)
    await assert.rejects(
      set({ text: "a".repeat(81), ...(state ? { state } : {}) }),
      {
        code: "invalid",
        message: "status.text must be 1–80 characters on one line",
      },
    );
  // An end state: 160, still one line (the strip wraps it).
  for (const state of ["done", "failed", "note", "stopped"] as const) {
    await set({ text: "a".repeat(160), state });
    await assert.rejects(set({ text: "a".repeat(161), state }), {
      code: "invalid",
      message: "status.text must be 1–160 characters on one line",
    });
    await assert.rejects(set({ text: "one\ntwo", state }), {
      code: "invalid",
      message: "status.text must be 1–160 characters on one line",
    });
    await assert.rejects(set({ text: "", state }), {
      code: "invalid",
      message: "status.text must be 1–160 characters on one line",
    });
  }
  // The row's note keeps its limit in every state.
  await assert.rejects(
    set({ text: "Done", note: "n".repeat(41), state: "done" }),
    {
      code: "invalid",
      message: "status.note must be 1–40 characters on one line",
    },
  );
  await lead.dispose();
  await stop();
});

test("status.strip: sent only when set, 1–80 on one line, for a working status only", async () => {
  const { host, lead, set, stop } = await started();
  await set({ text: "Planning…" });
  assert.deepEqual(host.sent("palette.lead.set").at(-1), {
    title: "Ask",
    icon: "ai",
    status: { text: "Planning…" },
  });
  await set({ text: "Vestra is working · Planning…", strip: "Planning…" });
  assert.deepEqual(host.paletteLead!.status, {
    text: "Vestra is working · Planning…",
    strip: "Planning…",
  });
  await set({ text: "Working", strip: "s".repeat(80), state: "working" });
  await assert.rejects(set({ text: "Working", strip: "s".repeat(81) }), {
    code: "invalid",
    message: "status.strip must be 1–80 characters on one line",
  });
  for (const strip of ["", "one\ntwo"])
    await assert.rejects(set({ text: "Working", strip }), {
      code: "invalid",
      message: "status.strip must be 1–80 characters on one line",
    });
  for (const state of ["done", "failed", "note", "stopped"] as const)
    await assert.rejects(set({ text: "Ended", strip: "x", state }), {
      code: "invalid",
      message: "status.strip is for a working status",
    });
  // Refused: the row stays as last set.
  assert.deepEqual(host.paletteLead!.status, {
    text: "Working",
    strip: "s".repeat(80),
    state: "working",
  });
  await lead.dispose();
  await stop();
});

test("the checks keep their order: texts, icon, state, then the strip", async () => {
  const { host, lead, plugin, set, stop } = await started();
  // A wrong state has the working limit: the text is refused first, as
  // 1.7.20 refused it.
  await assert.rejects(
    set({ text: "a".repeat(81), state: "finished" as "done" }),
    {
      code: "invalid",
      message: "status.text must be 1–80 characters on one line",
    },
  );
  // The icon before the state.
  await assert.rejects(
    set({ text: "Done", state: "finished" as "done" }, {} as never),
    { code: "invalid", message: /icon/ },
  );
  // The state before the strip.
  await assert.rejects(
    set({ text: "Done", strip: "", state: "finished" as "done" }),
    { code: "invalid", message: /^status\.state is one of/ },
  );
  // A strip with an end state before the strip's own length.
  await assert.rejects(
    set({ text: "Done", strip: "s".repeat(81), state: "done" }),
    { code: "invalid", message: "status.strip is for a working status" },
  );
  // A raw request's strip: null is a status without one, as note: null is.
  await plugin.wire.request("palette.lead.set", {
    title: "Ask",
    icon: "ai",
    status: { text: "Done", strip: null, state: "done" },
  });
  assert.deepEqual(host.paletteLead!.status, {
    text: "Done",
    strip: null,
    state: "done",
  });
  await lead.dispose();
  await stop();
});
