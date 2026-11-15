// The discrete source events (player 0.10.0, events-and-triggers.md §4.6):
// `source.opening`, `source.ready`, `source.ended`. The derivation's cases
// are the player's own (src/host/src/source_events.rs tests); then what a
// plugin gets through the test host: the order for open, replace, failure,
// stop and natural end, `state` as a PlayerState, delivery without
// `subscribe()`, no reason to keep running, a woken plugin's first event,
// and `reason: "quit"` at a quit.
import assert from "node:assert/strict";
import test from "node:test";
import { TestHost, startPlugin } from "../src/plugin/testing.ts";
import type { Plugin, PlayerState } from "../src/plugin/index.ts";
import type { SourceState } from "../src/source.ts";
import { initialSource } from "../src/plugin/testing/media.ts";
import {
  quitEvent,
  sourceEvents,
} from "../src/plugin/testing/source-events.ts";
import { WAKE_EVENTS } from "../src/plugin/connection.ts";

/** A wire snapshot: source id, cycle, phase, position. */
function state(
  id: number,
  cycle: number,
  phase: SourceState["phase"],
  position: number | null = null,
  terminalReason: SourceState["terminalReason"] = null,
): SourceState {
  return {
    ...initialSource(),
    stamp: { generation: id, intentVersion: id + cycle },
    cycle,
    phase,
    source: phase === "empty" ? null : `/m/${id}.mkv`,
    position,
    terminalReason,
  };
}

/** What a run of snapshots derives: name, source id, ended's reason. */
function run(states: SourceState[]) {
  let previous = initialSource();
  const out: string[] = [];
  for (const next of states) {
    for (const [name, data] of sourceEvents(previous, next)) {
      const d = data as { state: SourceState; reason?: string };
      const id = d.state.stamp.generation;
      out.push(
        name === "source.ended"
          ? `ended ${id} ${d.reason}`
          : `${name.slice("source.".length)} ${id}`,
      );
    }
    previous = next;
  }
  return out;
}

test("derivation: open, then a natural end at its last position", () => {
  const end = state(1, 1, "ended", 60, "natural");
  assert.deepEqual(
    run([
      state(1, 1, "loading"),
      state(1, 1, "ready", 0),
      state(1, 1, "ready", 30),
      end,
    ]),
    ["opening 1", "ready 1", "ended 1 natural"],
  );
  const [[, data]] = sourceEvents(state(1, 1, "ready", 59.9), end);
  assert.equal((data as { state: SourceState }).state.position, 60);
});

test("derivation: a replaced source ends before the next one opens", () => {
  const events = sourceEvents(
    state(1, 1, "ready", 42.5),
    state(2, 2, "loading"),
  );
  assert.deepEqual(
    events.map(([name]) => name),
    ["source.ended", "source.opening"],
  );
  const ended = events[0]![1] as { state: SourceState; reason: string };
  assert.equal(ended.reason, "replaced");
  assert.equal(ended.state.position, 42.5);
  assert.equal(ended.state.stamp.generation, 1);
  assert.deepEqual((events[1]![1] as { previous: unknown }).previous, {
    sourceId: 1,
  });
  assert.deepEqual(
    run([
      state(1, 1, "loading"),
      state(1, 1, "ready", 1),
      state(2, 2, "loading"),
      state(2, 2, "ready", 0),
    ]),
    ["opening 1", "ready 1", "ended 1 replaced", "opening 2", "ready 2"],
  );
});

test("derivation: a failure ends with its text and no ready", () => {
  const failed = state(1, 1, "error", null, { failed: "no such file" });
  assert.deepEqual(run([state(1, 1, "loading"), failed]), [
    "opening 1",
    "ended 1 error",
  ]);
  const [[, data]] = sourceEvents(state(1, 1, "loading"), failed);
  assert.equal((data as { error: string }).error, "no such file");
  assert.deepEqual(run([failed]), ["opening 1", "ended 1 error"]);
});

test("derivation: a stop ends with the last state", () => {
  const closed = state(1, 1, "empty", null, "stopped");
  const events = sourceEvents(state(1, 1, "ready", 12), closed);
  assert.equal(events.length, 1);
  const ended = events[0]![1] as { state: SourceState; reason: string };
  assert.equal(ended.reason, "stopped");
  assert.equal(ended.state.position, 12);
  assert.equal(ended.state.phase, "ready");
  assert.deepEqual(
    sourceEvents(state(1, 1, "ended", 60, "natural"), closed),
    [],
  );
  assert.deepEqual(sourceEvents(closed, state(1, 1, "empty")), []);
});

test("derivation: loaded before the first state is filled in", () => {
  assert.deepEqual(run([state(1, 1, "ready", 0)]), ["opening 1", "ready 1"]);
  assert.deepEqual(run([state(1, 1, "ready", 5), state(2, 2, "ready", 0)]), [
    "opening 1",
    "ready 1",
    "ended 1 replaced",
    "opening 2",
    "ready 2",
  ]);
  assert.deepEqual(
    run([state(1, 1, "loading"), state(1, 1, "ended", 0.5, "natural")]),
    ["opening 1", "ready 1", "ended 1 natural"],
  );
});

test("derivation: a seek from the end plays on and ends again; a restart opens again", () => {
  assert.deepEqual(
    run([
      state(1, 1, "loading"),
      state(1, 1, "ready", 0),
      state(1, 1, "ended", 60, "natural"),
      state(1, 2, "ready", 10),
      state(2, 3, "loading"),
    ]),
    [
      "opening 1",
      "ready 1",
      "ended 1 natural",
      "ended 1 replaced",
      "opening 2",
    ],
  );
  assert.deepEqual(
    run([
      state(1, 1, "loading"),
      state(1, 1, "ready", 30),
      state(1, 2, "loading"),
      state(1, 2, "ready", 0),
    ]),
    ["opening 1", "ready 1", "ended 1 replaced", "opening 1", "ready 1"],
  );
  // The test host's restart goes to ready at once: it says it reloads.
  assert.deepEqual(
    sourceEvents(
      state(1, 1, "ended", 60, "natural"),
      state(1, 2, "ready", 0),
      true,
    ).map(([name]) => name),
    ["source.opening", "source.ready"],
  );
});

test("derivation: repeated states and position changes are no events; quit only in playback", () => {
  for (const phase of ["empty", "loading", "ready", "ended", "error"] as const)
    assert.deepEqual(
      sourceEvents(state(1, 1, phase, 1), state(1, 1, phase, 1)),
      [],
    );
  assert.deepEqual(
    sourceEvents(state(1, 1, "ready", 1), state(1, 1, "ready", 2)),
    [],
  );
  assert.equal(quitEvent(state(1, 1, "ready", 7))?.reason, "quit");
  assert.ok(quitEvent(state(1, 1, "loading")));
  assert.equal(quitEvent(state(1, 1, "ended", 9, "natural")), null);
  assert.equal(quitEvent(state(1, 1, "error")), null);
  assert.equal(quitEvent(initialSource()), null);
});

/** A plugin that logs the three events (no `subscribe()`, no `read()`). */
function listening(log: string[], states: PlayerState[] = []) {
  return (plugin: Plugin) => {
    plugin.player.on("source.opening", ({ state, previous }) => {
      states.push(state);
      log.push(`opening ${state.sourceId} after ${previous?.sourceId ?? "-"}`);
    });
    plugin.player.on("source.ready", ({ state }) => {
      states.push(state);
      log.push(`ready ${state.sourceId} ${state.duration}`);
    });
    plugin.player.on("source.ended", ({ state, reason, error }) => {
      states.push(state);
      log.push(
        `ended ${state.sourceId} ${reason} at ${state.position}${error ? ` (${error})` : ""}`,
      );
    });
  };
}

test("a plugin hears opening → ready → ended for open, replace, failure, stop and natural end", async () => {
  const log: string[] = [];
  const { host, plugin, stop } = await startPlugin(listening(log));
  try {
    // Open.
    host.openElsewhere("/a.mkv", "loading");
    host.setSource({ phase: "ready", duration: 60, position: 0 });
    host.setSource({ position: 42 });
    // Replace.
    host.openElsewhere("/b.mkv");
    // A failure.
    host.openElsewhere("/c.mkv", "loading");
    host.setSource({ phase: "error", terminalReason: { failed: "bad file" } });
    // Stop (the plugin closes it).
    host.openElsewhere("/d.mkv");
    host.setSource({ duration: 30, position: 7 });
    await host.settle();
    await plugin.player.close();
    // Natural end.
    host.openElsewhere("/e.mkv");
    host.setSource({ duration: 10, position: 9.5 });
    host.setSource({ phase: "ended", terminalReason: "natural", position: 10 });
    await host.settle();
    assert.deepEqual(log, [
      "opening 1 after -",
      "ready 1 60",
      "ended 1 replaced at 42",
      "opening 2 after 1",
      "ready 2 null",
      "ended 2 replaced at null",
      "opening 3 after 2",
      "ended 3 error at null (bad file)",
      "opening 4 after 3",
      "ready 4 null",
      "ended 4 stopped at 7",
      "opening 5 after -",
      "ready 5 null",
      "ended 5 natural at 10",
    ]);
  } finally {
    await stop();
  }
});

test("the three events wake a plugin: they keep nothing running and need no subscribe()", async () => {
  for (const event of ["source.opening", "source.ready", "source.ended"])
    assert.ok(WAKE_EVENTS.includes(event), event);
  const log: string[] = [];
  const { host, stop } = await startPlugin(listening(log));
  try {
    for (const event of ["source.opening", "source.ready", "source.ended"])
      assert.ok(host.listening.has(event), event);
    assert.deepEqual(host.keepsRunning, []);
    assert.ok(!host.subscriptions.has("source.state"));
  } finally {
    await stop();
  }
});

for (const event of [
  "source.opening",
  "source.ready",
  "source.ended",
] as const) {
  test(`a plugin woken by ${event} gets it after its activation, with a PlayerState it can act on`, async () => {
    // The player's source changed while the plugin stood by; at its
    // ready the held event is delivered (the backlog), before any read.
    const host = new TestHost();
    host.openElsewhere("/lecture.mkv", "loading");
    host.setSource({ phase: "ready", duration: 120, position: 3 });
    const ready = structuredClone(host.source);
    const log: string[] = [];
    const states: PlayerState[] = [];
    const { plugin, stop } = await startPlugin(listening(log, states), {
      host,
    });
    try {
      assert.equal(plugin.player.state.phase, "empty", "nothing read yet");
      const data =
        event === "source.ended"
          ? { state: ready, reason: "stopped" }
          : event === "source.opening"
            ? { state: ready, previous: null }
            : { state: ready };
      host.emit(event, data);
      await host.settle();
      assert.equal(log.length, 1, log.join("; "));
      const [state] = states;
      assert.equal(state!.sourceId, 1);
      assert.equal(state!.phase, "ready");
      assert.equal((state as unknown as { stamp?: unknown }).stamp, undefined);
      if (event === "source.ended") {
        // The ended source's state is not the player's current one.
        assert.equal(plugin.player.state.phase, "empty");
      } else {
        // The plugin's state took the event's: it can act on it at once.
        assert.equal(plugin.player.state.sourceId, 1);
        assert.ok(plugin.player.isCurrent(state!));
        await plugin.player.seek(60, { ifCurrent: state });
        assert.equal(host.source.position, 60);
      }
    } finally {
      await stop();
    }
  });
}

test("the player quits: a running plugin hears source.ended with reason quit, only for a source in playback", async () => {
  for (const playing of [true, false]) {
    const log: string[] = [];
    const host = new TestHost();
    const { stop } = await startPlugin(listening(log), { host });
    if (playing) {
      host.openElsewhere("/a.mkv");
      host.setSource({ duration: 60, position: 25 });
    }
    await host.settle();
    log.length = 0;
    await stop({ reason: "quit" });
    assert.deepEqual(log, playing ? ["ended 1 quit at 25"] : []);
  }
  // Any other stop sends nothing.
  const log: string[] = [];
  const host = new TestHost();
  const { stop } = await startPlugin(listening(log), { host });
  host.openElsewhere("/a.mkv");
  await host.settle();
  log.length = 0;
  await stop({ reason: "disable" });
  assert.deepEqual(log, []);
});

test("a subscribed plugin reads the new state first, then the event", async () => {
  const seen: string[] = [];
  const { host, stop } = await startPlugin((plugin) => {
    plugin.player.subscribe();
    plugin.player.onChange((s) => seen.push(`state ${s.phase}`));
    plugin.player.on("source.ready", () =>
      seen.push(`ready (state ${plugin.player.state.phase})`),
    );
  });
  try {
    host.openElsewhere("/a.mkv", "loading");
    await host.settle();
    seen.length = 0;
    host.setSource({ phase: "ready", duration: 5 });
    await host.settle();
    assert.deepEqual(seen, ["state ready", "ready (state ready)"]);
  } finally {
    await stop();
  }
});
