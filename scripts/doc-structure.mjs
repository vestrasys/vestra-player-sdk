/**
 * The structure of the documentation site: its groups and, per group, its
 * pages in navigation order. `npm run docs:check` (scripts/check-docs.mjs)
 * asserts that the Markdown files under docs/ are exactly the pages listed
 * here, and scripts/typedoc-plugin.mjs takes the group names and the page
 * order from this file. Adding, renaming or removing a page means changing
 * this table, so the change is visible in review.
 *
 * Each page states `why` it is a page of its own and not a section of an
 * existing one (its topic differs, or as a section it would push that page
 * over its size limit or blur its focus). The rules are in
 * docs/maintaining.md, "Documentation structure".
 *
 * `new: true` marks a page that does not exist yet and is written in the
 * current documentation round; every other page exists. `pending:
 * "<package>"` marks a page that the round creates or brings up to the rules
 * (the package names who owns it). While a page is pending, a missing `new`
 * file and the page's rule violations are reported as warnings instead of
 * errors; a missing page that is not `new` always fails. That
 * allowance ends with the round: once `package.json` has a version above
 * `PENDING_UNTIL`, a page still marked `pending` or `new` fails the check,
 * so the release that ends the round (1.5.14) must remove every mark, which
 * leaves the check strict.
 */

/** The last SDK version whose documentation may still have pending pages. */
export const PENDING_UNTIL = "1.5.13";

/**
 * Size limits (lines without the front matter and generated blocks; words
 * for explanation pages). Above a limit `docs:check` warns; more than 25 % above
 * it fails.
 */
export const LIMITS = {
  index: { lines: 120 },
  tutorial: { lines: 350 },
  explanation: { lines: 350, words: 4500 },
  "how-to": { lines: 200 },
  guideline: { lines: 200 },
  example: { lines: 200 },
  upgrading: { lines: 200 },
  reference: { lines: 150 },
};

/**
 * Phrases an index page (or any page) must not contain: a page that is not
 * written yet is planned in an SDK issue, not announced on the site.
 */
export const PLACEHOLDERS = [
  /coming soon/i,
  /being written/i,
  /not yet written/i,
];

/**
 * The groups in navigation order. `folder` is the directory under docs/,
 * `kind` selects the size limit of its pages (index pages use `index`).
 * The API group (the TypeDoc entry points) follows the last group.
 */
export const GROUPS = [
  {
    title: "Tutorials",
    folder: "tutorials",
    kind: "tutorial",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "getting-started.md",
        why: "Tutorial 1 of 4: the folder, the manifest and a first menu item running in the player.",
      },
      {
        file: "add-a-window.md",
        why: "Tutorial 2 of 4: a tool window on the same plugin; a lesson of its own so each tutorial ends with something that runs.",
      },
      {
        file: "settings-and-translations.md",
        why: "Tutorial 3 of 4: a settings page and a translation of the same plugin.",
      },
      {
        file: "test-and-publish.md",
        why: "Tutorial 4 of 4: a test, the checks, the package and the store submission.",
      },
      {
        file: "blur-kernel.md",
        why: "A lesson of its own after the series: write a blur kernel as a GPU shader, then as a convolution node, then meet gblur; a different plugin, so not a step of the four.",
      },
    ],
  },
  {
    title: "How-to",
    folder: "how-to",
    kind: "how-to",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "control-playback.md",
        why: "One task: open files and control playback without acting on a source the user has left.",
      },
      {
        file: "store-data.md",
        why: "One task: choose between settings files, session values and secrets, and use each.",
      },
      {
        file: "subtitles.md",
        why: "One task: find, upload, select and style subtitles from a plugin.",
      },
      {
        file: "slider.md",
        why: "One task: keep a slider responsive while dragging.",
      },
      {
        file: "window-state.md",
        why: "One task: remember a window's state between runs.",
      },
      {
        file: "gpu-rendering.md",
        why: "One task: offer the player's GPU or software rendering choice and its restart.",
      },
      {
        file: "command-state.md",
        why: "One task: give menu items that follow playback plugin.when conditions so an idle plugin can be stopped.",
      },
      {
        file: "i18n.md",
        why: "One task: translate a plugin.",
      },
      {
        file: "testing.md",
        why: "One task: test a plugin with TestHost (actions, simulated sources, injected failures, settling).",
      },
      {
        file: "publish.md",
        why: "One task: submit a plugin to the plugin store.",
      },
      {
        file: "agent-docs.md",
        why: "One task: give a coding agent this documentation through the documentation tree (vestra-plugin docs, @vestra-player/sdk/docs); its reader is the agent's author, not the plugin's code.",
      },
      {
        file: "troubleshooting.md",
        why: "Symptoms and their causes (the pitfalls and questions that used to sit on the explanation pages): problem-oriented, so it sits with the how-to guides, in a shape of its own.",
        shape: "troubleshooting",
      },
    ],
  },
  {
    title: "Reference",
    folder: "reference",
    kind: "reference",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "manifest.md",
        why: "Manifest field rules and the minPlayerVersion table: lookup across many symbols.",
      },
      {
        file: "capabilities.md",
        why: "Every capability with the API it opens, what it requires and its store wording: one generated table.",
      },
      {
        file: "limits.md",
        why: "Every runtime limit in one generated table instead of scattered over the API.",
      },
      {
        file: "commands.md",
        why: "Menu ids, menu keys, menu path and binding syntax, core action ids and the keys the system takes first.",
      },
      {
        file: "platforms.md",
        why: "Every platform difference in one table.",
      },
      {
        file: "theme.md",
        why: "Theme tokens and values, fonts, icons and the @vestra/widgets components, generated from slint/.",
      },
      {
        file: "cli.md",
        why: "The vestra-plugin commands, their options and the package.json `vestra` field.",
      },
      {
        file: "errors.md",
        why: "Every error code in one generated table, from the PluginError doc comment.",
      },
      {
        file: "i18n.md",
        why: "The languages, file formats, template rules, extract/check behaviour, review markers and limits of translations: lookup, split from the translation how-to.",
      },
      {
        file: "testing.md",
        why: "What startPlugin and TestHost take, simulate and record, and every TestHost member (generated): lookup, split from the testing how-to.",
      },
    ],
  },
  {
    title: "Explanation",
    folder: "explanation",
    kind: "explanation",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "plugins.md",
        why: "How a plugin runs (process, activate, handles and scopes, the update pass, stopping, data directory, failures): the base every other explanation page builds on.",
      },
      {
        file: "commands.md",
        why: "Commands, menu paths and how a key finds its command: one model shared by menus, bindings and panels.",
      },
      {
        file: "playback.md",
        why: "Playback state and events, conditional controls, sources and the play sequence: spans Player, Resolvers and the core actions.",
      },
      {
        file: "processing.md",
        why: "Video and audio filter chains, joining plugins' chains, live parameters, the view and render options.",
      },
      {
        file: "ui.md",
        why: "The five interface surfaces and how Slint and TypeScript talk; at its size limit, so no other topic joins it.",
      },
      {
        file: "rendering.md",
        why: "GPU and software rendering: how the choice is made and takes effect; the state model behind the GPU rendering how-to.",
      },
      {
        file: "architecture.md",
        why: "The player's Rust core: host modules, threads and render paths; what is on the other side of the API.",
      },
      {
        file: "host-and-node.md",
        why: "How the Rust host starts plugin processes and talks to them (own process or shared runner, wire protocol, capability checks, stop, crash, lazy activation): too large to join How a plugin runs.",
      },
    ],
  },
  {
    title: "Guidelines",
    folder: "guidelines",
    kind: "guideline",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "plugins.md",
        why: "The rules every plugin follows (only the public SDK, no other plugins, no system commands, both systems, its own id): prescriptive, moved out of the first tutorial.",
      },
      {
        file: "interface.md",
        why: "Rules for tool windows, panels, the OSD, theme and size use, text length and CJK: prescriptive, so neither a concept nor a task.",
      },
      {
        file: "menus.md",
        why: "Rules for where commands go, submenus, titles and default bindings: a different topic from the interface rules.",
      },
    ],
  },
  {
    title: "Examples",
    folder: "examples",
    kind: "example",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "hello.md",
        why: "Walkthrough of examples/hello.",
      },
      { file: "blur.md", why: "Walkthrough of examples/blur." },
      {
        file: "signal-generator.md",
        why: "Walkthrough of examples/signal-generator.",
      },
      {
        file: "bookmark.md",
        why: "Walkthrough of examples/bookmark.",
      },
      {
        file: "panel-menu.md",
        why: "Walkthrough of examples/panel-menu.",
      },
      {
        file: "menus.md",
        why: "Walkthrough of examples/menus.",
      },
      {
        file: "theme-widgets.md",
        why: "Walkthrough of examples/theme-widgets.",
      },
      {
        file: "markdown.md",
        why: "Walkthrough of examples/markdown.",
      },
      { file: "i18n.md", why: "Walkthrough of examples/i18n." },
    ],
  },
  {
    title: "Upgrading",
    folder: "upgrading",
    kind: "upgrading",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "i18n-migration.md",
        why: "Upgrade note: migrate a plugin written before 1.5.9 to English source text.",
      },
      {
        file: "rollback-migration.md",
        why: "Upgrade note: move a plugin manager off Packages.rollback and PluginInfo.previousVersion (deprecated in 1.5.16; removed in 1.5.17).",
      },
      {
        file: "releases.md",
        why: 'Every release\'s "who must change" from the CHANGELOG in one generated table.',
      },
    ],
  },
];

/** Files under docs/ that are deliberately not on the site. */
export const OFF_SITE = ["maintaining.md"];

/**
 * Site addresses that moved, old → new (both relative to the site's root).
 * TypeDoc names a page's address after its title, so a renamed title (or
 * group index) would leave the old address dead for links from outside,
 * such as the player repository's docs. scripts/typedoc-plugin.mjs writes a
 * small redirecting page at each old address.
 */
export const REDIRECTS = {
  // The group "Concepts" became "Explanation" (the Diátaxis restructure).
  "documents/Concepts.html": "documents/Explanation.html",
};

/**
 * The shape each kind of page must have (Diátaxis: one kind of content per
 * group). `npm run docs:check` applies {@link shapeProblems} to every page
 * except the index pages; a page entry may name another `shape` than its
 * group's kind (the How-to group's troubleshooting page). The rules are in
 * docs/maintaining.md, "Page shapes".
 */
export const SHAPES = {
  tutorial:
    "first section `## Before you start`; numbered steps `## 1. …`, `## 2. …` (at least two, in order); last section `## Next`",
  "how-to":
    "a first paragraph starting `**Goal:**`; first section `## Steps`; a `## Complete example` with code; last section `## See also`",
  troubleshooting:
    "at least three `##` sections, each a symptom; last section `## See also`; no steps section",
  reference:
    "lookup only: no numbered or `Steps` / `Next` / `Before you start` sections and no `**Goal:**`",
  explanation:
    "no numbered sections, no `Steps`, `Next`, `Testing`, `Common pitfalls` or `FAQ` sections and no numbered lists",
  guideline:
    "rules only: no tables, colour values (`#rrggbb`), sizes (`12px`, `41×40`, or any number of three or more digits) or generated blocks outside code blocks; values are in the Reference (a small count such as `at most 8`, a status code such as `HTTP 404`, a count with thousands separators and link targets are not values)",
  example:
    "a `## What it demonstrates` section that links to the tutorial or how-to guide teaching it",
  upgrading: "first section `## Who must change`",
};

/** Headings no page may have: what they held moved to the Reference. */
const FORBIDDEN_EVERYWHERE = ["API on this page"];

/**
 * A page body without the contents of its code fences (each fenced line is
 * kept as an empty line, so line numbers stay).
 */
function withoutFences(body) {
  let fence = null;
  return body
    .split("\n")
    .map((line) => {
      const marks = /^\s*(`{3,})/.exec(line)?.[1];
      if (fence) {
        if (
          marks &&
          marks.length >= fence.length &&
          !/\S/.test(line.trim().slice(marks.length))
        )
          fence = null;
        return "";
      }
      if (marks) {
        fence = marks;
        return "";
      }
      return line;
    })
    .join("\n");
}

/** The `##` sections of a body: `{ title, text }` (text without the heading). */
function sections(body) {
  const lines = withoutFences(body).split("\n");
  const raw = body.split("\n");
  const result = [];
  lines.forEach((line, index) => {
    const heading = /^## (.+?)\s*$/.exec(line);
    if (heading) result.push({ title: heading[1], start: index + 1 });
  });
  return result.map((section, i) => ({
    title: section.title,
    text: raw
      .slice(
        section.start,
        result[i + 1] ? result[i + 1].start - 1 : raw.length,
      )
      .join("\n"),
  }));
}

/**
 * The problems of a page body (without front matter and generated blocks
 * for counting, but with them here) against a shape of {@link SHAPES}, as
 * messages. `raw` is the body with its generated blocks, for the rules
 * that look at them.
 */
export function shapeProblems(shape, body, raw = body) {
  const problems = [];
  const plain = withoutFences(body);
  const all = sections(body);
  const titles = all.map((s) => s.title);
  const headings = [...plain.matchAll(/^#{2,3} (.+?)\s*$/gm)].map((m) => m[1]);
  for (const title of FORBIDDEN_EVERYWHERE)
    if (titles.includes(title))
      problems.push(`a \`## ${title}\` section (link the Reference instead)`);
  const numbered = headings.filter((h) => /^\d+\.\s/.test(h));
  const firstParagraph =
    plain
      .replace(/^[\s\S]*?^# .*$/m, "")
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .find(Boolean) ?? "";
  switch (shape) {
    case "tutorial": {
      if (titles[0] !== "Before you start")
        problems.push("the first section must be `## Before you start`");
      const steps = titles.filter((t) => /^\d+\.\s/.test(t));
      if (steps.length < 2)
        problems.push("fewer than two numbered steps (`## 1. …`)");
      steps.forEach((title, i) => {
        if (!title.startsWith(`${i + 1}. `))
          problems.push(`step "${title}" is out of order (expected ${i + 1}.)`);
      });
      if (titles.at(-1) !== "Next")
        problems.push("the last section must be `## Next`");
      break;
    }
    case "how-to": {
      if (!firstParagraph.startsWith("**Goal:**"))
        problems.push("the first paragraph must start with `**Goal:**`");
      if (titles[0] !== "Steps")
        problems.push("the first section must be `## Steps`");
      const example = all.find((s) => s.title === "Complete example");
      if (!example) problems.push("no `## Complete example` section");
      else if (!/^\s*```|\{@includeCode\s/m.test(example.text))
        problems.push("`## Complete example` has no code");
      if (titles.at(-1) !== "See also")
        problems.push("the last section must be `## See also`");
      break;
    }
    case "troubleshooting":
      if (titles.filter((t) => t !== "See also").length < 3)
        problems.push("fewer than three symptom sections");
      if (titles.includes("Steps")) problems.push("a `## Steps` section");
      if (titles.at(-1) !== "See also")
        problems.push("the last section must be `## See also`");
      break;
    case "reference":
      if (numbered.length) problems.push(`numbered sections (${numbered[0]})`);
      for (const title of ["Steps", "Next", "Before you start"])
        if (headings.includes(title)) problems.push(`a \`${title}\` section`);
      if (/^\*\*Goal:\*\*/m.test(plain))
        problems.push("a `**Goal:**` (that is a how-to guide)");
      break;
    case "explanation": {
      if (numbered.length) problems.push(`numbered sections (${numbered[0]})`);
      for (const heading of headings)
        if (
          /^(steps?|next|testing|common pitfalls|pitfalls|faq)$/i.test(heading)
        )
          problems.push(`a \`${heading}\` section`);
      const list = /^\s*\d+\.\s/m.exec(plain);
      if (list)
        problems.push(
          `a numbered list at line ${plain.slice(0, list.index).split("\n").length} (explanation pages describe, they do not give steps)`,
        );
      break;
    }
    case "guideline": {
      const lineOf = (index) => plain.slice(0, index).split("\n").length;
      const table = /^\s*\|.*\|\s*$/m.exec(plain);
      if (table)
        problems.push(
          `a table at line ${lineOf(table.index)} (values go in the Reference)`,
        );
      const colour = /#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b/.exec(plain);
      if (colour)
        problems.push(
          `a colour value ${colour[0]} at line ${lineOf(colour.index)}`,
        );
      const pixels = /\b\d+(?:\.\d+)?px\b/.exec(plain);
      if (pixels)
        problems.push(
          `a pixel value ${pixels[0]} at line ${lineOf(pixels.index)}`,
        );
      // Sizes written as plain numbers: "41×40", "at least 317", "440".
      // Small counts ("at most 8") are rules, not values; code points
      // (U+2026), dotted versions, link targets (`](…)`, `{@link …}`),
      // status codes ("HTTP 404") and counts with thousands separators
      // ("1,000,000") are not values either. They are blanked out first,
      // with spaces, so line numbers stay.
      const blank = (match) => match.replace(/[^\n]/g, " ");
      const scan = plain
        .replace(/\]\([^)\n]*\)/g, blank)
        .replace(/\{@link[^}]*\}/g, blank)
        .replace(/\b(?:HTTP|status)\s+\d{3}\b/gi, blank)
        .replace(/\b\d{1,3}(?:,\d{3})+\b/g, blank);
      const size = /\b\d+(?:\.\d+)?\s*[×x]\s*\d+\b/.exec(scan);
      if (size)
        problems.push(`a size ${size[0]} at line ${lineOf(size.index)}`);
      const number = /(?<![\w+.,-])\d{3,}(?:\.\d+)?\b(?![.,-]\d)/.exec(scan);
      if (number)
        problems.push(
          `a numeric value ${number[0]} at line ${lineOf(number.index)}`,
        );
      if (/<!--\s*generated:/.test(raw))
        problems.push("a generated block (values go in the Reference)");
      break;
    }
    case "example": {
      const section = all.find((s) => s.title === "What it demonstrates");
      if (!section) problems.push("no `## What it demonstrates` section");
      else if (
        !/\]\(\.\.\/(tutorials|how-to)\/[^)]+\.md(#[^)]*)?\)/.test(section.text)
      )
        problems.push(
          "`## What it demonstrates` links no tutorial or how-to guide",
        );
      break;
    }
    case "upgrading":
      if (titles[0] !== "Who must change")
        problems.push("the first section must be `## Who must change`");
      break;
  }
  return problems;
}

/**
 * Problems of the Mermaid blocks of a page: a label must be plain text.
 * Mermaid renders labels as Markdown, so a Markdown link (`[text](url)`), a
 * bare address (`https://…`, `www.…`) or a backtick inside a block shows as
 * "Unsupported markdown" or breaks the diagram. Returns messages with the
 * line in the page.
 */
export function mermaidProblems(text) {
  const problems = [];
  const lines = text.split("\n");
  let inside = false;
  lines.forEach((line, index) => {
    if (/^\s*```mermaid\s*$/.test(line)) inside = true;
    else if (inside && /^\s*```\s*$/.test(line)) inside = false;
    else if (inside) {
      const found = /\]\(|https?:\/\/|www\.|`/.exec(line);
      if (found)
        problems.push(
          `line ${index + 1}: "${found[0]}" in a Mermaid block (labels are plain text: no links, addresses or backticks)`,
        );
    }
  });
  return problems;
}
