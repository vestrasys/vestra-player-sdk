import assert from "node:assert/strict";
import test from "node:test";
import { HostError } from "../../sdk/index.ts";
import { startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import type { Plugin, PlayerState } from "../../sdk/plugin/index.ts";

const capabilities = ["playback.read", "playback.control", "events"];
const start = (
  activate: (plugin: Plugin) => unknown = () => {},
  host?: TestHost,
) => startPlugin(activate, { capabilities, ...(host ? { host } : {}) });

test("state is read before activation and older events are dropped", async () => {
  const host = new TestHost();
  host.source = {
    ...host.source,
    phase: "ready",
    source: "/a.mp4",
    eventSequence: 5,
  };
  let initial: PlayerState | undefined;
  const { plugin, stop } = await start((plugin) => {
    initial = plugin.player.state;
  }, host);
  assert.equal(initial?.phase, "ready");
  host.emit("source.state", {
    ...host.source,
    eventSequence: 4,
    phase: "empty",
  });
  assert.equal(plugin.player.state.phase, "ready", "an older event never wins");
  await stop();
});

test("open resolves with media whose ready() follows its own load", async () => {
  const { host, plugin, stop } = await start();
  const media = await plugin.player.open("/movie.mp4");
  assert.equal(plugin.player.state.phase, "loading");
  const ready = media.ready();
  host.setSource({ phase: "ready", duration: 60 });
  await ready;
  assert.equal(media.current, true);
  host.openElsewhere("/other.mp4", "loading");
  await host.settle();
  assert.equal(media.current, false);
  await assert.rejects(
    media.ready(),
    (error: HostError) => error.code === "replaced",
  );
  await stop();
});

test("controls are conditional on the state the plugin sees", async () => {
  const { host, plugin, stop } = await start();
  await plugin.player.open("/movie.mp4");
  host.setSource({ phase: "ready", duration: 60 });
  await host.settle();
  const seen = plugin.player.state;
  await plugin.player.setPaused(true);
  assert.equal(plugin.player.state.paused, true);
  assert.equal(plugin.player.isCurrent(seen), false);
  await assert.rejects(
    plugin.player.seek(10, { ifCurrent: seen }),
    (error: HostError) => error.code === "stale",
  );
  assert.equal(host.source.position, null, "a stale call does nothing");
  await plugin.player.seek(10);
  assert.equal(host.source.position, 10);
  await stop();
});

test("explicit ifCurrent on open guards an automatic advance", async () => {
  const { host, plugin, stop } = await start();
  await plugin.player.open("/one.mp4");
  host.setSource({ phase: "ended", terminalReason: "natural" });
  await host.settle();
  const ended = plugin.player.state;
  host.openElsewhere("/user-choice.mp4");
  await assert.rejects(
    plugin.player.open("/two.mp4", { ifCurrent: ended }),
    (error: HostError) => error.code === "stale",
  );
  assert.equal(host.source.source, "/user-choice.mp4");
  await stop();
});

test("a lost reply is resolved through the same operation id", async () => {
  const { host, plugin, stop } = await start();
  host.handle("source.submit", (params) => {
    host.reset("source.submit");
    void host.request("source.submit", params);
    throw new Error("pipe hiccup");
  });
  const media = await plugin.player.open("/movie.mp4");
  assert.equal(media.current, true);
  const opens = host.sent("source.submit");
  assert.equal(opens.length, 2, "the probe re-sent nothing new");
  assert.equal(opens[0]!.operationId, opens[1]!.operationId);
  assert.equal(host.sent("source.operation").length, 1);
  await stop();
});

test("onEnd fires once per natural playthrough", async () => {
  const { host, plugin, stop } = await start();
  const media = await plugin.player.open("/movie.mp4");
  const ends: string[] = [];
  media.onEnd((state) => ends.push(state.source ?? ""));
  host.setSource({ phase: "ready" });
  host.setSource({ phase: "ended", terminalReason: "natural" });
  host.setSource({ phase: "ended", terminalReason: "natural", position: 60 });
  await host.settle();
  assert.deepEqual(ends, ["/movie.mp4"]);
  await plugin.player.restart();
  host.setSource({ phase: "ended", terminalReason: "natural" });
  await host.settle();
  assert.equal(ends.length, 2, "a restart is a new playthrough");
  await stop();
});

test("scrub chains its own seeks and stops when someone else intervenes", async () => {
  const { host, plugin, stop } = await start();
  await plugin.player.open("/movie.mp4");
  host.setSource({ phase: "ready", duration: 100 });
  await host.settle();
  const scrub = plugin.player.scrub();
  const first = scrub.seek(10);
  const second = scrub.seek(20);
  const third = scrub.seek(30);
  assert.deepEqual(await Promise.all([first, second, third]), [
    true,
    false,
    true,
  ]);
  assert.equal(host.source.position, 30);
  await plugin.player.setPaused(true); // another intent, not part of the gesture
  assert.equal(scrub.active, false);
  assert.equal(await scrub.seek(40), false);
  assert.equal(host.source.position, 30);
  await stop();
});

test("setOutput coalesces and applies volume before unmuting", async () => {
  const { host, plugin, stop } = await start();
  const results = await Promise.all([
    plugin.player.setOutput({ volume: 80, muted: false }),
    plugin.player.setOutput({ volume: 60, muted: false }),
    plugin.player.setOutput({ volume: 35, muted: false }),
  ]);
  assert.deepEqual(results, [true, false, true]);
  assert.deepEqual(
    host.sent("playback.set").map((p) => [p.property, p.value]),
    [
      ["volume", 80],
      ["muted", false],
      ["volume", 35],
      ["muted", false],
    ],
  );
  await stop();
});

test("media.close leaves a newer source alone", async () => {
  const { host, plugin, stop } = await start();
  const media = await plugin.player.open("/movie.mp4");
  host.openElsewhere("/newer.mp4");
  await media.close();
  assert.equal(host.source.source, "/newer.mp4");
  const mine = await plugin.player.open("/mine.mp4");
  await mine.close();
  assert.equal(host.source.phase, "empty");
  await stop();
});

test("aborting ready() closes the media", async () => {
  const { host, plugin, stop } = await start();
  const media = await plugin.player.open("/slow.mp4");
  const controller = new AbortController();
  const ready = media.ready({ signal: controller.signal });
  controller.abort();
  await assert.rejects(ready, { name: "AbortError" });
  await host.settle();
  assert.equal(host.source.phase, "empty");
  await stop();
});

test("streams preroll, activate through the start control and stop cleanly", async () => {
  const { host, plugin, stop } = await startPlugin(() => {}, {
    capabilities: [...capabilities, "producer.av"],
  });
  let frames = 0;
  const stream = await plugin.player.openStream({
    width: 2,
    height: 2,
    frame: () => {
      frames++;
      return { video: new Uint8Array(16), audio: new Float32Array(1600) };
    },
  });
  assert.equal(stream.running, true);
  assert.equal(host.source.kind, "producer");
  const producer = [...host.producers.values()][0]!;
  assert.ok(
    producer.receivedFrames >= 2048,
    "audio preroll precedes selection",
  );
  await host.settle(30);
  assert.ok(frames > 3, "the pump keeps rendering while playing");
  await stream.stop();
  assert.equal(host.source.phase, "empty");
  assert.equal(producer.released, true);
  await stop();
});

/** The next open is accepted but stays pending (a URL still resolving) until `finish`. */
function pendingOpen(host: TestHost) {
  let outcome: unknown = null;
  host.handle("source.submit", async (params) => {
    host.reset("source.submit");
    const done = (await host.request("source.submit", params)) as {
      ticket: unknown;
    };
    host.handle(
      "source.operation",
      () => outcome ?? { status: "pending", ticket: done.ticket },
    );
    return { status: "pending", ticket: done.ticket };
  });
  return (error: unknown) => (outcome = { status: "failed", error });
}

test("an accepted open superseded by another source rejects with replaced", async () => {
  const { host, plugin, stop } = await start();
  const finish = pendingOpen(host);
  const opening = plugin.player.open("https://example.com/v");
  await host.settle(50);
  host.openElsewhere("/other.mp4");
  finish({ backend: "source resolution cancelled, expired or superseded" });
  await assert.rejects(
    opening,
    (error: HostError) => error.code === "replaced",
  );
  await stop();
});

test("an accepted open that fails on its own keeps the backend code", async () => {
  const { host, plugin, stop } = await start();
  const finish = pendingOpen(host);
  const opening = plugin.player.open("https://example.com/v");
  await host.settle(50);
  finish({ backend: "extraction failed" });
  await assert.rejects(
    opening,
    (error: HostError) =>
      error.code === "backend" && error.message === "extraction failed",
  );
  await stop();
});

test("aborting a stream before the host answered its selection still closes it", async () => {
  const { host, plugin, stop } = await startPlugin(() => {}, {
    capabilities: [...capabilities, "producer.av"],
  });
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let reached = false;
  host.handle("source.submit", async (params) => {
    host.reset("source.submit");
    reached = true;
    await held; // the selecting request is not answered yet
    return host.request("source.submit", params);
  });
  const controller = new AbortController();
  const opening = plugin.player.openStream({
    width: 2,
    height: 2,
    signal: controller.signal,
    frame: () => ({ video: new Uint8Array(16), audio: new Float32Array(1600) }),
  });
  while (!reached) await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await new Promise((resolve) => setTimeout(resolve, 30));
  release();
  await assert.rejects(opening, { name: "AbortError" });
  await host.settle();
  assert.deepEqual(
    host.sent("source.submit").map((p) => (p.intent as { kind: string }).kind),
    ["openProvider", "openProvider", "close"], // the held call, its forward, then the close
  );
  assert.equal(host.source.phase, "empty");
  assert.equal([...host.producers.values()][0]!.released, true);
  await stop();
});

test("stream start-up timeouts name their stage", async () => {
  const { host, plugin, stop } = await startPlugin(() => {}, {
    capabilities: [...capabilities, "producer.av"],
  });
  // The first buffers never arrive.
  host.handle("producer.state", () => ({
    error: null,
    epoch: 1,
    health: "ok",
    acknowledged: false,
    receivedFrames: 0,
    hasVideo: false,
  }));
  const realNow = Date.now;
  const start = realNow();
  let calls = 0;
  Date.now = () => (++calls > 3 ? start + 20_000 : start); // jump past the 10 s deadline
  try {
    await assert.rejects(
      plugin.player.openStream({
        width: 2,
        height: 2,
        frame: () => ({
          video: new Uint8Array(16),
          audio: new Float32Array(1600),
        }),
      }),
      (error: HostError & { stage?: string }) =>
        error.code === "timeout" && error.stage === "prefill",
    );
  } finally {
    Date.now = realNow;
  }
  await stop();
});
