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
 *      `player.ts` and `stream.ts` is gone), the test host's area modules
 *      (`src/plugin/testing/`, one class split into files) left out.
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
/** Left out of rule 3: `TestHost`'s area modules call each other's functions. */
const CYCLES_EXEMPT = "src/plugin/testing/";

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

/** A file's relative imports: `{ target, type, line }`. */
function importsOf(file) {
  const text = readFileSync(join(root, file), "utf8");
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const found = [];
  const add = (specifier, type, node) => {
    if (!ts.isStringLiteralLike(specifier)) return;
    const path = specifier.text;
    if (!path.startsWith(".")) return;
    found.push({
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
const state = new Map();
const stack = [];
const cycles = new Set();
function walk(file) {
  state.set(file, "open");
  stack.push(file);
  for (const next of values(file)) {
    if (state.get(next) === "open") {
      const cycle = stack.slice(stack.indexOf(next));
      const key = [...cycle].sort().join("|");
      if (!cycles.has(key)) {
        cycles.add(key);
        problems.push(`value-import cycle: ${[...cycle, next].join(" → ")}`);
      }
    } else if (
      !state.has(next) &&
      graph.has(next) &&
      !next.startsWith(CYCLES_EXEMPT)
    )
      walk(next);
  }
  stack.pop();
  state.set(file, "done");
}
for (const file of files)
  if (!file.startsWith(CYCLES_EXEMPT) && !state.has(file)) walk(file);

if (problems.length) {
  for (const problem of problems) console.error(problem);
  console.error(
    `check-layers: ${problems.length} problem(s); the layer rule is doc/specs/sdk-refactor.md §2.1 in the player repository`,
  );
  process.exit(1);
}
console.log(
  `check-layers: ${LOWER.length} L0/L1 files, none imports ${FRAMEWORK.join(" or ")}; no value-import cycle in src/ (testing/ aside)`,
);
