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
 * - example-lead  every `@example` has a task title of 3+ words, a lead
 *             (a sentence under the title: what it does and how it works)
 *             and, above 5 shown lines, a comment in the code; or it is a
 *             `See` marker linking a sibling that has an example of its own
 * - stale-refs  no `@example` (and no code block of README.md or docs/)
 *             uses a name of `STALE_REFERENCES`
 *
 * Per `@category` it prints the share of methods with an explained example
 * (one that passes `example-lead`).
 *
 * It also compares the error codes of the `PluginError` table with the codes
 * the SDK itself throws (`failure("…")`), and checks every `@capability`
 * tag in src/ (enforced): each dotted name in it (`ui.mount`) and each
 * single-word name it gives (`events`) must be a capability of
 * `CAPABILITY_INFO`, and the tag must name at least one unless it starts
 * with "None" or "That of".
 *
 * The rules above are a report (exit 0). The categories listed in
 * scripts/doc-standard.mjs are enforced (`example-lead` and `stale-refs`
 * with the known violations of `EXAMPLE_BASELINE` as warnings; Markdown
 * code blocks always): a symbol of such a category that
 * misses part of the standard fails the run, and so does a declaration
 * tagged with such a `@category` that the list does not name. `--strict`
 * also fails when any summary is missing. `--list <rule>` prints every
 * symbol that misses that rule.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Application, ReflectionKind } from "typedoc";
import {
  EXAMPLE_BASELINE,
  EXAMPLE_RULES,
  STALE_REFERENCES,
  STRICT_CATEGORIES,
  splitCut,
  strictDeclarations,
} from "./doc-standard.mjs";
import { CAPABILITY_INFO } from "../src/capabilities.ts";

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

// Examples: `example-lead`, `stale-refs` and the coverage of explained
// examples (docs/maintaining.md, "Examples in reference comments").
const partsText = (parts) => parts.map((part) => part.text).join("");
const isFence = (part) => part.kind === "code" && /^\s*`{3}/.test(part.text);
/** The shown lines of each code block of an `@example` (hidden setup removed). */
const exampleCode = (tag) =>
  tag.content.filter(isFence).map((part) => {
    const body = part.text
      .replace(/^\s*`{3,}[^\n]*\n?/, "")
      .replace(/\n?`{3,}\s*$/, "");
    return splitCut(body).visible;
  });
/** Whether `text` holds a full sentence of at least `leadWords` words. */
const isSentence = (text) =>
  text.split(/\s+/).filter(Boolean).length >= EXAMPLE_RULES.leadWords &&
  /[.!?:](\s|$)/.test(text);
/**
 * One `@example` tag judged by `example-lead`: `{ marker, target, problems }`.
 * A marker (`@example See X` without code, `{@link X}` in its text) stands
 * for an example of another member.
 */
function judgeExample(tag) {
  const title = (tag.name ?? "").trim();
  const blocks = exampleCode(tag);
  if (!blocks.length && /^See\b/.test(title)) {
    const link = tag.content.find(
      (part) => part.kind === "inline-tag" && part.tag === "@link",
    );
    return {
      marker: true,
      target: link?.target,
      problems: link ? [] : ["a `See` marker without {@link} to the example"],
    };
  }
  const problems = [];
  const words = title.split(/\s+/).filter(Boolean).length;
  if (words < EXAMPLE_RULES.titleWords)
    problems.push(
      title
        ? `title "${title}" has fewer than ${EXAMPLE_RULES.titleWords} words`
        : "no title (`@example Pause playback from a menu item`)",
    );
  if (!blocks.length) problems.push("no code block");
  // The lead: the prose between the title and the first code block.
  const first = tag.content.findIndex(isFence);
  const lead = partsText(
    first < 0 ? tag.content : tag.content.slice(0, first),
  ).trim();
  if (!isSentence(lead))
    problems.push(
      "no lead (a sentence or two under the title: what it does and how it works)",
    );
  const shown = blocks.flat().filter((line) => line.trim());
  const commented = shown.some((line) => /(^|\s)(\/\/|\/\*)|^\s*\*/.test(line));
  if (shown.length > EXAMPLE_RULES.explainAbove && !commented)
    problems.push(
      `${shown.length} lines of code without a comment marking the key lines`,
    );
  return { marker: false, problems };
}

/** Every `@example` of a comment, judged. */
const examplesOf = (comment) =>
  (comment?.blockTags ?? [])
    .filter((block) => block.tag === "@example")
    .map((block) => ({ block, ...judgeExample(block) }));

const exampleReport = { problems: [], baselined: [], stale: [] };
const coverage = new Map(); // category → { methods, explained, markers, examples, good }
const usedBaseline = new Set();
const leadMissing = [];
for (const module of modules ?? []) {
  const testingModule = module.name.endsWith("/testing");
  for (const declaration of module.children ?? []) {
    const declComment = commentOf(declaration);
    const category =
      categoryOf(declComment) || (testingModule ? "Testing" : "Other");
    const enforced = !testingModule && strictDeclarations.has(declaration.name);
    const row =
      coverage.get(category) ??
      coverage
        .set(category, {
          methods: 0,
          explained: 0,
          markers: 0,
          examples: 0,
          good: 0,
        })
        .get(category);
    const subjects = [
      [declaration.name, declComment, false],
      ...ownMembers(declaration)
        .filter((member) => !member.inheritedFrom)
        .map((member) => [
          `${declaration.name}.${member.name}`,
          commentOf(member),
          isMethod(member),
        ]),
    ];
    if (declaration.kindOf(ReflectionKind.Function)) subjects[0][2] = true;
    for (const [name, comment, method] of subjects) {
      const examples = examplesOf(comment);
      if (method) {
        row.methods++;
        if (examples.some((e) => !e.marker && !e.problems.length))
          row.explained++;
        else if (examples.some((e) => e.marker && !e.problems.length))
          row.markers++;
      }
      for (const example of examples) {
        row.examples++;
        if (!example.problems.length) row.good++;
        const where = `${module.name.endsWith("/testing") ? "testing!" : ""}${name}`;
        for (const problem of example.problems) {
          const key = `example-lead ${where}`;
          leadMissing.push(`${where}: ${problem}`);
          if (!enforced) continue;
          if (EXAMPLE_BASELINE.has(key)) {
            usedBaseline.add(key);
            exampleReport.baselined.push(`${where}: ${problem}`);
          } else exampleReport.problems.push(`${where}: ${problem}`);
        }
        if (example.marker && example.target && !example.problems.length) {
          const targetExamples = examplesOf(commentOf(example.target));
          if (!targetExamples.some((e) => !e.marker))
            (enforced ? exampleReport.problems : leadMissing).push(
              `${where}: its See marker points to ${example.target.name}, which has no example of its own`,
            );
        }
        const text = partsText(example.block.content);
        for (const { pattern, why } of STALE_REFERENCES)
          if (pattern.test(text)) {
            const key = `stale-refs ${where}`;
            const message = `${where}: example uses "${pattern.exec(text)[0]}": ${why}`;
            if (!enforced) exampleReport.stale.push(message);
            else if (EXAMPLE_BASELINE.has(key)) {
              usedBaseline.add(key);
              exampleReport.baselined.push(message);
            } else exampleReport.problems.push(message);
          }
      }
    }
    if (enforced) {
      const markers = subjects.filter(([, comment]) =>
        examplesOf(comment).some((e) => e.marker),
      ).length;
      const methods = subjects.filter(([, , method]) => method).length;
      if (
        markers > Math.max(1, Math.floor(methods * EXAMPLE_RULES.markerShare))
      )
        exampleReport.problems.push(
          `${declaration.name}: ${markers} See markers for ${methods} methods (at most ${Math.round(EXAMPLE_RULES.markerShare * 100)} %)`,
        );
    }
  }
}
// Code blocks of the site's Markdown pages (always enforced; docs/maintaining.md
// names the stale references on purpose).
for (const path of [
  "README.md",
  ...readdirSync(join(root, "docs"), { recursive: true })
    .map((p) => `docs/${String(p).split("\\").join("/")}`)
    .filter((p) => p.endsWith(".md") && p !== "docs/maintaining.md"),
]) {
  const text = readFileSync(join(root, path), "utf8");
  // A fence closes with as many backticks as it opened with.
  for (const block of text.matchAll(
    /^([ \t]*)(`{3,})[^\n]*\n([\s\S]*?)^\1\2[ \t]*$/gm,
  ))
    for (const { pattern, why } of STALE_REFERENCES)
      if (pattern.test(block[3]))
        exampleReport.problems.push(
          `${path}:${text.slice(0, block.index).split("\n").length}: code uses "${pattern.exec(block[3])[0]}": ${why}`,
        );
}
for (const key of EXAMPLE_BASELINE)
  if (!usedBaseline.has(key))
    exampleReport.problems.push(
      `${key}: listed in EXAMPLE_BASELINE (scripts/doc-standard.mjs) but no longer fails; remove it`,
    );
stats["example-lead"] = { applies: 0, missing: leadMissing };
stats["stale-refs"] = { applies: 0, missing: exampleReport.stale };

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

// @capability tags name capabilities that exist.
const capabilityProblems = [];
{
  const known = new Set(Object.keys(CAPABILITY_INFO));
  const bareNames = new Set([...known].filter((name) => !name.includes(".")));
  const scan = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        scan(path);
        continue;
      }
      if (!path.endsWith(".ts")) continue;
      const text = readFileSync(path, "utf8");
      for (const comment of text.matchAll(/\/\*\*[\s\S]*?\*\//g)) {
        const lines = comment[0]
          .split("\n")
          .map((line) => line.replace(/^\s*\/?\*+\/?\s?/, ""));
        lines.forEach((line, index) => {
          if (!line.startsWith("@capability")) return;
          const rest = [line.slice("@capability".length)];
          for (const next of lines.slice(index + 1)) {
            if (/^@\w/.test(next) || !next.trim()) break;
            rest.push(next);
          }
          const tag = rest
            .join(" ")
            .replace(/\{@link[^}]*\}/g, "")
            .trim();
          const at = `${path.slice(root.length + 1)}:${text.slice(0, comment.index).split("\n").length + index}`;
          const dotted = tag.match(/\b[a-z]+(?:\.[a-z]+)+\b/g) ?? [];
          const words = (tag.match(/\b[a-z]+\b/g) ?? []).filter((word) =>
            bareNames.has(word),
          );
          for (const name of dotted)
            if (!known.has(name))
              capabilityProblems.push(
                `${at}: @capability names "${name}", which is not in CAPABILITY_INFO`,
              );
          if (!dotted.length && !words.length && !/^(None|That of)\b/.test(tag))
            capabilityProblems.push(
              `${at}: @capability "${tag}" names no capability`,
            );
        });
      }
    }
  };
  scan(join(root, "src"));
}

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

console.log(
  "\nExamples (example-lead, stale-refs): methods with an explained example, by @category",
);
console.log(
  "category      methods  explained  See-marker   examples  pass example-lead",
);
const percent = (part, whole) =>
  whole ? `${Math.round((part / whole) * 100)}%` : "-";
const totals = { methods: 0, explained: 0, markers: 0, examples: 0, good: 0 };
for (const [category, row] of [...coverage].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  for (const key in totals) totals[key] += row[key];
  console.log(
    `${category.padEnd(13)} ${String(row.methods).padStart(7)}  ${`${row.explained} (${percent(row.explained, row.methods)})`.padStart(9)}  ${String(row.markers).padStart(10)}  ${String(row.examples).padStart(9)}  ${`${row.good} (${percent(row.good, row.examples)})`.padStart(17)}`,
  );
}
console.log(
  `${"all".padEnd(13)} ${String(totals.methods).padStart(7)}  ${`${totals.explained} (${percent(totals.explained, totals.methods)})`.padStart(9)}  ${String(totals.markers).padStart(10)}  ${String(totals.examples).padStart(9)}  ${`${totals.good} (${percent(totals.good, totals.examples)})`.padStart(17)}`,
);
console.log(
  `example-lead outside the enforced categories: ${leadMissing.length} problems (--list example-lead); stale-refs: ${exampleReport.stale.length} (--list stale-refs)`,
);
for (const text of exampleReport.stale)
  console.log(`::warning::stale-refs: ${text}`);
for (const text of exampleReport.baselined)
  console.log(`::warning::baseline: ${text}`);
for (const text of exampleReport.problems) console.log(`::error::${text}`);
strictFailures += exampleReport.problems.length;

console.log(`\n@capability tags: ${capabilityProblems.length} problems`);
for (const text of capabilityProblems) console.log(`::error::${text}`);
strictFailures += capabilityProblems.length;

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
