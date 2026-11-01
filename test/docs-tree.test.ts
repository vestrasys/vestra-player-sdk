// The documentation tree for agents (src/docs.ts, scripts/docs-tree.mjs,
// `vestra-plugin docs`): paths at every level, suggestions, search, pages,
// the size bound, and that it holds everything the documentation site does.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { ReflectionKind } from "typedoc";
import type { DeclarationReflection, Reflection } from "typedoc";
import { DOCS_PAGE_BYTES, docs, searchDocs } from "../src/docs.ts";

// Build scripts without declarations.
const { convertProject } = (await import(
  new URL("../scripts/docs-tree.mjs", import.meta.url).href
)) as {
  convertProject: () => Promise<import("typedoc").ProjectReflection>;
};
const { GROUPS } = (await import(
  new URL("../scripts/doc-structure.mjs", import.meta.url).href
)) as { GROUPS: { title: string }[] };
const bytes = (text: string) => Buffer.byteLength(text, "utf8");
const lines = (text: string) => text.split("\n");
const stored = JSON.parse(
  gunzipSync(
    readFileSync(new URL("../dist/docs-tree.json.gz", import.meta.url)),
  ).toString("utf8"),
) as {
  version: string;
  nodes: {
    n: string;
    k: string;
    s: string;
    t: string;
    c?: number[];
    i?: string;
  }[];
};
/** Every path of the tree, depth first. */
function allPaths() {
  const out: string[] = [];
  const walk = (index: number, path: string) => {
    out.push(path);
    for (const child of stored.nodes[index]!.c ?? [])
      walk(child, `${path === "/" ? "" : path}/${stored.nodes[child]!.n}`);
  };
  walk(0, "/");
  return out;
}
/** Every page of an answer. */
function pages(read: (page: number) => string) {
  const out = [read(1)];
  for (let match; (match = /\(Page (\d+) of (\d+)\./.exec(out.at(-1)!));)
    out.push(read(Number(match[1]) + 1));
  return out;
}

test("the tree is the package's version", () => {
  const pkg = JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );
  assert.equal(stored.version, pkg.version);
});

test("/ lists Overview, Guides and API with their summaries", () => {
  const root = docs("/");
  assert.match(root, /^\/ · Vestra Player SDK \d+\.\d+\.\d+ documentation/);
  for (const path of ["/Overview", "/Guides", "/API"])
    assert.ok(
      lines(root).some(
        (line) => /^- \S.*: \S/.test(line) && line.startsWith(`- ${path} (`),
      ),
      path,
    );
  assert.equal(docs(""), root);
  assert.equal(docs(), root);
});

test("/Guides lists the site's groups in its order; a group lists its pages", () => {
  const guides = docs("/Guides");
  const listed = lines(guides)
    .filter((line) => line.startsWith("- /Guides/"))
    .map((line) => /^- \/Guides\/(.+?) \(/.exec(line)![1]);
  assert.deepEqual(
    listed,
    GROUPS.map((group) => group.title),
  );
  const howTo = docs("/Guides/How-to");
  assert.match(howTo, /^\/Guides\/How-to · Group/);
  assert.match(
    howTo,
    /^- \/Guides\/How-to\/Test a plugin \(page\): Test a plugin without the player/m,
  );
});

test("a guide page by title, by file name and in any case", () => {
  const page = docs("/Guides/How-to/Test a plugin");
  assert.match(
    page,
    /^\/Guides\/How-to\/Test a plugin · Page\n\n# Test a plugin/,
  );
  assert.match(page, /\*\*Goal:\*\*/);
  assert.equal(docs("guides/how-to/testing"), page);
  assert.equal(docs("/GUIDES/HOW-TO/test-a-plugin/"), page);
  // Links between pages are paths of the tree.
  assert.match(page, /\]\(\/Guides\/Reference\/Test host#/);
});

test("/API lists both entry points' categories; a category lists its symbols", () => {
  const api = docs("/API");
  assert.match(api, /## @vestra-player\/sdk\n/);
  assert.match(api, /## @vestra-player\/sdk\/testing\n/);
  assert.match(api, /^- \/API\/Media \(category\): /m);
  assert.match(api, /^- \/API\/Testing \(category\): /m);
  const media = docs("/API/Media");
  assert.match(media, /^\/API\/Media · Category/);
  assert.match(
    media,
    /^- \/API\/Media\/Snapshot \(interface\): A frozen, immutable input for exports\./m,
  );
});

test("a symbol shows its import, declaration, description and members", () => {
  const snapshot = docs("/API/Media/Snapshot");
  assert.match(snapshot, /^\/API\/Media\/Snapshot · Interface/);
  assert.match(
    snapshot,
    /import type \{ Snapshot \} from "@vestra-player\/sdk";/,
  );
  assert.match(snapshot, /```ts\ninterface Snapshot extends Disposable\n```/);
  assert.match(snapshot, /^- \/API\/Media\/Snapshot\/dispose \(method\): /m);
  assert.match(snapshot, /^- \/API\/Media\/Snapshot\/export \(method\): /m);
  const host = docs("/API/Testing/TestHost");
  assert.match(
    host,
    /import \{ TestHost \} from "@vestra-player\/sdk\/testing";/,
  );
});

test("a member shows its signature, parameters, returns, errors, capability, version and examples", () => {
  const dispose = docs("/API/Media/Snapshot/dispose");
  assert.match(dispose, /^\/API\/Media\/Snapshot\/dispose · Method/);
  assert.match(dispose, /```ts\ndispose\(\): Promise<void>\n```/);
  assert.match(
    dispose,
    /Inherited from \[Disposable\.dispose\]\(\/API\/Plugin\/Disposable\/dispose\)/,
  );
  assert.match(dispose, /\*\*Throws\*\*\n\n- Never\./);
  assert.match(dispose, /\*\*Capability:\*\* /);
  assert.match(dispose, /\*\*Since:\*\* 1\.0\.0/);
  assert.match(
    dispose,
    /### Example: Remove a command when its feature is turned off/,
  );
  const setOutput = docs("/API/Playback/Player/setOutput");
  assert.match(
    setOutput,
    /\*\*Parameters\*\*\n\n- `output`\n {2}- `volume\?: number`/,
  );
  assert.match(setOutput, /- `invalid` \(rejects\)/);
  // The minimum player version (@player).
  const withPlayer = stored.nodes.find((node) =>
    node.t.includes("**Player version"),
  );
  assert.ok(withPlayer, "no node shows a player version");
  // Returns (@returns), with a link in the tree's paths.
  assert.match(docs("/API/Testing/startPlugin"), /\*\*Returns\*\* `/);
});

test("a path that matches nothing suggests the nearest names and lists the level", () => {
  const missing = docs("/API/Medai");
  assert.match(missing, /^Not found: \/API\/Medai\n\n\/API has no "Medai"\./);
  assert.match(missing, /Did you mean:\n\n- \/API\/Media \(category\)/);
  assert.match(missing, /## Contents of \/API\n/);
  const member = docs("/API/Media/Snapshot/disposee");
  assert.match(
    member,
    /Did you mean:\n\n- \/API\/Media\/Snapshot\/dispose \(method\)/,
  );
  // A name below the level it was asked at, when only one is shallowest.
  const found = docs("/API/Snapshot/export");
  assert.match(found, /^\/API\/Media\/Snapshot\/export · Method/);
  assert.match(
    found,
    /\(Found \/API\/Snapshot\/export at \/API\/Media\/Snapshot\/export\.\)/,
  );
  assert.match(docs("Snapshot"), /^\/API\/Media\/Snapshot · Interface/);
  // Git Bash's conversion of a leading "/".
  assert.equal(docs("C:/Program Files/Git/API/Media"), docs("/API/Media"));
});

test("search ranks names first and lists paths with summaries", () => {
  const found = searchDocs("snapshot export");
  assert.match(
    found,
    /^Search: snapshot export\n\n\d+ matches, best first:\n\n- \/API\/Media\/Snapshot\/export \(method\): /,
  );
  const onError = searchDocs("onError");
  assert.match(
    onError,
    /\n- \/API\/Plugin\/(Plugin|Scope)\/onError \(method\)/,
  );
  assert.match(
    searchDocs("test a plugin"),
    /- \/Guides\/How-to\/Test a plugin \(page\)/,
  );
  assert.match(searchDocs("zzqqxx nothing"), /Nothing matches/);
  assert.match(searchDocs("  "), /Give one or more words/);
});

test("long answers come in pages within the size bound", () => {
  const read = (page: number) =>
    docs("/Guides/Reference/Commands, menus and bindings", { page });
  const all = pages(read);
  assert.ok(all.length > 2, `${all.length} pages`);
  all.forEach((text, index) => {
    assert.ok(
      bytes(text) <= DOCS_PAGE_BYTES,
      `page ${index + 1}: ${bytes(text)}`,
    );
    assert.match(text, new RegExp(`· page ${index + 1} of ${all.length}\\n`));
    assert.equal(
      (text.match(/^\s*```/gm) ?? []).length % 2,
      0,
      `fences of page ${index + 1}`,
    );
  });
  assert.doesNotMatch(all.at(-1)!, /Read on with page/);
  assert.match(
    read(all.length + 1),
    /There is no page \d+: this has \d+ pages\./,
  );
  assert.match(read(0), /There is no page 0/);
  // A search with many matches pages too.
  const search = pages((page) => searchDocs("the", { page }));
  assert.ok(search.length > 1);
  for (const text of search) assert.ok(bytes(text) <= DOCS_PAGE_BYTES);
});

test("every node, every page, stays within the size bound", () => {
  let count = 0;
  for (const path of allPaths())
    for (const text of pages((page) => docs(path, { page }))) {
      assert.ok(!text.startsWith("Not found"), path);
      assert.ok(
        bytes(text) <= DOCS_PAGE_BYTES,
        `${path}: ${bytes(text)} bytes`,
      );
      count++;
    }
  assert.ok(count >= stored.nodes.length);
});

test("the command line prints the same answers", () => {
  const cli = (...args: string[]) =>
    spawnSync(
      process.execPath,
      [
        fileURLToPath(new URL("../bin/vestra-plugin.mjs", import.meta.url)),
        "docs",
        ...args,
      ],
      { encoding: "utf8" },
    );
  assert.equal(cli("API/Media").stdout, `${docs("/API/Media")}\n`);
  assert.equal(
    cli("Guides/How-to/Test", "a", "plugin").stdout,
    `${docs("/Guides/How-to/Test a plugin")}\n`,
  );
  assert.equal(
    cli("--search", "snapshot", "export").stdout,
    `${searchDocs("snapshot export")}\n`,
  );
  assert.equal(
    cli("Guides/Reference/limits", "--page", "2").stdout,
    `${docs("/Guides/Reference/limits", { page: 2 })}\n`,
  );
  const bad = cli("/", "--page", "x");
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /--page needs a page number/);
});

test("every page and declaration of the documentation site is in the tree", async () => {
  const project = await convertProject();
  const ids = new Map(
    stored.nodes.filter((node) => node.i).map((node) => [node.i!, node]),
  );
  // The guides: every document of the site, by its file.
  for (const document of project.documents ?? []) {
    const file = /\/docs\/([^/]+\/[^/]+\.md)$/.exec(
      project.files.getReflectionPath(document) ?? "",
    )?.[1];
    assert.ok(file, document.name);
    assert.ok(ids.has(`doc:${file}`), `page ${file} is not in the tree`);
  }
  assert.ok(ids.has("doc:README.md"));
  // The API: every declaration the site shows is a node, or (a member of
  // an object type written in a parameter or return type) is described in
  // the text of the nearest node above it.
  const shown = [
    ReflectionKind.Class,
    ReflectionKind.Interface,
    ReflectionKind.TypeAlias,
    ReflectionKind.Function,
    ReflectionKind.Variable,
    ReflectionKind.Enum,
    ReflectionKind.EnumMember,
    ReflectionKind.Namespace,
    ReflectionKind.Property,
    ReflectionKind.Method,
    ReflectionKind.Accessor,
    ReflectionKind.Constructor,
  ];
  let nodes = 0;
  let described = 0;
  for (const reflection of Object.values(project.reflections) as Reflection[]) {
    if (!shown.some((kind) => reflection.kindOf(kind))) continue;
    const declaration = reflection as DeclarationReflection;
    if (ids.has(declaration.getFullName())) {
      nodes++;
      continue;
    }
    let owner: Reflection | undefined = declaration.parent;
    while (owner && !ids.has(owner.getFullName())) owner = owner.parent;
    assert.ok(owner, `${declaration.getFullName()} is not in the tree`);
    assert.ok(
      ids.get(owner.getFullName())!.t.includes(declaration.name),
      `${declaration.getFullName()} is not in the text of ${owner.getFullName()}`,
    );
    described++;
  }
  assert.ok(nodes > 1000, `${nodes} declarations are nodes`);
  assert.ok(described < nodes / 2, `${described} described in place`);
});
