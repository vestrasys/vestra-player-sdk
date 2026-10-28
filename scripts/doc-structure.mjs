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
 * for concept pages). Above a limit `docs:check` warns; more than 25 % above
 * it fails.
 */
export const LIMITS = {
  index: { lines: 120 },
  tutorial: { lines: 350 },
  concept: { lines: 350, words: 4500 },
  "how-to": { lines: 200 },
  guideline: { lines: 200 },
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
        why: "The one tutorial: from an empty folder to a packed plugin.",
      },
    ],
  },
  {
    title: "Concepts",
    folder: "concepts",
    kind: "concept",
    pages: [
      { file: "index.md", why: "Group index." },
      {
        file: "plugins.md",
        why: "How a plugin runs (process, activate, handles and scopes, the update pass, stopping, data directory, failures): the base every other concept builds on.",
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
        file: "i18n.md",
        why: "One task: translate a plugin.",
      },
      {
        file: "i18n-migration.md",
        why: "One task: migrate a plugin written before 1.5.9 to English source text.",
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
        file: "rollback-migration.md",
        why: "One task: move a plugin manager off Packages.rollback and PluginInfo.previousVersion (deprecated in 1.5.16; removed in 1.5.17).",
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
    ],
  },
];

/** Files under docs/ that are deliberately not on the site. */
export const OFF_SITE = ["maintaining.md"];
