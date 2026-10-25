/**
 * `<!-- generated:cli <usage|commands> -->`: the `vestra-plugin` command
 * line (bin/vestra-plugin.mjs). `usage`: what `vestra-plugin --help`
 * prints, read from the script's `USAGE` constant (not by running the
 * script, which needs a built dist/). `commands`: the commands with their description from the
 * script's header comment (the indented `name   text` lines).
 */
export default function cli({ args, read, table }) {
  const [part] = args;
  if (part === "usage") {
    const source = read("bin/vestra-plugin.mjs");
    const block = /^const USAGE = \[\n([\s\S]*?)\n\]\.join\("\\n"\);$/m.exec(
      source,
    );
    if (!block)
      throw new Error("bin/vestra-plugin.mjs: no `const USAGE = [...]`");
    const lines = [...block[1].matchAll(/^\s*("(?:[^"\\]|\\.)*"),?$/gm)].map(
      (m) => JSON.parse(m[1]),
    );
    if (!lines.length) throw new Error("bin/vestra-plugin.mjs: USAGE is empty");
    return ["```text", lines.join("\n"), "```"].join("\n");
  }
  if (part === "commands") {
    const source = read("bin/vestra-plugin.mjs");
    const header = source.slice(source.indexOf("/**"), source.indexOf("*/"));
    const rows = [];
    for (const line of header.split("\n").map((l) => l.replace(/^ \*/, ""))) {
      const entry = /^ {3}((?:i18n )?[a-z]+)\s{2,}(\S.*)$/.exec(line);
      if (entry) rows.push([`\`vestra-plugin ${entry[1]}\``, entry[2]]);
      else if (rows.at(-1) && /^ {8,}\S/.test(line))
        rows.at(-1)[1] += ` ${line.trim()}`;
      else if (rows.length && !line.trim()) rows.push(null);
    }
    const commands = rows.filter(Boolean);
    if (commands.length < 6)
      throw new Error("bin/vestra-plugin.mjs: the command list was not found");
    return table(["Command", "Does"], commands);
  }
  throw new Error(`unknown part "${part}"; one of usage, commands`);
}
