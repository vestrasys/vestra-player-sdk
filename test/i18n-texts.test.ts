// Text values (SDK 1.5.11): plugin.i18n.text / list / error, shown by the
// test host the way the player shows them, and found by `i18n extract`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import type { Plugin, PluginError, ResolvedStream } from "../src/index.ts";
import {
  LIST_SEPARATORS,
  LOCALES,
  startPlugin,
  TEXT_LIMITS,
  TestHost,
} from "../src/plugin/testing.ts";
import { parsePo, renderText, Catalog, textKey } from "../src/i18n.ts";
import { error, list, text } from "../src/plugin/language.ts";

const ZH = `msgid ""
msgstr ""
"Language: zh-Hans\\n"

msgid "Audio Track"
msgstr "音轨"

msgid "Track {} ({})"
msgstr "音轨 {} ({})"

msgid "No Audio"
msgstr "无声音"

msgid "Track {} · {}"
msgstr "音轨 {} · {}"

msgid "Download failed: {}"
msgstr "下载失败：{}"

msgid "Connection timed out"
msgstr "连接超时"

msgid "Removed missing shaders: {}"
msgstr "已移除不存在的着色器：{}"

msgid "Added: {}"
msgstr "已添加 {} 项"

msgid "duplicates skipped: {}"
msgstr "跳过 {} 个重复"

msgid "Install “{}”?"
msgstr "安装「{}」？"

msgid "It will be able to:\\n{}"
msgstr "它将可以：\\n{}"

msgid "Read and write the clipboard"
msgstr "读写剪贴板"

msgid "Use the network"
msgstr "访问网络"

msgid "Install"
msgstr "安装"

msgid "Playlist.m3u8"
msgstr "播放列表.m3u8"

msgid "Save the list"
msgstr "保存列表"

msgid "Needs {} more"
msgstr "还需要 {} 个"

msgid "The ROM file was not found."
msgstr "找不到 ROM 文件。"

msgid "Chapter {}"
msgstr "第 {} 章"

msgid "Version {}"
msgstr "版本 {}"

msgid "Copy Info"
msgstr "复制信息"

msgid "Resolution: {}"
msgstr "分辨率：{}"
`;

function directory() {
  const dir = mkdtempSync(join(tmpdir(), "vestra-texts-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "locales"));
  writeFileSync(join(dir, "locales/zh-Hans.po"), ZH);
  return dir;
}

const capabilities = [
  "commands",
  "ui.osd",
  "ui.dialog",
  "ui.window",
  "bindings.manage",
  "playback.read",
  "playback.control",
  "events",
  "source.resolve",
  "producer.av",
];

test("text and list values are plain, frozen data and refuse malformed input", () => {
  const value = text("Track {} ({})", [2, "opus"]);
  assert.deepEqual(JSON.parse(JSON.stringify(value)), {
    $vestraText: "Track {} ({})",
    args: [2, "opus"],
  });
  assert.ok(Object.isFrozen(value));
  assert.deepEqual(
    JSON.parse(JSON.stringify(list(["a", text("b")], "lines"))),
    {
      $vestraList: ["a", { $vestraText: "b" }],
      style: "lines",
    },
  );
  const invalid = (run: () => unknown, pattern: RegExp) =>
    assert.throws(
      run,
      (e: PluginError) => e.code === "invalid" && pattern.test(e.message),
    );
  invalid(() => text(""), /non-empty/);
  invalid(() => text("x", [Number.NaN]), /finite/);
  invalid(() => text("x", Array(17).fill(1)), /at most 16/);
  invalid(() => text("x", [{} as never]), /strings, numbers, texts/);
  invalid(() => list("a" as never), /array/);
  invalid(() => list([], "and" as never), /style/);
  invalid(() => list(Array(257).fill("a")), /at most 256 items/);
  let deep = text("x");
  for (let i = 0; i < TEXT_LIMITS.depth; i++) deep = text("{}", [deep]);
  invalid(() => text("{}", [deep]), /nest at most 8/);
  invalid(() => text("x", ["a".repeat(4097)]), /4096 bytes/);
  // The English rendering is what menus merge by.
  assert.equal(
    textKey(text("Track {} ({})", [2, "opus"]) as never),
    "Track 2 (opus)",
  );
  // Separators per language.
  assert.deepEqual(Object.keys(LIST_SEPARATORS), [...LOCALES]);
  const shown = (locale: string) =>
    renderText(list(["a", "b"]) as never, new Catalog(), locale);
  assert.equal(shown("en"), "a, b");
  assert.equal(shown("zh-Hans"), "a、b");
});

test("OSD messages built from translated parts and lists", async () => {
  const dir = directory();
  const activate = async (plugin: Plugin) => {
    const { text, list } = plugin.i18n;
    await plugin.osd.show("Download failed: {}", [
      text("Connection timed out"),
    ]);
    await plugin.osd.show("Removed missing shaders: {}", [
      list(["a.glsl", "b.glsl"]),
    ]);
    await plugin.osd.show(
      list(
        [text("Added: {}", [3]), text("duplicates skipped: {}", [2])],
        "clauses",
      ),
    );
    plugin.osd.panel().set(text("Needs {} more", [2]));
  };
  for (const [locale, expected, panel] of [
    [
      "zh-Hans",
      [
        "下载失败：连接超时",
        "已移除不存在的着色器：a.glsl、b.glsl",
        "已添加 3 项，跳过 2 个重复",
      ],
      "还需要 2 个",
    ],
    [
      "en",
      [
        "Download failed: Connection timed out",
        "Removed missing shaders: a.glsl, b.glsl",
        "Added: 3, duplicates skipped: 2",
      ],
      "Needs 2 more",
    ],
  ] as const) {
    const { host, stop } = await startPlugin(activate, {
      directory: dir,
      locale,
      capabilities,
    });
    await host.settle();
    assert.deepEqual(host.osd, expected);
    assert.equal(host.osdPanel, panel);
    // What the plugin sent is data.
    assert.deepEqual(host.sent("osd.show")[0], {
      text: "Download failed: {}",
      args: [{ $vestraText: "Connection timed out" }],
    });
    await stop();
  }
  // A text value carries its own args.
  const { plugin, stop } = await startPlugin(() => {}, { capabilities });
  await assert.rejects(
    plugin.osd.show(plugin.i18n.text("x"), ["y"]),
    (e: PluginError) => e.code === "invalid",
  );
  await stop();
});

test("menu titles with data: shown translated, merged and bound by the English key", async () => {
  const dir = directory();
  const { host, plugin, stop } = await startPlugin(
    (plugin) => {
      const { text } = plugin.i18n;
      plugin.commands.add({
        id: "track-2",
        path: ["@audio", "Audio Track", text("Track {} ({})", [2, "opus"])],
        enabled: false,
        reason: text("Needs {} more", [1]),
        run() {},
      });
    },
    { directory: dir, locale: "zh-Hans", capabilities },
  );
  const command = host.command("track-2");
  assert.deepEqual(command.display, {
    title: "音轨 2 (opus)",
    path: ["声音", "音轨", "音轨 2 (opus)"],
  });
  assert.equal(command.display.reason, "还需要 1 个");
  const [info] = (await plugin.bindings.list()).commands.filter(
    (c) => c.command === "track-2",
  );
  assert.deepEqual(info!.path, ["声音", "音轨", "音轨 2 (opus)"]);
  assert.deepEqual(info!.key, ["Audio", "Audio Track", "Track 2 (opus)"]);
  assert.throws(
    () =>
      plugin.commands.add({
        id: "bad",
        path: ["Tools", plugin.i18n.list(["a"]) as never],
        run() {},
      }),
    /not a list/,
  );
  await stop();
});

test("window [string] models mix words and data; dialogs show texts", async () => {
  const dir = directory();
  const host = new TestHost();
  host.dialogAnswers.push({ confirmed: true, checked: false }, ["/tmp/x.m3u8"]);
  const { stop } = await startPlugin(
    async (plugin) => {
      const { text, list } = plugin.i18n;
      const picker = plugin.windows.create("ui/clip.slint");
      picker.set({
        labels: [text("No Audio"), text("Track {} · {}", [7, "en"])],
        rows: [{ label: text("No Audio"), id: 0 }],
      });
      await picker.show();
      picker.set({ status: list(["a", "b"]) });
      await plugin.dialogs.confirm({
        message: "Install “{}”?",
        detail: text("It will be able to:\n{}", [
          list(
            [text("Read and write the clipboard"), text("Use the network")],
            "lines",
          ),
        ]),
        confirm: "Install",
        args: ["Blur"],
      });
      await plugin.dialogs.saveFile({
        title: "Save the list",
        fileName: text("Playlist.m3u8"),
      });
    },
    { directory: dir, locale: "zh-Hans", capabilities, host },
  );
  await host.settle();
  const [window] = [...host.windows.values()];
  assert.deepEqual(window!.props["labels"], ["无声音", "音轨 7 · en"]);
  assert.deepEqual(window!.props["rows"], [{ label: "无声音", id: 0 }]);
  assert.equal(window!.props["status"], "a、b");
  assert.deepEqual(host.confirmTexts.at(-1), {
    message: "安装「Blur」？",
    detail: "它将可以：\n读写剪贴板\n访问网络",
    confirm: "安装",
    cancel: "取消",
  });
  assert.deepEqual(host.fileDialogs.at(-1), {
    kind: "saveFile",
    title: "保存列表",
    fileName: "播放列表.m3u8",
  });
  await stop();
});

test("a resolver's TextError shows translated as the open's failure", async () => {
  const dir = directory();
  const resolve = async (): Promise<ResolvedStream> => {
    throw error("The ROM file was not found.");
  };
  for (const [locale, words] of [
    ["zh-Hans", "找不到 ROM 文件。"],
    ["en", "The ROM file was not found."],
  ] as const) {
    let plugin!: Plugin;
    const { host, stop } = await startPlugin(
      (p) => {
        plugin = p;
        p.resolvers.add({ id: "nes", extensions: ["nes"], resolve });
      },
      { directory: dir, locale, capabilities },
    );
    await assert.rejects(
      plugin.player.open("/roms/missing.nes"),
      (e: PluginError) => e.message === words,
    );
    assert.equal(plugin.player.state.error, words);
    assert.deepEqual(host.sent("sourceResolvers.respond")[0]!["error"], {
      $vestraText: "The ROM file was not found.",
    });
    await stop();
  }
  const e = error("Needs {} more", [2]);
  assert.ok(e instanceof Error);
  assert.equal(e.message, "Needs 2 more");
});

test("timeline titles, OSD panel columns and the export-only resolve", async () => {
  const dir = directory();
  const { host, plugin, stop } = await startPlugin(
    (plugin) => {
      const { text } = plugin.i18n;
      plugin.timeline
        .layer()
        .set([{ time: 0, kind: "chapter", title: text("Chapter {}", [1]) }]);
      plugin.osd
        .panel()
        .set(text("Resolution: {}", ["1920×1080 (HDR10, BT.2020)"]), null, {
          maxColumns: 12,
        });
    },
    {
      directory: dir,
      locale: "zh-Hans",
      capabilities: [...capabilities, "timeline.marks"],
    },
  );
  await host.settle();
  assert.equal(
    host.timeline.layers.get(host.manifestId)?.[0]?.title,
    "第 1 章",
  );
  // Cut after translation: 分辨率： is 8 columns.
  assert.equal(host.osdPanel, "分辨率：192…");
  const { text, list, resolve } = plugin.i18n;
  assert.equal(resolve("Copy Info"), "复制信息");
  assert.equal(
    resolve(list([text("Version {}", [3]), "x"], "lines")),
    "版本 3\nx",
  );
  assert.throws(() => resolve({} as never), /resolve/);
  await stop();
});

// ------------------------------------------------------------- extraction

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "bin/vestra-plugin.mjs");

const MAIN = `import type { Plugin } from "@vestra-player/sdk";
import { REASONS, extra } from "./model.ts";
import type { Reason } from "./model.ts";

export default async function activate(plugin: Plugin) {
  const { text, list } = plugin.i18n;
  const n = 2;
  const why: Reason = n > 1 ? "dns" : "timeout";
  plugin.commands.add({
    id: "t",
    path: ["@audio", "Audio Track", text("Track {} ({})", [n, "opus"])],
    reason: text(n > 1 ? "Busy" : "Idle"),
    run: () => plugin.osd.show("Download failed: {}", [plugin.i18n.text(REASONS[why])]),
  });
  plugin.commands.add({ id: "s", title: "Spread", ...extra, run() {} });
  void plugin.osd.show(list([text("· {}", [text("Use the network")])], "lines"));
  void plugin.osd.show(text(\`Track \${n}\`));
  void plugin.osd.show({ $vestraText: "Hand written" });
  throw plugin.i18n.error("The ROM file was not found.");
}
`;

const MODEL = `export const REASONS = { timeout: "Connection timed out", dns: "Server not found" } as const;
export type Reason = keyof typeof REASONS;
export const extra = { reason: String(Date.now()) as string | null };
`;

test("extract finds text(), error() and $vestraText sources; a spread field is reported", () => {
  const dir = mkdtempSync(join(tmpdir(), "vestra-texts-cli-"));
  test.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, "node_modules/@vestra-player"), { recursive: true });
  symlinkSync(root, join(dir, "node_modules/@vestra-player/sdk"), "junction");
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      id: "me.texts",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd"],
    }),
  );
  writeFileSync(join(dir, "package.json"), '{"type":"module"}');
  writeFileSync(join(dir, "main.ts"), MAIN);
  writeFileSync(join(dir, "model.ts"), MODEL);
  const extract = spawnSync(process.execPath, [cli, "i18n", "extract"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(extract.status, 0, extract.stderr + extract.stdout);
  const ids = parsePo(readFileSync(join(dir, "locales/messages.pot"), "utf8"))
    .entries.map((e) => e.id)
    .sort();
  assert.deepEqual(ids, [
    "Audio Track",
    "Busy",
    "Connection timed out",
    "Download failed: {}",
    "Hand written",
    "Idle",
    "Server not found",
    "Spread",
    "The ROM file was not found.",
    "Track {} ({})",
    "Use the network",
  ]);
  const check = spawnSync(process.execPath, [cli, "i18n", "check"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.equal(check.status, 0, check.stderr);
  assert.match(
    check.stdout,
    /main\.ts:15: reason spread into Commands\.add is not a literal/,
  );
  assert.match(
    check.stdout,
    /main\.ts:17: user-visible text composed in TypeScript/,
  );
  // A text value is not a dynamic menu path or reason.
  assert.doesNotMatch(check.stdout, /main\.ts:(9|10|11|12):/);
});
