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
  const zip = readFileSync(join(directory, "out/me.hello-1.2.3.vxp"));
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const sha = createHash("sha256").update(zip).digest("hex");
  assert.match(packed.stdout, new RegExp(`sha256 ${sha}`));
  // The same input packs to the same bytes.
  vestraPlugin(directory, "pack", "--out", "out");
  assert.equal(
    createHash("sha256")
      .update(readFileSync(join(directory, "out/me.hello-1.2.3.vxp")))
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

const PNG_1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d4944415478da63f8ffffff7f0009fb03fd2a86e38a0000000049454e44ae426082",
  "hex",
);

test("display fields are checked and their files are packed", () => {
  const directory = project(HELLO);
  const manifest = {
    id: "me.hello",
    version: "1.2.3",
    apiVersion: "vestra/1",
    entry: "main.ts",
    capabilities: ["commands", "ui.osd"],
    name: "你好",
    author: "me",
    punchline: "Says hello",
    tags: ["demo"],
    icon: "assets/icon.png",
    sourceUrl: "https://github.com/me/hello",
    license: "MIT",
    minPlayerVersion: "0.2.0",
  };
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "assets/icon.png"), PNG_1x1);
  writeFileSync(join(directory, "README.md"), "# Hello\n");
  writeFileSync(join(directory, "NOTES.md"), "not packed");
  const built = vestraPlugin(directory, "build");
  assert.equal(built.status, 0, built.stdout + built.stderr);
  assert.deepEqual(readdirSync(join(directory, "dist")).sort(), [
    "README.md",
    "assets",
    "main.js",
    "manifest.json",
    "package.json",
  ]);
  for (const [field, value, message] of [
    ["name", "", /name must have 1–64 characters/],
    ["tags", ["a", "A"], /duplicate tag/],
    ["icon", "missing.png", /icon file missing\.png is missing/],
    ["icon", "../icon.png", /icon must be a relative path/],
    ["readme", "README.txt", /readme must be a \.md file/],
    ["sourceUrl", "http://x.example/", /sourceUrl must be an https: address/],
    ["minPlayerVersion", "1.0", /minPlayerVersion must be MAJOR\.MINOR\.PATCH/],
    ["homepage", "https://x.example/", /unknown field "homepage"/],
  ] as const) {
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({ ...manifest, [field]: value }),
    );
    const result = vestraPlugin(directory, "check");
    assert.equal(result.status, 1, `${field}: ${result.stdout}`);
    assert.match(result.stderr, message);
  }
  writeFileSync(join(directory, "assets/icon.png"), "GIF89a");
  writeFileSync(join(directory, "manifest.json"), JSON.stringify(manifest));
  assert.match(
    vestraPlugin(directory, "check").stderr,
    /icon must be a PNG or JPEG/,
  );
});

test("an id without a prefix is only a hint", () => {
  const directory = project(HELLO);
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "hello",
      version: "1.2.3",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd"],
    }),
  );
  const result = vestraPlugin(directory, "check");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /hint: id "hello" has no prefix/);
});
