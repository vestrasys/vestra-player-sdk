#!/usr/bin/env node
/**
 * The documentation tree for agents (`@vestra-player/sdk/docs`,
 * `vestra-plugin docs`): the documentation site's pages and API as a tree
 * of small nodes, navigated by path like `go doc`.
 *
 *   node scripts/docs-tree.mjs [out]   write the tree (default
 *                                      dist/docs-tree.json.gz)
 *
 * It comes from the same sources as the site: TypeDoc converts the project
 * with typedoc.json and scripts/typedoc-plugin.mjs (the guides grouped and
 * ordered by scripts/doc-structure.mjs, the hidden setup lines of examples
 * removed), and every node takes the site's text. `scripts/build.mjs` runs
 * it after compiling, so the tree is always that of the package's sources.
 *
 * The tree:
 *
 *   /                          Overview (README.md), Guides, API
 *   /Guides/<group>            a group's index page, then its pages
 *   /Guides/<group>/<title>    a page (its slug, the file name, works too)
 *   /API                       both entry points, then their categories
 *   /API/<category>/<symbol>[/<member>…]
 *
 * Members of an object type written in place (an options property, a type
 * alias of an object) are nodes under their property or alias; members of a
 * parameter's or return type's object are described in the text of their
 * function. The file is gzipped JSON: `{ version, nodes }`, each node
 * `{ n: name, k: kind, s: one-line summary, t: text, c?: child indexes,
 * i?: TypeDoc full name or "doc:<folder>/<file>", a?: aliases }`, the root
 * first. `src/docs.ts` reads it.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, posix, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { Application, Reflection, ReflectionKind } from "typedoc";
import { GROUPS, REDIRECTS } from "./doc-structure.mjs";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const SITE = "https://vestrasys.github.io/vestra-player-sdk/";
/** Files of the repository that are not pages of the site link here. */
const REPOSITORY = "https://github.com/vestrasys/vestra-player-sdk/blob/main/";
/** A one-line summary is cut to about this many characters. */
const SUMMARY = 200;
/** The entry points and how a plugin imports them. */
const ENTRY = {
  "@vestra-player/sdk": "@vestra-player/sdk",
  "@vestra-player/sdk/testing": "@vestra-player/sdk/testing",
  "@vestra-player/sdk/docs": "@vestra-player/sdk/docs",
};
/** Letters and digits only, lower case: "Example: Blur" → "exampleblur". */
const loose = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** TypeDoc's model of the project, as the site's build makes it. */
export async function convertProject() {
  const cwd = process.cwd();
  process.chdir(root);
  try {
    const app = await Application.bootstrapWithPlugins({
      options: join(root, "typedoc.json"),
      logLevel: "Warn",
    });
    const project = await app.convert();
    if (!project) throw new Error("docs-tree: TypeDoc could not convert");
    return project;
  } finally {
    process.chdir(cwd);
  }
}

const kindName = (kind) => ReflectionKind.singularString(kind);
const oneLine = (text) => text.replace(/\s+/g, " ").trim();

/** The first paragraph of a Markdown text, on one line and cut short. */
export function summaryOf(text) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !/^(#|```|<|!\[|\|)/.test(p));
  const first = oneLine(paragraphs[0] ?? "");
  if (first.length <= SUMMARY) return first;
  const cut = first.slice(0, SUMMARY);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), SUMMARY - 40))}…`;
}

/** The comment that documents a declaration (methods: their signature's). */
function commentOf(reflection) {
  return (
    reflection.comment ??
    reflection.signatures?.find((s) => s.comment)?.comment ??
    reflection.getSignature?.comment ??
    reflection.setSignature?.comment ??
    reflection.type?.declaration?.signatures?.find((s) => s.comment)?.comment
  );
}

/** Builds the tree from a converted project. */
export function buildTree(project) {
  /** reflection id → node */
  const byReflection = new Map();
  const nodes = [];
  const node = (name, kind, extra = {}) => {
    const made = { name, kind, children: [], ...extra };
    nodes.push(made);
    return made;
  };
  const add = (parent, child) => {
    child.name = child.name.replace(/\//g, "∕");
    child.parent = parent;
    parent.children.push(child);
    return child;
  };
  /**
   * Siblings that share a name (any case) all get a suffix, the same
   * whatever order they were added in: their kind, and a number in the
   * order of their ids when the kind is the same too. The plain name stays
   * an alias.
   */
  const distinct = (n) => {
    const groups = new Map();
    for (const child of n.children) {
      const key = child.name.toLowerCase();
      groups.set(key, [...(groups.get(key) ?? []), child]);
    }
    for (const same of groups.values()) {
      if (same.length < 2) continue;
      const byKind = new Map();
      for (const child of same)
        byKind.set(child.kind, [...(byKind.get(child.kind) ?? []), child]);
      for (const [kind, list] of byKind) {
        list.sort((a, b) =>
          String(a.id ?? a.name).localeCompare(String(b.id ?? b.name)),
        );
        list.forEach((child, i) => {
          child.aliases = [...(child.aliases ?? []), child.name];
          child.name = `${child.name} (${kind.toLowerCase()}${list.length > 1 ? ` ${i + 1}` : ""})`;
        });
      }
    }
    n.children.forEach(distinct);
  };
  /** A Markdown link target: angle brackets around one with spaces or brackets. */
  const href = (target) => (/[\s()<>]/.test(target) ? `<${target}>` : target);
  const pathOf = (target) => {
    for (let r = target; r; r = r.parent) {
      const found = byReflection.get(r.id);
      if (found) return found.path;
      if (r.isProject?.()) return "/";
    }
    return undefined;
  };

  /** The entry points' own declarations by name. */
  const topLevel = new Map(
    (project.children ?? []).flatMap((module) =>
      (module.children ?? []).map((r) => [r.name, r]),
    ),
  );

  // ── Markdown from TypeDoc's comment parts ─────────────────────────────
  /**
   * Comment or page parts as Markdown. Links to the site's pages and API
   * become paths of the tree; a relative link to another file of the
   * repository (`base`: the directory of the page) becomes its GitHub
   * address; images become their alt text (a line of only an image goes).
   */
  const parts = (list = [], base = "") =>
    finish(
      list
        .map((part) => {
          if (part.kind === "text" || part.kind === "code") return part.text;
          if (part.kind === "inline-tag") {
            const label = part.text;
            const code = part.tag === "@linkcode" ? `\`${label}\`` : label;
            // typedoc-plugin-mdn-links can claim an SDK name (Plugin): the
            // SDK's own declaration wins here.
            const own =
              typeof part.target === "string" &&
              part.target.startsWith("https://developer.mozilla.org/")
                ? topLevel.get(label)
                : undefined;
            if (own) return `[${code}](${href(pathOf(own))})`;
            if (typeof part.target === "string")
              return `[${code}](${part.target})`;
            const path =
              part.target instanceof Reflection ? pathOf(part.target) : null;
            return path ? `[${code}](${href(path)})` : code;
          }
          if (part.kind === "relative-link") {
            const target =
              part.target === undefined
                ? undefined
                : project.files.resolve(part.target, project);
            const path = target instanceof Reflection ? pathOf(target) : null;
            if (path)
              return href(
                path + (part.targetAnchor ? `#${part.targetAnchor}` : ""),
              );
            return repository(base, part.text);
          }
          return part.text ?? "";
        })
        .join(""),
    );
  /** A path relative to `base` in the repository, as its GitHub address. */
  const repository = (base, relative) => {
    if (/^[a-z]+:/i.test(relative) || relative.startsWith("#")) return relative;
    const [file, anchor] = relative.split("#");
    const resolved = posix.normalize(posix.join(base, file));
    if (resolved.startsWith("..")) return relative;
    return `${REPOSITORY}${resolved}${anchor ? `#${anchor}` : ""}`;
  };
  /** Site addresses → paths of the tree; images → their alt text. */
  const finish = (text) =>
    text
      .replace(/^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*\n?/gm, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(
        /\]\((https:\/\/vestrasys\.github\.io\/vestra-player-sdk\/[^)\s]*)\)/g,
        (whole, url) => {
          const path = sitePath(url);
          return path ? `](${href(path)})` : whole;
        },
      );
  /** The tree's path for an address of the documentation site. */
  const sitePath = (url) => {
    const [address, anchor] = url.slice(SITE.length).split("#");
    if (address === "" || address === "index.html") return "/Overview";
    let found;
    const page = /^documents\/(.+)\.html$/.exec(address);
    if (page) found = documentPaths.get(loose(decodeURIComponent(page[1])));
    const module = /^modules\/(.+)\.html$/.exec(address);
    if (module) found = modulePaths.get(module[1]);
    const symbol =
      /^(?:interfaces|classes|functions|types|variables|enums)\/[^.]+\.(.+)\.html$/.exec(
        address,
      );
    if (symbol) {
      const r = topLevel.get(symbol[1]);
      found = r && pathOf(r);
      const member = r && anchor && r.children?.find((c) => c.name === anchor);
      if (member) return pathOf(member);
    }
    if (!found) return undefined;
    return anchor && page ? `${found}#${anchor}` : found;
  };
  /** Page title (letters and digits) → path; module file name → path. */
  const documentPaths = new Map();
  const modulePaths = new Map();

  const TAG_TITLES = {
    "@remarks": "Remarks",
    "@returns": "Returns",
    "@throws": "Throws",
    "@capability": "Capability",
    "@player": "Player version",
    "@since": "Since",
    "@deprecated": "Deprecated",
    "@see": "See",
    "@defaultValue": "Default value",
    "@example": "Example",
  };
  const tagTitle = (tag) =>
    TAG_TITLES[tag] ?? tag.slice(1).replace(/^./, (c) => c.toUpperCase());
  /** The block tags of a comment, in the site's order, as Markdown. */
  const blockTags = (comment, skip = new Set()) => {
    const tags = (comment?.blockTags ?? []).filter(
      (tag) => !skip.has(tag.tag) && tag.tag !== "@category",
    );
    const out = [];
    const remarks = tags.filter((t) => t.tag === "@remarks");
    for (const tag of remarks) out.push(parts(tag.content).trim());
    const throws = tags.filter((t) => t.tag === "@throws");
    if (throws.length)
      out.push(
        `**Throws**\n\n${throws.map((t) => `- ${oneLine(parts(t.content))}`).join("\n")}`,
      );
    for (const tag of tags) {
      if (["@remarks", "@throws", "@example"].includes(tag.tag)) continue;
      const body = parts(tag.content).trim();
      out.push(
        body.includes("\n")
          ? `**${tagTitle(tag.tag)}**\n\n${body}`
          : `**${tagTitle(tag.tag)}:** ${body}`,
      );
    }
    for (const tag of tags.filter((t) => t.tag === "@example")) {
      const body = parts(tag.content).trim();
      out.push(
        tag.name
          ? `### Example: ${tag.name}\n\n${body}`
          : `### Example\n\n${body}`,
      );
    }
    return out.filter(Boolean);
  };

  // ── Declarations ──────────────────────────────────────────────────────
  const typeParams = (list) =>
    list?.length
      ? `<${list
          .map(
            (tp) =>
              tp.name +
              (tp.type ? ` extends ${tp.type}` : "") +
              (tp.default ? ` = ${tp.default}` : ""),
          )
          .join(", ")}>`
      : "";
  const params = (sig) =>
    (sig.parameters ?? [])
      .map(
        (p) =>
          `${p.flags.isRest ? "..." : ""}${p.name}${p.flags.isOptional || p.defaultValue ? "?" : ""}: ${p.type}`,
      )
      .join(", ");
  const signatureLine = (sig, name) => {
    switch (sig.kind) {
      case ReflectionKind.ConstructorSignature:
        return `new ${name}${typeParams(sig.typeParameters)}(${params(sig)})`;
      case ReflectionKind.GetSignature:
        return `get ${name}(): ${sig.type}`;
      case ReflectionKind.SetSignature:
        return `set ${name}(${params(sig)})`;
      default:
        return `${name}${typeParams(sig.typeParameters)}(${params(sig)}): ${sig.type}`;
    }
  };
  /** The declaration as TypeScript, the way the site shows it. */
  const declaration = (r) => {
    const flags = r.flags;
    const prefix = flags.isReadonly ? "readonly " : "";
    switch (r.kind) {
      case ReflectionKind.Interface:
        return `interface ${r.name}${typeParams(r.typeParameters)}${r.extendedTypes?.length ? ` extends ${r.extendedTypes.join(", ")}` : ""}`;
      case ReflectionKind.Class:
        return `class ${r.name}${typeParams(r.typeParameters)}${r.extendedTypes?.length ? ` extends ${r.extendedTypes.join(", ")}` : ""}${r.implementedTypes?.length ? ` implements ${r.implementedTypes.join(", ")}` : ""}`;
      case ReflectionKind.TypeAlias:
        return `type ${r.name}${typeParams(r.typeParameters)} = ${r.type}`;
      case ReflectionKind.Variable:
        return `const ${r.name}: ${r.type}`;
      case ReflectionKind.EnumMember:
        return `${r.name} = ${r.type}`;
      case ReflectionKind.Property:
        return `${flags.isStatic ? "static " : ""}${prefix}${r.name}${flags.isOptional ? "?" : ""}: ${r.type}`;
      case ReflectionKind.Accessor:
        return [r.getSignature, r.setSignature]
          .filter(Boolean)
          .map((sig) => signatureLine(sig, r.name))
          .join("\n");
      default:
        if (r.signatures?.length)
          return r.signatures
            .map((sig) => signatureLine(sig, r.name))
            .join("\n");
        return `${r.name}: ${r.type ?? "unknown"}`;
    }
  };
  /** A parameter's object members, described in place. */
  const members = (type, indent) => {
    const children = type?.type === "reflection" && type.declaration.children;
    if (!children?.length) return "";
    return children
      .map((child) => {
        const text = summaryOf(parts(commentOf(child)?.summary));
        return `\n${indent}- \`${child.name}${child.flags.isOptional ? "?" : ""}: ${child.type}\`${text ? `: ${text}` : ""}`;
      })
      .join("");
  };
  const signatureText = (sig) => {
    const out = [];
    const comment = sig.comment;
    if (comment?.summary.length) out.push(parts(comment.summary).trim());
    const documented = (sig.parameters ?? []).filter(
      (p) => p.comment || members(p.type, ""),
    );
    if (documented.length)
      out.push(
        `**Parameters**\n\n${documented
          .map(
            (p) =>
              `- \`${p.name}\`${p.comment ? `: ${parts(p.comment.summary).trim()}` : ""}${members(p.type, "  ")}`,
          )
          .join("\n")}`,
      );
    const returns = comment?.blockTags.find((t) => t.tag === "@returns");
    if (returns)
      out.push(
        `**Returns** \`${sig.type}\`: ${parts(returns.content).trim()}${members(sig.type, "  ")}`,
      );
    out.push(...blockTags(comment, new Set(["@returns"])));
    return out.join("\n\n");
  };
  /** `Owner.member` of an inherited or overridden member, with its path. */
  const origin = (type) => {
    let target = type.reflection;
    if (target?.kindOf(ReflectionKind.SomeSignature)) target = target.parent;
    if (!target?.parent) return type.name;
    const path = pathOf(target);
    const name = `${target.parent.name}.${target.name}`;
    return path ? `[${name}](${href(path)})` : name;
  };
  /** The SDK's own types a declaration names, as links (after its code). */
  const typeLinks = (r, code) => {
    const names = [
      ...new Set(code.match(/\b[A-Z][A-Za-z0-9_]*\b/g) ?? []),
    ].filter((name) => name !== r.name && topLevel.has(name));
    if (!names.length) return "";
    return `Types: ${names.map((name) => `[${name}](${href(pathOf(topLevel.get(name)))})`).join(", ")}`;
  };
  const symbolText = (r, entry) => {
    const out = [];
    const head = [`${kindName(r.kind)} ${r.name}`];
    if (entry) {
      const typeOnly = [
        ReflectionKind.Interface,
        ReflectionKind.TypeAlias,
      ].includes(r.kind);
      head.push(
        `import ${typeOnly ? "type " : ""}{ ${r.name} } from "${entry}";`,
      );
    }
    if (r.inheritedFrom)
      head.push(`Inherited from ${origin(r.inheritedFrom)}.`);
    if (r.overwrites) head.push(`Overrides ${origin(r.overwrites)}.`);
    out.push(head.join("\n"));
    const code = declaration(r);
    out.push(`\`\`\`ts\n${code}\n\`\`\``);
    out.push(typeLinks(r, code));
    const signatures = r.signatures?.length
      ? r.signatures
      : [r.getSignature, r.setSignature].filter(Boolean);
    if (signatures.length && signatures.some((s) => s.comment)) {
      if (signatures.length === 1) out.push(signatureText(signatures[0]));
      else
        signatures.forEach((sig, i) =>
          out.push(
            `### Overload ${i + 1}\n\n\`${signatureLine(sig, r.name)}\`\n\n${signatureText(sig)}`,
          ),
        );
    } else {
      const comment = commentOf(r);
      if (comment?.summary.length) out.push(parts(comment.summary).trim());
      out.push(...blockTags(comment));
      if (r.defaultValue && r.defaultValue.length < 400)
        out.push(`**Default value:** \`${r.defaultValue}\``);
    }
    return out.filter(Boolean).join("\n\n");
  };

  // ── Structure ────────────────────────────────────────────────────────
  const rootNode = node("", "Root");
  rootNode.path = "/";
  const readme = node("Overview", "Page", {
    summary:
      "The package's README: what the SDK is, installing it and where to start.",
    render: () =>
      parts(project.readme, "")
        .replace(/^[\s\S]*?(?=^## )/m, "")
        .trim(),
    id: "doc:README.md",
  });
  add(rootNode, readme);

  // Guides: the site's groups, their pages in navigation order.
  const guides = add(
    rootNode,
    node("Guides", "Section", {
      summary:
        "The documentation pages, by group: tutorials, how-to guides, reference, explanation, guidelines, examples, upgrading.",
    }),
  );
  const documents = new Map();
  for (const doc of project.documents ?? []) {
    const path = project.files.getReflectionPath(doc) ?? "";
    const key = /\/docs\/([^/]+\/[^/]+\.md)$/.exec(path)?.[1];
    if (key) documents.set(key, doc);
  }
  const used = new Set();
  for (const group of GROUPS) {
    const index = documents.get(`${group.folder}/index.md`);
    if (!index) throw new Error(`docs-tree: no ${group.folder}/index.md`);
    used.add(index);
    const groupNode = add(
      guides,
      node(group.title, "Group", {
        summary: index.frontmatter.description ?? "",
        reflection: index,
        render: () => parts(index.content, `docs/${group.folder}`).trim(),
        id: `doc:${group.folder}/index.md`,
        aliases: [group.folder],
      }),
    );
    byReflection.set(index.id, groupNode);
    for (const page of group.pages) {
      if (page.file === "index.md") continue;
      const doc = documents.get(`${group.folder}/${page.file}`);
      if (!doc) throw new Error(`docs-tree: no ${group.folder}/${page.file}`);
      used.add(doc);
      const pageNode = add(
        groupNode,
        node(doc.name, "Page", {
          summary: doc.frontmatter.description ?? "",
          reflection: doc,
          render: () => parts(doc.content, `docs/${group.folder}`).trim(),
          id: `doc:${group.folder}/${page.file}`,
          aliases: [basename(page.file, ".md")],
        }),
      );
      byReflection.set(doc.id, pageNode);
    }
  }
  for (const doc of documents.values())
    if (!used.has(doc))
      throw new Error(`docs-tree: ${doc.name} is in no group`);

  // API: both entry points; their categories are the next level.
  const api = add(
    rootNode,
    node("API", "Section", {
      summary:
        "Every type and value of @vestra-player/sdk (the plugin API), @vestra-player/sdk/testing (the test host) and @vestra-player/sdk/docs (this tree), by category.",
    }),
  );
  // In the order of ENTRY: the plugin API, the test host, this tree.
  const entries = Object.keys(ENTRY);
  const modules = [...(project.children ?? [])].sort(
    (a, b) => entries.indexOf(a.name) - entries.indexOf(b.name),
  );
  api.render = () =>
    modules
      .map(
        (module) =>
          `## ${module.name}\n\n${parts(module.comment?.summary).trim()}\n\nCategories: ${(module.categories ?? []).map((c) => c.title).join(", ")}`,
      )
      .join("\n\n");
  for (const module of modules) byReflection.set(module.id, api);
  const categories = new Map();
  /** A declaration and what the site shows inside it. */
  const declare = (parent, r, entry) => {
    const made = add(
      parent,
      node(r.name, kindName(r.kind), {
        reflection: r,
        render: () => symbolText(r, entry),
        id: r.getFullName(),
      }),
    );
    byReflection.set(r.id, made);
    for (const sig of r.signatures ?? []) byReflection.set(sig.id, made);
    const own = r.groups?.length
      ? r.groups.flatMap((g) => g.children)
      : (r.children ?? []);
    const literal =
      r.type?.type === "reflection" ? r.type.declaration : undefined;
    if (literal) byReflection.set(literal.id, made);
    for (const child of [...own, ...(literal?.children ?? [])])
      declare(made, child);
    return made;
  };
  for (const module of modules) {
    const entry = ENTRY[module.name];
    if (!entry) throw new Error(`docs-tree: unknown entry ${module.name}`);
    const lists = module.categories?.length
      ? module.categories
      : [{ title: "Other", children: module.children ?? [] }];
    for (const category of lists) {
      let categoryNode = categories.get(category.title);
      if (!categoryNode) {
        categoryNode = add(
          api,
          node(category.title, "Category", {
            render: () =>
              category.description ? parts(category.description).trim() : "",
          }),
        );
        categories.set(category.title, categoryNode);
      }
      for (const r of category.children) declare(categoryNode, r, entry);
    }
  }
  for (const categoryNode of categories.values())
    categoryNode.summary ||= summaryOf(
      `${categoryNode.children.length} entries: ${categoryNode.children.map((c) => c.name).join(", ")}`,
    );

  // An entry point with one category of its own (testing, docs) is that
  // category; the plugin API is /API.
  for (const module of modules) {
    const own = module.categories ?? [];
    const target =
      own.length === 1 ? (categories.get(own[0].title) ?? api) : api;
    byReflection.set(module.id, target);
    module.target = target;
  }
  // Old page titles (REDIRECTS) stay names of their page.
  for (const [from, to] of Object.entries(REDIRECTS)) {
    const old = /^documents\/(.+)\.html$/.exec(from)?.[1];
    const now = /^documents\/(.+)\.html$/.exec(to)?.[1];
    if (!old || !now) continue;
    const doc = [...documents.values()].find(
      (each) => loose(each.name) === loose(decodeURIComponent(now)),
    );
    const target = doc && byReflection.get(doc.id);
    if (!target) throw new Error(`docs-tree: REDIRECTS ${to} is no page`);
    target.aliases = [
      ...(target.aliases ?? []),
      decodeURIComponent(old).replace(/_/g, " "),
    ];
  }
  distinct(rootNode);

  // Paths, then the texts (links need every path).
  const assign = (n) => {
    for (const child of n.children) {
      child.path = `${n.path === "/" ? "" : n.path}/${child.name}`;
      assign(child);
    }
  };
  assign(rootNode);
  for (const doc of documents.values())
    documentPaths.set(loose(doc.name), byReflection.get(doc.id).path);
  for (const module of modules)
    modulePaths.set(module.name.replace(/[@/]/g, "_"), module.target.path);
  rootNode.text = [
    `Vestra Player SDK ${pkg.version}: the documentation of ${SITE}, as a tree of pages.`,
    "Open a path below; each listing shows the paths one level down. Paths ignore case, spaces and punctuation, the leading / is optional, `.` works like `/` (Snapshot.export), a guide page also answers to its file name (/Guides/How-to/testing) and a name alone finds its declaration (TestHost). Long texts come in pages; a #heading opens the page that has it. Search by name or text when you do not know the path.",
  ].join("\n\n");
  for (const n of nodes) {
    if (n === rootNode) continue;
    n.text = n.render?.() ?? "";
    // A symbol's summary is its comment's first paragraph.
    if (n.reflection && !n.reflection.isDocument())
      n.summary = summaryOf(parts(commentOf(n.reflection)?.summary));
    else if (!n.summary) n.summary = summaryOf(n.text);
  }

  const order = [];
  const visit = (n) => {
    n.index = order.length;
    order.push(n);
    n.children.forEach(visit);
  };
  visit(rootNode);
  return {
    version: pkg.version,
    nodes: order.map((n) => {
      const out = { n: n.name, k: n.kind, s: n.summary ?? "", t: n.text };
      if (n.children.length) out.c = n.children.map((c) => c.index);
      if (n.id) out.i = n.id;
      if (n.aliases?.length) out.a = n.aliases;
      return out;
    }),
  };
}

export async function writeTree(out = join(root, "dist", "docs-tree.json.gz")) {
  const tree = buildTree(await convertProject());
  const json = JSON.stringify(tree);
  const data = gzipSync(json, { level: 9 });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, data);
  return { nodes: tree.nodes.length, json: json.length, gzip: data.length };
}

if (process.argv[1] && resolve(process.argv[1]) === import.meta.filename) {
  const result = await writeTree(
    process.argv[2] ? resolve(process.argv[2]) : undefined,
  );
  console.log(
    `docs-tree: ${result.nodes} nodes, ${(result.json / 1024).toFixed(0)} KiB JSON, ${(result.gzip / 1024).toFixed(0)} KiB gzipped`,
  );
}
