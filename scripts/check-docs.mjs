#!/usr/bin/env node
/**
 * Checks that the code shown in the documentation compiles, and that the
 * documents have not drifted from the code:
 *
 *   node scripts/check-docs.mjs [--lenient] [--verbose]
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
 * - Lines above `// ---cut---` (scripts/doc-standard.mjs `CUT`) are hidden
 *   setup: checked, not shown. A block is a module when its shown lines
 *   have `import` or `export`; otherwise its hidden lines are placed at
 *   module level, before the function, so they may `import` and `declare`.
 * - ```ts nocheck marks a block that is deliberately incomplete.
 *
 * Errors in any block fail the check (since SDK 1.5.30, when every
 * `@example` compiled). `--lenient` reports errors in `@example` blocks
 * outside the categories of scripts/doc-standard.mjs as warnings instead,
 * for work in progress; CI never passes it. `--strict` is accepted and is
 * the default.
 *
 * Drift: the README Quick start equals examples/hello (main.ts verbatim,
 * manifest.json as JSON); every "Node N" / "Node.js N" in README.md and
 * docs/ names the `engines.node` major version; every
 * `"@vestra-player/sdk": "^x.y.z"` in the documents names the current
 * major.minor version.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import {
  GROUPS,
  LIMITS,
  OFF_SITE,
  PENDING_UNTIL,
  PLACEHOLDERS,
  SHAPES,
  mermaidProblems,
  shapeProblems,
} from "./doc-structure.mjs";
import { withoutGenerated } from "./doc-tables.mjs";
import { splitCut, strictDeclarations } from "./doc-standard.mjs";

const root = resolve(import.meta.dirname, "..");
const strict = !process.argv.includes("--lenient");
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

/**
 * Source ranges of the top-level declarations of the enforced categories
 * (their doc comments and their members' doc comments).
 */
function strictRanges(path, text) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  return file.statements
    .filter((node) => node.name && strictDeclarations.has(node.name.text))
    .map((node) => [node.getFullStart(), node.end]);
}

/** ```ts blocks inside the `@example` sections of /** comments. */
for (const path of walk("src", (p) => p.endsWith(".ts"))) {
  const text = read(path);
  const ranges = strictRanges(path, text);
  for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
    const enforced = ranges.some(
      ([start, end]) => comment.index >= start && comment.index < end,
    );
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
              kind: enforced ? "enforced" : "example",
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
const imports = [
  `import type { ${exported.sdk.join(", ")} } from "@vestra-player/sdk";`,
  ...(exported.testing.length
    ? [
        `import { ${exported.testing.join(", ")} } from "@vestra-player/sdk/testing";`,
      ]
    : []),
];
const opening = [
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
  // Hidden setup lines (above `// ---cut---`) go to module level, so they
  // may import and declare; a block is a module when its shown lines are.
  const { hidden, visible } = splitCut(snippet.code);
  const module = /^\s*(import|export)\s/m.test(visible.join("\n"));
  const name = `${snippet.source.replace(/[^\w]+/g, "_")}_${snippet.line}_${index}.ts`;
  const file = join(out, "tests", name);
  const text = module
    ? snippet.code
    : [...imports, ...hidden, ...opening, ...visible, "}", ""].join("\n");
  writeFileSync(file, text);
  // A line of the written file → its line in the block.
  const top = imports.length + hidden.length;
  const lineOf = module
    ? (line) => line
    : (line) =>
        line < top
          ? line - imports.length
          : line -
            top -
            opening.length +
            hidden.length +
            (hidden.length ? 1 : 0);
  files.set(resolve(file), { ...snippet, lineOf });
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

const failures = { markdown: [], enforced: [], example: [], other: [] };
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
  const at = snippet.line + snippet.lineOf(line);
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

// ── Structure (scripts/doc-structure.mjs; docs/maintaining.md) ──────────

const structure = { errors: [], warnings: [] };
{
  const compare = (a, b) => {
    const x = a.split(".").map(Number);
    const y = b.split(".").map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  };
  const pendingAllowed = compare(pkg.version, PENDING_UNTIL) <= 0;
  const error = (message) => structure.errors.push(message);
  /** A rule violation on a page: a warning while the page is pending. */
  const violation = (page, message) =>
    (page.pending && pendingAllowed
      ? structure.warnings
      : structure.errors
    ).push(
      page.pending && pendingAllowed
        ? `${message} (pending: ${page.pending})`
        : message,
    );

  // typedoc.json agrees with the groups.
  const typedoc = JSON.parse(read("typedoc.json"));
  const order = [...GROUPS.map((g) => g.title), "API", "*"];
  if (JSON.stringify(typedoc.groupOrder) !== JSON.stringify(order))
    error(`typedoc.json groupOrder must be ${JSON.stringify(order)}`);
  for (const group of GROUPS)
    if (!typedoc.projectDocuments.every((glob) => glob.includes(group.folder)))
      error(`typedoc.json projectDocuments must include docs/${group.folder}/`);

  // The files under docs/ are exactly the listed pages (P3, P4).
  const listed = new Map();
  for (const group of GROUPS)
    for (const page of group.pages) {
      const path = `docs/${group.folder}/${page.file}`;
      listed.set(path, { ...page, group, path });
      if (!page.why?.trim()) error(`${path}: no \`why\` in doc-structure.mjs`);
      if ((page.pending || page.new) && !pendingAllowed)
        error(
          `${path}: still marked ${page.pending ? `pending (${page.pending})` : "new"} in doc-structure.mjs after ${PENDING_UNTIL}; remove the mark`,
        );
    }
  const folders = new Set(GROUPS.map((g) => g.folder));
  for (const item of readdirSync(join(root, "docs"), { withFileTypes: true })) {
    if (item.isDirectory() && !folders.has(item.name))
      error(`docs/${item.name}/: not a group in doc-structure.mjs`);
    if (!item.isDirectory() && !OFF_SITE.includes(item.name))
      error(`docs/${item.name}: pages belong in a group folder`);
  }
  for (const folder of folders) {
    if (!existsSync(join(root, "docs", folder))) continue;
    for (const item of readdirSync(join(root, "docs", folder), {
      withFileTypes: true,
    })) {
      const path = `docs/${folder}/${item.name}`;
      if (item.isDirectory())
        error(`${path}/: no subfolders in a group (navigation depth 2)`);
      else if (!listed.has(path))
        error(`${path}: not listed in scripts/doc-structure.mjs`);
    }
  }

  // Every page: front matter, size, placeholders (P2, P3, P5).
  const frontMatter = (text) => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    if (!match) return { fields: null, body: text };
    const fields = {};
    for (const line of match[1].split(/\r?\n/)) {
      const field = /^([\w-]+):\s*(.*)$/.exec(line);
      if (field)
        fields[field[1]] = field[2].replace(/^(["'])(.*)\1$/, "$2").trim();
    }
    return { fields, body: text.slice(match[0].length) };
  };
  for (const page of listed.values()) {
    const { path, group } = page;
    if (!existsSync(join(root, path))) {
      if (page.new && page.pending && pendingAllowed)
        structure.warnings.push(
          `${path}: not written yet (pending: ${page.pending})`,
        );
      else error(`${path}: listed in scripts/doc-structure.mjs but missing`);
      continue;
    }
    const text = read(path);
    const { fields, body } = frontMatter(text);
    if (!fields) {
      violation(page, `${path}: no front matter`);
      continue;
    }
    if (!fields.title) violation(page, `${path}: no \`title\` in front matter`);
    if (!fields.description)
      violation(page, `${path}: no \`description\` in front matter`);
    else if (fields.description.length > 200)
      violation(page, `${path}: \`description\` is longer than one sentence`);
    for (const key of ["children", "group"])
      if (key in fields)
        violation(page, `${path}: \`${key}\` front matter is not allowed`);

    const kind = page.file === "index.md" ? "index" : group.kind;
    let counted;
    try {
      counted = withoutGenerated(body);
    } catch (problem) {
      error(`${path}: ${problem.message}`);
      counted = body;
    }
    const lines = counted.replace(/\n+$/, "").split("\n").length;
    const words = counted.split(/\s+/).filter(Boolean).length;
    for (const [unit, value] of [
      ["lines", lines],
      ["words", words],
    ]) {
      const limit = LIMITS[kind][unit];
      if (!limit || value <= limit) continue;
      const message = `${path}: ${value} ${unit}, the limit for a ${kind} page is ${limit}`;
      if (value > limit * 1.25) violation(page, message);
      else structure.warnings.push(message);
    }
    // The page's shape (Diátaxis; doc-structure.mjs SHAPES).
    const shape = page.shape ?? group.kind;
    if (kind !== "index") {
      if (!SHAPES[shape]) error(`${path}: unknown shape "${shape}"`);
      else
        for (const problem of shapeProblems(shape, counted, body))
          violation(
            page,
            `${path}: ${problem} (${shape} pages: ${SHAPES[shape]})`,
          );
    }
    for (const problem of mermaidProblems(text))
      violation(page, `${path}: ${problem}`);
    for (const placeholder of PLACEHOLDERS)
      if (placeholder.test(body))
        violation(
          page,
          `${path}: placeholder "${placeholder.exec(body)[0]}" (link only pages that exist)`,
        );
  }

  // Every page is linked from its group's index, and an index links only to
  // pages that exist (P5).
  for (const group of GROUPS) {
    const indexPath = `docs/${group.folder}/index.md`;
    if (!existsSync(join(root, indexPath))) continue;
    const index = read(indexPath);
    const targets = new Set(
      [...index.matchAll(/\]\(\s*([^)\s#]+\.md)(?:#[^)\s]*)?\s*\)/g)]
        .map((m) => m[1])
        // Absolute links (the CHANGELOG on GitHub) are not pages of the site.
        .filter((target) => !/^[a-z]+:/i.test(target)),
    );
    for (const target of targets) {
      const resolved = rel(resolve(root, "docs", group.folder, target));
      if (!existsSync(join(root, resolved)))
        violation(
          listed.get(indexPath),
          `${indexPath}: links to ${target}, which does not exist`,
        );
    }
    for (const page of group.pages) {
      if (page.file === "index.md") continue;
      const path = `docs/${group.folder}/${page.file}`;
      if (!existsSync(join(root, path))) continue;
      if (![...targets].some((t) => t === page.file || t === `./${page.file}`))
        violation(
          listed.get(path),
          `${path}: not linked from ${indexPath} (orphan page)`,
        );
    }
  }

  // The generated tables are current (scripts/doc-tables.mjs --check).
  const tables = spawnSync(
    process.execPath,
    [join(root, "scripts/doc-tables.mjs"), "--check"],
    { stdio: "inherit" },
  );
  if (tables.status !== 0) error("generated tables: see the errors above");
}

// ── Report ──────────────────────────────────────────────────────────────

const count = (kind) => snippets.filter((s) => s.kind === kind).length;
const failed = (kind) => new Set(failures[kind].map((f) => f.snippet)).size;
for (const { at, message } of [...failures.markdown, ...failures.enforced])
  console.error(`::error file=${at}::${message}`);
for (const line of failures.other) console.error(`::error::${line}`);
for (const line of drift) console.error(`::error::drift: ${line}`);
for (const line of structure.errors)
  console.error(`::error::structure: ${line}`);
for (const line of structure.warnings) console.warn(`warning: ${line}`);
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
    `@example, enforced categories: ${count("enforced")} ts blocks, ${failed("enforced")} failing`,
    `@example, other: ${count("example")} ts blocks, ${failed("example")} failing (${strict ? "errors" : "warnings only"})`,
    `nocheck blocks skipped: ${skipped}`,
    `drift problems: ${drift.length}`,
    `structure: ${structure.errors.length} errors, ${structure.warnings.length} warnings`,
  ].join("\n"),
);

if (
  failures.markdown.length ||
  failures.enforced.length ||
  failures.other.length ||
  drift.length ||
  structure.errors.length ||
  (strict && failures.example.length)
)
  process.exit(1);
