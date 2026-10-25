#!/usr/bin/env node
/**
 * Generates the references for language models (https://llmstxt.org):
 *
 *   node scripts/llms.mjs           write llms.txt and llms-full.txt
 *   node scripts/llms.mjs --check   fail when the committed files are stale
 *
 * - llms.txt: the short index. What a plugin is, the rules, the folder
 *   layout, a manifest and its fields, `activate`, every capability, the
 *   test host, the command line, the error codes, and where each topic is in
 *   llms-full.txt (line numbers). It stays below 9 KB.
 * - llms-full.txt: the documentation pages of every group in
 *   scripts/doc-structure.mjs except the examples (index pages left out,
 *   condensed), every public declaration of `@vestra-player/sdk` and
 *   `@vestra-player/sdk/testing` as a declaration file whose doc comments are
 *   reduced to their description and the tags `@capability`, `@player`,
 *   `@param`, `@returns`, `@throws` and `@deprecated`, then every example
 *   plugin's README, walkthrough notes and complete source.
 *
 * Everything comes from the sources: the declarations from an in-memory
 * declaration emit of src/ (stripInternal), the text from docs/**.md and
 * examples/ (the capability and command line tables from the generated
 * tables of docs/reference/), the limits from src/manifest.ts and
 * src/commands.ts. The output depends only on those files (no dates, sorted
 * listings, LF line endings), so CI regenerates it and compares
 * (`npm run docs:llms -- --check`). Both files are in the npm package
 * (`@vestra-player/sdk/llms.txt`, `@vestra-player/sdk/llms-full.txt`) and on
 * the documentation site (scripts/typedoc-plugin.mjs copies them).
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { MANIFEST_FIELDS, MANIFEST_LIMITS } from "../src/manifest.ts";
import { COMMAND_LIMITS, MENU_IDS } from "../src/commands.ts";
import { CAPABILITIES, API_VERSION } from "../src/capabilities.ts";
import { GROUPS } from "./doc-structure.mjs";

const root = resolve(import.meta.dirname, "..");
const check = process.argv.includes("--check");
// The compiler resolves `types: ["node"]` from the current directory.
process.chdir(root);
const read = (path) =>
  readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const pkg = JSON.parse(read("package.json"));
const SITE = "https://vestrasys.github.io/vestra-player-sdk/";
const REPO = "https://github.com/vestrasys/vestra-player-sdk";
/** llms.txt must stay below this size (bytes). */
const INDEX_LIMIT = 9 * 1024;
const fail = (message) => {
  console.error(`::error::llms: ${message}`);
  process.exit(1);
};

// ── Markdown helpers ────────────────────────────────────────────────────

/** Front matter, `{@link}` and relative links resolved to plain text. */
function plain(text) {
  return text
    .replace(/^---\n[\s\S]*?\n---\n+/, "")
    .replace(/^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*\n+/gm, "")
    .replace(/^<!-- \/?generated[^>]*-->\n+/gm, "")
    .replace(/\{@link(?:code|plain)?\s+([^}|]+?)\s*\|\s*([^}]+?)\s*\}/g, "$2")
    .replace(
      /\{@link(?:code|plain)?\s+("[^"]+"!)?(\S+?)(?:\s+([^}]+?))?\s*\}/g,
      (_, _module, target, text) => text ?? target.replace(/^"([^"]+)"$/, "$1"),
    )
    .replace(/\[([^\]]+)\]\((?!https?:)[^)]*\)/g, "$1");
}

/** The body of the `## heading` section (up to the next heading of its level). */
function section(text, heading, level = 2) {
  const marks = "#".repeat(level);
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line === `${marks} ${heading}`);
  if (start < 0) fail(`no section "${heading}"`);
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++)
    if (new RegExp(`^#{1,${level}} `).test(lines[i]) && !inFence(lines, i)) {
      end = i;
      break;
    }
  return lines
    .slice(start + 1, end)
    .join("\n")
    .trim();
}

function inFence(lines, index) {
  let open = false;
  for (let i = 0; i < index; i++) if (/^\s*```/.test(lines[i])) open = !open;
  return open;
}

/** ``` fences of a text: `{ lang, code }`. */
function fences(text) {
  return [...text.matchAll(/^```(\w*)[^\n]*\n([\s\S]*?)^```[ \t]*$/gm)].map(
    ([, lang, code]) => ({ lang, code: code.replace(/\n$/, "") }),
  );
}

/** The rows of the first Markdown table in `text`, as arrays of cells. */
function table(text) {
  const rows = text
    .split("\n")
    .filter((line) => /^\|.*\|$/.test(line.trim()))
    .map((line) =>
      line
        .trim()
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) => cell.trim()),
    );
  return rows.filter(
    (row, i) => i > 0 && !row.every((c) => /^:?-+:?$/.test(c)),
  );
}

/** Headings one or more levels deeper; screenshots dropped. */
function demote(text, by) {
  const lines = text.split("\n");
  return lines
    .map((line, i) =>
      /^#+ /.test(line) && !inFence(lines, i) ? "#".repeat(by) + line : line,
    )
    .filter((line) => !/^!\[[^\]]*\]\([^)]*\)$/.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}

const LANG = {
  ".ts": "ts",
  ".mjs": "js",
  ".slint": "slint",
  ".json": "json",
  ".md": "md",
};

/** `// #region name` … `// #endregion name` of a file, without the markers. */
function region(path, name) {
  const lines = read(path).split("\n");
  if (!name) return stripRegions(lines.join("\n"));
  const start = lines.findIndex((l) => l.trim() === `// #region ${name}`);
  const end = lines.findIndex((l) => l.trim() === `// #endregion ${name}`);
  if (start < 0 || end < start) fail(`${path}: no region ${name}`);
  const body = lines.slice(start + 1, end);
  const indent = Math.min(
    ...body.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length),
  );
  return stripRegions(body.map((l) => l.slice(indent)).join("\n"));
}
const stripRegions = (text) =>
  text
    .split("\n")
    .filter((l) => !/^\s*\/\/ #(end)?region\b/.test(l))
    .join("\n")
    .replace(/\n+$/, "");

/** `{@includeCode ../../x#region}` replaced by the code (paths from docs/<folder>/). */
function includeCode(text, replace) {
  return text.replace(
    /\{@includeCode\s+\.\.\/\.\.\/([^#}\s]+)(?:#([\w-]+))?\s*\}/g,
    (_, path, name) => replace(path, name),
  );
}
/** A fenced block, with a fence longer than any inside `code`. */
function fence(lang, code) {
  const longest = Math.max(
    2,
    ...[...code.matchAll(/^\s*(`{3,})/gm)].map((m) => m[1].length),
  );
  const marks = "`".repeat(longest + 1);
  return `${marks}${lang}\n${code}\n${marks}`;
}
const inlineCode = (path, name) =>
  fence(LANG[extname(path)] ?? "", region(path, name));

// ── Declarations ────────────────────────────────────────────────────────

const ENTRIES = {
  "@vestra-player/sdk": "src/index.ts",
  "@vestra-player/sdk/testing": "src/plugin/testing.ts",
};
const KEPT_TAGS = [
  "capability",
  "player",
  "param",
  "returns",
  "throws",
  "deprecated",
];

const config = ts.parseJsonConfigFileContent(
  ts.readConfigFile(join(root, "tsconfig.json"), ts.sys.readFile).config,
  ts.sys,
  root,
);
const program = ts.createProgram(
  Object.values(ENTRIES).map((e) => join(root, e)),
  {
    ...config.options,
    declaration: true,
    emitDeclarationOnly: true,
    stripInternal: true,
    removeComments: false,
    noEmit: false,
  },
);
const declarationFiles = new Map();
const emitted = program.emit(undefined, (file, text) => {
  if (file.endsWith(".d.ts")) declarationFiles.set(resolve(file), text);
});
if (emitted.emitSkipped) fail("declaration emit failed");
const checker = program.getTypeChecker();
const outDir = config.options.outDir;
const rootDir = config.options.rootDir;
const dtsOf = (source) =>
  resolve(outDir, relative(rootDir, source).replace(/\.ts$/, ".d.ts"));

const parsedDts = new Map();
function dtsSource(source) {
  const path = dtsOf(source);
  if (!parsedDts.has(path)) {
    const text = declarationFiles.get(path);
    if (text === undefined) fail(`no declarations for ${source}`);
    parsedDts.set(
      path,
      ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true),
    );
  }
  return parsedDts.get(path);
}

const nameOf = (statement) =>
  ts.isVariableStatement(statement)
    ? statement.declarationList.declarations[0].name.getText()
    : statement.name?.getText();

/** The top-level statements declaring `name` in the declarations of `source`. */
function statementsOf(source, name) {
  return dtsSource(source).statements.filter((s) => nameOf(s) === name);
}

/** The doc comment directly before a statement, or "". */
function docBefore(file, statement) {
  const text = file.getFullText();
  const ranges = ts.getLeadingCommentRanges(text, statement.pos) ?? [];
  const last = ranges.at(-1);
  if (!last || !text.startsWith("/**", last.pos)) return "";
  return text.slice(last.pos, last.end);
}

/** A doc comment as `{ description, tags: [{ tag, text }] }`. */
function parseDoc(comment) {
  const lines = comment
    .replace(/^\/\*\*/, "")
    .replace(/\*\/$/, "")
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, "").replace(/\s+$/, ""));
  const description = [];
  const tags = [];
  let fenced = false;
  for (const line of lines) {
    if (line.startsWith("```")) fenced = !fenced;
    const tag = !fenced && /^@(\w+)\s*(.*)$/.exec(line);
    if (tag) tags.push({ tag: tag[1], text: [tag[2]] });
    else if (tags.length) tags.at(-1).text.push(line);
    else description.push(line);
  }
  return {
    description: plain(description.join("\n")).trim(),
    tags: tags.map(({ tag, text }) => ({
      tag,
      text: plain(text.join("\n")).trim(),
    })),
  };
}

const oneLine = (text) => text.replace(/\s*\n\s*/g, " ").trim();
const firstSentence = (text) => {
  const match = /^(.+?[.!?])(\s|$)/.exec(oneLine(text));
  return match ? match[1] : oneLine(text);
};
const simple = (text) => !/\n\s*\n|^\s*([-*] |\d+\. |```|\|)/m.test(text);

/** The kept tags as lines (`@throws conflict (throws) …`). */
function tagLines(tags) {
  return tags
    .filter(({ tag }) => KEPT_TAGS.includes(tag))
    .map(({ tag, text }) =>
      `@${tag} ${oneLine(tag === "throws" ? text.replace(/^`([\w-]+)`/, "$1") : text)}`.trim(),
    );
}

/** A member's doc comment, condensed and re-indented. */
function condense(comment, indent) {
  const { description, tags } = parseDoc(comment);
  const lines = [
    ...(description
      ? simple(description)
        ? [oneLine(description)]
        : description.split("\n")
      : []),
    ...tagLines(tags),
  ];
  if (!lines.length) return "";
  if (lines.length === 1 && lines[0].length + indent.length < 160)
    return `/** ${lines[0]} */`;
  return ["/**", ...lines.map((l) => (l ? ` * ${l}` : " *")), " */"].join(
    `\n${indent}`,
  );
}

/** The declaration's code: members' comments condensed, private members dropped. */
function code(file, statement) {
  let text = file.getFullText().slice(statement.getStart(), statement.end);
  text = text.replace(
    /^([ \t]*)\/\*\*[\s\S]*?\*\/[ \t]*\n/gm,
    (match, indent) => {
      const short = condense(match.trim(), indent);
      return short ? `${indent}${short}\n` : "";
    },
  );
  return text
    .replace(/^export (declare )?/, "")
    .replace(/^declare /, "")
    .split("\n")
    .filter((line) => !/^\s*(private [\w$]+|#private);$/.test(line))
    .map((line) =>
      line.replace(/^( {4})+/, (spaces) => " ".repeat(spaces.length / 2)),
    )
    .join("\n");
}

/** Every declaration an entry point exports, in source order. */
function exportsOf(entry) {
  const file = program.getSourceFile(join(root, entry));
  const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(file));
  return symbols
    .map((symbol) => {
      const target =
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol;
      const declaration = target.declarations?.[0];
      return {
        name: symbol.name,
        source: declaration.getSourceFile().fileName,
        pos: declaration.pos,
      };
    })
    .filter((item) => item.name !== "default");
}

const fileRank = (entry) => (source) =>
  resolve(source) === resolve(root, entry)
    ? ""
    : resolve(source) === resolve(root, "src/plugin/types.ts")
      ? " "
      : relative(root, source);
function sortDeclarations(items, entry) {
  const rank = fileRank(entry);
  return items.sort(
    (a, b) =>
      rank(a.source).localeCompare(rank(b.source)) ||
      a.pos - b.pos ||
      a.name.localeCompare(b.name),
  );
}

/** One declaration as Markdown: heading, description, tags, code. */
function declarationBlock(item, heading = "###") {
  const statements = statementsOf(item.source, item.name);
  if (!statements.length)
    fail(`${item.name}: not found in the declarations of ${item.source}`);
  const file = statements[0].getSourceFile();
  const doc = parseDoc(docBefore(file, statements[0]));
  const parts = [`${heading} ${item.name}`, ""];
  if (doc.description) parts.push(doc.description, "");
  const tags = tagLines(doc.tags);
  if (tags.length) parts.push(tags.map((t) => `- ${t}`).join("\n"), "");
  parts.push(
    "```ts",
    statements.map((s) => code(file, s)).join("\n"),
    "```",
    "",
  );
  return parts.join("\n");
}

const sdkExports = sortDeclarations(
  exportsOf(ENTRIES["@vestra-player/sdk"]),
  "src/plugin/types.ts",
);
const sdkNames = new Set(sdkExports.map((item) => item.name));
const testingExports = sortDeclarations(
  exportsOf(ENTRIES["@vestra-player/sdk/testing"]).filter(
    (item) => !sdkNames.has(item.name),
  ),
  ENTRIES["@vestra-player/sdk/testing"],
);

/** Internal types the public API refers to (typedoc.json lists them). */
const internalNames = JSON.parse(read("typedoc.json")).intentionallyNotExported;
const internalExports = internalNames.map((name) => {
  const found = program
    .getSourceFiles()
    .filter((f) => resolve(f.fileName).startsWith(resolve(root, "src") + sep))
    .sort((a, b) => a.fileName.localeCompare(b.fileName))
    .flatMap((f) =>
      f.statements
        .filter((s) => nameOf(s) === name)
        .map((s) => ({ name, source: f.fileName, pos: s.pos })),
    );
  if (!found.length) fail(`intentionallyNotExported ${name}: not found`);
  return found[0];
});

// ── Text from the documents ─────────────────────────────────────────────

const gettingStarted = read("docs/tutorials/getting-started.md");
const capabilitiesPage = read("docs/reference/capabilities.md");
const cliPage = read("docs/reference/cli.md");
const examplesReadme = read("examples/README.md");
const typesSource = read("src/plugin/types.ts");

/** The rows of the generated table `<!-- generated:name -->` of a page. */
function generatedTable(text, name, page) {
  const start = text.indexOf(`<!-- generated:${name} -->`);
  if (start < 0) fail(`${page}: no generated table ${name}`);
  return table(text.slice(start, text.indexOf("<!-- /generated -->", start)));
}

const manifestSection = section(gettingStarted, "The manifest");
const firstManifest = fences(manifestSection).find((f) => f.lang === "json");
if (!firstManifest) fail("getting-started.md, The manifest: no JSON manifest");

/** `[capability, opens, also needs]` from Reference: capabilities. */
const capabilityRows = generatedTable(
  capabilitiesPage,
  "capabilities",
  "reference/capabilities.md",
).map(([cap, opens, requires]) => [
  /`([\w.]+)`/.exec(cap)[1],
  plain(opens),
  requires === "—" ? "" : requires,
]);
{
  const listed = capabilityRows.map(([cap]) => cap);
  const missing = CAPABILITIES.filter((c) => !listed.includes(c));
  const extra = listed.filter((c) => !CAPABILITIES.includes(c));
  if (missing.length || extra.length)
    fail(
      `reference/capabilities.md table: missing ${missing.join(", ") || "none"}, unknown ${extra.join(", ") || "none"}`,
    );
}
/** "Player.open, Player.seek, Power.x" → "Player.open/seek, Power.x". */
function compactMembers(list) {
  const groups = new Map();
  for (const member of list.split(/,\s*/)) {
    const [owner, ...rest] = member.split(".");
    if (!groups.has(owner)) groups.set(owner, []);
    if (rest.length) groups.get(owner).push(rest.join("."));
  }
  // Owners with the same single member: "Player/Panel.onChange".
  const byMember = new Map();
  for (const [owner, names] of groups) {
    const key = names.length === 1 ? names[0] : `\0${owner}`;
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push([owner, names]);
  }
  return [...byMember.values()]
    .map((owners) =>
      owners.length > 1
        ? `${owners.map(([owner]) => owner).join("/")}.${owners[0][1][0]}`
        : owners[0][1].length
          ? `${owners[0][0]}.${owners[0][1].join("/")}`
          : owners[0][0],
    )
    .join(", ");
}
const noCapability = firstSentence(
  plain(section(capabilitiesPage, "Without a capability")),
);

/** The PluginError table: `[code cell, meaning]`. */
const errorRows = (() => {
  const start = typesSource.indexOf("| code | meaning |");
  const end = typesSource.indexOf("\n *\n", start);
  return table(
    typesSource
      .slice(start, end)
      .split("\n")
      .map((l) => l.replace(/^\s*\* ?/, ""))
      .join("\n"),
  ).map(([codes, meaning]) => [codes, plain(meaning)]);
})();
/** The codes llms.txt lists; llms-full.txt has the whole table. */
const COMMON_ERRORS = [
  "capability",
  "invalid",
  "missing",
  "busy",
  "conflict",
  "unavailable",
  "unsupported",
  "stale",
  "failed",
  "timeout",
  "aborted",
  "limit",
  "reserved",
  "versionMismatch",
];
{
  const codes = errorRows.flatMap(([cell]) =>
    [...cell.matchAll(/`([\w-]+)`/g)].map((m) => m[1]),
  );
  const unknown = COMMON_ERRORS.filter((c) => !codes.includes(c));
  if (unknown.length) fail(`PluginError has no code ${unknown.join(", ")}`);
}
/** The first sentence of a meaning, without parentheses. */
const shortMeaning = (text) => {
  let short = text;
  while (/\s*\([^()]*\)/.test(short))
    short = short.replace(/\s*\([^()]*\)/g, "");
  return short
    .replace(/^[\w.,\s]+: (\w)/, (_, c) => c.toUpperCase())
    .replace(/(; |, or |, which ).*$/, "")
    .replace(/(\.)\s.*$/, "$1")
    .replace(/\.$/, "");
};

/** `[command, does]` from Reference: command line, each cut to its first clause. */
const cliRows = generatedTable(cliPage, "cli commands", "reference/cli.md").map(
  ([command, does]) => [
    command,
    does
      .replace(/\s*\([^()]*\)/g, "")
      .replace(/([;:] |, and | with ).*$/, "")
      .trim(),
  ],
);
const exampleRows = table(examplesReadme);
const exampleNames = exampleRows.map(([cell]) => /\[(.+?)\]/.exec(cell)[1]);
{
  const onDisk = readdirSync(join(root, "examples"), { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  if ([...exampleNames].sort().join() !== onDisk.join())
    fail(
      `examples/README.md lists ${exampleNames} but examples/ has ${onDisk}`,
    );
}

// ── llms-full.txt ───────────────────────────────────────────────────────

/** The front matter `title` of a page (TypeDoc names the page after it). */
const titleOf = (path) => {
  const match = /^---\n[\s\S]*?^title:\s*(.+?)\s*$[\s\S]*?\n---\n/m.exec(
    read(path),
  );
  if (!match) fail(`${path}: no title in the front matter`);
  return match[1].replace(/^"(.*)"$/, "$1");
};
/** The page's address on the site, as TypeDoc's createNormalizedUrl makes it. */
const pageUrl = (path) =>
  `documents/${[...titleOf(path)]
    .map((c) =>
      /[A-Za-z0-9()+,\-._]/.test(c) || c.codePointAt(0) >= 160 ? c : "_",
    )
    .join("")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")}.html`;

/** The singular kind of each group's pages, for headings. */
const KINDS = {
  tutorials: "Tutorial",
  concepts: "Concept",
  "how-to": "How-to",
  guidelines: "Guideline",
  reference: "Reference",
};
/**
 * The documentation pages in reading order: `{ group, path, url }`, every
 * group of the site except the examples (which follow the API with their
 * source), without the index pages.
 */
const GUIDES = GROUPS.filter((g) => KINDS[g.folder]).flatMap((g) =>
  g.pages
    .filter((p) => p.file !== "index.md")
    .map((p) => {
      const path = `docs/${g.folder}/${p.file}`;
      return { group: g.title, path, url: pageUrl(path) };
    }),
);
const guideHeading = (path) =>
  `## ${KINDS[path.split("/")[1]]}: ${/^# (.+)$/m.exec(read(path))[1]}`;
const DROPPED_SECTIONS = ["Next", "See also", "API on this page"];

/**
 * A page as one `##` section; its own headings move two levels down, so they
 * never collide with the `###` declaration headings that llms.txt points at.
 */
function guide(path) {
  let text = plain(includeCode(read(path), inlineCode));
  for (const heading of DROPPED_SECTIONS) {
    const lines = text.split("\n");
    const start = lines.findIndex((l) => l === `## ${heading}`);
    if (start < 0) continue;
    let end = lines.findIndex((l, i) => i > start && /^#{1,2} /.test(l));
    if (end < 0) end = lines.length;
    lines.splice(start, end - start);
    text = lines.join("\n");
  }
  return demote(text.trim(), 2).replace(/^### .*$/m, guideHeading(path));
}

function exampleFiles(name) {
  const base = join(root, "examples", name);
  const walk = (dir) =>
    readdirSync(join(base, dir), { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
      .flatMap((item) => {
        const path = dir ? `${dir}/${item.name}` : item.name;
        if (item.isDirectory())
          return ["node_modules", "dist"].includes(item.name) ? [] : walk(path);
        return [path];
      });
  const order = (path) =>
    path === "manifest.json"
      ? "0"
      : path === "main.ts"
        ? "1"
        : path.startsWith("tests/")
          ? "4" + path
          : path.endsWith(".slint")
            ? "3" + path
            : "2" + path;
  return walk("")
    .filter(
      (path) =>
        LANG[extname(path)] && !["README.md", "package.json"].includes(path),
    )
    .sort((a, b) => order(a).localeCompare(order(b)));
}

function example(name) {
  const own = plain(read(`examples/${name}/README.md`))
    .replace(/^# .*\n+/, "")
    .replace(/\n## Files\n[\s\S]*?(?=\n## |$)/, "\n")
    .replace(/\n## Run it\n[\s\S]*?(?=\n## |$)/, "\n");
  const parts = [`### Example: ${name}`, "", demote(own.trim(), 2), ""];
  const walkthrough = `docs/examples/${name}.md`;
  if (existsSync(join(root, walkthrough))) {
    let notes = includeCode(read(walkthrough), (path, part) =>
      part
        ? `(code: \`${path.replace(`examples/${name}/`, "")}\`, part "${part}", below)`
        : `(code: \`${path.replace(`examples/${name}/`, "")}\`, below)`,
    );
    notes = plain(notes).replace(/^# .*\n+/m, "");
    for (const heading of [
      "Files",
      "The files",
      "What you'll build",
      "Run it",
      "Next",
      "See also",
    ])
      notes = notes.replace(
        new RegExp(`\\n## ${heading}\\n[\\s\\S]*?(?=\\n## |$)`),
        "\n",
      );
    parts.push("#### Walkthrough", "", demote(notes.trim(), 2), "");
  }
  for (const path of exampleFiles(name)) {
    const text = stripRegions(read(`examples/${name}/${path}`));
    parts.push(
      `#### examples/${name}/${path}`,
      "",
      fence(LANG[extname(path)], text),
      "",
    );
  }
  return parts.join("\n");
}

const full = [];
const anchors = new Map(); // heading → line number (1-based)
function emit(text) {
  for (const line of text.split("\n")) {
    if (/^#{2,3} /.test(line) && !anchors.has(line))
      anchors.set(line, full.length + 1);
    full.push(line);
  }
}

const title = `# ${pkg.name} ${pkg.version}: full reference`;
const summary = `> Everything needed to write a Vestra Player plugin (plugin API \`${API_VERSION}\`): the guides, every public declaration of \`@vestra-player/sdk\` and \`@vestra-player/sdk/testing\` with its documentation, and the complete source of the example plugins. Generated from the SDK's sources by scripts/llms.mjs; the short index is llms.txt.`;
emit([title, "", summary, ""].join("\n"));
emit(
  [
    "How to read this file: the declarations are TypeScript declaration files whose doc comments keep only the description and the tags @capability (the manifest capability a call needs), @player (the oldest player version), @param, @returns, @throws (`code` (throws | rejects) condition) and @deprecated. Examples and longer remarks are in the documentation site and in node_modules/@vestra-player/sdk/dist/**/*.d.ts. Only what is declared here exists; do not use other members.",
    "",
    `Limits: ${COMMAND_LIMITS.perPlugin} commands per plugin and ${COMMAND_LIMITS.total} in the player (\`limit\`); menu ids for the first path segment: ${MENU_IDS.map((id) => `\`@${id}\``).join(", ")}; manifest: ${manifestLimits()}.`,
    "",
  ].join("\n"),
);

for (const { path } of GUIDES) emit(guide(path) + "\n");

emit(`## API: @vestra-player/sdk\n`);
emit(
  plain(
    parseDoc(/\/\*\*[\s\S]*?\*\//.exec(read("src/index.ts"))[0]).description,
  ) + "\n",
);
for (const item of sdkExports) emit(declarationBlock(item));

emit(`## API: @vestra-player/sdk/testing\n`);
emit(
  parseDoc(/\/\*\*[\s\S]*?\*\//.exec(read("src/plugin/testing.ts"))[0])
    .description + "\n",
);
for (const item of testingExports) emit(declarationBlock(item));

emit(`## Internal types the API refers to\n`);
emit(
  "Not exported (do not import them); listed because public declarations use them.\n",
);
for (const item of internalExports) emit(declarationBlock(item));

emit("## Examples\n");
emit(
  plain(examplesReadme)
    .replace(/^# .*\n+/, "")
    .replace(/\n\| Example[\s\S]*?\n\n/, "\n") + "\n",
);
for (const name of exampleNames) emit(example(name));

const fullText =
  full
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd() + "\n";
// Line numbers are taken after blank lines are merged.
const fullLines = fullText.split("\n");
const lineOf = (heading) => {
  const index = fullLines.indexOf(heading);
  if (index < 0) fail(`llms-full.txt has no heading "${heading}"`);
  if (fullLines.lastIndexOf(heading) !== index)
    fail(`llms-full.txt has the heading "${heading}" twice`);
  return index + 1;
};
const rangeOf = (heading) => {
  const start = lineOf(heading);
  const level = /^#+/.exec(heading)[0].length;
  let end = fullLines.length;
  for (let i = start; i < fullLines.length; i++)
    if (
      new RegExp(`^#{1,${level}} `).test(fullLines[i]) &&
      !inFence(fullLines, i)
    ) {
      end = i;
      break;
    }
  return `L${start}–${end}`;
};

function manifestLimits() {
  const l = MANIFEST_LIMITS;
  return [
    `id ≤ ${l.idBytes} bytes`,
    `name, author ≤ ${l.name} characters`,
    `punchline ≤ ${l.punchline}`,
    `description ≤ ${l.description}`,
    `tags ≤ ${l.tags} of ≤ ${l.tag} characters`,
    `license ≤ ${l.license}`,
    `sourceUrl ≤ ${l.urlBytes} bytes`,
    `icon PNG or JPEG ≤ ${l.iconBytes / 1024} KB and ${l.iconSide} px per side`,
    `readme, changelog ≤ ${l.documentBytes / 1024} KB`,
  ].join(", ");
}

// ── llms.txt ────────────────────────────────────────────────────────────

const bullets = (text) =>
  text
    .split("\n")
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2));

const running = bullets(plain(section(gettingStarted, "How plugins run")));
const rules = bullets(plain(section(gettingStarted, "Rules for plugins")));
const layout = fences(section(gettingStarted, "Files"))[0].code;
const helloMain = read("examples/hello/main.ts").trimEnd();

const scopeStatement = statementsOf(
  join(root, "src/plugin/types.ts"),
  "Scope",
)[0];
const modules = scopeStatement.members
  .filter((m) => ts.isPropertySignature(m))
  .map((m) => {
    const names = [];
    const visit = (node) => {
      if (ts.isTypeReferenceNode(node)) names.push(node.typeName.getText());
      ts.forEachChild(node, visit);
    };
    visit(m.type);
    const unique = [...new Set(names)].filter((n) => anchors.has(`### ${n}`));
    return { name: m.name.getText(), types: unique };
  });

const fullUrl = `${SITE}llms-full.txt`;
const index = [
  `# Vestra Player SDK`,
  "",
  `> ${pkg.name} ${pkg.version}: write plugins for Vestra Player in TypeScript (plugin API \`${API_VERSION}\`). A plugin is a folder with \`manifest.json\` and an entry module whose default export \`activate(plugin)\` the player calls; it runs in its own Node.js process. ${running
    // Getting started, How plugins run: the process and activate are said above.
    .slice(2)
    .map(firstSentence)
    .join(
      " ",
    )} L<n> are line numbers in llms-full.txt, next to this file: every page, declaration and example.`,
  "",
  "**Rules**",
  "",
  ...rules.map((b) => {
    const match = /^(\*\*.+?\*\*)\s*(.*)$/.exec(b);
    return match ? `- ${match[1]} ${firstSentence(match[2])}` : `- ${b}`;
  }),
  "",
  "**Files**",
  "",
  "```text",
  layout,
  "```",
  "",
  "**manifest.json**",
  "",
  "```json",
  firstManifest.code,
  "```",
  "",
  `Fields: ${MANIFEST_FIELDS.map((f) => `\`${f}\``).join(", ")}; unknown fields and capabilities are rejected. Rules and limits: ${rangeOf("## Reference: Manifest")}.`,
  "",
  "**main.ts**",
  "",
  "```ts",
  helloMain,
  "```",
  "",
  "**Capabilities** (a call without one fails with `capability`)",
  "",
  ...capabilityRows.map(
    ([cap, opens, requires]) =>
      `- \`${cap}\`: ${compactMembers(opens)}${requires ? ` (also ${requires})` : ""}`,
  ),
  `- ${noCapability.replace(/^A member not in the table needs no capability:/, "No capability:").replace(/`plugin\./g, "`")} Details: ${rangeOf("## Reference: Capabilities")}.`,
  "",
  `**Test**: \`tests/*.test.ts\` with \`node:test\`, run by \`vestra-plugin test\`. \`startPlugin(activate, { directory: new URL("..", import.meta.url) })\` from \`@vestra-player/sdk/testing\` returns \`{ host, stop }\`; \`host\` is a TestHost (an in-memory player): \`host.setSource(…)\`, \`host.command(id).run()\`, \`host.press(key)\`, \`await host.settle()\`, then assert on \`host.osd\`, \`host.window(id).props\`… Guide: ${rangeOf("## How-to: Test a plugin")}; TestHost: L${lineOf("### TestHost")}.`,
  "",
  "**Command line**",
  "",
  ...cliRows.map(([command, does]) => `- ${command}: ${does}`),
  "- `vestra-player --plugin <dir>` runs a plugin from source, no build needed.",
  "",
  "**Error codes** (`error.code`; branch on it, never on `message`)",
  "",
  ...errorRows
    .filter(([codes]) => COMMON_ERRORS.some((c) => codes.includes(`\`${c}\``)))
    .map(([codes, meaning]) => `- ${codes}: ${shortMeaning(meaning)}`),
  `- Others: PluginError, llms-full.txt L${lineOf("### PluginError")}.`,
  "",
  "## Reference",
  "",
  `- [llms-full.txt](${fullUrl}), also node_modules/${pkg.name}/llms-full.txt; the pages are on the [site](${SITE}).`,
  ...[...new Set(GUIDES.map((g) => g.group))].map((group) => {
    const pages = GUIDES.filter((g) => g.group === group);
    return `- ${group}: ${pages
      .map(({ path }) => {
        const heading = guideHeading(path);
        return `${heading.slice(heading.indexOf(": ") + 2)} ${rangeOf(heading)}`;
      })
      .join("; ")}`;
  }),
  `- [API: @vestra-player/sdk](${SITE}modules/_vestra-player_sdk.html): ${rangeOf("## API: @vestra-player/sdk")}`,
  `- [API: @vestra-player/sdk/testing](${SITE}modules/_vestra-player_sdk_testing.html): ${rangeOf("## API: @vestra-player/sdk/testing")}`,
  "",
  "## API",
  "",
  "Where each module of `plugin` (`plugin.<module>`) is declared:",
  "",
  `- ${["Plugin", "Scope", "PluginError", "Disposable"].map((t) => `${t} L${lineOf(`### ${t}`)}`).join(", ")}`,
  "- " +
    modules
      .map(
        ({ name, types }) =>
          `${types.length === 1 && types[0].toLowerCase() === name.toLowerCase() ? "" : `${name}: `}${types.map((t) => `${t} L${lineOf(`### ${t}`)}`).join(", ")}`,
      )
      .join("; ") +
    ".",
  "",
  "## Examples",
  "",
  `Tested plugins in [examples/](${REPO}/tree/main/examples):`,
  "",
  ...exampleRows.map(([, shows], i) => {
    const name = exampleNames[i];
    return `- ${name}: ${shows} ${rangeOf(`### Example: ${name}`)}`;
  }),
  "",
  "## Optional",
  "",
  `- [Changelog](${REPO}/blob/main/CHANGELOG.md); full doc comments in dist/plugin/*.d.ts; Slint library in slint/vestra/.`,
  "",
].join("\n");

// ── Write or check ──────────────────────────────────────────────────────

const outputs = { "llms.txt": index, "llms-full.txt": fullText };
let stale = [];
for (const [name, text] of Object.entries(outputs)) {
  const path = join(root, name);
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (check) {
    if (current !== text) stale.push(name);
  } else if (current !== text) writeFileSync(path, text);
}
if (stale.length)
  fail(`${stale.join(" and ")} out of date: run \`npm run docs:llms\``);
if (Buffer.byteLength(index) > INDEX_LIMIT)
  fail(
    `llms.txt is ${Buffer.byteLength(index)} bytes, more than ${INDEX_LIMIT}: shorten it`,
  );
const kb = (text) => (Buffer.byteLength(text) / 1024).toFixed(1);
console.log(
  Object.entries(outputs)
    .map(
      ([name, text]) =>
        `${name}: ${kb(text)} KB, ${text.split("\n").length - 1} lines, ~${Math.round(Buffer.byteLength(text) / 4 / 100) / 10}k tokens${check ? ", current" : ""}`,
    )
    .join("\n"),
);
