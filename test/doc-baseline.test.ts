// The documentation baseline only shrinks: EXAMPLE_BASELINE
// (scripts/doc-standard.mjs) lists the known violations of `example-lead`
// and `stale-refs` that `doc-lint` reports as warnings. A change may remove
// entries (and then lowers MAX here), never add them: a new violation is
// fixed instead.
import assert from "node:assert/strict";
import test from "node:test";

// A script module (not part of the package); loaded by URL, typed here.
const { EXAMPLE_BASELINE, splitCut, STALE_REFERENCES } = (await import(
  new URL("../scripts/doc-standard.mjs", import.meta.url).href
)) as {
  EXAMPLE_BASELINE: ReadonlySet<string>;
  splitCut(body: string): { hidden: string[]; visible: string[]; cuts: number };
  STALE_REFERENCES: readonly { pattern: RegExp; why: string }[];
};

/** The size of EXAMPLE_BASELINE when it was last shrunk. Only lower it. */
const MAX = 0;

test("EXAMPLE_BASELINE does not grow", () => {
  assert.ok(
    EXAMPLE_BASELINE.size <= MAX,
    `EXAMPLE_BASELINE has ${EXAMPLE_BASELINE.size} entries, more than ${MAX}: fix the new problems instead of listing them`,
  );
});

test("EXAMPLE_BASELINE keys name one problem each", () => {
  for (const key of EXAMPLE_BASELINE)
    assert.match(
      key,
      /^(example-lead \S+#\d+ [a-z-]+|stale-refs \S+#\d+)$/,
      key,
    );
});

test("splitCut counts the cut lines", () => {
  assert.deepEqual(splitCut("a\n// ---cut---\nb"), {
    hidden: ["a"],
    visible: ["b"],
    cuts: 1,
  });
  assert.equal(splitCut("a\n// ---cut---\nb\n// ---cut---\nc").cuts, 2);
  assert.deepEqual(splitCut("a"), { hidden: [], visible: ["a"], cuts: 0 });
});

test("STALE_REFERENCES catch the removed NES ids", () => {
  const stale = (code: string) =>
    STALE_REFERENCES.some(({ pattern }) => pattern.test(code));
  assert.ok(stale(`plugin.resolvers.add({ id: "nes", extensions: ["x"] })`));
  assert.ok(stale(`extensions: ["nes", "fds"]`));
  assert.ok(stale(`extensions: ["fds", ".nes"]`));
  assert.ok(stale(`"vestra.nes"`));
  assert.ok(!stale(`extensions: ["ch8"]`));
  assert.ok(!stale(`id: "nesting"`));
});
