#!/usr/bin/env node
/**
 * The layer rule of the SDK refactor (doc/specs/sdk-refactor.md §2.1 in the
 * player repository): the protocol (L0) and the primitives (L1) never
 * import the framework (L2). Run by `npm run check`; exits 1 and names
 * each forbidden import.
 *
 *   1. No file of `LOWER` imports a file of `FRAMEWORK`, by value or as a
 *      type (`import`, `import type`, `export … from`, `import()`).
 *   2. No file of `LOWER` reaches a file of `FRAMEWORK` through a chain of
 *      value imports, whatever files lie between (an L1 file that loads
 *      `view/base.ts` loads `view/binder.ts` and the passes with it).
 *   3. No value-import cycle among the files under `src/` (the one between
 *      `player.ts` and `stream.ts` is gone), except the cycles named in
 *      `KNOWN_CYCLES`; a known cycle that no longer exists fails too.
 *   4. Every relative import names a `.ts` file under `src/`: one the
 *      check cannot resolve (`./passes.js`, a typo) fails instead of being
 *      skipped, so no import escapes rules 1–3.
 *   5. The plugin API types (`TYPE_ONLY`: `src/plugin/types.ts` and
 *      `src/plugin/types/*.ts`) are neither L1 nor L2: they declare only
 *      interfaces and type aliases and import and re-export only with
 *      `import type` / `export type`, so they load nothing at run time and
 *      the cycles among them are type-only (rule 3 ignores those).
 *   6. No file of `LOWER` calls the passes by name through an object it
 *      holds, which rules 1–2 cannot see (`CALLS`): `.update()` on any
 *      object, `.passes`, `invalidate`, `depends`, `reading`, `part`,
 *      `observe`, `reader`, `needsFull` on any object but `signals`, and
 *      `runtime.bind` / `runtime.changed`. A textual check: an alias
 *      through destructuring (`const { invalidate } = runtime`) or a call
 *      of a function value is not seen; review keeps to the rule there. A primitive
 *      tells the framework through the connection's `signals` and
 *      `rereads` instead (SDK 1.7.0). Running plugin code (`scope.run`)
 *      is not such a call: it is how a primitive hands control to plugin
 *      code, and the scope decides what follows.
 *
 * Not checked yet: spec §2.1's second rule, that `src/plugin/**` reaches
 * the wire only through `connection.ts`, waits until `src/wire/` exists
 * (batches C/G). `PENDING` names L1 → L2 edges the rules cannot see yet;
 * each is printed as a note on every run and fails once its code is gone.
 * It is empty since Step 2 (SDK 1.7.0) routed the last three through L1.
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
  "src/plugin/services/dialogs.ts",
  "src/plugin/view/image.ts",
  "src/plugin/view/writer.ts",
  "src/plugin/player/events.ts",
  "src/plugin/player/rules.ts",
];
/**
 * L2 modules no lower file may import: the passes, `Runtime` over them, the
 * view binder (`bind`/`snapshot`/`evaluate` over the view writer), the
 * player's state copy (`PlayerService` in `player.ts`) and `plugin.state`.
 */
const FRAMEWORK = [
  "src/plugin/passes.ts",
  "src/plugin/runtime.ts",
  "src/plugin/view/binder.ts",
  "src/plugin/player.ts",
  "src/plugin/state.ts",
];
/** Rule 6: calls of the passes by name, as they read in source. */
const CALLS = [
  // `update()` on anything (a scope, `plugin`, an alias of either).
  /\.update\(\)/,
  // The pass scheduler itself, however reached.
  /\.passes\b/,
  // Its methods on any object but the connection's `signals`, which is
  // the allowed way (`signals.invalidate()`).
  /(?<!\bsignals)\.(?:invalidate|depends|reading|part|observe|reader|needsFull)\(/,
  // Names other objects use too (`Function.bind`): on a runtime only.
  /\bruntime\.(?:bind|changed)\(/,
];
/** Rule 5: files of types only (an entry ending in `/` is a directory). */
const TYPE_ONLY = ["src/plugin/types.ts", "src/plugin/types/"];
const typeOnly = (file) =>
  TYPE_ONLY.some((entry) =>
    entry.endsWith("/") ? file.startsWith(entry) : file === entry,
  );

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
 * L1 → L2 edges the rules above cannot see yet: `{ file, text, what }`,
 * printed as a note, not a failure; `text` must still be in `file` (else
 * the entry is stale and fails). Empty since SDK 1.7.0 (refactor Step 2):
 * `services.ts` asks the connection to read the player's state again
 * (`rereads`), `stream.ts` uses its own `StreamSource` shape that the
 * player's state copy fills, and `packages.ts` tells the passes through the
 * connection's `signals`; rule 6 and `player.ts` in `FRAMEWORK` keep it so.
 */
/** @type {{ file: string, text: string, what: string }[]} */
const PENDING = [];

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

// 2. Value-import chains to the framework.
const values = (file) =>
  (graph.get(file) ?? [])
    .filter((each) => !each.type)
    .map((each) => each.target);
for (const file of LOWER) {
  const from = new Map([[file, null]]);
  const queue = [file];
  while (queue.length) {
    const at = queue.shift();
    if (FRAMEWORK.includes(at) && at !== file) {
      const chain = [];
      for (let step = at; step !== null; step = from.get(step))
        chain.unshift(step);
      problems.push(
        `${file} loads ${at} through value imports: ${chain.join(" → ")}`,
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

// 5. Type-only files: no value import, no runtime statement.
for (const entry of TYPE_ONLY)
  if (!existsSync(join(root, entry)))
    problems.push(`${entry} is listed in TYPE_ONLY but missing`);
for (const file of files.filter(typeOnly)) {
  const text = readFileSync(join(root, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    // Every import and re-export, relative or not (`node:util` too).
    const allowed = ts.isImportDeclaration(statement)
      ? statement.importClause?.isTypeOnly === true
      : ts.isExportDeclaration(statement)
        ? statement.isTypeOnly
        : ts.isInterfaceDeclaration(statement) ||
          ts.isTypeAliasDeclaration(statement);
    if (allowed) continue;
    const at = source.getLineAndCharacterOfPosition(statement.getStart());
    const first = statement.getText(source).split("\n")[0];
    problems.push(
      `${file}:${at.line + 1}: "${first}": the API types hold interfaces and type aliases only, with \`import type\` / \`export type\``,
    );
  }
}

// 6. Calls of the passes by name from L0/L1 (comments left out).
for (const file of LOWER) {
  const path = join(root, file);
  if (!existsSync(path)) continue;
  const lines = readFileSync(path, "utf8").split("\n");
  lines.forEach((line, at) => {
    const code = line.replace(/\/\/.*$/, "");
    if (/^\s*(\/\*\*?|\*)/.test(code)) return;
    for (const call of CALLS)
      if (call.test(code))
        problems.push(
          `${file}:${at + 1}: calls the update passes (${code.trim()}); tell them through the connection's signals`,
        );
  });
}

// Pending edges: a note each run; a stale entry fails.
for (const { file, text } of PENDING) {
  const path = join(root, file);
  if (!existsSync(path) || !readFileSync(path, "utf8").includes(text))
    problems.push(
      `PENDING entry for ${file} is stale (${JSON.stringify(text)} not found): remove it`,
    );
}
if (PENDING.length) {
  const pending = PENDING.map(({ file, what }) => `${file}: ${what}`);
  console.log(
    `check-layers note: ${PENDING.length} pending L1→L2 edge(s): ${pending.join("; ")}`,
  );
}

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(
    `check-layers: ${problems.length} problem(s); the layer rule is doc/specs/sdk-refactor.md §2.1 in the player repository`,
  );
  process.exit(1);
}
console.log(
  `check-layers: ${LOWER.length} L0/L1 files, none imports ${FRAMEWORK.join(" or ")}; no value-import cycle in src/ beyond KNOWN_CYCLES; every relative import resolved; ${files.filter(typeOnly).length} files of types only`,
);
