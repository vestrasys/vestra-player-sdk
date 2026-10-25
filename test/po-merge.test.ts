// SDK 1.5.13: merging keeps the translator's comments and writes exactly
// nplurals msgstr[n] lines.
import assert from "node:assert/strict";
import test from "node:test";
import { merge } from "../src/i18n-tools.ts";
import { parsePo } from "../src/i18n.ts";

const messages = [
  { id: "Open", notes: [], references: ["main.ts:3"] },
  {
    id: "{n} file",
    plural: "{n} files",
    notes: [],
    references: ["ui/a.slint:4"],
  },
];

test("comments before the header and the translator's own comments survive a merge", () => {
  const existing = `# Reviewed by an AI reviewer on 2026-10-25
# Translator: Ann <ann@example.com>
#
#, fuzzy
msgid ""
msgstr ""
"Language: de\\n"
"Plural-Forms: nplurals=2; plural=(n != 1);\\n"

# Ann: shorter than the English on purpose
#: main.ts:1
msgid "Open"
msgstr "Öffnen"
`;
  const { text } = merge(existing, "de", messages);
  assert.ok(
    text.startsWith(
      '# Reviewed by an AI reviewer on 2026-10-25\n# Translator: Ann <ann@example.com>\n#\n#, fuzzy\nmsgid ""\n',
    ),
    text,
  );
  assert.match(
    text,
    /# Ann: shorter than the English on purpose\n#: main\.ts:3\nmsgid "Open"\nmsgstr "Öffnen"/,
  );
  // Merging again changes nothing.
  assert.equal(merge(text, "de", messages).text, text);
  const parsed = parsePo(text);
  assert.deepEqual(parsed.headerComments.slice(0, 2), [
    "# Reviewed by an AI reviewer on 2026-10-25",
    "# Translator: Ann <ann@example.com>",
  ]);
});

test("a one-form language gets one msgstr per plural entry; extra empty ones go", () => {
  const created = merge(null, "ja", messages).text;
  assert.match(created, /msgid_plural "\{n\} files"\nmsgstr\[0\] ""\n?$/);
  assert.doesNotMatch(created, /msgstr\[1\]/);
  const old = `msgid ""
msgstr ""
"Language: zh-Hans\\n"
"Plural-Forms: nplurals=1; plural=0;\\n"

msgid "{n} file"
msgid_plural "{n} files"
msgstr[0] "{n} 个文件"
msgstr[1] ""
`;
  const merged = merge(old, "zh-Hans", messages).text;
  assert.match(merged, /msgstr\[0\] "\{n\} 个文件"\n?$/);
  assert.doesNotMatch(merged, /msgstr\[1\]/);
  // Two-form languages keep both.
  assert.match(
    merge(null, "de", messages).text,
    /msgstr\[0\] ""\nmsgstr\[1\] ""/,
  );
});
