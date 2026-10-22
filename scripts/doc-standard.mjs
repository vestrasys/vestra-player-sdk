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
 * (`docs:check` fails on it).
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
    ],
    data: [
      "ImageRef",
      "MarkdownRef",
      "MarkdownOptions",
      "PropValue",
      "Props",
      "ThemeId",
      "SettingsCategory",
      "SlotState",
      "ConfirmOptions",
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
