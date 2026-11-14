// The generated blocks of the docs (scripts/doc-tables.mjs): no generator
// leaves a template unrendered (SDK 1.10.0: the mpv rules table showed
// `${code(…)}` from a string written with double quotes).
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

function pages(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? pages(join(directory, entry.name))
      : entry.name.endsWith(".md")
        ? [join(directory, entry.name)]
        : [],
  );
}

test("no generated block of the docs holds an unrendered ${…}", () => {
  const found: string[] = [];
  for (const page of pages(join(root, "docs"))) {
    const text = readFileSync(page, "utf8");
    const blocks = text.matchAll(
      /<!-- generated:[^>]*-->([\s\S]*?)<!-- \/generated -->/g,
    );
    for (const [, block] of blocks)
      for (const line of block!.split("\n"))
        if (line.includes("${"))
          found.push(`${relative(root, page)}: ${line.slice(0, 120)}`);
  }
  assert.deepEqual(found, []);
});
