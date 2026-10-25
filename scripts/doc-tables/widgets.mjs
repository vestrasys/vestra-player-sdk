/**
 * `<!-- generated:widgets <file> -->`: the exported components of
 * `slint/vestra/<file>.slint` (`widgets`, `markdown`), each with its comment
 * and a table of its properties and callbacks (direction, type, default and
 * the comment above it). Structs are listed by name only: plugins pass them
 * through.
 */
import { exportsOf } from "./lib/slint.mjs";

export default function widgets({ args, read, table }) {
  const [file] = args;
  if (!/^[\w-]+$/.test(file ?? ""))
    throw new Error("name a file of slint/vestra/, such as widgets");
  const items = exportsOf(read(`slint/vestra/${file}.slint`));
  const components = items.filter((item) => item.kind === "component");
  if (!components.length)
    throw new Error(`slint/vestra/${file}.slint exports no component`);
  const parts = [];
  for (const component of components) {
    parts.push(`**\`${component.name}\`**: ${component.comment}`);
    parts.push(
      table(
        ["Member", "Kind", "Default", "Note"],
        component.members.map((m) => [
          `\`${m.name}\``,
          m.kind === "callback"
            ? `callback \`${m.type}\``
            : `${m.direction} \`${m.type}\``,
          m.value ? `\`${m.value}\`` : "",
          m.comment,
        ]),
      ),
    );
  }
  const structs = items.filter((item) => item.kind === "struct");
  for (const struct of structs)
    parts.push(`Struct **\`${struct.name}\`**: ${struct.comment}`);
  return parts.join("\n\n");
}
