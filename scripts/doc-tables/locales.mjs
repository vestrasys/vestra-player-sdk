/**
 * `<!-- generated:locales -->`: the player's interface languages,
 * `LOCALES` (src/i18n.ts), with the English name and the name the player's
 * Language menu shows (`BUILTIN_COMMANDS`, `vestra.preferences`).
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const ENGLISH = new Intl.DisplayNames(["en"], { type: "language" });

export default async function locales({ root, table }) {
  const { LOCALES } = await import(pathToFileURL(join(root, "src/i18n.ts")));
  const { BUILTIN_COMMANDS } = await import(
    pathToFileURL(join(root, "src/commands.ts"))
  );
  return table(
    ["Code", "Language", "Shown in the menu as"],
    LOCALES.map((code, index) => {
      const item = BUILTIN_COMMANDS.find(
        (c) => c.owner === "vestra.preferences" && c.id === `language.${code}`,
      );
      if (!item) throw new Error(`no Language menu item for ${code}`);
      return [
        `\`${code}\``,
        ENGLISH.of(code) + (index === 0 ? " (source language)" : ""),
        item.title,
      ];
    }),
  );
}
