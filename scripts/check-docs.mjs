#!/usr/bin/env node
/**
 * Checks that the code shown in the documentation compiles, and that the
 * documents have not drifted from the code:
 *
 *   node scripts/check-docs.mjs [--strict] [--verbose]
 *
 * Snippets: every ```ts block in README.md and docs/**\/*.md, and every ```ts
 * block inside an `@example` of a doc comment in src/, is written to
 * .tmp/snippets/ and type checked against src/ (the package's own entry
 * points are mapped to src/, so no build is needed).
 *
 * - A block with `import` or `export` statements is a module and checked
 *   as it is; a relative import of `../main.ts` resolves to a stub plugin.
 * - Any other block is wrapped in an async function, with `plugin: Plugin`
 *   and every type the SDK exports in scope, so it may use `await` and
 *   `return`.
 * - ```ts nocheck marks a block that is deliberately incomplete.
 *
 * Errors in Markdown blocks fail the check. Errors in `@example` blocks are
 * reported as warnings until the reference rewrite fixes them; `--strict`
 * makes them fail too.
 *
 * Drift: the README Quick start equals examples/hello (main.ts verbatim,
 * manifest.json as JSON); every "Node N" / "Node.js N" in README.md and
 * docs/ names the `engines.node` major version; every
 * `"@vestra-player/sdk": "^x.y.z"` in the documents names the current
 * major.minor version.
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const strict = process.argv.includes("--strict");
const verbose = process.argv.includes("--verbose");
const out = join(root, ".tmp/snippets");
const rel = (path) => relative(root, path).split("\\").join("/");
const read = (path) => readFileSync(join(root, path), "utf8");

function walk(directory, test) {
  const result = [];
  for (const item of readdirSync(join(root, directory), {
    withFileTypes: true,
  })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) result.push(...walk(path, test));
    else if (test(path)) result.push(path);
  }
  return result.sort();
}

// ── Collect the snippets ────────────────────────────────────────────────

/** ``` fences (optionally indented, as inside list items). */
function fences(text) {
  const blocks = [];
  const pattern = /^([ \t]*)```(\w*)([^\n]*)\n([\s\S]*?)^\1```[ \t]*$/gm;
  for (const match of text.matchAll(pattern)) {
    const [, indent, lang, info, body] = match;
    const line = text.slice(0, match.index).split("\n").length + 1;
    const code = body
      .split("\n")
      .map((l) => (l.startsWith(indent) ? l.slice(indent.length) : l))
      .join("\n");
    blocks.push({ lang, info: info.trim(), code, line });
  }
  return blocks;
}
const isTs = (block) =>
  ["ts", "typescript"].includes(block.lang) && !/\bnocheck\b/.test(block.info);

const snippets = [];
const documents = ["README.md", ...walk("docs", (p) => p.endsWith(".md"))];
let skipped = 0;
for (const path of documents)
  for (const block of fences(read(path))) {
    if (["ts", "typescript"].includes(block.lang) && !isTs(block)) skipped++;
    if (isTs(block))
      snippets.push({
        kind: "markdown",
        source: path,
        line: block.line,
        code: block.code,
      });
  }

/** ```ts blocks inside the `@example` sections of /** comments. */
for (const path of walk("src", (p) => p.endsWith(".ts"))) {
  const text = read(path);
  for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const startLine = text.slice(0, comment.index).split("\n").length;
    const lines = comment[0]
      .split("\n")
      .map((l) => l.replace(/^\s*\*?\s?/, ""));
    let inExample = false;
    let fence = null;
    lines.forEach((line, index) => {
      if (fence) {
        if (/^```\s*$/.test(line)) {
          if (inExample && fence.ts)
            snippets.push({
              kind: "example",
              source: path,
              line: startLine + fence.start + 1,
              code: fence.lines.join("\n"),
            });
          fence = null;
        } else fence.lines.push(line);
        return;
      }
      const open = /^```(\w*)(.*)$/.exec(line);
      if (open) {
        fence = {
          ts: isTs({ lang: open[1], info: open[2] }),
          start: index,
          lines: [],
        };
        if (["ts", "typescript"].includes(open[1]) && !fence.ts && inExample)
          skipped++;
        return;
      }
      const tag = /^@(\w+)/.exec(line);
      if (tag) inExample = tag[1] === "example";
    });
  }
}

// ── Write and type check them ───────────────────────────────────────────

const sdkEntry = join(root, "src/index.ts");
const testingEntry = join(root, "src/plugin/testing.ts");

/** Every name the public entry points export (types and values). */
function exportedNames() {
  const program = ts.createProgram([sdkEntry, testingEntry], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2023,
    allowImportingTsExtensions: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const checker = program.getTypeChecker();
  const names = (file) => {
    const symbol = checker.getSymbolAtLocation(program.getSourceFile(file));
    return symbol ? checker.getExportsOfModule(symbol).map((s) => s.name) : [];
  };
  const sdk = names(sdkEntry).filter((name) => name !== "default");
  const testing = names(testingEntry).filter(
    (name) => name !== "default" && !sdk.includes(name),
  );
  return { sdk, testing };
}

const exported = exportedNames();
const prelude = [
  `import type { ${exported.sdk.join(", ")} } from "@vestra-player/sdk";`,
  ...(exported.testing.length
    ? [
        `import { ${exported.testing.join(", ")} } from "@vestra-player/sdk/testing";`,
      ]
    : []),
  "declare const plugin: Plugin;",
  "export async function snippet() {",
];

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "tests"), { recursive: true });
writeFileSync(join(out, "package.json"), '{ "type": "module" }\n');
writeFileSync(
  join(out, "main.ts"),
  [
    'import type { Plugin } from "@vestra-player/sdk";',
    "export default async function activate(plugin: Plugin): Promise<void> {",
    "  void plugin;",
    "}",
    "",
  ].join("\n"),
);

const files = new Map();
snippets.forEach((snippet, index) => {
  const module = /^\s*(import|export)\s/m.test(snippet.code);
  const name = `${snippet.source.replace(/[^\w]+/g, "_")}_${snippet.line}_${index}.ts`;
  const file = join(out, "tests", name);
  const text = module
    ? snippet.code
    : [...prelude, snippet.code, "}", ""].join("\n");
  writeFileSync(file, text);
  files.set(resolve(file), { ...snippet, offset: module ? 0 : prelude.length });
});

const program = ts.createProgram([...files.keys()], {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  strict: true,
  noEmit: true,
  allowImportingTsExtensions: true,
  skipLibCheck: true,
  types: ["node"],
  typeRoots: [join(root, "node_modules/@types")],
  paths: {
    "@vestra-player/sdk": [sdkEntry],
    "@vestra-player/sdk/testing": [testingEntry],
  },
});

const failures = { markdown: [], example: [], other: [] };
for (const diagnostic of ts.getPreEmitDiagnostics(program)) {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  const file = diagnostic.file && resolve(diagnostic.file.fileName);
  const snippet = file && files.get(file);
  if (!snippet) {
    failures.other.push(`${file ? rel(file) : "tsc"}: ${message}`);
    continue;
  }
  const { line } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start ?? 0,
  );
  const at = snippet.line + line - snippet.offset;
  failures[snippet.kind].push({
    at: `${snippet.source}:${at}`,
    message,
    snippet,
  });
}

// ── Drift checks ────────────────────────────────────────────────────────

const drift = [];
const pkg = JSON.parse(read("package.json"));
const nodeMajor = /(\d+)/.exec(pkg.engines.node)[1];
const [major, minor] = pkg.version.split(".");

{
  const readme = read("README.md");
  const start = readme.indexOf("## Quick start");
  const end = readme.indexOf("\n## ", start + 1);
  const quick = fences(readme.slice(start, end));
  const main = quick.find((b) => b.lang === "ts");
  const manifest = quick.find((b) => b.lang === "json");
  if (!main || main.code.trim() !== read("examples/hello/main.ts").trim())
    drift.push(
      "README.md Quick start: main.ts differs from examples/hello/main.ts",
    );
  let same = false;
  try {
    same =
      JSON.stringify(JSON.parse(manifest.code)) ===
      JSON.stringify(JSON.parse(read("examples/hello/manifest.json")));
  } catch {}
  if (!same)
    drift.push(
      "README.md Quick start: manifest.json differs from examples/hello/manifest.json",
    );
}

for (const path of [...documents, "examples/README.md"]) {
  const text = read(path);
  for (const match of text.matchAll(
    /\bNode(?:\.js)?\s+(?:>=\s*|≥\s*)?(\d+)(?:\.\d+)?/g,
  ))
    if (match[1] !== nodeMajor)
      drift.push(
        `${path}: "${match[0]}" but engines.node is ${pkg.engines.node}`,
      );
  for (const match of text.matchAll(
    /"@vestra-player\/sdk":\s*"\^(\d+)\.(\d+)\.\d+"/g,
  ))
    if (match[1] !== major || match[2] !== minor)
      drift.push(`${path}: ${match[0]} but the SDK is ${pkg.version}`);
}

// ── Report ──────────────────────────────────────────────────────────────

const count = (kind) => snippets.filter((s) => s.kind === kind).length;
const failed = (kind) => new Set(failures[kind].map((f) => f.snippet)).size;
for (const { at, message } of failures.markdown)
  console.error(`::error file=${at}::${message}`);
for (const line of failures.other) console.error(`::error::${line}`);
for (const line of drift) console.error(`::error::drift: ${line}`);
const exampleLevel = strict ? "error" : "warning";
if (verbose || strict)
  for (const { at, message } of failures.example)
    console.error(`::${exampleLevel} file=${at}::${message}`);
else if (failures.example.length) {
  const bySource = new Map();
  for (const { snippet } of failures.example)
    bySource.set(
      snippet.source,
      (bySource.get(snippet.source) ?? new Set()).add(snippet),
    );
  for (const [source, set] of bySource)
    console.warn(
      `warning: ${source}: ${set.size} @example block(s) do not compile`,
    );
  console.warn("(run with --verbose for every error)");
}

console.log(
  [
    `Markdown: ${count("markdown")} ts blocks, ${failed("markdown")} failing`,
    `@example: ${count("example")} ts blocks, ${failed("example")} failing (${strict ? "errors" : "warnings only"})`,
    `nocheck blocks skipped: ${skipped}`,
    `drift problems: ${drift.length}`,
  ].join("\n"),
);

if (
  failures.markdown.length ||
  failures.other.length ||
  drift.length ||
  (strict && failures.example.length)
)
  process.exit(1);
