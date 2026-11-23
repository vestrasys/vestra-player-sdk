// The state stream (SDK 1.10.0, events-and-triggers.md §4.7):
// `plugin.player.stream(fn)` beside `subscribe()` and `onChange()`. `fn`
// gets the current state at the call, then every change, each followed by
// an update pass; an open stream is a listener (the player keeps the
// plugin running), and after the last `stop()` nothing of it is: without
// `subscribe()` its subscription ends, with it the copy stays a mirror.
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "../src/plugin/testing.ts";
import type { PlayerState, StateStream } from "../src/plugin/index.ts";

const marks = (host: { calls: { method: string; params: unknown }[] }) =>
  host.calls
    .filter((c) => c.method.startsWith("events."))
    .map((c) => ({ method: c.method, ...(c.params as object) })) as {
    method: string;
    event: string;
    mirror?: boolean;
    why?: string[];
  }[];

test("fn gets the current state at the call, then every change", async () => {
  const { plugin, host, stop } = await startPlugin(() => {});
  try {
    host.setSource({ phase: "ready", paused: true, position: 3 });
    await host.settle();
    // No subscribe(), no read(): the SDK's copy has not seen it.
    assert.equal(plugin.player.state.phase, "empty");
    const seen: PlayerState[] = [];
    const current: PlayerState[] = [];
    const feed = plugin.player.stream((state) => {
      seen.push(state);
      current.push(plugin.player.state);
    });
    await host.settle();
    assert.equal(seen.length, 1, "once with the current state");
    assert.equal(seen[0]!.phase, "ready");
    assert.equal(seen[0]!.position, 3);
    host.setSource({ paused: false, position: 4 });
    await host.settle();
    host.setSource({ position: 4.1 });
    await host.settle();
    assert.deepEqual(
      seen.map((s) => [s.paused, s.position]),
      [
        [true, 3],
        [false, 4],
        [false, 4.1],
      ],
    );
    // `player.state` was updated before each call.
    assert.deepEqual(current, seen);
    feed.stop();
    await host.settle();
    host.setSource({ position: 9 });
    await host.settle();
    assert.equal(seen.length, 3, "nothing after stop()");
  } finally {
    await stop();
  }
});

test("an update pass follows each call", async () => {
  let near = false;
  const { plugin, host, stop } = await startPlugin((plugin) => {
    plugin.commands.add({
      id: "left",
      title: "Time Left",
      // Reads the plugin's own value, not the player's state: only an
      // update pass re-evaluates it.
      enabled: () => near,
      run: () => {},
    });
  });
  try {
    plugin.player.stream((state) => {
      near = (state.position ?? 0) > 50;
    });
    await host.settle();
    assert.equal(host.command("left").state.enabled, false);
    host.setSource({ phase: "ready", position: 55, duration: 60 });
    await host.settle();
    assert.equal(host.command("left").state.enabled, true);
    host.setSource({ position: 10 });
    await host.settle();
    assert.equal(host.command("left").state.enabled, false);
    // The command's function reads no player state: only the stream
    // listens.
    assert.deepEqual([...host.listening], ["source.state"]);
  } finally {
    await stop();
  }
});

test("an open stream keeps the plugin running; after the last stop nothing of it does", async () => {
  const { plugin, host, stop } = await startPlugin(() => {});
  try {
    await host.settle();
    assert.deepEqual(host.keepsRunning, []);
    assert.ok(!host.subscriptions.has("source.state"));
    const first = plugin.player.stream(() => {});
    const second = plugin.player.stream(() => {});
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    // One reason per stream, each with where it was opened.
    assert.equal(host.keepsRunning.length, 2);
    for (const reason of host.keepsRunning)
      assert.match(
        reason,
        /^listens to source\.state: a stream opened at (test\/)?player-stream\.test\.ts:\d+$/,
      );
    first.stop();
    first.stop(); // a second call does nothing
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"], "one still open");
    second.stop();
    await host.settle();
    assert.deepEqual([...host.listening], []);
    assert.deepEqual(host.keepsRunning, []);
    // Without subscribe(): the subscription ended with the last stream.
    assert.ok(!host.subscriptions.has("source.state"));
    assert.deepEqual(marks(host).at(-1), {
      method: "events.unsubscribe",
      event: "source.state",
    });
    // `player.state` keeps the last snapshot and follows nothing.
    host.setSource({ phase: "ready", position: 1 });
    await host.settle();
    assert.equal(plugin.player.state.phase, "empty");
    // A new stream subscribes again.
    const again = plugin.player.stream(() => {});
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    assert.equal(plugin.player.state.phase, "ready");
    again.stop();
    await host.settle();
    assert.deepEqual([...host.listening], []);
  } finally {
    await stop();
  }
});

test("a listener beside a stream keeps the copy following after the stream stops", async () => {
  const { plugin, host, stop } = await startPlugin(() => {});
  try {
    let heard = 0;
    plugin.player.on("source.state", () => heard++);
    const feed = plugin.player.stream(() => {});
    await host.settle();
    assert.deepEqual([...host.listening], ["source.state"]);
    feed.stop();
    await host.settle();
    // The listener still holds the event: still subscribed, the copy follows.
    assert.deepEqual([...host.listening], ["source.state"]);
    assert.ok(host.subscriptions.has("source.state"));
    heard = 0;
    host.setSource({ phase: "ready", position: 2 });
    await host.settle();
    assert.equal(heard, 1);
    assert.equal(plugin.player.state.position, 2);
  } finally {
    await stop();
  }
});

test("several streams each hear every change", async () => {
  const { plugin, host, stop } = await startPlugin(() => {});
  try {
    const a: (number | null)[] = [];
    const b: (number | null)[] = [];
    const one = plugin.player.stream((s) => a.push(s.position));
    await host.settle();
    host.setSource({ phase: "ready", position: 1 });
    await host.settle();
    const two = plugin.player.stream((s) => b.push(s.position));
    await host.settle();
    host.setSource({ position: 2 });
    await host.settle();
    assert.deepEqual(a, [null, 1, 2]);
    assert.deepEqual(b, [1, 2]);
    one.stop();
    two.stop();
  } finally {
    await stop();
  }
});

test("a stream ends with its scope, and a throwing listener goes to onError", async () => {
  const { plugin, host, stop } = await startPlugin(() => {});
  try {
    const errors: string[] = [];
    const scope = plugin.scope();
    scope.onError((error) => errors.push(error.message));
    let calls = 0;
    const feed: StateStream = scope.player.stream(() => {
      calls++;
      throw new Error("boom");
    });
    await host.settle();
    assert.equal(calls, 1);
    assert.deepEqual(errors, ["boom"]);
    await scope.dispose();
    await host.settle();
    assert.deepEqual([...host.listening], []);
    host.setSource({ phase: "ready" });
    await host.settle();
    assert.equal(calls, 1);
    feed.stop(); // after the scope: nothing
  } finally {
    await stop();
  }
});

test("a stream opened in activate is a listener before the plugin is ready", async () => {
  const { host, stop } = await startPlugin((plugin) => {
    plugin.player.stream(() => {});
  });
  try {
    // No settle: the player classifies the plugin at its ready.
    assert.deepEqual([...host.listening], ["source.state"]);
  } finally {
    await stop();
  }
});

test("stream takes a function", async () => {
  const { plugin, stop } = await startPlugin(() => {});
  try {
    assert.throws(() => plugin.player.stream(42 as unknown as () => void), {
      code: "invalid",
    });
  } finally {
    await stop();
  }
});
