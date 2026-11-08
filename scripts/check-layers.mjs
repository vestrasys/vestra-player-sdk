#!/usr/bin/env node
/**
 * The layer rule of the SDK refactor (doc/specs/sdk-refactor.md §2.1 in the
 * player repository): the protocol (L0) and the primitives (L1) never
 * import the framework (L2). Run by `npm run check`; exits 1 and names
 * each forbidden import.
 *
 *   1. No file of `LOWER` imports a file of `FRAMEWORK`, by value or as a
 *      type (`import`, `import type`, `export … from`, `import()`).
 *   2. No file of `LOWER` reaches `src/plugin/passes.ts` through a chain of
 *      value imports, whatever files lie between.
 *   3. No value-import cycle among the files under `src/` (the one between
 *      `player.ts` and `stream.ts` is gone), except the cycles named in
 *      `KNOWN_CYCLES`; a known cycle that no longer exists fails too.
 *   4. Every relative import names a `.ts` file under `src/`: one the
 *      check cannot resolve (`./passes.js`, a typo) fails instead of being
 *      skipped, so no import escapes rules 1–3.
 *
 * Not checked yet: spec §2.1's second rule, that `src/plugin/**` reaches
 * the wire only through `connection.ts`, waits until `src/wire/` exists
 * (batches C/G). Edges from L1 into L2 that the lists cannot see while
 * `player.ts` holds both the player's primitives and its state mirror are
 * named in `PENDING` and printed as a note on every run; the `player.ts`
 * split must empty that list.
 *
 * The lists name files as they are now; a later batch that moves or splits
 * one (views, commands, services, types) updates them. A listed file that
 * does not exist fails the check, so the lists cannot go stale unnoticed.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
/** @type {import("typescript")} */
const ts = createRequire(join(root, "package.json"))("typescript");

/** L0 (the wire and its per-domain clients) and L1 (primitives, helpers). */
const LOWER = [
  // L0
  "src/wire.ts",
  "src/source.ts",
  "src/source-resolvers.ts",
  "src/commands.ts",
  "src/processing.ts",
  "src/media.ts",
  "src/producer.ts",
  "src/subtitles.ts",
  // L1
  "src/plugin/errors.ts",
  "src/plugin/latest.ts",
  "src/plugin/connection.ts",
  "src/plugin/values.ts",
  "src/plugin/stream.ts",
  "src/plugin/services.ts",
  "src/plugin/local.ts",
  "src/plugin/osd.ts",
  "src/plugin/bindings.ts",
  "src/plugin/language.ts",
  "src/plugin/packages.ts",
  "src/plugin/markdown.ts",
  "src/plugin/drops.ts",
];
/** L2 modules no lower file may import: the passes, and `Runtime` over them. */
const FRAMEWORK = ["src/plugin/passes.ts", "src/plugin/runtime.ts"];
const PASSES = "src/plugin/passes.ts";
/**
 * Value-import cycles allowed by rule 3, each as its set of files:
 * `TestHost`'s area modules (batch A) call each other's functions.
 */
const KNOWN_CYCLES = [
  [
    "src/plugin/testing/core-actions.ts",
    "src/plugin/testing/media.ts",
    "src/plugin/testing/layout.ts",
  ],
];
/**
 * L1 → L2 edges the rules above cannot see yet, because `player.ts` is
 * both a primitive (actions, `openStream`) and the framework's state
 * mirror (`PlayerService`). Printed as a note, not a failure; `text` must
 * still be in `file` (else the entry is stale and fails). The `player.ts`
 * split (Step 1 later batch, Step 2) must empty this list.
 */
const PENDING = [
  {
    file: "src/plugin/services.ts",
    text: 'import { playerOf, validStep } from "./player.ts";',
    what: "value import of player.ts; an action refreshes the state mirror (playerOf(...).refresh())",
  },
  {
    file: "src/plugin/stream.ts",
    text: 'import type { PlayerService } from "./player.ts";',
    what: "openStream reads the state mirror (PlayerService raw/state, refresh)",
  },
  {
    file: "src/plugin/packages.ts",
    text: "this.#scope.update();",
    what: "an operation's end runs a full update pass (scope.update())",
  },
];

/** Every `.ts` file under `src/`, as a path relative to the root with `/`. */
function sources(directory = join(root, "src")) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sources(path));
    else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts"))
      files.push(path);
  }
  return files;
}
const name = (path) => relative(root, path).replaceAll("\\", "/");

/** A file's relative imports: `{ specifier, target, type, line }`. */
function importsOf(file) {
  const text = readFileSync(join(root, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (specifier, type, node) => {
    if (!ts.isStringLiteralLike(specifier)) return;
    const path = specifier.text;
    if (!path.startsWith(".")) return;
    found.push({
      specifier: path,
      target: name(resolve(root, dirname(file), path)),
      type,
      line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
    });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node))
      add(node.moduleSpecifier, node.importClause?.isTypeOnly === true, node);
    else if (ts.isExportDeclaration(node) && node.moduleSpecifier)
      add(node.moduleSpecifier, node.isTypeOnly, node);
    else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0]
    )
      add(node.arguments[0], false, node);
    else if (ts.isImportTypeNode(node)) {
      const literal = node.argument;
      if (ts.isLiteralTypeNode(literal)) add(literal.literal, true, node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

const files = sources().map(name);
const graph = new Map(files.map((file) => [file, importsOf(file)]));
const problems = [];

for (const file of [...LOWER, ...FRAMEWORK])
  if (!existsSync(join(root, file)))
    problems.push(`${file} is listed in scripts/check-layers.mjs but missing`);

// 4. Relative imports the check cannot follow.
for (const [file, imports] of graph)
  for (const { specifier, target, line } of imports)
    if (!graph.has(target))
      problems.push(
        `${file}:${line} imports "${specifier}", which is not a .ts file under src/: the layer check cannot follow it`,
      );

// 1. Direct imports of the framework.
for (const file of LOWER)
  for (const { target, type, line } of graph.get(file) ?? [])
    if (FRAMEWORK.includes(target))
      problems.push(
        `${file}:${line} imports ${target}${type ? " (type)" : ""}: L0/L1 must not import the framework (L2)`,
      );

// 2. Value-import chains to the pass scheduler.
const values = (file) =>
  (graph.get(file) ?? [])
    .filter((each) => !each.type)
    .map((each) => each.target);
for (const file of LOWER) {
  const from = new Map([[file, null]]);
  const queue = [file];
  while (queue.length) {
    const at = queue.shift();
    if (at === PASSES) {
      const chain = [];
      for (let step = at; step !== null; step = from.get(step))
        chain.unshift(step);
      problems.push(
        `${file} loads ${PASSES} through value imports: ${chain.join(" → ")}`,
      );
      break;
    }
    for (const next of values(at))
      if (!from.has(next)) {
        from.set(next, at);
        queue.push(next);
      }
  }
}

// 3. Value-import cycles (one report per cycle, from its first file).
const cycleKey = (cycle) => [...cycle].sort().join("|");
const known = new Set(KNOWN_CYCLES.map(cycleKey));
const state = new Map();
const stack = [];
const cycles = new Set();
function walk(file) {
  state.set(file, "open");
  stack.push(file);
  for (const next of values(file)) {
    if (state.get(next) === "open") {
      const cycle = stack.slice(stack.indexOf(next));
      const key = cycleKey(cycle);
      if (!cycles.has(key)) {
        cycles.add(key);
        if (!known.has(key))
          problems.push(`value-import cycle: ${[...cycle, next].join(" → ")}`);
      }
    } else if (!state.has(next) && graph.has(next)) walk(next);
  }
  stack.pop();
  state.set(file, "done");
}
for (const file of files) if (!state.has(file)) walk(file);
for (const cycle of KNOWN_CYCLES)
  if (!cycles.has(cycleKey(cycle)))
    problems.push(
      `KNOWN_CYCLES lists ${cycle.join(", ")}, which no longer form a cycle: remove the entry`,
    );

// Pending edges: a note each run; a stale entry fails.
for (const { file, text } of PENDING) {
  const path = join(root, file);
  if (!existsSync(path) || !readFileSync(path, "utf8").includes(text))
    problems.push(
      `PENDING entry for ${file} is stale (${JSON.stringify(text)} not found): remove it`,
    );
}
const pending = PENDING.map(({ file, what }) => `${file}: ${what}`);
console.log(
  `check-layers note: ${PENDING.length} pending L1→L2 edge(s) until player.ts is split: ${pending.join("; ")}`,
);

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(
    `check-layers: ${problems.length} problem(s); the layer rule is doc/specs/sdk-refactor.md §2.1 in the player repository`,
  );
  process.exit(1);
}
console.log(
  `check-layers: ${LOWER.length} L0/L1 files, none imports ${FRAMEWORK.join(" or ")}; no value-import cycle in src/ beyond KNOWN_CYCLES; every relative import resolved`,
);
