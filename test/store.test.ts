// SDK 1.1: package sources, .vxp validation, built-in protection, and
// Markdown documents (player 0.2.0).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type {
  PackageManifest,
  Plugin,
  PluginError,
} from "../src/plugin/types.ts";
import { MARKDOWN_LIMITS } from "../src/plugin/markdown.ts";

const rejects = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });

const manifest = (id: string, version: string): PackageManifest => ({
  id,
  version,
  apiVersion: "vestra/1",
  entry: "main.js",
  capabilities: [],
});

async function manager(host = new TestHost()) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities: ["plugins.manage"], host },
  );
  return { ...result, plugin };
}

test("packages: list entries without the new fields read as before", async () => {
  const host = new TestHost();
  host.packages = [
    {
      id: "a.video",
      version: "1.0.0",
      origin: "installed",
      state: "running",
      error: null,
      capabilities: [],
      directory: "/plugins/a.video",
      previousVersion: null,
    },
  ];
  const { plugin, stop } = await manager(host);
  const [info] = await plugin.packages.list();
  assert.equal(info!.builtin, false);
  assert.equal(info!.source, null);
  assert.equal(info!.dataDirectory, null);
  await stop();
});

test("packages: .vxp install with a source, conflict, replace and built-ins", async () => {
  const host = new TestHost();
  host.packages = [
    {
      id: "vestra.video",
      version: "1.0.0",
      origin: "installed",
      state: "running",
      error: null,
      capabilities: [],
      directory: "/plugins/video",
      previousVersion: null,
      builtin: true,
      source: { kind: "bundled" },
      dataDirectory: "/data/1",
    },
  ];
  const first = "/downloads/someone.demo-1.0.0.vxp";
  const second = "/downloads/someone.demo-1.1.0.vxp";
  host.candidates.set(first, manifest("someone.demo", "1.0.0"));
  host.candidates.set(second, manifest("someone.demo", "1.1.0"));
  host.candidates.set(
    "/downloads/video.vxp",
    manifest("vestra.video", "9.0.0"),
  );
  const { plugin, stop } = await manager(host);
  const repo = {
    kind: "repository",
    url: "https://plugins.example/index.json",
  } as const;
  const candidate = await plugin.packages.validateArchive(first);
  assert.equal(candidate.manifest.version, "1.0.0");
  assert.equal(
    await (
      await candidate.install({ source: repo })
    ).done,
    "committed",
  );
  assert.deepEqual(host.sent("packages.install").at(-1)?.source, repo);
  // Same source: an upgrade.
  const upgrade = await plugin.packages.validateArchive(second);
  assert.equal(
    await (
      await upgrade.install({ source: repo })
    ).done,
    "committed",
  );
  // Another source: conflict until the user agrees to replace.
  await rejects(upgrade.install({ source: { kind: "file" } }), "conflict");
  await rejects(upgrade.install(), "conflict");
  assert.equal(
    await (
      await upgrade.install({ source: { kind: "file" }, replace: true })
    ).done,
    "committed",
  );
  assert.deepEqual(host.packageCalls.at(-1), {
    method: "install",
    id: "someone.demo",
    source: { kind: "file" },
    replace: true,
  });
  const list = await plugin.packages.list();
  assert.deepEqual(list.find((p) => p.id === "someone.demo")?.source, {
    kind: "file",
  });
  // Built-ins: never installed over, never uninstalled.
  const video = await plugin.packages.validateArchive("/downloads/video.vxp");
  await rejects(video.install({ replace: true }), "unsupported");
  await rejects(plugin.packages.uninstall("vestra.video"), "unsupported");
  assert.equal(list.find((p) => p.id === "vestra.video")?.builtin, true);
  // Arguments are checked before anything is sent.
  await rejects(
    candidate.install({ source: { kind: "bundled" } as never }),
    "invalid",
  );
  await rejects(
    candidate.install({ source: { kind: "link", url: "file:///x.vxp" } }),
    "invalid",
  );
  await rejects(plugin.packages.validateArchive("/nowhere.vxp"), "missing");
  await stop();
});

/** A 1×1 PNG. */
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
    "1f15c4890000000d4944415478da63f8ffffff7f0009fb03fd2a86e38a0000000049454e44ae426082",
  "hex",
);

test("ui.markdown: wire form, image downloads into the cache, failures stay quiet", async () => {
  const host = new TestHost();
  const files = mkdtempSync(join(tmpdir(), "md-"));
  writeFileSync(join(files, "ok.png"), PNG);
  writeFileSync(join(files, "bad.gif"), "GIF89a");
  host.remoteImages.set("https://img.example/ok.png", join(files, "ok.png"));
  host.remoteImages.set("https://img.example/bad.gif", join(files, "bad.gif"));
  const errors: PluginError[] = [];
  let plugin!: Plugin;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.onError((error) => errors.push(error));
    },
    { capabilities: ["ui.window"], host },
  );
  const text =
    "# Demo\n\n![ok](https://img.example/ok.png) ![bad](https://img.example/bad.gif) ![gone](https://img.example/gone.png)";
  const doc = await plugin.ui.markdown(text, {
    base: "https://raw.example/README.md",
  });
  assert.equal(doc.text, text);
  const wire = host.markdown(JSON.parse(JSON.stringify(doc)));
  assert.equal(wire?.base, "https://raw.example/README.md");
  const cached = wire!.images["https://img.example/ok.png"]!;
  assert.ok(
    cached.startsWith(join(plugin.dataDirectory, ".vestra-cache", "markdown")),
  );
  assert.deepEqual(Object.keys(wire!.images), ["https://img.example/ok.png"]);
  // Within a day the cached file is reused without downloading.
  host.remoteImages.delete("https://img.example/ok.png");
  const again = host.markdown(
    JSON.parse(JSON.stringify(await plugin.ui.markdown(text))),
  );
  assert.equal(again!.images["https://img.example/ok.png"], cached);
  // remoteImages: false skips the scan and downloads.
  const scans = host.sent("ui.markdownScan").length;
  const local = await plugin.ui.markdown(text, { remoteImages: false });
  assert.equal(host.sent("ui.markdownScan").length, scans);
  assert.deepEqual(
    host.markdown(JSON.parse(JSON.stringify(local)))!.images,
    {},
  );
  await rejects(plugin.ui.markdown("x", { base: "relative/dir" }), "invalid");
  await rejects(
    plugin.ui.markdown("x".repeat(MARKDOWN_LIMITS.textBytes + 1)),
    "invalid",
  );
  assert.deepEqual(errors, []);
  assert.equal(
    readdirSync(join(plugin.dataDirectory, ".vestra-cache", "markdown")).length,
    1,
  );
  await stop();
});

test("ui.markdown: sent as a property value, refused after its scope is released", async () => {
  const directory = mkdtempSync(join(tmpdir(), "md-view-"));
  writeFileSync(
    join(directory, "readme.slint"),
    'import { MarkdownView, MarkdownBlock } from "@vestra/markdown.slint";\nexport component Readme inherits Window { in property <[MarkdownBlock]> doc; MarkdownView { blocks: root.doc; } }\n',
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.md", capabilities: ["ui.window"] }),
  );
  const errors: PluginError[] = [];
  let plugin!: Plugin;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.onError((error) => errors.push(error));
    },
    { directory },
  );
  const window = plugin.windows.create("readme.slint");
  window.set({ doc: await plugin.ui.markdown("**hi**") });
  await window.show();
  await host.settle();
  assert.equal(host.markdown(host.window("readme").props.doc)?.text, "**hi**");
  const child = plugin.scope();
  const old = await child.ui.markdown("old");
  await child.dispose();
  window.set({ doc: old });
  await host.settle();
  assert.equal(errors.at(-1)?.code, "invalid");
  assert.equal(host.markdown(host.window("readme").props.doc)?.text, "**hi**");
  assert.equal(existsSync(directory), true);
  await stop();
});

test("image downloads: user agent, https redirects only, HTTP errors and size caps", async () => {
  const { httpsDownload, USER_AGENT } =
    await import("../src/plugin/markdown.ts");
  const seen: { url: string; agent: string | null; redirect?: string }[] = [];
  const routes: Record<string, () => Response> = {
    "https://a.example/ok.png": () => new Response(PNG, { status: 200 }),
    "https://a.example/moved": () =>
      new Response(null, { status: 302, headers: { location: "/ok.png" } }),
    "https://a.example/to-http": () =>
      new Response(null, {
        status: 301,
        headers: { location: "http://a.example/ok.png" },
      }),
    "https://a.example/loop": () =>
      new Response(null, { status: 302, headers: { location: "/loop" } }),
    "https://a.example/bad": () => new Response("Bad Request", { status: 400 }),
    "https://a.example/big": () =>
      new Response(new Uint8Array(100), {
        status: 200,
        headers: { "content-length": "100" },
      }),
    "https://a.example/stream": () =>
      new Response(new Uint8Array(100), { status: 200 }),
  };
  const fake = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      agent: new Headers(init?.headers).get("user-agent"),
      ...(init?.redirect ? { redirect: init.redirect } : {}),
    });
    const route = routes[url];
    if (!route) return new Response(null, { status: 404 });
    return route();
  }) as typeof fetch;
  const options = () => ({ maxBytes: 50, signal: AbortSignal.timeout(1000) });
  const ok = await httpsDownload(
    "https://a.example/moved",
    { ...options(), maxBytes: 1024 },
    fake,
  );
  assert.deepEqual(Buffer.from(ok), PNG);
  assert.deepEqual(
    seen.map((s) => [s.url, s.agent, s.redirect]),
    [
      ["https://a.example/moved", USER_AGENT, "manual"],
      ["https://a.example/ok.png", USER_AGENT, "manual"],
    ],
  );
  await assert.rejects(
    httpsDownload("https://a.example/bad", options(), fake),
    /HTTP 400/,
  );
  await assert.rejects(
    httpsDownload("https://a.example/missing", options(), fake),
    /HTTP 404/,
  );
  await assert.rejects(
    httpsDownload("https://a.example/to-http", options(), fake),
    /only https/,
  );
  await assert.rejects(
    httpsDownload("http://a.example/ok.png", options(), fake),
    /only https/,
  );
  await assert.rejects(
    httpsDownload("https://a.example/loop", options(), fake),
    /too many redirects/,
  );
  await assert.rejects(
    httpsDownload("https://a.example/big", options(), fake),
    /too large/,
  );
  await assert.rejects(
    httpsDownload("https://a.example/stream", options(), fake),
    /too large/,
  );
});
