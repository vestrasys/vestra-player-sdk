/**
 * Local TypeDoc plugin (typedoc.json "plugin"):
 *
 * - Project documents are grouped by their folder, so a new page needs no
 *   front matter and no index entry: docs/tutorials → "Tutorials",
 *   docs/concepts → "Concepts", docs/how-to → "How-to", docs/examples →
 *   "Examples". A page's own `group` front matter wins.
 * - The two entry points (`@vestra-player/sdk`, `@vestra-player/sdk/testing`)
 *   are listed under "API" instead of "Modules".
 */
import { Converter } from "typedoc";

const GROUPS = {
  tutorials: "Tutorials",
  concepts: "Concepts",
  "how-to": "How-to",
  examples: "Examples",
};

/** @param {import("typedoc").Application} app */
export function load(app) {
  app.internationalization.addTranslations("en", {
    kind_plural_module: "API",
  });
  app.converter.on(Converter.EVENT_CREATE_DOCUMENT, (_context, document) => {
    if ("group" in document.frontmatter) return;
    const path = document.project.files.getReflectionPath(document) ?? "";
    const folder = /\/docs\/([^/]+)\/[^/]+$/.exec(path)?.[1];
    if (folder && GROUPS[folder]) document.frontmatter.group = GROUPS[folder];
  });
}
