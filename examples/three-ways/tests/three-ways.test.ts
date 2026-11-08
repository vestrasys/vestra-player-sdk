import assert from "node:assert/strict";
import test from "node:test";
import type { Plugin, Stream, StreamOptions } from "@vestra-player/sdk";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import * as a from "../style-a.ts";
import * as b from "../style-b.ts";
import * as c from "../style-c.ts";

const directory = new URL("..", import.meta.url);
const styles = { a, b, c };
type Scenario = (plugin: Plugin) => void;

/** Poll until `predicate()` holds: a stream starts and stops on timers. */
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/**
 * The plugin with a stand-in for `player.openStream` that asks for `count`
 * frames, one per timer tick, and then waits. The real stream (sockets, the
 * audio clock) is the signal-generator example's test; this one checks only
 * what each style shows per frame.
 */
function framesBy(count: number) {
  const stream = { stopped: false };
  const player = (plugin: Plugin): Plugin => {
    const openStream = async (options: StreamOptions) => {
      for (let i = 0; i < count; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        options.frame();
      }
      return {
        stop: async () => void (stream.stopped = true),
        onStop: () => ({ dispose: async () => {} }),
      } as unknown as Stream;
    };
    const fake = new Proxy(plugin.player, {
      get: (target, key) =>
        key === "openStream" ? openStream : Reflect.get(target, key, target),
    });
    return new Proxy(plugin, {
      get: (target, key) =>
        key === "player" ? fake : Reflect.get(target, key, target),
    });
  };
  return { player, stream };
}

/** Start one scenario alone, in a test host with a file playing. */
async function start(scenario: Scenario, host = new TestHost()) {
  const started = await startPlugin(scenario, { directory, host });
  host.openElsewhere("/movie.mp4");
  await host.settle();
  return started;
}

for (const [name, style] of Object.entries(styles)) {
  test(`style ${name}: the speed panel follows the speed and C cycles it`, async () => {
    const { host, stop } = await start(style.speed);
    try {
      host.setSource({ rate: 1.5 });
      await host.settle();
      assert.equal(host.mounted("bottom").props.rate, "1.50×");
      await host.command("rate.cycle").run(); // 1.5 → 2
      await host.settle();
      assert.equal(host.source.rate, 2);
      assert.equal(host.mounted("bottom").props.rate, "2.00×");
    } finally {
      await stop();
    }
  });

  test(`style ${name}: one played entry of 20,000`, async () => {
    const { host, stop } = await start(style.list);
    try {
      const side = host.mounted("sidebar");
      await host.settle();
      const before = host.sent("ui.setMount").length;
      side.emit("play", 5);
      await host.settle();
      const rows = side.props.rows as { id: string; played: boolean }[];
      assert.equal(rows.length, 20_000);
      assert.deepEqual(rows[5], { id: "e5", label: "Entry 6", played: true });
      // What crossed to the player for that one change.
      const writes = host.sent("ui.setMount").slice(before) as {
        value?: unknown[];
        patch?: { ops: unknown[] };
      }[];
      if (name === "b") {
        // The whole list again: a first part with `value`, the rest in parts.
        assert.ok(writes.length > 1 && "value" in writes[0]!);
      } else
        assert.deepEqual(
          writes.map((w) => w.patch?.ops),
          [[{ op: "set", at: 5, row: rows[5] }]],
        );
    } finally {
      await stop();
    }
  });

  test(`style ${name}: Next Keyframe waits for the answer about video`, async () => {
    const host = new TestHost();
    host.stats = {
      ...host.stats,
      video: { codec: "h264", width: 1920, height: 1080 },
    } as typeof host.stats;
    const { stop } = await start(style.keyframes, host);
    try {
      await until(() => host.command("keyframe.next").state.enabled === true);
      host.stats = { ...host.stats, video: null };
      host.openElsewhere("/song.mp3");
      await host.settle();
      await until(() => host.command("keyframe.next").state.enabled === false);
    } finally {
      await stop();
    }
  });

  test(`style ${name}: the emulator's status line changes with every frame`, async () => {
    const host = new TestHost();
    const { player, stream } = framesBy(3);
    const { stop } = await startPlugin(
      (plugin: Plugin) => style.frames(player(plugin)),
      {
        directory,
        host,
      },
    );
    const command = () => host.command("emulator");
    const status = () => String(host.window("status").props.status);
    try {
      await command().run();
      await until(() => status() === "Frame 3 · 60 fps");
      await until(() => command().state.checked === true);
      await command().run(); // stop
      await until(() => status() === "Stopped");
      await until(() => command().state.checked === false);
      assert.equal(stream.stopped, true);
    } finally {
      await stop();
    }
  });
}

test("style A before plugin.state: the same command with a manual update()", async () => {
  const host = new TestHost();
  host.stats = {
    ...host.stats,
    video: { codec: "h264", width: 1920, height: 1080 },
  } as typeof host.stats;
  const { stop } = await start(a.keyframesManual, host);
  try {
    await until(() => host.command("keyframe.next").state.enabled === true);
  } finally {
    await stop();
  }
});
