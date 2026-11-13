/**
 * `<!-- generated:mpv-rules -->`: what `plugin.mpv` refuses, one row per
 * category of `MPV_RULES` (src/mpv.ts): why, the mpv commands and the mpv
 * properties (exact names, then the prefixes as `name-*`), and whether a
 * read is refused too. The filter commands and the writer commands follow
 * in a second table.
 */
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const code = (names) => names.map((name) => `\`${name}\``).join(", ") || "—";

export default async function mpvRules({ root, table }) {
  const { MPV_RULES } = await import(pathToFileURL(join(root, "src/mpv.ts")));
  const named = (map, category) =>
    Object.entries(map)
      .filter(([, each]) => each === category)
      .map(([name]) => name);
  const sentence = (text) => text[0].toUpperCase() + text.slice(1);
  const rows = Object.entries(MPV_RULES.categories)
    .filter(([category]) => category !== "filters")
    .map(([category, why]) => [
      `\`${category}\``,
      sentence(why),
      code(named(MPV_RULES.commands, category)),
      code([
        ...named(MPV_RULES.properties, category),
        ...named(MPV_RULES.propertyPrefixes, category).map((p) => `${p}*`),
      ]),
      MPV_RULES.reads.includes(category) ? "writes and reads" : "writes",
    ]);
  const others = [
    [
      code(MPV_RULES.writers),
      "Write the property their first argument names: checked as a write of it.",
    ],
    ...Object.entries(MPV_RULES.filterCommands).map(([name, operations]) => [
      code([name]),
      `Only ${code(operations)} of one filter with a label of the plugin's own (\`@label:…\`, not starting with \`${MPV_RULES.reservedLabel}\`); anything else is refused (\`filters\`).`,
    ]),
    [
      code(MPV_RULES.filterMessages),
      "Only to a filter label of the plugin's own (`refused` otherwise); without a label argument the command is `invalid`.",
    ],
  ];
  return [
    table(
      [
        "Category",
        "Refused because",
        "Commands",
        "Properties and options",
        "Refused",
      ],
      rows,
    ),
    table(["Command", "Rule"], others),
  ].join("\n\n");
}
