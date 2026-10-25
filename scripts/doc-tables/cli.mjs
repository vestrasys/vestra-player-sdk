/**
 * `<!-- generated:cli <usage|commands> -->`: the `vestra-plugin` command
 * line (bin/vestra-plugin.mjs). `usage`: what `vestra-plugin --help`
 * prints. `commands`: the commands with their description from the
 * script's header comment (the indented `name   text` lines).
 */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export default function cli({ root, args, read, table }) {
  const [part] = args;
  if (part === "usage") {
    const run = spawnSync(
      process.execPath,
      [join(root, "bin/vestra-plugin.mjs"), "--help"],
      { encoding: "utf8" },
    );
    if (run.status !== 0) throw new Error(`--help failed: ${run.stderr}`);
    return ["```text", run.stdout.trimEnd(), "```"].join("\n");
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
