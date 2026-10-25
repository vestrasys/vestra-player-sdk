/**
 * `<!-- generated:manifest-fields -->`: the rule of every manifest field.
 * The rules are written here, with `{limit}` placeholders filled from
 * `MANIFEST_LIMITS` (src/manifest.ts); the generator fails when the fields
 * differ from `MANIFEST_FIELDS`, a placeholder names no limit, or a limit
 * is not used, so a new field or limit cannot be left out of the page.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { shown } from "./limits.mjs";

const RULES = {
  id: [
    "required",
    "1–{idBytes} of ASCII letters, digits and `.`, `-`, `_`. Ids `vestra` and `vestra.…` (any case) belong to the player's built-in plugins; installing one fails with `reserved`. A plugin in the official plugin repository is named `<GitHub user or organization>.<plugin>`; `vestra-plugin check` only hints at a missing prefix.",
  ],
  version: [
    "required in the package",
    "`x.y.z`, three whole numbers. `vestra-plugin build` writes it into `dist/manifest.json` from `--version`, the manifest or `package.json`.",
  ],
  apiVersion: ["required", "`{apiVersion}`."],
  entry: [
    "required",
    "Path of the entry module inside the package: `.ts` while developing, `.js` after `build`.",
  ],
  capabilities: [
    "required",
    "Capabilities from [Capabilities](capabilities.md), each at most once.",
  ],
  name: [
    "display",
    "1–{name} characters, one line, no leading or trailing white space. English; translated with the plugin's catalog.",
  ],
  author: ["display", "1–{author} characters, one line."],
  punchline: [
    "display",
    "One-line summary, 1–{punchline} characters. English; translated.",
  ],
  description: [
    "display",
    "Plain text, 1–{description} characters; line breaks allowed. English; translated.",
  ],
  tags: [
    "display",
    "At most {tags} tags, each 1–{tag} characters on one line, unique ignoring case. English; translated.",
  ],
  icon: [
    "display",
    "Package path of a PNG or JPEG (by content), at most {iconBytes} and {iconSide} pixels per side; 256×256 recommended.",
  ],
  readme: [
    "display",
    "Package path of a UTF-8 `.md` file of at most {documentBytes}, shown on the store page. Default: `README.md` when the package has one.",
  ],
  changelog: [
    "display",
    "The same rules; default `CHANGELOG.md` when present.",
  ],
  sourceUrl: ["display", "An `https:` address of at most {urlBytes}."],
  license: [
    "display",
    "1–{license} characters, preferably an SPDX expression such as `MIT`.",
  ],
  minPlayerVersion: [
    "optional",
    '`x.y.z`: the oldest player that loads the plugin (compared with `plugin.app.version`, three numbers). An older player refuses it with `versionMismatch` ("requires Vestra Player ≥ x.y.z") before it reads anything else, so a manifest with newer fields fails with that, not with an unknown field. See [Player versions](#player-versions).',
  ],
};

export default async function manifestFields({ root, table }) {
  const { MANIFEST_FIELDS, MANIFEST_LIMITS } = await import(
    pathToFileURL(join(root, "src/manifest.ts"))
  );
  const { API_VERSION } = await import(
    pathToFileURL(join(root, "src/capabilities.ts"))
  );
  const fields = Object.keys(RULES);
  if (
    JSON.stringify([...fields].sort()) !==
    JSON.stringify([...MANIFEST_FIELDS].sort())
  )
    throw new Error(
      `the rules (${fields.join(", ")}) differ from MANIFEST_FIELDS (${MANIFEST_FIELDS.join(", ")})`,
    );
  const values = { ...MANIFEST_LIMITS, apiVersion: API_VERSION };
  const used = new Set();
  const fill = (text) =>
    text.replace(/\{(\w+)\}/g, (_, key) => {
      if (!(key in values)) throw new Error(`no limit {${key}}`);
      used.add(key);
      const value = values[key];
      if (!key.endsWith("Bytes")) return String(value);
      return value >= 64 * 1024
        ? shown(key, value).replace(/^\d+ \((.*)\)$/, "$1")
        : `${value} bytes`;
    });
  const rows = MANIFEST_FIELDS.map((field) => [
    `\`${field}\``,
    RULES[field][0],
    fill(RULES[field][1]),
  ]);
  const unused = Object.keys(MANIFEST_LIMITS).filter((key) => !used.has(key));
  if (unused.length)
    throw new Error(`MANIFEST_LIMITS not on the page: ${unused.join(", ")}`);
  return table(["Field", "Kind", "Rule"], rows);
}
