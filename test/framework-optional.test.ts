// Step 2 of the SDK refactor (doc/specs/sdk-refactor.md §4 in the player
// repository), "framework optional": a view joins the update passes on its
// first `bind()`, a command only when a state field is a function, the
// player's state mirror on its first read; `plugin.player.on` subscribes
// to one event with its raw payload and no mirror; `plugin.state` is
// plugin-owned state whose writes re-run exactly its readers.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { ScopeImpl } from "../src/plugin/scope.ts";
import type { Json } from "../src/wire.ts";
import type {
  EventPayload,
  HostEvent,
  Panel,
  Plugin,
  Window,
} from "../src/plugin/types.ts";
import type { HostEvent as WireEvent } from "../src/wire.ts";
import { EVENT_NEEDS } from "../src/plugin/player/events.ts";
import { HOST_CAPABILITIES } from "../src/host-capabilities.ts";

/** A package with one panel/window file holding `rows`, `total` and `label`. */
function packageWith(capabilities: string[] = ["ui.mount", "ui.window"]) {
  const directory = mkdtempSync(join(tmpdir(), "optional-"));
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
    JSON.stringify({ id: "test.optional", capabilities }),
  );
  return directory;
}

const row = (key: string, label = `row ${key}`) => ({ rowId: key, label });

/** Every property write the plugin sent, in order. */
function recorded(host: TestHost) {
  const writes: { method: string; params: Record<string, Json> }[] = [];
  const request = host.request.bind(host);
  host.request = (async (method: string, params: Record<string, Json> = {}) => {
    if (["ui.setMount", "ui.set", "settings.set"].includes(method))
      writes.push({ method, params });
    return request(method, params);
  }) as typeof host.request;
  return writes;
}

const countsOf = (plugin: Plugin) => ({
  ...(plugin as ScopeImpl).runtime.counts,
});

test("a view that is only set() sends whole values and no patch", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let panel!: Panel;
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.set({ rows: [row("a"), row("b"), row("c")], total: "3" });
    },
    { host, directory: packageWith() },
  );
  try {
    await panel.ready;
    await host.settle();
    assert.equal(writes.length, 0, "the initial properties carry the values");
    // One row changed: a bound view would patch it; set() sends it whole.
    const next = [row("a"), row("b", "changed"), row("c")];
    panel.set({ rows: next });
    await host.settle();
    panel.set({ rows: [...next, row("d")], total: "4" });
    await host.settle();
    assert.ok(writes.length >= 3);
    for (const write of writes)
      assert.ok(!("patch" in write.params), "no patch for a set() view");
    assert.deepEqual(writes[0]!.params, {
      property: "rows",
      value: next,
      seq: 1,
    });
    assert.deepEqual(host.mounted().props.rows, [...next, row("d")]);
    assert.equal(host.mounted().props.total, "4");
    // A view nobody bound takes part in no update pass.
    const before = countsOf(plugin);
    plugin.update();
    await host.settle();
    const after = countsOf(plugin);
    assert.equal(after.evaluations - before.evaluations, 0);
    // set() of an equal value is still sent once (as before).
    writes.length = 0;
    panel.set({ total: "4" });
    await host.settle();
    assert.deepEqual(
      writes.map((w) => w.params),
      [{ property: "total", value: "4", seq: 4 }],
    );
  } finally {
    await stop();
  }
});

test("mixed set() and bind() on one view stays patch-correct", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let window!: Window;
  let rows = Array.from({ length: 50 }, (_, i) => row(String(i)));
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      window = plugin.windows.create("list.slint", { id: "list" });
      window.set({ label: "set before bind" });
    },
    { host, directory: packageWith() },
  );
  try {
    await window.show();
    await host.settle();
    assert.equal(host.window("list").props.label, "set before bind");
    writes.length = 0;
    // set() of a list before anything is bound: whole.
    window.set({ rows });
    await host.settle();
    assert.ok(!("patch" in writes.at(-1)!.params));
    // The first bind joins the passes: what the host shows is not resent.
    window.bind(() => ({ rows, total: String(rows.length) }));
    await host.settle();
    assert.deepEqual(
      writes.slice(1).map((w) => w.params.property),
      ["total"],
      "only the newly bound value is sent",
    );
    // The first bound change of the list goes whole (no base yet), then
    // patches follow.
    rows = rows.map((r, i) => (i === 7 ? row(r.rowId, "seven") : r));
    plugin.update();
    await host.settle();
    rows = rows.map((r, i) => (i === 9 ? row(r.rowId, "nine") : r));
    plugin.update();
    await host.settle();
    const last = writes.at(-1)!.params;
    assert.ok("patch" in last, "a bound change after a whole write patches");
    assert.deepEqual((last.patch as { ops: Json[] }).ops, [
      { op: "set", at: 9, row: rows[9]! },
    ]);
    // set() on the bound view goes through the diff engine: a patch, and
    // the base moves on.
    const set = rows.map((r, i) => (i === 3 ? row(r.rowId, "three") : r));
    window.set({ rows: set });
    await host.settle();
    assert.ok("patch" in writes.at(-1)!.params);
    assert.deepEqual(
      host.window("list").props.rows,
      rows.map((r, i) => (i === 3 ? set[3]! : r)),
    );
    // The bound value wins again on the next pass, as a patch on the set().
    plugin.update();
    await host.settle();
    assert.ok("patch" in writes.at(-1)!.params);
    assert.deepEqual(host.window("list").props.rows, rows);
    assert.equal(host.window("list").props.label, "set before bind");
  } finally {
    await stop();
  }
});

test("a command with constant fields sends one commands.register and no commands.update across 20 passes", async () => {
  let plugin!: Plugin;
  let counter = 0;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.commands.add({ id: "fixed", title: "Fixed", run: () => {} });
      p.commands.add({
        id: "constant",
        title: "Constant",
        enabled: false,
        checked: true,
        busy: false,
        reason: "Not now",
        run: () => {},
      });
      // One bound thing, so the passes run at all.
      p.commands.add({
        id: "bound",
        title: "Bound",
        enabled: () => counter % 2 === 0,
        run: () => {},
      });
    },
    { capabilities: ["commands"] },
  );
  try {
    await host.settle();
    const before = countsOf(plugin);
    for (let i = 0; i < 20; i++) {
      counter++;
      plugin.update();
      await host.settle();
    }
    const after = countsOf(plugin);
    assert.equal(after.passes - before.passes, 20);
    // Only the bound command is evaluated: one evaluation per pass.
    assert.equal(after.evaluations - before.evaluations, 20);
    const registered = host.sent("commands.register").map((p) => p.id);
    assert.deepEqual(registered.sort(), ["bound", "constant", "fixed"]);
    const updated = host.sent("commands.update").map((p) => p.id);
    assert.ok(!updated.includes("fixed"));
    assert.ok(!updated.includes("constant"));
    assert.equal(updated.filter((id) => id === "bound").length, 20);
  } finally {
    await stop();
  }
});

test("Command.set pushes this command's state alone, without a full pass", async () => {
  let plugin!: Plugin;
  let reads = 0;
  let command!: ReturnType<Plugin["commands"]["add"]>;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      command = p.commands.add({ id: "toggle", title: "Toggle", run() {} });
      p.commands.add({
        id: "other",
        title: "Other",
        enabled: () => (reads++, true),
        run: () => {},
      });
    },
    { capabilities: ["commands"] },
  );
  try {
    await host.settle();
    const before = countsOf(plugin);
    const readsBefore = reads;
    command.set({ enabled: false, reason: "Busy elsewhere" });
    command.set({ checked: true });
    await host.settle();
    assert.deepEqual(host.command("toggle").state, {
      enabled: false,
      checked: true,
      busy: false,
      reason: "Busy elsewhere",
    });
    const updates = host
      .sent("commands.update")
      .filter((p) => p.id === "toggle");
    assert.equal(updates.length, 1, "two set() calls in one turn: one update");
    const after = countsOf(plugin);
    assert.equal(after.fullPasses - before.fullPasses, 0, "no full pass");
    assert.equal(reads, readsBefore, "the other command is not re-evaluated");
    // A function given later binds the command: it follows the state.
    let on = false;
    command.set({ checked: () => on });
    await host.settle();
    assert.equal(host.command("toggle").state.checked, false);
    on = true;
    plugin.update();
    await host.settle();
    assert.equal(host.command("toggle").state.checked, true);
  } finally {
    await stop();
  }
});

test("a plugin that never reads player.state subscribes to nothing", async () => {
  // Without `playback.read`: the copy of the player's state follows the
  // events only once something reads it.
  const { plugin, host, stop } = await startPlugin(
    (p: Plugin) => {
      p.commands.add({
        id: "half",
        title: "Half Speed",
        run: () => p.player.setRate(0.5),
      });
    },
    { capabilities: ["events", "playback.control", "commands"] },
  );
  try {
    await host.settle();
    assert.deepEqual(host.sent("events.subscribe"), []);
    assert.deepEqual([...host.subscriptions], []);
    host.openElsewhere("/movie.mp4");
    await host.settle();
    await host.command("half").run();
    await host.settle();
    assert.equal(host.source.rate, 0.5);
    assert.deepEqual(host.sent("events.subscribe"), []);
    // The first read follows the state from now on (a mirror).
    void plugin.player.state;
    await host.settle();
    assert.deepEqual(host.sent("events.subscribe"), [
      { event: "source.state", mirror: true },
    ]);
    host.setSource({ paused: true });
    await host.settle();
    assert.equal(plugin.player.state.source, "/movie.mp4");
    assert.equal(plugin.player.state.paused, true);
  } finally {
    await stop();
  }
});

test("with playback.read and events the copy follows from the start: a late first read is current", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: ["events", "playback.read"],
  });
  try {
    // Subscribed (a mirror) before the start-up read, as before 1.7.0.
    assert.deepEqual(
      host.calls.slice(0, 2).map((c) => c.method),
      ["events.subscribe", "source.state"],
    );
    assert.deepEqual(host.sent("events.subscribe"), [
      { event: "source.state", mirror: true },
    ]);
    host.openElsewhere("/movie.mp4");
    await host.settle();
    assert.equal(plugin.player.state.source, "/movie.mp4");
    assert.equal(host.sent("source.state").length, 1, "no read again");
  } finally {
    await stop();
  }
});

test("player.on: the payload is the wire event data, the listener is named, no mirror", async () => {
  const seen: unknown[] = [];
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.player.on("source.state", (state) => seen.push(state));
    },
    { capabilities: ["events"] },
  );
  try {
    await host.settle();
    assert.deepEqual(host.sent("events.subscribe").length, 1);
    const subscribe = host.sent("events.subscribe")[0]!;
    assert.equal(subscribe.event, "source.state");
    assert.equal(subscribe.mirror, undefined, "a listener, not a mirror");
    assert.match(
      String((subscribe.why as string[])[0]),
      /^a listener added at (test\/)?framework-optional\.test\.ts:\d+$/,
    );
    assert.deepEqual([...host.listening], ["source.state"]);
    host.setSource({ rate: 1.5 });
    await host.settle();
    assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], JSON.parse(JSON.stringify(host.source)));
    const typed = seen[0] as { rate: number };
    assert.equal(typed.rate, 1.5);
    // No update pass for a plugin with nothing bound.
    assert.equal(countsOf(plugin).passes, 0);
  } finally {
    await stop();
  }
});

test("player.on takes every HostEvent; dispose unsubscribes", async () => {
  const seen: [string, unknown][] = [];
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.player.on("window.state", (facts) => seen.push(["window", facts]));
      p.player.on("appearance.changed", (data) =>
        seen.push(["appearance", data]),
      );
      p.player.on("packages.changed", (list) => seen.push(["packages", list]));
    },
    { capabilities: ["events", "packages.manage"] },
  );
  try {
    await host.settle();
    assert.deepEqual(
      host
        .sent("events.subscribe")
        .map((p) => p.event)
        .sort(),
      ["appearance.changed", "packages.changed", "window.state"],
    );
    host.setAppearance("vestra-light");
    await host.settle();
    assert.deepEqual(seen.at(-1), ["appearance", { theme: "vestra-light" }]);
    const scope = plugin.scope();
    const keys: unknown[] = [];
    scope.player.on("timeline.changed", (lists) => keys.push(lists));
    await host.settle();
    assert.ok(host.subscriptions.has("timeline.changed"));
    await scope.dispose();
    await host.settle();
    assert.ok(!host.subscriptions.has("timeline.changed"));
  } finally {
    await stop();
  }
});

test("plugin.state: a write re-runs exactly its readers", async () => {
  const host = new TestHost();
  let plugin!: Plugin;
  const runs = { a: 0, b: 0, none: 0, command: 0 };
  let st!: { a: number; b: string; nested: { n: number } };
  let panel!: Panel;
  let window!: Window;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      st = p.state({ a: 1, b: "x", nested: { n: 0 } });
      panel = p.panels.mount("sidebar", "list.slint");
      panel.bind(() => (runs.a++, { total: String(st.a) }));
      window = p.windows.create("list.slint", { id: "list" });
      window.bind(() => (runs.b++, { label: st.b }));
      window.bind(() => (runs.none++, { total: "fixed" }));
      p.commands.add({
        id: "a",
        title: "A",
        enabled: () => (runs.command++, st.a > 0),
        run: () => {},
      });
    },
    {
      host,
      directory: packageWith(["ui.mount", "ui.window", "commands"]),
    },
  );
  try {
    await panel.ready;
    await window.show();
    await host.settle();
    const before = { ...runs };
    const counts = countsOf(plugin);
    st.a = 2;
    await host.settle();
    assert.deepEqual(
      {
        a: runs.a - before.a,
        b: runs.b - before.b,
        none: runs.none - before.none,
        command: runs.command - before.command,
      },
      { a: 1, b: 0, none: 0, command: 1 },
    );
    assert.equal(countsOf(plugin).fullPasses - counts.fullPasses, 0);
    assert.equal(host.mounted().props.total, "2");
    // An equal value is no change.
    const same = { ...runs };
    st.a = 2;
    st.b = "x";
    await host.settle();
    assert.deepEqual(runs, same);
    // One level: a nested object is not tracked, replacing it is.
    st.nested.n = 5;
    assert.equal(st.nested.n, 5);
    st.b = "y";
    await host.settle();
    assert.equal(runs.b - same.b, 1);
    assert.equal(host.window("list").props.label, "y");
    // Outside a pass, a read is a plain read.
    assert.equal(st.a, 2);
    assert.deepEqual(Object.keys(st), ["a", "b", "nested"]);
    assert.deepEqual({ ...st }, { a: 2, b: "y", nested: { n: 5 } });
  } finally {
    await stop();
  }
});

test("plugin.state: a write from an onChange listener re-runs the readers; plain objects only", async () => {
  let plugin!: Plugin;
  let panel!: Panel;
  let runs = 0;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      const st = p.state({ seconds: null as number | null });
      p.player.onChange((state) => {
        st.seconds = state.position;
      });
      panel = p.panels.mount("sidebar", "list.slint");
      // Reads only the tracked copy, not the player's state.
      panel.bind(() => (runs++, { total: String(st.seconds) }));
    },
    {
      directory: packageWith(["ui.mount", "events", "playback.read"]),
    },
  );
  try {
    await panel.ready;
    await host.settle();
    const before = runs;
    host.setSource({ position: 12 });
    await host.settle();
    assert.equal(host.mounted().props.total, "12");
    assert.ok(runs > before);
    // A state made through a child scope is the plugin's: same passes.
    const other = plugin.scope().state({ x: 0 });
    other.x = 1;
    assert.equal(other.x, 1);
    assert.throws(() => plugin.state(null as never), { code: "invalid" });
    assert.throws(() => plugin.state([] as never), { code: "invalid" });
    assert.throws(() => plugin.state(new Map() as never), { code: "invalid" });
  } finally {
    await stop();
  }
});

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

test("HostEvent is the wire's list, and each event needs what the player checks", () => {
  const same: Same<HostEvent, WireEvent> = true;
  const payload: Same<EventPayload<"commands.keys">["revision"], number> = true;
  assert.ok(same && payload);
  const subscribe = HOST_CAPABILITIES.capabilities
    .flatMap((c) => c.methods)
    .find((m) => m.name === "events.subscribe")!;
  const needs = subscribe.needs as {
    cases: Record<string, string | null>;
    otherwise: string;
  };
  for (const [event, need] of Object.entries(EVENT_NEEDS))
    assert.equal(
      need,
      event in needs.cases ? needs.cases[event] : needs.otherwise,
      event,
    );
});
