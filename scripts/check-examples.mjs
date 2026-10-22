#!/usr/bin/env node
/**
 * Checks every example plugin in examples/ against the SDK in this checkout:
 *
 *   node scripts/check-examples.mjs [name...]
 *
 * For each examples/<name>/ with a manifest.json:
 *
 * 1. the layout conventions (manifest id `examples.<name>`, a private ESM
 *    package.json that depends on `"@vestra-player/sdk": "file:../.."`, a
 *    README.md, a tests/ directory),
 * 2. `npm ci` (with a lock file) or `npm install`, which links the SDK,
 * 3. `vestra-plugin check`, `test` and `pack` (the package goes to a
 *    temporary directory).
 *
 * The SDK's dist/ must be built first (`npm run build`). CI runs this on
 * every system of the test matrix.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const examples = join(root, "examples");
const cli = join(root, "bin/vestra-plugin.mjs");

if (!existsSync(join(root, "dist/manifest.js"))) {
  console.error("::error::dist/ is missing; run `npm run build` first");
  process.exit(1);
}

const wanted = process.argv.slice(2);
const names = readdirSync(examples, { withFileTypes: true })
  .filter((item) => item.isDirectory())
  .map((item) => item.name)
  .filter((name) => existsSync(join(examples, name, "manifest.json")))
  .filter((name) => !wanted.length || wanted.includes(name))
  .sort();
if (!names.length) {
  console.error("::error::no examples found");
  process.exit(1);
}

const failures = [];
const out = mkdtempSync(join(tmpdir(), "vestra-examples-"));

function run(name, command, args, cwd) {
  console.log(`[${name}] $ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    // npm is npm.cmd on Windows, which spawn only runs through a shell.
    shell: process.platform === "win32" && command === "npm",
  });
  return result.status === 0;
}

function conventions(name, directory) {
  const problems = [];
  const read = (file) =>
    JSON.parse(readFileSync(join(directory, file), "utf8"));
  const manifest = read("manifest.json");
  if (manifest.id !== `examples.${name}`)
    problems.push(`manifest id is ${manifest.id}, expected examples.${name}`);
  if (!existsSync(join(directory, "package.json")))
    problems.push("no package.json");
  else {
    const pkg = read("package.json");
    if (pkg.private !== true)
      problems.push('package.json needs "private": true');
    if (pkg.type !== "module")
      problems.push('package.json needs "type": "module"');
    const sdk = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    }["@vestra-player/sdk"];
    if (sdk !== "file:../..")
      problems.push(
        'package.json must depend on "@vestra-player/sdk": "file:../.."',
      );
  }
  if (!existsSync(join(directory, "README.md"))) problems.push("no README.md");
  if (!existsSync(join(directory, "tests"))) problems.push("no tests/");
  if (!existsSync(join(directory, "screenshot.png")))
    console.warn(
      `::warning::examples/${name}: no screenshot.png (commit a placeholder until the real one exists)`,
    );
  return problems;
}

try {
  for (const name of names) {
    const directory = join(examples, name);
    const problems = conventions(name, directory);
    for (const problem of problems)
      console.error(`::error::examples/${name}: ${problem}`);
    const install = existsSync(join(directory, "package-lock.json"))
      ? ["ci", "--no-audit", "--no-fund", "--ignore-scripts"]
      : [
          "install",
          "--no-audit",
          "--no-fund",
          "--ignore-scripts",
          "--no-package-lock",
        ];
    const ok =
      !problems.length &&
      run(name, "npm", install, directory) &&
      run(name, process.execPath, [cli, "check"], directory) &&
      run(name, process.execPath, [cli, "test"], directory) &&
      run(name, process.execPath, [cli, "pack", "--out", out], directory);
    if (!ok) failures.push(name);
  }
} finally {
  rmSync(out, { recursive: true, force: true });
}

if (failures.length) {
  for (const name of failures) console.error(`::error::example ${name} failed`);
  process.exit(1);
}
console.log(`examples ok: ${names.join(", ")}`);
