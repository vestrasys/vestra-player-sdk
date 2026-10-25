/**
 * `<!-- generated:builtin-commands -->`: every command the player and its
 * built-in plugins register at start, in menu order: `BUILTIN_COMMANDS`
 * (src/commands.ts).
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

export default async function builtinCommands({ root, table }) {
  const { BUILTIN_COMMANDS } = await import(
    pathToFileURL(join(root, "src/commands.ts"))
  );
  return table(
    ["Menu item", "Default bindings", "Command"],
    BUILTIN_COMMANDS.map((command) => [
      command.path.length
        ? command.path.join(" ▸ ")
        : `${command.title} (not in the menu)`,
      [
        command.bindings.map((binding) => `\`${binding}\``).join(", "),
        command.focus === "panel" && command.bindings.length
          ? "(panel focus)"
          : "",
      ]
        .filter(Boolean)
        .join(" "),
      `\`${command.owner}/${command.id}\``,
    ]),
  );
}
