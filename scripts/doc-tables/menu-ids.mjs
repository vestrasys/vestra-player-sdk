/**
 * `<!-- generated:menu-ids -->`: the player's built-in top-level menus:
 * `MENU_IDS` (src/commands.ts) with the key of each (`MENU_KEYS`,
 * src/i18n.ts).
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export default async function menuIds({ root, table }) {
  const { MENU_IDS } = await import(
    pathToFileURL(join(root, "src/commands.ts"))
  );
  const { MENU_KEYS } = await import(pathToFileURL(join(root, "src/i18n.ts")));
  return table(
    ["First segment", "Or its key"],
    MENU_IDS.map((id) => {
      if (!MENU_KEYS[id]) throw new Error(`no MENU_KEYS entry for ${id}`);
      return [`\`@${id}\``, `\`${MENU_KEYS[id]}\``];
    }),
  );
}
