/**
 * `@vestra-player/sdk/docs`: the SDK's documentation as a tree of small
 * pages for agents, like `go doc`. The same pages and API as the
 * documentation site (https://vestrasys.github.io/vestra-player-sdk/),
 * read by path:
 *
 *   docs("/")                            the top level
 *   docs("/API/Media")                   a category: its symbols
 *   docs("/API/Media/Snapshot/dispose")  a member: its whole documentation
 *   docs("/Guides/How-to/Test a plugin") a guide page
 *   searchDocs("snapshot export")        matching paths
 *
 * Every answer is plain text (Markdown) of at most {@link DOCS_PAGE_BYTES}
 * bytes; a longer one comes in pages (`{ page: 2 }`). The command line
 * gives the same answers: `vestra-plugin docs [path] [--page N]` and
 * `vestra-plugin docs --search <query>`. The tree is generated from the
 * package's sources when it is built (scripts/docs-tree.mjs) and read on
 * first use.
 *
 * @packageDocumentation
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/** The most bytes (UTF-8) one answer of `docs` or `searchDocs` has. */
export const DOCS_PAGE_BYTES = 8192;

/** Which page of a long answer to return. */
export interface DocsOptions {
  /** 1-based; the default is 1. */
  page?: number;
}

interface StoredNode {
  /** Name: the path segment. */
  n: string;
  /** Kind: "Page", "Interface", "Method"… */
  k: string;
  /** One-line summary. */
  s: string;
  /** Text (Markdown). */
  t: string;
  /** Child indexes. */
  c?: number[];
  /** TypeDoc full name, or `doc:<folder>/<file>`. */
  i?: string;
  /** Other names the path segment may use (a guide page's file name). */
  a?: string[];
}

interface DocNode {
  name: string;
  kind: string;
  summary: string;
  text: string;
  path: string;
  id: string | undefined;
  aliases: string[];
  parent: DocNode | undefined;
  children: DocNode[];
  /** Lower-cased name, path, summary and text, for search. */
  lower?: { name: string; path: string; summary: string; text: string };
}

interface Tree {
  version: string;
  root: DocNode;
  nodes: DocNode[];
}

let loaded: Tree | undefined;

/** The tree in dist/ (the same path from src/ and from dist/). */
function tree(): Tree {
  if (loaded) return loaded;
  const file = new URL("../dist/docs-tree.json.gz", import.meta.url);
  let data: { version: string; nodes: StoredNode[] };
  try {
    data = JSON.parse(gunzipSync(readFileSync(file)).toString("utf8"));
  } catch (error) {
    throw new Error(
      `the documentation tree is missing (${file.pathname}): build the SDK with npm run build`,
      { cause: error },
    );
  }
  const nodes: DocNode[] = data.nodes.map((stored) => ({
    name: stored.n,
    kind: stored.k,
    summary: stored.s,
    text: stored.t,
    path: "/",
    id: stored.i,
    aliases: stored.a ?? [],
    parent: undefined,
    children: [],
  }));
  data.nodes.forEach((stored, index) => {
    const node = nodes[index]!;
    for (const child of stored.c ?? []) {
      const made = nodes[child]!;
      made.parent = node;
      node.children.push(made);
    }
  });
  const assign = (node: DocNode) => {
    for (const child of node.children) {
      child.path = `${node.path === "/" ? "" : node.path}/${child.name}`;
      assign(child);
    }
  };
  const root = nodes[0]!;
  assign(root);
  loaded = { version: data.version, root, nodes };
  return loaded;
}

const bytes = (text: string) => Buffer.byteLength(text, "utf8");
/** Letters and digits only, lower case: "Test a plugin" → "testaplugin". */
const loose = (text: string) =>
  text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

function matches(node: DocNode, segment: string): DocNode | undefined {
  const lower = segment.toLowerCase();
  const flat = loose(segment);
  return (
    node.children.find((child) => child.name === segment) ??
    node.children.find((child) => child.name.toLowerCase() === lower) ??
    node.children.find((child) =>
      child.aliases.some((alias) => alias.toLowerCase() === lower),
    ) ??
    (flat
      ? node.children.find(
          (child) =>
            loose(child.name) === flat ||
            child.aliases.some((alias) => loose(alias) === flat),
        )
      : undefined)
  );
}

/** Every node below `node` whose name is `segment` (any case). */
function below(node: DocNode, segment: string): DocNode[] {
  const flat = loose(segment);
  const found: DocNode[] = [];
  const visit = (each: DocNode) => {
    for (const child of each.children) {
      if (
        child.name.toLowerCase() === segment.toLowerCase() ||
        (flat && loose(child.name) === flat)
      )
        found.push(child);
      visit(child);
    }
  };
  visit(node);
  return found;
}

/** Edit distance, for "did you mean". */
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const current = row[j]!;
      row[j] = Math.min(
        row[j]! + 1,
        row[j - 1]! + 1,
        previous + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      previous = current;
    }
  }
  return row[b.length]!;
}

/** A path as typed: quotes, backslashes, a shell's added prefix removed. */
function segments(path: string): string[] {
  let text = path.trim().replace(/^["']|["']$/g, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Not URI-encoded.
  }
  text = text.replace(/\\/g, "/");
  // Git Bash turns "/API" into "C:/Program Files/Git/API".
  text = text.replace(/^[A-Za-z]:\/(?:.*\/)?Git\//, "/");
  text = text.split("#")[0]!;
  return text
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
}

const line = (node: DocNode) =>
  `- ${node.path} (${node.kind.toLowerCase()})${node.summary ? `: ${node.summary}` : ""}`;

/** Lines into pages of at most `budget` bytes; code fences are closed and reopened. */
function paginate(text: string, budget: number): string[] {
  const pages: string[] = [];
  let current: string[] = [];
  let size = 0;
  let fence: string | undefined;
  const reserve = 16;
  const flush = () => {
    if (!current.length) return;
    if (fence) current.push("```");
    pages.push(current.join("\n"));
    current = fence ? [fence] : [];
    size = fence ? bytes(fence) + 1 : 0;
  };
  for (const raw of text.split("\n")) {
    // A line longer than a page is cut.
    const pieces: string[] = [];
    let rest = raw;
    const limit = budget - reserve - 2 * (fence ? bytes(fence) : 0) - 8;
    while (bytes(rest) > limit) {
      let cut = Math.min(rest.length, limit);
      while (bytes(rest.slice(0, cut)) > limit) cut = Math.floor(cut * 0.9);
      pieces.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    pieces.push(rest);
    for (const piece of pieces) {
      const cost = bytes(piece) + 1;
      if (size + cost + (fence ? 4 : 0) > budget - reserve && current.length)
        flush();
      current.push(piece);
      size += cost;
    }
    if (/^\s*```/.test(raw)) fence = fence ? undefined : raw.trim();
  }
  if (current.length) {
    if (fence) current.push("```");
    pages.push(current.join("\n"));
  }
  return pages.length ? pages : [""];
}

/** The page asked for, with its header and a continuation line. */
function answer(
  header: string,
  body: string,
  page: number | undefined,
  more: (next: number) => string,
): string {
  const longest = `${header} · page 9999 of 9999`;
  const footer = `\n\n(Page 9999 of 9999. ${more(9999)})`;
  const budget = DOCS_PAGE_BYTES - bytes(longest) - bytes(footer) - 4;
  const pages = paginate(body, budget);
  const wanted = page ?? 1;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > pages.length)
    return `${header}\n\nThere is no page ${String(page)}: this has ${pages.length} page${pages.length === 1 ? "" : "s"}.`;
  const count = pages.length;
  const top = count > 1 ? `${header} · page ${wanted} of ${count}` : header;
  const tail =
    wanted < count
      ? `\n\n(Page ${wanted} of ${count}. ${more(wanted + 1)})`
      : "";
  return `${top}\n\n${pages[wanted - 1]}${tail}`;
}

function show(node: DocNode, page: number | undefined, note?: string) {
  const { version } = tree();
  const header =
    node.path === "/"
      ? `/ · Vestra Player SDK ${version} documentation`
      : `${node.path} · ${node.kind}`;
  const parts: string[] = [];
  if (note) parts.push(note);
  const contents = node.children.length
    ? `## Contents of ${node.path}\n\n${node.children.map(line).join("\n")}`
    : "";
  // A guide group's index page describes the pages listed: the list first.
  if (node.kind === "Group") parts.push(contents, node.text);
  else parts.push(node.text, contents);
  return answer(
    header,
    parts.filter(Boolean).join("\n\n"),
    page,
    (next) => `Read on with page ${next} of ${node.path}.`,
  );
}

function notFound(
  path: string,
  found: DocNode,
  missing: string,
  page: number | undefined,
) {
  const flat = loose(missing);
  const near = found.children
    .map((child) => ({
      child,
      score: Math.min(
        distance(loose(child.name), flat),
        ...child.aliases.map((alias) => distance(loose(alias), flat)),
      ),
    }))
    .filter(
      ({ child, score }) =>
        score <= Math.max(2, Math.floor(flat.length / 3)) ||
        loose(child.name).includes(flat) ||
        (flat.length >= 3 && flat.includes(loose(child.name))),
    )
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map(({ child }) => child);
  const elsewhere = below(tree().root, missing).filter(
    (node) => !near.includes(node),
  );
  const parts = [`${found.path} has no "${missing}".`];
  const suggestions = [...near, ...elsewhere].slice(0, 10);
  if (suggestions.length)
    parts.push(`Did you mean:\n\n${suggestions.map(line).join("\n")}`);
  parts.push(
    found.children.length
      ? `## Contents of ${found.path}\n\n${found.children.map(line).join("\n")}`
      : `${found.path} has nothing below it. Search with searchDocs("${missing}") or vestra-plugin docs --search "${missing}".`,
  );
  return answer(
    `Not found: ${path}`,
    parts.join("\n\n"),
    page,
    (next) => `Read on with page ${next} of the same request.`,
  );
}

/**
 * The documentation at `path`: its text, then the paths one level down,
 * each with a one-line summary.
 *
 * `/` lists Overview, Guides and API. `/Guides/<group>/<page title>` is a
 * page of the documentation site (its file name works too:
 * `/Guides/How-to/testing`); `/API/<category>/<symbol>/<member>` is a
 * declaration with its signature, parameters, return value, errors,
 * capability, player version and examples. Matching ignores case, spaces
 * and punctuation; a leading `/` is optional; a name that is not at that
 * level is looked up below it (`/API/Snapshot` finds
 * `/API/Media/Snapshot`). A path that matches nothing answers with the
 * nearest names and the level's contents.
 *
 * @param path - Default `/`.
 * @param options - `page` of a long answer.
 * @returns At most {@link DOCS_PAGE_BYTES} bytes of text; a continued
 *   answer ends with the number of the next page.
 */
export function docs(path = "/", options: DocsOptions = {}): string {
  const { root } = tree();
  let node = root;
  let jumped = false;
  const parts = segments(path);
  const asked = `/${parts.join("/")}`;
  for (const segment of parts) {
    const next = matches(node, segment);
    if (next) {
      node = next;
      continue;
    }
    // Not at this level: the one shallowest match below it.
    const deeper = below(node, segment);
    const depth = Math.min(
      ...deeper.map((each) => each.path.split("/").length),
    );
    const nearest = deeper.filter(
      (each) => each.path.split("/").length === depth,
    );
    if (nearest.length === 1) {
      node = nearest[0]!;
      jumped = true;
      continue;
    }
    return notFound(asked, node, segment, options.page);
  }
  return show(
    node,
    options.page,
    jumped ? `(Found ${asked} at ${node.path}.)` : undefined,
  );
}

/**
 * Search the documentation by name and text: the matching paths, best
 * first, each with its one-line summary. Every word of `query` must occur
 * (any case) in the path, the summary or the text; a match in a name
 * ranks first.
 *
 * @param query - Words, such as `"snapshot export"` or `"onError"`.
 * @param options - `page` of a long answer.
 * @returns At most {@link DOCS_PAGE_BYTES} bytes of text.
 */
export function searchDocs(query: string, options: DocsOptions = {}): string {
  const { nodes } = tree();
  const words = query
    .toLowerCase()
    .split(/[\s/]+/)
    .filter(Boolean);
  const header = `Search: ${query}`;
  if (!words.length)
    return `${header}\n\nGive one or more words to search for.`;
  const whole = query.trim().toLowerCase();
  const scored: { node: DocNode; score: number }[] = [];
  for (const node of nodes) {
    if (!node.parent) continue;
    const lower = (node.lower ??= {
      name: node.name.toLowerCase(),
      path: node.path.toLowerCase(),
      summary: node.summary.toLowerCase(),
      text: node.text.toLowerCase(),
    });
    let score = lower.name === whole ? 200 : 0;
    for (const word of words) {
      if (lower.name === word) score += 100;
      else if (lower.name.includes(word)) score += 50;
      else if (lower.path.includes(word)) score += 30;
      else if (lower.summary.includes(word)) score += 15;
      else if (lower.text.includes(word)) score += 5;
      else {
        score = -1;
        break;
      }
    }
    if (score > 0) scored.push({ node, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.node.path.split("/").length - b.node.path.split("/").length ||
      a.node.path.localeCompare(b.node.path),
  );
  if (!scored.length)
    return `${header}\n\nNothing matches. Try fewer or other words, or browse with docs("/").`;
  const body = `${scored.length} match${scored.length === 1 ? "" : "es"}, best first:\n\n${scored.map(({ node }) => line(node)).join("\n")}`;
  return answer(
    header,
    body,
    options.page,
    (next) => `Read on with page ${next} of this search.`,
  );
}
