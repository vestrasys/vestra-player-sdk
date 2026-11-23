// The files a manifest names (icon, readme, changelog): read once through one
// handle, with the same problems as before for each kind of path.
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MANIFEST_LIMITS, manifestProblems } from "../src/manifest.ts";

test("manifest files: missing, a directory, outside, too large, fine", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vestra-manifest-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, "plugin");
  mkdirSync(join(directory, "docs"), { recursive: true });
  writeFileSync(join(root, "OUTSIDE.md"), "# Outside\n");
  writeFileSync(join(directory, "README.md"), "# Hello\n");
  writeFileSync(
    join(directory, "BIG.md"),
    "x".repeat(MANIFEST_LIMITS.documentBytes + 1),
  );
  mkdirSync(join(directory, "folder.md"));
  const problems = (readme: string) =>
    manifestProblems({ readme }, directory).problems.filter((text) =>
      text.startsWith("readme"),
    );
  assert.deepEqual(problems("README.md"), []);
  assert.deepEqual(problems("NONE.md"), ["readme file NONE.md is missing"]);
  assert.deepEqual(problems("folder.md"), [
    "readme must name a file inside the package",
  ]);
  assert.deepEqual(problems("BIG.md"), [
    `readme file exceeds ${MANIFEST_LIMITS.documentBytes / 1024} KB`,
  ]);
  try {
    symlinkSync(join(root, "OUTSIDE.md"), join(directory, "LINK.md"));
  } catch {
    return t.skip("no symbolic links here");
  }
  assert.deepEqual(problems("LINK.md"), [
    "readme must name a file inside the package",
  ]);
});
