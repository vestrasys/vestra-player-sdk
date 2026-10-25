/**
 * `<!-- generated:player-versions -->`: the public API that needs a newer
 * player than 0.1.0, by player version. A symbol counts when its doc
 * comment has an `@player x.y.z` tag or names "player x.y.z" (not "before"
 * or "older than" it); the tags are being completed with the API
 * reference, the prose covers the rest until then.
 */
import {
  docText,
  exportedNames,
  plain,
  sourceFile,
  tags,
  ts,
} from "./lib/source.mjs";

const SOURCES = [
  { file: "src/plugin/types.ts", module: "@vestra-player/sdk" },
  { file: "src/commands.ts", module: "@vestra-player/sdk/testing" },
  { file: "src/capabilities.ts", module: "@vestra-player/sdk/testing" },
];
const VERSION = /\d+\.\d+\.\d+/;

/** The player versions a doc comment names as needed. */
function versions(text) {
  const found = new Set();
  for (const tag of tags(text, "player")) {
    const match = VERSION.exec(tag);
    if (match) found.add(match[0]);
  }
  const prose = plain(text.replace(/^@player.*$/gm, ""));
  for (const match of prose.matchAll(/\b(\w+\s+)?player (\d+\.\d+\.\d+)\b/gi))
    if (!/^(before|older|than|after)\s/i.test(match[1] ?? ""))
      found.add(match[2]);
  return found;
}

const compare = (a, b) => {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

export default function playerVersions({ table }) {
  const byVersion = new Map();
  const add = (version, link) => {
    if (version === "0.1.0") return;
    if (!byVersion.has(version)) byVersion.set(version, []);
    if (!byVersion.get(version).includes(link))
      byVersion.get(version).push(link);
  };
  for (const { file, module } of SOURCES) {
    const exported =
      module === "@vestra-player/sdk"
        ? null
        : exportedNames("src/plugin/testing.ts");
    for (const statement of sourceFile(file).statements) {
      const names = ts.isVariableStatement(statement)
        ? statement.declarationList.declarations.map((d) => d.name.getText())
        : statement.name
          ? [statement.name.text]
          : [];
      const name = names[0];
      if (!name) continue;
      const isExported = statement.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      if (!isExported || (exported && !exported.has(name))) continue;
      const link = (target) => `{@linkcode "${module}"!${target} ${target}}`;
      for (const version of versions(docText(statement)))
        add(version, link(name));
      for (const member of statement.members ?? []) {
        const memberName = member.name?.getText();
        if (!memberName) continue;
        for (const version of versions(docText(member)))
          add(version, link(`${name}.${memberName}`));
      }
    }
  }
  return table(
    ["Player", "API that needs it or changed with it"],
    [...byVersion.keys()]
      .sort(compare)
      .map((version) => [`${version}`, byVersion.get(version).join(", ")]),
  );
}
