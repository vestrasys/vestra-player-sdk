// Regression tests from the Step 3 review (doc/specs/sdk-refactor.md §4 in
// the player repository; reviewer probes P1–P9): a never-bound view's cut
// initial list completed only while it still begins with the rows shown
// (M1), one table of command removals for `commands.add` and
// `plugin.wire.commands.register` (L1), the SDK's events never subscribed
// raw (L2), direct writes across a reopen (L3, L4), and a command's
// conditions kept by an update without them (L6).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostError, TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { Json } from "../src/wire.ts";
import type {
  Panel,
  Plugin,
  PluginError,
  Window,
} from "../src/plugin/types.ts";

function pkg(
  capabilities = ["ui.mount", "ui.window", "commands", "events"],
): string {
  const directory = mkdtempSync(join(tmpdir(), "wire-review-"));
  writeFileSync(
    join(directory, "list.slint"),
    [
      "export global ListBridge {",
      "  in property <[{rowId: string, label: string}]> rows;",
      "  in property <[{rowId: string, label: string}]> my-rows;",
      "  in property <string> total;",
      "  in property <string> label;",
      "}",
      // The same properties on the window's component.
      "export component List inherits Rectangle {",
      "  in property <[{rowId: string, label: string}]> rows;",
      "  in property <[{rowId: string, label: string}]> my-rows;",
      "  in property <string> total;",
      "  in property <string> label;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.review", capabilities }),
  );
  return directory;
}
const row = (key: string, label = `row ${key}`) => ({ rowId: key, label });
/** A list over one request (512 KiB of rows). */
const big = (tag: string, n = 3000) =>
  Array.from({ length: n }, (_, i) => row(`${tag}${i}`, "x".repeat(400)));
const declaration = (title: string) => ({
  title,
  path: ["Playback", title],
  order: 0,
  group: "domain",
  radio: false,
  bindings: [],
  focus: null,
  repeat: false,
});
/** Hold the `n`th request that `match` picks until the returned release. */
function hold(
  host: TestHost,
  match: (method: string, params: Record<string, Json>) => boolean,
  n = 1,
) {
  const request = host.request.bind(host);
  let seen = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  host.request = (async (method: string, params: Record<string, Json> = {}) => {
    if (match(method, params) && ++seen === n) {
      const answer = request(method, params);
      await held;
      return answer;
    }
    return request(method, params);
  }) as typeof host.request;
  return release;
}

test("M1 (P6): a cut list whose flush waits is not completed onto a list bound meanwhile", async () => {
  let window!: Window;
  const errors: PluginError[] = [];
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      p.onError((error) => errors.push(error));
      window = p.windows.create("list.slint", { id: "list" });
      window.set({ rows: big("a") });
    },
    { directory: pkg() },
  );
  try {
    await window.show();
    await host.settle(50);
    assert.equal((host.window("list").props.rows as Json[]).length, 3000);
    // A failed write leaves a back-off: the flush after the reopen waits.
    const request = host.request.bind(host);
    let fail = true;
    host.request = (async (method: string, params: Record<string, Json>) => {
      if (method === "ui.set" && params.property === "label" && fail) {
        fail = false;
        throw new HostError("busy", "not now");
      }
      return request(method, params);
    }) as typeof host.request;
    window.set({ label: "x" });
    await host.settle(20);
    await window.close();
    await window.show(); // the initial `rows` cut to one request
    const other = big("b");
    window.bind(() => ({ rows: other }));
    await new Promise((resolve) => setTimeout(resolve, 600));
    await host.settle(50);
    assert.deepEqual(host.window("list").props.rows, other);
    assert.deepEqual(
      errors.map((error) => error.code),
      ["busy"],
    );
  } finally {
    await stop();
  }
});

test("M1: a cut list completed by inserts falls back to the whole value on stale", async () => {
  const host = new TestHost();
  let panel!: Panel;
  const list = big("a");
  const request = host.request.bind(host);
  let refused = 0;
  host.request = (async (method: string, params: Record<string, Json>) => {
    const patch = params.patch as { base?: number } | undefined;
    if (method === "ui.setMount" && patch?.base === 0 && refused++ === 0)
      throw new HostError("stale", "the property changed");
    return request(method, params);
  }) as typeof host.request;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      panel = p.panels.mount("sidebar", "list.slint");
      panel.set({ rows: list });
    },
    { host, directory: pkg() },
  );
  try {
    await panel.ready;
    await host.settle(100);
    assert.equal(refused, 1, "the insert on the initial rows was refused");
    assert.deepEqual(host.mounted().props.rows, list);
  } finally {
    await stop();
  }
});

test("M1 (P7): a cut list changed while opening still arrives as it is", async () => {
  for (const mode of ["append", "replace-head", "replace-tail"]) {
    let panel!: Panel;
    const first = big("a");
    const { host, stop } = await startPlugin(
      (p: Plugin) => {
        panel = p.panels.mount("bottom", "list.slint");
        panel.set({ rows: first });
      },
      { directory: pkg() },
    );
    try {
      const next =
        mode === "append"
          ? [...first, row("extra")]
          : mode === "replace-head"
            ? [row("new"), ...first.slice(1)]
            : [...first.slice(0, 2000), ...big("t", 1000)];
      panel.set({ rows: next });
      await panel.ready;
      await host.settle(100);
      assert.deepEqual(host.mounted().props.rows, next, mode);
    } finally {
      await stop();
    }
  }
});

test("L1 (P4): commands.add and wire.commands.register wait for each other's removal of an id", async () => {
  let plugin!: Plugin;
  const errors: PluginError[] = [];
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.onError((error) => errors.push(error));
    },
    { capabilities: ["commands"] },
  );
  try {
    const added = plugin.commands.add({
      id: "x",
      path: ["Playback", "X"],
      run: () => {},
    });
    await added.ready;
    const removed = added.dispose();
    const raw = plugin.wire.commands.register({
      id: "x",
      declaration: declaration("X"),
    });
    await removed;
    await raw.ready;
    const registered = plugin.wire.commands.register({
      id: "y",
      declaration: declaration("Y"),
    });
    await registered.ready;
    const gone = registered.dispose();
    const again = plugin.commands.add({
      id: "y",
      path: ["Playback", "Y"],
      run: () => {},
    });
    await gone;
    await again.ready;
    await host.settle(20);
    assert.ok(host.command("x"));
    assert.ok(host.command("y"));
    assert.deepEqual(
      host.calls
        .filter((call) => call.method.startsWith("commands."))
        .map((call) => `${call.method} ${(call.params as { id: string }).id}`),
      [
        "commands.register x",
        "commands.unregister x",
        "commands.register x",
        "commands.register y",
        "commands.unregister y",
        "commands.register y",
      ],
    );
    assert.deepEqual(errors, []);
  } finally {
    await stop();
  }
});

test("L2 (P5): a raw subscription to one of the SDK's events is refused, marked or not", async () => {
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.wire.on("source.state", () => {});
    },
    { capabilities: ["events", "playback.read"] },
  );
  try {
    await host.settle(10);
    const before = host.sent("events.subscribe").length;
    assert.throws(
      () =>
        plugin.wire.request("events.subscribe", {
          event: "source.state",
          mirror: true,
        }),
      { code: "invalid" },
    );
    assert.equal(host.sent("events.subscribe").length, before);
    assert.ok(host.listening.has("source.state"), "the listener mark stays");
  } finally {
    await stop();
  }
});

test("L3 (P2): a direct write in parts across a close and reopen is unavailable, and writes no rows on the new window", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      window = p.windows.create("list.slint", { id: "list" });
    },
    { directory: pkg() },
  );
  try {
    await window.show();
    const view = plugin.wire.view(window);
    const release = hold(
      host,
      (method, params) => method === "ui.set" && params.property === "rows",
      2,
    );
    const write = view.write("rows", { value: big("a") });
    await host.settle(20);
    await window.close();
    await window.show();
    release();
    await assert.rejects(write, { code: "unavailable" });
    const mark = host.calls.length;
    // No direct write since the reopen: the rows are refused before sending.
    await assert.rejects(
      view.writeRows("rows", [{ op: "insert", at: 0, rows: [row("z")] }]),
      { code: "stale", message: /write the whole value first/ },
    );
    assert.equal(host.calls.slice(mark).length, 0);
    // A whole value, then rows, work on the new window.
    await view.write("rows", { value: [row("a")] });
    await view.writeRows("rows", [{ op: "insert", at: 1, rows: [row("b")] }]);
    assert.deepEqual(host.window("list").props.rows, [row("a"), row("b")]);
  } finally {
    await stop();
  }
});

test("L3 (P3): a whole direct write answered after a reopen is unavailable and no base for rows", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      window = p.windows.create("list.slint", { id: "list" });
    },
    { directory: pkg() },
  );
  try {
    await window.show();
    const view = plugin.wire.view(window);
    const release = hold(
      host,
      (method, params) => method === "ui.set" && params.property === "rows",
    );
    const write = view.write("rows", { value: [row("a")] });
    await host.settle(10);
    await window.close();
    await window.show();
    release();
    // The player took it for the window that closed, as the doc says.
    await assert.rejects(write, {
      code: "unavailable",
      message: /closed or showed its initial properties again/,
    });
    const mark = host.calls.length;
    await assert.rejects(
      view.writeRows("rows", [{ op: "insert", at: 0, rows: [row("z")] }]),
      { code: "stale" },
    );
    assert.equal(host.calls.length, mark, "nothing sent");
  } finally {
    await stop();
  }
});

test("L3: a direct patch answered after a reopen is unavailable and no base for rows", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      window = p.windows.create("list.slint", { id: "list" });
    },
    { directory: pkg() },
  );
  try {
    await window.show();
    const view = plugin.wire.view(window);
    await view.write("rows", { value: [row("a")], seq: 1 });
    const release = hold(
      host,
      (method, params) => method === "ui.set" && params.property === "rows",
    );
    const write = view.write("rows", {
      patch: {
        base: 1,
        seq: 2,
        ops: [{ op: "insert", at: 1, rows: [row("b")] }],
      },
    });
    await host.settle(10);
    await window.close();
    await window.show();
    release();
    await assert.rejects(write, { code: "unavailable" });
    const mark = host.calls.length;
    await assert.rejects(
      view.writeRows("rows", [{ op: "insert", at: 0, rows: [row("z")] }]),
      { code: "stale" },
    );
    assert.equal(host.calls.length, mark, "nothing sent");
  } finally {
    await stop();
  }
});

test("L4: rows without a whole direct write first are refused with stale", async () => {
  let panel!: Panel;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      panel = p.panels.mount("bottom", "list.slint");
    },
    { directory: pkg() },
  );
  try {
    await panel.ready;
    const mark = host.calls.length;
    await assert.rejects(
      plugin.wire
        .view(panel)
        .writeRows("rows", [{ op: "insert", at: 0, rows: [row("a")] }]),
      { code: "stale" },
    );
    assert.equal(host.calls.length, mark);
  } finally {
    await stop();
  }
});

test("L3: disposing a view resolves its waiting direct writes with false", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      window = p.windows.create("list.slint", { id: "list" });
    },
    { directory: pkg() },
  );
  try {
    await window.show();
    const view = plugin.wire.view(window);
    const release = hold(
      host,
      (method, params) => method === "ui.set" && params.property === "rows",
    );
    const first = view.write("rows", { value: [row("a")] });
    const waiting = view.writeRows("rows", [{ op: "remove", at: 0, count: 1 }]);
    await host.settle(10);
    const disposed = window.dispose();
    assert.equal(await waiting, false);
    release();
    await first.catch(() => {});
    await disposed;
  } finally {
    await stop();
  }
});

test("P1: one track per property, camelCase or as in Slint", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      window = p.windows.create("list.slint", { id: "list" });
    },
    { directory: pkg() },
  );
  try {
    await window.show();
    const view = plugin.wire.view(window);
    await view.write("myRows", { value: [row("a")] });
    assert.throws(() => window.set({ myRows: [] }), { code: "invalid" });
    assert.throws(() => window.set({ "my-rows": [] }), { code: "invalid" });
    window.set({ label: "x" });
    assert.throws(() => view.write("label", { value: "y" }), {
      code: "invalid",
    });
  } finally {
    await stop();
  }
});

test("P9: direct writes beside a bound list sent in parts, then a reopen", async () => {
  let window!: Window;
  let plugin!: Plugin;
  const errors: PluginError[] = [];
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.onError((error) => errors.push(error));
      window = p.windows.create("list.slint", { id: "list" });
    },
    { directory: pkg() },
  );
  try {
    const st = { list: [row("a")] };
    await window.show();
    window.bind(() => ({ rows: st.list }));
    await host.settle(20);
    const view = plugin.wire.view(window);
    const release = hold(
      host,
      (method, params) => method === "ui.set" && params.property === "rows",
      2,
    );
    st.list = big("b");
    plugin.update();
    await host.settle(10);
    // Another property's direct writes do not wait for the bound list.
    assert.deepEqual(
      await Promise.all([
        view.write("label", { value: "one" }),
        view.write("label", { value: "two" }),
      ]),
      [true, true],
    );
    assert.equal(host.window("list").props.label, "two");
    release();
    await host.settle(100);
    assert.deepEqual(host.window("list").props.rows, st.list);
    await window.close();
    await window.show();
    await host.settle(100);
    assert.equal((host.window("list").props.rows as Json[]).length, 3000);
    assert.equal(host.window("list").props.label, undefined);
    assert.deepEqual(errors, []);
  } finally {
    await stop();
  }
});

test("L6: an update without when keeps the conditions sent before", async () => {
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities: ["commands"] },
  );
  try {
    const when = { enabled: { playing: true } } as unknown as Json;
    const command = plugin.wire.commands.register({
      id: "c",
      declaration: declaration("C"),
      when,
    });
    await command.ready;
    await command.update({ busy: true });
    assert.deepEqual(host.sent("commands.update").at(-1)!.when, when);
    const other = { checked: { paused: true } } as unknown as Json;
    await command.update({ busy: false }, other);
    assert.deepEqual(host.sent("commands.update").at(-1)!.when, other);
    await command.update({ enabled: false });
    assert.deepEqual(host.sent("commands.update").at(-1)!.when, other);
  } finally {
    await stop();
  }
});
