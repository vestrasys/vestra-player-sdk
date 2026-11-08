// The page shapes of the documentation (scripts/doc-structure.mjs SHAPES):
// `docs:check` applies `shapeProblems` to every page; these tests pin what
// each shape accepts and refuses.
import assert from "node:assert/strict";
import test from "node:test";

// A script module (not part of the package); loaded by URL, typed here.
const { SHAPES, shapeProblems } = (await import(
  new URL("../scripts/doc-structure.mjs", import.meta.url).href
)) as {
  SHAPES: Record<string, string>;
  shapeProblems(shape: string, body: string): string[];
};

const page = (...lines: string[]) => ["# Title", "", ...lines, ""].join("\n");

test("every kind of the site has a shape", () => {
  for (const kind of [
    "tutorial",
    "guide",
    "troubleshooting",
    "reference",
    "example",
  ])
    assert.ok(SHAPES[kind], kind);
  for (const gone of ["how-to", "explanation", "guideline", "upgrading"])
    assert.equal(SHAPES[gone], undefined, gone);
});

test("a guide needs a goal, steps and see also; its complete example is optional", () => {
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
  assert.deepEqual(shapeProblems("guide", good), []);
  assert.deepEqual(
    shapeProblems(
      "guide",
      page("**Goal:** do it.", "", "## Steps", "", "## See also"),
    ),
    [],
  );
  const bad = page(
    "Some text.",
    "",
    "## Capabilities",
    "",
    "## Complete example",
    "",
    "No code.",
  );
  const problems = shapeProblems("guide", bad);
  assert.ok(problems.some((p) => p.includes("**Goal:**")));
  assert.ok(problems.some((p) => p.includes("## Steps")));
  assert.ok(problems.some((p) => p.includes("has no code")));
  assert.ok(problems.some((p) => p.includes("## See also")));
});

test("a tutorial's numbered steps are in order; it has no goal line", () => {
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
    page("**Goal:** x", "", "## 1. One", "", "## 3. Three"),
  );
  assert.ok(problems.some((p) => p.includes("out of order")));
  assert.ok(problems.some((p) => p.includes("**Goal:**")));
});

test("numbered lists inside code blocks do not count", () => {
  assert.deepEqual(
    shapeProblems(
      "reference",
      page("## Steps of the player", "", "```text", "## 1. start", "```"),
    ),
    [],
  );
});

test("an example page links the tutorial or the guide that teaches it", () => {
  assert.deepEqual(
    shapeProblems(
      "example",
      page(
        "## What it demonstrates",
        "",
        "A window. [Open a tool window](../guides/windows.md).",
      ),
    ),
    [],
  );
  assert.deepEqual(
    shapeProblems(
      "example",
      page("## What it demonstrates", "", "[Tutorial](../tutorial/index.md)."),
    ),
    [],
  );
  assert.equal(
    shapeProblems("example", page("## What it demonstrates", "", "A window."))
      .length,
    1,
  );
});

test("reference pages are lookup only", () => {
  assert.deepEqual(
    shapeProblems("reference", page("## Fields", "", "| a |", "| - |")),
    [],
  );
  assert.equal(
    shapeProblems("reference", page("## 1. First", "", "**Goal:** x")).length,
    2,
  );
  assert.ok(
    shapeProblems("reference", page("## API on this page")).some((p) =>
      p.includes("API on this page"),
    ),
  );
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
