/**
 * `<!-- generated:error-codes -->`: every `error.code` the API uses, from
 * the table in the doc comment of `PluginError` (src/plugin/types.ts), the
 * one place the codes are written down. `{@link X}` becomes a link into the
 * API reference.
 */
export default function errorCodes({ read, table }) {
  const source = read("src/plugin/types.ts");
  const start = source.indexOf(" * | code | meaning |");
  if (start < 0) throw new Error("src/plugin/types.ts: no PluginError table");
  const end = source.indexOf("\n *\n", start);
  const rows = source
    .slice(start, end)
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .filter((line) => /^\|.*\|$/.test(line) && !/^\|\s*-/.test(line))
    .slice(1)
    .map((line) =>
      line
        .slice(1, -1)
        .split(/(?<!\\)\|/)
        .map((cell) =>
          cell
            .trim()
            .replace(
              /\{@link\s+([\w.]+)\s*\}/g,
              (_, name) => `{@link "@vestra-player/sdk"!${name}}`,
            ),
        ),
    );
  if (rows.length < 10)
    throw new Error("src/plugin/types.ts: the PluginError table is too short");
  return table(["Code", "Meaning"], rows);
}
