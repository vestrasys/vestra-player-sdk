// SDK 1.11.3: a call that acts on the current state (a control, a step, a
// capture, a scrub) without `ifCurrent` reads the state first when nothing
// holds `source.state`, so a plugin that read the state once and keeps no
// stream is not refused with `stale` after someone else's intent.
import assert from "node:assert/strict";
import test from "node:test";
import { HostError, TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { PlayerState, Plugin } from "../src/plugin/index.ts";

const capabilities = [
  "playback.read",
  "playback.control",
  "events",
  "media.read",
  "media.control",
];

/**
 * A plugin that read the state once in `activate` and keeps no stream; the
 * user then paused (an admitted intent), so its copy is stale.
 */
async function staleCopy(activate: (plugin: Plugin) => unknown = () => {}) {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  host.setSource({ duration: 60 });
  let seen: PlayerState | undefined;
  const started = await startPlugin(
    (plugin) => {
      seen = plugin.player.state;
      return activate(plugin);
    },
    { capabilities, host },
  );
  await host.coreAction("play-pause").run();
  await host.settle();
  assert.equal(host.source.paused, true, "an admitted intent the copy missed");
  return { ...started, host, seen: seen! };
}

/** The methods sent from `mark` on, the polls left out. */
const methods = (host: TestHost, mark: number) =>
  host.calls.slice(mark).map((call) => call.method);

const stamp = (host: TestHost) => ({
  generation: host.source.stamp.generation,
  intentVersion: host.source.stamp.intentVersion,
});

test("no stream: a control reads the state first and sends the fresh stamp", async () => {
  const { host, plugin, stop } = await staleCopy();
  const mark = host.calls.length;
  const fresh = stamp(host);
  await plugin.player.setRate(1.5);
  assert.equal(host.source.rate, 1.5);
  const sent = methods(host, mark);
  assert.deepEqual(sent.slice(0, 2), ["source.state", "source.submit"]);
  assert.deepEqual(
    (host.sent("source.submit").at(-1)!.intent as { expected?: unknown })
      .expected,
    fresh,
  );
  await stop();
});

test("no stream: a step reads the state first", async () => {
  const { host, plugin, stop } = await staleCopy();
  await plugin.player.step("keyframe", "forward");
  assert.deepEqual(host.steps.at(-1), {
    unit: "keyframe",
    direction: "forward",
  });
  await stop();
});

test("a stream: the copy follows the player, no read before a control", async () => {
  const { host, plugin, stop } = await staleCopy((plugin) => {
    plugin.player.stream(() => {});
  });
  const mark = host.calls.length;
  await plugin.player.setRate(1.5);
  assert.equal(host.source.rate, 1.5);
  assert.equal(methods(host, mark)[0], "source.submit");
  await stop();
});

test("an explicit ifCurrent is sent as given, without a read", async () => {
  const { host, plugin, seen, stop } = await staleCopy();
  const mark = host.calls.length;
  await assert.rejects(
    plugin.player.setRate(1.5, { ifCurrent: seen }),
    (error: HostError) => error.code === "stale",
  );
  assert.equal(methods(host, mark)[0], "source.submit");
  assert.equal(host.source.rate, 1);
  await stop();
});

test("a burst shares one read and goes out in the order it was made", async () => {
  const { host, plugin, stop } = await staleCopy();
  const mark = host.calls.length;
  const fresh = stamp(host);
  const results = await Promise.allSettled([
    plugin.player.setRate(1.5),
    plugin.player.seek(10),
    plugin.player.setPaused(false),
  ]);
  const sent = methods(host, mark);
  const submits = sent.flatMap((method, index) =>
    method === "source.submit" ? [index] : [],
  );
  assert.equal(
    sent.slice(0, submits[0]).filter((m) => m === "source.state").length,
    1,
    "one read before the first control",
  );
  const controls = host
    .sent("source.submit")
    .slice(-3)
    .map(({ intent }) => {
      assert.deepEqual(
        (intent as { expected?: unknown }).expected,
        fresh,
        "the read's stamp, each",
      );
      return (intent as { control: { kind: string } }).control.kind;
    });
  assert.deepEqual(controls, ["rate", "seek", "pause"]);
  // As with a copy that follows the player: the first is admitted, and the
  // others carried the stamp it replaced.
  assert.equal(results[0].status, "fulfilled");
  assert.equal(host.source.rate, 1.5);
  await stop();
});

test("a source change between the read and the control is still refused", async () => {
  const { host, plugin, stop } = await staleCopy();
  host.handle("source.state", () => {
    const read = JSON.parse(JSON.stringify(host.source)) as typeof host.source;
    host.reset("source.state");
    host.openElsewhere("/other.mp4"); // after the read, before the control
    return read;
  });
  await assert.rejects(
    plugin.player.setRate(1.5),
    (error: HostError) => error.code === "stale",
  );
  assert.equal(host.source.source, "/other.mp4");
  assert.equal(host.source.rate, 1);
  await stop();
});

test("no stream: a capture reads the state first", async () => {
  const { host, plugin, stop } = await staleCopy();
  const mark = host.calls.length;
  const fresh = stamp(host);
  const shot = await plugin.media.capture();
  const sent = host.calls.slice(mark);
  assert.equal(sent[0]!.method, "source.state");
  const capture = sent.find((call) => call.params?.expected !== undefined);
  assert.deepEqual(capture?.params.expected, fresh);
  await shot.dispose();
  await stop();
});

test("no stream: a scrub starts from the state read now", async () => {
  const { host, plugin, stop } = await staleCopy();
  const mark = host.calls.length;
  const scrub = plugin.player.scrub();
  assert.equal(await scrub.seek(10), true);
  assert.equal(host.source.position, 10);
  assert.equal(methods(host, mark)[0], "source.state");
  scrub.end();
  await stop();
});

test("a stream: a scrub starts from the copy, without a read", async () => {
  const { host, plugin, stop } = await staleCopy((plugin) => {
    plugin.player.stream(() => {});
  });
  const mark = host.calls.length;
  const scrub = plugin.player.scrub();
  assert.equal(await scrub.seek(10), true);
  assert.equal(host.source.position, 10);
  assert.deepEqual(
    methods(host, mark).filter((m) => m !== "events.listen")[0],
    "source.submit",
  );
  scrub.end();
  await stop();
});

/** The kinds of the submits sent from `mark` on, in order. */
const submitted = (host: TestHost, mark: number) =>
  host.calls
    .slice(mark)
    .filter((call) => call.method === "source.submit")
    .map(({ params }) => {
      const intent = params.intent as {
        kind: string;
        control?: { kind: string };
      };
      return intent.control?.kind ?? intent.kind;
    });

for (const live of [false, true]) {
  const how = live ? "a stream" : "no stream";
  const plugin = (activate: Plugin) => {
    if (live) activate.player.stream(() => {});
  };

  test(`${how}: a default control and an ifCurrent one go out in issue order`, async () => {
    const { host, plugin: p, stop } = await staleCopy(plugin);
    const mark = host.calls.length;
    const pinned = p.player.state;
    await Promise.allSettled([
      p.player.setPaused(false),
      p.player.seek(5, { ifCurrent: pinned }),
      p.player.setRate(2),
    ]);
    assert.deepEqual(submitted(host, mark), ["pause", "seek", "rate"]);
    await stop();
  });

  test(`${how}: a default control and then open() go out in issue order`, async () => {
    const { host, plugin: p, stop } = await staleCopy(plugin);
    const mark = host.calls.length;
    await Promise.allSettled([
      p.player.setPaused(false),
      p.player.open("/next.mp4"),
    ]);
    assert.deepEqual(submitted(host, mark), ["pause", "open"]);
    assert.equal(host.source.source, "/next.mp4");
    await stop();
  });
}

test("no stream: a subtitle call after a default control goes out after it", async () => {
  const { host, plugin, stop } = await staleCopy();
  const mark = host.calls.length;
  await Promise.allSettled([
    plugin.player.setPaused(false),
    plugin.subtitles.select(null),
  ]);
  const sent = methods(host, mark);
  const pause = sent.indexOf("source.submit");
  const subtitle = sent.findIndex((method) => method.startsWith("subtitles."));
  assert.ok(pause >= 0 && subtitle >= 0, sent.join(", "));
  assert.ok(pause < subtitle, sent.join(", "));
  await stop();
});
