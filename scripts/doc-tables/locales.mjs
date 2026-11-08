/**
 * `<!-- generated:locales -->`: the player's interface languages,
 * `LOCALES` (src/i18n.ts), with the English name and the title of the
 * player's Language command for it (`BUILTIN_COMMANDS`, `vestra.preferences`;
 * in the command palette since the slim menu, player 0.7.6).
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
    ["Code", "Language", "The Language command's title"],
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
