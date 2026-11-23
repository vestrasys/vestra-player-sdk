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

/**
 * Start one scenario alone, in a test host with a file playing, behind the
 * call each style's `activate` makes first.
 */
async function start(scenario: Scenario, host = new TestHost()) {
  const started = await startPlugin(
    async (plugin: Plugin) => {
      await plugin.player.read();
      return scenario(plugin);
    },
    { directory, host },
  );
  host.openElsewhere("/movie.mp4");
  await host.settle();
  return started;
}

/**
 * The user opens the adjust column (Adjustments and Effects) at the
 * plugin's tab, or closes it: the player sends `layout.changed`.
 */
async function showColumn(host: TestHost, visible: boolean) {
  const column = host.layout.adjust!;
  column.preferred = column.effective = visible;
  column.reason = visible ? null : "userHidden";
  host.selectTab(host.manifestId); // pushes the change as window.state
  await host.settle();
}

for (const [name, style] of Object.entries(styles)) {
  test(`style ${name}: the speed tab follows the speed and S cycles it`, async () => {
    const { host, stop } = await start(style.speed);
    try {
      const panel = host.mounted("adjust");
      assert.equal(host.layout.adjust?.panels?.[0]?.title, "Speed");
      await showColumn(host, true);
      host.setSource({ rate: 1.5 });
      await host.settle();
      assert.equal(panel.props.rate, "1.50×");
      await host.command("rate.cycle").run(); // 1.5 → 2
      await host.settle();
      assert.equal(host.source.rate, 2);
      assert.equal(panel.props.rate, "2.00×");
      assert.deepEqual(host.command("rate.cycle").declaration.bindings, ["S"]);
      assert.deepEqual(host.conflicts, []);
    } finally {
      await stop();
    }
  });

  test(`style ${name}: the speed is followed only while the tab shows`, async () => {
    const { host, stop } = await start(style.speed);
    const keepsRunning = () => host.keepsRunning;
    try {
      assert.deepEqual(keepsRunning(), [], "the column starts closed");
      await showColumn(host, true);
      assert.ok(keepsRunning().includes("its adjust tab is the current tab"));
      assert.ok(
        keepsRunning().some((why) => why.startsWith("listens to source.state")),
      );
      host.setSource({ rate: 0.5 });
      await host.settle();
      assert.equal(host.mounted("adjust").props.rate, "0.50×");
      await showColumn(host, false);
      assert.deepEqual(keepsRunning(), []);
    } finally {
      await stop();
    }
  });

  test(`style ${name}: Next Keyframe keeps nothing running`, async () => {
    const { host, stop } = await start(style.keyframes);
    try {
      assert.deepEqual(host.keepsRunning, []);
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

// #region source-changes
// The user changes the source after the plugin read the state, then runs
// a command that controls playback. Each change advances the player's
// source stamp as the player does: `openElsewhere` starts a new generation
// (also for the same file), a core action is a new intent. A control the
// plugin makes with an older copy of the state is refused with `stale`,
// and a host error the test does not expect fails it (`host.strictErrors`).
const changes: [string, (host: TestHost) => Promise<void>][] = [
  ["another file opened", async (host) => host.openElsewhere("/other.mp4")],
  [
    "the same file opened again",
    async (host) => host.openElsewhere("/movie.mp4"),
  ],
  ["the user paused (Space)", (host) => host.coreAction("play-pause").run()],
];

for (const [name, style] of Object.entries(styles))
  for (const [change, act] of changes) {
    test(`style ${name}: S cycles the speed after ${change}`, async () => {
      // `start` opens /movie.mp4 after activation: a file opened after it.
      const { host, stop } = await start(style.speed);
      try {
        await act(host);
        await host.settle();
        await host.command("rate.cycle").run(); // reads the state first
        assert.equal(host.source.rate, 1.5);
      } finally {
        await stop();
      }
    });

    // TODO(stale controls): styles A and B learn a new source from
    // `source.ready`, but a pause is no new source: the step carries the
    // stamp of the copy from before it and the player refuses it with
    // `stale`, as TestHost does (style C sends no `expected`). Drop `todo`
    // once the pending decision on the SDK's control semantics, or a fix of
    // this example, lands.
    const stale = name !== "c" && change === "the user paused (Space)";
    const todo = stale
      ? "stale: the step carries the stamp of the plugin's old copy"
      : undefined;
    test(
      `style ${name}: Next Keyframe steps after ${change}`,
      { todo },
      async () => {
        const host = new TestHost();
        host.stats = {
          ...host.stats,
          video: { codec: "h264", width: 1920, height: 1080 },
        } as typeof host.stats;
        const { stop } = await start(style.keyframes, host);
        try {
          await act(host);
          await host.settle();
          await until(
            () => host.command("keyframe.next").state.enabled === true,
          );
          await host.command("keyframe.next").run();
          assert.deepEqual(host.steps.at(-1), {
            unit: "keyframe",
            direction: "forward",
          });
        } finally {
          await stop();
        }
      },
    );
  }
// #endregion source-changes
