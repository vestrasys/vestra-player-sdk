import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import type { Plugin } from "../../sdk/plugin/index.ts";
import { createPlugin } from "../../sdk/plugin/index.ts";

const all = [
  "playback.read",
  "playback.control",
  "events",
  "ui.dialog",
  "window.control",
];

async function started(host = new TestHost(), capabilities = all) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities, host },
  );
  return { ...result, plugin };
}

const rejects = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });

test("window state is read before activation and follows the player", async () => {
  const host = new TestHost();
  host.mainWindow.videoArea = { width: 1280, height: 720 };
  let seen: unknown;
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      seen = p.window.state;
    },
    { capabilities: all, host },
  );
  assert.deepEqual(seen, {
    fullscreen: false,
    videoArea: { width: 1280, height: 720 },
  });
  const changes: boolean[] = [];
  plugin.window.onChange((state) => changes.push(state.fullscreen));
  await host.settle();
  host.setMainWindow({ fullscreen: true });
  await host.settle();
  assert.equal(plugin.window.state.fullscreen, true);
  assert.deepEqual(changes, [true]);
  await rejects(
    plugin.window.setVideoArea({ width: 640, height: 360 }),
    "unavailable",
  );
  host.setMainWindow({ fullscreen: false });
  const applied = await plugin.window.setVideoArea({ width: 640, height: 360 });
  assert.deepEqual(applied, { width: 640, height: 360, clamped: false });
  assert.deepEqual(plugin.window.state.videoArea, { width: 640, height: 360 });
  const small = await plugin.window.setVideoArea({ width: 100, height: 50 });
  assert.equal(small.clamped, true);
  await rejects(
    plugin.window.setVideoArea({ width: 0, height: 10 }),
    "invalid",
  );
  await plugin.window.setAlwaysOnTop(true);
  await plugin.window.setCursorAutoHide("playing");
  assert.equal(host.mainWindow.onTop, true);
  assert.equal(host.mainWindow.cursorAutoHide, "playing");
  await rejects(plugin.window.setCursorAutoHide("never" as never), "invalid");
  await stop();
});

test("plugin.app comes from the handshake; without one it is unknown", async () => {
  const host = new TestHost();
  host.app = {
    version: "1.2.3",
    build: "abc1234",
    components: {
      mpv: "mpv 0.41.0",
      libav: { ffmpeg: "7.1.1", bad: 3 as never },
      slint: "1.16.1",
    },
  };
  const { plugin, stop } = await started(host);
  assert.equal(plugin.app.version, "1.2.3");
  assert.equal(plugin.app.build, "abc1234");
  assert.deepEqual(plugin.app.components.libav, { ffmpeg: "7.1.1" });
  assert.equal(plugin.scope().app.components.slint, "1.16.1");
  assert.ok(Object.isFrozen(plugin.app));
  await stop();
  const bare = await createPlugin(
    new TestHost(),
    { id: "x", capabilities: [] },
    process.cwd(),
  );
  assert.deepEqual(bare.plugin.app, {
    version: "0.0.0",
    build: null,
    components: { mpv: null, libav: {}, slint: "" },
  });
  await bare.dispose();
});

test("confirm sends the options and returns the answer and the checkbox", async () => {
  const { host, plugin, stop } = await started();
  host.dialogAnswers.push({ confirmed: true, checked: true });
  const answer = await plugin.dialogs.confirm({
    message: "清空播放列表？",
    confirm: "清空",
    destructive: true,
    checkbox: "不再询问",
  });
  assert.deepEqual(answer, { confirmed: true, checked: true });
  assert.deepEqual(host.confirms, [
    {
      message: "清空播放列表？",
      confirm: "清空",
      destructive: true,
      checkbox: "不再询问",
    },
  ]);
  host.dialogAnswers.push({ confirmed: false, checked: false });
  assert.equal(
    (await plugin.dialogs.confirm({ message: "好？", confirm: "好" }))
      .confirmed,
    false,
  );
  await rejects(
    plugin.dialogs.confirm({ message: "", confirm: "好" }),
    "invalid",
  );
  await rejects(
    plugin.dialogs.confirm({ message: "好？", confirm: "x".repeat(41) }),
    "invalid",
  );
  // 200 CJK characters fit (characters, not bytes).
  host.dialogAnswers.push({ confirmed: true, checked: false });
  await plugin.dialogs.confirm({ message: "中".repeat(200), confirm: "好" });
  await stop();
});

test("chapters are read on demand; the A-B loop is state and a new source clears it", async () => {
  const host = new TestHost();
  host.chapters = [
    { title: "Opening", start: 0 },
    { title: null, start: 90 },
  ];
  const { plugin, stop } = await started(host);
  assert.deepEqual((await plugin.player.chapters()).chapters, []);
  await plugin.player.open("/movie.mkv");
  host.setSource({ phase: "ready", duration: 600 });
  await host.settle();
  const listed = await plugin.player.chapters();
  assert.equal(listed.sourceId, plugin.player.state.sourceId);
  assert.deepEqual(listed.chapters, host.chapters);
  assert.equal(plugin.player.state.loop, null);
  await plugin.player.setLoop({ a: 10, b: 20, count: 3 });
  assert.deepEqual(plugin.player.state.loop, { a: 10, b: 20, count: 3 });
  await plugin.player.setLoop({ a: 30, b: 40 });
  assert.deepEqual(plugin.player.state.loop, { a: 30, b: 40, count: null });
  await rejects(plugin.player.setLoop({ a: 20, b: 10 }), "invalid");
  await rejects(plugin.player.setLoop({ a: 0, b: 700 }), "invalid");
  await rejects(plugin.player.setLoop({ a: 0, b: 1, count: 0 }), "invalid");
  const seen = plugin.player.state;
  await plugin.player.setPaused(true);
  await rejects(
    plugin.player.setLoop({ a: 1, b: 2 }, { ifCurrent: seen }),
    "stale",
  );
  host.openElsewhere("/next.mkv");
  await host.settle();
  assert.equal(plugin.player.state.loop, null, "a new source clears the loop");
  host.setSource({ duration: 60 });
  await plugin.player.setLoop({ a: 1, b: 2 });
  await plugin.player.setLoop(null);
  assert.equal(plugin.player.state.loop, null);
  host.setSource({
    capabilities: { ...host.source.capabilities, seek: false },
  });
  await rejects(plugin.player.setLoop({ a: 1, b: 2 }), "unsupported");
  await stop();
});
