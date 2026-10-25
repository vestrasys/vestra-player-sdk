/**
 * `<!-- generated:binding-names -->`: the names a binding is made of,
 * `BINDING_INPUTS` (src/plugin/bindings.ts), a row per field with the
 * summary of its doc comment. A contiguous run (`A` to `Z`, `F1` to `F24`)
 * is shown as its first and last name.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { properties } from "./lib/source.mjs";

/** `A`–`Z` for a run of consecutive letters, digits or numbered names. */
function names(list) {
  const step = (a, b) => {
    if (a.length === 1 && b.length === 1)
      return b.charCodeAt(0) - a.charCodeAt(0) === 1;
    const x = /^(\D*)(\d+)$/.exec(a);
    const y = /^(\D*)(\d+)$/.exec(b);
    return !!x && !!y && x[1] === y[1] && Number(y[2]) - Number(x[2]) === 1;
  };
  const run =
    list.length > 3 && list.every((n, i) => i === 0 || step(list[i - 1], n));
  return run
    ? `\`${list[0]}\`–\`${list.at(-1)}\``
    : list.map((name) => `\`${name}\``).join(", ");
}

export default async function bindingNames({ root, table }) {
  const { BINDING_INPUTS } = await import(
    pathToFileURL(join(root, "src/plugin/bindings.ts"))
  );
  const fields = properties("src/plugin/bindings.ts", "BINDING_INPUTS");
  return table(
    ["Field of `BINDING_INPUTS`", "Names", "Notes"],
    fields.map(({ name, doc }) => [
      `\`${name}\``,
      names(BINDING_INPUTS[name]),
      doc,
    ]),
  );
}
