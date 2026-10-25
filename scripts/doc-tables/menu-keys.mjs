/**
 * `<!-- generated:menu-keys -->`: the submenus that already exist, by key
 * path: the player's own (`HOST_GROUPS`, src/i18n.ts) and those its
 * built-in plugins declare (`BUILTIN_SUBMENUS`, src/commands.ts).
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export default async function menuKeys({ root, table }) {
  const { BUILTIN_SUBMENUS } = await import(
    pathToFileURL(join(root, "src/commands.ts"))
  );
  const { HOST_GROUPS } = await import(
    pathToFileURL(join(root, "src/i18n.ts"))
  );
  const rows = HOST_GROUPS.filter((group) => group.includes("/")).map(
    (group) => [group.split("/").join(" ▸ "), "the player"],
  );
  for (const { path, plugins } of BUILTIN_SUBMENUS)
    rows.push([path.join(" ▸ "), plugins.map((id) => `\`${id}\``).join(", ")]);
  return table(["Key path", "Declared by"], rows);
}
