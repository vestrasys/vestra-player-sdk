#!/usr/bin/env node
/**
 * Benchmark of the SDK's framework layer (doc/specs/sdk-refactor.md §4.0 and
 * §7 question 5 in the player repository): numbers to decide the inventory's
 * batch H (simplify move planning, field-level dependencies) with, and to
 * see that a refactor step did not slow anything down.
 *
 *   npm run bench              # medians of 5 runs
 *   npm run bench -- --runs 9  # more runs
 *
 * Three measurements, each the median of `--runs` runs (default 5):
 *
 * (a) A 20,000-row keyed list (`{ id, title, seconds }`) bound to a window.
 *     First the diff engine alone (`src/plugin/patch.ts`: `keyOf` + `diff`,
 *     the planning of a patch from the rows as sent to the new rows): the
 *     whole list changed by 1 % and by 10 % of its rows in place. Then the
 *     same changes end to end through a plugin in `TestHost`: the bind
 *     function returns the changed rows, `plugin.update()` runs a pass, the
 *     view encodes, diffs and sends the patch, the host applies it
 *     (`ui.set` with `patch`). Also the initial whole write of the 20,000 rows.
 * (b) 1,000 full passes over 50 bound windows (each bind reads a counter
 *     and the playback state) and 100 commands with function fields
 *     (`enabled` reads the counter): `plugin.update()` then one macrotask,
 *     per pass; each pass changes one window's value and every command's
 *     `enabled`, so this is the "everything re-evaluates" cost.
 * (c) `plugin.player.state` change to send latency: a window bound to
 *     `position`; `host.setSource({ position })` to the `ui.set` request
 *     that carries it (a precise pass), 200 changes per run.
 *
 * Runs against `src/` (type-stripped by Node), like `npm test`.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { diff, keyOf } from "../src/plugin/patch.ts";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf("--runs") + 1]) || 5;
const ROWS = 20_000;

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const ms = (value) => `${value.toFixed(2)} ms`;
const results = [];
const report = (name, values, unit = ms) =>
  results.push({ name, value: unit(median(values)), runs: values.length });

const rowsOf = (n, change = () => false) =>
  Array.from({ length: n }, (_, i) => ({
    id: `row-${i}`,
    title: change(i) ? `Title ${i} (changed)` : `Title ${i}`,
    seconds: (i * 37) % 7200,
  }));
/** Every `1/fraction`-th row changes, spread over the list. */
const every = (fraction) => (i) => i % Math.round(1 / fraction) === 0;

/** A plugin directory with one window file holding the properties used. */
function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "vestra-bench-"));
  writeFileSync(
    join(directory, "bench.slint"),
    [
      "export global BenchBridge {",
      "  in property <[{id: string, title: string, seconds: int}]> rows;",
      "  in property <int> tick;",
      "  in property <float> position;",
      "  in property <bool> paused;",
      "}",
      "export component Bench inherits Rectangle {}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "bench.plugin",
      capabilities: ["ui.window", "commands", "playback.read", "events"],
    }),
  );
  return directory;
}

const macrotask = () => new Promise((resolve) => setImmediate(resolve));

// ------------------------------------------------------------ (a) diff engine

function encoded(rows) {
  const keyed = keyOf(rows);
  return {
    enc: rows.map((row) => JSON.stringify(row)),
    keys: keyed?.keys ?? null,
  };
}

for (const fraction of [0.01, 0.1]) {
  const times = [];
  for (let run = 0; run < runs; run++) {
    const old = encoded(rowsOf(ROWS));
    const next = encoded(rowsOf(ROWS, every(fraction)));
    const begun = performance.now();
    const plan = diff(old, next);
    times.push(performance.now() - begun);
    if (!plan) throw new Error("diff gave up (over DIFF_OPS)");
  }
  report(
    `(a) diff engine, ${ROWS} keyed rows, ${fraction * 100} % changed`,
    times,
  );
}

// -------------------------------------------------- (a) end to end, (b), (c)

async function withPlugin(activate, body) {
  const directory = packageWith();
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 7200, position: 0 });
  const started = await startPlugin(activate, { host, directory });
  try {
    await body({ ...started, host });
  } finally {
    await started.stop();
    rmSync(directory, { recursive: true, force: true });
  }
}

/** `ui.set` requests carrying a row patch (a whole value carries `value`). */
const patches = (host) =>
  host.sent("ui.set").filter((params) => "patch" in params).length;

/** Wait until one more patch was sent, then until the host is idle. */
async function patched(host) {
  const want = patches(host) + 1;
  while (patches(host) < want) await macrotask();
  await host.settle();
}

{
  const whole = [];
  const changed = { 0.01: [], 0.1: [] };
  for (let run = 0; run < runs; run++) {
    let rows = rowsOf(ROWS);
    await withPlugin(
      (plugin) => {
        const window = plugin.windows.create("bench.slint");
        window.bind(() => ({ rows }));
        plugin.commands.add({
          id: "show",
          title: "Show",
          run: () => window.show(),
        });
      },
      async ({ host, plugin }) => {
        let begun = performance.now();
        await host.command("show").run();
        await host.settle();
        whole.push(performance.now() - begun);
        for (const fraction of [0.01, 0.1]) {
          rows = rowsOf(ROWS, every(fraction));
          begun = performance.now();
          plugin.update();
          await patched(host);
          changed[fraction].push(performance.now() - begun);
          const shown = host.window("bench").props.rows;
          if (shown.length !== ROWS || shown[0].title !== rows[0].title)
            throw new Error("the host's rows do not match after the patch");
          rows = rowsOf(ROWS);
          plugin.update();
          await patched(host);
        }
      },
    );
  }
  report(`(a) end to end, initial write of ${ROWS} rows (ui.open)`, whole);
  for (const fraction of [0.01, 0.1])
    report(
      `(a) end to end, ${fraction * 100} % rows changed: update() → pass → diff → ui.set patch applied`,
      changed[fraction],
    );
}

{
  const VIEWS = 50;
  const COMMANDS = 100;
  const PASSES = 1000;
  const times = [];
  let passes = 0;
  for (let run = 0; run < runs; run++) {
    let tick = 0;
    const windows = [];
    await withPlugin(
      (plugin) => {
        for (let i = 0; i < VIEWS; i++) {
          const window = plugin.windows.create("bench.slint", { id: `w${i}` });
          windows.push(window);
          window.bind(() => ({
            tick: i === tick % VIEWS ? tick : 0,
            paused: plugin.player.state.paused,
          }));
        }
        for (let i = 0; i < COMMANDS; i++)
          plugin.commands.add({
            id: `c${i}`,
            title: `Command ${i}`,
            enabled: () => tick % 2 === 0,
            run() {},
          });
      },
      async ({ host, plugin }) => {
        for (const window of windows) await window.show();
        await host.settle();
        const runtime = plugin.runtime;
        const before = runtime.counts.passes;
        const begun = performance.now();
        for (let i = 0; i < PASSES; i++) {
          tick++;
          plugin.update();
          await macrotask();
        }
        await host.settle();
        times.push(performance.now() - begun);
        passes = runtime.counts.passes - before;
      },
    );
  }
  report(
    `(b) ${PASSES} passes (${passes} counted), ${VIEWS} bound views, ${COMMANDS} commands with enabled()`,
    times,
  );
}

{
  const CHANGES = 200;
  const latencies = [];
  for (let run = 0; run < runs; run++) {
    await withPlugin(
      (plugin) => {
        const window = plugin.windows.create("bench.slint");
        window.bind(() => ({ position: plugin.player.state.position ?? 0 }));
        plugin.commands.add({
          id: "show",
          title: "Show",
          run: () => window.show(),
        });
      },
      async ({ host }) => {
        await host.command("show").run();
        await host.settle();
        for (let i = 1; i <= CHANGES; i++) {
          const count = host.sent("ui.set").length;
          const begun = performance.now();
          host.setSource({ position: i });
          while (host.sent("ui.set").length === count) await macrotask();
          latencies.push(performance.now() - begun);
        }
      },
    );
  }
  report(
    `(c) player.state change → precise pass → ui.set sent (${CHANGES} changes × ${runs} runs)`,
    latencies,
  );
}

console.log(
  `\n@vestra-player/sdk benchmark: median of ${runs} runs, Node ${process.version}, ${process.platform} ${process.arch}\n`,
);
for (const { name, value } of results)
  console.log(`${value.padStart(12)}  ${name}`);
