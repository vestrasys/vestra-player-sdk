/**
 * `@vestra-player/sdk/docs`: the SDK's documentation as a tree of small
 * pages for agents, like `go doc`. The same pages and API as the
 * documentation site (https://vestrasys.github.io/vestra-player-sdk/),
 * read by path:
 *
 * ```text
 * docs("/")                            the top level
 * docs("/API/Media")                   a category: its symbols
 * docs("/API/Media/Snapshot/dispose")  a member: its whole documentation
 * docs("/Guides/How-to/Test a plugin") a guide page
 * searchDocs("snapshot export")        matching paths
 * ```
 *
 * Every answer is plain text (Markdown) of at most {@link DOCS_PAGE_BYTES}
 * bytes; a longer one comes in pages (`{ page: 2 }`). The command line
 * gives the same answers: `vestra-plugin docs [path] [--page N]` and
 * `vestra-plugin docs --search <query>` (outside a project that depends on
 * the SDK: `npx -p @vestra-player/sdk vestra-plugin docs …`). The tree is
 * generated from the package's sources when it is built
 * (scripts/docs-tree.mjs) and read on first use.
 *
 * @packageDocumentation
 * @module @vestra-player/sdk/docs
 */
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

/**
 * The most bytes (UTF-8) one answer of `docs` or `searchDocs` has.
 *
 * @category Docs
 */
export const DOCS_PAGE_BYTES = 8192;

/**
 * Which page of a long answer to return.
 *
 * @category Docs
 */
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
/** The kinds that are not declarations of the API. */
const STRUCTURE = new Set(["Root", "Section", "Group", "Page", "Category"]);
const isDeclaration = (node: DocNode) => !STRUCTURE.has(node.kind);
const depth = (node: DocNode) => node.path.split("/").length;

/** How a node's name matches a segment: 0 exact, 1 another case or an alias, 2 loosely, or no match. */
function nameMatch(node: DocNode, segment: string): number | undefined {
  if (node.name === segment || node.aliases.includes(segment)) return 0;
  const lower = segment.toLowerCase();
  if (
    node.name.toLowerCase() === lower ||
    node.aliases.some((alias) => alias.toLowerCase() === lower)
  )
    return 1;
  const flat = loose(segment);
  if (
    flat &&
    (loose(node.name) === flat ||
      node.aliases.some((alias) => loose(alias) === flat))
  )
    return 2;
  return undefined;
}

/** Every node below `node` (any depth) whose name matches `segment`. */
function below(node: DocNode, segment: string): DocNode[] {
  const found: DocNode[] = [];
  const visit = (each: DocNode) => {
    for (const child of each.children) {
      if (nameMatch(child, segment) !== undefined) found.push(child);
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

/** A path as typed: its segments and `#anchor`. */
function parse(path: string): { segments: string[]; anchor?: string } {
  let text = path.trim().replace(/^["'<]+|["'>]+$/g, "");
  try {
    text = decodeURIComponent(text);
  } catch {
    // Not URI-encoded.
  }
  text = text.replace(/\\/g, "/");
  // Git Bash turns "/API" into "C:/Program Files/Git/API".
  text = text.replace(/^[A-Za-z]:\/(?:[^/]*\/)*?Git\//, "/");
  const hash = text.indexOf("#");
  const anchor = hash >= 0 ? text.slice(hash + 1).trim() : undefined;
  if (hash >= 0) text = text.slice(0, hash);
  const segments = text
    .split("/")
    .map((segment) => segment.trim().replace(/\.md$/i, ""))
    .filter(Boolean);
  return anchor ? { segments, anchor } : { segments };
}

/** A resolution of a whole path, with what made it less certain. */
interface Resolution {
  node: DocNode;
  /** Segments found below their level instead of at it. */
  jumps: number;
  /** Segments matched in another case or loosely. */
  inexact: number;
  /** Segments left out (a stale one). */
  dropped: number;
}

/** Every node the whole of `segments` can lead to from `node`. */
function resolveAll(
  node: DocNode,
  segments: string[],
  start: Resolution,
): Resolution[] {
  if (!segments.length) return [{ ...start, node }];
  const [segment, ...rest] = segments as [string, ...string[]];
  const out: Resolution[] = [];
  const direct = node.children.filter(
    (child) => nameMatch(child, segment) !== undefined,
  );
  for (const child of direct)
    out.push(
      ...resolveAll(child, rest, {
        ...start,
        inexact: start.inexact + (nameMatch(child, segment) ? 1 : 0),
      }),
    );
  for (const child of below(node, segment))
    if (!direct.includes(child))
      out.push(
        ...resolveAll(child, rest, {
          ...start,
          jumps: start.jumps + 1,
          inexact: start.inexact + (nameMatch(child, segment) ? 1 : 0),
        }),
      );
  return out;
}

const rank = (r: Resolution) => [
  r.dropped,
  r.jumps,
  r.inexact,
  isDeclaration(r.node) ? 0 : 1,
  depth(r.node),
];
function compare(a: Resolution, b: Resolution) {
  const x = rank(a);
  const y = rank(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

/**
 * The node a path names: at each level a direct child first, else a name
 * below it; `.` like `/` when `/` alone finds nothing; then one stale
 * segment left out. The best resolution wins (fewest left out, fewest
 * found below their level, exact names, declarations, shallowest);
 * `ambiguous` when several tie.
 */
function resolve(
  segments: string[],
): { node: DocNode; jumped: boolean } | { ambiguous: DocNode[] } | undefined {
  const { root } = tree();
  const none: Resolution = { node: root, jumps: 0, inexact: 0, dropped: 0 };
  if (!segments.length) return { node: root, jumped: false };
  const attempts = [segments];
  const dotted = segments.flatMap((segment) =>
    segment.split(".").filter(Boolean),
  );
  if (dotted.length !== segments.length) attempts.push(dotted);
  let found: Resolution[] = [];
  for (const attempt of attempts) {
    found = resolveAll(root, attempt, none);
    if (found.length) break;
  }
  if (!found.length)
    for (const attempt of attempts) {
      for (let i = 0; i < attempt.length - 1 && attempt.length > 1; i++)
        found.push(
          ...resolveAll(
            root,
            attempt.filter((_, j) => j !== i),
            { ...none, dropped: 1 },
          ),
        );
      if (found.length) break;
    }
  if (!found.length) return undefined;
  // One entry per node, with its best resolution.
  const best = new Map<DocNode, Resolution>();
  for (const each of found) {
    const known = best.get(each.node);
    if (!known || compare(each, known) < 0) best.set(each.node, each);
  }
  const sorted = [...best.values()].sort(compare);
  const first = sorted[0]!;
  const tied = sorted.filter((each) => compare(each, first) === 0);
  if (tied.length > 1) return { ambiguous: tied.map((each) => each.node) };
  return {
    node: first.node,
    jumped: first.jumps > 0 || first.dropped > 0,
  };
}

const line = (node: DocNode) =>
  `- ${node.path} (${node.kind.toLowerCase()})${node.summary ? `: ${node.summary}` : ""}`;

/** GitHub's anchor of a heading: "Acting like the user" → "acting-like-the-user". */
const slug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");

const FENCE = /^\s*```/;
const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

/**
 * Lines into pages: the first at most `first` bytes, the others `rest`.
 * A code fence cut by a page break is closed and opened again; a table's
 * header rows are repeated; a short code block moves to the next page
 * whole instead of being cut.
 */
function paginate(text: string, first: number, rest: number): string[] {
  const lines = text.split("\n");
  const pages: string[] = [];
  let current: string[] = [];
  let size = 0;
  let fence: string | undefined;
  let header: string[] | undefined;
  const reserve = 16;
  const budget = () => (pages.length ? rest : first) - reserve;
  const push = (piece: string) => {
    current.push(piece);
    size += bytes(piece) + 1;
  };
  const flush = () => {
    if (!current.length) return;
    if (fence) current.push("```");
    pages.push(current.join("\n"));
    current = [];
    size = 0;
    if (fence) push(fence);
    if (header) header.forEach(push);
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!fence && FENCE.test(raw)) {
      // A short block whole on the next page rather than cut.
      let end = i + 1;
      while (end < lines.length && !FENCE.test(lines[end]!)) end++;
      const block = bytes(lines.slice(i, end + 1).join("\n")) + 1;
      if (block <= rest / 3 && size + block > budget()) flush();
    }
    if (!fence && raw.trimStart().startsWith("|")) {
      if (!header && TABLE_RULE.test(lines[i + 1] ?? "")) {
        if (size + bytes(raw) + bytes(lines[i + 1]!) + 2 > budget()) flush();
        push(raw);
        push(lines[i + 1]!);
        header = [raw, lines[i + 1]!];
        i++;
        continue;
      }
    } else if (!fence) header = undefined;
    // A line longer than a page is cut.
    const limit = rest - reserve - 2 * bytes(fence ?? "") - 16;
    let piece = raw;
    const pieces: string[] = [];
    while (bytes(piece) > limit) {
      let cut = Math.min(piece.length, limit);
      while (bytes(piece.slice(0, cut)) > limit) cut = Math.floor(cut * 0.9);
      pieces.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    pieces.push(piece);
    for (const each of pieces) {
      const cost = bytes(each) + 1 + (fence ? 4 : 0);
      if (size + cost > budget() && current.length) flush();
      push(each);
    }
    if (FENCE.test(raw)) fence = fence ? undefined : raw.trim();
  }
  if (current.length) {
    if (fence) current.push("```");
    pages.push(current.join("\n"));
  }
  return pages.length ? pages : [""];
}

/** The `##` headings of a text, outside code. */
function headings(text: string, level: number) {
  const out: string[] = [];
  let fence = false;
  for (const each of text.split("\n")) {
    if (FENCE.test(each)) fence = !fence;
    const match = /^(#{1,6}) (.+)$/.exec(each);
    if (!fence && match && match[1]!.length <= level) out.push(each);
  }
  return out;
}

/** The page asked for, with its header, a section index on page 1 and a continuation line. */
function answer(
  header: string,
  body: string,
  options: { page?: number; anchor?: string },
  more: (next: number) => string,
): string {
  const longest = `${header} · page 9999 of 9999`;
  const footer = `\n\n(Page 9999 of 9999. ${more(9999)})`;
  const budget = DOCS_PAGE_BYTES - bytes(longest) - bytes(footer) - 4;
  let pages = paginate(body, budget, budget);
  let index = "";
  if (pages.length > 1) {
    // Page 1 lists the sections and the page each starts on.
    const sections = headings(body, 2)
      .filter((each) => each.startsWith("## "))
      .slice(0, 40);
    if (sections.length) {
      const draft = `Sections: ${sections.map((each) => `${each.slice(3)} (p. 99)`).join(" · ")}`;
      pages = paginate(body, budget - bytes(draft) - 2, budget);
      const where = (heading: string) =>
        pages.findIndex((page) => page.split("\n").includes(heading)) + 1;
      index = `Sections: ${sections.map((each) => `${each.slice(3)} (p. ${where(each)})`).join(" · ")}\n\n`;
    }
  }
  const count = pages.length;
  let wanted = options.page;
  let note = "";
  if (wanted === undefined && options.anchor) {
    const target = slug(options.anchor);
    const found = pages.findIndex((page) =>
      headings(page, 6).some(
        (each) => slug(each.replace(/^#+ /, "")) === target,
      ),
    );
    if (found >= 0) wanted = found + 1;
    else note = `(No section #${options.anchor} here.)\n\n`;
  }
  wanted ??= 1;
  if (!Number.isInteger(wanted) || wanted < 1 || wanted > count)
    return `${header}\n\nThere is no page ${String(options.page)}: this has ${count} page${count === 1 ? "" : "s"}.`;
  const top = count > 1 ? `${header} · page ${wanted} of ${count}` : header;
  const tail =
    wanted < count
      ? `\n\n(Page ${wanted} of ${count}. ${more(wanted + 1)})`
      : "";
  const lead = `${note}${wanted === 1 ? index : ""}`;
  return `${top}\n\n${lead}${pages[wanted - 1]}${tail}`;
}

function show(
  node: DocNode,
  options: { page?: number; anchor?: string },
  note?: string,
) {
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
    options,
    (next) => `Read on with page ${next} of ${node.path}.`,
  );
}

/** The deepest node the path reaches level by level, and the segment it stops at. */
function reach(segments: string[]) {
  let node = tree().root;
  for (const segment of segments) {
    const next = node.children
      .filter((child) => nameMatch(child, segment) !== undefined)
      .sort((a, b) => nameMatch(a, segment)! - nameMatch(b, segment)!)[0];
    if (!next) return { node, missing: segment };
    node = next;
  }
  return { node, missing: segments.at(-1) ?? "" };
}

function notFound(asked: string, segments: string[], page: number | undefined) {
  const { node: found, missing } = reach(segments);
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
  const elsewhere = below(tree().root, missing)
    .filter((node) => !near.includes(node))
    .sort((a, b) => depth(a) - depth(b));
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
    `Not found: ${asked}`,
    parts.join("\n\n"),
    page === undefined ? {} : { page },
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
 * and punctuation; a leading `/` and a `.md` suffix are optional; `.`
 * works like `/` (`Snapshot.export`); a name that is not at its level is
 * looked up below it (`TestHost`, `/API/Snapshot` finds
 * `/API/Media/Snapshot`), and one stale segment is skipped. A `#heading`
 * opens the page of a long answer that has it. A path that matches
 * nothing answers with the nearest names and the level's contents.
 *
 * @param path - Default `/`.
 * @param options - `page` of a long answer.
 * @returns At most {@link DOCS_PAGE_BYTES} bytes of text; a continued
 *   answer ends with the number of the next page.
 *
 * @category Docs
 */
export function docs(path = "/", options: DocsOptions = {}): string {
  const { segments, anchor } = parse(path);
  const asked = `/${segments.join("/")}${anchor ? `#${anchor}` : ""}`;
  const found = resolve(segments);
  const wanted = {
    ...(options.page === undefined ? {} : { page: options.page }),
    ...(anchor === undefined ? {} : { anchor }),
  };
  if (!found) return notFound(asked, segments, options.page);
  if ("ambiguous" in found)
    return answer(
      `Several matches: ${asked}`,
      `Name the one you mean:\n\n${found.ambiguous.map(line).join("\n")}`,
      options.page === undefined ? {} : { page: options.page },
      (next) => `Read on with page ${next} of the same request.`,
    );
  return show(
    found.node,
    wanted,
    found.jumped ? `(Found ${asked} at ${found.node.path}.)` : undefined,
  );
}

/** Words a search leaves out (unless the query has nothing else). */
const STOP_WORDS = new Set(
  "a an and are as at be by can do does for from how i in is it its my of on or the this to what when which with you your".split(
    " ",
  ),
);

/**
 * Search the documentation by name and text: the matching paths, best
 * first, each with its one-line summary. Every word of `query` (common
 * words such as "a", "the", "to" left out) must occur, in any case, in
 * the path, the summary or the text; a match in a name ranks first, a
 * declaration's name before a page's.
 *
 * @param query - Words, such as `"snapshot export"` or `"onError"`.
 * @param options - `page` of a long answer.
 * @returns At most {@link DOCS_PAGE_BYTES} bytes of text.
 *
 * @category Docs
 */
export function searchDocs(query: string, options: DocsOptions = {}): string {
  const { nodes } = tree();
  const all = query
    .toLowerCase()
    .split(/[\s/.]+/)
    .filter(Boolean);
  const meaningful = all.filter((word) => !STOP_WORDS.has(word));
  const words = meaningful.length ? meaningful : all;
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
    const declaration = isDeclaration(node);
    let score = lower.name === whole ? 200 : 0;
    // A type of the API (an interface, a class…) before its members, and
    // a path that names every word (Snapshot/export for "snapshot export").
    if (declaration && depth(node) === 4) score += 20;
    if (words.length > 1 && words.every((word) => lower.path.includes(word)))
      score += 40;
    for (const word of words) {
      if (lower.name === word) score += declaration ? 140 : 100;
      else if (lower.name.includes(word)) score += declaration ? 70 : 50;
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
      depth(a.node) - depth(b.node) ||
      a.node.path.localeCompare(b.node.path),
  );
  if (!scored.length)
    return `${header}\n\nNothing matches. Try fewer or other words, or browse with docs("/").`;
  const left = all.length - words.length;
  const body = `${scored.length} match${scored.length === 1 ? "" : "es"}, best first${left ? ` (common words left out: ${all.filter((word) => !words.includes(word)).join(", ")})` : ""}:\n\n${scored.map(({ node }) => line(node)).join("\n")}`;
  return answer(
    header,
    body,
    options.page === undefined ? {} : { page: options.page },
    (next) => `Read on with page ${next} of this search.`,
  );
}
