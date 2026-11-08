// API surface snapshot (characterisation test, doc/specs/sdk-refactor.md
// §4.0 in the player repository): every exported declaration of the two
// public entries (`.` and `./testing`, the declaration files package.json
// `exports` names), with its members and signatures, must equal
// `test/fixtures/api-surface.txt`.
// A file split that changes nothing public leaves the snapshot identical;
// an additive release rewrites it on purpose:
// `node scripts/api-surface.mjs --update`. Needs `npm run build` (dist/).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

test(
  "the public API surface equals test/fixtures/api-surface.txt",
  {
    skip: !existsSync(join(root, "dist", "index.d.ts")) && "dist/ is not built",
  },
  () => {
    const result = spawnSync(
      process.execPath,
      [join(root, "scripts", "api-surface.mjs"), "--check"],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  },
);
