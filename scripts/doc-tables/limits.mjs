/**
 * `<!-- generated:limits <CONSTANT> -->`: one table of a limits constant,
 * a row per field with its value and the summary of its doc comment. A
 * constant importable from `@vestra-player/sdk/testing` is named in the
 * first column; the others are the player's figures with no export.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  constantDoc,
  exportedNames,
  memberDoc,
  properties,
  summary,
} from "./lib/source.mjs";

const SOURCES = {
  COMMAND_LIMITS: { file: "src/commands.ts" },
  UI_VALUE_LIMITS: { file: "src/plugin/values.ts" },
  TEXT_LIMITS: { file: "src/i18n.ts" },
  MARKDOWN_LIMITS: { file: "src/plugin/markdown.ts" },
  OSD_LIMITS: { file: "src/plugin/osd.ts" },
  SECRET_LIMITS: { file: "src/plugin/services.ts" },
  SESSION_STORAGE_LIMITS: { file: "src/plugin/services.ts" },
  MANIFEST_LIMITS: { file: "src/manifest.ts" },
  MESSAGE_LIMIT: { file: "src/capabilities.ts", value: true },
  MAX_SHADERS: {
    file: "src/plugin/view.ts",
    value: true,
    doc: ["src/plugin/types.ts", "RenderSettings", "shaders"],
    title: "Entries of `RenderSettings.shaders`",
  },
};

const KIB = 1024;
/** A value with a readable unit next to it when the name says bytes or ms. */
export function shown(name, value) {
  if (typeof value !== "number") return `\`${JSON.stringify(value)}\``;
  if (/bytes|LIMIT$/i.test(name) && value >= KIB && value % KIB === 0) {
    const unit =
      value % (KIB * KIB) === 0
        ? `${value / KIB / KIB} MiB`
        : `${value / KIB} KiB`;
    return `${value} (${unit})`;
  }
  if (name.endsWith("Ms") && value >= 1000) {
    const seconds = value / 1000;
    const unit = seconds % 3600 === 0 ? `${seconds / 3600} h` : `${seconds} s`;
    return `${value} (${unit})`;
  }
  return String(value);
}

export default async function limits({ root, args, table }) {
  const [name] = args;
  const source = SOURCES[name];
  if (!source)
    throw new Error(
      `unknown constant "${name}"; one of ${Object.keys(SOURCES).join(", ")}`,
    );
  const module = await import(pathToFileURL(join(root, source.file)));
  const value = module[name];
  if (value === undefined) throw new Error(`${source.file} exports no ${name}`);
  const exported = exportedNames("src/plugin/testing.ts").has(name);
  const label = (field) =>
    exported ? `\`${field ? `${name}.${field}` : name}\`` : (field ?? name);
  if (source.value) {
    const doc = source.doc
      ? summary(memberDoc(...source.doc))
      : summary(constantDoc(source.file, name));
    return table(
      ["Limit", "Value", "Meaning"],
      [[source.title ?? label(), shown(name, value), doc]],
    );
  }
  const fields = properties(source.file, name);
  const keys = Object.keys(value);
  if (JSON.stringify(fields.map((f) => f.name)) !== JSON.stringify(keys))
    throw new Error(
      `${name}: the source and the module disagree on the fields`,
    );
  return table(
    ["Limit", "Value", "Meaning"],
    fields.map(({ name: field, doc }) => [
      label(field),
      shown(field, value[field]),
      doc.replace(/\s*\([^()]*\d[^()]*\)\.?$/, "."),
    ]),
  );
}
