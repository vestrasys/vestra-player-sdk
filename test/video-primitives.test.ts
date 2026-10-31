// Video primitives (SDK 1.5.39, player 0.5.20): the shader channel
// plugin.video.shaders(id), and the convolution and lut3d video nodes, with
// TestHost's model of the player.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  CAPABILITY_INFO,
  startPlugin,
  TestHost,
  VIDEO_PROCESSING_LIMITS,
} from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import type { PluginError, VideoNode } from "../src/plugin/types.ts";
import { HOST_CAPABILITIES } from "../src/host-capabilities.ts";
import { nodeProblem } from "../src/processing.ts";

const capabilities = ["playback.read", "events", "processing.video"];

async function started(host = new TestHost(), caps = capabilities) {
  let plugin!: Plugin;
  host.openElsewhere("/a.mp4");
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities: caps, host },
  );
  return { ...result, plugin };
}
const failure = (handle: { status: { state: string } }) =>
  handle.status.state === "failed"
    ? (handle.status as unknown as { error: PluginError }).error.code
    : handle.status.state;
function shader(directory: string, name: string) {
  const file = join(directory, name);
  writeFileSync(
    file,
    "//!HOOK MAIN\n//!BIND HOOKED\nvec4 hook() { return HOOKED_tex(HOOKED_pos); }\n",
  );
  return file;
}
function cube(directory: string, name: string, size = 2) {
  const file = join(directory, name);
  const lines = [`LUT_3D_SIZE ${size}`];
  for (let i = 0; i < size ** 3; i++) lines.push("0.5 0.5 0.5");
  writeFileSync(file, `${lines.join("\n")}\n`);
  return file;
}

test("video.shaders.set needs processing.video, like the rest of plugin.video", () => {
  const video = HOST_CAPABILITIES.capabilities.find(
    (c) => c.name === "processing.video",
  )!;
  assert.ok(
    video.methods.some(
      (m) => m.name === "video.shaders.set" && m.needs === "processing.video",
    ),
  );
  assert.ok(
    CAPABILITY_INFO["processing.video"]!.apis.includes("Plugin.video.shaders"),
  );
});

test("shaders: set, clear and dispose; the player holds the real paths", async () => {
  const { plugin, host, stop } = await started();
  const file = shader(plugin.dataDirectory, "a.glsl");
  const shaders = plugin.video.shaders("sharpen");
  assert.equal(shaders.status.state, "waiting", "nothing sent before set");
  assert.ok(!host.calls.some((c) => c.method === "video.shaders.set"));
  shaders.set([file]);
  await host.settle();
  assert.equal(shaders.status.state, "applied");
  assert.equal(host.videoShaders.handles.get("sharpen")?.length, 1);
  shaders.clear();
  await host.settle();
  assert.equal(host.videoShaders.handles.has("sharpen"), false);
  shaders.set([file]);
  await host.settle();
  await shaders.dispose();
  await host.settle();
  assert.equal(host.videoShaders.handles.size, 0, "dispose withdraws");
  // A default id, and one handle per id.
  const first = plugin.video.shaders();
  assert.throws(() => plugin.video.shaders("shaders"), /exists; reuse it/);
  assert.throws(() => plugin.video.shaders(""), { code: "invalid" });
  // C1 control characters too, as the player's char::is_control.
  assert.throws(() => plugin.video.shaders("a\u0085b"), { code: "invalid" });
  assert.throws(() => plugin.video.shaders("a\u007fb"), { code: "invalid" });
  await first.dispose();
  plugin.video.shaders("shaders");
  await stop();
});

test("shaders: files must be the plugin's own, absolute and present", async () => {
  const outside = mkdtempSync(join(tmpdir(), "vestra-shaders-"));
  try {
    const { plugin, host, stop } = await started();
    const shaders = plugin.video.shaders();
    shaders.set(["relative.glsl"]);
    await host.settle();
    assert.equal(failure(shaders), "invalid");
    shaders.set([shader(outside, "x.glsl")]);
    await host.settle();
    assert.equal(failure(shaders), "invalid", "another directory");
    shaders.set([join(plugin.dataDirectory, "none.glsl")]);
    await host.settle();
    assert.equal(failure(shaders), "missing");
    const own = join(plugin.dataDirectory, "dir.glsl");
    mkdirSync(own);
    shaders.set([own]);
    await host.settle();
    assert.equal(failure(shaders), "invalid", "a directory");
    await stop();
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});

test("shaders: at most 16 across every plugin, limit beyond, nothing changes", async () => {
  const host = new TestHost();
  host.videoShaders.others = 10;
  const { plugin, stop } = await started(host);
  const files = Array.from({ length: 7 }, (_, i) =>
    shader(plugin.dataDirectory, `s${i}.glsl`),
  );
  const a = plugin.video.shaders("a");
  a.set(files);
  await host.settle();
  assert.equal(failure(a), "limit");
  a.set(files.slice(0, 6));
  await host.settle();
  assert.equal(failure(a), "applied");
  // The handle's own list does not count against itself.
  a.set(files.slice(1, 7));
  await host.settle();
  assert.equal(failure(a), "applied");
  const b = plugin.video.shaders("b");
  b.set(files.slice(0, 1));
  await host.settle();
  assert.equal(failure(b), "limit");
  // More than 16 is refused before anything is sent.
  const sent = host.calls.length;
  b.set(
    Array.from(
      { length: VIDEO_PROCESSING_LIMITS.shaders + 1 },
      () => files[0]!,
    ),
  );
  assert.equal(failure(b), "limit");
  assert.equal(host.calls.length, sent);
  await stop();
});

test("shaders: software rendering refuses them; a fallback and a compile failure are pushed", async () => {
  const host = new TestHost();
  host.videoRender.gpu = false;
  const { plugin, stop } = await started(host);
  const file = shader(plugin.dataDirectory, "a.glsl");
  const shaders = plugin.video.shaders("x");
  const errors: string[] = [];
  plugin.onError((error) => errors.push((error as PluginError).code));
  shaders.set([file]);
  await host.settle();
  assert.equal(failure(shaders), "unsupported");
  assert.ok(errors.includes("unsupported"));
  shaders.clear();
  await host.settle();
  assert.equal(failure(shaders), "applied", "clearing is always accepted");
  host.videoRender.gpu = true;
  shaders.set([file]);
  await host.settle();
  host.failVideoShaders("other", "not this handle");
  await host.settle();
  assert.equal(failure(shaders), "applied");
  host.failVideoShaders("x", "shader compile failed: ERROR: 0:1: x");
  await host.settle();
  assert.equal(failure(shaders), "failed");
  shaders.set([file]);
  await host.settle();
  host.failVideoRender(
    "unsupported",
    "the player switched to software rendering",
  );
  await host.settle();
  assert.equal(failure(shaders), "unsupported");
  assert.equal(
    host.videoShaders.handles.size,
    0,
    "a fallback removes the lists",
  );
  shaders.clear();
  await host.settle();
  assert.equal(failure(shaders), "applied", "clear() still succeeds");
  await stop();
});

test("shaders: without processing.video the call throws capability", async () => {
  const { plugin, stop } = await started(new TestHost(), [
    "playback.read",
    "events",
  ]);
  assert.throws(() => plugin.video.shaders(), { code: "capability" });
  await stop();
});

const square = (matrix: number[]) => ({
  kind: "convolution" as const,
  planes: [{ mode: "square" as const, matrix, rdiv: 1, bias: 0 }],
});
const SHARPEN = [0, -1, 0, -1, 5, -1, 0, -1, 0];

test("convolution: sizes, integers and ranges are the player's", () => {
  const ok: VideoNode[] = [
    square(SHARPEN),
    square(Array(25).fill(1)),
    square(Array(49).fill(-1)),
    {
      kind: "convolution",
      planes: [null, { mode: "row", matrix: [1, 2, 1], rdiv: 0, bias: 128 }],
    },
    {
      kind: "convolution",
      planes: [
        null,
        null,
        null,
        { mode: "column", matrix: Array(49).fill(1), rdiv: 256, bias: 65535 },
      ],
    },
  ];
  for (const node of ok) assert.equal(nodeProblem("video", [node]), null);
  const bad = [
    square(Array(8).fill(1)),
    square(Array(16).fill(1)),
    square([0, 0, 0, 0, 0.5, 0, 0, 0, 0]),
    square([0, 0, 0, 0, 1025, 0, 0, 0, 0]),
    square([0, 0, 0, 0, Number.NaN, 0, 0, 0, 0]),
    {
      ...square(SHARPEN),
      planes: [{ ...square(SHARPEN).planes[0]!, rdiv: 257 }],
    },
    {
      ...square(SHARPEN),
      planes: [{ ...square(SHARPEN).planes[0]!, rdiv: -1 }],
    },
    {
      ...square(SHARPEN),
      planes: [{ ...square(SHARPEN).planes[0]!, bias: -1 }],
    },
    {
      ...square(SHARPEN),
      planes: [{ ...square(SHARPEN).planes[0]!, bias: 65536 }],
    },
    {
      ...square(SHARPEN),
      planes: [{ ...square(SHARPEN).planes[0]!, extra: 1 }],
    },
    {
      kind: "convolution",
      planes: [{ mode: "row", matrix: [1, 1], rdiv: 0, bias: 0 }],
    },
    {
      kind: "convolution",
      planes: [{ mode: "row", matrix: Array(51).fill(1), rdiv: 0, bias: 0 }],
    },
    {
      kind: "convolution",
      planes: [{ mode: "diagonal", matrix: [1], rdiv: 0, bias: 0 }],
    },
    {
      kind: "convolution",
      planes: [{ mode: "row", matrix: "1 2 1", rdiv: 0, bias: 0 }],
    },
    { kind: "convolution", planes: [] },
    { kind: "convolution", planes: [null] },
    {
      kind: "convolution",
      planes: [null, null, null, null, square(SHARPEN).planes[0]],
    },
    { kind: "convolution", planes: square(SHARPEN).planes, expression: "x" },
  ];
  for (const node of bad)
    assert.ok(nodeProblem("video", [node as never]), JSON.stringify(node));
  assert.match(
    nodeProblem("audio", [square(SHARPEN) as never])!,
    /unknown audio node/,
  );
});

test("convolution applies through a filter like any node", async () => {
  const { plugin, host, stop } = await started();
  const filter = plugin.video.filter("sharpen");
  filter.set([square(SHARPEN)]);
  await host.settle();
  assert.equal(filter.status.state, "applied");
  filter.set([square([1, 1, 1])]);
  await host.settle();
  assert.equal(failure(filter), "invalid");
  await stop();
});

test("lut3d: a .cube file of the plugin's own, its header checked", async () => {
  const outside = mkdtempSync(join(tmpdir(), "vestra-lut-"));
  try {
    const { plugin, host, stop } = await started();
    const filter = plugin.video.filter("look");
    const set = async (file: string, interpolation = "tetrahedral") => {
      filter.set([{ kind: "lut3d", file, interpolation } as VideoNode]);
      await host.settle();
      return failure(filter);
    };
    const data = plugin.dataDirectory;
    assert.equal(await set(cube(data, "warm.cube")), "applied");
    assert.equal(await set(cube(data, "UPPER.CUBE", 3), "prism"), "applied");
    assert.equal(await set(cube(data, "x.cube"), "cubic"), "invalid");
    assert.equal(await set("warm.cube"), "invalid", "relative");
    const long = join(
      data,
      `${"x".repeat(VIDEO_PROCESSING_LIMITS.lutPathBytes)}.cube`,
    );
    assert.match(
      nodeProblem("video", [
        { kind: "lut3d", file: long, interpolation: "nearest" } as never,
      ])!,
      /at most 4096 bytes/,
    );
    assert.match(
      nodeProblem("video", [
        {
          kind: "lut3d",
          file: join(data, "a\u0085.cube"),
          interpolation: "nearest",
        } as never,
      ])!,
      /control characters/,
    );
    assert.equal(await set(cube(outside, "warm.cube")), "invalid", "outside");
    assert.equal(await set(join(data, "none.cube")), "missing");
    assert.equal(await set(cube(data, "warm.3dl")), "invalid", ".cube only");
    writeFileSync(join(data, "one.cube"), "LUT_1D_SIZE 4\n0 0 0\n");
    assert.equal(await set(join(data, "one.cube")), "invalid", "1D");
    writeFileSync(join(data, "big.cube"), "LUT_3D_SIZE 66\n");
    assert.equal(await set(join(data, "big.cube")), "invalid", "over 65");
    mkdirSync(join(data, "a[1]"));
    assert.equal(
      await set(cube(join(data, "a[1]"), "x.cube")),
      "invalid",
      "brackets",
    );
    await stop();
  } finally {
    rmSync(outside, { recursive: true, force: true });
  }
});
