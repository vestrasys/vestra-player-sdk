import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type {
  Json,
  Plugin,
  PluginError,
  ResolvedStream,
  Stream,
} from "../src/plugin/index.ts";

const capabilities = [
  "playback.read",
  "playback.control",
  "events",
  "source.resolve",
  "producer.av",
];

function host() {
  const host = new TestHost();
  if (process.platform === "win32") host.producerTransport = "tcp";
  return host;
}

const frame = () => ({
  video: new Uint8Array(16),
  audio: new Float32Array(1600),
});
const stream = (extra: Partial<ResolvedStream> = {}): ResolvedStream => ({
  kind: "stream",
  width: 2,
  height: 2,
  frame,
  ...extra,
});

/** A plugin with a file resolver for `.nes`; `resolve` is the test's. */
async function emulator(
  resolve: (path: string, signal: AbortSignal) => Promise<ResolvedStream>,
  options: { host?: TestHost } = {},
) {
  let plugin!: Plugin;
  const started = await startPlugin(
    (p) => {
      plugin = p;
      p.resolvers.add({ id: "nes", extensions: ["nes"], resolve });
    },
    { capabilities, host: options.host ?? host() },
  );
  return { ...started, plugin };
}

const until = async (condition: () => boolean, what: string) => {
  for (const deadline = Date.now() + 5000; !condition();) {
    if (Date.now() > deadline) throw new Error(`timed out: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
};

test("opening a file of the extension plays the stream the resolver generates, under the path", async () => {
  const paths: string[] = [];
  let running: Stream | undefined;
  const order: string[] = [];
  const { host, plugin, stop } = await emulator(async (path) => {
    paths.push(path);
    return stream({
      started: (s) => {
        running = s;
        order.push("started");
        s.onStop(() => order.push("stopped"));
      },
    });
  });
  assert.deepEqual(host.sent("sourceResolvers.register"), [
    { id: "nes", extensions: ["nes"] },
  ]);
  const media = await plugin.player.open("/roms/Game.NES");
  await media.ready({ signal: AbortSignal.timeout(5000) });
  await until(() => running !== undefined, "started");
  assert.deepEqual(paths, ["/roms/Game.NES"]);
  assert.equal(plugin.player.state.kind, "stream");
  assert.equal(plugin.player.state.source, "/roms/Game.NES");
  assert.equal(plugin.player.state.phase, "ready");
  assert.equal(running!.running, true);
  assert.deepEqual(order, ["started"]);
  const producer = [...host.producers.values()][0]!;
  assert.ok(producer.receivedFrames >= 2048, "prerolled before answering");
  assert.equal(host.resolutions.size, 0);
  // The stream belongs to the resolver's plugin: stopping it closes the source.
  await running!.stop();
  assert.equal(host.source.phase, "empty");
  assert.equal(producer.released, true);
  // Other files are not resolved.
  await plugin.player.open("/movies/a.mp4");
  assert.equal(paths.length, 1);
  await stop();
});

test("paused reaches the stream's start; another plugin's open is resolved too", async () => {
  let started = 0;
  const { host, plugin, stop } = await emulator(async () =>
    stream({ started: () => void started++ }),
  );
  await plugin.player.open("/roms/a.nes", { paused: true });
  await until(() => started === 1, "started");
  assert.equal(host.source.paused, true);
  const acks = host.sent("producer.ack") as { control: { paused: boolean } }[];
  assert.equal(acks[0]!.control.paused, true, "the start control is paused");
  // Opened elsewhere (the playlist, the Open dialog): same resolution.
  host.openElsewhere("/roms/b.nes");
  await until(() => started === 2, "second start");
  assert.equal(host.source.source, "/roms/b.nes");
  assert.equal(host.source.kind, "producer");
  assert.equal(host.source.paused, false);
  await stop();
});

test("a failed resolve fails the open with the resolver's own words", async () => {
  const { host, plugin, stop } = await emulator(async () => {
    throw new Error("不是 iNES 文件");
  });
  await assert.rejects(
    plugin.player.open("/roms/bad.nes"),
    (error: PluginError) => error.message === "不是 iNES 文件",
  );
  assert.equal(plugin.player.state.phase, "error");
  assert.equal(plugin.player.state.error, "不是 iNES 文件");
  assert.deepEqual(
    host
      .sent("sourceResolvers.respond")
      .map((p) => (p as { error: Json }).error),
    ["不是 iNES 文件"],
  );
  await stop();
});

test("closing or replacing the open during resolve aborts the resolve signal", async () => {
  const signals: AbortSignal[] = [];
  const { host, plugin, stop } = await emulator(
    (_path, signal) =>
      new Promise((_resolve, reject) => {
        signals.push(signal);
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
  const opening = plugin.player.open("/roms/a.nes");
  await until(() => signals.length === 1, "resolve called");
  await plugin.player.close();
  assert.equal(signals[0]!.aborted, true);
  // As for a web page still resolving: the open failed, the source is closed.
  await assert.rejects(
    opening,
    (error: PluginError) => error.code === "backend",
  );
  assert.equal(plugin.player.state.phase, "empty");
  host.openElsewhere("/roms/b.nes");
  await until(() => signals.length === 2, "second resolve");
  host.openElsewhere("/movies/a.mp4");
  assert.equal(signals[1]!.aborted, true);
  assert.equal(host.sent("sourceResolvers.respond").length, 0);
  assert.equal(host.producers.size, 0);
  await stop();
});

test("cancelled after resolve but before activation: released, started never called", async () => {
  let started = 0;
  // 1. The open is replaced while the stream is prerolled: the answer is stale.
  const first = await emulator(async () =>
    stream({ started: () => void started++ }),
  );
  first.host.handle("sourceResolvers.respond", (params) => {
    first.host.openElsewhere("/movies/a.mp4");
    first.host.reset("sourceResolvers.respond");
    return first.host.request("sourceResolvers.respond", params);
  });
  first.host.openElsewhere("/roms/a.nes");
  await until(
    () => [...first.host.producers.values()].some((p) => p.released),
    "released",
  );
  assert.equal(started, 0);
  assert.equal(first.host.source.source, "/movies/a.mp4");
  await first.stop();
  // 2. Replaced after the host selected it, before its start was acknowledged.
  const second = await emulator(async () =>
    stream({ started: () => void started++ }),
  );
  second.host.handle("producer.ack", (params) => {
    second.host.reset("producer.ack");
    second.host.openElsewhere("/movies/b.mp4");
    return second.host.request("producer.ack", params);
  });
  second.host.openElsewhere("/roms/a.nes");
  await until(
    () => [...second.host.producers.values()].some((p) => p.released),
    "released after selection",
  );
  assert.equal(started, 0);
  assert.equal(second.host.source.source, "/movies/b.mp4");
  await second.stop();
});

test("another plugin's extension is a conflict that does not fail activation", async () => {
  const fake = host();
  fake.otherResolvers.push({ owner: "vestra.nes", extensions: ["nes"] });
  let code: string | undefined;
  const { stop } = await startPlugin(
    (plugin) => {
      const resolver = plugin.resolvers.add({
        id: "emu",
        extensions: ["gb", "nes"],
        resolve: async () => stream(),
      });
      void resolver.ready.catch((error: PluginError) => (code = error.code));
      plugin.commands.add({ id: "still", path: ["文件", "Still"], run() {} });
    },
    { capabilities: [...capabilities, "commands"], host: fake },
  );
  assert.equal(code, "conflict");
  assert.ok(fake.command("still"));
  assert.equal(fake.resolvers.size, 0);
  await stop();
  // The plugin's own second claim is its mistake: activation fails.
  await assert.rejects(
    startPlugin(
      (plugin) => {
        plugin.resolvers.add({
          id: "a",
          extensions: ["nes"],
          resolve: async () => stream(),
        });
        plugin.resolvers.add({
          id: "b",
          extensions: ["nes"],
          resolve: async () => stream(),
        });
      },
      { capabilities, host: host() },
    ),
    (error: PluginError) => error.code === "conflict",
  );
  // Malformed extensions are invalid.
  await assert.rejects(
    startPlugin(
      (plugin) =>
        void plugin.resolvers.add({
          id: "a",
          extensions: [".NES"],
          resolve: async () => stream(),
        }),
      { capabilities, host: host() },
    ),
    (error: PluginError) => error.code === "invalid",
  );
});

test("disposing the resolver aborts a resolve in flight and frees the extension", async () => {
  let signal: AbortSignal | undefined;
  let plugin!: Plugin;
  const started = await startPlugin(
    (p) => {
      plugin = p;
    },
    { capabilities, host: host() },
  );
  const resolver = plugin.resolvers.add({
    id: "nes",
    extensions: ["nes"],
    resolve: (_path, s) => {
      signal = s;
      return new Promise<ResolvedStream>(() => {});
    },
  });
  await resolver.ready;
  started.host.openElsewhere("/roms/a.nes");
  await until(() => signal !== undefined, "resolve called");
  await resolver.dispose();
  assert.equal(signal!.aborted, true);
  assert.equal(started.host.resolvers.size, 0);
  started.host.openElsewhere("/roms/b.nes");
  assert.equal(started.host.resolutions.size, 0);
  await started.stop();
});
