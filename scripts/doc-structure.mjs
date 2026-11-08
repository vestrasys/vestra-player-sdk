/**
 * The structure of the documentation site: its groups and, per group, its
 * pages in navigation order. `npm run docs:check` (scripts/check-docs.mjs)
 * asserts that the Markdown files under docs/ are exactly the pages listed
 * here, and scripts/typedoc-plugin.mjs takes the group names and the page
 * order from this file. Adding, renaming or removing a page means changing
 * this table, so the change is visible in review.
 *
 * Four groups: the Tutorial (one page), the Guides (one task per page), the
 * Reference (lookup) and the Examples (one page per example plugin). Each
 * page states `why` it is a page of its own and not a section of an
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
 * so the release that ends the round must remove every mark, which leaves
 * the check strict.
 */

/** The last SDK version whose documentation may still have pending pages. */
export const PENDING_UNTIL = "1.5.13";

/**
 * Size limits (lines without the front matter and generated blocks). Above
 * a limit `docs:check` warns; more than 25 % above it fails.
 */
export const LIMITS = {
  index: { lines: 120 },
  tutorial: { lines: 400 },
  guide: { lines: 220 },
  example: { lines: 200 },
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
 * `kind` selects the size limit and the shape of its pages (index pages use
 * the `index` limit and have no shape, unless the entry names a `shape`:
 * the Tutorial group's index is the tutorial itself). The API group (the
 * TypeDoc entry points) follows the last group.
 */
export const GROUPS = [
  {
    title: "Tutorial",
    folder: "tutorial",
    kind: "tutorial",
    pages: [
      {
        file: "index.md",
        why: "The one tutorial: what a plugin is, the three styles with one example each, where things live, and running, testing and publishing; the group's only page, so it is the group index.",
        shape: "tutorial",
      },
    ],
  },
  {
    title: "Guides",
    folder: "guides",
    kind: "guide",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "windows.md",
        why: "One task: open a tool window from a menu item, wire its controls and bring back its values and whether it was open at the next start (the former Remember a window's state between runs).",
      },
      {
        file: "i18n.md",
        why: "One task: give a plugin settings and translate it.",
      },
      {
        file: "control-playback.md",
        why: "One task: open files and control playback without acting on a source the user has left.",
      },
      {
        file: "store-data.md",
        why: "One task: choose between settings files, session values and secrets, and use each.",
      },
      {
        file: "slider.md",
        why: "One task: keep a slider responsive while dragging.",
      },
      {
        file: "subtitles.md",
        why: "One task: find, upload, select and style subtitles from a plugin.",
      },
      {
        file: "filters.md",
        why: "One task: process video or audio with filters, a GPU shader or a convolution node.",
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
        file: "testing.md",
        why: "One task: test a plugin with TestHost (actions, simulated sources, injected failures, settling) and run the checks.",
      },
      {
        file: "publish.md",
        why: "One task: pack a plugin and submit it to the plugin store.",
      },
      {
        file: "own-store.md",
        why: "One task: host a store of one's own (an index.json on GitHub Pages) that users add as an unofficial repository; a different path from publish.md, which is the official repository's review flow.",
      },
      {
        file: "agent-docs.md",
        why: "One task: give a coding agent this documentation through the documentation tree (vestra-plugin docs, @vestra-player/sdk/docs); its reader is the agent's author, not the plugin's code.",
      },
      {
        file: "design-rules.md",
        why: "The rules every plugin, its interface and its menus follow, on one page (the former guidelines), written as a guide to applying them.",
      },
      {
        file: "troubleshooting.md",
        why: "Symptoms and their causes: problem-oriented, so it sits with the guides, in a shape of its own.",
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
        why: "Manifest field rules: lookup across many symbols.",
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
        file: "events.md",
        why: "Every player event a plugin can listen to by name (HostEvent), generated from the types and the capability tables: what styles B and C subscribe to; the API reference has one member per payload, not the table across them.",
      },
      {
        file: "messages.md",
        why: "Every request method of the player's protocol, generated from the player's capability table and the SDK's clients: what style C sends; too large and too different (protocol, not API) to join Capabilities.",
      },
      {
        file: "i18n.md",
        why: "The languages, file formats, template rules, extract/check behaviour, review markers and limits of translations: lookup, split from the translation guide.",
      },
      {
        file: "testing.md",
        why: "What startPlugin and TestHost take, simulate and record, and every TestHost member (generated): lookup, split from the testing guide.",
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
        file: "adjust-panel.md",
        why: "Walkthrough of examples/adjust-panel.",
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
];

/** Files under docs/ that are deliberately not on the site. */
export const OFF_SITE = ["maintaining.md"];

/**
 * Site addresses that moved, old → new (both relative to the site's root).
 * TypeDoc names a page's address after its title, so a renamed title (or
 * group index) would leave the old address dead for links from outside,
 * such as the player repository's docs. scripts/typedoc-plugin.mjs writes a
 * small redirecting page at each old address, and scripts/docs-tree.mjs
 * keeps each old title as a name of its new page. Every target is a page
 * of the site.
 */
export const REDIRECTS = Object.fromEntries(
  Object.entries({
    // SDK 1.7.2: seven groups became four (Tutorial, Guides, Reference,
    // Examples); the Explanation, Upgrading and Guidelines groups are gone.
    Concepts: "Tutorial",
    Explanation: "Tutorial",
    Tutorials: "Tutorial",
    "How-to_guides": "Guides",
    Guidelines: "Design_rules",
    Upgrading: "Guides",
    // The tutorials.
    Getting_started: "Tutorial",
    "Test,_check,_pack_and_publish": "Publish_a_plugin",
    Add_a_window: "Open_a_tool_window_and_remember_its_state",
    Write_your_own_blur_kernel: "Process_video_with_a_shader_or_a_filter",
    // The explanation pages.
    How_a_plugin_runs: "Tutorial",
    Three_ways_to_write_a_plugin: "Tutorial",
    "Commands,_menus_and_key_bindings": "Commands,_menus_and_bindings",
    "Playback_state,_controls_and_sources": "Control_playback",
    Video_and_audio_processing: "Process_video_with_a_shader_or_a_filter",
    "Windows,_panels,_settings_pages,_dialogs_and_the_OSD":
      "Open_a_tool_window_and_remember_its_state",
    GPU_and_software_rendering: "Offer_a_GPU_rendering_switch",
    The_player_s_Rust_core: "Tutorial",
    How_the_player_runs_and_talks_to_plugins: "Tutorial",
    // Guides merged into another guide.
    Remember_a_window_s_state_between_runs:
      "Open_a_tool_window_and_remember_its_state",
    Translate_a_plugin: "Add_settings_and_translations",
    // The guidelines.
    Plugin_rules: "Design_rules",
    Interface_guidelines: "Design_rules",
    Menu_guidelines: "Design_rules",
    // The upgrading pages.
    Migrate_a_plugin_to_English_source_text: "Add_settings_and_translations",
    "Migrating_off_package_rollback_(1.5.16,_removed_in_1.5.17)":
      "Publish_a_plugin",
    "Who_must_change,_release_by_release": "Guides",
  }).map(([from, to]) => [`documents/${from}.html`, `documents/${to}.html`]),
);

/**
 * The shape each kind of page must have (one kind of content per group).
 * `npm run docs:check` applies {@link shapeProblems} to every page except
 * the index pages (and to an index page whose entry names a `shape`); a
 * page entry may name another `shape` than its group's kind (the Guides
 * group's troubleshooting page). The rules are in
 * docs/maintaining.md, "Page shapes".
 */
export const SHAPES = {
  tutorial:
    "numbered steps `## 1. …`, `## 2. …` in order where it has them; no `**Goal:**`",
  guide:
    "a first paragraph starting `**Goal:**`; first section `## Steps`; an optional `## Complete example` with code; last section `## See also`",
  troubleshooting:
    "at least three `##` sections, each a symptom; last section `## See also`; no steps section",
  reference:
    "lookup only: no numbered or `Steps` / `Next` / `Before you start` sections and no `**Goal:**`",
  example:
    "a `## What it demonstrates` section that links to the tutorial or a guide teaching it",
};

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
 * The problems of a page body (without front matter and generated blocks)
 * against a shape of {@link SHAPES}, as messages.
 */
export function shapeProblems(shape, body) {
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
      const steps = titles.filter((t) => /^\d+\.\s/.test(t));
      steps.forEach((title, i) => {
        if (!title.startsWith(`${i + 1}. `))
          problems.push(`step "${title}" is out of order (expected ${i + 1}.)`);
      });
      if (/^\*\*Goal:\*\*/m.test(plain))
        problems.push("a `**Goal:**` (that is a guide)");
      break;
    }
    case "guide": {
      if (!firstParagraph.startsWith("**Goal:**"))
        problems.push("the first paragraph must start with `**Goal:**`");
      if (titles[0] !== "Steps")
        problems.push("the first section must be `## Steps`");
      const example = all.find((s) => s.title === "Complete example");
      if (example && !/^\s*```|\{@includeCode\s/m.test(example.text))
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
        problems.push("a `**Goal:**` (that is a guide)");
      break;
    case "example": {
      const section = all.find((s) => s.title === "What it demonstrates");
      if (!section) problems.push("no `## What it demonstrates` section");
      else if (
        !/\]\(\.\.\/(tutorial|guides)\/[^)]+\.md(#[^)]*)?\)/.test(section.text)
      )
        problems.push(
          "`## What it demonstrates` links neither the tutorial nor a guide",
        );
      break;
    }
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
