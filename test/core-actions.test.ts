import assert from "node:assert/strict";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { HostAction, Plugin } from "../src/plugin/index.ts";

async function started(host: TestHost) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    {
      capabilities: ["commands", "playback.read", "playback.control", "events"],
      host,
    },
  );
  return { ...result, plugin };
}

const rejects = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });

test("host.run executes core actions with the playback OSD text", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({ position: 37, duration: 100 });
  const { plugin, stop } = await started(host);
  await plugin.host.run("play-pause");
  assert.equal(host.source.paused, true);
  assert.equal(host.osd.at(-1), "已暂停");
  await plugin.host.run("seek-forward");
  assert.equal(host.osd.at(-1), "前进 5秒: 00:42 / 01:40");
  await plugin.player.setStepSeek({ seconds: 10 });
  await plugin.host.run("seek-backward");
  assert.equal(host.osd.at(-1), "后退 10秒: 00:32 / 01:40");
  await plugin.host.run("rate-up");
  assert.equal(host.osd.at(-1), "播放速度: 1.1x");
  await plugin.host.run("volume-down");
  assert.equal(host.osd.at(-1), "音量: 95%");
  await plugin.host.run("mute");
  assert.equal(host.osd.at(-1), "静音: 开");
  await rejects(plugin.host.run("next"), "unavailable");
  await rejects(plugin.host.run("jump" as HostAction), "invalid");
  await plugin.host.run("stop");
  assert.equal(host.source.phase, "empty");
  await rejects(plugin.host.run("play-pause"), "unavailable");
  assert.deepEqual(host.coreRuns, [
    "play-pause",
    "seek-forward",
    "seek-backward",
    "rate-up",
    "volume-down",
    "mute",
    "stop",
  ]);
  await stop();
});

test("keyframe step seeks (SDK 1.5.19): setStepSeek keyframes, host.run seconds, landed OSD", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({ position: 12, duration: 45 });
  host.keyframes = [0, 10, 20, 30, 40];
  const { plugin, stop } = await started(host);
  // Exact until asked.
  await plugin.host.run("seek-forward");
  assert.equal(host.source.position, 17);
  await plugin.player.setStepSeek({ seconds: 5, keyframes: true });
  assert.equal(host.stepSeekKeyframes, true);
  await plugin.host.run("seek-forward");
  assert.equal(host.source.position, 30);
  assert.equal(host.osd.at(-1), "前进 5秒: 00:30 / 00:45");
  // Tiers 2–4: another step, the same mode, from where it landed.
  await plugin.host.run("seek-backward", { seconds: 30 });
  assert.equal(host.source.position, 0);
  await plugin.host.run("seek-forward", { seconds: 30 });
  assert.equal(host.source.position, 30);
  assert.deepEqual(
    host.coreSeeks.map((s) => [s.seconds, s.keyframes, s.landed]),
    [
      [5, false, 17],
      [5, true, 30],
      [30, true, 0],
      [30, true, 30],
    ],
  );
  // Past the last keyframe: the exact target.
  await plugin.host.run("seek-forward", { seconds: 12 });
  assert.equal(host.source.position, 42);
  // Audio only: exact.
  host.setSource({ hasVideo: false, position: 12 });
  await plugin.host.run("seek-forward");
  assert.equal(host.source.position, 17);
  // The pair is written whole: seconds alone turns keyframes off.
  await plugin.player.setStepSeek({ seconds: 10 });
  assert.equal(host.stepSeekKeyframes, false);
  // Validation, in the SDK and in the host.
  await rejects(
    plugin.player.setStepSeek({ seconds: 5, keyframes: "yes" as never }),
    "invalid",
  );
  await rejects(
    plugin.host.run("play-pause" as "seek-forward", { seconds: 5 }),
    "invalid",
  );
  for (const seconds of [0, 3601, 1.25])
    await rejects(plugin.host.run("seek-forward", { seconds }), "invalid");
  assert.deepEqual(
    host.sent("player.setStepSeek").map((p) => p.keyframes),
    [true, undefined],
  );
  assert.deepEqual(
    host
      .sent("host.run")
      .filter((p) => p.seconds !== undefined)
      .map((p) => p.seconds),
    [30, 30, 12],
  );
  await stop();
});

test("volume-up stops at 100 like the player; a louder volume is kept", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({ output: { volume: 95, muted: false } });
  const { plugin, stop } = await started(host);
  await plugin.host.run("volume-up");
  await plugin.host.run("volume-up");
  assert.deepEqual(host.osd.slice(-2), ["音量: 100%", "音量: 100%"]);
  host.setSource({ output: { volume: 150, muted: false } });
  await plugin.host.run("volume-up");
  assert.equal(host.osd.at(-1), "音量: 150%");
  await plugin.host.run("volume-down");
  assert.equal(host.osd.at(-1), "音量: 145%");
  await stop();
});

test("setStepSeek and step validate their arguments; step needs video", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await started(host);
  for (const seconds of [0, 0.05, 3601, 1.25, Number.NaN])
    await rejects(plugin.player.setStepSeek({ seconds }), "invalid");
  await plugin.player.setStepSeek({ seconds: 0.5 });
  assert.equal(host.stepSeek, 0.5);
  await plugin.player.step("frame", "forward");
  await plugin.player.step("keyframe", "backward");
  assert.deepEqual(host.steps, [
    { unit: "frame", direction: "forward" },
    { unit: "keyframe", direction: "backward" },
  ]);
  await rejects(plugin.player.step("second" as "frame", "forward"), "invalid");
  const seen = plugin.player.state;
  await plugin.player.setPaused(true);
  await rejects(
    plugin.player.step("frame", "forward", { ifCurrent: seen }),
    "stale",
  );
  host.setSource({ hasVideo: false });
  await rejects(plugin.player.step("frame", "forward"), "unsupported");
  host.handle("player.step", () => {
    throw new HostError("unsupported", "generated stream");
  });
  host.setSource({ hasVideo: true });
  await rejects(plugin.player.step("frame", "backward"), "unsupported");
  await stop();
});

test("core actions: the core table with its bindings, states and conflicts", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({ position: 10, duration: 60 });
  let plugin!: Plugin;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      // A plugin still declaring an old key collides with the core action.
      p.commands.add({
        id: "toggle-pause",
        title: "旧",
        bindings: ["Space"],
        run() {},
      });
    },
    {
      capabilities: ["commands", "playback.read", "playback.control", "events"],
      host,
    },
  );
  // Keys are English like the player's (1.5.9); without a locale the menu
  // shows the player's Chinese, as before.
  assert.deepEqual(host.coreAction("seek-forward").declaration.path, [
    "Playback",
    "Seek",
    "Forward 5 s",
  ]);
  assert.deepEqual(host.coreAction("seek-forward").display.path, [
    "播放",
    "跳转",
    "前进5秒",
  ]);
  assert.equal(host.coreAction("stop").declaration.bindings[0], "F4");
  assert.equal(host.coreAction("play-pause").state.checked, false);
  assert.equal(host.coreAction("previous").state.reason, "没有上一个");
  await host.press("ArrowRight");
  assert.equal(host.source.position, 15);
  await host.coreAction("mute").run();
  assert.equal(host.source.output.muted, true);
  assert.deepEqual(
    host.conflicts.find(([binding]) => binding === "Space"),
    ["Space", "host/play-pause", "toggle-pause"],
  );
  host.setSource({ hasVideo: false });
  assert.equal(host.coreAction("frame-forward").state.enabled, false);
  void plugin;
  await stop();
});

test("frame steps: separate directions and B07 reasons", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { stop } = await started(host);
  const reason = (id: string) => host.coreAction(id).state.reason;
  host.setSource({ hasVideo: false });
  assert.equal(reason("frame-forward"), "没有视频");
  assert.equal(reason("frame-back"), "没有视频");
  host.setSource({
    hasVideo: true,
    capabilities: {
      pause: true,
      seek: false,
      rate: true,
      restart: true,
      close: true,
      snapshotSource: false,
    },
  });
  assert.equal(
    host.coreAction("frame-forward").state.enabled,
    true,
    "a live stream steps forward",
  );
  assert.equal(reason("frame-back"), "当前来源不支持逐帧后退");
  host.setSource({ phase: "ended" });
  assert.equal(host.coreAction("frame-forward").state.enabled, false);
  assert.equal(
    host.coreAction("frame-back").state.enabled,
    true,
    "after the end, back works",
  );
  await stop();
});
