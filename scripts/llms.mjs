#!/usr/bin/env node
/**
 * Generates llms.txt (https://llmstxt.org), the entry for language models:
 *
 *   node scripts/llms.mjs           write llms.txt
 *   node scripts/llms.mjs --check   fail when the committed file is stale
 *
 * llms.txt is short on purpose: what the SDK is, how an agent reads the
 * documentation (the documentation tree of `vestra-plugin docs` and
 * `@vestra-player/sdk/docs`, never one large file), and the tree's top
 * levels with their one-line summaries. It comes from the same tree
 * (scripts/docs-tree.mjs), so its paths and summaries are the ones the
 * tree answers with. The output depends only on the sources (no dates,
 * LF line endings), so CI regenerates it and compares (`npm run docs:llms
 * -- --check`). It is in the npm package (`@vestra-player/sdk/llms.txt`)
 * and on the documentation site (scripts/typedoc-plugin.mjs copies it), and
 * stays at most 10 KB (10,240 bytes).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildTree, convertProject } from "./docs-tree.mjs";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const SITE = "https://vestrasys.github.io/vestra-player-sdk/";
/** llms.txt must stay below this size (bytes). */
const INDEX_LIMIT = 10 * 1024;
const fail = (message) => {
  console.error(`::error::llms: ${message}`);
  process.exit(1);
};

const tree = buildTree(await convertProject());
const nodes = tree.nodes;
const childrenOf = (node) => (node.c ?? []).map((index) => nodes[index]);
const named = (parent, name) => {
  const found = childrenOf(parent).find((child) => child.n === name);
  if (!found) fail(`the documentation tree has no ${name}`);
  return found;
};
const entry = (path, node) => `- \`${path}\`: ${node.s}`;

const top = nodes[0];
const guides = named(top, "Guides");
const api = named(top, "API");
const lines = [
  "# Vestra Player SDK",
  "",
  `> @vestra-player/sdk ${pkg.version}: write plugins for Vestra Player in TypeScript (plugin API \`vestra/1\`). A plugin is a folder with \`manifest.json\` and an entry module whose default export \`activate(plugin)\` the player calls. The documentation is a tree of short pages read by path, like \`go doc\`: the same pages and API as ${SITE}.`,
  "",
  "## Read the documentation",
  "",
  "- **Command line** (any coding agent): `npx -p @vestra-player/sdk vestra-plugin docs [path] [--page N]` prints one node of the tree; `npx -p @vestra-player/sdk vestra-plugin docs --search <words>` lists the matching paths. In a project that depends on the SDK, `npx vestra-plugin docs` is enough.",
  '- **In a Node.js program**: `import { docs, searchDocs } from "@vestra-player/sdk/docs"`; `docs(path, { page })` and `searchDocs(query, { page })` return the same text.',
  "- **Paths**: `/` lists the top level; every answer lists the paths one level down with a one-line summary. `/API/<category>/<symbol>/<member>` is one declaration with its signature, parameters, return value, errors, capability, player version and examples, for example `/API/Media/Snapshot/dispose`. `/Guides/<group>/<page>` is a page of the site, for example `/Guides/How-to/Test a plugin` (the file name works too: `/Guides/How-to/testing`). Case, spaces and punctuation do not matter, the leading `/` is optional, `.` works like `/`, a name alone finds its declaration (`TestHost`, `Snapshot.export`, `plugin.player`), and `#heading` opens the page of a long answer that has that section.",
  "- **Size**: every answer is at most 8 KB; a longer one ends with the number of its next page (`--page 2`).",
  "- **Before writing code**, read `/Guides/Tutorials/Getting started` and `/Guides/Guidelines`, then the API of what you use. Test with `/Guides/How-to/Test a plugin`.",
  "",
  "## Top level",
  "",
  ...childrenOf(top).map((node) => entry(`/${node.n}`, node)),
  "",
  "## Guides",
  "",
  ...childrenOf(guides).map((node) => entry(`/Guides/${node.n}`, node)),
  "",
  "## API",
  "",
  ...childrenOf(api).map((node) => entry(`/API/${node.n}`, node)),
  "",
];
const index = lines.join("\n");

const path = join(root, "llms.txt");
const current = existsSync(path) ? readFileSync(path, "utf8") : null;
if (check) {
  if (current !== index) fail("llms.txt out of date: run `npm run docs:llms`");
} else if (current !== index) writeFileSync(path, index);
if (Buffer.byteLength(index) > INDEX_LIMIT)
  fail(
    `llms.txt is ${Buffer.byteLength(index)} bytes, more than ${INDEX_LIMIT}: shorten it`,
  );
console.log(
  `llms.txt: ${(Buffer.byteLength(index) / 1024).toFixed(1)} KB, ${lines.length - 1} lines${check ? ", current" : ""}`,
);
