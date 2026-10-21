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
    pictureInPicture: { supported: true, active: false },
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

test("bindings: list, override, unbind, reset; press follows the overlay", async () => {
  const host = new TestHost();
  host.bindings.overlay.set("gone.plugin/x", ["Mouse:LeftClick"]);
  let toggled = 0;
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      p.commands.add({
        id: "toggle",
        path: ["播放", "切换"],
        bindings: ["Space", "P"],
        run: () => void toggled++,
      });
    },
    {
      capabilities: ["commands", "events", "bindings.manage", "playback.read"],
      host,
    },
  );
  let changes = 0;
  plugin.bindings.onChange(() => void changes++);
  const listed = await plugin.bindings.list();
  const toggle = listed.commands.find((c) => c.command === "toggle")!;
  assert.equal(toggle.plugin, "test.plugin");
  assert.deepEqual(toggle.shadowed, [
    { input: "Space", by: { plugin: "host", command: "play-pause" } },
  ]);
  assert.deepEqual(listed.orphans, [
    {
      ref: { plugin: "gone.plugin", command: "x" },
      inputs: ["Mouse:LeftClick"],
    },
  ]);
  await plugin.bindings.set({ plugin: "host", command: "play-pause" }, ["K"]);
  await plugin.bindings.set({ plugin: "test.plugin", command: "toggle" }, [
    "Space",
    "Mouse:LeftClick",
  ]);
  await host.press("Space");
  await host.press("Mouse:LeftClick");
  assert.equal(toggled, 2, "Space now reaches the plugin; left click is bound");
  await plugin.bindings.set({ plugin: "test.plugin", command: "toggle" }, []);
  await assert.rejects(host.press("P"));
  await rejects(
    plugin.bindings.set({ plugin: "test.plugin", command: "toggle" }, [
      "Shift+1",
    ]),
    "invalid",
  );
  await rejects(
    plugin.bindings.set({ plugin: "nobody", command: "x" }, ["K"]),
    "missing",
  );
  await plugin.bindings.reset({ plugin: "test.plugin", command: "toggle" });
  assert.equal(
    (await plugin.bindings.list()).commands.find((c) => c.command === "toggle")!
      .overridden,
    false,
  );
  await plugin.bindings.reset();
  assert.equal(host.bindings.overlay.size, 0);
  await host.settle();
  assert.ok(changes >= 4);
  await stop();
});

test("packages: list, follow, enable, disable and uninstall", async () => {
  const host = new TestHost();
  const entry = (id: string, origin: "installed" | "development") => ({
    id,
    version: "1.0.0",
    origin,
    state: "running" as const,
    error: null,
    capabilities: [],
    directory: `/plugins/${id}`,
    previousVersion: null,
  });
  host.packages = [
    entry("a.video", "installed"),
    entry("b.dev", "development"),
  ];
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["plugins.manage"],
    host,
  });
  assert.deepEqual(
    (await plugin.packages.list()).map((p) => [p.id, p.state]),
    [
      ["a.video", "running"],
      ["b.dev", "running"],
    ],
  );
  const seen: string[][] = [];
  plugin.packages.onChange((list) => seen.push(list.map((p) => p.state)));
  await plugin.packages.setEnabled("a.video", false);
  await host.settle();
  assert.deepEqual(seen.at(-1), ["disabled", "running"]);
  await rejects(plugin.packages.setEnabled("test.plugin", false), "invalid");
  await rejects(plugin.packages.setEnabled("nobody", true), "missing");
  const change = await plugin.packages.uninstall("a.video", {
    removeData: true,
  });
  assert.equal(await change.done, "committed");
  assert.deepEqual(host.packageCalls.at(-1), {
    method: "uninstall",
    id: "a.video",
    removeData: true,
  });
  await rejects(plugin.packages.uninstall("b.dev"), "unsupported");
  await host.settle();
  assert.deepEqual(seen.at(-1), ["running"]);
  await stop();
});

test("audio output: devices, the requested and the active device", async () => {
  const host = new TestHost();
  host.audioDevices = [
    { id: "coreaudio/Speakers", name: "Speakers" },
    { id: "coreaudio/Phones", name: "Headphones" },
  ];
  const { plugin, stop } = await started(host);
  assert.deepEqual(plugin.player.state.audioOutput, {
    requested: null,
    active: null,
  });
  assert.deepEqual(
    (await plugin.player.audioDevices()).map((d) => d.name),
    ["Speakers", "Headphones"],
  );
  await plugin.player.setAudioDevice("coreaudio/Phones");
  assert.deepEqual(plugin.player.state.audioOutput, {
    requested: "coreaudio/Phones",
    active: "coreaudio/Phones",
  });
  await plugin.player.setAudioDevice("coreaudio/Unplugged");
  assert.deepEqual(plugin.player.state.audioOutput, {
    requested: "coreaudio/Unplugged",
    active: null,
  });
  await rejects(plugin.player.setAudioDevice("" as never), "invalid");
  await plugin.player.setAudioDevice(null);
  const { player } = plugin as Plugin;
  assert.deepEqual(player.state.audioOutput, { requested: null, active: null });
  await stop();
});

test("secondary subtitles: select by role, load as secondary, never the primary", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mkv");
  host.subtitles.source = { generation: 1, phase: "ready" };
  host.subtitles.selection.stamp = { generation: 1, revision: 0 };
  for (const [id, title, text] of [
    [1, "中文", true],
    [2, "English", true],
    [3, "PGS", false],
  ] as const)
    host.subtitles.tracks.push({
      target: { kind: "embedded", id },
      title,
      language: null,
      styleSupported: text,
      styleReason: null,
      codec: text ? "subrip" : "hdmv_pgs_subtitle",
      text,
      streamIndex: null,
    });
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["subtitles.read", "subtitles.control", "playback.read"],
    host,
  });
  let state = await plugin.subtitles.refresh();
  const [zh, en, pgs] = state.tracks;
  state = await plugin.subtitles.select(zh!);
  state = await plugin.subtitles.select(en!, { role: "secondary" });
  assert.equal(state.selected?.title, "中文");
  assert.equal(state.secondary?.title, "English");
  await rejects(plugin.subtitles.select(zh!, { role: "secondary" }), "invalid");
  await rejects(
    plugin.subtitles.select(pgs!, { role: "secondary" }),
    "invalid",
  );
  await rejects(plugin.subtitles.select(en!), "invalid");
  const loaded = await plugin.subtitles.load(
    new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\nhi\n"),
    { select: "secondary", title: "外挂" },
  );
  assert.equal(plugin.subtitles.state!.secondary?.id, loaded.id);
  assert.equal(host.subtitleLoads.at(-1)!.select, "secondary");
  // Removing the secondary's own track clears it, as in the player.
  state = await plugin.subtitles.remove(loaded);
  assert.equal(state.secondary, null);
  state = await plugin.subtitles.select(en!, { role: "secondary" });
  state = await plugin.subtitles.select(null, { role: "secondary" });
  assert.equal(state.secondary, null);
  await stop();
});
