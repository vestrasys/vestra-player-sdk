/**
 * The API categories whose reference documentation is complete, and which
 * `doc-lint` and `docs:check` therefore enforce instead of only reporting.
 * A documentation round adds its category here once every symbol in it
 * follows the template (docs/maintaining.md, "Reference comments").
 *
 * Each category lists the exported names of `@vestra-player/sdk` it covers:
 *
 * - `full`: modules and handles (types with methods). Required: a summary,
 *   `@remarks`, `@example`, `@capability`, `@since` and `@category <name>`.
 *   Each method declared on it: a summary, `@example`, `@capability`,
 *   `@since`, and `@throws` when it returns a Promise. Each property: a
 *   summary, and `@throws` when it is a Promise.
 * - `data`: plain data types (options, states, values). Required: a summary,
 *   `@since` and `@category <name>`; each field has a summary.
 *
 * In both, every `ts` code block of an `@example` must compile
 * (`docs:check` fails on it), and every `@example` must pass
 * `example-lead` and `stale-refs` (`doc-lint`; below).
 */
export const STRICT_CATEGORIES = {
  UI: {
    full: [
      "Ui",
      "View",
      "Window",
      "Windows",
      "PanelSlot",
      "SidebarSlot",
      "Panel",
      "Appearance",
      "SettingsPage",
      "Settings",
      "BackdropSlot",
      "Panels",
      "Dialogs",
      "OsdPanel",
      "Osd",
      "I18n",
    ],
    data: [
      "ImageRef",
      "MarkdownRef",
      "MarkdownOptions",
      "ImageOptions",
      "PropValue",
      "PropData",
      "Props",
      "ThemeId",
      "SettingsCategory",
      "SlotState",
      "SlotPanel",
      "PanelState",
      "ConfirmOptions",
      "Locale",
      "LanguagePreference",
      "TemplateArgs",
      "Text",
      "TextList",
      "ListStyle",
      "TextArg",
      "TextValue",
      "TextError",
      "OsdPanelOptions",
    ],
  },
};

/** Exported name → `{ category, kind }` for every strict declaration. */
export const strictDeclarations = new Map(
  Object.entries(STRICT_CATEGORIES).flatMap(([category, kinds]) =>
    Object.entries(kinds).flatMap(([kind, names]) =>
      names.map((name) => [name, { category, kind }]),
    ),
  ),
);

// ── Examples (docs/maintaining.md, "Examples in reference comments") ─────

/**
 * Ends the hidden setup of an `@example` code block (the convention of
 * TypeScript's twoslash): the lines above it are type checked by
 * `docs:check` but not shown on the site (scripts/typedoc-plugin.mjs), in
 * llms-full.txt (scripts/llms.mjs) or counted by `doc-lint`. In a block
 * without its own `import`/`export`, `docs:check` places them at module
 * level, so they may `import` and `declare` what the shown lines use.
 */
export const CUT = "// ---cut---";

/**
 * The lines of a code block's body, split at the first {@link CUT}, and how
 * many cut lines it has (`doc-lint` flags more than one).
 */
export function splitCut(body) {
  const lines = body.split("\n");
  const at = lines.findIndex((line) => line.trim() === CUT);
  const cuts = lines.filter((line) => line.trim() === CUT).length;
  return at < 0
    ? { hidden: [], visible: lines, cuts }
    : { hidden: lines.slice(0, at), visible: lines.slice(at + 1), cuts };
}

/** A fenced block (```` ```ts … ``` ````) without its hidden setup lines. */
export function withoutHidden(fenced) {
  const match = /^(\s*`{3,}[^\n]*\n)([\s\S]*?)(\n[ \t]*`{3,}\s*)$/.exec(fenced);
  if (!match) return fenced;
  const { visible } = splitCut(match[2]);
  return match[1] + visible.join("\n") + match[3];
}

/** The `example-lead` rule's numbers. */
export const EXAMPLE_RULES = {
  /** Words the title line (`@example Pause playback from a menu item`) needs at least. */
  titleWords: 3,
  /**
   * Words the lead needs at least: the prose between the title and the code,
   * a full sentence or more saying what the example does and how it works.
   */
  leadWords: 6,
  /** Shown non-blank code lines above which the code needs a comment. */
  explainAbove: 5,
  /**
   * The share of a declaration's methods that may use a reference marker
   * (`@example See Playback.play` with `{@link Playback.play}` below it)
   * instead of an example of their own, rounded down. One marker per
   * declaration is always allowed, so a handle with fewer than 5 methods
   * may still point one trivial sibling at another.
   */
  markerShare: 0.2,
};

/**
 * Names and ids examples must not use any more: removed from the player or
 * now owned by someone else. `stale-refs` checks every `@example` in src/
 * and every code block of README.md and docs/ against them.
 */
export const STALE_REFERENCES = [
  {
    pattern: /\bvestra\.nes\b/,
    why: "the built-in NES emulator left the player (SDK 1.5.28); it is the store plugin zysilm.vestranes",
  },
  {
    pattern: /\bid:\s*"nes"|extensions:\s*\[[^\]]*"\.?nes"/,
    why: "the store plugin VestraNES (zysilm.vestranes) owns .nes files; a resolver example would collide with it (`resolver-taken`); use a made-up format",
  },
];

/**
 * Known violations of `example-lead` and `stale-refs` in the enforced
 * declarations when the rules were introduced (SDK 1.5.30), one entry per
 * problem: `<rule> <symbol>#<example number> <problem>` (`stale-refs`
 * entries have no problem id). They are reported as warnings; anything not
 * listed fails. An entry that no longer fails is itself an error, and
 * test/doc-baseline.test.ts pins the largest size the list may have, so it
 * only shrinks; the round that fixes a category removes its entries.
 */
export const EXAMPLE_BASELINE = new Set([]);
