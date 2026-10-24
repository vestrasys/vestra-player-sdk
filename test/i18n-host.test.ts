import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Plugin } from "../src/index.ts";
import { LOCALES, startPlugin, TestHost } from "../src/plugin/testing.ts";

/** A package directory with a manifest and a zh-Hans catalog. */
function pluginDirectory() {
  const directory = mkdtempSync(join(tmpdir(), "vestra-i18n-"));
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "examples.i18n",
      version: "0.1.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: ["commands", "ui.osd", "ui.dialog", "ui.theme", "events"],
    }),
  );
  mkdirSync(join(directory, "locales"));
  writeFileSync(
    join(directory, "locales/zh-Hans.po"),
    `msgid ""
msgstr ""
"Language: zh-Hans\\n"

msgid "Tools"
msgstr "工具"

msgid "Blur…"
msgstr "模糊…"

msgid "Speed {}×"
msgstr "倍速 {}×"

msgid "Delete {} bookmarks?"
msgstr "删除 {} 个书签？"

msgid "Delete"
msgstr "删除"

msgid "Needs a video"
msgstr "需要视频"
`,
  );
  return directory;
}

const activate = (plugin: Plugin) => {
  plugin.commands.add({
    id: "blur",
    path: ["@video", "Tools", "Blur…"],
    enabled: false,
    reason: "Needs a video",
    run() {},
  });
  plugin.commands.add({ id: "plain", path: ["Settings", "Plain"], run() {} });
};

test("the test host shows a plugin's declarations in its locale", async () => {
  const directory = pluginDirectory();
  try {
    const zh = await startPlugin(activate, { directory, locale: "zh-Hans" });
    assert.equal(zh.plugin.i18n.locale, "zh-Hans");
    assert.deepEqual(zh.host.command("blur").display, {
      title: "模糊…",
      path: ["视频", "工具", "模糊…"],
    });
    // The key stays what the plugin declared.
    assert.deepEqual(zh.host.command("blur").declaration.path, [
      "@video",
      "Tools",
      "Blur…",
    ]);
    // Untranslated text shows as written; the player's menu in its words.
    assert.deepEqual(zh.host.command("plain").display.path, ["设置", "Plain"]);
    await zh.stop();
    const en = await startPlugin(activate, { directory, locale: "en" });
    assert.equal(en.plugin.i18n.locale, "en");
    assert.deepEqual(en.host.command("blur").display.path, [
      "Video",
      "Tools",
      "Blur…",
    ]);
    await en.stop();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("templates: osd messages and dialogs are translated, then formatted", async () => {
  const directory = pluginDirectory();
  try {
    const { host, plugin, stop } = await startPlugin(() => {}, {
      directory,
      locale: "zh-Hans",
    });
    await plugin.osd.show("Speed {}×", [1.5]);
    await plugin.osd.show("Not translated {name}", { name: "x" });
    await plugin.osd.show("Braces {stay} without args");
    assert.deepEqual(host.osd, [
      "倍速 1.5×",
      "Not translated x",
      "Braces {stay} without args",
    ]);
    assert.deepEqual(host.sent("osd.show")[0], {
      text: "Speed {}×",
      args: [1.5],
    });
    await assert.rejects(
      plugin.osd.show("Bad", [{ x: 1 }] as never),
      (error: { code?: string }) => error.code === "invalid",
    );
    host.dialogAnswers.push({ confirmed: true, checked: false });
    await plugin.dialogs.confirm({
      message: "Delete {} bookmarks?",
      confirm: "Delete",
      args: [3],
    });
    assert.deepEqual(host.confirmTexts.at(-1), {
      message: "删除 3 个书签？",
      confirm: "删除",
      cancel: "取消",
    });
    const panel = plugin.osd.panel();
    panel.set("Speed {}×", [2]);
    await host.settle();
    assert.equal(host.osdPanel, "倍速 2×");
    await stop();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("the player's own texts follow the locale; without one they stay Chinese", async () => {
  const run = async (host: TestHost) => {
    host.openElsewhere("/a.mp4");
    const { stop } = await startPlugin(() => {}, {
      capabilities: ["commands", "playback.read", "playback.control"],
      host,
    });
    await host.coreAction("play-pause").run();
    await host.coreAction("mute").run();
    const shown = {
      osd: [...host.osd],
      menu: host.coreAction("seek-forward").display.path,
      reason: host.coreAction("previous").state.reason,
    };
    await stop();
    return shown;
  };
  assert.deepEqual(await run(new TestHost()), {
    osd: ["已暂停", "静音: 开"],
    menu: ["播放", "跳转", "前进5秒"],
    reason: "没有上一个",
  });
  const english = new TestHost();
  english.locale = "en";
  assert.deepEqual(await run(english), {
    osd: ["Paused", "Mute: On"],
    menu: ["Playback", "Seek", "Forward 5 s"],
    reason: "No previous item",
  });
  const german = new TestHost();
  german.locale = "de";
  // The player has no German of its own yet: English.
  assert.deepEqual((await run(german)).osd, ["Paused", "Mute: On"]);
  assert.throws(() => {
    new TestHost().locale = "zh-Hant" as never;
  });
  assert.deepEqual(LOCALES, ["en", "zh-Hans", "ja", "ko", "de", "fr", "es"]);
});

test("appearance.language is the saved choice; setLanguage saves it for the next start", async () => {
  const host = new TestHost();
  host.locale = "fr";
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["ui.theme", "events"],
    host,
  });
  assert.equal(plugin.i18n.locale, "fr");
  assert.equal(plugin.appearance.language, "system");
  await plugin.appearance.setLanguage("ja");
  assert.equal(host.language, "ja");
  assert.equal(plugin.appearance.language, "ja");
  // The language of this run does not change.
  assert.equal(plugin.i18n.locale, "fr");
  host.setLanguage("system");
  await host.settle();
  assert.equal(plugin.appearance.language, "system");
  await assert.rejects(
    plugin.appearance.setLanguage("klingon" as never),
    (error: { code?: string }) => error.code === "invalid",
  );
  await stop();
});
