// Step 3 of the SDK refactor (doc/specs/sdk-refactor.md §4 in the player
// repository): `plugin.wire`, the protocol and the primitives behind one
// experimental member, and its preconditions: raw `events.subscribe`
// without `why`/`mirror` is refused, `wire.on` always sends `why`, a
// property has one track (direct writes or set/bind), and `TestHost`
// takes raw requests as the player does (strict declarations included).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { ScopeImpl } from "../src/plugin/scope.ts";
import type { Json } from "../src/wire.ts";
import type {
  Panel,
  Plugin,
  PluginError,
  Window,
} from "../src/plugin/types.ts";
import { SUBSCRIBED_EVENTS } from "../src/api-requests.ts";
import { EVENT_NEEDS } from "../src/plugin/player/events.ts";
import { CHUNK_BYTES } from "../src/plugin/patch.ts";

/** A package with a panel/window file holding `rows`, `total` and `label`. */
function packageWith(capabilities: string[] = ["ui.mount", "ui.window"]) {
  const directory = mkdtempSync(join(tmpdir(), "wire-"));
  writeFileSync(
    join(directory, "list.slint"),
    [
      "export global ListBridge {",
      "  in property <[{rowId: string, label: string}]> rows;",
      "  in property <string> total;",
      "  in property <string> label;",
      "}",
      "export component List inherits Rectangle {}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.wire", capabilities }),
  );
  return directory;
}

const row = (key: string, label = `row ${key}`) => ({ rowId: key, label });
const declaration = {
  title: "Cycle Speed",
  path: ["Playback", "Cycle Speed"],
  order: 0,
  group: "domain",
  radio: false,
  bindings: ["C"],
  focus: null,
  repeat: false,
};

test("SUBSCRIBED_EVENTS is HostEvent (EVENT_NEEDS)", () => {
  assert.deepEqual(
    [...SUBSCRIBED_EVENTS].sort(),
    Object.keys(EVENT_NEEDS).sort(),
  );
});

test("wire.request: TestHost takes a raw request as the player does", async () => {
  const { host, plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["clipboard"],
  });
  try {
    // The same handler as the typed client's: the same answer, recorded.
    await plugin.wire.request("clipboard.writeText", { text: "raw" });
    assert.equal(await plugin.clipboard.readText(), "raw");
    assert.equal(
      await plugin.wire.request<string>("clipboard.readText", {}),
      "raw",
    );
    assert.deepEqual(host.sent("clipboard.writeText"), [{ text: "raw" }]);
    // A refusal arrives with its code; an unknown method is `unsupported`.
    host.handle("clipboard.writeText", () => {
      throw new HostError("failed", "refused");
    });
    await assert.rejects(
      plugin.wire.request("clipboard.writeText", { text: "x" }),
      { code: "failed" },
    );
    await assert.rejects(plugin.wire.request("no.such.method"), {
      code: "unsupported",
    });
    assert.throws(() => plugin.wire.request(""), { code: "invalid" });
  } finally {
    await stop();
  }
});

test("wire.request: the SDK's events are not subscribed raw; another event needs why or mirror", async () => {
  const { host, plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["events"],
  });
  try {
    const before = host.sent("events.subscribe").length;
    // The ten HostEvents belong to the SDK (one subscription and one mark
    // per name at the player): refused whatever the marks (review L2).
    for (const params of [
      { event: "window.state" },
      { event: "window.state", why: ["a raw listener"] },
      { event: "source.state", mirror: true },
    ] as Json[])
      assert.throws(() => plugin.wire.request("events.subscribe", params), {
        code: "invalid",
        message: /listen with plugin.wire.on/,
      });
    assert.throws(
      () =>
        plugin.wire.request("events.unsubscribe", { event: "source.state" }),
      { code: "invalid", message: /use the Disposable from plugin.wire.on/ },
    );
    // Another event: why or mirror needed.
    for (const params of [
      undefined,
      { event: "player.future" },
      { event: "player.future", why: [] },
      { event: "player.future", why: [1] },
      { event: "player.future", mirror: false },
    ] as (Json | undefined)[])
      assert.throws(() => plugin.wire.request("events.subscribe", params), {
        code: "invalid",
        message: /needs why .* or mirror: true/,
      });
    assert.equal(host.sent("events.subscribe").length, before, "nothing sent");
    assert.equal(host.sent("events.unsubscribe").length, 0);
    // Marked, it goes as given, and the plugin unsubscribes it itself.
    await plugin.wire.request("events.subscribe", {
      event: "player.future",
      why: ["a raw listener"],
    });
    assert.deepEqual(host.sent("events.subscribe").at(-1), {
      event: "player.future",
      why: ["a raw listener"],
    });
    assert.deepEqual(host.listeningWhy.get("player.future"), [
      "a raw listener",
    ]);
    await plugin.wire.request("events.unsubscribe", { event: "player.future" });
    assert.ok(!host.subscriptions.has("player.future"));
  } finally {
    await stop();
  }
});

test("wire.on: a HostEvent is subscribed as a listener with its why, never a mirror", async () => {
  const seen: unknown[] = [];
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.wire.on("window.state", (data) => seen.push(data));
    },
    { capabilities: ["events"] },
  );
  try {
    const lines = host
      .sent("events.subscribe")
      .filter((line) => line.event === "window.state");
    assert.equal(lines.length, 1);
    assert.equal(lines[0]!.mirror, undefined);
    assert.match(
      String((lines[0]!.why as string[])[0]),
      /^a listener added at (test\/)?wire-facade\.test\.ts:\d+$/,
    );
    host.setMainWindow({ fullscreen: true });
    await host.settle();
    assert.equal((seen.at(-1) as { fullscreen: boolean }).fullscreen, true);
    // No update pass for a plugin with nothing bound.
    assert.equal((plugin as ScopeImpl).runtime.counts.passes, 0);
    assert.throws(() => plugin.wire.on("", () => {}), { code: "invalid" });
    assert.throws(
      () => plugin.wire.on("window.state", null as unknown as () => void),
      { code: "invalid" },
    );
  } finally {
    await stop();
  }
});

test("wire.on: another name is heard without a subscription; dispose stops it", async () => {
  const seen: unknown[] = [];
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.commands.add({ id: "go", title: "Go", run: () => {} });
    },
    { capabilities: ["commands"] },
  );
  try {
    const listening = plugin.wire.on("commands.execute", (data) =>
      seen.push(data),
    );
    await host.command("go").run();
    await host.settle();
    assert.equal((seen[0] as { id: string }).id, "go");
    assert.equal(
      host
        .sent("events.subscribe")
        .filter((l) => l.event === "commands.execute").length,
      0,
    );
    await listening.dispose();
    await host.command("go").run();
    await host.settle();
    assert.equal(seen.length, 1);
  } finally {
    await stop();
  }
});

test("wire.view: whole writes with a seq, rows patched on them, large lists in parts", async () => {
  let panel!: Panel;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      panel = p.panels.mount("bottom", "list.slint");
    },
    { directory: packageWith() },
  );
  try {
    await panel.ready;
    const view = plugin.wire.view(panel);
    assert.equal(
      await view.write("rows", { value: [row("a"), row("b")] }),
      true,
    );
    const first = host.sent("ui.setMount").at(-1)!;
    assert.equal(first.property, "rows");
    assert.equal(typeof first.seq, "number", "numbered for later patches");
    await view.writeRows("rows", [
      { op: "insert", at: 2, rows: [row("c")] },
      { op: "move", from: 0, count: 1, to: 2 },
    ]);
    const patch = host.sent("ui.setMount").at(-1)!.patch as {
      base: number;
      seq: number;
    };
    assert.equal(patch.base, first.seq);
    assert.deepEqual(host.mounted().props["rows"], [
      row("b"),
      row("c"),
      row("a"),
    ]);
    // camelCase names are the Slint names, as for set().
    await view.write("label", { value: "direct" });
    assert.equal(host.mounted().props["label"], "direct");
    // A list over one request goes in parts: the first rows with `more`,
    // the rest as insert patches; the player shows it whole.
    const big = Array.from({ length: 3000 }, (_, i) =>
      row(`k${i}`, "x".repeat(400)),
    );
    assert.ok(JSON.stringify(big).length > CHUNK_BYTES);
    const mark = host.calls.length;
    await view.write("rows", { value: big });
    const parts = host.calls.slice(mark).map((c) => c.params);
    assert.ok(parts.length > 1);
    assert.equal(parts[0]!.more, true);
    assert.equal((host.mounted().props["rows"] as Json[]).length, 3000);
    // The player refuses a stale base with `stale`, as it is.
    await assert.rejects(
      plugin.wire
        .view(panel)
        .write("rows", { patch: { base: 1, seq: 999, ops: [] } }),
      { code: "stale" },
    );
  } finally {
    await stop();
  }
});

test("wire.view: a whole write replaces the ones waiting; a closed view is unavailable", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      window = p.windows.create("list.slint", { id: "list" });
    },
    { directory: packageWith() },
  );
  try {
    const view = plugin.wire.view(window);
    await assert.rejects(view.write("total", { value: "1" }), {
      code: "unavailable",
    });
    await window.show();
    const results = await Promise.all([
      view.write("total", { value: "1" }),
      view.write("total", { value: "2" }),
      view.write("total", { value: "3" }),
    ]);
    // The first was in flight; the second waited and was replaced.
    assert.deepEqual(results, [true, false, true]);
    assert.deepEqual(
      host
        .sent("ui.set")
        .filter((p) => p.property === "total")
        .map((p) => p.value),
      ["1", "3"],
    );
    assert.equal(host.window("list").props["total"], "3");
    await window.close();
    await assert.rejects(view.write("total", { value: "4" }), {
      code: "unavailable",
    });
  } finally {
    await stop();
  }
});

test("wire.view: row operations need a player that takes patches", async () => {
  const host = new TestHost();
  (host as unknown as { app: object }).app = { ...host.app, features: [] };
  let panel!: Panel;
  let plugin!: Plugin;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      panel = p.panels.mount("bottom", "list.slint");
    },
    { directory: packageWith(), host },
  );
  try {
    await panel.ready;
    const view = plugin.wire.view(panel);
    await view.write("rows", { value: [row("a")] });
    assert.equal(host.sent("ui.setMount").at(-1)!.seq, undefined, "no seq");
    await assert.rejects(
      view.writeRows("rows", [{ op: "remove", at: 0, count: 1 }]),
      { code: "unsupported" },
    );
  } finally {
    await stop();
  }
});

test("one track per property: written directly, then set() or bind() is invalid", async () => {
  const errors: PluginError[] = [];
  let panel!: Panel;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.onError((error) => errors.push(error));
      panel = p.panels.mount("bottom", "list.slint");
    },
    { directory: packageWith() },
  );
  try {
    await panel.ready;
    await plugin.wire.view(panel).write("rows", { value: [row("a")] });
    assert.throws(() => panel.set({ rows: [row("b")] }), {
      code: "invalid",
      message:
        "property `rows` is written directly; bind it or write it, not both",
    });
    // A set() naming it is refused whole: its other values are not kept.
    assert.throws(() => panel.set({ total: "x", rows: [] }), {
      code: "invalid",
    });
    // A binding that produces it: reported once, its other values count.
    panel.bind(() => ({ rows: [row("c")], total: "bound" }));
    await host.settle();
    plugin.update();
    await host.settle();
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, "invalid");
    assert.match(errors[0]!.message, /property `rows` is written directly/);
    assert.equal(host.mounted().props["total"], "bound");
    assert.deepEqual(host.mounted().props["rows"], [row("a")]);
  } finally {
    await stop();
  }
});

test("one track per property: set or bound, then a direct write is invalid", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      window = p.windows.create("list.slint", { id: "list" });
      window.set({ label: "set" });
      window.bind(() => ({ total: "bound" }));
    },
    { directory: packageWith() },
  );
  try {
    await window.show();
    const view = plugin.wire.view(window);
    for (const property of ["label", "total"])
      assert.throws(() => view.write(property, { value: "direct" }), {
        code: "invalid",
        message: `property \`${property}\` is set or bound; bind it or write it, not both`,
      });
    assert.throws(() => view.writeRows("total", []), { code: "invalid" });
    // Another property of the same view is free.
    assert.equal(await view.write("rows", { value: [] }), true);
  } finally {
    await stop();
  }
});

test("wire.view takes only a view of this plugin", async () => {
  const { plugin, stop } = await startPlugin(() => {}, {
    directory: packageWith(),
  });
  const other = await startPlugin(
    (p: Plugin) => void p.windows.create("list.slint", { id: "other" }),
    { directory: packageWith() },
  );
  try {
    for (const value of [null, {}, plugin.osd])
      assert.throws(() => plugin.wire.view(value as never), {
        code: "invalid",
      });
    const foreign = other.plugin.windows.create("list.slint", { id: "x" });
    assert.throws(() => plugin.wire.view(foreign), { code: "invalid" });
  } finally {
    await stop();
    await other.stop();
  }
});

test("wire.commands.register: one bare registration, run, explicit updates", async () => {
  const runs: string[] = [];
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      const command = p.wire.commands.register({
        id: "rate.cycle",
        declaration,
        state: { checked: false },
        run: () => {
          runs.push("run");
        },
      });
      assert.equal(command.id, "rate.cycle");
    },
    { capabilities: ["commands"] },
  );
  try {
    assert.deepEqual(host.sent("commands.register"), [
      {
        id: "rate.cycle",
        revision: 1,
        declaration,
        state: { enabled: true, checked: false, busy: false, reason: null },
      },
    ]);
    await host.command("rate.cycle").run();
    assert.deepEqual(runs, ["run"]);
    // No pass evaluates it: 20 updates of the plugin send nothing.
    for (let i = 0; i < 20; i++) plugin.update();
    await host.settle();
    assert.equal(host.sent("commands.update").length, 0);
    const command = plugin.wire.commands.register({
      id: "other",
      declaration: { ...declaration, title: "Other", path: [], bindings: [] },
    });
    await command.ready;
    await command.update({ enabled: false, reason: "not now" });
    assert.deepEqual(host.sent("commands.update").at(-1), {
      id: "other",
      revision: 2,
      state: { enabled: false, checked: null, busy: false, reason: "not now" },
    });
    assert.equal(host.command("other").state.enabled, false);
    assert.throws(
      () => plugin.wire.commands.register({ id: "other", declaration }),
      { code: "conflict" },
    );
    assert.throws(
      () =>
        plugin.wire.commands.register({
          id: "",
          declaration,
        }),
      { code: "invalid" },
    );
    assert.throws(
      () =>
        plugin.wire.commands.register({
          id: "x",
          declaration: null as never,
        }),
      { code: "invalid" },
    );
    await command.dispose();
    assert.deepEqual(host.sent("commands.unregister").at(-1), { id: "other" });
    await assert.rejects(command.update({ busy: true }), { code: "missing" });
  } finally {
    await stop();
  }
});

test("wire.commands.register: a refused declaration fails startPlugin (strictDeclarations)", async () => {
  await assert.rejects(
    startPlugin(
      (p: Plugin) => {
        p.wire.commands.register({
          id: "bad",
          declaration: { ...declaration, path: ["@nowhere", "Bad"] },
        });
      },
      { capabilities: ["commands"] },
    ),
    { code: "invalid", message: /@nowhere/ },
  );
});
