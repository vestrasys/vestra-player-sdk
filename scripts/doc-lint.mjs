#!/usr/bin/env node
/**
 * Documentation coverage report for the public API, read from TypeDoc's
 * model of the documented entry points (the same one `npm run docs` builds):
 *
 *   node scripts/doc-lint.mjs [--strict] [--list <rule>]
 *
 * Rules, per exported declaration and per member:
 *
 * - summary   every declaration and member has a summary
 * - remarks   module entry types (interfaces reached as a `Plugin` / `Scope`
 *             property) have `@remarks`
 * - example   methods and module entry types have `@example`
 * - throws    methods that return a Promise have `@throws`
 * - category  top-level declarations have `@category`
 * - since     methods have `@since`
 * - capability  methods of module entry types have `@capability`
 *
 * It also compares the error codes of the `PluginError` table with the codes
 * the SDK itself throws (`failure("…")`).
 *
 * The rules above are a report (exit 0). The categories listed in
 * scripts/doc-standard.mjs are enforced: a symbol of such a category that
 * misses part of the standard fails the run, and so does a declaration
 * tagged with such a `@category` that the list does not name. `--strict`
 * also fails when any summary is missing. `--list <rule>` prints every
 * symbol that misses that rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Application, ReflectionKind } from "typedoc";
import { STRICT_CATEGORIES, strictDeclarations } from "./doc-standard.mjs";

const root = resolve(import.meta.dirname, "..");
const strict = process.argv.includes("--strict");
const listIndex = process.argv.indexOf("--list");
const listRule = listIndex > 0 ? process.argv[listIndex + 1] : null;

const app = await Application.bootstrapWithPlugins({
  options: join(root, "typedoc.json"),
  plugin: [],
  projectDocuments: [],
  logLevel: "Warn",
});
const project = await app.convert();
if (!project) {
  console.error("::error::TypeDoc could not convert the project");
  process.exit(1);
}

const RULES = [
  "summary",
  "remarks",
  "example",
  "throws",
  "category",
  "since",
  "capability",
];
const stats = Object.fromEntries(
  RULES.map((rule) => [rule, { applies: 0, missing: [] }]),
);
const check = (rule, name, ok) => {
  stats[rule].applies++;
  if (!ok) stats[rule].missing.push(name);
};

const commentOf = (reflection) =>
  reflection.comment ??
  reflection.signatures?.[0]?.comment ??
  reflection.getSignature?.comment ??
  reflection.type?.declaration?.signatures?.[0]?.comment;
const hasSummary = (comment) =>
  !!comment && comment.summary.some((part) => part.text.trim() !== "");
const hasTag = (comment, tag) =>
  !!comment && comment.blockTags.some((block) => block.tag === tag);
const returnsPromise = (reflection) => {
  const signature =
    reflection.signatures?.[0] ?? reflection.type?.declaration?.signatures?.[0];
  const type = signature?.type;
  return type?.type === "reference" && type.name === "Promise";
};
const isMethod = (reflection) =>
  reflection.kindOf(ReflectionKind.Method) ||
  (reflection.kindOf(ReflectionKind.Property) &&
    !!reflection.type?.declaration?.signatures?.length);

/** Interfaces that are a property of Plugin or Scope: the API's modules. */
const entryTypes = new Set();
for (const name of ["Plugin", "Scope"]) {
  const owner = project.getChildByName(["@vestra-player/sdk", name]);
  for (const property of owner?.children ?? [])
    if (property.type?.type === "reference" && property.type.reflection)
      entryTypes.add(property.type.reflection);
}

const modules = project.children?.filter((child) =>
  child.kindOf(ReflectionKind.Module),
);
let declarations = 0;
let members = 0;
for (const module of modules ?? []) {
  for (const declaration of module.children ?? []) {
    declarations++;
    const name = `${module.name}!${declaration.name}`;
    const comment = commentOf(declaration);
    check("summary", name, hasSummary(comment));
    check("category", name, hasTag(comment, "@category"));
    const entry = entryTypes.has(declaration);
    if (entry) {
      check("remarks", name, hasTag(comment, "@remarks"));
      check("example", name, hasTag(comment, "@example"));
    }
    for (const member of declaration.children ?? []) {
      if (member.inheritedFrom) continue; // documented where it is declared
      members++;
      const memberName = `${name}.${member.name}`;
      const memberComment = commentOf(member);
      check("summary", memberName, hasSummary(memberComment));
      if (!isMethod(member)) continue;
      check("example", memberName, hasTag(memberComment, "@example"));
      check("since", memberName, hasTag(memberComment, "@since"));
      if (returnsPromise(member))
        check("throws", memberName, hasTag(memberComment, "@throws"));
      if (entry)
        check("capability", memberName, hasTag(memberComment, "@capability"));
    }
  }
}

// Strict categories (scripts/doc-standard.mjs): the full standard, enforced.
const isPromise = (type) =>
  type?.type === "reference" && type.name === "Promise";
const categoryOf = (comment) =>
  comment?.blockTags
    .find((block) => block.tag === "@category")
    ?.content.map((part) => part.text)
    .join("")
    .trim();
/** Own members, including those of an intersection's object part (`SettingsPage`). */
const ownMembers = (declaration) => [
  ...(declaration.children ?? []),
  ...(declaration.type?.type === "intersection"
    ? declaration.type.types.flatMap((part) =>
        part.type === "reflection" ? (part.declaration.children ?? []) : [],
      )
    : []),
];
const strictReport = new Map(
  Object.keys(STRICT_CATEGORIES).map((category) => [
    category,
    { symbols: 0, checks: 0, problems: [] },
  ]),
);
const sdk = modules?.find((module) => module.name === "@vestra-player/sdk");
for (const declaration of sdk?.children ?? []) {
  const tagged = categoryOf(commentOf(declaration));
  if (strictReport.has(tagged) && !strictDeclarations.has(declaration.name))
    strictReport
      .get(tagged)
      .problems.push(
        `${declaration.name}: tagged @category ${tagged} but not listed in scripts/doc-standard.mjs`,
      );
}
for (const [name, { category, kind }] of strictDeclarations) {
  const report = strictReport.get(category);
  const need = (what, ok, label) => {
    report.checks++;
    if (!ok) report.problems.push(`${what}: ${label}`);
  };
  const declaration = sdk?.getChildByName(name);
  if (!declaration) {
    report.problems.push(
      `${name}: listed in scripts/doc-standard.mjs but not exported`,
    );
    continue;
  }
  report.symbols++;
  const comment = commentOf(declaration);
  need(name, hasSummary(comment), "no summary");
  need(name, categoryOf(comment) === category, `no @category ${category}`);
  need(name, hasTag(comment, "@since"), "no @since");
  if (kind === "full") {
    need(name, hasTag(comment, "@remarks"), "no @remarks");
    need(name, hasTag(comment, "@example"), "no @example");
    need(name, hasTag(comment, "@capability"), "no @capability");
  }
  for (const member of ownMembers(declaration)) {
    if (member.inheritedFrom) continue;
    const memberName = `${name}.${member.name}`;
    const memberComment = commentOf(member);
    need(memberName, hasSummary(memberComment), "no summary");
    if (kind !== "full") continue;
    if (isMethod(member)) {
      need(memberName, hasTag(memberComment, "@example"), "no @example");
      need(memberName, hasTag(memberComment, "@capability"), "no @capability");
      need(memberName, hasTag(memberComment, "@since"), "no @since");
      if (returnsPromise(member))
        need(memberName, hasTag(memberComment, "@throws"), "no @throws");
    } else if (isPromise(member.type))
      need(memberName, hasTag(memberComment, "@throws"), "no @throws");
  }
}

// Error codes: the PluginError table against the codes the SDK throws.
const types = readFileSync(join(root, "src/plugin/types.ts"), "utf8");
const table = types.slice(
  types.indexOf("Every API failure is an ordinary `Error`"),
  types.indexOf("export type PluginError"),
);
const documented = new Set(
  [...table.matchAll(/^ \* \| (.+?) \|/gm)].flatMap(([, cell]) =>
    [...cell.matchAll(/`([\w-]+)`/g)].map((m) => m[1]),
  ),
);
const thrown = new Map();
const walk = (directory) => {
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, item.name);
    if (item.isDirectory()) walk(path);
    else if (path.endsWith(".ts") && !path.endsWith("testing.ts"))
      for (const match of readFileSync(path, "utf8").matchAll(
        /\bfailure\(\s*"([\w-]+)"/g,
      ))
        thrown.set(
          match[1],
          (thrown.get(match[1]) ?? new Set()).add(path.slice(root.length + 1)),
        );
  }
};
walk(join(root, "src"));
const undocumentedCodes = [...thrown.keys()].filter(
  (code) => !documented.has(code),
);

// Report.
console.log(
  `Public API: ${declarations} declarations, ${members} members (entry types: ${entryTypes.size})\n`,
);
console.log("rule        covered / applies   missing");
for (const rule of RULES) {
  const { applies, missing } = stats[rule];
  const covered = applies - missing.length;
  const percent = applies ? Math.round((covered / applies) * 100) : 100;
  console.log(
    `${rule.padEnd(11)} ${String(covered).padStart(7)} / ${String(applies).padEnd(7)} ${String(missing.length).padStart(7)}  (${percent}%)`,
  );
}
console.log(
  `\nError codes: ${documented.size} in the PluginError table, ${thrown.size} thrown by the SDK`,
);
for (const code of undocumentedCodes)
  console.log(
    `warning: error code "${code}" is thrown (${[...thrown.get(code)].join(", ")}) but not in the PluginError table`,
  );

console.log("\nEnforced categories (scripts/doc-standard.mjs):");
let strictFailures = 0;
for (const [category, report] of strictReport) {
  const passed = report.checks - report.problems.length;
  console.log(
    `${category}: ${report.symbols} symbols, ${passed} / ${report.checks} checks pass`,
  );
  for (const text of report.problems)
    console.log(`::error::${category}: ${text}`);
  strictFailures += report.problems.length;
}

if (listRule) {
  if (!stats[listRule]) {
    console.error(`unknown rule ${listRule}; one of ${RULES.join(", ")}`);
    process.exit(2);
  }
  console.log(`\nMissing ${listRule}:`);
  for (const name of stats[listRule].missing) console.log(`  ${name}`);
}

if (stats.summary.missing.length) {
  const level = strict ? "error" : "warning";
  for (const name of stats.summary.missing)
    console.log(`::${level}::no summary: ${name}`);
  if (strict) process.exit(1);
}
if (strictFailures) process.exit(1);
