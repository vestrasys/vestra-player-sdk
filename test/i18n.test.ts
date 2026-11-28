import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  Catalog,
  compileCatalog,
  format,
  LOCALES,
  matchLocale,
  parsePo,
  placeholders,
  rewriteSlint,
  scanSlint,
  writePo,
} from "../src/i18n.ts";
import { pluralForms } from "../src/i18n-tools.ts";

type Case = {
  name: string;
  source: string;
  catalog: Record<string, string | [string, string]>;
  messages: { id: string; context?: string; plural?: string }[];
  output: string;
};

// A copy of the player's src/host/tests/fixtures/slint-tr.json; the player's
// host-agreement test runs the player's own copy against this scanner.
test("Slint @tr cases shared with the player", () => {
  const fixture = JSON.parse(
    readFileSync(new URL("fixtures/slint-tr.json", import.meta.url), "utf8"),
  ) as { cases: Case[] };
  for (const item of fixture.cases) {
    const found = scanSlint(item.source).map(({ id, context, plural }) => ({
      id,
      ...(context === undefined ? {} : { context }),
      ...(plural === undefined ? {} : { plural }),
    }));
    assert.deepEqual(found, item.messages, `${item.name}: messages`);
    assert.equal(
      rewriteSlint(item.source, new Catalog(item.catalog)),
      item.output,
      `${item.name}: output`,
    );
  }
});

test("po files parse, compile and write back", () => {
  const text = `# comment
msgid ""
msgstr ""
"Language: zh-Hans\\n"

#. Note for translators
#: main.ts:3
msgid "Hello"
msgstr "你好"

msgctxt "Menu"
msgid "Open"
msgstr "打开"

msgid "{n} file"
msgid_plural "{n} files"
msgstr[0] "{n} 个文件"

#, fuzzy
msgid "Unsure"
msgstr "不确定"

msgid ""
"Two\\n"
"lines"
msgstr ""

#~ msgid "Gone"
#~ msgstr "没了"
`;
  const { header, entries } = parsePo(text);
  assert.equal(header, "Language: zh-Hans\n");
  assert.deepEqual(
    entries.map((e) => [e.context, e.id, e.obsolete]),
    [
      [undefined, "Hello", false],
      ["Menu", "Open", false],
      [undefined, "{n} file", false],
      [undefined, "Unsure", false],
      [undefined, "Two\nlines", false],
      [undefined, "Gone", true],
    ],
  );
  assert.deepEqual(entries[0]!.notes, ["Note for translators"]);
  assert.deepEqual(entries[0]!.references, ["main.ts:3"]);
  assert.equal(entries[3]!.fuzzy, true);
  assert.deepEqual(compileCatalog("zh-Hans", entries), {
    language: "zh-Hans",
    messages: {
      Hello: "你好",
      "Menu\u0004Open": "打开",
      "{n} file": ["{n} 个文件", "{n} 个文件"],
    },
  });
  // Writing and parsing again gives the same entries.
  assert.deepEqual(parsePo(writePo(header, entries)).entries, entries);
  assert.throws(() => parsePo('msgid "a"\nmsgstr "\\q"\n'), /line 2/);
});

test("templates format like Slint and the player", () => {
  assert.equal(format("Speed {}×", [1.5]), "Speed 1.5×");
  assert.equal(format("{1} / {0}", ["a", "b"]), "b / a");
  assert.equal(format("Hi {name}", { name: "Ann" }), "Hi Ann");
  assert.equal(format("{{x}} {}", [5]), "{x} 5");
  assert.equal(format("missing {} {3}", []), "missing {} {3}");
  const zh = new Catalog({ "Speed {}×": "倍速 {}×" });
  assert.equal(zh.template("Speed {}×", [2]), "倍速 2×");
  assert.equal(zh.template("Set {a}"), "Set {a}");
  assert.deepEqual(placeholders("{} of {name} {{x}} {0}"), ["", "0", "name"]);
});

test("plural forms per language", () => {
  for (const one of ["zh-Hans", "zh-Hant", "ja", "ko"])
    assert.equal(pluralForms(one), "nplurals=1; plural=0;", one);
  for (const two of ["de", "fr", "es", "pt-BR", "ru"])
    assert.equal(pluralForms(two), "nplurals=2; plural=(n != 1);", two);
});

test("system languages map like the player", () => {
  assert.deepEqual(LOCALES, [
    "en",
    "zh-Hans",
    "zh-Hant",
    "ja",
    "ko",
    "de",
    "fr",
    "es",
    "pt-BR",
    "ru",
  ]);
  for (const [tag, locale] of [
    ["zh-Hans-CN", "zh-Hans"],
    ["zh-CN", "zh-Hans"],
    ["zh-TW", "zh-Hant"],
    ["zh_HK.UTF-8", "zh-Hant"],
    ["zh-MO", "zh-Hant"],
    ["zh-Hant", "zh-Hant"],
    ["zh-Hant-HK", "zh-Hant"],
    ["zh-Hans-HK", "zh-Hans"],
    ["zh-Latn", "en"],
    ["zh", "zh-Hans"],
    ["de-AT", "de"],
    ["en_US.UTF-8", "en"],
    ["pt-BR", "pt-BR"],
    ["pt-PT", "pt-BR"],
    ["pt", "pt-BR"],
    ["ru-RU", "ru"],
    ["ru_UA.UTF-8", "ru"],
    ["it-IT", undefined],
  ] as const)
    assert.equal(matchLocale(tag), locale, tag);
});
