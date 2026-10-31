// Declarative command state (SDK 1.5.40, player 0.5.21): `plugin.when`
// conditions are sent with the command and evaluated by the player, so a
// command's menu state follows playback without the plugin listening; and
// the reasons a plugin keeps running are reported with where they come from.
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "../src/plugin/testing.ts";

const sent = (host: { calls: { method: string; params: unknown }[] }) =>
  host.calls
    .filter((c) => c.method.startsWith("commands."))
    .map((c) => c.params as { id: string; state: unknown; when?: unknown });

test("conditions are sent as `when` and evaluated by the host", async () => {
  const { plugin, host, stop } = await startPlugin(
    (plugin) => {
      const { when } = plugin;
      plugin.commands.add({
        id: "save",
        path: ["@video", "Save Snapshot"],
        enabled: when
          .can("snapshot")
          .and(when.phase("ready", "ended"), when.stream.not()),
        reason: "No frame to capture",
        run: () => {},
      });
      plugin.commands.add({
        id: "light",
        title: "Light",
        radio: true,
        checked: when.theme("vestra-light"),
        run: () => {},
      });
      plugin.commands.add({
        id: "full",
        title: "Fullscreen only",
        enabled: when.fullscreen.or(when.language("de")),
        run: () => {},
      });
    },
    { capabilities: ["events", "playback.read", "commands"] },
  );
  try {
    const register = sent(host).find((c) => c.id === "save")!;
    assert.deepEqual(register.when, {
      enabled: {
        all: [
          { can: "snapshot" },
          { phase: ["ready", "ended"] },
          { not: { kind: "stream" } },
        ],
      },
    });
    // A condition reads nothing in the plugin: nothing listens.
    assert.deepEqual([...host.listening], []);
    assert.deepEqual(host.keepsRunning, []);
    const save = host.command("save");
    assert.equal(save.state.enabled, false);
    assert.equal(save.display.reason, "No frame to capture");
    await assert.rejects(save.run(), { code: "command" });
    host.setSource({ phase: "ready" });
    assert.equal(save.state.enabled, true);
    // With an enabled condition the reason shows only while disabled.
    assert.equal(save.state.reason, null);
    assert.equal(host.command("light").state.checked, false);
    host.setAppearance("vestra-light");
    assert.equal(host.command("light").state.checked, true);
    assert.equal(host.command("full").state.enabled, false);
    host.setMainWindow({ fullscreen: true });
    assert.equal(host.command("full").state.enabled, true);
    // The conditions changed nothing the plugin sends.
    const updates = sent(host).length;
    host.setSource({ phase: "ended" });
    await host.settle();
    assert.equal(sent(host).length, updates);
    assert.equal(plugin.player.state.phase, "ended");
  } finally {
    await stop();
  }
});

test("set switches between a condition and a function", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: ["events", "playback.read", "commands"],
  });
  try {
    const { when } = plugin;
    const command = plugin.commands.add({
      id: "pause",
      title: "Pause",
      enabled: when.playing,
      run: () => {},
    });
    await host.settle();
    assert.deepEqual([...host.listening], []);
    command.set({ enabled: () => plugin.player.state.phase === "ready" });
    await host.settle();
    assert.equal(sent(host).at(-1)!.when, undefined);
    assert.deepEqual([...host.listening], ["source.state"]);
    command.set({ enabled: when.paused });
    await host.settle();
    assert.deepEqual(sent(host).at(-1)!.when, {
      enabled: { all: [{ phase: ["ready"] }, { paused: true }] },
    });
    assert.deepEqual([...host.listening], []);
    host.setSource({ phase: "ready", paused: true });
    assert.equal(host.command("pause").state.enabled, true);
  } finally {
    await stop();
  }
});

test("plugin.when refuses what is not in its vocabulary", async () => {
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["commands"],
  });
  try {
    const { when } = plugin;
    assert.throws(() => when.phase(), TypeError);
    assert.throws(() => when.phase("playing" as never), TypeError);
    assert.throws(() => when.can("fly" as never), TypeError);
    // The player's own rules: its palettes and languages only.
    assert.throws(() => when.theme("dark" as never), TypeError);
    assert.throws(() => when.language("xx" as never), TypeError);
    assert.doesNotThrow(() => when.language("zh-Hans"));
    assert.deepEqual(JSON.parse(JSON.stringify(when.open)), {
      not: { phase: ["empty"] },
    });
    // Combinators make new conditions; the original is unchanged.
    const playing = JSON.stringify(when.playing);
    void when.playing.and(when.fullscreen);
    assert.equal(JSON.stringify(when.playing), playing);
  } finally {
    await stop();
  }
});

test("keepsRunning says why, with where the plugin added it", async () => {
  const { plugin, host, stop } = await startPlugin(
    (plugin) => {
      plugin.packages.onChange(() => {});
      plugin.commands.add({
        id: "snap",
        title: "Snapshot",
        enabled: () => plugin.player.state.phase === "ready",
        run: () => {},
      });
    },
    { capabilities: ["events", "playback.read", "commands"] },
  );
  try {
    // packages.changed wakes a stopped plugin: it keeps nothing running.
    assert.ok(host.listening.has("packages.changed"));
    assert.equal(host.keepsRunning.length, 1);
    assert.match(
      host.keepsRunning[0]!,
      /^listens to source\.state: command "Snapshot" enabled is a function that reads plugin\.player\.state \(test\/conditions\.test\.ts:\d+\) — use plugin\.when$/,
    );
    const listener = plugin.player.onChange(() => {});
    await host.settle();
    // Every reason, in the order they came: the player is told again.
    const reasons = host.listeningWhy.get("source.state")!;
    assert.equal(reasons.length, 2);
    assert.match(reasons[0]!, /^command "Snapshot"/);
    assert.match(
      reasons[1]!,
      /^a listener added at test\/conditions\.test\.ts:\d+$/,
    );
    assert.equal(host.keepsRunning.length, 2);
    await listener.dispose();
    await host.settle();
    assert.equal(host.listeningWhy.get("source.state")!.length, 1);
    const watcher = plugin.window.onChange(() => {});
    await host.settle();
    assert.deepEqual(host.listeningWhy.get("window.state")!.length, 1);
    await watcher.dispose();
    await host.settle();
    assert.ok(!host.listeningWhy.has("window.state"));
  } finally {
    await stop();
  }
});
