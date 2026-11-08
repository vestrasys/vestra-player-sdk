// Golden wire traces (characterisation tests, doc/specs/sdk-refactor.md §4.0
// in the player repository): every example plugin, and the player's built-in
// plugins when the player repository is at hand, runs the same fixed script
// against `TestHost`, and the `(method, params)` sequence it sends, its
// `events.subscribe` lines and its update-pass counts are compared with
// `test/fixtures/traces/<name>.json`. A refactor that moves code must leave
// every trace identical; a change that alters a trace rewrites the fixture
// on purpose (`UPDATE_TRACES=1 npm test`) and says why in the CHANGELOG.
//
// The script: start (activation and the initial fetches) → open a source
// (`openElsewhere("/movie.mp4")`, phase `ready`) → three state changes
// (`rate` 1.5, `paused`, `position` 30) → one command run → dispose. Each
// phase's calls are recorded separately, with the pass counters' delta.
//
// Normalisation (each a rule in `normalise`; what it hides is noted):
// 1. Paths: the plugin's directory becomes `<plugin>`, the host's data
//    directory `<data>`, the system temporary directory `<tmp>`;
//    backslashes become `/`. Hides where the checkout and the temp dir are.
// 2. `why` texts (`events.subscribe`): `main.ts:12` becomes `main.ts`, so a
//    moved line keeps the trace; whether a `why` is present, and which file
//    and which reader (`a listener added at`, `a view's bind reads …`), stay.
// 3. Polls: `producer.state` is asked in a 10 ms sleep loop while a stream
//    starts and every 5 ms while it runs (`src/plugin/stream.ts`), so how
//    many times, and where between the other calls, depends on timing.
//    Those calls are left out of `calls`; `polled` lists the methods that
//    were polled at all.
// 4. `producer.ack`'s `control.baseSample` is how many frames the host had
//    received when it selected the stream, which depends on timing too; it
//    becomes `"<samples>"`.
// 5. A Windows drive root (`C:\`) in a value becomes `/` and the separators
//    after it `/`: the script opens `/movie.mp4`, which a plugin may hand
//    back resolved (`C:\movie.mp4` on Windows). Hides the platform.
// 6. Numbers and identifiers the host hands out (producer ids, operation
//    ids, revisions, `seq`) are left as they are: `TestHost` numbers them
//    from 1 in order, so they are deterministic within one script.
// 7. Time: a run in which the safety pass fired (`SAFETY_PASS_MS` after a
//    precise pass skipped something, which adds a full pass to a phase's
//    counts on a loaded machine; `counts.safetyPasses`) is repeated
//    instead of compared, up to three times (`check`).
// 8. Image `ref` numbers (`$vestraImage`) come from a counter shared by
//    every plugin in the process (`src/plugin/ui.ts`), so a repeated run
//    gets other numbers: they are renumbered from 1 in order of first
//    appearance within the scenario.
// 9. A command that keeps working between host calls after `run()` (the
//    signal generator's stream start) ends its phase only once it is done
//    (`COMMAND_DONE`, bounded at `COMMAND_DONE_MS`, failing with the calls
//    seen so far), not when `quiet()` sees a lull.
//
// Built-ins: set `VESTRA_PLAYER=<player repository>` to run the six the plan
// names (playback, playlist, info, subtitles, video, workshop) from
// `src/plugins/<name>` of that checkout; without it they are skipped (the
// SDK's CI has no player checkout). Their fixtures are kept here too, each
// pinned to the player commit it was recorded from (`playerCommit`): when
// `VESTRA_PLAYER`'s HEAD is another commit the test skips with a message,
// so a player change does not pass for an SDK regression. `UPDATE_TRACES=1`
// re-records and re-pins to the current HEAD.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { PassCounts } from "../src/plugin/runtime.ts";
import type { ScopeImpl } from "../src/plugin/scope.ts";
import type { Plugin } from "../src/plugin/types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const FIXTURES = join(ROOT, "test", "fixtures", "traces");
const UPDATE = process.env.UPDATE_TRACES === "1";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };
type Call = { method: string; params: Json };

/** Rule 3: methods asked in a sleep loop; left out of the sequence. */
const POLLED: ReadonlySet<string> = new Set(["producer.state"]);
type Phase = "start" | "open" | "changes" | "command" | "dispose";
const PHASES: readonly Phase[] = [
  "start",
  "open",
  "changes",
  "command",
  "dispose",
];

interface Trace {
  scenario: string;
  /** Built-ins only: the player commit the fixture was recorded from. */
  playerCommit?: string;
  /** The command the script runs, `null` when the plugin has none to run. */
  command: string | null;
  /** Every `events.subscribe` line in order (also in `calls`). */
  subscriptions: { event: string; mirror?: boolean; why?: string[] }[];
  /** Methods polled in a sleep loop (rule 3), left out of `calls`. */
  polled: string[];
  /** Update passes and binder evaluations, per phase. */
  counts: Record<Phase, PassCounts>;
  /** The `(method, params)` sequence, per phase. */
  calls: Record<Phase, Call[]>;
}

interface Scenario {
  name: string;
  directory: string;
  /** The command to run in the `command` phase. */
  command: string | null;
}

/**
 * Rule 9. A command whose work goes on after `run()` returned and between
 * host calls, where `quiet()` cannot see it: the `command` phase ends only
 * once this holds (bounded, `COMMAND_DONE_MS`). Signal generator: `run()`
 * only delivers `commands.execute`; the stream start then writes its
 * preroll to the producer socket and polls `producer.state` (left out,
 * rule 3) until the host has received 1,024 frames, before
 * `source.submit`. Where the socket is slow (GitHub's macOS runners) only
 * polls come for longer than `quiet()` waits, the phase ended early and
 * `dispose` aborted the start (`AbortError`; `source.submit`,
 * `producer.ack` and `commands.update` missing from the trace).
 * Done when the player acknowledged the stream and the command shows it
 * running (`commands.update` with `checked: true`).
 */
const COMMAND_DONE: Record<string, (host: TestHost) => boolean> = {
  "examples/signal-generator": (host) =>
    host.sent("producer.ack").length > 0 &&
    host
      .sent("commands.update")
      .some(
        (params) =>
          params.id === "signal-generator" &&
          (params.state as { checked?: unknown } | undefined)?.checked === true,
      ),
};
/** Longer than the SDK's own 10 s stream start timeouts (`stream.ts`). */
const COMMAND_DONE_MS = 15_000;

/** The example that runs under each name, and the command the script runs. */
const EXAMPLES: Record<string, string | null> = {
  "adjust-panel": "speed-reset",
  blur: "blur",
  bookmark: "bookmark.open",
  hello: "hello",
  i18n: "counter",
  markdown: "show",
  menus: "rate-1.5",
  "panel-menu": "remove",
  "signal-generator": "signal-generator",
  "theme-widgets": "level.up",
};

/** The six built-ins the plan names, and the command the script runs. */
const BUILTINS: Record<string, string | null> = {
  playback: "rate-15",
  playlist: "playlist.repeat-all",
  info: "info.toggle",
  subtitles: "size-up",
  video: "video.reset",
  workshop: "workshop.open",
};

const scenarios: Scenario[] = Object.entries(EXAMPLES).map(
  ([name, command]) => ({
    name: `examples/${name}`,
    directory: join(ROOT, "examples", name),
    command,
  }),
);

const player = process.env.VESTRA_PLAYER;
const builtins: Scenario[] = Object.entries(BUILTINS).map(
  ([name, command]) => ({
    name: `builtins/${name}`,
    directory: player ? join(player, "src", "plugins", name) : "",
    command,
  }),
);

// ---------------------------------------------------------------- recording

function forwardSlashes(path: string) {
  return path.replaceAll("\\", "/");
}

/** Rule 1: paths. Applied to the JSON text of the params. */
function hidePaths(text: string, replacements: [string, string][]) {
  for (const [path, token] of replacements) {
    // As JSON encodes a Windows path (`C:\\x`), and with forward slashes.
    const escaped = JSON.stringify(path).slice(1, -1);
    text = text.replaceAll(escaped, token);
    text = text.replaceAll(forwardSlashes(path), token);
    // A trailing separator after the token (`<plugin>\\`).
    text = text.replaceAll(`${token}\\\\`, `${token}/`);
  }
  // Rule 5: a drive root and the separators of that path.
  return text.replace(/\b[A-Z]:\\\\(?:[^"\\]*\\\\)*/g, (match) =>
    `/${match.slice(4)}`.replaceAll("\\\\", "/"),
  );
}

/** Rule 4: a timing-dependent sample count in `producer.ack`. */
function hideSamples(params: Json): Json {
  if (!params || typeof params !== "object" || Array.isArray(params))
    return params;
  const control = params.control;
  if (!control || typeof control !== "object" || Array.isArray(control))
    return params;
  if (!("baseSample" in control)) return params;
  return { ...params, control: { ...control, baseSample: "<samples>" } };
}

/** Rule 8: image refs renumbered in order of first appearance. */
function renumberRefs(value: Json, refs: Map<number, number>): Json {
  if (Array.isArray(value))
    return value.map((item) => renumberRefs(item, refs));
  if (!value || typeof value !== "object") return value;
  const out: { [k: string]: Json } = {};
  for (const [key, item] of Object.entries(value)) {
    if (key === "ref" && "$vestraImage" in value && typeof item === "number") {
      if (!refs.has(item)) refs.set(item, refs.size + 1);
      out[key] = refs.get(item)!;
    } else out[key] = renumberRefs(item, refs);
  }
  return out;
}

/** Rule 2: `why` texts lose their line numbers. */
function hideLines(why: unknown): unknown {
  if (!Array.isArray(why)) return why;
  return why.map((line) =>
    typeof line === "string"
      ? line.replace(/(\.[cm]?[jt]s):\d+\b/g, "$1")
      : line,
  );
}

function normalise(
  calls: readonly { method: string; params: unknown }[],
  replacements: [string, string][],
  polled: Set<string>,
  refs: Map<number, number>,
): Call[] {
  const out: Call[] = [];
  for (const call of calls) {
    if (POLLED.has(call.method)) {
      polled.add(call.method);
      continue;
    }
    let params = renumberRefs(
      JSON.parse(
        hidePaths(JSON.stringify(call.params ?? {}), replacements),
      ) as Json,
      refs,
    );
    if (
      call.method === "events.subscribe" &&
      params &&
      typeof params === "object" &&
      !Array.isArray(params) &&
      "why" in params
    )
      params = { ...params, why: hideLines(params.why) as Json };
    if (call.method === "producer.ack") params = hideSamples(params);
    out.push({ method: call.method, params });
  }
  return out;
}

function delta(now: PassCounts, before: PassCounts): PassCounts {
  return {
    passes: now.passes - before.passes,
    fullPasses: now.fullPasses - before.fullPasses,
    evaluations: now.evaluations - before.evaluations,
    parts: now.parts - before.parts,
    skippedParts: now.skippedParts - before.skippedParts,
    safetyPasses: now.safetyPasses - before.safetyPasses,
  };
}

async function record(
  scenario: Scenario,
): Promise<{ trace: Trace; safetyPasses: number }> {
  const host = new TestHost();
  const module = (await import(
    pathToFileURL(join(scenario.directory, "main.ts")).href
  )) as { default: (plugin: Plugin) => unknown };
  const replacements: [string, string][] = [
    [scenario.directory, "<plugin>"],
    [host.dataDirectory, "<data>"],
    [tmpdir(), "<tmp>"],
  ];
  const calls = {} as Record<Phase, Call[]>;
  const counts = {} as Record<Phase, PassCounts>;
  const polled = new Set<string>();
  const refs = new Map<number, number>();
  let mark = 0;
  let runtime: ScopeImpl["runtime"] | undefined;
  let before: PassCounts = {
    passes: 0,
    fullPasses: 0,
    evaluations: 0,
    parts: 0,
    skippedParts: 0,
    safetyPasses: 0,
  };
  // `settle()` returns as soon as no request is in flight, which is also
  // the case between two polls of a sleep loop (rule 3): a phase ends only
  // once 25 ms pass without any new call other than a poll (a running
  // stream polls for ever), so a loop of 10 ms steps that is still
  // working does not spill into the next phase. Bounded at 1 s.
  const unpolled = () =>
    host.calls.filter((call) => !POLLED.has(call.method)).length;
  const quiet = async () => {
    for (let n = -1, rounds = 0; n !== unpolled() && rounds < 40; rounds++) {
      n = unpolled();
      await host.settle(25);
    }
  };
  const cut = async (phase: Phase) => {
    await quiet();
    calls[phase] = normalise(
      host.calls.slice(mark),
      replacements,
      polled,
      refs,
    );
    mark = host.calls.length;
    const now = runtime ? { ...runtime.counts } : before;
    counts[phase] = delta(now, before);
    before = now;
  };
  const { plugin, stop } = await startPlugin(module.default, {
    directory: scenario.directory,
    host,
  });
  runtime = (plugin as ScopeImpl).runtime;
  await cut("start");

  host.openElsewhere("/movie.mp4");
  await host.settle();
  await cut("open");

  host.setSource({ rate: 1.5 });
  await host.settle();
  host.setSource({ paused: true });
  await host.settle();
  host.setSource({ position: 30 });
  await host.settle();
  await cut("changes");

  if (scenario.command) {
    await host.command(scenario.command).run();
    await host.settle();
    const done = COMMAND_DONE[scenario.name];
    if (done) {
      const deadline = Date.now() + COMMAND_DONE_MS;
      while (!done(host)) {
        if (Date.now() >= deadline)
          throw new Error(
            `${scenario.name}: command ${scenario.command} did not finish within ${COMMAND_DONE_MS} ms (rule 9); calls so far: ${host.calls
              .slice(mark)
              .map((call) => call.method)
              .join(", ")}`,
          );
        await host.settle(10);
      }
    }
  }
  await cut("command");

  await stop();
  await cut("dispose");

  const subscriptions: Trace["subscriptions"] = [];
  for (const phase of PHASES)
    for (const call of calls[phase])
      if (call.method === "events.subscribe")
        subscriptions.push(call.params as Trace["subscriptions"][number]);

  return {
    trace: {
      scenario: scenario.name,
      command: scenario.command,
      subscriptions,
      polled: [...polled].sort(),
      counts,
      calls,
    },
    safetyPasses: runtime.counts.safetyPasses,
  };
}

/**
 * Rule 7. A precise pass that skipped a binding arms a full pass
 * `SAFETY_PASS_MS` later (`Runtime.#run`); a scenario normally takes about
 * a third of that, but on a loaded machine (the whole suite in parallel)
 * it can take longer, and the safety pass then adds a full pass to some
 * phase's counts. A run in which it fired is not compared but repeated,
 * up to three times; the third is compared whatever happened.
 */
async function check(scenario: Scenario, playerCommit?: string) {
  for (let attempt = 1; ; attempt++) {
    const { trace, safetyPasses } = await record(scenario);
    if (safetyPasses === 0 || attempt === 3) {
      compare(
        scenario,
        playerCommit === undefined
          ? trace
          : (({ scenario: name, ...rest }) => ({
              scenario: name,
              playerCommit,
              ...rest,
            }))(trace),
      );
      return;
    }
  }
}

// ------------------------------------------------------------------ fixtures

function fixturePath(scenario: Scenario) {
  return join(FIXTURES, `${scenario.name.replace("/", "-")}.json`);
}

function compare(scenario: Scenario, trace: Trace) {
  const file = fixturePath(scenario);
  const text = `${JSON.stringify(trace, null, 2)}\n`;
  if (UPDATE) {
    mkdirSync(FIXTURES, { recursive: true });
    writeFileSync(file, text);
    return;
  }
  assert.ok(
    existsSync(file),
    `${file} is missing: run UPDATE_TRACES=1 npm test -- test/golden-traces.test.ts`,
  );
  const expected = JSON.parse(readFileSync(file, "utf8")) as Trace;
  assert.deepEqual(
    trace,
    expected,
    `the wire trace of ${scenario.name} changed; if intended, rewrite the fixture with UPDATE_TRACES=1 and say why in the CHANGELOG`,
  );
}

for (const scenario of scenarios)
  test(`golden trace: ${scenario.name}`, async () => {
    await check(scenario);
  });

/** `VESTRA_PLAYER`'s checked-out commit (full hash). */
function playerHead(directory: string) {
  const result = spawnSync("git", ["-C", directory, "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (result.status !== 0)
    throw new Error(
      `VESTRA_PLAYER=${directory} is not a git checkout: ${result.stderr}`,
    );
  return result.stdout.trim();
}

for (const scenario of builtins)
  test(
    `golden trace: ${scenario.name}`,
    { skip: !player && "VESTRA_PLAYER is not set" },
    async (t) => {
      assert.ok(
        existsSync(join(scenario.directory, "manifest.json")),
        `${scenario.directory} has no manifest.json (VESTRA_PLAYER=${player})`,
      );
      const head = playerHead(player!);
      const file = fixturePath(scenario);
      if (!UPDATE && existsSync(file)) {
        const pinned = (JSON.parse(readFileSync(file, "utf8")) as Trace)
          .playerCommit;
        // A player change is not an SDK regression: compare only against
        // the player commit the fixture was recorded from.
        if (pinned !== head) {
          t.skip(
            `VESTRA_PLAYER is at ${head.slice(0, 10)}, the fixture was recorded at ${pinned?.slice(0, 10) ?? "an unknown commit"}; check out that commit, or re-pin with UPDATE_TRACES=1`,
          );
          return;
        }
      }
      await check(scenario, head);
    },
  );

// ------------------------------------------------------------ host scenarios
//
// The test host's own behaviour at the edges a reorganisation of
// `src/plugin/testing*` could move (doc/specs/sdk-refactor.md §4.0, Step
// 1): each scenario drives a small inline plugin, or the host alone, and
// records what it observed, as `test/fixtures/traces/host-<name>.json`:
// the order of requests, answers, refusals and events (`watch`), error
// codes and messages, and facts about the host's temporary files. Paths
// are not recorded, only facts about them, and `why` texts lose their line
// numbers (rule 2), so the fixtures are the same on every platform.
// `UPDATE_TRACES=1` rewrites them like the traces.

/** The scenario names, for the fixture check below. */
const HOST_SCENARIOS: string[] = [];

/** A value as JSON (`undefined` → `null`). */
function toJson(value: unknown): Json {
  return value === undefined
    ? null
    : (JSON.parse(JSON.stringify(value)) as Json);
}

/** An error as `{ code, message }` (`code` only when it has one). */
function refusal(error: unknown): Json {
  if (!(error instanceof Error)) return { thrown: toJson(error) };
  const code = (error as { code?: unknown }).code;
  return typeof code === "string"
    ? { code, message: error.message }
    : { message: error.message };
}

/** How a promise ended: `{ value }` or the refusal. */
function outcome(promise: Promise<unknown>): Promise<Json> {
  return promise.then(
    (value) => ({ value: toJson(value) }),
    (error: unknown) => ({ refused: refusal(error) }),
  );
}

/**
 * Log the host's requests (and how each ended) and the events it delivers,
 * in order, into one timeline the scenario adds its own marks to.
 */
function watch(host: TestHost): Json[] {
  const log: Json[] = [];
  const request = host.request.bind(host);
  host.request = (async (method: string, params?: Json) => {
    log.push(["request", method]);
    try {
      const value = await request(method, params);
      log.push(["answer", method]);
      return value;
    } catch (error) {
      log.push(["refused", method, refusal(error)]);
      throw error;
    }
  }) as TestHost["request"];
  const emit = host.emit.bind(host);
  host.emit = ((event: string, data: unknown) => {
    log.push(["event", event, toJson(data)]);
    emit(event, data);
  }) as TestHost["emit"];
  return log;
}

/** Rules 1 and 2 over a whole observation. */
function scrub(value: Json, host?: TestHost): Json {
  const replacements: [string, string][] = [
    ...(host ? ([[host.dataDirectory, "<data>"]] as [string, string][]) : []),
    [process.cwd(), "<cwd>"],
    [tmpdir(), "<tmp>"],
  ];
  return JSON.parse(
    hidePaths(JSON.stringify(value), replacements).replace(
      /(\.[cm]?[jt]s):\d+\b/g,
      "$1",
    ),
  ) as Json;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function hostScenario(name: string, run: () => Promise<Json>) {
  HOST_SCENARIOS.push(name);
  test(`host scenario: ${name}`, async () => {
    const observed = await run();
    const file = join(FIXTURES, `host-${name}.json`);
    const text = `${JSON.stringify(observed, null, 2)}\n`;
    if (UPDATE) {
      mkdirSync(FIXTURES, { recursive: true });
      writeFileSync(file, text);
      return;
    }
    assert.ok(
      existsSync(file),
      `${file} is missing: run UPDATE_TRACES=1 npm test -- test/golden-traces.test.ts`,
    );
    assert.deepEqual(
      observed,
      JSON.parse(readFileSync(file, "utf8")) as Json,
      `what the test host does in ${name} changed; if intended, rewrite the fixture with UPDATE_TRACES=1 and say why in the CHANGELOG`,
    );
  });
}

// `disconnect()` with requests in flight: one the host never answers
// (waiting in the race with the lost connection), one sent just before
// (still in its first tick), one after; and a request from a cleanup.
hostScenario("disconnect-in-flight", async () => {
  const host = new TestHost();
  host.handle("osd.show", (p) =>
    p.text === "slow" ? new Promise(() => {}) : undefined,
  );
  let bye: Promise<Json> | undefined;
  let plugin!: Plugin;
  const { disconnect } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.onDispose((info) => {
        log.push(["dispose", toJson(info)]);
        bye = outcome(p.osd.show("bye"));
      });
    },
    { capabilities: ["ui.osd"], host },
  );
  const log = watch(host);
  const slow = outcome(plugin.osd.show("slow"));
  await sleep(10);
  const queued = outcome(plugin.osd.show("queued"));
  log.push(["mark", "disconnect"]);
  await disconnect();
  log.push(["mark", "disconnected"]);
  const after = await outcome(plugin.osd.show("after"));
  return scrub(
    {
      timeline: log,
      slow: await slow,
      queued: await queued,
      after,
      bye: (await bye) ?? null,
      stopReason: plugin.stopReason ?? null,
      calls: host.calls.map((c) => ({
        method: c.method,
        params: toJson(c.params),
      })),
      osd: toJson(host.osd),
    },
    host,
  );
});

// `commands.register` answers, then the host pushes `commands.keys` from a
// queued microtask: where that lands against the answer, the plugin's
// `onKeysChange` and a `settle()` started at once; then a rebinding and an
// unregistration.
hostScenario("register-keys-settle", async () => {
  const host = new TestHost();
  const log = watch(host);
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      p.commands.add({
        id: "first",
        title: "First",
        bindings: ["F"],
        run() {},
      });
      p.commands.onKeysChange(() => log.push(["plugin", "onKeysChange"]));
    },
    { capabilities: ["commands"], host },
  );
  log.push(["mark", "started", toJson(plugin.commands.keys("first"))]);
  const late = plugin.commands.add({
    id: "late",
    title: "Late",
    bindings: ["L"],
    run() {},
  });
  log.push(["mark", "added late", toJson(plugin.commands.keys("late"))]);
  await host.settle().then(() => log.push(["mark", "settled"]));
  log.push(["mark", "keys", toJson(plugin.commands.keys("late"))]);
  host.rebind("first", ["G"]);
  log.push(["mark", "rebound"]);
  await host.settle();
  log.push(["mark", "keys", toJson(plugin.commands.keys("first"))]);
  await late.dispose();
  log.push(["mark", "disposed late"]);
  await host.settle();
  log.push(["mark", "settled"]);
  await stop();
  return scrub({ timeline: log }, host);
});

// `press` through a binding: the claim, the command, `commands.execute`,
// what the run sends; a disabled command with and without a reason, a core
// action and a key nothing holds.
hostScenario("press", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      p.commands.add({
        id: "go",
        title: "Go",
        bindings: ["G"],
        async run() {
          log.push(["plugin", "run go"]);
          await p.osd.show("went");
          log.push(["plugin", "ran go"]);
        },
      });
      p.commands.add({
        id: "off",
        title: "Off",
        bindings: ["O"],
        enabled: false,
        reason: "Not now",
        run() {},
      });
      p.commands.add({
        id: "quiet",
        title: "Quiet",
        bindings: ["Q"],
        enabled: false,
        run() {},
      });
    },
    { capabilities: ["commands", "ui.osd"], host },
  );
  void plugin;
  const log = watch(host);
  for (const key of ["G", "O", "Q", "M", "X", "Ctrl+Alt+K"]) {
    log.push(["mark", `press ${key}`]);
    log.push(["mark", "pressed", await outcome(host.press(key))]);
  }
  await host.settle();
  const result = {
    timeline: log,
    osd: toJson(host.osd),
    muted: host.source.output.muted,
  };
  await stop();
  return scrub(result, host);
});

// `handle()` replaces a default and a missing method; `reset()` restores
// the default (or none); a plain `Error` is a lost reply.
hostScenario("handle-reset", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["clipboard"],
    host,
  });
  const log = watch(host);
  const seen: Json[] = [];
  host.handle("clipboard.writeText", () => {
    throw new HostError("failed", "denied");
  });
  seen.push(await outcome(plugin.clipboard.writeText("one")));
  host.reset("clipboard.writeText");
  seen.push(await outcome(plugin.clipboard.writeText("two")));
  seen.push(await outcome(plugin.clipboard.readText()));
  host.handle("clipboard.readText", () => {
    throw new Error("lost");
  });
  seen.push(await outcome(plugin.clipboard.readText()));
  host.reset("clipboard.readText");
  seen.push(await outcome(plugin.clipboard.readText()));
  seen.push(await outcome(host.request("no.such")));
  host.handle("no.such", (p) => ({ echoed: p }));
  seen.push(await outcome(host.request("no.such", { a: 1 })));
  host.reset("no.such");
  seen.push(await outcome(host.request("no.such")));
  host.reset("never.handled");
  const result = {
    seen,
    timeline: log,
    clipboard: toJson(host.clipboard),
  };
  await stop();
  return scrub(result, host);
});

// A stream producer: its socket (or pipe) in the host's scratch directory,
// released by `stream.stop()`, the directory removed by `stop()` (`close`).
hostScenario("producer-lifecycle", async () => {
  const host = new TestHost();
  const scratch = dirname(host.dataDirectory);
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: [
      "playback.read",
      "playback.control",
      "events",
      "producer.av",
    ],
    host,
  });
  const facts: Record<string, Json> = {
    scratchPrefix: basename(scratch).replace(/[^-]+$/, "*"),
    scratchExists: existsSync(scratch),
  };
  const stream = await plugin.player.openStream({
    width: 2,
    height: 2,
    frame: () => ({ video: new Uint8Array(16), audio: new Float32Array(1600) }),
  });
  const producers = [...host.producers.values()];
  const producer = producers[0]!;
  Object.assign(facts, {
    producers: producers.length,
    id: producer.id,
    socketInScratch:
      producer.path.startsWith(scratch) ||
      producer.path.includes(`${basename(scratch)}-producer-`),
    // `producer-1.sock` in the directory, or the pipe `<scratch>-producer-1`.
    socketName: producer.path
      .replace(/^.*[\\/]/, "")
      .replace(/^.*-(?=producer-)/, "")
      .replace(/\.sock$/, ""),
    listening: producer.server.listening,
    sourceKind: host.source.kind,
    entries: readdirSync(scratch)
      .filter((name) => !name.endsWith(".sock"))
      .sort(),
  });
  await stream.stop();
  Object.assign(facts, {
    releasedAfterStreamStop: producer.released,
    listeningAfterStreamStop: producer.server.listening,
    phase: host.source.phase,
  });
  await stop();
  Object.assign(facts, {
    listeningAfterClose: producer.server.listening,
    scratchExistsAfterClose: existsSync(scratch),
    methods: [
      ...new Set(host.calls.map((c) => c.method).filter((m) => !POLLED.has(m))),
    ].sort(),
  });
  return scrub(facts, host);
});

// `startPlugin` when another plugin holds a file type (`taken`: not an
// activation failure) and when the plugin conflicts with itself (one).
hostScenario("start-taken", async () => {
  const resolve = async () => ({
    kind: "stream" as const,
    width: 2,
    height: 2,
    frame: () => ({ video: new Uint8Array(16), audio: new Float32Array(1600) }),
  });
  const capabilities = [
    "playback.read",
    "playback.control",
    "events",
    "source.resolve",
    "producer.av",
    "commands",
  ];
  const host = new TestHost();
  host.otherResolvers.push({ owner: "other.plugin", extensions: ["nes"] });
  let ready: Promise<Json> | undefined;
  const started = await outcome(
    startPlugin(
      (p: Plugin) => {
        const resolver = p.resolvers.add({
          id: "emu",
          extensions: ["gb", "nes"],
          resolve,
        });
        ready = outcome(resolver.ready);
        p.commands.add({ id: "still", title: "Still", run() {} });
      },
      { capabilities, host },
    ).then(async ({ stop }) => {
      await stop();
      return "started";
    }),
  );
  const taken = {
    started,
    ready: (await ready) ?? null,
    resolvers: host.resolvers.size,
    commands: [...host.commands.keys()],
    methods: host.calls.map((c) => c.method),
  };
  const own = new TestHost();
  const failed = await outcome(
    startPlugin(
      (p: Plugin) => {
        p.resolvers.add({ id: "a", extensions: ["gb"], resolve });
        p.resolvers.add({ id: "b", extensions: ["gb"], resolve });
      },
      { capabilities, host: own },
    ).then(async ({ stop }) => {
      await stop();
      return "started";
    }),
  );
  const conflict = {
    started: failed,
    resolvers: [...own.resolvers.keys()],
    methods: own.calls.map((c) => c.method),
  };
  own.close();
  return scrub({ taken, conflict }, host);
});

// `VESTRA_PLUGIN_RESIDENCY=1` (`vestra-plugin test`): the line why the
// plugin keeps running, printed once per plugin and reasons.
hostScenario("residency-told", async () => {
  const saved = process.env.VESTRA_PLUGIN_RESIDENCY;
  const print = console.log;
  const printed: Json[] = [];
  console.log = (...args: unknown[]) => {
    printed.push(args.map(String).join(" "));
  };
  const runs: Json[] = [];
  try {
    const start = async (extra: boolean, id = "test.residency") => {
      const { host, stop } = await startPlugin(
        (p: Plugin) => {
          p.player.onChange(() => {});
          if (extra) p.window.onChange(() => {});
        },
        { capabilities: ["events", "playback.read"], id },
      );
      runs.push(toJson(host.keepsRunning));
      await stop();
    };
    delete process.env.VESTRA_PLUGIN_RESIDENCY;
    await start(false);
    printed.push("-- residency on");
    process.env.VESTRA_PLUGIN_RESIDENCY = "1";
    await start(false);
    await start(false);
    await start(true);
    await start(true);
    await start(false, "test.residency.other");
    await startPlugin(() => {}, { capabilities: [], id: "test.idle" }).then(
      ({ host, stop }) => {
        runs.push(toJson(host.keepsRunning));
        return stop();
      },
    );
  } finally {
    console.log = print;
    if (saved === undefined) delete process.env.VESTRA_PLUGIN_RESIDENCY;
    else process.env.VESTRA_PLUGIN_RESIDENCY = saved;
  }
  return scrub({ printed, runs });
});

// A host made and never started: the temporary directories it creates
// (counted at `mkdtempSync`), what is left until `close()`, and a second
// `close()`.
hostScenario("never-started", async () => {
  const real = { mkdtempSync: fs.mkdtempSync, rmSync: fs.rmSync };
  const made: Json[] = [];
  const removed: Json[] = [];
  fs.mkdtempSync = ((prefix: string, options?: never) => {
    made.push(basename(prefix));
    return real.mkdtempSync(prefix, options);
  }) as typeof fs.mkdtempSync;
  fs.rmSync = ((path: string, options?: never) => {
    removed.push({ options: toJson(options) });
    return real.rmSync(path, options);
  }) as typeof fs.rmSync;
  syncBuiltinESMExports();
  try {
    const host = new TestHost();
    const scratch = dirname(host.dataDirectory);
    const constructed = {
      made: [...made],
      dataDirectoryIn: basename(host.dataDirectory),
      scratchExists: existsSync(scratch),
      entries: readdirSync(scratch),
      dataDirectoryExists: existsSync(host.dataDirectory),
      manifestId: host.manifestId,
      calls: host.calls.length,
    };
    const second = new TestHost();
    const afterSecond = { made: made.length };
    host.close();
    const closed = {
      scratchExists: existsSync(scratch),
      removed: [...removed],
    };
    host.close();
    second.close();
    return scrub({
      constructed,
      afterSecond,
      closed,
      closedTwice: { removed: removed.length },
      secondLeft: existsSync(dirname(second.dataDirectory)),
    });
  } finally {
    fs.mkdtempSync = real.mkdtempSync;
    fs.rmSync = real.rmSync;
    syncBuiltinESMExports();
  }
});

test("every trace fixture belongs to a scenario", () => {
  if (!existsSync(FIXTURES)) return;
  const known = new Set(
    [...scenarios, ...builtins].map((s) => `${s.name.replace("/", "-")}.json`),
  );
  for (const name of HOST_SCENARIOS) known.add(`host-${name}.json`);
  for (const file of readdirSync(FIXTURES))
    assert.ok(known.has(file), `${file} has no scenario in this test`);
});
