#!/usr/bin/env node
/**
 * src/*.ts → dist/*.js + dist/*.d.ts (tsconfig.json), then the documentation
 * tree for agents → dist/docs-tree.json.gz (scripts/docs-tree.mjs, read by
 * `@vestra-player/sdk/docs` and `vestra-plugin docs`). The package publishes
 * the compiled files: Node does not strip types inside node_modules, and other
 * tool chains (bundlers, older TypeScript, editors) read .js + .d.ts directly.
 * Runs as `prepare`: on `npm ci` / `npm install` in this repository, before
 * `npm pack` / `npm publish`, and when npm installs the package from a git
 * URL (npm clones it, installs its dependencies and runs `prepare` before
 * packing).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
// An installed copy has no sources; nothing to build.
if (!existsSync(join(root, "src"))) process.exit(0);
const tsc = createRequire(join(root, "package.json")).resolve(
  "typescript/lib/tsc.js",
);
await rm(join(root, "dist"), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [tsc, "-p", join(root, "tsconfig.json")],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const tree = spawnSync(
  process.execPath,
  [join(root, "scripts", "docs-tree.mjs")],
  { stdio: "inherit" },
);
process.exit(tree.status ?? 1);
