// Stream pacing: the pump refills the whole audio lead in one pass, so a
// coarse timer (Windows: about 16 ms) or a slow `producer.state` round trip
// does not cap the frame rate at one frame per pump.
import assert from "node:assert/strict";
import test, { afterEach } from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Json, Stream } from "../src/plugin/index.ts";

const capabilities = [
  "playback.read",
  "playback.control",
  "events",
  "producer.av",
];
/** Stereo frames of audio per 1/60 s picture. */
const FRAME = 800;
const LEAD = 2400;
const sound = new Float32Array(FRAME * 2);
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/** Plugins still running: a failed assertion must not leave a stream pumping. */
const running = new Set<() => Promise<void>>();
afterEach(async () => {
  for (const stop of running) await stop();
});

/**
 * A test host whose audio device the test drives: `producer.state` reports
 * `consumed(sample)` as `consumedFrames`, where `sample` is the stream's
 * sample time (the start control's base plus the audio rendered since it was
 * acknowledged). `pumps` gets the number of frames rendered so far at every
 * `producer.state` call, `acks` the frame count at every acknowledgement.
 * `stateDelay` makes every `producer.state` round trip at least that long.
 */
function deviceHost(options: { stateDelay?: number; ackDelay?: number } = {}) {
  const host = new TestHost();
  const model = {
    frames: 0,
    base: 0,
    framesAtAck: 0,
    acking: false,
    /** Frames rendered while an acknowledgement was in flight. */
    overlaps: 0,
    pumps: [] as number[],
    acks: [] as number[],
    /** `producer.state` calls so far. */
    calls: 0,
    /** Milliseconds from each `producer.state` answer to the next call. */
    gaps: [] as number[],
    answeredAt: undefined as number | undefined,
    consumed: (sample: number) => sample,
    get sample() {
      return model.base + (model.frames - model.framesAtAck) * FRAME;
    },
  };
  const forward = async (method: string, params: Json, self: unknown) => {
    host.reset(method);
    try {
      return (await host.request(method, params)) as Record<string, Json>;
    } finally {
      host.handle(method, self as never);
    }
  };
  const state = async (params: Record<string, Json>): Promise<unknown> => {
    if (model.answeredAt !== undefined)
      model.gaps.push(performance.now() - model.answeredAt);
    model.calls++;
    model.pumps.push(model.frames);
    if (options.stateDelay) await wait(options.stateDelay);
    const answer = await forward("producer.state", params, state);
    model.answeredAt = performance.now();
    return { ...answer, consumedFrames: model.consumed(model.sample) };
  };
  const ack = async (params: Record<string, Json>): Promise<unknown> => {
    model.acking = true;
    try {
      if (options.ackDelay) await wait(options.ackDelay);
      const control = params.control as { baseSample: number };
      model.base = control.baseSample;
      model.framesAtAck = model.frames;
      model.acks.push(model.frames);
      return await forward("producer.ack", params, ack);
    } finally {
      model.acking = false;
    }
  };
  host.handle("producer.state", state);
  host.handle("producer.ack", ack);
  return { host, model };
}

async function open(
  { host, model }: ReturnType<typeof deviceHost>,
  frame: (n: number) => void = () => {},
  audio: () => Float32Array = () => sound,
) {
  const started = await startPlugin(() => {}, { capabilities, host });
  const video = new Uint8Array(16);
  const stream = await started.plugin.player.openStream({
    width: 2,
    height: 2,
    frame: () => {
      if (model.acking) model.overlaps++;
      frame(++model.frames);
      return { video, audio: audio() };
    },
  });
  let stopping: Promise<void> | undefined;
  const stop = () => {
    running.delete(stop);
    return (stopping ??= stream.stop().then(started.stop));
  };
  running.add(stop);
  return { ...started, stream, stop };
}

type Model = ReturnType<typeof deviceHost>["model"];

/** Wait until `done()`, polling; fails after 5 s. */
async function until(done: () => boolean, what: string) {
  for (const deadline = Date.now() + 5000; !done(); await wait(1))
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
}

/**
 * Wait until `n` more `producer.state` calls started: the pumps before
 * the last of them have finished rendering.
 */
function pumps(model: Model, n: number) {
  const target = model.calls + n;
  return until(() => model.calls >= target, `${n} pumps`);
}

/**
 * Stop the device with a full lead, taken at the next pump (no frame is in
 * flight then). Resolves with that consumption once a pump has seen it.
 */
async function hold(model: Model) {
  let held: number | undefined;
  model.consumed = (sample) => (held ??= sample - LEAD);
  await until(() => held !== undefined, "the device to hold");
  return held!;
}

const median = (values: number[]) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Frames rendered by each pump, from the `pumps` snapshots. */
const perPump = (snapshots: number[]) =>
  snapshots.slice(1).map((frames, i) => frames - snapshots[i]!);

test("a pump refills the whole lead when the device consumed a lot since the last one", async () => {
  const device = deviceHost();
  const { stream, stop } = await open(device);
  const { model } = device;
  // Hold the device: the lead is full, nothing renders.
  await pumps(model, 2);
  const at = await hold(model);
  const before = model.frames;
  await pumps(model, 3);
  assert.equal(model.frames, before, "a full lead renders nothing");
  // The device consumed 50 ms between two pumps (a coarse timer): the next
  // pump renders all of it at once, not one frame.
  // From the last pump that may still be under way (it saw no frames yet).
  const from = model.pumps.length - 1;
  model.consumed = () => at + LEAD;
  await pumps(model, 3);
  assert.equal(model.frames - before, LEAD / FRAME);
  assert.equal(Math.max(...perPump(model.pumps.slice(from))), LEAD / FRAME);
  await stream.stop();
  await stop();
});

test("a device playing 40 ms between pumps is kept fed: one pump renders several frames", async () => {
  // Windows: a 15.6 ms timer tick plus a round trip, about 40 ms per pump,
  // while a frame lasts 1/60 s. The clock here is the pumps, not the wall
  // clock, so a loaded machine cannot change the result: each pump the device
  // plays 40 ms more, up to what it was sent. One frame per pump (the
  // defect) gives 24 frames a second and runs dry at once.
  const device = deviceHost();
  const { model } = device;
  const { stream, stop } = await open(device);
  const period = 1920; // 40 ms at 48 kHz
  let played: number | undefined;
  let dry = 0;
  let seen = 0;
  model.consumed = (sample) => {
    // The device starts with a full lead queued, as after a refill.
    played = played === undefined ? sample - LEAD : played + period;
    if (played > sample) dry++;
    seen++;
    return (played = Math.min(sample, played));
  };
  const frames = model.frames;
  try {
    await until(() => seen >= 40, "40 pumps");
    const perSecond = ((model.frames - frames) / seen) * 25;
    assert.equal(dry, 0, "the device never ran dry");
    assert.ok(
      perSecond >= 57,
      `${perSecond.toFixed(1)} frames per second of device time`,
    );
  } finally {
    await stream.stop();
    await stop();
  }
});

test("a control arriving during a refill is acknowledged at the next frame boundary", async () => {
  const device = deviceHost({ ackDelay: 15 });
  const { host, model } = device;
  let injectAt = 0;
  const { stream, stop } = await open(device, (n) => {
    if (n !== injectAt) return;
    // Mid-refill: the player issues a new control (a seek or an unpause).
    const producer = [...host.producers.values()][0]!;
    producer.acknowledged = false;
    producer.pending = {
      producerId: producer.id,
      epoch: producer.epoch + 1,
      baseSample: model.sample + 48000,
      paused: false,
    };
  });
  await pumps(model, 2);
  const acks = model.acks.length;
  // Hold the device, then free a whole lead: the next pump renders three
  // frames, and the control lands while the second one renders.
  const at = await hold(model);
  injectAt = model.frames + 2;
  model.consumed = () => at + LEAD;
  await until(() => model.acks.length > acks, "the acknowledgement");
  await pumps(model, 2);
  assert.equal(
    model.acks.length,
    acks + 1,
    "the control was acknowledged once",
  );
  assert.ok(
    model.acks.at(-1)! >= injectAt + 1,
    "the refill under way finished before the acknowledgement",
  );
  assert.equal(model.overlaps, 0, "no frame renders while acknowledging");
  // Rendering resumes on the new timeline (the device follows it).
  model.consumed = (sample) => sample;
  const after = model.frames;
  await until(() => model.frames > after, "frames after the control");
  await stream.stop();
  await stop();
});

test("stop during a refill renders no further frame", async () => {
  const device = deviceHost();
  const { model } = device;
  let stream: Stream | undefined;
  let stopAt = 0;
  let stopping: Promise<void> | undefined;
  const opened = await open(device, (n) => {
    if (n === stopAt) stopping = stream!.stop();
  });
  stream = opened.stream;
  await pumps(model, 2);
  const at = await hold(model);
  stopAt = model.frames + 1;
  model.consumed = () => at + LEAD;
  await until(() => stopping !== undefined, "the refill");
  await stopping;
  assert.equal(model.frames, stopAt, "the frame being rendered was the last");
  assert.equal(stream.running, false);
  await opened.stop();
});

test("frames without audio render at most one per pump", async () => {
  const device = deviceHost();
  const { model } = device;
  // A broken plugin: pictures without sound never move the clock, so the
  // lead never fills. Preroll needs audio: it goes silent once running.
  let silent = false;
  const { stream, stop } = await open(
    device,
    () => {},
    () => (silent ? new Float32Array(0) : sound),
  );
  await pumps(model, 2);
  silent = true;
  await pumps(model, 2);
  model.pumps.length = 0;
  await pumps(model, 10);
  const counts = perPump(model.pumps);
  assert.ok(counts.length > 0);
  assert.ok(
    counts.every((n) => n <= 1),
    `frames per pump: ${counts.join(" ")}`,
  );
  await stream.stop();
  await stop();
});

test("a pump that rendered nothing waits a period before the next, however slow its round trip", async () => {
  // Paused or with a full lead, a stream polls at the timer's rate, as before
  // 1.5.27, not back to back: the shared runner pays for every request.
  const device = deviceHost({ stateDelay: 8 });
  const { host, model } = device;
  const { stream, stop } = await open(device);
  await pumps(model, 2);
  await hold(model);
  await pumps(model, 1);
  model.gaps.length = 0;
  await pumps(model, 12);
  const full = median(model.gaps);
  assert.ok(full >= 4, `full lead: ${full.toFixed(1)} ms between pumps`);
  model.consumed = (sample) => sample;
  host.setSource({ paused: true });
  await pumps(model, 2);
  const frames = model.frames;
  model.gaps.length = 0;
  await pumps(model, 12);
  assert.equal(model.frames, frames, "nothing renders while paused");
  const paused = median(model.gaps);
  assert.ok(paused >= 4, `paused: ${paused.toFixed(1)} ms between pumps`);
  await stream.stop();
  await stop();
});

test("a pump that rendered and already took a period is followed at once", async () => {
  // Playing with a slow round trip: no timer tick on top (15.6 ms on Windows).
  const device = deviceHost({ stateDelay: 8 });
  const { model } = device;
  const { stream, stop } = await open(device);
  model.consumed = (sample) => sample; // every pump renders a whole lead
  await pumps(model, 2);
  model.gaps.length = 0;
  const frames = model.frames;
  await pumps(model, 12);
  assert.ok(model.frames - frames >= 11 * 3, "every pump rendered");
  const gap = median(model.gaps);
  assert.ok(gap < 4, `${gap.toFixed(1)} ms between pumps`);
  await stream.stop();
  await stop();
});
