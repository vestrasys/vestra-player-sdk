#!/usr/bin/env node
/**
 * Checks the contents of a packed tarball (`npm pack`):
 *
 *   node scripts/check-pack.mjs vestra-player-sdk-x.y.z.tgz
 *
 * - every file matches the allow list below (compiled dist/, the CLI, the
 *   Slint widget copy, the documentation tree dist/docs-tree.json.gz and
 *   the top-level documents; no sources, tests, source
 *   maps, build info or stray files),
 * - every `exports` target and every `bin` entry of package.json is present,
 * - the tarball's package.json has the same name and version as the
 *   repository's, and its llms.txt names that version.
 *
 * CI runs it on the tarball it uploads (and, on a release, publishes).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const tarball = process.argv[2];
if (!tarball) {
  console.error("usage: check-pack.mjs <package.tgz>");
  process.exit(2);
}

const ALLOWED = [
  /^package\.json$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^LICENSE$/,
  /^llms\.txt$/,
  /^dist\/docs-tree\.json\.gz$/,
  /^bin\/[\w-]+\.mjs$/,
  /^slint\/[\w/-]+\.slint$/,
  /^ts-plugin\/(index\.js|index\.d\.ts|package\.json)$/,
  /^dist\/[\w/-]+\.(js|d\.ts)$/,
];

const listing = spawnSync("tar", ["-tzf", resolve(tarball)], {
  encoding: "utf8",
});
if (listing.status !== 0) {
  console.error(listing.stderr);
  process.exit(1);
}
const files = listing.stdout
  .split("\n")
  .filter((line) => line && !line.endsWith("/"))
  .map((line) => line.replace(/^package\//, ""));

const problems = [];
for (const file of files)
  if (!ALLOWED.some((pattern) => pattern.test(file)))
    problems.push(`not allowed in the package: ${file}`);

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const targets = new Set();
const collect = (value) => {
  if (typeof value === "string") targets.add(value.replace(/^\.\//, ""));
  else if (value && typeof value === "object")
    Object.values(value).forEach(collect);
};
collect(manifest.exports);
collect(manifest.bin);
for (const target of targets)
  if (!files.includes(target))
    problems.push(`missing from the package: ${target}`);

const packed = spawnSync(
  "tar",
  ["-xzOf", resolve(tarball), "package/package.json"],
  { encoding: "utf8" },
);
const inner = JSON.parse(packed.stdout || "{}");
if (inner.name !== manifest.name || inner.version !== manifest.version)
  problems.push(
    `tarball is ${inner.name}@${inner.version}, package.json is ${manifest.name}@${manifest.version}`,
  );

for (const name of ["llms.txt"]) {
  const text = spawnSync(
    "tar",
    ["-xzOf", resolve(tarball), `package/${name}`],
    {
      encoding: "utf8",
    },
  ).stdout;
  if (!text?.includes(`${manifest.name} ${manifest.version}`))
    problems.push(
      `${name} is not for ${manifest.name} ${manifest.version} (run npm run docs:llms)`,
    );
}

if (problems.length) {
  for (const problem of problems) console.error(`::error::${problem}`);
  process.exit(1);
}
console.log(
  `${tarball}: ${files.length} files, all allowed; ${targets.size} exports/bin targets present.`,
);
