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

test("the video view, a shader channel and a filter follow the source without counting as listeners", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: ["playback.read", "processing.video"],
  });
  try {
    await host.settle();
    const view = plugin.video.view();
    const shaders = plugin.video.shaders("look");
    const filter = plugin.video.filter("picture");
    view.set({ zoom: 1.5 });
    filter.set([{ kind: "hue", degrees: 30 }]);
    await host.settle();
    // They follow the source: the copy is subscribed, as the SDK's own.
    assert.ok(host.subscriptions.has("source.state"));
    assert.deepEqual(
      [...host.listening],
      [],
      "no listener: their resources keep the plugin up",
    );
    assert.ok(
      marks(host)
        .filter((m) => m.event === "source.state")
        .every((m) => m.mirror === true),
    );
    assert.equal(view.status.state, "waiting");
    host.openElsewhere("/a.mp4");
    await host.settle();
    assert.equal(
      view.status.state,
      "applied",
      "the view sent its values again for the new source",
    );
    assert.equal(filter.status.state, "applied");
    // A listener of the plugin's own is one, and only while it lives.
    const listener = plugin.player.on("source.state", () => {});
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    await listener.dispose();
    await host.settle();
    assert.deepEqual([...host.listening], []);
    assert.ok(
      host.subscriptions.has("source.state"),
      "the handles still follow",
    );
    await view.dispose();
    await shaders.dispose();
    await filter.dispose();
    await host.settle();
    assert.ok(
      !host.subscriptions.has("source.state"),
      "nothing follows once they are gone",
    );
  } finally {
    await stop();
  }
});

test("a binding or command field that reads the state never makes the plugin a listener, also while a handle follows the source, after a release and a re-open", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: ["playback.read", "processing.video", "commands"],
  });
  try {
    await host.settle();
    // A command field that reads the player, and a handle that subscribes
    // `source.state` as the SDK's copy.
    plugin.commands.add({
      id: "pause",
      title: "Pause",
      enabled: () => plugin.player.state.phase === "ready",
      run: () => {},
    });
    let view = plugin.video.view();
    await host.settle();
    assert.ok(host.subscriptions.has("source.state"));
    assert.deepEqual(
      [...host.listening],
      [],
      "the read and the handle claim nothing",
    );
    host.openElsewhere("/a.mp4");
    await host.settle();
    assert.deepEqual([...host.listening], []);
    // A stream is a listener; the read's reason joins it while it lives.
    const feed = plugin.player.stream(() => {});
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    assert.equal(host.listeningWhy.get("source.state")!.length, 2);
    feed.stop();
    await host.settle();
    assert.deepEqual(
      [...host.listening],
      [],
      "back to the copy, still subscribed by the handle",
    );
    assert.ok(host.subscriptions.has("source.state"));
    // Release: the handle goes, the group is unsubscribed; re-open: a new
    // handle subscribes it again, and the read still claims nothing.
    await view.dispose();
    await host.settle();
    assert.ok(!host.subscriptions.has("source.state"));
    view = plugin.video.view();
    await host.settle();
    assert.ok(host.subscriptions.has("source.state"));
    assert.deepEqual(
      [...host.listening],
      [],
      "the re-opened group is the SDK's copy",
    );
    // The last word on `source.state` (the re-opened subscription) is the copy.
    const last = marks(host)
      .filter((m) => m.event === "source.state")
      .at(-1);
    assert.equal(last?.mirror, true);
    await view.dispose();
  } finally {
    await stop();
  }
});
