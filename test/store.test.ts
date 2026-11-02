// SDK 1.1: package sources, .vxp validation, built-in protection, and
// Markdown documents (player 0.2.0).
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type {
  InstallOptions,
  PackageManifest,
  Plugin,
  PluginError,
} from "../src/plugin/types.ts";
import type { Json } from "../src/wire.ts";
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
      builtin: true,
      source: { kind: "bundled" },
      dataDirectory: "/data/1",
    },
  ];
  // validateArchive resolves the path (on Windows /downloads becomes
  // D:\downloads), so the test packages are keyed by the resolved path.
  const first = resolve("/downloads/someone.demo-1.0.0.vxp");
  const second = resolve("/downloads/someone.demo-1.1.0.vxp");
  const builtinArchive = resolve("/downloads/video.vxp");
  host.candidates.set(first, manifest("someone.demo", "1.0.0"));
  host.candidates.set(second, manifest("someone.demo", "1.1.0"));
  host.candidates.set(builtinArchive, manifest("vestra.video", "9.0.0"));
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
  const video = await plugin.packages.validateArchive(builtinArchive);
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

test("packages.install enabled (SDK 1.5.55): updates keep a disabled plugin disabled unless asked", async () => {
  const host = new TestHost();
  const archive = (version: string) => {
    const path = resolve(`/downloads/someone.demo-${version}.vxp`);
    host.candidates.set(path, manifest("someone.demo", version));
    return path;
  };
  const versions = ["1.0.0", "1.1.0", "1.2.0", "1.3.0", "1.4.0"].map(archive);
  const { plugin, stop } = await manager(host);
  const state = async () =>
    (await plugin.packages.list()).find((p) => p.id === "someone.demo")?.state;
  const install = async (path: string, options?: InstallOptions) =>
    (await (await plugin.packages.validateArchive(path)).install(options)).done;

  // A first install runs; `enabled` is not sent when not given.
  assert.equal(await install(versions[0]!), "committed");
  assert.equal(await state(), "running");
  assert.equal("enabled" in host.sent("packages.install").at(-1)!, false);
  assert.equal("enabled" in host.packageCalls.at(-1)!, false);

  // The user disables it: an update (any source, `replace` too) keeps it so.
  await plugin.packages.setEnabled("someone.demo", false);
  assert.equal(await install(versions[1]!), "committed");
  assert.equal(await state(), "disabled");
  assert.equal(
    await install(versions[1]!, {
      source: { kind: "workshop" },
      replace: true,
    }),
    "committed",
  );
  assert.equal(await state(), "disabled");

  // `true` enables the fixed version; it is sent and recorded.
  assert.equal(
    await install(versions[2]!, {
      source: { kind: "workshop" },
      enabled: true,
    }),
    "committed",
  );
  assert.equal(await state(), "running");
  assert.equal(host.sent("packages.install").at(-1)?.enabled, true);
  assert.deepEqual(host.packageCalls.at(-1), {
    method: "install",
    id: "someone.demo",
    source: { kind: "workshop" },
    replace: false,
    enabled: true,
  });

  // `false` installs it disabled; a later plain update keeps that.
  assert.equal(
    await install(versions[3]!, {
      source: { kind: "workshop" },
      enabled: false,
    }),
    "committed",
  );
  assert.equal(await state(), "disabled");
  assert.equal(host.sent("packages.install").at(-1)?.enabled, false);
  assert.equal(
    await install(versions[4]!, { source: { kind: "workshop" } }),
    "committed",
  );
  assert.equal(await state(), "disabled");

  // Anything but a boolean is refused before it is sent.
  const sent = host.sent("packages.install").length;
  const candidate = await plugin.packages.validateArchive(versions[0]!);
  for (const enabled of [null, "yes", 1])
    await rejects(candidate.install({ enabled } as never), "invalid");
  assert.equal(host.sent("packages.install").length, sent);
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

test("ui.markdown: documents at any depth of a value (chat rows), released ones refused", async () => {
  const directory = mkdtempSync(join(tmpdir(), "md-rows-"));
  writeFileSync(
    join(directory, "chat.slint"),
    'import { MarkdownBlocks, MarkdownBlock } from "@vestra/markdown.slint";\nexport struct Message { id: string, body: [MarkdownBlock] }\nexport component Chat inherits Window { in property <[Message]> messages; for m in root.messages: MarkdownBlocks { blocks: m.body; } }\n',
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.chat", capabilities: ["ui.window"] }),
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
  const chat = plugin.windows.create("chat.slint");
  const messages = [
    {
      id: "m1",
      body: await plugin.ui.markdown("**你好**", { remoteImages: false }),
    },
  ];
  chat.bind(() => ({ messages }));
  await chat.show();
  await host.settle();
  const shown = () =>
    (host.window("chat").props.messages as { id: string; body: Json }[]).map(
      (m) => host.markdown(m.body)?.text,
    );
  assert.deepEqual(shown(), ["**你好**"]);
  // A streamed reply: the last row's document is replaced on every update.
  messages.push({ id: "m2", body: await plugin.ui.markdown("第") });
  plugin.update();
  await host.settle();
  messages[1]!.body = await plugin.ui.markdown("第二条");
  plugin.update();
  await host.settle();
  assert.deepEqual(shown(), ["**你好**", "第二条"]);
  assert.equal(errors.length, 0);
  // A released document is refused wherever it is; the view keeps its value.
  const child = plugin.scope();
  const old = await child.ui.markdown("old");
  await child.dispose();
  chat.set({ messages: [{ id: "m3", body: old }] });
  await host.settle();
  assert.equal(errors.at(-1)?.code, "invalid");
  assert.deepEqual(shown(), ["**你好**", "第二条"]);
  await stop();
});

test("ui.image nests in rows (SDK 1.5.19): maxSide, released images refused at any depth", async () => {
  const directory = mkdtempSync(join(tmpdir(), "image-rows-"));
  writeFileSync(
    join(directory, "list.slint"),
    "export struct Row { key: string, icon: image }\nexport component List inherits Window { in property <[Row]> rows; }\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.list", capabilities: ["ui.window"] }),
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
  const logo = join(directory, "logo.png");
  const list = plugin.windows.create("list.slint");
  list.set({
    rows: [
      { key: "a", icon: plugin.ui.image(logo, { maxSide: 64 }) },
      { key: "b", icon: plugin.ui.image(logo) },
    ],
  });
  await list.show();
  await host.settle();
  const rows = host.window("list").props.rows as { key: string; icon: Json }[];
  assert.deepEqual(
    rows.map((row) => host.imagePath(row.icon)),
    [logo, logo],
  );
  assert.deepEqual(
    host.images.slice(-2).map((image) => image.maxSide),
    [64, undefined],
  );
  assert.equal(errors.length, 0);
  // maxSide is an integer 1–4096.
  for (const maxSide of [0, 4097, 1.5])
    assert.throws(
      () => plugin.ui.image(logo, { maxSide }),
      (error: PluginError) => error.code === "invalid",
    );
  // A released image is refused wherever it is; the view keeps its value.
  const child = plugin.scope();
  const old = child.ui.image(logo);
  await child.dispose();
  list.set({ rows: [{ key: "c", icon: old }] });
  await host.settle();
  assert.equal(errors.at(-1)?.code, "invalid");
  assert.equal(
    (host.window("list").props.rows as { key: string }[])[0]!.key,
    "a",
  );
  await stop();
});

test("ui.remoteImage downloads into the image cache once; failures reject unavailable", async () => {
  const files = mkdtempSync(join(tmpdir(), "remote-image-"));
  writeFileSync(join(files, "ok.png"), PNG);
  writeFileSync(join(files, "bad.gif"), "GIF89a");
  const host = new TestHost();
  host.remoteImages.set("https://img.example/ok.png", join(files, "ok.png"));
  host.remoteImages.set("https://img.example/bad.gif", join(files, "bad.gif"));
  let plugin!: Plugin;
  const { stop } = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { host },
  );
  const image = await plugin.ui.remoteImage("https://img.example/ok.png", {
    maxSide: 320,
  });
  assert.ok(
    image.path.startsWith(
      join(plugin.dataDirectory!, ".vestra-cache", "images"),
    ),
    image.path,
  );
  assert.equal(
    JSON.parse(JSON.stringify(image)).maxSide,
    320,
    "the option travels with the reference",
  );
  // A second reference reads the cache: no download.
  host.remoteImages.delete("https://img.example/ok.png");
  const again = await plugin.ui.remoteImage("https://img.example/ok.png");
  assert.equal(again.path, image.path);
  for (const url of ["https://img.example/bad.gif", "https://img.example/x"])
    await assert.rejects(
      plugin.ui.remoteImage(url),
      (error: PluginError) => error.code === "unavailable",
    );
  await assert.rejects(
    plugin.ui.remoteImage("http://img.example/ok.png"),
    (error: PluginError) => error.code === "invalid",
  );
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
