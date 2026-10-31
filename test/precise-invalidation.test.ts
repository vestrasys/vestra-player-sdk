// Precise update passes (SDK 1.5.45): after a `source.state` change the SDK
// re-runs only the bind functions and command states that read a changed
// field of `plugin.player.state`; plugin code the SDK runs and
// `plugin.update()` still cause a full pass, and a full pass follows a
// skipping precise pass within SAFETY_PASS_MS.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import test, { mock } from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Panel, Plugin, PlayerState } from "../src/plugin/types.ts";
import { SAFETY_PASS_MS } from "../src/plugin/runtime.ts";

function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "precise-"));
  writeFileSync(
    join(directory, "bar.slint"),
    [
      "export global BarBridge {",
      "  in property <bool> paused;",
      "  in property <float> position;",
      "  in property <string> note;",
      "  in property <int> rows;",
      "}",
      "export component Bar inherits Rectangle {}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "test.precise",
      capabilities: ["ui.mount", "playback.read", "events"],
    }),
  );
  return directory;
}

/** Microtasks only: the update pass is one (no timers, for fake timers too). */
async function drain() {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

interface Counts {
  paused: number;
  position: number;
  plain: number;
}

async function setup(
  extra: (plugin: Plugin, counts: Counts) => void = () => {},
) {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 100, position: 0 });
  const counts: Counts = { paused: 0, position: 0, plain: 0 };
  let panel!: Panel;
  const started = await startPlugin(
    (plugin: Plugin) => {
      panel = plugin.panels.mount("bottom", "bar.slint");
      panel.bind(() => {
        counts.paused++;
        return { paused: plugin.player.state.paused };
      });
      panel.bind(() => {
        counts.position++;
        return { position: plugin.player.state.position ?? 0 };
      });
      extra(plugin, counts);
    },
    { host, directory: packageWith() },
  );
  await panel.ready;
  await host.settle();
  const reset = () => {
    counts.paused = 0;
    counts.position = 0;
    counts.plain = 0;
  };
  return { ...started, host, counts, reset };
}

test("a bind reading only paused does not re-run on position ticks; one reading position does", async () => {
  const { host, counts, reset, stop } = await setup();
  reset();
  for (let i = 1; i <= 5; i++) {
    host.setSource({ position: i });
    await host.settle();
  }
  assert.equal(counts.paused, 0, "paused binder skipped");
  assert.equal(counts.position, 5, "position binder ran each tick");
  assert.equal(host.mounted().props.position, 5);
  assert.equal(host.mounted().props.paused, false);
  host.setSource({ paused: true });
  await host.settle();
  assert.equal(counts.paused, 1, "a paused change re-runs it");
  assert.equal(counts.position, 5, "and not the position binder");
  assert.equal(host.mounted().props.paused, true);
  await stop();
});

test("command state functions follow only the fields they read", async () => {
  let checks = 0;
  let reasons = 0;
  let ran = 0;
  const { host, plugin, counts, reset, stop } = await setup((plugin) => {
    plugin.commands.add({
      id: "pause",
      title: "Pause",
      checked: () => {
        checks++;
        return plugin.player.state.paused;
      },
      reason: () => {
        reasons++;
        return `at ${plugin.player.state.position}`;
      },
      run: () => {
        ran++;
      },
    });
  });
  void plugin;
  reset();
  checks = 0;
  reasons = 0;
  host.setSource({ position: 7 });
  await host.settle();
  // One command is one binding: a field read by any of its functions
  // re-runs them all.
  assert.equal(checks, 1);
  assert.equal(reasons, 1);
  assert.equal(host.command("pause").state.reason, "at 7");
  assert.equal(counts.paused, 0);
  // A command reading only paused stays out of position ticks.
  await stop();

  let only = 0;
  const second = await setup((plugin) => {
    plugin.commands.add({
      id: "pause",
      title: "Pause",
      checked: () => {
        only++;
        return plugin.player.state.paused;
      },
      run: () => {},
    });
  });
  only = 0;
  second.host.setSource({ position: 3 });
  await second.host.settle();
  assert.equal(only, 0);
  second.host.setSource({ paused: true });
  await second.host.settle();
  assert.equal(only, 1);
  assert.equal(second.host.command("pause").state.checked, true);
  await second.stop();
  void ran;
});

test("a full pass follows a command's run and plugin.update()", async () => {
  let note = "a";
  const { host, plugin, counts, reset, stop } = await setup((plugin) => {
    plugin.commands.add({
      id: "note",
      title: "Note",
      run: () => {
        note = "b";
      },
    });
  });
  void note;
  reset();
  await host.command("note").run();
  await host.settle();
  assert.equal(counts.paused, 1, "every binder after a command");
  assert.equal(counts.position, 1);
  reset();
  plugin.update();
  await host.settle();
  assert.equal(counts.paused, 1, "and after update()");
  assert.equal(counts.position, 1);
  await stop();
});

test("an onChange listener that read a changed field gets a full pass; one that did not, does not", async () => {
  let reads: "position" | "paused" = "paused";
  let seen = 0;
  const { host, counts, reset, stop } = await setup((plugin) => {
    plugin.player.onChange((state) => {
      seen =
        reads === "position" ? (state.position ?? 0) : Number(state.paused);
    });
  });
  void seen;
  reset();
  host.setSource({ position: 1 });
  await host.settle();
  assert.equal(counts.paused, 0, "the listener read only paused (unchanged)");
  reads = "position";
  host.setSource({ position: 2 });
  await host.settle();
  assert.equal(counts.paused, 1, "it read position (changed): full pass");
  await stop();
});

test("a listener that reads no field (or returns a promise) gets a full pass", async () => {
  let ticks = 0;
  const { host, counts, reset, stop } = await setup((plugin) => {
    plugin.player.onChange(() => {
      ticks++;
    });
  });
  reset();
  host.setSource({ position: 1 });
  await host.settle();
  assert.equal(ticks > 0, true);
  assert.equal(counts.paused, 1);
  await stop();
});

test("the safety pass: a full pass within SAFETY_PASS_MS of a precise pass that skipped", async () => {
  let note = "before";
  let notes = 0;
  const { host, counts, reset, stop } = await setup((plugin) => {
    plugin.commands.add({
      id: "note",
      title: "Note",
      reason: () => {
        notes++;
        return note;
      },
      run: () => {},
    });
  });
  reset();
  notes = 0;
  mock.timers.enable({ apis: ["setTimeout"] });
  try {
    // Plugin state changed outside SDK-run code, without update().
    note = "after";
    host.setSource({ position: 1 });
    await drain();
    assert.equal(counts.position, 1);
    assert.equal(notes, 0, "skipped by the precise pass");
    mock.timers.tick(SAFETY_PASS_MS / 2);
    host.setSource({ position: 2 });
    await drain();
    assert.equal(notes, 0, "a later tick does not move the deadline");
    mock.timers.tick(SAFETY_PASS_MS / 2 - 1);
    await drain();
    assert.equal(notes, 0);
    mock.timers.tick(1);
    await drain();
    assert.equal(notes, 1, "the safety pass ran");
    assert.equal(counts.paused, 1);
    // Nothing flows: no further pass.
    mock.timers.tick(SAFETY_PASS_MS * 3);
    await drain();
    assert.equal(notes, 1);
    // A full pass meanwhile cancels the pending safety pass.
    host.setSource({ position: 3 });
    await drain();
    void host.command("note").run();
    await drain();
    assert.equal(notes, 2, "a command run: full pass");
    mock.timers.tick(SAFETY_PASS_MS);
    await drain();
    assert.equal(notes, 2, "no safety pass after a full one");
  } finally {
    mock.timers.reset();
  }
  await host.settle();
  assert.equal(host.command("note").state.reason, "after");
  await stop();
});

test("the state reads like the plain frozen object it was", async () => {
  const { plugin, host, stop } = await setup();
  host.setSource({ position: 4, paused: true });
  await host.settle();
  const state: PlayerState = plugin.player.state;
  assert.ok(Object.isFrozen(state));
  assert.equal(state.position, 4);
  assert.deepEqual(Object.keys(state).slice(0, 4), [
    "sourceId",
    "kind",
    "phase",
    "source",
  ]);
  const copy = { ...state };
  assert.deepEqual(
    JSON.parse(JSON.stringify(state)),
    JSON.parse(JSON.stringify(copy)),
  );
  assert.deepEqual(structuredClone(state), copy);
  assert.deepEqual(state, copy);
  assert.equal(inspect(state), inspect(copy));
  assert.equal(plugin.player.state, state, "the same object until it changes");
  assert.equal(plugin.player.isCurrent(state), true);
  await stop();
});

test("binders whose results depend on isCurrent follow source changes", async () => {
  let current = 0;
  let held: PlayerState | undefined;
  const { host, stop } = await setup((plugin) => {
    held = plugin.player.state;
    plugin.commands.add({
      id: "current",
      title: "Current",
      enabled: () => {
        current++;
        return plugin.player.isCurrent(held!);
      },
      run: () => {},
    });
  });
  current = 0;
  host.setSource({ position: 9 });
  await host.settle();
  assert.equal(current, 0, "a position tick keeps the stamp");
  host.openElsewhere("/other.mp4", "loading");
  await host.settle();
  assert.ok(current >= 1, "a new source changes the stamp");
  assert.equal(host.command("current").state.enabled, false);
  await stop();
});

test("the player's runner path (createPlugin over a transport) skips and refreshes like TestHost", async () => {
  const { createPlugin } = await import("../src/plugin/index.ts");
  type Listener = (data: unknown) => void;
  const listeners = new Map<string, Set<Listener>>();
  let source = {
    ...new TestHost().source,
    phase: "ready" as const,
    position: 0,
  };
  const transport = {
    async request<T>(method: string): Promise<T> {
      if (method === "source.state") return source as T;
      return null as T;
    },
    on(event: string, listener: Listener) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
      return () => listeners.get(event)!.delete(listener);
    },
  };
  const push = (patch: Partial<typeof source>) => {
    source = { ...source, ...patch, eventSequence: source.eventSequence + 1 };
    for (const listener of listeners.get("source.state") ?? [])
      listener(source);
  };
  const instance = await createPlugin(
    transport,
    { id: "x", capabilities: ["playback.read", "events", "commands"] },
    process.cwd(),
  );
  const counts = { paused: 0, position: 0 };
  instance.plugin.commands.add({
    id: "paused",
    title: "Paused",
    checked: () => (counts.paused++, instance.plugin.player.state.paused),
    run: () => {},
  });
  instance.plugin.commands.add({
    id: "position",
    title: "Position",
    reason: () => (
      counts.position++,
      String(instance.plugin.player.state.position)
    ),
    run: () => {},
  });
  await instance.activated();
  await drain();
  counts.paused = 0;
  counts.position = 0;
  for (let i = 1; i <= 3; i++) {
    push({ position: i });
    await drain();
  }
  assert.deepEqual(counts, { paused: 0, position: 3 });
  push({ paused: true });
  await drain();
  assert.deepEqual(counts, { paused: 1, position: 3 });
  for (const listener of listeners.get("commands.execute") ?? [])
    listener({ id: "paused" });
  await drain();
  assert.deepEqual(counts, { paused: 2, position: 4 }, "full pass after run");
  await instance.dispose();
});
