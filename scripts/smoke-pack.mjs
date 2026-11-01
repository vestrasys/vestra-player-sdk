#!/usr/bin/env node
/**
 * Installs a packed tarball into a fresh project outside the repository and
 * uses it the way a plugin author does:
 *
 *   node scripts/smoke-pack.mjs vestra-player-sdk-x.y.z.tgz
 *
 * 1. `npm install <tgz>` (registry dependencies only: typescript, @types/node),
 * 2. import every public entry point from plain Node (ESM resolution of the
 *    published dist/), resolve the llms.txt export and read the
 *    documentation tree (`@vestra-player/sdk/docs`),
 * 3. `tsc --noEmit` on a tiny plugin with the installed types,
 * 4. `vestra-plugin check` and `vestra-plugin test` on that plugin, and
 *    `vestra-plugin docs`.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const tarball = process.argv[2];
if (!tarball) {
  console.error("usage: smoke-pack.mjs <package.tgz>");
  process.exit(2);
}
const directory = mkdtempSync(join(tmpdir(), "vestra-sdk-smoke-"));

function run(command, args) {
  console.log(`$ ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: directory,
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  if (result.status !== 0) {
    console.error(`::error::smoke test failed: ${command} ${args.join(" ")}`);
    process.exit(1);
  }
}

const write = (file, lines) =>
  writeFileSync(join(directory, file), lines.join("\n") + "\n");

try {
  write("package.json", [
    JSON.stringify({ name: "smoke", private: true, type: "module" }),
  ]);
  run("npm", [
    "install",
    "--no-audit",
    "--no-fund",
    "--ignore-scripts",
    resolve(tarball),
  ]);

  write("imports.mjs", [
    '// "." holds types only; importing it must still resolve and load.',
    'await import("@vestra-player/sdk");',
    'const testing = await import("@vestra-player/sdk/testing");',
    'await import("@vestra-player/sdk/runtime");',
    'if (typeof testing.startPlugin !== "function") throw new Error("startPlugin missing");',
    'import { readFileSync } from "node:fs";',
    'const text = readFileSync(new URL(import.meta.resolve("@vestra-player/sdk/llms.txt")), "utf8");',
    'if (!text.startsWith("# ")) throw new Error("llms.txt: not an llms.txt file");',
    'const { docs, searchDocs } = await import("@vestra-player/sdk/docs");',
    'if (!docs("/API/Media/Snapshot/dispose").includes("dispose(): Promise<void>")) throw new Error("docs: no member page");',
    'if (!searchDocs("snapshot").includes("/API/Media/Snapshot")) throw new Error("searchDocs: no match");',
    'console.log("imports ok");',
  ]);
  run(process.execPath, ["imports.mjs"]);

  write("manifest.json", [
    JSON.stringify({
      id: "smoke.hello",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd"],
    }),
  ]);
  write("main.ts", [
    'import type { Plugin } from "@vestra-player/sdk";',
    "export default async function activate(plugin: Plugin) {",
    "  plugin.commands.add({",
    '    id: "hello",',
    '    title: "Hello",',
    '    run: () => plugin.osd.show("Hello"),',
    "  });",
    "}",
  ]);
  mkdirSync(join(directory, "tests"));
  write("tests/main.test.ts", [
    'import assert from "node:assert/strict";',
    'import test from "node:test";',
    'import { startPlugin } from "@vestra-player/sdk/testing";',
    'import activate from "../main.ts";',
    'test("hello", async () => {',
    "  const { host, stop } = await startPlugin(activate, {",
    '    directory: new URL("..", import.meta.url),',
    "  });",
    '  await host.command("hello").run();',
    '  assert.deepEqual(host.osd, ["Hello"]);',
    "  await stop();",
    "});",
  ]);
  write("tsconfig.json", [
    JSON.stringify({
      compilerOptions: {
        target: "ES2023",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        allowImportingTsExtensions: true,
        verbatimModuleSyntax: true,
        types: ["node"],
      },
      include: ["main.ts", "tests/*.ts"],
    }),
  ]);
  run(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "."]);
  run(process.execPath, [
    "node_modules/@vestra-player/sdk/bin/vestra-plugin.mjs",
    "check",
  ]);
  run(process.execPath, [
    "node_modules/@vestra-player/sdk/bin/vestra-plugin.mjs",
    "test",
  ]);
  run(process.execPath, [
    "node_modules/@vestra-player/sdk/bin/vestra-plugin.mjs",
    "docs",
    "API/Media",
  ]);
  console.log("smoke test passed");
} finally {
  rmSync(directory, { recursive: true, force: true });
}
