// Portability round P1: system.* through the player, plugin.secrets,
// plugin.app.system(), JPEG/BMP export, executable names on Windows.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";
import {
  executableNames,
  localSocketPath,
  systemServices,
} from "../src/plugin/local.ts";

async function started(capabilities: string[], host = new TestHost()) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities, host },
  );
  return { ...result, plugin };
}
const code = (expected: string) => (error: HostError) =>
  error.code === expected;

test("system.* are player requests with absolute, present paths", async () => {
  const { plugin, host, stop } = await started([]);
  const dir = mkdtempSync(join(tmpdir(), "vestra-system-"));
  const file = join(dir, "a.mkv");
  writeFileSync(file, "x");
  await plugin.system.reveal([relative(process.cwd(), file), "/nonexistent/x"]);
  await plugin.system.openPath(file);
  await plugin.system.openUrl("https://example.com/a b");
  const sent = host.calls.filter((call) => call.method.startsWith("system."));
  assert.deepEqual(sent, [
    { method: "system.reveal", params: { paths: [file] } },
    { method: "system.openPath", params: { path: file } },
    {
      method: "system.openUrl",
      params: { url: "https://example.com/a%20b" },
    },
  ]);
  assert.deepEqual(host.system.revealed, [file]);
  assert.deepEqual(host.system.opened, [file]);
  assert.deepEqual(host.system.urls, ["https://example.com/a%20b"]);
  host.handle("system.openPath", () => {
    throw new HostError("failed", "open failed");
  });
  await assert.rejects(plugin.system.openPath(file), code("failed"));
  host.handle("system.openUrl", () => {
    throw new HostError("unsupported", "opening links is not supported");
  });
  await assert.rejects(
    plugin.system.openUrl("https://example.com"),
    code("unsupported"),
  );
  await assert.rejects(
    plugin.system.openPath("/nonexistent/x"),
    code("missing"),
  );
  await assert.rejects(plugin.system.openUrl("file:///etc"), code("invalid"));
  // The real local services no longer open anything themselves.
  assert.equal("open" in systemServices, false);
  assert.equal("open" in host.local, false);
  rmSync(dir, { recursive: true });
  await stop();
});

test("secrets need the capability and are bounded", async () => {
  const without = await started([]);
  await assert.rejects(without.plugin.secrets.get("key"), code("capability"));
  await without.stop();
  const { plugin, host, stop } = await started(["secrets"]);
  assert.equal(await plugin.secrets.get("opensubtitles-api-key"), null);
  await plugin.secrets.set("opensubtitles-api-key", "密钥 1");
  assert.equal(await plugin.secrets.get("opensubtitles-api-key"), "密钥 1");
  assert.equal(host.secrets.get("opensubtitles-api-key"), "密钥 1");
  await plugin.secrets.delete("opensubtitles-api-key");
  await plugin.secrets.delete("opensubtitles-api-key");
  assert.equal(host.secrets.size, 0);
  for (const name of ["", "Key", "a/b", "x".repeat(65)])
    await assert.rejects(plugin.secrets.get(name), code("invalid"), name);
  for (const value of ["", "a\0b", "x".repeat(1025), "密".repeat(342)])
    await assert.rejects(plugin.secrets.set("k", value), code("invalid"));
  await plugin.secrets.set("k", "x".repeat(1024));
  // At most 256 names, as in the player; replacing one is fine.
  for (let i = 1; i < 256; i++) host.secrets.set(`n${i}`, "v");
  await assert.rejects(plugin.secrets.set("one-more", "v"), code("limit"));
  await plugin.secrets.set("k", "replaced");
  await plugin.secrets.delete("n1");
  await plugin.secrets.set("one-more", "v");
  host.handle("secrets.get", () => {
    throw new HostError("unsupported", "secret storage is not supported");
  });
  await assert.rejects(plugin.secrets.get("k"), code("unsupported"));
  await stop();
});

test("plugin.app.system() asks the player; the facts stay plain data", async () => {
  const host = new TestHost();
  host.systemInfo = { ...host.systemInfo, os: "windows", name: "Windows 11" };
  const { plugin, stop } = await started([], host);
  const info = await plugin.app.system();
  assert.equal(info.os, "windows");
  assert.equal(info.name, "Windows 11");
  assert.equal(info.displays[0]!.primary, true);
  assert.deepEqual(Object.keys(plugin.app), ["version", "build", "components"]);
  assert.equal(JSON.stringify(plugin.app).includes("system"), false);
  await stop();
});

test("plugin.app.system() reports the renderer, following TestHost.videoRender.gpu", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(
    ["processing.video", "playback.read", "events"],
    host,
  );
  assert.equal((await plugin.app.system()).rendering, "gpu");
  // The player falls back to software rendering (a window without GPU frames).
  host.failVideoRender(
    "unsupported",
    "the player switched to software rendering",
  );
  assert.equal((await plugin.app.system()).rendering, "software");
  const render = plugin.video.render();
  render.set({ interpolation: true });
  await host.settle();
  assert.equal(render.status.state, "failed");
  host.videoRender.gpu = true;
  assert.equal((await plugin.app.system()).rendering, "gpu");
  await stop();
});

test("snapshots export JPEG with a quality and BMP", async () => {
  const host = new TestHost();
  host.openElsewhere("/a.mp4");
  const { plugin, stop } = await started(
    ["playback.read", "events", "media.read", "media.control"],
    host,
  );
  const shot = await plugin.media.capture();
  await (
    await shot.export({ format: "jpeg", destination: "/t/a.jpg" })
  ).done;
  await shot.export({ format: "jpeg", destination: "/t/b.jpg", quality: 40 });
  await shot.export({ format: "bmp", destination: "/t/c.bmp", sampleTime: 1 });
  assert.deepEqual(
    host.exports.map((p) => [p.kind, p.quality ?? null, p.sampleTime ?? null]),
    [
      ["rawJpeg", null, null],
      ["rawJpeg", 40, null],
      ["rawBmp", null, 1],
    ],
  );
  for (const quality of [0, 101, 1.5])
    await assert.rejects(
      shot.export({ format: "jpeg", destination: "/t/d.jpg", quality }),
      code("invalid"),
    );
  await assert.rejects(
    shot.export({ format: "gif" as "png", destination: "/t/e.gif" }),
    code("invalid"),
  );
  await stop();
});

test("tools are found by their Windows names", () => {
  assert.deepEqual(executableNames("ffmpeg", "darwin"), ["ffmpeg"]);
  assert.deepEqual(executableNames("ffmpeg", "win32", ".COM;.EXE;.BAT"), [
    "ffmpeg.com",
    "ffmpeg.exe",
    "ffmpeg.bat",
  ]);
  assert.deepEqual(executableNames("ffprobe", "win32", ""), [
    "ffprobe.exe",
    "ffprobe.cmd",
    "ffprobe.bat",
    "ffprobe.com",
  ]);
});

test("a local stream is a socket file, or a named pipe on Windows", () => {
  assert.equal(
    localSocketPath("/tmp/vestra-test-host-a1", "producer-1", "darwin"),
    join("/tmp/vestra-test-host-a1", "producer-1.sock"),
  );
  assert.equal(
    localSocketPath(
      "C:\\Users\\u\\AppData\\Local\\Temp\\vestra-test-host-a1",
      "producer-1",
      "win32",
    ),
    "\\\\.\\pipe\\vestra-test-host-a1-producer-1",
  );
});
