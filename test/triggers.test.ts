// Triggers (1.10.0, events-and-triggers.md §3, §4.1–§4.3, §4.11): the
// `when` atoms, `plugin.trigger(name?)` with `firesOn`, `enter`, `leave` and
// `off`, and the test host's virtual clock, `park()` and `upgrade()`. The
// rules T1–T15 of §4.1 are named where a test covers them; the player's own
// tests cover them on the host (src/host/src/triggers_tests.rs).
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin, TriggerEvent } from "../src/plugin/index.ts";
import { WHEN, conditionJson, evaluateTruth } from "../src/plugin/when.ts";
import type { ConditionFacts, ConditionJson } from "../src/plugin/when.ts";
import { CONDITION_TABLE } from "../src/condition-table.ts";
import { TRIGGER_LIMITS } from "../src/plugin/triggers.ts";

const json = (condition: Parameters<typeof conditionJson>[0]) =>
  conditionJson(condition);
const sets = (host: TestHost) =>
  host.calls.filter((c) => c.method.startsWith("triggers."));

/** Records each call of a trigger's functions with what it got. */
function recorder() {
  const log: string[] = [];
  const fn =
    (edge: string) =>
    ({ state, range }: TriggerEvent) =>
      log.push(
        `${edge}${range ? ` ${range.index}` : ""} @${state.position ?? "-"}`,
      );
  return { log, enter: fn("enter"), leave: fn("leave") };
}

test("when: the 1.10.0 atoms and their wire forms", () => {
  assert.deepEqual(json(WHEN.muted), { muted: true });
  assert.deepEqual(json(WHEN.maximized), { maximized: true });
  assert.deepEqual(json(WHEN.pip), { pip: true });
  assert.deepEqual(json(WHEN.looping), { looping: true });
  assert.deepEqual(json(WHEN.duration({ min: 600 })), {
    duration: { min: 600 },
  });
  assert.deepEqual(json(WHEN.volume({ min: 10, max: 50 })), {
    volume: { min: 10, max: 50 },
  });
  assert.deepEqual(json(WHEN.rate({ max: 1 })), { rate: { max: 1 } });
  assert.deepEqual(json(WHEN.time({ min: 5 })), { time: { min: 5 } });
  assert.deepEqual(json(WHEN.audioTrack(2)), { audioTrack: 2 });
  assert.deepEqual(json(WHEN.subtitleTrack("embedded:3")), {
    subtitleTrack: "embedded:3",
  });
  assert.deepEqual(json(WHEN.audioDevice("auto")), { audioDevice: "auto" });
  // Any object with start and end; other fields ignored; a point is open.
  assert.deepEqual(
    json(
      WHEN.position.in(
        [{ start: 1, end: 2, style: "region" } as never, { start: 5 }],
        { lead: 2 },
      ),
    ),
    { position: { ranges: [[1, 2], [5]], lead: 2 } },
  );
  for (const bad of [
    () => WHEN.duration({}),
    () => WHEN.volume({ min: 2, max: 1 }),
    () => WHEN.rate({ min: Number.NaN }),
    () => WHEN.time({ at: 1 } as never),
    () => WHEN.audioTrack(1.5),
    () => WHEN.subtitleTrack(""),
    () => WHEN.position.in([{ start: -1 }]),
    () => WHEN.position.in([{ start: 2, end: 1 }]),
    () => WHEN.position.in([{ start: 1 }], { lead: -1 }),
  ])
    assert.throws(bad, TypeError);
  const many = Array.from({ length: 1001 }, (_, i) => ({ start: i }));
  assert.throws(() => WHEN.position.in(many), { code: "limit" });
  assert.doesNotThrow(() => WHEN.position.in(many.slice(0, 1000)));
});

test("the agreement table: every row holds as the player evaluates it", () => {
  const { defaults, rows } = CONDITION_TABLE as unknown as {
    defaults: Record<string, unknown>;
    rows: {
      when: ConditionJson;
      facts: Record<string, unknown>;
      holds: boolean;
      range?: number;
    }[];
  };
  assert.ok(rows.length >= 40);
  for (const row of rows) {
    const f = { ...defaults, ...row.facts } as Record<string, unknown>;
    const facts: ConditionFacts = {
      ...(f as unknown as ConditionFacts),
      can: Object.fromEntries((f.can as string[]).map((c) => [c, true])),
    };
    const truth = evaluateTruth(row.when, facts);
    assert.equal(truth.holds, row.holds, JSON.stringify(row));
    assert.equal(truth.range, row.range ?? null, JSON.stringify(row));
  }
});

test("T8: triggers are declared in the synchronous part of activate()", async () => {
  let late: unknown;
  const { plugin, host, stop } = await startPlugin(async (plugin) => {
    plugin.trigger("a");
    plugin.trigger();
    assert.throws(() => plugin.trigger("a"), { code: "invalid" });
    assert.throws(() => plugin.trigger(""), { code: "invalid" });
    await Promise.resolve();
    try {
      plugin.trigger("later");
    } catch (error) {
      late = error;
    }
  });
  try {
    assert.match(String(late), /synchronous part of activate/);
    assert.throws(() => plugin.trigger(), /synchronous part/);
    // The player learns what was declared, once.
    assert.deepEqual(
      sets(host).map((c) => [c.method, c.params]),
      [["triggers.declare", { names: ["a"], unnamed: 1 }]],
    );
  } finally {
    await stop();
  }
  // Only the plugin declares triggers, not a sub-scope (whose disposal
  // would leave a kept condition waking the plugin for nothing).
  let scoped: unknown;
  const sub = await startPlugin((plugin) => {
    const scope = plugin.scope() as unknown as Plugin;
    try {
      scope.trigger("in-scope");
    } catch (error) {
      scoped = error;
    }
  });
  assert.match(String(scoped), /on the plugin, not on a scope/);
  assert.deepEqual(sets(sub.host), []);
  await sub.stop();
  // No trigger: nothing is sent.
  const quiet = await startPlugin(() => {});
  assert.deepEqual(sets(quiet.host), []);
  await quiet.stop();
  // At most 64.
  await assert.rejects(
    startPlugin((plugin) => {
      for (let i = 0; i <= TRIGGER_LIMITS.triggers; i++) plugin.trigger();
    }),
    { code: "limit" },
  );
});

test("T1, T3, T4: enter and leave at each flip; true when given enters at once", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 60, position: 0 });
  host.setMainWindow({ fullscreen: true });
  const record = recorder();
  const { stop } = await startPlugin(
    (plugin) => {
      const { when } = plugin;
      plugin
        .trigger()
        .firesOn(when.playing.and(when.fullscreen))
        .enter(record.enter)
        .leave(record.leave);
    },
    { host },
  );
  try {
    await host.settle();
    assert.deepEqual(record.log, ["enter @0"]);
    host.setSource({ paused: true });
    await host.settle();
    host.setSource({ paused: true, volume: 3 } as never);
    host.setSource({ paused: false });
    host.setMainWindow({ fullscreen: false });
    await host.settle();
    assert.deepEqual(record.log, [
      "enter @0",
      "leave @0",
      "enter @0",
      "leave @0",
    ]);
    assert.deepEqual(
      host.triggers.map((t) => [t.trigger, t.entered]),
      [[0, false]],
    );
  } finally {
    await stop();
  }
});

test("T5, T6, T7: the same condition changes nothing, another replaces it, off removes it", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 60, position: 0 });
  const record = recorder();
  let trigger!: ReturnType<Plugin["trigger"]>;
  const { plugin, stop } = await startPlugin(
    (plugin) => {
      trigger = plugin
        .trigger("t")
        .firesOn(plugin.when.playing)
        .enter(record.enter)
        .leave(record.leave);
    },
    { host },
  );
  try {
    await host.settle();
    const [first] = host.triggers;
    assert.equal(first!.entered, true);
    trigger.firesOn(plugin.when.playing);
    await host.settle();
    assert.equal(host.triggers[0]!.seq, first!.seq);
    // Another condition: no leave for the old one; entered at once again.
    trigger.firesOn(plugin.when.paused);
    await host.settle();
    trigger.firesOn(plugin.when.ready);
    await host.settle();
    assert.deepEqual(record.log, ["enter @0", "enter @0"]);
    assert.ok(host.triggers[0]!.seq > first!.seq);
    trigger.off();
    await host.settle();
    host.setSource({ phase: "ended" });
    await host.settle();
    assert.deepEqual(host.triggers, []);
    assert.deepEqual(record.log, ["enter @0", "enter @0"]);
  } finally {
    await stop();
  }
});

test("T6: a notification older than the newest answer is dropped", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", position: 0 });
  const record = recorder();
  let trigger!: ReturnType<Plugin["trigger"]>;
  const { stop } = await startPlugin(
    (plugin) => {
      trigger = plugin.trigger("t").enter(record.enter);
    },
    { host },
  );
  try {
    host.emit("triggers.fired", {
      trigger: "t",
      seq: 5,
      edge: "enter",
      state: host.source,
    });
    await host.settle();
    assert.equal(record.log.length, 1);
    // `off` answers a newer number: a late notification is dropped.
    host.handle("triggers.off", () => ({ seq: 9 }));
    trigger.off();
    await host.settle();
    host.emit("triggers.fired", {
      trigger: "t",
      seq: 9,
      edge: "enter",
      state: host.source,
    });
    await host.settle();
    assert.equal(record.log.length, 2);
    host.emit("triggers.fired", {
      trigger: "t",
      seq: 8,
      edge: "enter",
      state: host.source,
    });
    await host.settle();
    assert.equal(record.log.length, 2);
  } finally {
    await stop();
  }
});

test("T9: one trigger's functions run one after another", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", position: 0, paused: true });
  const order: string[] = [];
  let release!: () => void;
  const { stop } = await startPlugin(
    (plugin) => {
      plugin
        .trigger()
        .firesOn(plugin.when.playing)
        .enter(async () => {
          order.push("enter begins");
          await new Promise<void>((resolve) => (release = resolve));
          order.push("enter ends");
        })
        .leave(() => order.push("leave"));
    },
    { host },
  );
  try {
    host.setSource({ paused: false });
    await host.settle();
    host.setSource({ paused: true });
    await host.settle();
    assert.deepEqual(order, ["enter begins"]);
    release();
    await host.settle();
    assert.deepEqual(order, ["enter begins", "enter ends", "leave"]);
  } finally {
    await stop();
  }
});

test("T2, T10, T11: ranges entered, passed, jumped into and out of, with the virtual clock", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 100, position: 0 });
  const record = recorder();
  const { stop } = await startPlugin(
    (plugin) => {
      const ranges = [
        { start: 10, end: 20 },
        { start: 20, end: 30 },
        { start: 40, end: 40.004 },
      ];
      plugin
        .trigger()
        .firesOn(plugin.when.position.in(ranges))
        .enter(record.enter)
        .leave(record.leave);
    },
    { host },
  );
  try {
    const start = host.now;
    await host.advance(9_000);
    assert.deepEqual(record.log, []);
    await host.advance(1_000);
    assert.deepEqual(record.log, ["enter 0 @10"]);
    assert.equal(host.now - start, 10_000);
    // Straight into the next range: leave the first, enter the second.
    await host.advance(10_000);
    assert.deepEqual(record.log.slice(1), ["leave 0 @20", "enter 1 @20"]);
    // A 4 ms range passed by playback: entered and left once.
    await host.advance(25_000);
    assert.deepEqual(record.log.slice(3), [
      "leave 1 @30",
      "enter 2 @40",
      "leave 2 @40.004",
    ]);
    // Jumps: into a range, out of it, over one.
    record.log.length = 0;
    host.setSource({ position: 15 });
    host.setSource({ position: 5 });
    host.setSource({ position: 35 });
    await host.settle();
    assert.deepEqual(record.log, ["enter 0 @15", "leave 0 @5"]);
  } finally {
    await stop();
  }
});

test("a lead enters before the start; a pause stops the clock's effect on the position", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 100, position: 0 });
  const record = recorder();
  const { stop } = await startPlugin(
    (plugin) => {
      const { when } = plugin;
      plugin
        .trigger()
        .firesOn(
          when.playing.and(
            when.position.in([{ start: 10, end: 12 }], { lead: 2 }),
          ),
        )
        .enter(record.enter)
        .leave(record.leave);
    },
    { host },
  );
  try {
    await host.advance(7_000);
    host.setSource({ paused: true });
    await host.advance(10_000);
    assert.deepEqual(record.log, []);
    host.setSource({ paused: false });
    await host.advance(1_000);
    assert.deepEqual(record.log, ["enter 0 @8"]);
    // Twice as fast: the end comes after 2 s.
    host.setSource({ rate: 2 });
    await host.advance(1_999);
    assert.equal(record.log.length, 1);
    await host.advance(1);
    assert.deepEqual(record.log, ["enter 0 @8", "leave 0 @12"]);
  } finally {
    await stop();
  }
});

test("T12: a range list belongs to the source it was given for", async () => {
  const host = new TestHost();
  host.setSource({
    phase: "ready",
    position: 15,
    stamp: { generation: 1, intentVersion: 1 },
  });
  const record = recorder();
  const { stop } = await startPlugin(
    (plugin) => {
      plugin
        .trigger()
        .firesOn(plugin.when.position.in([{ start: 10, end: 20 }]))
        .enter(record.enter)
        .leave(record.leave);
    },
    { host },
  );
  try {
    await host.settle();
    host.setSource({
      stamp: { generation: 2, intentVersion: 1 },
      position: 15,
    });
    await host.settle();
    assert.deepEqual(record.log, ["enter 0 @15", "leave 0 @15"]);
  } finally {
    await stop();
  }
});

test("T14: a notification nobody handles removes its condition", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", position: 0 });
  const { stop } = await startPlugin(
    (plugin) => {
      plugin.trigger("bare").firesOn(plugin.when.playing);
    },
    { host },
  );
  try {
    await host.settle();
    assert.deepEqual(
      host.calls
        .filter((c) => c.method === "triggers.off")
        .map((c) => c.params),
      [{ trigger: "bare", unhandled: true }],
    );
    assert.deepEqual(host.triggers, []);
  } finally {
    await stop();
  }
});

test("a time condition rings at its time; the plugin in standby is woken", async () => {
  const host = new TestHost();
  const rang: number[] = [];
  const due = host.now + 45 * 60_000;
  const { stop } = await startPlugin(
    (plugin) => {
      const alarm = plugin.trigger("sleep").enter(() => {
        rang.push(host.now);
        alarm.off();
      });
      plugin.commands.add({
        id: "in45",
        title: "Sleep in 45 Minutes",
        run: () => alarm.firesOn(plugin.when.time({ min: due })),
      });
    },
    { host },
  );
  try {
    await host.command("in45").run();
    await host.settle();
    await host.park();
    assert.equal(host.parked, true);
    assert.equal(host.triggers.length, 1);
    await host.advance(44 * 60_000);
    assert.deepEqual(rang, []);
    assert.equal(host.parked, true);
    await host.advance(60_000);
    await host.settle();
    assert.equal(host.parked, false);
    assert.deepEqual(rang, [due]);
    assert.deepEqual(host.triggers, []);
  } finally {
    await stop();
  }
});

test("park: a wake event starts the plugin and its kept conditions stay", async () => {
  const host = new TestHost();
  const heard: string[] = [];
  let activations = 0;
  const { stop } = await startPlugin(
    (plugin) => {
      activations++;
      plugin
        .trigger()
        .firesOn(plugin.when.playing.and(plugin.when.fullscreen))
        .enter(() => heard.push("enter"));
      plugin.player.on("source.ready", () => heard.push("ready"));
    },
    { host },
  );
  try {
    await host.park();
    host.setSource({
      phase: "loading",
      source: "/media/a.mkv",
      stamp: { generation: 1, intentVersion: 1 },
    });
    host.setSource({ phase: "ready", position: 0 });
    await host.settle();
    assert.equal(activations, 2);
    assert.deepEqual(heard, ["ready"]);
    await host.park();
    host.setMainWindow({ fullscreen: true });
    await host.settle();
    assert.equal(activations, 3);
    assert.deepEqual(heard, ["ready", "enter"]);
    // The condition given again by activate() changed nothing (T5).
    assert.equal(host.triggers.length, 1);
    assert.equal(host.triggers[0]!.entered, true);
  } finally {
    await stop();
  }
});

test("upgrade: unnamed conditions are cleared, named ones kept, undeclared names dropped", async () => {
  const host = new TestHost();
  const first = (plugin: Plugin) => {
    const timer = plugin.trigger("sleep");
    const other = plugin.trigger("gone");
    const place = plugin.trigger();
    plugin.commands.add({
      id: "arm",
      title: "Arm",
      run: () => {
        timer.firesOn(plugin.when.time({ min: host.now + 60_000 }));
        other.firesOn(plugin.when.time({ min: host.now + 60_000 }));
        place.firesOn(plugin.when.time({ min: host.now + 60_000 }));
      },
    });
  };
  const rang: string[] = [];
  const second = (plugin: Plugin) => {
    plugin.trigger("sleep").enter(() => rang.push("sleep"));
    plugin.trigger().enter(() => rang.push("unnamed"));
  };
  const { stop } = await startPlugin(first, { host });
  try {
    await host.command("arm").run();
    await host.settle();
    assert.equal(host.triggers.length, 3);
    await host.upgrade(second);
    assert.deepEqual(
      host.triggers.map((t) => t.trigger),
      ["sleep"],
    );
    await host.advance(60_000);
    await host.settle();
    assert.deepEqual(rang, ["sleep"]);
  } finally {
    await stop();
  }
});

test("a command's state takes the new atoms, not position or time", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 700, position: 0 });
  const { plugin, stop } = await startPlugin(() => {}, { host });
  try {
    plugin.commands.add({
      id: "long",
      title: "Long",
      enabled: plugin.when.duration({ min: 600 }),
      run: () => {},
    });
    await host.settle();
    assert.equal(host.command("long").state.enabled, true);
    const errors: unknown[] = [];
    plugin.onError((error) => errors.push(error));
    plugin.commands.add({
      id: "late",
      title: "Late",
      enabled: plugin.when.time({ min: 1 }),
      run: () => {},
    });
    await host.settle();
    assert.match(String(errors[0]), /for a trigger/);
  } finally {
    await stop();
  }
});

test("a replaced list still in the same range is not entered again; another range is", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 400, position: 37, rate: 2 });
  const record = recorder();
  let trigger!: ReturnType<Plugin["trigger"]>;
  const { plugin, stop } = await startPlugin(
    (plugin) => {
      trigger = plugin.trigger().enter(record.enter).leave(record.leave);
    },
    { host },
  );
  try {
    const arm = (ranges: { start: number; end: number }[]) =>
      trigger.firesOn(
        plugin.when.playing.and(plugin.when.position.in(ranges, { lead: 2 })),
      );
    // Two ranges known (a scan two windows in), entered at the lead.
    arm([
      { start: 40.15, end: 43.87325 },
      { start: 110.15, end: 112.85 },
    ]);
    await host.settle();
    await host.advance(600);
    assert.deepEqual(record.log, ["enter 0 @38.15"]);
    // The same plugin woken later knows more ranges: the position is still
    // in the first one, so no second enter.
    arm([
      { start: 40.15, end: 43.87325 },
      { start: 110.15, end: 112.85 },
      { start: 185.15, end: 188.85 },
    ]);
    await host.settle();
    assert.deepEqual(record.log, ["enter 0 @38.15"]);
    // A list whose range around the position ends elsewhere: entered at once.
    arm([{ start: 40.15, end: 45 }]);
    await host.settle();
    assert.deepEqual(record.log, ["enter 0 @38.15", "enter 0 @38.2"]);
  } finally {
    await stop();
  }
});

test("N1 (a): an enter crossing a firesOn that stays entered is not dropped", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 100, position: 5 });
  const record = recorder();
  let trigger!: ReturnType<Plugin["trigger"]>;
  const { plugin, stop } = await startPlugin(
    (plugin) => {
      trigger = plugin.trigger().enter(record.enter).leave(record.leave);
    },
    { host },
  );
  try {
    const arm = (ranges: { start: number; end: number }[]) =>
      trigger.firesOn(plugin.when.position.in(ranges));
    arm([{ start: 10, end: 20 }]);
    await host.settle();
    const [{ seq }] = host.triggers;
    // The plugin gives a longer list that holds the same range; before the
    // player has it, the position reaches the range under the old list and
    // that enter crosses the request on the pipe.
    arm([
      { start: 2, end: 3 },
      { start: 10, end: 20 },
    ]);
    host.setSource({ position: 10 });
    await host.settle();
    assert.equal(host.triggers[0]!.seq, seq);
    assert.deepEqual(record.log, ["enter 0 @10"]);
  } finally {
    await stop();
  }
});

test("N1 (b): a woken plugin that gives a longer list in activate() still gets its wake enter, once", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 100, position: 5 });
  const record = recorder();
  let runs = 0;
  const { stop } = await startPlugin(
    (plugin) => {
      runs++;
      // Each run knows more of the file (a scan going on).
      const ranges =
        runs === 1
          ? [{ start: 10, end: 20 }]
          : [
              { start: 10, end: 20 },
              { start: 30, end: 40 },
            ];
      plugin
        .trigger()
        .firesOn(plugin.when.position.in(ranges))
        .enter(record.enter)
        .leave(record.leave);
    },
    { host },
  );
  try {
    await host.park();
    await host.advance(5_000);
    await host.settle();
    assert.equal(runs, 2);
    assert.deepEqual(record.log, ["enter 0 @10"]);
  } finally {
    await stop();
  }
});
