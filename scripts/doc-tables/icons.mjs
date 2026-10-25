/**
 * `<!-- generated:icons -->`: every icon name of `@vestra/icons.slint`
 * (slint/vestra/icons.slint) with its box (`Icons.box-width` ×
 * `Icons.box-height`, the `Icon`'s default size) and line width
 * (`Icons.line`), read from the `if name == …` branches of those functions.
 */

/** A pure function's branches: `{ names, value }[]` and its default. */
function branches(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) throw new Error(`icons.slint has no function ${name}`);
  const body = source.slice(start, source.indexOf("\n    }", start));
  const result = [];
  for (const match of body.matchAll(/if (.+?) \{ return (.+?); \}/g))
    result.push({
      names: [...match[1].matchAll(/name == "([\w-]+)"/g)].map((m) => m[1]),
      value: match[2],
    });
  const fallback = /\n\s*return (.+?);\s*$/.exec(body)?.[1];
  if (fallback === undefined)
    throw new Error(`icons.slint: ${name} has no default`);
  return { result, fallback };
}

const valueFor = ({ result, fallback }, icon) =>
  result.find((branch) => branch.names.includes(icon))?.value ?? fallback;

export default function icons({ read, table }) {
  const source = read("slint/vestra/icons.slint");
  const names = branches(source, "commands").result.flatMap((b) => b.names);
  if (!names.length) throw new Error("icons.slint: no icon names found");
  const width = branches(source, "box-width");
  const height = branches(source, "box-height");
  const line = branches(source, "line");
  const px = (value) => value.replace(/px$/, "");
  return table(
    ["Name", "Box (px)", "Line"],
    names.map((name) => [
      `\`${name}\``,
      `${px(valueFor(width, name))} × ${px(valueFor(height, name))}`,
      valueFor(line, name),
    ]),
  );
}
