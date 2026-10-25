#!/usr/bin/env node
/**
 * Writes the generated tables of the documentation:
 *
 *   node scripts/doc-tables.mjs [--check]
 *
 * A page marks a generated block with a pair of HTML comments:
 *
 *   <!-- generated:<name> [argument ...] -->
 *   …written by the script, never by hand…
 *   <!-- /generated -->
 *
 * `<name>` selects the generator `scripts/doc-tables/<name>.mjs`. Its default
 * export is a function `(context) => string | Promise<string>` that returns
 * the block's Markdown (usually one table). `context` holds:
 *
 * - `root`: the repository's root directory;
 * - `args`: the words after the name in the opening comment (strings);
 * - `page`: the page's path relative to the root, such as
 *   `docs/reference/limits.md`;
 * - `read(path)`: a file relative to the root, as text;
 * - `table(header, rows)`: a Markdown table from an array of column titles and
 *   an array of rows (arrays of cells; `|` and line breaks in a cell are
 *   escaped).
 *
 * A generator reads the facts from the code (it may import `src/*.ts`
 * directly, Node runs TypeScript) or from `slint/`, and must not depend on
 * the date, the machine or the order of a directory listing.
 *
 * Without `--check` the script rewrites the blocks in place. With `--check`
 * it changes nothing and fails when a block differs from what its generator
 * returns (`npm run docs:check` runs it that way). Either way it fails on a
 * block without a generator, an unclosed or nested block, or a generator
 * that throws; a generator no page uses is reported as a warning.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "..");
const generators = join(root, "scripts/doc-tables");

const OPEN = /<!--\s*generated:([\w-]+)((?:\s+[^\s>]+)*)\s*-->/;
const CLOSE = "<!-- /generated -->";

/** The pages that may contain generated blocks: README.md and docs/**.md. */
export function pages() {
  const walk = (directory) =>
    readdirSync(join(root, directory), { withFileTypes: true })
      .flatMap((item) => {
        const path = `${directory}/${item.name}`;
        if (item.isDirectory()) return walk(path);
        return path.endsWith(".md") ? [path] : [];
      })
      .sort();
  return ["README.md", ...walk("docs")];
}

/**
 * The generated blocks of a text: `{ name, args, line, innerStart, innerEnd,
 * inner }`, where `inner` is the text between the two comments.
 * Throws on an unclosed or nested block.
 */
export function generatedBlocks(text) {
  const blocks = [];
  const open = new RegExp(OPEN.source, "g");
  for (let match; (match = open.exec(text));) {
    const line = text.slice(0, match.index).split("\n").length;
    const innerStart = match.index + match[0].length;
    const close = text.indexOf(CLOSE, innerStart);
    if (close < 0)
      throw new Error(`line ${line}: "${match[0]}" is never closed`);
    const inner = text.slice(innerStart, close);
    if (OPEN.test(inner))
      throw new Error(`line ${line}: a generated block inside "${match[0]}"`);
    blocks.push({
      name: match[1],
      args: match[2].trim().split(/\s+/).filter(Boolean),
      line,
      innerStart,
      innerEnd: close,
      inner,
    });
    open.lastIndex = close + CLOSE.length;
  }
  return blocks;
}

/** A text with every generated block's content removed (the comments stay). */
export function withoutGenerated(text) {
  let result = "";
  let at = 0;
  for (const block of generatedBlocks(text)) {
    result += text.slice(at, block.innerStart) + "\n";
    at = block.innerEnd;
  }
  return result + text.slice(at);
}

const cell = (value) =>
  String(value ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");

/** A Markdown table. */
export function table(header, rows) {
  return [
    `| ${header.map(cell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(cell).join(" | ")} |`),
  ].join("\n");
}

async function main() {
  const check = process.argv.includes("--check");
  const available = existsSync(generators)
    ? readdirSync(generators)
        .filter((name) => name.endsWith(".mjs"))
        .map((name) => name.slice(0, -4))
        .sort()
    : [];
  const loaded = new Map();
  const used = new Set();
  const errors = [];
  const stale = [];
  let count = 0;

  for (const page of pages()) {
    const text = readFileSync(join(root, page), "utf8");
    let blocks;
    try {
      blocks = generatedBlocks(text);
    } catch (error) {
      errors.push(`${page}: ${error.message}`);
      continue;
    }
    if (!blocks.length) continue;
    let output = "";
    let at = 0;
    for (const block of blocks) {
      count++;
      used.add(block.name);
      output += text.slice(at, block.innerStart);
      at = block.innerEnd;
      if (!available.includes(block.name)) {
        errors.push(
          `${page}:${block.line}: no generator scripts/doc-tables/${block.name}.mjs`,
        );
        output += block.inner;
        continue;
      }
      let content;
      try {
        if (!loaded.has(block.name))
          loaded.set(
            block.name,
            (await import(pathToFileURL(join(generators, `${block.name}.mjs`))))
              .default,
          );
        content = await loaded.get(block.name)({
          root,
          args: block.args,
          page,
          read: (path) => readFileSync(join(root, path), "utf8"),
          table,
        });
        if (typeof content !== "string")
          throw new Error("the generator did not return a string");
      } catch (error) {
        errors.push(`${page}:${block.line}: ${block.name}: ${error.message}`);
        output += block.inner;
        continue;
      }
      const inner = `\n\n${content.trim()}\n\n`;
      if (inner !== block.inner)
        stale.push(`${page}:${block.line}: ${block.name}`);
      output += inner;
    }
    output += text.slice(at);
    if (!check && output !== text) writeFileSync(join(root, page), output);
  }

  for (const name of available)
    if (!used.has(name))
      console.warn(
        `warning: scripts/doc-tables/${name}.mjs is not used by any page`,
      );
  for (const line of errors) console.error(`::error::doc-tables: ${line}`);
  if (check)
    for (const line of stale)
      console.error(
        `::error::doc-tables: ${line} is stale (run npm run docs:tables)`,
      );
  console.log(
    `doc-tables: ${count} generated block(s), ${stale.length} ${check ? "stale" : "rewritten"}, ${available.length} generator(s)`,
  );
  if (errors.length || (check && stale.length)) process.exit(1);
}

if (import.meta.main) await main();
