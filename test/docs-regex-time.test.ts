// The documentation tree's text matching stays linear on long adversarial
// input (CodeQL js/polynomial-redos), with the same results as before.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { gunzipSync } from "node:zlib";
import { docs } from "../src/docs.ts";

const source = readFileSync(new URL("../src/docs.ts", import.meta.url), "utf8");
/** `TABLE_RULE` as src/docs.ts declares it (not exported). */
const TABLE_RULE = new RegExp(
  /^const TABLE_RULE =\s*\/(.+)\/;/m.exec(source)![1]!,
);
/** The expression it replaced, quadratic on runs of spaces. */
const OLD_TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/** Milliseconds `run` takes. */
const time = (run: () => void) => {
  const start = performance.now();
  run();
  return performance.now() - start;
};

test("a table's rule line: the same matches as before", () => {
  const stored = JSON.parse(
    gunzipSync(
      readFileSync(new URL("../dist/docs-tree.json.gz", import.meta.url)),
    ).toString("utf8"),
  ) as { nodes: { t: string }[] };
  const lines = new Set(stored.nodes.flatMap((node) => node.t.split("\n")));
  for (const line of [
    "---",
    "--",
    "|---|",
    "| --- | :---: | ---: |",
    "  |  :--- |---  ",
    "--- | ---",
    "--- |",
    "| ---",
    "|",
    "||",
    "| --- || --- |",
    "| -- | --- |",
    "| --- | x |",
    ":---:",
    "::---",
    "",
    "   ",
  ])
    lines.add(line);
  let matched = 0;
  for (const line of lines) {
    assert.equal(TABLE_RULE.test(line), OLD_TABLE_RULE.test(line), line);
    if (TABLE_RULE.test(line)) matched++;
  }
  assert.ok(matched > 10, `${matched} rule lines`);
});

test("a table's rule line: long runs of spaces are fast", () => {
  const spaces = " ".repeat(100_000);
  for (const line of [
    `---${spaces}x`,
    `${spaces}x`,
    `|${spaces}x`,
    `--- |${spaces}x`,
    `| --- |${spaces}| --- |${spaces}x`,
    `${"| --- ".repeat(20_000)}x`,
  ]) {
    const ms = time(() => assert.equal(TABLE_RULE.test(line), false));
    assert.ok(ms < 200, `${ms.toFixed(0)} ms for ${line.slice(0, 12)}…`);
  }
  assert.equal(TABLE_RULE.test(`|${spaces}---${spaces}|${spaces}`), true);
});

test("docs(path): quotes and <> around the path go, in linear time", () => {
  const api = docs("/API");
  for (const path of [`"/API"`, `'/API'`, `</API>`, `"'</API>'"`, ` "/API" `])
    assert.equal(docs(path), api, path);
  // A long run of closing quotes not at the end (in the anchor, so that the
  // path is found): about 40 s with the former `["'>]+$`.
  for (const run of [`"`, `'`, `>`]) {
    const path = `/API#${run.repeat(200_000)}x`;
    const ms = time(() => docs(path));
    assert.ok(ms < 1000, `${ms.toFixed(0)} ms for ${run}`);
  }
});
