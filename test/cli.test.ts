// vestra-plugin on a stand-alone plugin project outside any repository: it
// resolves @vestra-player/sdk from the project's node_modules (needs dist/).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
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

test("build runs under the permission model with only the project, the SDK and a scratch folder readable", () => {
  const directory = realpathSync(project(HELLO));
  const scratch = realpathSync(
    mkdtempSync(join(tmpdir(), "vestra-plugin-perm-")),
  );
  test.after(() => rmSync(scratch, { recursive: true, force: true }));
  const sdk = realpathSync(root);
  const result = spawnSync(
    process.execPath,
    [
      "--permission",
      "--allow-child-process",
      `--allow-fs-read=${directory}`,
      `--allow-fs-read=${sdk}`,
      `--allow-fs-read=${scratch}`,
      `--allow-fs-write=${directory}`,
      `--allow-fs-write=${scratch}`,
      cli,
      "build",
    ],
    {
      cwd: directory,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
    },
  );
  // The parent folders (looked at for node_modules/@types, tsconfig.json
  // and .git) are unreadable: absent, not ERR_ACCESS_DENIED.
  assert.doesNotMatch(result.stderr, /ERR_ACCESS_DENIED/);
  assert.equal(result.status, 0, result.stdout + result.stderr);
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

/**
 * The SDK copied outside any `node_modules`, its dependencies beside it and
 * found through `NODE_PATH`: how the player's AI workshop vendors it
 * (`vendor/@vestra-player/sdk`, `vendor/typescript`, `NODE_PATH=vendor`).
 * Returns the copied CLI and the environment to run it with.
 */
function vendored(): { cli: string; env: NodeJS.ProcessEnv } {
  const vendor = join(
    realpathSync(mkdtempSync(join(tmpdir(), "vestra-vendor-"))),
    "vendor",
  );
  test.after(() =>
    rmSync(resolve(vendor, ".."), { recursive: true, force: true }),
  );
  const sdk = join(vendor, "@vestra-player/sdk");
  for (const entry of ["dist", "bin", "slint", "package.json"])
    cpSync(join(root, entry), join(sdk, entry), { recursive: true });
  for (const name of ["typescript", "@types/node", "undici-types"]) {
    mkdirSync(resolve(vendor, name, ".."), { recursive: true });
    symlinkSync(
      realpathSync(join(root, "node_modules", name)),
      join(vendor, name),
      "junction",
    );
  }
  return {
    cli: join(sdk, "bin/vestra-plugin.mjs"),
    env: { ...process.env, NODE_PATH: vendor },
  };
}

test("the CLI runs from an SDK copy outside node_modules (TypeScript on NODE_PATH)", () => {
  const { cli: copied, env } = vendored();
  const directory = mkdtempSync(join(tmpdir(), "vestra-plugin-vendored-"));
  test.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "me.vendored",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands"],
    }),
  );
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(
    join(directory, "main.ts"),
    [
      "type Plugin = { commands: { add(command: object): void } };",
      "export default async function activate(plugin: Plugin) {",
      '  plugin.commands.add({ id: "hello", title: "Hello", run() {} });',
      "}",
    ].join("\n"),
  );
  for (const args of [["check"], ["pack", "--out", "out"]]) {
    const result = spawnSync(process.execPath, [copied, ...args], {
      cwd: directory,
      encoding: "utf8",
      env,
    });
    assert.doesNotMatch(result.stderr, /ERR_MODULE_NOT_FOUND/);
    assert.equal(
      result.status,
      0,
      `${args[0]}: ${result.stdout}${result.stderr}`,
    );
  }
  assert.ok(existsSync(join(directory, "out/me.vendored-1.0.0.vxp")));
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

test("a bottom bar without BarButtons is a warning, not a failure", () => {
  const directory = project(
    [
      'import type { Plugin } from "@vestra-player/sdk";',
      "export default async function activate(plugin: Plugin) {",
      '  plugin.panels.mount("bottom", "ui/bar.slint");',
      '  plugin.commands.add({ id: "hello", title: "Hello", run: () => plugin.osd.show("Hello") });',
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "me.bar",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd", "ui.mount"],
    }),
  );
  mkdirSync(join(directory, "ui"));
  const bar = join(directory, "ui/bar.slint");
  writeFileSync(
    bar,
    "export component Bar inherits Rectangle { height: 62px; }\n",
  );
  const plain = vestraPlugin(directory, "check");
  assert.equal(plain.status, 0, plain.stdout + plain.stderr);
  assert.match(
    plain.stdout,
    /warning: ui\/bar\.slint is a bottom bar without BarButtons/,
  );
  writeFileSync(
    bar,
    [
      'import { BarButtons } from "@vestra/bar-buttons.slint";',
      "export component Bar inherits Rectangle {",
      "  height: 62px;",
      "  BarButtons { x: parent.width - self.width; room: 200px; }",
      "}",
    ].join("\n"),
  );
  const placed = vestraPlugin(directory, "check");
  assert.equal(placed.status, 0, placed.stdout + placed.stderr);
  assert.doesNotMatch(placed.stdout, /BarButtons/);
});

test("the BarButtons check reads imports, not comments, and follows the bar's own Slint imports", () => {
  const directory = project(
    [
      'import type { Plugin } from "@vestra-player/sdk";',
      "export default async function activate(plugin: Plugin) {",
      '  plugin.panels.mount("bottom", "ui/bar.slint");',
      '  plugin.commands.add({ id: "hello", title: "Hello", run: () => plugin.osd.show("Hello") });',
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "me.bar",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd", "ui.mount"],
    }),
  );
  mkdirSync(join(directory, "ui/parts"), { recursive: true });
  const bar = join(directory, "ui/bar.slint");
  const warned = () => {
    const result = vestraPlugin(directory, "check");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return /bottom bar without BarButtons/.test(result.stdout);
  };
  // Named only in comments: still a bar without the strip.
  writeFileSync(
    bar,
    [
      '// TODO: import { BarButtons } from "@vestra/bar-buttons.slint";',
      "/* BarButtons { room: 100px; } */",
      "export component Bar inherits Rectangle { height: 62px; }",
    ].join("\n"),
  );
  assert.equal(warned(), true);
  // Placed inside a component of the plugin's own, two imports down.
  writeFileSync(
    join(directory, "ui/parts/strip.slint"),
    [
      'import { BarButtons as Strip } from "@vestra/bar-buttons.slint";',
      "export component RightEnd { Strip { room: 200px; } }",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "ui/row.slint"),
    [
      'import { RightEnd } from "parts/strip.slint";',
      "export component Row { RightEnd {} }",
    ].join("\n"),
  );
  writeFileSync(
    bar,
    [
      'import { Row } from "row.slint";',
      "export component Bar inherits Rectangle { height: 62px; Row {} }",
    ].join("\n"),
  );
  assert.equal(warned(), false);
});

test("the BarButtons check stays inside the plugin directory and follows local re-exports", () => {
  const directory = project(
    [
      'import type { Plugin } from "@vestra-player/sdk";',
      "export default async function activate(plugin: Plugin) {",
      '  plugin.panels.mount("bottom", "ui/bar.slint");',
      '  plugin.commands.add({ id: "hello", title: "Hello", run: () => plugin.osd.show("Hello") });',
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "me.bar",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd", "ui.mount"],
    }),
  );
  mkdirSync(join(directory, "ui/parts"), { recursive: true });
  const bar = join(directory, "ui/bar.slint");
  const warned = () => {
    const result = vestraPlugin(directory, "check");
    assert.equal(result.status, 0, result.stdout + result.stderr);
    return /bottom bar without BarButtons/.test(result.stdout);
  };
  // A sibling directory whose name starts with the plugin's is outside it.
  const sibling = `${directory}2`;
  mkdirSync(sibling);
  test.after(() => rmSync(sibling, { recursive: true, force: true }));
  writeFileSync(
    join(sibling, "strip.slint"),
    'import { BarButtons } from "@vestra/bar-buttons.slint";\nexport component RightEnd { BarButtons { room: 200px; } }\n',
  );
  const name = basename(sibling);
  writeFileSync(
    bar,
    [
      `import { RightEnd } from "../../${name}/strip.slint";`,
      "export component Bar inherits Rectangle { height: 62px; RightEnd {} }",
    ].join("\n"),
  );
  assert.equal(warned(), true);
  // A local re-export is followed: bar → index.slint (export … from) → strip.
  writeFileSync(
    join(directory, "ui/parts/strip.slint"),
    'import { BarButtons } from "@vestra/bar-buttons.slint";\nexport component RightEnd { BarButtons { room: 200px; } }\n',
  );
  writeFileSync(
    join(directory, "ui/parts/index.slint"),
    'export { RightEnd } from "strip.slint";\n',
  );
  writeFileSync(
    bar,
    [
      'import { RightEnd } from "parts/index.slint";',
      "export component Bar inherits Rectangle { height: 62px; RightEnd {} }",
    ].join("\n"),
  );
  assert.equal(warned(), false);
  // So is a re-export of the strip itself, and `export *`.
  writeFileSync(
    join(directory, "ui/parts/index.slint"),
    'export * from "@vestra/bar-buttons.slint";\n',
  );
  writeFileSync(
    bar,
    [
      'import { BarButtons } from "parts/index.slint";',
      "export component Bar inherits Rectangle { height: 62px; BarButtons { room: 100px; } }",
    ].join("\n"),
  );
  assert.equal(warned(), false);
});

test("a `for` over a bound array outside a ListView is a warning (SDK 1.5.46)", () => {
  const directory = project(
    [
      'import type { Plugin } from "@vestra-player/sdk";',
      "export default async function activate(plugin: Plugin) {",
      '  plugin.panels.mount("sidebar", "ui/list.slint");',
      "}",
    ].join("\n"),
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "me.list",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["ui.mount"],
    }),
  );
  mkdirSync(join(directory, "ui"));
  const list = join(directory, "ui/list.slint");
  const write = (body: string) =>
    writeFileSync(
      list,
      [
        'import { ListView } from "std-widgets.slint";',
        "export global ListBridge { in property <[string]> rows; in property <[int]> marks; }",
        "export component List inherits Rectangle {",
        "  in property <[{ name: string }]> items;",
        body,
        "}",
      ].join("\n"),
    );
  write(
    [
      "  VerticalLayout {",
      "    for row in ListBridge.rows: Text { text: row; }",
      "  }",
      "  // for x in items: Text {}",
      "  for item[i] in root.items: Text { text: item.name; }",
      "  ListView { for row in ListBridge.rows: Text { text: row; } }",
      "  for n in [1, 2, 3]: Rectangle {}",
    ].join("\n"),
  );
  const result = vestraPlugin(directory, "check");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const warnings = result.stdout
    .split("\n")
    .filter((line) => line.includes("outside a ListView"));
  assert.deepEqual(
    warnings.map((line) =>
      /ui\/list\.slint:(\d+): `for` over the bound array `(\w+)`/
        .exec(line)
        ?.slice(1),
    ),
    [
      ["6", "rows"],
      ["9", "items"],
    ],
  );
  write("  ListView { for row in ListBridge.rows: Text { text: row; } }");
  const clean = vestraPlugin(directory, "check");
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.doesNotMatch(clean.stdout, /outside a ListView/);
});
