#!/usr/bin/env node
/**
 * Copies the player's capability table into the SDK:
 *
 *   node scripts/capabilities-sync.mjs <player repository> [--check]
 *   npm run capabilities:sync -- <player repository> [--check]
 *
 * The player generates `src/host/capabilities.json` from its capability
 * modules (`src/host/src/capabilities/`): every manifest capability with its
 * store wording, the capabilities it requires, and the RPC methods it serves
 * with what each needs. This script writes it to src/host-capabilities.ts as
 * `HOST_CAPABILITIES`, which `CAPABILITY_INFO` and the capability checker
 * (`vestra-plugin check`, the TypeScript plugin) are built from, so the SDK
 * and the player read one rule.
 *
 * With `--check` it changes nothing and fails (exit 1) when the copy differs
 * from the player's file: compared by value, so the order of an object's
 * keys does not matter (the order of capabilities and methods does). The player's `tests/sdk/host-agreement.test.ts`
 * makes the same comparison against the installed SDK.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import prettier from "prettier";

const root = resolve(import.meta.dirname, "..");
const target = join(root, "src/host-capabilities.ts");
const args = process.argv.slice(2);
const check = args.includes("--check");
const player = args.find((arg) => arg !== "--check");
if (!player) {
  console.error(
    "usage: capabilities-sync.mjs <player repository> [--check]\n" +
      "       (the directory that holds src/host/capabilities.json)",
  );
  process.exit(2);
}
const source = join(resolve(player), "src/host/capabilities.json");
const table = JSON.parse(readFileSync(source, "utf8"));

/**
 * A value as JSON with every object's keys in order: two tables are the
 * same when they hold the same values, whatever order their keys were
 * written in (the player's generator and Prettier need not agree on it;
 * the `cases` of `events.subscribe` differ so). The order of arrays is
 * kept: it is the player's order of capabilities and methods.
 */
function canonical(value) {
  return JSON.stringify(value, (_key, each) =>
    each && typeof each === "object" && !Array.isArray(each)
      ? Object.fromEntries(
          Object.entries(each).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        )
      : each,
  );
}

if (check) {
  const { HOST_CAPABILITIES } = await import(pathToFileURL(target).href);
  if (canonical(HOST_CAPABILITIES) !== canonical(table)) {
    console.error(
      `src/host-capabilities.ts differs from ${source}; run npm run capabilities:sync -- ${player}`,
    );
    process.exit(1);
  }
  console.log(`src/host-capabilities.ts matches ${source}`);
  process.exit(0);
}

const text = `/**
 * The player's capability table, copied from its \`src/host/capabilities.json\`
 * by \`npm run capabilities:sync -- <player repository>\`. Do not edit: change
 * the player's capability modules, regenerate its JSON and sync again.
 *
 * @internal
 */
import type { HostCapabilities } from "./capability-rules.ts";

// "then" is a field of the player's IfDeclared rule, not a thenable.
/* oxlint-disable unicorn/no-thenable */

/** @internal */
export const HOST_CAPABILITIES: HostCapabilities = ${JSON.stringify(table)};
`;
const options = (await prettier.resolveConfig(target)) ?? {};
writeFileSync(
  target,
  await prettier.format(text, { ...options, filepath: target }),
);
console.log(`wrote src/host-capabilities.ts from ${source}`);
