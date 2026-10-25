/**
 * `<!-- generated:theme <colors|sizes> -->`: the tokens of `Theme`
 * (slint/vestra/theme.slint). `colors`: the colour and brush tokens with
 * the default palette's value (slint/palette.slint, the `vestra` palette).
 * `sizes`: the length tokens (corner radii, font sizes, control sizes). A
 * token's own short comment becomes its note.
 */
import { exportsOf, lines, member } from "./lib/slint.mjs";

/** The `in` defaults of `VestraPalette`, by name. */
function palette(source) {
  const values = new Map();
  for (const { text } of lines(source)) {
    const found = member(text);
    if (found?.kind === "property" && found.value)
      values.set(found.name, found.value);
  }
  return values;
}

/** A palette value with `self.x` references followed. */
function resolved(values, name) {
  let value = values.get(name);
  for (let hops = 0; value?.startsWith("self.") && hops < 4; hops++)
    value = values.get(value.slice(5));
  if (!value) throw new Error(`VestraPalette has no value for ${name}`);
  return value;
}

/** A gradient as its colour stops. */
const shownValue = (value) => {
  const gradient = /^@linear-gradient\((\d+)deg,\s*(.+)\)$/.exec(value);
  return gradient
    ? `gradient ${gradient[1]}°: ${gradient[2]
        .split(/,\s*/)
        .map((stop) => `\`${stop}\``)
        .join(", ")}`
    : `\`${value}\``;
};

export default function theme({ args, read, table }) {
  const [part] = args;
  const [global] = exportsOf(read("slint/vestra/theme.slint")).filter(
    (item) => item.name === "Theme",
  );
  if (!global) throw new Error("slint/vestra/theme.slint has no global Theme");
  const values = palette(read("slint/palette.slint"));
  // A short sentence is a note; a longer one or a heading (no full stop) is not.
  const note = (comment) =>
    comment.length <= 100 && comment.endsWith(".") ? comment : "";
  if (part === "colors")
    return table(
      ["Token", "Value in `vestra`", "Note"],
      global.members
        .filter((m) => ["color", "brush"].includes(m.type))
        .map((m) => {
          const reference = /^VestraPalette\.([\w-]+)$/.exec(m.value ?? "");
          if (!reference)
            throw new Error(`Theme.${m.name} does not read VestraPalette`);
          return [
            `\`Theme.${m.name}\``,
            shownValue(resolved(values, reference[1])),
            note(m.comment),
          ];
        }),
    );
  if (part === "sizes")
    return table(
      ["Token", "Value", "Note"],
      global.members
        .filter((m) => m.type === "length")
        .map((m) => [`\`Theme.${m.name}\``, `\`${m.value}\``, note(m.comment)]),
    );
  throw new Error(`unknown part "${part}"; one of colors, sizes`);
}
