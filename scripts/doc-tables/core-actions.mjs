/**
 * `<!-- generated:core-actions -->`: the player's core actions, the ids of
 * `HostAction` (src/plugin/types.ts), with the menu item and default
 * bindings the player registers for each (`BUILTIN_COMMANDS`).
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { unionLiterals } from "./lib/source.mjs";

export default async function coreActions({ root, table }) {
  const { BUILTIN_COMMANDS } = await import(
    pathToFileURL(join(root, "src/commands.ts"))
  );
  const actions = unionLiterals("src/plugin/types.ts", "HostAction");
  const host = BUILTIN_COMMANDS.filter((c) => c.owner === "host");
  const rows = host
    .filter((command) => actions.includes(command.id))
    .map((command) => [
      `\`${command.id}\``,
      command.path.join(" ▸ "),
      command.bindings.map((binding) => `\`${binding}\``).join(", "),
    ]);
  const missing = actions.filter((id) => !host.some((c) => c.id === id));
  if (missing.length)
    throw new Error(
      `HostAction ids not in BUILTIN_COMMANDS: ${missing.join(", ")}`,
    );
  return table(["Action", "Menu item", "Default bindings"], rows);
}
