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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
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

test("every trace fixture belongs to a scenario", () => {
  if (!existsSync(FIXTURES)) return;
  const known = new Set(
    [...scenarios, ...builtins].map((s) => `${s.name.replace("/", "-")}.json`),
  );
  for (const file of readdirSync(FIXTURES))
    assert.ok(known.has(file), `${file} has no scenario in this test`);
});
