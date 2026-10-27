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

/** The lines of a code block's body, split at {@link CUT}. */
export function splitCut(body) {
  const lines = body.split("\n");
  const at = lines.findIndex((line) => line.trim() === CUT);
  return at < 0
    ? { hidden: [], visible: lines }
    : { hidden: lines.slice(0, at), visible: lines.slice(at + 1) };
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
   * The share of a category's methods that may use a reference marker
   * (`@example See Playback.play` with `{@link Playback.play}` below it)
   * instead of an example of their own.
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
    pattern: /\bid:\s*"nes"|extensions:\s*\[\s*"nes"\s*\]/,
    why: "the store plugin VestraNES (zysilm.vestranes) owns .nes files; a resolver example would collide with it (`resolver-taken`); use a made-up format",
  },
];

/**
 * Known violations of `example-lead` and `stale-refs` in the enforced
 * categories when the rules were introduced (SDK 1.5.29), by
 * `rule symbol` (`doc-lint --list example-lead` prints the names). They are
 * reported as warnings; anything not listed fails. An entry that no longer
 * fails is itself an error, so the list only shrinks; the round that fixes
 * a category removes its entries.
 */
export const EXAMPLE_BASELINE = new Set([
  "example-lead Appearance",
  "example-lead Appearance.onChange",
  "example-lead Appearance.set",
  "example-lead Appearance.setLanguage",
  "example-lead BackdropSlot",
  "example-lead BackdropSlot.onChange",
  "example-lead Dialogs",
  "example-lead Dialogs.confirm",
  "example-lead Dialogs.openDirectory",
  "example-lead Dialogs.openFile",
  "example-lead Dialogs.openFiles",
  "example-lead Dialogs.saveFile",
  "example-lead I18n",
  "example-lead I18n.error",
  "example-lead I18n.list",
  "example-lead I18n.resolve",
  "example-lead I18n.text",
  "example-lead ImageRef",
  "example-lead MarkdownRef",
  "example-lead Osd",
  "example-lead Osd.panel",
  "example-lead Osd.show",
  "example-lead OsdPanel",
  "example-lead OsdPanel.set",
  "example-lead Panel",
  "example-lead Panel.onChange",
  "example-lead Panel.onDrop",
  "example-lead Panel.setInteraction",
  "example-lead Panel.show",
  "example-lead Panel.showMenu",
  "example-lead Panel.toggle",
  "example-lead PanelSlot",
  "example-lead PanelSlot.activate",
  "example-lead PanelSlot.onChange",
  "example-lead PanelSlot.setVisible",
  "example-lead PanelSlot.toggle",
  "example-lead Panels",
  "example-lead Panels.mount",
  "example-lead PropData",
  "example-lead Props",
  "example-lead Settings",
  "example-lead Settings.page",
  "example-lead Settings.show",
  "example-lead SettingsPage",
  "example-lead SidebarSlot",
  "example-lead SidebarSlot.setDetached",
  "example-lead Ui",
  "example-lead Ui.image",
  "example-lead Ui.markdown",
  "example-lead Ui.remoteImage",
  "example-lead View",
  "example-lead View.bind",
  "example-lead View.on",
  "example-lead View.set",
  "example-lead Window",
  "example-lead Window.close",
  "example-lead Window.hide",
  "example-lead Window.onClose",
  "example-lead Window.show",
  "example-lead Windows",
  "example-lead Windows.create",
  "stale-refs I18n.error",
]);
