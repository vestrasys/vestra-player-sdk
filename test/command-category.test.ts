// CommandOptions.category and CommandOptions.home (SDK 1.6.4, player 0.7.6):
// sent only when set, checked as the player checks them, the category shown
// translated in the test host and in `bindings.list`.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { CommandOptions, Plugin } from "../src/index.ts";
import {
  COMMAND_LIMITS,
  HostError,
  startPlugin,
} from "../src/plugin/testing.ts";

const TEXT = "requires 1..=%d bytes, no controls or surrounding whitespace";

async function refused(options: Omit<CommandOptions, "run">, message: string) {
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({ ...options, run() {} });
      },
      { capabilities: [] },
    ),
    (error: HostError) => {
      assert.equal(error.code, "invalid", JSON.stringify(options));
      assert.equal(error.message, message, JSON.stringify(options));
      return true;
    },
  );
}

test("category and home are sent only when set", async () => {
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({ id: "plain", path: ["Tools", "Plain"], run() {} });
      plugin.commands.add({
        id: "earlier",
        title: "Earlier 0.5 s",
        category: "Subtitle Sync",
        home: "tune",
        run() {},
      });
    },
    { capabilities: [] },
  );
  try {
    const plain = host.command("plain").declaration;
    assert.ok(!("category" in plain) && !("home" in plain));
    const earlier = host.command("earlier");
    assert.equal(earlier.declaration.category, "Subtitle Sync");
    assert.equal(earlier.declaration.home, "tune");
    assert.equal(earlier.display.category, "Subtitle Sync");
    // Not enumerable, like `reason`: comparing { title, path } still works.
    assert.deepEqual(earlier.display, { title: "Earlier 0.5 s", path: [] });
    assert.equal(host.command("plain").display.category, null);
  } finally {
    await stop();
  }
});

test("the category follows the player's text rules; home is a command id", async () => {
  const category = `invalid command: category ${TEXT.replace("%d", String(COMMAND_LIMITS.categoryBytes))}`;
  await refused({ id: "a", title: "A", category: "" }, category);
  await refused({ id: "a", title: "A", category: " Sync" }, category);
  await refused(
    {
      id: "a",
      title: "A",
      category: "x".repeat(COMMAND_LIMITS.categoryBytes + 1),
    },
    category,
  );
  // A text value is counted by its English rendering.
  await refused(
    {
      id: "a",
      title: "A",
      category: { $vestraText: "Track {}", args: ["9".repeat(80)] } as never,
    },
    category,
  );
  await refused(
    { id: "a", title: "A", home: "has space" },
    "invalid command: home permits ASCII letters, digits, '.', '_' and '-'",
  );
  await refused(
    { id: "a", title: "A", home: "" },
    `invalid command: home ${TEXT.replace("%d", String(COMMAND_LIMITS.idBytes))}`,
  );
  // What `add` checks itself throws from `add`.
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({
          id: "a",
          title: "A",
          home: 7 as never,
          run() {},
        });
      },
      { capabilities: [] },
    ),
    { code: "invalid", message: "command a: home is a command id" },
  );
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({
          id: "a",
          title: "A",
          category: ["Sync"] as never,
          run() {},
        });
      },
      { capabilities: [] },
    ),
    {
      code: "invalid",
      message:
        "command a: title, path segments and category are strings or texts",
    },
  );
});

test("the category shows translated, in the command and in bindings.list", async () => {
  const directory = mkdtempSync(join(tmpdir(), "vestra-category-"));
  try {
    writeFileSync(
      join(directory, "manifest.json"),
      JSON.stringify({
        id: "examples.category",
        version: "0.1.0",
        apiVersion: "vestra/1",
        entry: "main.ts",
        capabilities: ["player"],
      }),
    );
    mkdirSync(join(directory, "locales"));
    writeFileSync(
      join(directory, "locales/zh-Hans.po"),
      `msgid ""
msgstr ""
"Language: zh-Hans\\n"

msgid "Subtitle Sync"
msgstr "字幕同步"

msgid "Earlier 0.5 s"
msgstr "提前 0.5 秒"
`,
    );
    let list: Plugin["bindings"]["list"] | undefined;
    const { host, stop } = await startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({
          id: "earlier",
          title: "Earlier 0.5 s",
          category: "Subtitle Sync",
          bindings: ["."],
          run() {},
        });
        plugin.commands.add({
          id: "plain",
          path: ["Tools", "Plain"],
          run() {},
        });
        list = () => plugin.bindings.list();
      },
      { directory, locale: "zh-Hans" },
    );
    try {
      assert.equal(host.command("earlier").display.category, "字幕同步");
      // The key stays the English source text.
      assert.equal(
        host.command("earlier").declaration.category,
        "Subtitle Sync",
      );
      const listed = await list!();
      const entry = (command: string) =>
        listed.commands.find(
          (info) =>
            info.plugin === "examples.category" && info.command === command,
        );
      assert.equal(entry("earlier")?.category, "字幕同步");
      assert.equal(entry("earlier")?.title, "提前 0.5 秒");
      assert.equal(entry("plain")?.category, null);
    } finally {
      await stop();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
