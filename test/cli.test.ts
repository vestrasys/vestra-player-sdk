// vestra-plugin on a stand-alone plugin project outside any repository: it
// resolves @vestra-player/sdk from the project's node_modules (needs dist/).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "bin/vestra-plugin.mjs");

function project(main: string) {
  const directory = mkdtempSync(join(tmpdir(), "vestra-plugin-cli-"));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "node_modules/@vestra-player"), {
    recursive: true,
  });
  symlinkSync(
    root,
    join(directory, "node_modules/@vestra-player/sdk"),
    "junction",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "me.hello",
      version: "1.2.3",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd"],
    }),
  );
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "main.ts"), main);
  mkdirSync(join(directory, "tests"));
  writeFileSync(
    join(directory, "tests/main.test.ts"),
    [
      'import assert from "node:assert/strict";',
      'import test from "node:test";',
      'import { startPlugin } from "@vestra-player/sdk/testing";',
      'import activate from "../main.ts";',
      'test("hello", async () => {',
      '  const { host, stop } = await startPlugin(activate, { directory: new URL("..", import.meta.url) });',
      '  await host.command("hello").run();',
      '  assert.deepEqual(host.osd, ["Hello"]);',
      "  await stop();",
      "});",
    ].join("\n"),
  );
  return directory;
}

const vestraPlugin = (directory: string, ...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: "utf8",
  });

const HELLO = [
  'import type { Plugin } from "@vestra-player/sdk";',
  "export default async function activate(plugin: Plugin) {",
  '  plugin.commands.add({ id: "hello", title: "Hello", run: () => plugin.osd.show("Hello") });',
  "}",
].join("\n");

test("check, build, test and pack a stand-alone plugin", () => {
  const directory = project(HELLO);
  for (const command of ["check", "test"]) {
    const result = vestraPlugin(directory, command);
    assert.equal(result.status, 0, result.stdout + result.stderr);
  }
  const packed = vestraPlugin(directory, "pack", "--out", "out");
  assert.equal(packed.status, 0, packed.stdout + packed.stderr);
  // Only the plugin's own code: no SDK, no tests, no package metadata.
  assert.deepEqual(readdirSync(join(directory, "dist")).sort(), [
    "main.js",
    "manifest.json",
    "package.json",
  ]);
  assert.doesNotMatch(
    readFileSync(join(directory, "dist/main.js"), "utf8"),
    /vestra-player/,
  );
  const manifest = JSON.parse(
    readFileSync(join(directory, "dist/manifest.json"), "utf8"),
  );
  assert.equal(manifest.entry, "main.js");
  const zip = readFileSync(join(directory, "out/me.hello-1.2.3.zip"));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const sha = createHash("sha256").update(zip).digest("hex");
  assert.match(packed.stdout, new RegExp(`sha256 ${sha}`));
  // The same input packs to the same bytes.
  vestraPlugin(directory, "pack", "--out", "out");
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(directory, "out/me.hello-1.2.3.zip")))
      .digest("hex"),
    sha,
  );
});

test("type errors, runtime SDK imports and unknown capabilities fail", () => {
  const typo = project(HELLO.replace("osd.show", "osd.shout"));
  const checked = vestraPlugin(typo, "check");
  assert.equal(checked.status, 1);
  assert.match(checked.stdout, /Property 'shout' does not exist/);

  // verbatimModuleSyntax keeps `import {} from ...`; the build refuses it.
  const runtime = project(HELLO.replace("import type {", "import { type"));
  const built = vestraPlugin(runtime, "build");
  assert.equal(built.status, 1);
  assert.match(built.stderr, /runtime import of @vestra-player\/sdk/);

  const capability = project(HELLO);
  writeFileSync(
    join(capability, "manifest.json"),
    JSON.stringify({
      id: "x",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["no.such"],
    }),
  );
  const refused = vestraPlugin(capability, "check");
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /unknown capabilities no\.such/);
});
