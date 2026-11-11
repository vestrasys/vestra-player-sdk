// The plugin's request queue (`src/request-queue.ts`): at most 256 requests
// and 3 MiB in flight per plugin, the rest wait in order; a waiting request
// can be aborted; stopping rejects what waits; replies to the player's own
// calls never wait. Both on a bare transport and through TestHost.
import assert from "node:assert/strict";
import test from "node:test";
import { HostError } from "../src/wire.ts";
import type { Json, Transport } from "../src/wire.ts";
import {
  REQUEST_LIMITS,
  RequestQueue,
  UNQUEUED_METHODS,
} from "../src/request-queue.ts";
import { MESSAGE_LIMIT } from "../src/capabilities.ts";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { PluginError } from "../src/plugin/types.ts";

/** A transport whose replies the test gives, one by one. */
function manual() {
  const sent: { method: string; params: Json | undefined }[] = [];
  const open = new Map<number, (value: unknown) => void>();
  const failers = new Map<number, (error: Error) => void>();
  let inFlight = 0;
  let peak = 0;
  const transport: Transport = {
    request<T>(method: string, params?: Json) {
      const n = sent.length;
      sent.push({ method, params });
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise<T>((resolve, reject) => {
        open.set(n, (value) => {
          inFlight--;
          resolve(value as T);
        });
        failers.set(n, (error) => {
          inFlight--;
          reject(error);
        });
      });
    },
    on: () => () => {},
  };
  return {
    transport,
    sent,
    open,
    get inFlight() {
      return inFlight;
    },
    get peak() {
      return peak;
    },
    answer(n: number, value: unknown = n) {
      const reply = open.get(n);
      assert.ok(reply, `request ${n} is in flight`);
      open.delete(n);
      failers.delete(n);
      reply(value);
    },
    failAll(error: Error) {
      for (const [n, fail] of failers) {
        open.delete(n);
        failers.delete(n);
        fail(error);
      }
    },
  };
}

const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("REQUEST_LIMITS: 256 requests and 3 MiB, under the player's 320 lines and 4 MiB", () => {
  assert.deepEqual(
    { ...REQUEST_LIMITS },
    {
      inFlight: 256,
      inFlightBytes: 3 * 1024 * 1024,
    },
  );
  assert.ok(Object.isFrozen(REQUEST_LIMITS));
  assert.ok(REQUEST_LIMITS.inFlight < 320);
  // The byte cap plus one reply of the longest line stays under 4 MiB.
  assert.ok(REQUEST_LIMITS.inFlightBytes + MESSAGE_LIMIT <= 4 * 1024 * 1024);
});

test("request queue: a flood of 10,000 completes in order with at most 256 in flight", async () => {
  const wire = manual();
  const queue = new RequestQueue(wire.transport);
  const results: number[] = [];
  const all = Array.from({ length: 10_000 }, (_, i) =>
    queue
      .request<number>("clipboard.writeText", { text: String(i) })
      .then((value) => void results.push(value)),
  );
  assert.equal(wire.sent.length, 256, "the first 256 go out at once");
  assert.equal(queue.waiting, 10_000 - 256);
  // Answer out of order: the newest in flight first, then the rest.
  let answered = 0;
  while (answered < 10_000) {
    const open = [...wire.open.keys()];
    for (const n of open.reverse()) {
      wire.answer(n);
      answered++;
    }
    await turn();
    assert.ok(wire.inFlight <= 256);
  }
  await Promise.all(all);
  assert.equal(wire.peak, 256);
  assert.equal(queue.peak, 256);
  assert.equal(wire.sent.length, 10_000);
  assert.deepEqual(
    wire.sent.map((line) => (line.params as { text: string }).text),
    Array.from({ length: 10_000 }, (_, i) => String(i)),
    "sent in the order made",
  );
  assert.equal(results.length, 10_000);
  assert.deepEqual(queue.inFlight, { requests: 0, bytes: 0 });
  assert.equal(queue.waiting, 0);
});

test("request queue: at most 3 MiB in flight; a line longer than the rest still goes out alone", async () => {
  const wire = manual();
  const queue = new RequestQueue(wire.transport);
  const big = "x".repeat(700 * 1024);
  const all = Array.from({ length: 12 }, (_, i) =>
    queue.request("storage.session.set", { key: String(i), value: big }),
  );
  // 700 KiB each: four fit under 3 MiB, the fifth waits.
  assert.equal(wire.sent.length, 4);
  assert.ok(queue.inFlight.bytes <= REQUEST_LIMITS.inFlightBytes);
  while (wire.open.size) {
    wire.answer(Math.min(...wire.open.keys()));
    await turn();
    assert.ok(queue.inFlight.bytes <= REQUEST_LIMITS.inFlightBytes);
  }
  await Promise.all(all);
  assert.equal(wire.sent.length, 12);
  assert.equal(wire.peak, 4);

  // A limit below one line: the line goes out when nothing else is in flight.
  const small = new RequestQueue(manual().transport, {
    inFlight: 256,
    inFlightBytes: 1024,
  });
  void small.request("x", { value: "y".repeat(4096) });
  assert.equal(small.inFlight.requests, 1);
});

test("request queue: a line over MESSAGE_LIMIT is refused at once, not queued", async () => {
  const wire = manual();
  const queue = new RequestQueue(wire.transport, {
    inFlight: 1,
    inFlightBytes: REQUEST_LIMITS.inFlightBytes,
  });
  void queue.request("a");
  // The transport (the runner) refuses it; here it only records it went
  // straight there, past the full queue.
  void queue.request("b", { text: "x".repeat(MESSAGE_LIMIT) });
  assert.deepEqual(
    wire.sent.map((line) => line.method),
    ["a", "b"],
  );
  assert.equal(queue.waiting, 0);
});

test("request queue: aborting a waiting request drops it unsent; the rest keep their order", async () => {
  const wire = manual();
  const queue = new RequestQueue(wire.transport, {
    inFlight: 1,
    inFlightBytes: REQUEST_LIMITS.inFlightBytes,
  });
  const first = queue.request("first");
  const controller = new AbortController();
  const dropped = queue.request("dropped", {}, { signal: controller.signal });
  const third = queue.request("third");
  controller.abort();
  await assert.rejects(dropped, (error: PluginError) => {
    assert.equal(error.name, "AbortError");
    assert.equal(error.code, "aborted");
    return true;
  });
  assert.equal(queue.waiting, 1);
  wire.answer(0);
  await first;
  wire.answer(1);
  await third;
  assert.deepEqual(
    wire.sent.map((line) => line.method),
    ["first", "third"],
  );
  // Already aborted: refused, never sent.
  await assert.rejects(
    queue.request("late", {}, { signal: AbortSignal.abort() }),
    { name: "AbortError" },
  );
  // Aborted after it went out: it runs to its answer.
  const sentController = new AbortController();
  const running = queue.request(
    "running",
    {},
    { signal: sentController.signal },
  );
  sentController.abort();
  wire.answer(2, "done");
  assert.equal(await running, "done");
});

test("request queue: close rejects every waiting request as the runner rejects those in flight", async () => {
  const wire = manual();
  const queue = new RequestQueue(wire.transport);
  const all = Array.from({ length: 1000 }, (_, i) =>
    queue.request("clipboard.writeText", { text: String(i) }).then(
      () => "ok",
      (error: HostError) => `${error.code}: ${error.message}`,
    ),
  );
  assert.equal(queue.waiting, 1000 - 256);
  // The runner rejects what is in flight, then the SDK's dispose closes
  // the queue, in the same turn.
  wire.failAll(new HostError("disabled", "plugin stopped"));
  queue.close();
  const outcomes = await Promise.all(all);
  assert.ok(outcomes.every((line) => line === "disabled: plugin stopped"));
  assert.equal(wire.sent.length, 256, "nothing that waited went out");
  // A cleanup's request goes to the transport as it comes.
  void queue.request("clipboard.writeText", { text: "cleanup" });
  assert.equal(wire.sent.length, 257);
});

test("request queue: replies to the player's own calls never wait", async () => {
  const wire = manual();
  const queue = new RequestQueue(wire.transport, {
    inFlight: 2,
    inFlightBytes: REQUEST_LIMITS.inFlightBytes,
  });
  void queue.request("source.submit");
  void queue.request("source.state");
  void queue.request("source.state");
  assert.equal(queue.waiting, 1);
  for (const method of UNQUEUED_METHODS) void queue.request(method, {});
  assert.deepEqual(
    wire.sent.map((line) => line.method),
    ["source.submit", "source.state", ...UNQUEUED_METHODS],
  );
  assert.deepEqual([...UNQUEUED_METHODS].sort(), [
    "palette.lead.done",
    "producer.ack",
    "producer.ackInput",
    "sourceResolvers.respond",
  ]);
});

/** A plugin under TestHost whose `clipboard.writeText` replies the test holds. */
async function held(capabilities: string[] = ["clipboard"]) {
  const host = new TestHost();
  const waiting: (() => void)[] = [];
  let inFlight = 0;
  let peak = 0;
  host.handle("clipboard.writeText", () => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise<void>((resolve) =>
      waiting.push(() => {
        inFlight--;
        resolve();
      }),
    );
  });
  let plugin!: Plugin;
  const started = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities, host },
  );
  return {
    ...started,
    plugin,
    waiting,
    get peak() {
      return peak;
    },
  };
}

test("TestHost: the plugin's flood reaches the host 256 at a time, in order", async () => {
  const run = await held();
  const all = Array.from({ length: 10_000 }, (_, i) =>
    run.plugin.wire.request("clipboard.writeText", { text: String(i) }),
  );
  // `settle` would wait for the held replies: turns of the event loop instead.
  for (let done = 0, idle = 0; done < 10_000 && idle < 1000;) {
    await turn();
    const now = run.waiting.splice(0);
    idle = now.length ? 0 : idle + 1;
    for (const reply of now) reply();
    done += now.length;
  }
  await Promise.all(all);
  assert.equal(run.peak, 256);
  const texts = run.host.calls
    .filter((call) => call.method === "clipboard.writeText")
    .map((call) => call.params.text);
  assert.deepEqual(
    texts,
    Array.from({ length: 10_000 }, (_, i) => String(i)),
  );
  await run.stop();
});

test("TestHost: stopping with a full queue rejects what waits with disabled", async () => {
  const run = await held();
  const all = Array.from({ length: 600 }, (_, i) =>
    run.plugin.wire.request("clipboard.writeText", { text: String(i) }).then(
      () => "ok",
      (error: PluginError) => error.code,
    ),
  );
  await turn();
  await turn();
  const stopped = run.stop();
  // The host answers what it holds; what waited never reaches it.
  for (const reply of run.waiting.splice(0)) reply();
  await stopped;
  const outcomes = await Promise.all(all);
  assert.equal(outcomes.filter((code) => code === "ok").length, 256);
  assert.equal(
    outcomes.filter((code) => code === "disabled").length,
    600 - 256,
  );
  assert.equal(
    run.host.calls.filter((call) => call.method === "clipboard.writeText")
      .length,
    256,
  );
});

test("TestHost: disconnect with a full queue rejects every request with disabled", async () => {
  const run = await held();
  const all = Array.from({ length: 400 }, (_, i) =>
    run.plugin.wire.request("clipboard.writeText", { text: String(i) }).then(
      () => "ok",
      (error: PluginError) => `${error.code}: ${error.message}`,
    ),
  );
  await turn();
  await turn();
  await run.disconnect();
  const outcomes = await Promise.all(all);
  assert.ok(outcomes.every((line) => line === "disabled: plugin stopped"));
});

test("TestHost: an open aborted while its submit waits is never sent", async () => {
  const run = await held(["clipboard", "playback.control"]);
  const flood = Array.from({ length: 256 }, (_, i) =>
    run.plugin.wire.request("clipboard.writeText", { text: String(i) }),
  );
  await turn();
  const controller = new AbortController();
  const opened = run.plugin.player.open("C:/media/a.mkv", {
    signal: controller.signal,
  });
  await turn();
  await turn();
  controller.abort();
  await assert.rejects(opened, { name: "AbortError", code: "aborted" });
  for (const reply of run.waiting.splice(0)) reply();
  await Promise.all(flood);
  await run.host.settle();
  assert.equal(
    run.host.calls.filter((call) => call.method === "source.submit").length,
    0,
    "the submit never reached the player",
  );
  await run.stop();
});
