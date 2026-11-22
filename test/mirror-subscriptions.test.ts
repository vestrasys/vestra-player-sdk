// Mirror subscriptions (SDK 1.5.38, player 0.5.18): the SDK's own copies of
// the player's state subscribe with `mirror: true`; only a plugin's real
// listeners (a listener, a watcher, a stream, a binding that reads a held
// state) count, so a plugin that only registers entries can be stopped
// while idle. SDK 1.11.0: a copy of a held state (`source.state`,
// `window.state`, `timeline.changed`…) subscribes only while something
// holds it, and goes back to a copy when the holder ends.
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "./explicit.ts";

const marks = (host: { calls: { method: string; params: unknown }[] }) =>
  host.calls
    .filter((c) => c.method === "events.subscribe")
    .map((c) => c.params as { event: string; mirror?: boolean });

test("the SDK's own copies of a held event subscribe nothing by themselves", async () => {
  const { plugin, host, stop } = await startPlugin(
    (plugin) => {
      plugin.commands.add({ id: "hello", title: "Hello", run: () => {} });
    },
    { capabilities: ["playback.read", "commands"] },
  );
  try {
    await host.settle();
    void plugin.window.state;
    void plugin.timeline.marks;
    await host.settle();
    assert.ok(!host.subscriptions.has("source.state"));
    assert.ok(!host.subscriptions.has("window.state"));
    assert.ok(!host.subscriptions.has("timeline.changed"));
    assert.deepEqual([...host.listening], []);
    assert.ok(marks(host).every((m) => m.mirror === true));
    // Nothing follows: the state is the snapshot the plugin read.
    host.setSource({ phase: "ready", paused: true });
    await host.settle();
    assert.equal(plugin.player.state.phase, "empty");
  } finally {
    await stop();
  }
});

test("a stream listens while it is open, then the event is unsubscribed and the copy kept", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: ["playback.read"],
  });
  try {
    await host.settle();
    assert.deepEqual([...host.listening], []);
    let seen = 0;
    const feed = plugin.player.stream(() => seen++);
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    host.setSource({ phase: "ready", paused: false });
    await host.settle();
    assert.ok(seen >= 2, "the current state, then the change");
    feed.stop();
    await host.settle();
    assert.deepEqual([...host.listening], []);
    assert.ok(!host.subscriptions.has("source.state"));
    assert.equal(plugin.player.state.phase, "ready", "the last snapshot stays");
  } finally {
    await stop();
  }
});

test("a command state that reads the player listens only while the state is held", async () => {
  const { plugin, host, stop } = await startPlugin(
    (plugin) => {
      plugin.commands.add({ id: "fixed", title: "Fixed", run: () => {} });
    },
    { capabilities: ["playback.read", "commands"] },
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
    // Its read alone subscribes nothing.
    assert.deepEqual([...host.listening], []);
    const feed = plugin.player.stream(() => {});
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    assert.equal(host.listeningWhy.get("source.state")!.length, 2);
    await scope.dispose();
    await host.settle();
    assert.equal(host.listeningWhy.get("source.state")!.length, 1);
    feed.stop();
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
    { capabilities: ["bindings.manage"] },
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

test("a listener added during activation is marked before the plugin is ready", async () => {
  const { host, stop } = await startPlugin(
    (plugin) => {
      plugin.player.on("source.state", () => {});
    },
    { capabilities: ["playback.read"] },
  );
  try {
    // No settle: the player classifies the plugin at its ready.
    assert.deepEqual([...host.listening], ["source.state"]);
  } finally {
    await stop();
  }
});
