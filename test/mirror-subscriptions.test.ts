// Mirror subscriptions (SDK 1.5.38, player 0.5.18): the SDK's own copies of
// the player's state subscribe with `mirror: true`; only a plugin's real
// listeners (an onChange, a binding that reads the state) count, so a
// plugin that only registers entries can be stopped while idle.
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "../src/plugin/testing.ts";

const marks = (host: { calls: { method: string; params: unknown }[] }) =>
  host.calls
    .filter((c) => c.method === "events.subscribe")
    .map((c) => c.params as { event: string; mirror?: boolean });

test("the SDK's own state subscriptions are mirrors", async () => {
  const { plugin, host, stop } = await startPlugin(
    (plugin) => {
      plugin.commands.add({ id: "hello", title: "Hello", run: () => {} });
    },
    { capabilities: ["events", "playback.read", "commands"] },
  );
  try {
    await host.settle();
    void plugin.window.state;
    void plugin.timeline.marks;
    await host.settle();
    assert.ok(host.subscriptions.has("source.state"));
    assert.ok(host.subscriptions.has("window.state"));
    assert.ok(host.subscriptions.has("timeline.changed"));
    assert.deepEqual([...host.listening], []);
    assert.ok(marks(host).every((m) => m.mirror === true));
    // The mirror still keeps the state current.
    host.setSource({ phase: "ready", paused: true });
    await host.settle();
    assert.equal(plugin.player.state.phase, "ready");
  } finally {
    await stop();
  }
});

test("onChange listens while it exists, then the event is a mirror again", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: ["events", "playback.read"],
  });
  try {
    await host.settle();
    assert.deepEqual([...host.listening], []);
    let seen = 0;
    const listener = plugin.player.onChange(() => seen++);
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    host.setSource({ phase: "ready", paused: false });
    await host.settle();
    assert.equal(seen, 1);
    await listener.dispose();
    await host.settle();
    assert.deepEqual([...host.listening], []);
    // Still subscribed: `plugin.player.state` keeps following.
    assert.ok(host.subscriptions.has("source.state"));
    assert.deepEqual(marks(host).at(-1), {
      event: "source.state",
      mirror: true,
    });
  } finally {
    await stop();
  }
});

test("a command state that reads the player listens; a fixed one does not", async () => {
  const { plugin, host, stop } = await startPlugin(
    (plugin) => {
      plugin.commands.add({ id: "fixed", title: "Fixed", run: () => {} });
    },
    { capabilities: ["events", "playback.read", "commands"] },
  );
  try {
    await host.settle();
    assert.deepEqual([...host.listening], []);
    const scope = plugin.scope();
    scope.commands.add({
      id: "pause",
      title: "Pause",
      enabled: () => plugin.player.state.phase === "ready",
      run: () => {},
    });
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    await scope.dispose();
    await host.settle();
    assert.deepEqual([...host.listening], []);
  } finally {
    await stop();
  }
});

test("listeners without a mirror subscribe as listeners", async () => {
  const { host, stop } = await startPlugin(
    (plugin) => {
      plugin.bindings.onChange(() => {});
      plugin.window.onChange(() => {});
    },
    { capabilities: ["events", "bindings.manage"] },
  );
  try {
    await host.settle();
    assert.deepEqual([...host.listening].sort(), [
      "bindings.changed",
      "window.state",
    ]);
    assert.ok(
      marks(host).some((m) => m.event === "bindings.changed" && !m.mirror),
    );
  } finally {
    await stop();
  }
});
