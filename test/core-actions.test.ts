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
  // shows the player's Chinese, as before. The seek actions are outside the
  // menu (player 0.7.6, the playback plugin's panel); Play/Pause is a
  // top-level item (the slim menu).
  assert.deepEqual(host.coreAction("seek-forward").declaration.path, []);
  assert.equal(
    host.coreAction("seek-forward").declaration.title,
    "Forward 5 s",
  );
  assert.deepEqual(host.coreAction("seek-forward").display.path, []);
  assert.equal(host.coreAction("seek-forward").display.title, "前进5秒");
  assert.deepEqual(host.coreAction("play-pause").declaration.path, [
    "Play/Pause",
  ]);
  assert.deepEqual(host.coreAction("play-pause").display.path, ["播放/暂停"]);
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

test('host.run("fullscreen") toggles the main window: in, then out (SDK 1.5.21)', async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  const seen: boolean[] = [];
  plugin.window.onChange((state) => seen.push(state.fullscreen));
  assert.equal(plugin.window.state.fullscreen, false);
  await plugin.host.run("fullscreen");
  await host.settle();
  assert.equal(host.mainWindow.fullscreen, true, "windowed → fullscreen");
  assert.equal(plugin.window.state.fullscreen, true);
  await plugin.host.run("fullscreen");
  await host.settle();
  assert.equal(host.mainWindow.fullscreen, false, "fullscreen → windowed");
  assert.equal(plugin.window.state.fullscreen, false);
  assert.deepEqual(seen, [true, false], "window.state after each toggle");
  // No source needed, and no playback state changes.
  assert.equal(host.source.phase, "empty");
  assert.deepEqual(host.coreRuns, ["fullscreen", "fullscreen"]);
  await stop();
});

test("a left click on the video is Play/Pause by default (player 0.5.2)", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({ position: 3, duration: 100 });
  const { stop } = await started(host);
  await host.press("Mouse:LeftClick");
  assert.equal(host.source.paused, true);
  assert.deepEqual(host.coreRuns, ["play-pause"]);
  await assert.rejects(host.press("Mouse:LeftDoubleClick"));
  await stop();
});

test("after the end a step seek leaves the end and plays on; a frame step back stays paused (SDK 1.7.5)", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({
    phase: "ready",
    position: 100,
    duration: 100,
    paused: false,
  });
  host.keyframes = [0, 50, 100];
  host.stats = {
    ...host.stats,
    video: { codec: "h264", width: 1920, height: 1080, fps: 25 },
  } as typeof host.stats;
  const { plugin, stop } = await started(host);
  await plugin.player.setStepSeek({ seconds: 5, keyframes: true });
  const end = () =>
    host.setSource({
      phase: "ended",
      terminalReason: "natural",
      position: 100,
      paused: true,
    });

  // Played to the end: ← is enabled and exact (no keyframe mode), and plays on.
  end();
  assert.equal(host.coreAction("seek-backward").state.enabled, true);
  assert.equal(host.coreAction("rate-up").state.enabled, false);
  await plugin.host.run("seek-backward");
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.terminalReason, null);
  assert.equal(host.source.position, 95);
  assert.equal(host.source.paused, false);
  assert.equal(host.coreSeeks.at(-1)!.keyframes, false);
  assert.equal(host.osd.at(-1), "后退 5秒: 01:35 / 01:40");
  // At ready the keyframe mode applies again.
  await plugin.host.run("seek-backward");
  assert.equal(host.source.position, 50);

  // A plugin's seek from the end plays on too.
  host.setSource({ paused: false });
  end();
  await plugin.player.seek(40);
  await host.settle();
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.paused, false);

  // Previous Frame at the end: one frame back, paused.
  host.setSource({ position: 100 });
  end();
  await host.coreAction("frame-back").run();
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.position, 100 - 1 / 25);
  assert.equal(host.source.paused, true);
  assert.deepEqual(host.steps.at(-1), { unit: "frame", direction: "backward" });

  // An end reached by frame stepping keeps the pause on the next seek.
  host.setSource({ paused: false });
  await plugin.player.step("frame", "forward");
  end();
  await plugin.host.run("seek-backward");
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.paused, true);

  // So does an end reached while paused (a seek to the end while paused).
  host.setSource({ paused: true });
  end();
  await plugin.host.run("seek-backward", { seconds: 10 });
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.paused, true);

  // Play at the end still restarts from 0, playing.
  end();
  await plugin.host.run("play-pause");
  assert.equal(host.source.position, 0);
  assert.equal(host.source.paused, false);
  await stop();
});

test("after the end a seek to the end goes nowhere: accepted, still ended and paused (SDK 1.7.5)", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({
    phase: "ready",
    position: 99,
    duration: 100,
    paused: false,
  });
  const { plugin, stop } = await started(host);
  // keep-open stops a hair before the duration: the end is the smaller.
  host.setSource({
    phase: "ended",
    terminalReason: "natural",
    position: 99.96,
    paused: true,
  });
  await host.settle();
  const still = () => {
    assert.equal(host.source.phase, "ended");
    assert.equal(host.source.terminalReason, "natural");
    assert.equal(host.source.position, 99.96);
    assert.equal(host.source.paused, true);
  };
  // → (target clamped to the duration), a seek to the duration, to the
  // position, and within 0.5 ms of it: no-ops that succeed.
  await plugin.host.run("seek-forward");
  still();
  await plugin.player.seek(100);
  await plugin.player.seek(99.96);
  await plugin.player.seek(99.9596);
  await host.settle();
  still();
  // Just before the slack: it leaves the end and plays on.
  await plugin.player.seek(99.959);
  await host.settle();
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.position, 99.959);
  assert.equal(host.source.paused, false);
  // Play / Space at the end still restarts from 0, playing.
  host.setSource({
    phase: "ended",
    terminalReason: "natural",
    position: 100,
    paused: true,
  });
  await plugin.host.run("play-pause");
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.position, 0);
  assert.equal(host.source.paused, false);
  await stop();
});

test("keyframe steps after the end: Previous leaves the end paused on the keyframe before, Next goes nowhere (SDK 1.7.5)", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({
    phase: "ready",
    position: 90,
    duration: 100,
    paused: false,
  });
  const { plugin, stop } = await started(host);
  const end = () =>
    host.setSource({
      phase: "ended",
      terminalReason: "natural",
      position: 100,
      paused: true,
    });
  // No keyframes modelled: 1 ms back, exact.
  end();
  await plugin.player.step("keyframe", "backward");
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.position, 100 - 0.001);
  assert.equal(host.source.paused, true);
  // Keyframes modelled: the last one before the position (the end itself
  // is a keyframe: still the one before it).
  host.keyframes = [0, 40, 80, 100];
  host.setSource({ paused: false });
  end();
  await plugin.player.step("keyframe", "backward");
  assert.equal(host.source.position, 80);
  assert.equal(host.source.paused, true);
  // Next Keyframe at the end: accepted, nothing moves.
  host.setSource({ paused: false });
  end();
  await plugin.player.step("keyframe", "forward");
  assert.equal(host.source.phase, "ended");
  assert.equal(host.source.position, 100);
  assert.deepEqual(host.steps.slice(-3), [
    { unit: "keyframe", direction: "backward" },
    { unit: "keyframe", direction: "backward" },
    { unit: "keyframe", direction: "forward" },
  ]);
  // Next Frame stays refused at the end.
  await rejects(plugin.player.step("frame", "forward"), "unsupported");
  await stop();
});

test("Play pressed in the last moment: the end counts as reached playing, so a seek from it plays on (SDK 1.7.5)", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  host.setSource({
    phase: "ready",
    position: 99.9,
    duration: 100,
    paused: true,
  });
  const { plugin, stop } = await started(host);
  // Paused near the end, the user presses Play; the end arrives at once.
  await plugin.player.setPaused(false);
  host.setSource({
    phase: "ended",
    terminalReason: "natural",
    position: 100,
    paused: true,
  });
  await plugin.host.run("seek-backward");
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.paused, false);
  // Paused again, Pause last: the end keeps the pause.
  await plugin.player.setPaused(false);
  host.setSource({ position: 99.9 });
  await plugin.player.setPaused(true);
  host.setSource({ phase: "ended", terminalReason: "natural", position: 100 });
  await plugin.host.run("seek-backward");
  assert.equal(host.source.phase, "ready");
  assert.equal(host.source.paused, true);
  await stop();
});
