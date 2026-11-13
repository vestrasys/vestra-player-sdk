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
 * the SDK itself throws (`failure("…")`), and that no `@capability` tag is
 * left in src/ (enforced: manifest capabilities were removed in 1.9.0).
 *
 * Two more enforced rules (SDK 1.7.0, the three plugin styles):
 *
 * - events      every `HostEvent` has a member of `EventPayloads` with a
 *               summary, and a row in the generated table of
 *               docs/reference/events.md (what styles B and C subscribe to)
 * - experimental  every declaration or member marked `@experimental`
 *               (`plugin.wire` and its types) says in its comment that
 *               "the wire protocol is not semver; this member changes with
 *               versions"
 *
 * The rules above are a report (exit 0). The categories listed in
 * scripts/doc-standard.mjs are enforced; `example-lead` and `stale-refs`
 * are enforced for every `@example` of the API and every Markdown code
 * block (since SDK 1.5.30), with the known violations of
 * `EXAMPLE_BASELINE` as warnings (`--baseline` prints the keys of new
 * problems). For the categories: a symbol of such a category that
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
import { typeFile } from "./doc-tables/lib/source.mjs";
import { hostEvents } from "./doc-tables/events.mjs";
import { generatedBlocks } from "./doc-tables.mjs";

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

const RULES = ["summary", "remarks", "example", "throws", "category", "since"];
const stats = Object.fromEntries(
  RULES.map((rule) => [rule, { applies: 0, missing: [] }]),
);
const check = (rule, name, ok) => {
  stats[rule].applies++;
  if (!ok) stats[rule].missing.push(name);
};

const commentOf = (reflection) => {
  const signature =
    reflection.signatures?.[0]?.comment ??
    reflection.getSignature?.comment ??
    reflection.type?.declaration?.signatures?.[0]?.comment;
  const own = reflection.comment;
  // A modifier tag on a method (`@experimental`, `plugin.wire`) gives the
  // method a comment of its own that holds only the modifier: the text
  // is the signature's.
  if (own && signature && !own.summary.length && !own.blockTags.length)
    return signature;
  return own ?? signature;
};
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
const testing = modules?.find(
  (module) => module.name === "@vestra-player/sdk/testing",
);
// A strict name is looked up in the SDK first, then in the testing module.
for (const declaration of [
  ...(sdk?.children ?? []),
  ...(testing?.children ?? []),
]) {
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
  const declaration =
    sdk?.getChildByName(name) ?? testing?.getChildByName(name);
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
  }
  for (const member of ownMembers(declaration)) {
    if (member.inheritedFrom) continue;
    const memberName = `${name}.${member.name}`;
    const memberComment = commentOf(member);
    need(memberName, hasSummary(memberComment), "no summary");
    if (kind !== "full") continue;
    if (isMethod(member)) {
      need(memberName, hasTag(memberComment, "@example"), "no @example");
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
/** Each code block of an `@example`, split at `// ---cut---`. */
const exampleCode = (tag) =>
  tag.content
    .filter(isFence)
    .map((part) =>
      splitCut(
        part.text.replace(/^\s*`{3,}[^\n]*\n?/, "").replace(/\n?`{3,}\s*$/, ""),
      ),
    );
/** Whether `text` holds a full sentence of at least `leadWords` words. */
const isSentence = (text) =>
  text.split(/\s+/).filter(Boolean).length >= EXAMPLE_RULES.leadWords &&
  /[.!?:](\s|$)/.test(text);
/** A resolved `{@link}` target (a reflection), not an unresolved name. */
const isReflection = (target) =>
  !!target && typeof target === "object" && typeof target.kindOf === "function";
/**
 * One `@example` tag judged by `example-lead`: `{ marker, target, problems }`,
 * each problem `{ id, text }` (the id keys `EXAMPLE_BASELINE`). A marker
 * (`@example See X` without code, `{@link X}` in its text) stands for the
 * example of another member.
 */
function judgeExample(tag) {
  const title = (tag.name ?? "").trim();
  const blocks = exampleCode(tag);
  if (!blocks.length && /^See\b/.test(title)) {
    const link = tag.content.find(
      (part) => part.kind === "inline-tag" && part.tag === "@link",
    );
    const problems = [];
    if (!link)
      problems.push({
        id: "marker-link",
        text: "a `See` marker without {@link} to the example",
      });
    else if (!isReflection(link.target))
      problems.push({
        id: "marker-unresolved",
        text: `marker link does not resolve: ${link.text}`,
      });
    return {
      marker: true,
      target: isReflection(link?.target) ? link.target : undefined,
      problems,
    };
  }
  const problems = [];
  const words = title.split(/\s+/).filter(Boolean).length;
  if (words < EXAMPLE_RULES.titleWords)
    problems.push({
      id: "title",
      text: title
        ? `title "${title}" has fewer than ${EXAMPLE_RULES.titleWords} words`
        : "no title (`@example Pause playback from a menu item`)",
    });
  if (!blocks.length) problems.push({ id: "code", text: "no code block" });
  // The lead: the prose between the title and the first code block.
  const first = tag.content.findIndex(isFence);
  const lead = partsText(
    first < 0 ? tag.content : tag.content.slice(0, first),
  ).trim();
  if (!isSentence(lead))
    problems.push({
      id: "lead",
      text: "no lead (a sentence or two under the title: what it does and how it works)",
    });
  const shown = blocks
    .flatMap((block) => block.visible)
    .filter((l) => l.trim());
  const commented = shown.some((line) => /(^|\s)(\/\/|\/\*)|^\s*\*/.test(line));
  if (shown.length > EXAMPLE_RULES.explainAbove && !commented)
    problems.push({
      id: "comment",
      text: `${shown.length} lines of code without a comment marking the key lines`,
    });
  if (blocks.some((block) => block.cuts > 1))
    problems.push({
      id: "cut",
      text: "more than one `// ---cut---` line in a code block",
    });
  return { marker: false, problems };
}

/** Every `@example` of a comment, judged. */
const examplesOf = (comment) =>
  (comment?.blockTags ?? [])
    .filter((block) => block.tag === "@example")
    .map((block) => ({ block, ...judgeExample(block) }));

const exampleReport = {
  problems: [], // fail the run
  baselined: [], // known, in EXAMPLE_BASELINE
  open: [], // every example-lead problem, for --list example-lead
  stale: [], // every stale-refs problem, for --list stale-refs
  newKeys: [], // the EXAMPLE_BASELINE keys of `problems` (--baseline prints them)
};
const coverage = new Map(); // category → { methods, explained, markers, examples, good }
const usedBaseline = new Set();
/** Methods without an explained example (or a marker): `--list explained`. */
const unexplained = [];
for (const module of modules ?? []) {
  const testingModule = module.name.endsWith("/testing");
  for (const declaration of module.children ?? []) {
    const declComment = commentOf(declaration);
    const category =
      categoryOf(declComment) || (testingModule ? "Testing" : "Other");
    // Every example meets the standard since SDK 1.5.30: the rules hold for
    // all of them (EXAMPLE_BASELINE takes known exceptions, if a rule is
    // ever tightened).
    const enforced = true;
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
    /** Report one problem: list it (`--list`), and fail or baseline it. */
    const report = (key, message, list) => {
      list.push(message);
      if (!enforced) return;
      if (EXAMPLE_BASELINE.has(key)) {
        usedBaseline.add(key);
        exampleReport.baselined.push(message);
      } else {
        exampleReport.problems.push(message);
        exampleReport.newKeys.push(key);
      }
    };
    for (const [name, comment, method] of subjects) {
      const examples = examplesOf(comment);
      if (method) {
        row.methods++;
        if (examples.some((e) => !e.marker && !e.problems.length))
          row.explained++;
        else if (examples.some((e) => e.marker && !e.problems.length))
          row.markers++;
        else unexplained.push(`${testingModule ? "testing!" : ""}${name}`);
      }
      const where = `${testingModule ? "testing!" : ""}${name}`;
      examples.forEach((example, index) => {
        const at = `${where}#${index + 1}`;
        row.examples++;
        if (!example.problems.length) row.good++;
        for (const problem of example.problems)
          report(
            `example-lead ${at} ${problem.id}`,
            `${at}: ${problem.text}`,
            exampleReport.open,
          );
        if (
          example.target &&
          !examplesOf(commentOf(example.target)).some((e) => !e.marker)
        )
          report(
            `example-lead ${at} marker-target`,
            `${at}: its See marker points to ${example.target.name}, which has no example of its own`,
            exampleReport.open,
          );
        const text = partsText(example.block.content);
        for (const { pattern, why } of STALE_REFERENCES)
          if (pattern.test(text))
            report(
              `stale-refs ${at}`,
              `${at}: example uses "${pattern.exec(text)[0]}": ${why}`,
              exampleReport.stale,
            );
      });
    }
    if (enforced) {
      // Per declaration: at most markerShare of its methods, and always at
      // least one (a declaration with fewer than 5 methods may still point
      // one trivial sibling at another).
      const markers = subjects.filter(([, comment]) =>
        examplesOf(comment).some((e) => e.marker),
      ).length;
      const methods = subjects.filter(([, , method]) => method).length;
      const allowed = Math.max(
        1,
        Math.floor(methods * EXAMPLE_RULES.markerShare),
      );
      if (markers > allowed)
        exampleReport.problems.push(
          `${declaration.name}: ${markers} See markers for ${methods} methods (at most ${allowed})`,
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
stats["example-lead"] = { applies: 0, missing: exampleReport.open };
stats.explained = { applies: 0, missing: unexplained };
stats["stale-refs"] = { applies: 0, missing: exampleReport.stale };

// Error codes: the PluginError table against the codes the SDK throws.
const types = readFileSync(join(root, typeFile("PluginError")), "utf8");
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
    else if (
      path.endsWith(".ts") &&
      !/[\\/]plugin[\\/]testing(\.ts$|[\\/])/.test(path)
    )
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

// No @capability tag is left (manifest capabilities were removed in 1.9.0).
const capabilityProblems = [];
{
  const scan = (directory) => {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, item.name);
      if (item.isDirectory()) {
        scan(path);
        continue;
      }
      if (!path.endsWith(".ts")) continue;
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (/^\s*\*\s*@capability\b/.test(line))
            capabilityProblems.push(
              `${path.slice(root.length + 1)}:${index + 1}: @capability (removed in 1.9.0)`,
            );
        });
    }
  };
  scan(join(root, "src"));
}

// Every HostEvent is in the event table (docs/reference/events.md).
const eventProblems = [];
{
  let events = [];
  try {
    events = hostEvents(); // HostEvent = EventPayloads, each with a summary
  } catch (error) {
    eventProblems.push(error.message);
  }
  const page = "docs/reference/events.md";
  const block = generatedBlocks(readFileSync(join(root, page), "utf8")).find(
    (each) => each.name === "events",
  );
  if (!block) eventProblems.push(`${page}: no generated events table`);
  else
    for (const { name } of events)
      if (!block.inner.includes(`| \`${name}\` |`))
        eventProblems.push(
          `${page}: HostEvent "${name}" has no row (run npm run docs:tables)`,
        );
}

// @experimental declarations and members carry the stability sentence
// ("the wire protocol is not semver; this member changes with versions",
// or "this type" for a wire type). TypeDoc cascades the modifier to the
// children of a marked declaration: those are covered by their parent.
const STABILITY = /wire protocol[^.]*not semver[^.]*changes with versions/;
const experimentalProblems = [];
let experimentalCount = 0;
{
  const text = (comment) =>
    [...comment.summary, ...comment.blockTags.flatMap((tag) => tag.content)]
      .map((part) => part.text)
      .join("")
      .replace(/\s+/g, " ");
  for (const reflection of Object.values(project.reflections)) {
    const marked = (each) =>
      [
        each?.comment,
        ...(each?.signatures ?? []).map((signature) => signature.comment),
      ].filter(Boolean);
    const comments = marked(reflection);
    const experimental = (list) =>
      list.some((comment) => comment.hasModifier("@experimental"));
    if (!experimental(comments)) continue;
    // Signatures are read with their method; a field or an inherited
    // member of a marked declaration is covered by it (cascaded), a method
    // of its own is not.
    if (reflection.kindOf(ReflectionKind.SomeSignature)) continue;
    const own =
      reflection.kindOf(ReflectionKind.Method) && !reflection.inheritedFrom;
    if (!own && experimental(marked(reflection.parent))) continue;
    experimentalCount++;
    if (!comments.some((comment) => STABILITY.test(text(comment))))
      experimentalProblems.push(
        `${reflection.getFullName()}: @experimental without "the wire protocol is not semver; this member changes with versions"`,
      );
  }
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
  `Every example and Markdown code block: example-lead ${exampleReport.open.length} problems (--list example-lead), stale-refs ${exampleReport.stale.length} (--list stale-refs); ${exampleReport.baselined.length} of them known (EXAMPLE_BASELINE), ${exampleReport.problems.length} failing.`,
);
for (const text of exampleReport.baselined)
  console.log(`::warning::baseline: ${text}`);
for (const text of exampleReport.problems) console.log(`::error::${text}`);
strictFailures += exampleReport.problems.length;

console.log(`\n@capability tags: ${capabilityProblems.length} problems`);
for (const text of capabilityProblems) console.log(`::error::${text}`);
strictFailures += capabilityProblems.length;

console.log(`HostEvent in the event table: ${eventProblems.length} problems`);
for (const text of eventProblems) console.log(`::error::${text}`);
strictFailures += eventProblems.length;

console.log(
  `@experimental (${experimentalCount} declarations and members) with the stability sentence: ${experimentalProblems.length} problems`,
);
for (const text of experimentalProblems) console.log(`::error::${text}`);
strictFailures += experimentalProblems.length;

if (process.argv.includes("--baseline")) {
  console.log("\nEXAMPLE_BASELINE keys of the new problems:");
  for (const key of exampleReport.newKeys)
    console.log(`${JSON.stringify(key)},`);
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
