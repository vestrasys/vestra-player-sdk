/**
 * A small reader for the Slint library in slint/: declarations with the
 * `//` comment lines right above them. Enough for the theme, icon and widget
 * tables; not a Slint parser.
 */

/** Drops the references to the player's internal documents from a comment. */
export const publicText = (text) =>
  text
    .replace(/\s*\([^()]*(?:§|\.md\b|\bUI-[A-Z]+-\d|R-H\d)[^()]*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The lines of a file as `{ indent, text, comment }`, where `comment` is the
 * text of the `//` lines directly above (at the same indentation).
 */
export function lines(source) {
  const result = [];
  let comment = [];
  for (const raw of source.split("\n")) {
    const indent = raw.length - raw.trimStart().length;
    const text = raw.trim();
    if (text.startsWith("//")) {
      comment.push(text.replace(/^\/\/\s?/, ""));
      continue;
    }
    result.push({ indent, text, comment: comment.join(" ") });
    comment = [];
  }
  return result;
}

/**
 * The properties, callbacks and public functions a declaration line holds:
 * `in property <length> radius-panel: 8px;` → `{ direction: "in", type:
 * "length", name: "radius-panel", value: "8px" }`.
 */
export function member(text) {
  const property =
    /^(in|out|in-out)\s+property\s+<(.+?)>\s+([\w-]+)(?:\s*(?::|<=>)\s*(.+?))?;$/.exec(
      text,
    );
  if (property)
    return {
      kind: "property",
      direction: property[1],
      type: property[2],
      name: property[3],
      value: property[4] ?? null,
    };
  const fn =
    /^public\s+(?:pure\s+)?function\s+([\w-]+)\s*(\([^)]*\))(?:\s*->\s*([^\s{]+))?/.exec(
      text,
    );
  if (fn)
    return {
      kind: "function",
      name: fn[1],
      type: fn[3] ? `${fn[2]} -> ${fn[3]}` : fn[2],
      value: null,
    };
  const callback = /^callback\s+([\w-]+)(\(.*\))?;$/.exec(text);
  if (callback)
    return {
      kind: "callback",
      name: callback[1],
      type: callback[2] ?? "()",
      value: null,
    };
  return null;
}

/**
 * The exported components and globals of a file: `{ kind, name, comment,
 * members }`, where `members` are the properties, callbacks and public
 * functions declared
 * directly inside (one level deep), each with its comment.
 */
export function exportsOf(source) {
  const all = lines(source);
  const result = [];
  all.forEach((line, index) => {
    const match = /^export\s+(component|global|struct)\s+([\w-]+)/.exec(
      line.text,
    );
    if (!match || line.indent !== 0) return;
    const members = [];
    for (const inner of all.slice(index + 1)) {
      if (inner.indent === 0 && inner.text === "}") break;
      if (inner.indent !== 4) continue;
      const found = member(inner.text);
      if (found) members.push({ ...found, comment: publicText(inner.comment) });
    }
    result.push({
      kind: match[1],
      name: match[2],
      comment: publicText(line.comment),
      members,
    });
  });
  return result;
}
