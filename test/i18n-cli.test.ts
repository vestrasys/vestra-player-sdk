// vestra-plugin i18n extract / check and the catalog step of build, on a
// stand-alone plugin project (resolves @vestra-player/sdk from its
// node_modules; needs dist/).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
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
import { parsePo } from "../src/i18n.ts";

const root = resolve(import.meta.dirname, "..");
const cli = join(root, "bin/vestra-plugin.mjs");

const MAIN = `import type { Plugin } from "@vestra-player/sdk";
import { THEMES } from "./themes.ts";

export default async function activate(plugin: Plugin) {
  const rate = 1.5;
  plugin.commands.add({
    id: "options",
    // TRANSLATORS: the options window.
    path: ["@settings", "Options…"],
    reason: () => (rate > 1 ? "Too fast" : null),
    run: () => plugin.osd.show("Speed {}×", [rate]),
  });
  for (const row of THEMES)
    plugin.commands.add({ id: row.id, path: ["Settings", "Look", row.title], run: () => {} });
  const command = plugin.commands.add({ id: "x", title: "X", run: () => {} });
  command.set({ reason: "Not now" });
  plugin.settings.page("ui/page.slint", { id: "p", category: "general", title: "Page" });
  plugin.panels.mount("sidebar", "ui/page.slint", { title: rate > 1 ? "Fast" : "Slow" });
  const info = plugin.osd.panel();
  info.set("Loop: off");
  void plugin.dialogs.confirm({ message: "Delete?", detail: "For good.", confirm: "Delete", cancel: "Keep", checkbox: "Again" });
  void plugin.dialogs.openFile({ title: "Choose a file" });
  void plugin.osd.show(\`Speed \${rate}\`);
  void plugin.osd.show("Rate " + rate);
  const name = String(Date.now());
  void plugin.osd.show(name);
  void plugin.osd.show("配色");
}
`;

const THEMES = `export const THEMES = [
  { id: "dark", title: "Vestra Dark" },
  { id: "light", title: "Vestra Light" },
] as const;
`;

const SLINT = `export component Page inherits Rectangle {
    in property <int> count;
    VerticalLayout {
        // TRANSLATORS: a heading.
        Text { text: @tr("Appearance"); }
        Text { text: @tr("{n} file" | "{n} files" % root.count); }
        Text { text: @tr("Menu" => "Open"); }
        Text { text: "Plain words"; }
        Text { text: "外观"; }
        Text { text: "0:42"; }
    }
}
`;

function project(main = MAIN) {
  const directory = mkdtempSync(join(tmpdir(), "vestra-plugin-i18n-"));
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
      id: "me.look",
      version: "1.0.0",
      apiVersion: "vestra/1",
      entry: "main.ts",
      capabilities: [
        "commands",
        "ui.osd",
        "ui.settings",
        "ui.mount",
        "ui.dialog",
      ],
      name: "Look",
      punchline: "Change the look",
      tags: ["appearance"],
    }),
  );
  writeFileSync(join(directory, "package.json"), '{"type":"module"}');
  writeFileSync(join(directory, "main.ts"), main);
  writeFileSync(join(directory, "themes.ts"), THEMES);
  mkdirSync(join(directory, "ui"));
  writeFileSync(join(directory, "ui/page.slint"), SLINT);
  return directory;
}

const run = (directory: string, ...args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd: directory,
    encoding: "utf8",
  });

const entries = (file: string) => parsePo(readFileSync(file, "utf8")).entries;

test("extract finds every kind of text and writes messages.pot", () => {
  const directory = project();
  const result = run(
    directory,
    "i18n",
    "extract",
    "--locale",
    "zh-Hans",
    "--locale",
    "de",
  );
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const pot = entries(join(directory, "locales/messages.pot"));
  const ids = pot.map((e) => (e.context ? `${e.context}|${e.id}` : e.id));
  assert.deepEqual(
    ids,
    [
      "Options…",
      "Too fast",
      "Speed {}×",
      "Settings",
      "Look",
      "Vestra Dark",
      "Vestra Light",
      "X",
      "Not now",
      "Page",
      "Fast",
      "Slow",
      "Loop: off",
      "Delete?",
      "For good.",
      "Delete",
      "Keep",
      "Again",
      "Choose a file",
      "配色",
      "Look",
      "Change the look",
      "appearance",
      "Appearance",
      "{n} file",
      "Menu|Open",
    ].filter((id, index, all) => all.indexOf(id) === index),
  );
  const options = pot.find((e) => e.id === "Options…")!;
  assert.deepEqual(options.notes, ["the options window."]);
  assert.deepEqual(options.references, ["main.ts:9"]);
  assert.ok(!ids.includes("@settings"));
  assert.deepEqual(pot.find((e) => e.id === "Look")!.references, [
    "main.ts:14",
    "manifest.json",
  ]);
  const plural = pot.find((e) => e.id === "{n} file")!;
  assert.equal(plural.plural, "{n} files");
  assert.deepEqual(pot.find((e) => e.id === "Appearance")!.notes, [
    "a heading.",
  ]);
  // New languages: their headers and plural forms.
  const zh = readFileSync(join(directory, "locales/zh-Hans.po"), "utf8");
  assert.match(zh, /Language: zh-Hans\\n/);
  assert.match(zh, /Plural-Forms: nplurals=1; plural=0;/);
  const de = readFileSync(join(directory, "locales/de.po"), "utf8");
  assert.match(de, /Plural-Forms: nplurals=2; plural=\(n != 1\);/);
  assert.match(result.stdout, /composed in TypeScript/);
  assert.match(result.stdout, /is not a literal/);
  // English and unknown languages are refused.
  assert.notEqual(
    run(directory, "i18n", "extract", "--locale", "en").status,
    0,
  );
  assert.notEqual(
    run(directory, "i18n", "extract", "--locale", "pt").status,
    0,
  );
});

test("extract keeps translations, marks vanished ones obsolete and revives them", () => {
  const directory = project();
  assert.equal(
    run(directory, "i18n", "extract", "--locale", "zh-Hans").status,
    0,
  );
  const file = join(directory, "locales/zh-Hans.po");
  writeFileSync(
    file,
    readFileSync(file, "utf8")
      .replace('msgid "Page"\nmsgstr ""', 'msgid "Page"\nmsgstr "页面"')
      .replace(
        'msgid "Keep"\nmsgstr ""',
        '#, fuzzy\nmsgid "Keep"\nmsgstr "保留"',
      ),
  );
  // "Page" goes away: it becomes obsolete, with its translation.
  writeFileSync(
    join(directory, "main.ts"),
    MAIN.replace('title: "Page"', 'title: "Pages"'),
  );
  assert.equal(run(directory, "i18n", "extract").status, 0);
  let po = entries(file);
  const page = po.find((e) => e.id === "Page")!;
  assert.equal(page.obsolete, true);
  assert.deepEqual(page.strings, ["页面"]);
  assert.equal(po.at(-1)!.id, "Page");
  const keep = po.find((e) => e.id === "Keep")!;
  assert.equal(keep.fuzzy, true);
  assert.deepEqual(keep.strings, ["保留"]);
  // Back again: revived with its translation.
  writeFileSync(join(directory, "main.ts"), MAIN);
  assert.equal(run(directory, "i18n", "extract").status, 0);
  po = entries(file);
  const revived = po.find((e) => e.id === "Page")!;
  assert.equal(revived.obsolete, false);
  assert.deepEqual(revived.strings, ["页面"]);
  assert.ok(!po.some((e) => e.id === "Pages"));
});

test("check reports coverage and problems as warnings", () => {
  const directory = project();
  let result = run(directory, "i18n", "check");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /messages\.pot is missing/);
  assert.equal(run(directory, "i18n", "extract", "--locale", "de").status, 0);
  const file = join(directory, "locales/de.po");
  writeFileSync(
    file,
    readFileSync(file, "utf8")
      .replace(
        'msgid "Speed {}×"\nmsgstr ""',
        'msgid "Speed {}×"\nmsgstr "Tempo {0}×"',
      )
      .replace(
        'msgid_plural "{n} files"\nmsgstr[0] ""',
        'msgid_plural "{n} files"\nmsgstr[0] "{n} Datei"',
      ),
  );
  writeFileSync(join(directory, "locales/en.po"), 'msgid ""\nmsgstr ""\n');
  writeFileSync(
    join(directory, "main.ts"),
    MAIN.replace('"Not now"', '"Later"'),
  );
  result = run(directory, "i18n", "check");
  assert.equal(result.status, 0, result.stderr);
  const out = result.stdout;
  assert.match(out, /i18n: de: 2\/\d+ translated, 0 fuzzy, 0 obsolete/);
  assert.match(out, /placeholders of "Speed \{\}×" differ/);
  assert.match(out, /"\{n\} file" has no msgstr\[1\]/);
  assert.match(out, /messages\.pot is out of date/);
  assert.match(out, /en\.po: English is the source language/);
  assert.match(out, /main\.ts:\d+: user-visible text composed in TypeScript/);
  assert.match(out, /main\.ts:\d+: the text of Osd\.show is not a literal/);
  assert.match(out, /main\.ts:\d+: not English/);
  assert.match(out, /ui\/page\.slint:8: Slint text without @tr: "Plain words"/);
  assert.match(out, /ui\/page\.slint:9: not English/);
  assert.doesNotMatch(out, /0:42/);
  // `check` shows the same warnings and still passes.
  result = run(directory, "check");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /i18n: de: /);
  // A broken .po fails i18n check.
  writeFileSync(file, 'msgid "a"\nmsgstr "\\q"\n');
  result = run(directory, "i18n", "check");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /de\.po: line 2/);
});

test("build compiles the .po files and packs no translation sources", () => {
  const directory = project();
  assert.equal(
    run(directory, "i18n", "extract", "--locale", "zh-Hans").status,
    0,
  );
  const file = join(directory, "locales/zh-Hans.po");
  writeFileSync(
    file,
    readFileSync(file, "utf8")
      .replace('msgid "Page"\nmsgstr ""', 'msgid "Page"\nmsgstr "页面"')
      .replace(
        'msgid_plural "{n} files"\nmsgstr[0] ""',
        'msgid_plural "{n} files"\nmsgstr[0] "{n} 个文件"',
      ),
  );
  writeFileSync(join(directory, "locales/pt.po"), 'msgid ""\nmsgstr ""\n');
  const result = run(directory, "build");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /locales\/pt\.po: not compiled/);
  const dist = join(directory, "dist/locales");
  assert.deepEqual(readdirSync(dist), ["zh-Hans.json"]);
  assert.deepEqual(
    JSON.parse(readFileSync(join(dist, "zh-Hans.json"), "utf8")),
    {
      language: "zh-Hans",
      messages: { Page: "页面", "{n} file": ["{n} 个文件", "{n} 个文件"] },
    },
  );
  assert.ok(!existsSync(join(directory, "dist/locales/zh-Hans.po")));
  assert.ok(!existsSync(join(directory, "dist/locales/messages.pot")));
  // A broken .po fails the build.
  writeFileSync(file, 'msgid "a"\nmsgstr\n');
  assert.equal(run(directory, "build").status, 1);
});

test("an i18n-ignore comment leaves a text out and quiets check", () => {
  const directory = project(`import type { Plugin } from "@vestra-player/sdk";

// i18n-ignore: each language in its own words
const LANGUAGES = [
  { id: "en", title: "English" },
  { id: "zh-Hans", title: "简体中文" },
] as const;

export default async function activate(plugin: Plugin) {
  for (const row of LANGUAGES)
    plugin.commands.add({
      id: row.id,
      // Each language in its own words.
      path: ["Settings", "Language", /* i18n-ignore */ row.title],
      run: () => {},
    });
}
`);
  writeFileSync(
    join(directory, "ui/page.slint"),
    `export component Page inherits Rectangle {
    // i18n-ignore: the language's own name
    Text { text: "日本語"; }
    Text { text: "Deutsch"; } // i18n-ignore
    Text { text: @tr("Language"); }
}
`,
  );
  const result = run(directory, "i18n", "extract");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  const ids = entries(join(directory, "locales/messages.pot")).map((e) => e.id);
  assert.ok(ids.includes("Settings") && ids.includes("Language"));
  assert.ok(!ids.includes("English") && !ids.includes("简体中文"), ids.join());
  const check = run(directory, "i18n", "check");
  assert.equal(check.status, 0, check.stderr);
  assert.doesNotMatch(check.stdout, /not English|without @tr/);
});
