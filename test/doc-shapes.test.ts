// The page shapes of the documentation (Diátaxis, scripts/doc-structure.mjs
// SHAPES): `docs:check` applies `shapeProblems` to every page; these tests
// pin what each shape accepts and refuses.
import assert from "node:assert/strict";
import test from "node:test";

// A script module (not part of the package); loaded by URL, typed here.
const { SHAPES, shapeProblems } = (await import(
  new URL("../scripts/doc-structure.mjs", import.meta.url).href
)) as {
  SHAPES: Record<string, string>;
  shapeProblems(shape: string, body: string, raw?: string): string[];
};

const page = (...lines: string[]) => ["# Title", "", ...lines, ""].join("\n");

test("every kind of the site has a shape", () => {
  for (const kind of [
    "tutorial",
    "how-to",
    "troubleshooting",
    "reference",
    "explanation",
    "guideline",
    "example",
    "upgrading",
  ])
    assert.ok(SHAPES[kind], kind);
});

test("a how-to guide needs a goal, steps, a complete example and see also", () => {
  const good = page(
    "**Goal:** do the thing.",
    "",
    "## Steps",
    "",
    "### Do it",
    "",
    "## Complete example",
    "",
    "```ts",
    "plugin.update();",
    "```",
    "",
    "## See also",
  );
  assert.deepEqual(shapeProblems("how-to", good), []);
  const bad = page(
    "Some text.",
    "",
    "## Capabilities",
    "",
    "## Complete example",
    "",
    "No code.",
  );
  const problems = shapeProblems("how-to", bad);
  assert.ok(problems.some((p) => p.includes("**Goal:**")));
  assert.ok(problems.some((p) => p.includes("## Steps")));
  assert.ok(problems.some((p) => p.includes("has no code")));
  assert.ok(problems.some((p) => p.includes("## See also")));
});

test("a tutorial has numbered steps in order between its first and last sections", () => {
  assert.deepEqual(
    shapeProblems(
      "tutorial",
      page(
        "## Before you start",
        "",
        "## 1. One",
        "",
        "## 2. Two",
        "",
        "## Next",
      ),
    ),
    [],
  );
  const problems = shapeProblems(
    "tutorial",
    page("## 1. One", "", "## 3. Three", "", "## Done"),
  );
  assert.ok(problems.some((p) => p.includes("Before you start")));
  assert.ok(problems.some((p) => p.includes("out of order")));
  assert.ok(problems.some((p) => p.includes("## Next")));
});

test("an explanation page has no steps, pitfalls or numbered lists", () => {
  assert.deepEqual(
    shapeProblems("explanation", page("## How it works", "", "- a", "- b")),
    [],
  );
  const problems = shapeProblems(
    "explanation",
    page("## Common pitfalls", "", "1. Do this.", "", "## API on this page"),
  );
  assert.ok(problems.some((p) => p.includes("Common pitfalls")));
  assert.ok(problems.some((p) => p.includes("numbered list")));
  assert.ok(problems.some((p) => p.includes("API on this page")));
});

test("numbered lists inside code blocks do not count", () => {
  assert.deepEqual(
    shapeProblems(
      "explanation",
      page("## Steps of the player", "", "```text", "1. start", "```"),
    ),
    [],
  );
});

test("a guideline has no values: tables, colours and pixels belong in the Reference", () => {
  assert.deepEqual(
    shapeProblems(
      "guideline",
      page(
        "## Theme",
        "",
        "- Use `Theme.text`.",
        "",
        "```slint",
        "height: 40px;",
        "```",
      ),
    ),
    [],
  );
  const problems = shapeProblems(
    "guideline",
    page(
      "## Theme",
      "",
      "- White `#ffffff`, 2px wide.",
      "",
      "| a | b |",
      "| --- | --- |",
    ),
  );
  assert.equal(problems.length, 3);
});

test("a guideline catches sizes written as plain numbers, not small counts", () => {
  assert.deepEqual(
    shapeProblems(
      "guideline",
      page(
        "- At most 8 pages; `…` is U+2026; player 0.4.3 on 2026-10-25.",
        "- An HTTP 404 is a failure; at most 1,000,000 entries.",
        "- See [the list](https://example.com/issues/1234) and {@link Settings.page | the page}.",
      ),
    ),
    [],
  );
  const problems = shapeProblems(
    "guideline",
    page("- **Sidebar:** at least 317 wide.", "- Cells of 41×40."),
  );
  assert.ok(problems.some((p) => p.includes("317")));
  assert.ok(problems.some((p) => p.includes("41×40")));
});

test("an example page links the guide that teaches it", () => {
  assert.deepEqual(
    shapeProblems(
      "example",
      page(
        "## What it demonstrates",
        "",
        "A window. [Add a window](../tutorials/add-a-window.md).",
      ),
    ),
    [],
  );
  assert.equal(
    shapeProblems("example", page("## What it demonstrates", "", "A window."))
      .length,
    1,
  );
});

test("reference and upgrading pages", () => {
  assert.deepEqual(
    shapeProblems("reference", page("## Fields", "", "| a |", "| - |")),
    [],
  );
  assert.equal(
    shapeProblems("reference", page("## 1. First", "", "**Goal:** x")).length,
    2,
  );
  assert.deepEqual(
    shapeProblems("upgrading", page("## Who must change", "", "## 1. Menus")),
    [],
  );
  assert.equal(shapeProblems("upgrading", page("## What changed")).length, 1);
});

test("Mermaid labels are plain text: no links, addresses or backticks", async () => {
  const { mermaidProblems } = (await import(
    new URL("../scripts/doc-structure.mjs", import.meta.url).href
  )) as { mermaidProblems(text: string): string[] };
  const block = (...lines: string[]) =>
    [
      "Text with [a link](x.md).",
      "```mermaid",
      "flowchart TB",
      ...lines,
      "```",
    ].join("\n");
  assert.deepEqual(
    mermaidProblems(block('    A["player.open(a web address)"] --> B')),
    [],
  );
  assert.equal(mermaidProblems(block('    A["see [docs](x.md)"]')).length, 1);
  assert.equal(
    mermaidProblems(block('    A["open https://example.com"]')).length,
    1,
  );
  assert.equal(mermaidProblems(block('    A["`code`"]')).length, 1);
});
