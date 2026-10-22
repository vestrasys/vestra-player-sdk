import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import { systemServices } from "../src/plugin/local.ts";
import { canonical } from "../src/plugin/bindings.ts";
import { nodeProblem } from "../src/processing.ts";

const all = [
  "playback.read",
  "playback.control",
  "events",
  "subtitles.read",
  "subtitles.control",
  "processing.video",
  "processing.audio",
  "clipboard",
];

async function started(host = new TestHost()) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities: all, host },
  );
  return { ...result, plugin };
}

const rejects = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });

test("stats fill round-2 fields with null when the host has none", async () => {
  const { host, plugin, stop } = await started();
  host.stats = {
    backend: "test",
    session: 1,
    framesShown: 3,
    framesDropped: 0,
    video: { codec: "H.264", width: 640, height: 360, fps: 30 },
    audio: {
      codec: "aac",
      sampleRate: 48000,
      channels: 2,
      channelLayout: "stereo",
    },
  };
  const stats = await plugin.player.stats();
  assert.equal(stats.video!.decoder, null);
  assert.equal(stats.video!.displayWidth, null);
  assert.equal(stats.audio!.channelLayout, "stereo");
  assert.equal(stats.avSyncMs, null);
  assert.equal(stats.cacheSeconds, null);
  await stop();
});

test("external audio tracks are added, selected and conditional on the source", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mkv");
  host.setSource({
    audioTracks: [
      {
        trackId: 1,
        streamIndex: 1,
        selected: true,
        external: false,
        codec: "aac",
        title: null,
        language: "en",
      },
    ],
  });
  const { plugin, stop } = await started(host);
  const added = await plugin.player.addAudioTrack("/dub.mp3");
  assert.equal(added.id, 2);
  assert.equal(added.external, true);
  assert.equal(added.exportable, false);
  assert.deepEqual(
    plugin.player.state.audioTracks!.map((t) => [t.id, t.selected]),
    [
      [1, false],
      [2, true],
    ],
  );
  const state = await plugin.player.selectAudioTrack(1);
  assert.equal(state.audioTracks![0]!.selected, true);
  await rejects(plugin.player.selectAudioTrack(9), "invalid");
  await rejects(plugin.player.addAudioTrack("dub.mp3"), "invalid");
  const seen = plugin.player.state;
  await plugin.player.setPaused(true);
  await rejects(
    plugin.player.selectAudioTrack(2, { ifCurrent: seen }),
    "stale",
  );
  const quiet = await plugin.player.addAudioTrack("/second.mp3", {
    select: false,
  });
  assert.equal(quiet.selected, false);
  host.openElsewhere("/next.mkv", "loading");
  await rejects(plugin.player.addAudioTrack("/dub.mp3"), "unavailable");
  await stop();
});

test("subtitle load takes format, title and select; tracks carry codec, text and streamIndex", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mkv");
  host.subtitles.tracks.push({
    target: { kind: "embedded", id: 1 },
    title: "English",
    language: "en",
    styleSupported: true,
    styleReason: null,
    codec: "subrip",
    text: true,
    streamIndex: 2,
  });
  host.subtitles.tracks.push({
    target: { kind: "embedded", id: 2 },
    title: "PGS",
    language: null,
    styleSupported: false,
    styleReason: "bitmap",
  });
  const { plugin, stop } = await started(host);
  const state = await plugin.subtitles.refresh();
  assert.deepEqual(
    state.tracks.map((t) => [t.codec, t.text, t.streamIndex]),
    [
      ["subrip", true, 2],
      [null, false, null],
    ],
  );
  const ass = Buffer.from(
    "[Script Info]\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hi\n",
  );
  const track = await plugin.subtitles.load(ass, {
    format: "ass",
    title: "原样式",
    select: "none",
  });
  assert.equal(track.title, "原样式");
  assert.equal(track.codec, "ass");
  assert.equal(track.streamIndex, null);
  assert.equal(
    plugin.subtitles.state!.selected,
    null,
    "select: none keeps the selection",
  );
  assert.deepEqual(
    host.subtitleLoads.map(({ format, title, select }) => [
      format,
      title,
      select,
    ]),
    [["ass", "原样式", "none"]],
  );
  const srt = await plugin.subtitles.load(
    Buffer.from("1\n00:00:00,000 --> 00:00:01,000\nHi\n"),
  );
  assert.equal(plugin.subtitles.state!.selected!.id, srt.id);
  assert.deepEqual(
    host.sent("subtitles.commit").map((p) => p.format ?? "default"),
    ["ass", "default"],
    "defaults stay off the wire",
  );
  await rejects(plugin.subtitles.load(ass, { title: "" }), "invalid");
  await rejects(
    plugin.subtitles.load(ass, { format: "vtt" as "srt" }),
    "invalid",
  );
  await stop();
});

test("clipboard and sleep prevention go to the host", async () => {
  const host = new TestHost();
  host.clipboard.text = "预填";
  const { plugin, stop } = await started(host);
  assert.equal(await plugin.clipboard.readText(), "预填");
  await plugin.clipboard.writeText("文件名.mkv");
  assert.equal(host.clipboard.text, "文件名.mkv");
  await plugin.clipboard.writeImage("/tmp/shot.png");
  assert.deepEqual(host.clipboard.images, ["/tmp/shot.png"]);
  await rejects(plugin.clipboard.writeImage("shot.png"), "invalid");
  host.handle("clipboard.writeText", () => {
    throw new HostError("unavailable", "headless");
  });
  await rejects(plugin.clipboard.writeText("x"), "unavailable");
  await plugin.power.preventSleep("playing");
  assert.equal(host.power, "playing");
  await plugin.power.preventSleep("off");
  assert.equal(host.power, "off");
  await rejects(plugin.power.preventSleep("always" as "off"), "invalid");
  await stop();
});

test("tools: unavailable by default, injected results, argument checks", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  assert.equal(await plugin.tools.available("ffprobe"), false);
  await rejects(
    plugin.tools.run("ffprobe", ["-i", "a"], { timeoutMs: 1000 }),
    "unavailable",
  );
  host.tools.handle("ffprobe", (args) => ({
    stdout: JSON.stringify({ args }),
  }));
  assert.equal(
    await plugin.tools.available("ffprobe"),
    true,
    "a miss is looked up again",
  );
  const result = await plugin.tools.run("ffprobe", ["-v", "error"], {
    timeoutMs: 1000,
  });
  assert.deepEqual(JSON.parse(Buffer.from(result.stdout).toString()), {
    args: ["-v", "error"],
  });
  assert.deepEqual(host.tools.calls, [
    { tool: "ffprobe", args: ["-v", "error"] },
  ]);
  await rejects(
    plugin.tools.run("ffprobe", [], { timeoutMs: 1000, maxOutput: 4 }),
    "invalid",
  );
  await rejects(plugin.tools.run("ffprobe", [], { timeoutMs: 0 }), "invalid");
  await rejects(
    plugin.tools.run("sox" as "ffmpeg", [], { timeoutMs: 1 }),
    "invalid",
  );
  host.tools.handle("ffmpeg", () => {
    throw new HostError("failed", "Invalid data found when processing input");
  });
  await rejects(plugin.tools.run("ffmpeg", [], { timeoutMs: 1000 }), "failed");
  await stop();
});

/** A real child process: node itself running a small script. */
const script = (source: string) => ["-e", source];

test("real processes: output, failure line, timeout, size limit, abort", async () => {
  const signal = new AbortController().signal;
  const node = process.execPath;
  const ok = await systemServices.run(
    node,
    script("process.stdout.write('hi')"),
    {
      timeoutMs: 5000,
      maxOutput: 1024,
      signal,
    },
  );
  assert.equal(Buffer.from(ok.stdout).toString(), "hi");
  await rejects(
    systemServices.run(
      node,
      script("console.error('one');console.error('last line');process.exit(3)"),
      {
        timeoutMs: 5000,
        maxOutput: 1024,
        signal,
      },
    ),
    "failed",
  );
  await assert.rejects(
    systemServices.run(node, script("console.error('boom');process.exit(1)"), {
      timeoutMs: 5000,
      maxOutput: 1024,
      signal,
    }),
    /boom/,
  );
  const started = Date.now();
  await rejects(
    systemServices.run(
      node,
      script("process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"),
      {
        timeoutMs: 100,
        maxOutput: 1024,
        signal,
      },
    ),
    "timeout",
  );
  assert.ok(Date.now() - started < 3000, "SIGKILL follows an ignored SIGTERM");
  await rejects(
    systemServices.run(node, script("process.stdout.write('x'.repeat(5000))"), {
      timeoutMs: 5000,
      maxOutput: 100,
      signal,
    }),
    "invalid",
  );
  const controller = new AbortController();
  const running = systemServices.run(node, script("setInterval(()=>{},1000)"), {
    timeoutMs: 10_000,
    maxOutput: 1024,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 50);
  await rejects(running, "aborted");
});

test("tools are found through VESTRA_FFPROBE", async () => {
  const before = process.env.VESTRA_FFPROBE;
  try {
    process.env.VESTRA_FFPROBE = process.execPath;
    assert.equal(await systemServices.locate("ffprobe"), process.execPath);
    process.env.VESTRA_FFPROBE = "/nonexistent/ffprobe";
    assert.equal(await systemServices.locate("ffprobe"), null);
  } finally {
    if (before === undefined) delete process.env.VESTRA_FFPROBE;
    else process.env.VESTRA_FFPROBE = before;
  }
});

test("disposing the scope ends a running tool", async () => {
  const host = new TestHost();
  let release!: () => void;
  host.tools.handle(
    "ffmpeg",
    () => new Promise((resolve) => (release = () => resolve({}))),
  );
  const { plugin, stop } = await started(host);
  const child = plugin.scope();
  let seen: AbortSignal | undefined;
  const original = host.local.run;
  host.local.run = (path, args, options) => {
    seen = options.signal;
    return original(path, args, options);
  };
  const running = child.tools.run("ffmpeg", ["-i", "x"], { timeoutMs: 10_000 });
  await host.settle();
  await child.dispose();
  assert.equal(seen?.aborted, true);
  release();
  await running.catch(() => {});
  await stop();
});

type Settings = { volume: number };
const isSettings = (value: unknown): value is Settings =>
  typeof (value as Settings)?.volume === "number";

test("storage: defaults, debounced atomic save, flush, broken files kept aside", async () => {
  const data = mkdtempSync(join(tmpdir(), "vestra-storage-"));
  try {
    let plugin!: Plugin;
    const first = await startPlugin((p: Plugin) => void (plugin = p), {
      capabilities: [],
      dataDirectory: data,
    });
    const store = plugin.storage.json<Settings>("settings", {
      defaults: { volume: 50 },
      validate: isSettings,
      debounceMs: 20,
    });
    assert.deepEqual(store.value, { volume: 50 });
    store.save({ volume: 60 });
    store.save({ volume: 70 });
    assert.deepEqual(store.value, { volume: 70 });
    assert.equal(existsSync(join(data, "settings.json")), false, "debounced");
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(
      JSON.parse(readFileSync(join(data, "settings.json"), "utf8")),
      { volume: 70 },
    );
    store.save({ volume: 80 });
    await store.flush();
    assert.deepEqual(
      JSON.parse(readFileSync(join(data, "settings.json"), "utf8")),
      { volume: 80 },
    );
    store.save({ volume: 90 });
    await first.stop();
    assert.deepEqual(
      JSON.parse(readFileSync(join(data, "settings.json"), "utf8")),
      { volume: 90 },
      "stopping the plugin flushes",
    );
    assert.deepEqual(
      readdirSync(data).filter((name) => name.includes(".tmp")),
      [],
    );
    writeFileSync(join(data, "settings.json"), "{ not json");
    writeFileSync(join(data, "other.json"), JSON.stringify({ volume: "loud" }));
    const second = await startPlugin((p: Plugin) => void (plugin = p), {
      capabilities: [],
      dataDirectory: data,
    });
    const broken = plugin.storage.json("settings", {
      defaults: { volume: 1 },
      validate: isSettings,
    });
    const invalid = plugin.storage.json("other", {
      defaults: { volume: 2 },
      validate: isSettings,
    });
    assert.deepEqual(broken.value, { volume: 1 });
    assert.deepEqual(invalid.value, { volume: 2 });
    const names = readdirSync(data);
    assert.ok(names.some((name) => name.startsWith("settings.json.bad-")));
    assert.ok(names.some((name) => name.startsWith("other.json.bad-")));
    assert.ok(!names.includes("settings.json"));
    assert.throws(
      () => plugin.storage.json("Bad Name", { defaults: {} }),
      (e: { code?: string }) => e.code === "invalid",
    );
    await second.stop();
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});

// Windows has no POSIX permission bits: Node reports 0o666 for any writable file.
test(
  "storage files are owner-only (0600)",
  {
    skip: process.platform === "win32" && "no POSIX file modes on Windows",
  },
  async () => {
    const host = new TestHost();
    const { plugin, stop } = await started(host);
    const store = plugin.storage.json("history", {
      defaults: { recent: [] as string[] },
    });
    store.save({ recent: ["/Users/me/private.mkv"] });
    await store.flush();
    assert.equal(
      statSync(join(host.dataDirectory, "history.json")).mode & 0o777,
      0o600,
    );
    await stop();
  },
);

test("a window the user closed reports onClose, is no longer opened, and reopens fresh", async () => {
  const host = new TestHost();
  let plugin!: Plugin;
  const { stop } = await startPlugin((p: Plugin) => void (plugin = p), {
    capabilities: ["ui.window"],
    host,
  });
  const window = plugin.windows.create("info.slint");
  let closed = 0;
  window.onClose(() => closed++);
  window.bind(() => ({ title: "播放属性" }));
  await window.show();
  host.window("info").userClose();
  await host.settle();
  assert.equal(closed, 1);
  assert.equal(window.opened, false);
  await window.show();
  assert.equal(window.opened, true);
  assert.equal(host.window("info").props.title, "播放属性");
  assert.equal(host.sent("ui.open").length, 2);
  await window.close();
  assert.equal(closed, 1, "close() is not a user close");
  await stop();
});

test("system: reveal and open existing paths; missing ones are refused", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  await plugin.system.reveal(host.dataDirectory);
  await plugin.system.openPath(host.dataDirectory);
  assert.deepEqual(host.system.revealed, [host.dataDirectory]);
  assert.deepEqual(host.system.opened, [host.dataDirectory]);
  await rejects(plugin.system.reveal("/nonexistent/vestra"), "missing");
  await plugin.system.reveal([
    host.dataDirectory,
    "/nonexistent/vestra",
    tmpdir(),
  ]);
  assert.deepEqual(host.system.revealed.slice(1), [
    host.dataDirectory,
    tmpdir(),
  ]);
  await rejects(
    plugin.system.reveal(["/nonexistent/a", "/nonexistent/b"]),
    "missing",
  );
  await rejects(plugin.system.reveal([]), "invalid");
  await plugin.system.openUrl("https://example.com/字幕?q=1");
  assert.deepEqual(host.system.urls, [
    "https://example.com/%E5%AD%97%E5%B9%95?q=1",
  ]);
  for (const bad of [
    "file:///etc/passwd",
    "javascript:alert(1)",
    "-a Safari",
    "example.com",
  ])
    await rejects(plugin.system.openUrl(bad), "invalid");
  await stop();
});

test("processing nodes: the test host refuses what the player refuses", async () => {
  assert.equal(
    nodeProblem("video", [{ kind: "hue", degrees: 30 } as never]),
    null,
  );
  assert.equal(
    nodeProblem("video", [
      { kind: "transform", rotate: 90, flipH: true, flipV: false } as never,
    ]),
    null,
  );
  assert.match(
    nodeProblem("video", [
      { kind: "transform", rotate: 45, flipH: true, flipV: false } as never,
    ])!,
    /rotate/,
  );
  assert.match(
    nodeProblem("video", [
      { kind: "deband", threshold: 0.02, range: 1.5 } as never,
    ])!,
    /integer/,
  );
  assert.match(
    nodeProblem("video", [{ kind: "channels", mode: "left" } as never])!,
    /unknown video node/,
  );
  assert.equal(
    nodeProblem("audio", [{ kind: "channels", mode: "swap" } as never]),
    null,
  );
  assert.match(
    nodeProblem("video", [{ kind: "hue", degrees: 30, extra: 1 } as never])!,
    /unknown field/,
  );
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  let plugin!: Plugin;
  const { stop } = await startPlugin((p: Plugin) => void (plugin = p), {
    capabilities: all,
    host,
  });
  const filter = plugin.video.filter("picture");
  filter.set([{ kind: "reframe", mode: "crop", aspect: 5, x: 0, y: 0 }]);
  await host.settle();
  assert.equal(filter.status.state, "failed");
  const audio = plugin.audio.filter("sound");
  audio.set({ nodes: [{ kind: "channels", mode: "mono" }], delayMs: -10_000 });
  await host.settle();
  assert.equal(audio.status.state, "applied");
  audio.set({ nodes: [], delayMs: 10_010 });
  await host.settle();
  assert.equal(audio.status.state, "failed");
  await stop();
});

test("keypad names are bindable and distinct from main-keyboard keys", () => {
  for (const binding of [
    "Numpad5",
    "Ctrl+NumpadPlus",
    "Shift+NumpadEnter",
    "NumpadDecimal",
  ])
    assert.equal(canonical(binding), binding);
  assert.throws(() => canonical("NumpadAdd"));
  assert.throws(() => canonical("Numpad10"));
});

test("subtitle state of a new source is taken although its selection restarts at revision 0", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await started(host);
  // Source A after an external load: the selection is at revision 2.
  host.subtitles.source = { generation: 1, phase: "ready" };
  host.subtitles.selection.stamp = { generation: 1, revision: 2 };
  assert.equal((await plugin.subtitles.refresh()).phase, "ready");
  // Source B loading: the host still reports A's selection stamp.
  host.subtitles.source = { generation: 2, phase: "loading" };
  assert.equal((await plugin.subtitles.refresh()).phase, "loading");
  // B ready: the selection restarts at B's generation, revision 0.
  host.subtitles.source = { generation: 2, phase: "ready" };
  host.subtitles.selection.stamp = { generation: 2, revision: 0 };
  const state = await plugin.subtitles.refresh();
  assert.equal(state.phase, "ready");
  assert.equal(state.sourceId, 2);
  await plugin.subtitles.select(null);
  assert.deepEqual(host.sent("subtitles.select").at(-1)!.expected, {
    generation: 2,
    revision: 0,
  });
  await stop();
});
