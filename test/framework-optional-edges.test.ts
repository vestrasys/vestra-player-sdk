// Regression tests from the review of refactor Step 2 (SDK 1.7.0): views
// that are only written with `set()` while they open, the player's state
// copy of a plugin without `playback.read`, `Command.set` without a full
// pass, `plugin.state` edges and its loop guard, and `player.on` in a
// plugin with bindings.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MAX_CHAINED_PASSES } from "../src/plugin/passes.ts";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { ScopeImpl } from "../src/plugin/scope.ts";
import type { Json } from "../src/wire.ts";
import type {
  Panel,
  Plugin,
  PluginError,
  Window,
} from "../src/plugin/types.ts";

function packageWith(capabilities: string[] = []) {
  const directory = mkdtempSync(join(tmpdir(), "edges-"));
  writeFileSync(
    join(directory, "list.slint"),
    [
      "export global ListBridge {",
      "  in property <[{rowId: string, label: string}]> rows;",
      "  in property <string> total;",
      "  in property <string> label;",
      "}",
      // The same properties on the window's component.
      "export component List inherits Rectangle {",
      "  in property <[{rowId: string, label: string}]> rows;",
      "  in property <string> total;",
      "  in property <string> label;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.edges", capabilities }),
  );
  return directory;
}
const row = (key: string, label = `row ${key}`) => ({ rowId: key, label });
const countsOf = (plugin: Plugin) => ({
  ...(plugin as ScopeImpl).runtime.counts,
});

/** Hold the first `method` request until the returned function is called. */
function gate(host: TestHost, method: string) {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  const request = host.request.bind(host);
  let held = false;
  host.request = (async (m: string, params: Json = {}) => {
    if (m === method && !held) {
      held = true;
      await opened;
    }
    return request(m, params);
  }) as typeof host.request;
  return open;
}

/** Every request the plugin sent, in order. */
function recorded(host: TestHost) {
  const writes: { method: string; params: Record<string, Json> }[] = [];
  const request = host.request.bind(host);
  host.request = (async (method: string, params: Record<string, Json> = {}) => {
    writes.push({ method, params });
    return request(method, params);
  }) as typeof host.request;
  return writes;
}

test("a never-bound panel: set() while ui.mount is answered is sent", async () => {
  const host = new TestHost();
  const open = gate(host, "ui.mount");
  let panel!: Panel;
  const { stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.set({ label: "one" });
      setTimeout(() => {
        panel.set({ label: "two" }); // ui.mount is in flight
        open();
      }, 20);
    },
    { host, directory: packageWith() },
  );
  try {
    await panel.ready;
    await host.settle(50);
    assert.equal(host.mounted().props.label, "two");
  } finally {
    await stop();
  }
});

test("a never-bound window: set() while ui.open is answered is sent", async () => {
  const host = new TestHost();
  const open = gate(host, "ui.open");
  let win!: Window;
  const { stop } = await startPlugin(
    (plugin: Plugin) => {
      win = plugin.windows.create("list.slint");
      win.set({ label: "one" });
      void win.show();
      setTimeout(() => {
        win.set({ label: "two" });
        open();
      }, 20);
    },
    { host, directory: packageWith() },
  );
  try {
    await host.settle(80);
    assert.equal(host.window("list").props.label, "two");
  } finally {
    await stop();
  }
});

test("a never-bound panel: an initial list over one request's size arrives whole, its first part sent once", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let panel!: Panel;
  const big = Array.from({ length: 6000 }, (_, i) =>
    row(String(i), "x".repeat(100)),
  );
  const { stop } = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("sidebar", "list.slint");
      panel.set({ rows: big });
    },
    { host, directory: packageWith() },
  );
  try {
    await panel.ready;
    await host.settle(100);
    assert.deepEqual(host.mounted().props.rows, big);
    // The mount carried the first rows; after it only the rest went, as
    // inserts on them (the first applying on the initial properties, 0),
    // never a whole value again.
    const initial = (host.sent("ui.mount")[0]!.properties as { rows: Json[] })
      .rows;
    assert.ok(initial.length > 0 && initial.length < big.length);
    const rows = writes.filter((w) => w.params.property === "rows");
    assert.ok(rows.length > 0);
    assert.ok(rows.every((w) => "patch" in w.params && !("value" in w.params)));
    const first = rows[0]!.params.patch as {
      base: number;
      ops: { op: string; at: number }[];
    };
    assert.equal(first.base, 0);
    assert.deepEqual(
      [first.ops[0]!.op, first.ops[0]!.at],
      ["insert", initial.length],
    );
  } finally {
    await stop();
  }
});

test("set() several times, then bind(): the bound changes patch correctly", async () => {
  const host = new TestHost();
  const writes = recorded(host);
  let panel!: Panel;
  let rows = Array.from({ length: 40 }, (_, i) => row(String(i)));
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      panel = p.panels.mount("sidebar", "list.slint");
    },
    { host, directory: packageWith() },
  );
  try {
    await panel.ready;
    await host.settle();
    for (let i = 0; i < 5; i++) {
      rows = [...rows, row(`n${i}`)];
      panel.set({ rows });
      await host.settle();
    }
    const mark = writes.length;
    panel.bind(() => ({ rows, total: String(rows.length) }));
    await host.settle();
    // The list the host shows is not sent again; `total` is new.
    assert.deepEqual(
      writes.slice(mark).map((w) => w.params.property),
      ["total"],
    );
    rows = rows.map((r, i) => (i === 3 ? row(r.rowId, "edited") : r));
    plugin.update();
    await host.settle();
    rows = [...rows.slice(0, 10), ...rows.slice(12)];
    plugin.update();
    await host.settle();
    // The first bound change of the list goes whole (no base yet), the
    // next one as a patch.
    const lists = writes
      .slice(mark)
      .filter((w) => w.params.property === "rows")
      .map((w) => ("patch" in w.params ? "patch" : "value"));
    assert.deepEqual(lists, ["value", "patch"]);
    assert.deepEqual(host.mounted().props.rows, rows);
    assert.equal(host.mounted().props.total, String(rows.length));
  } finally {
    await stop();
  }
});

test("Command.set no longer refreshes other bindings (SDK 1.7.0): update() does", async () => {
  const host = new TestHost();
  let panel!: Panel;
  let plugin!: Plugin;
  let flag = "off";
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      panel = p.panels.mount("sidebar", "list.slint");
      panel.bind(() => ({ label: flag }));
      const cmd = p.commands.add({
        id: "t.toggle",
        path: ["Tools", "Toggle"],
        checked: false,
        run: () => {
          setTimeout(() => {
            flag = "on";
            cmd.set({ checked: true });
          }, 1);
        },
      });
    },
    { host, directory: packageWith() },
  );
  try {
    await panel.ready;
    await host.settle();
    await host.command("t.toggle").run();
    await host.settle(30);
    assert.equal(host.command("t.toggle").state.checked, true);
    assert.equal(host.mounted().props.label, "off");
    plugin.update();
    await host.settle();
    assert.equal(host.mounted().props.label, "on");
  } finally {
    await stop();
  }
});

test("events without playback.read: a handler's first read is current", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 60, position: 5, paused: false });
  const read: unknown[] = [];
  const { stop } = await startPlugin(
    (p: Plugin) => {
      p.commands.add({
        id: "t.read",
        path: ["Tools", "Read"],
        run: () =>
          void read.push([p.player.state.phase, p.player.state.paused]),
      });
    },
    { host, directory: packageWith([]) },
  );
  try {
    await host.settle();
    host.setSource({ paused: true });
    await host.settle(20);
    await host.command("t.read").run();
    await host.settle(20);
    assert.deepEqual(read, [["ready", true]]);
    assert.deepEqual(host.sent("events.subscribe"), [
      { event: "source.state", mirror: true },
    ]);
  } finally {
    await stop();
  }
});

test("plugin.state behaves like a plain object", async () => {
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: [],
  });
  try {
    const st = plugin.state({ a: 1, list: [1, 2], nested: { x: 1 } }) as Record<
      string,
      unknown
    >;
    assert.deepEqual(Object.keys(st), ["a", "list", "nested"]);
    assert.equal(JSON.stringify(st), '{"a":1,"list":[1,2],"nested":{"x":1}}');
    assert.deepEqual({ ...st }, { a: 1, list: [1, 2], nested: { x: 1 } });
    assert.ok("a" in st);
    assert.ok(!("z" in st));
    assert.ok(Array.isArray(st.list));
    assert.throws(() => structuredClone(st));
    assert.equal(delete st.a, true);
    st.added = 5;
    assert.deepEqual(Object.entries(st), [
      ["list", [1, 2]],
      ["nested", { x: 1 }],
      ["added", 5],
    ]);
    // A frozen initial object is copied: the copy can be written.
    const copy = plugin.state(Object.freeze({ q: 1 }) as { q: number });
    copy.q = 2;
    assert.equal(copy.q, 2);
    for (const initial of [null, [1, 2], new Map()])
      assert.throws(() => plugin.state(initial as never), { code: "invalid" });
  } finally {
    await stop();
  }
});

test("plugin.state: precise readers, the loop guard, a disposed scope's state", async () => {
  const host = new TestHost();
  let panel!: Panel;
  let a = 0;
  let b = 0;
  let st!: { x: number; y: number; n: number };
  const errors: PluginError[] = [];
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      p.onError((error) => errors.push(error));
      st = p.state({ x: 1, y: 1, n: 0 });
      panel = p.panels.mount("bottom", "list.slint");
      panel.bind(() => (a++, { label: String(st.x) }));
      panel.bind(() => (b++, { total: String(st.y) }));
    },
    { host, directory: packageWith() },
  );
  try {
    await panel.ready;
    await host.settle();
    a = b = 0;
    st.x = 2;
    await host.settle();
    assert.deepEqual({ a, b }, { a: 1, b: 0 });
    assert.equal(host.mounted().props.label, "2");
    // A bind function that writes what it reads: stopped, reported once.
    let loops = 0;
    panel.bind(() => {
      loops++;
      if (st.n < 100_000) st.n = st.n + 1;
      return {};
    });
    await host.settle(100);
    assert.ok(loops <= MAX_CHAINED_PASSES + 2, `${loops} evaluations`);
    assert.equal(errors.length, 1);
    assert.equal(errors[0]!.code, "limit");
    // The plugin still works: a later change from outside runs again.
    st.x = 3;
    await host.settle();
    assert.equal(host.mounted().props.label, "3");
    assert.equal(errors.length, 1, "reported once");
    // A disposed scope's state is a plain object: no pass.
    const child = plugin.scope();
    const cs = child.state({ v: 1 });
    panel.bind(() => ({ total: String(cs.v) }));
    await host.settle();
    await child.dispose();
    const before = countsOf(plugin);
    cs.v = 2;
    await host.settle();
    assert.equal(cs.v, 2);
    assert.equal(countsOf(plugin).passes - before.passes, 0);
  } finally {
    await stop();
  }
});

test("commands and views made and disposed unbound cost no pass; set() batches", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(() => {}, {
    host,
    directory: packageWith(),
  });
  try {
    const before = countsOf(plugin);
    for (let i = 0; i < 50; i++) {
      const command = plugin.commands.add({
        id: `c.${i}`,
        path: ["T", `c${i}`],
        run: () => {},
      });
      const scope = plugin.scope();
      scope.panels.mount("bottom", "list.slint");
      await command.dispose();
      await scope.dispose();
    }
    plugin.update();
    await host.settle();
    assert.equal(countsOf(plugin).evaluations - before.evaluations, 0);
    const command = plugin.commands.add({
      id: "k",
      path: ["T", "k"],
      run: () => {},
    });
    await host.settle();
    command.set({ busy: true });
    command.set({ reason: "r" });
    command.set({ busy: false });
    await host.settle();
    const updates = host.sent("commands.update").filter((u) => u.id === "k");
    assert.equal(updates.length, 1);
    assert.deepEqual(host.command("k").state, {
      enabled: true,
      checked: null,
      busy: false,
      reason: "r",
    });
  } finally {
    await stop();
  }
});

test("player.on: refusals, and a child scope's listener stops with it", async () => {
  const host = new TestHost();
  const got: boolean[] = [];
  const { plugin, stop } = await startPlugin(() => {}, {
    host,
    directory: packageWith(),
  });
  try {
    assert.throws(() => plugin.player.on("nope" as never, () => {}), {
      code: "invalid",
    });
    assert.throws(() => plugin.player.on("source.state", 1 as never), {
      code: "invalid",
    });
    const child = plugin.scope();
    child.player.on("source.state", (s) => void got.push(s.paused));
    await host.settle();
    host.setSource({ phase: "ready", paused: true });
    await host.settle();
    await child.dispose();
    host.setSource({ paused: false });
    await host.settle();
    assert.deepEqual(got, [true]);
    // The state copy keeps its subscription (a mirror again).
    assert.ok(host.subscriptions.has("source.state"));
    assert.deepEqual([...host.listening], []);
  } finally {
    await stop();
  }
});

test("player.on in a plugin with bindings runs no full pass per event", async () => {
  const host = new TestHost();
  let panel!: Panel;
  let heard = 0;
  let evaluated = 0;
  let plugin!: Plugin;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      panel = p.panels.mount("bottom", "list.slint");
      // Reads the rate only: position changes do not concern it.
      panel.bind(
        () => (evaluated++, { label: `${p.player.state.rate.toFixed(2)}×` }),
      );
      p.player.on("source.state", () => void heard++);
    },
    { host, directory: packageWith() },
  );
  try {
    await panel.ready;
    await host.settle();
    host.openElsewhere("/movie.mp4");
    await host.settle();
    const before = countsOf(plugin);
    const evaluatedBefore = evaluated;
    for (let i = 1; i <= 50; i++) {
      host.setSource({ position: i });
      await host.settle();
    }
    const after = countsOf(plugin);
    assert.equal(heard >= 50, true);
    // Only the safety pass (once a second while precise passes skip it)
    // evaluates the binding; no pass follows the listener.
    const safety = after.safetyPasses - before.safetyPasses;
    assert.equal(after.fullPasses - before.fullPasses, safety);
    assert.equal(evaluated - evaluatedBefore, safety);
    // A rate change still reaches the binding (a precise pass).
    host.setSource({ rate: 1.5 });
    await host.settle();
    assert.equal(host.mounted().props.label, "1.50×");
  } finally {
    await stop();
  }
});
