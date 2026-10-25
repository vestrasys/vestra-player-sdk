/**
 * Helpers for the generators in scripts/doc-tables/: the doc comments of the
 * SDK's sources, read with the TypeScript compiler (no type checking).
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "../../..");
const files = new Map();

/** A source file of the repository, parsed. */
export function sourceFile(path) {
  if (!files.has(path))
    files.set(
      path,
      ts.createSourceFile(
        path,
        readFileSync(join(root, path), "utf8"),
        ts.ScriptTarget.Latest,
        true,
      ),
    );
  return files.get(path);
}

/**
 * The text of a node's doc comment, `@` tags included, with the comment
 * markers removed; "" when it has none.
 */
export function docText(node) {
  const file = node.getSourceFile();
  const ranges =
    ts.getLeadingCommentRanges(file.text, node.getFullStart()) ?? [];
  const last = ranges.filter((r) => file.text.startsWith("/**", r.pos)).at(-1);
  if (!last) return "";
  return file.text
    .slice(last.pos + 3, last.end - 2)
    .split("\n")
    .map((line) => line.replace(/^\s*\* ?/, ""))
    .join("\n")
    .trim();
}

/**
 * Inline TSDoc made plain for a table cell: `{@link A.b | text}` becomes
 * `text`, `{@link A}` becomes `` `A` ``; white space collapses.
 */
export function plain(text) {
  return text
    .replace(/\{@link(?:code|plain)?\s+([^}|]+?)\s*\|\s*([^}]+?)\s*\}/g, "$2")
    .replace(
      /\{@link(?:code|plain)?\s+(?:[^}!]+!)?([^}\s]+)\s*\}/g,
      (_, name) => `\`${name}\``,
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The summary of a doc comment: the text before its first block tag. */
export function summary(text) {
  return plain(text.split(/\n@\w/)[0]);
}

/** The text of block tags `tag` (`@player`, `@capability`) in a doc comment. */
export function tags(text, tag) {
  const result = [];
  const lines = text.split("\n");
  lines.forEach((line, index) => {
    if (!line.startsWith(`@${tag}`)) return;
    const rest = [line.slice(tag.length + 1)];
    for (const next of lines.slice(index + 1)) {
      if (/^@\w/.test(next)) break;
      rest.push(next);
    }
    result.push(plain(rest.join(" ")));
  });
  return result;
}

/** A top-level `const` of a file, by name: its declaration statement. */
export function constant(path, name) {
  for (const statement of sourceFile(path).statements)
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (declaration.name.getText() === name)
          return { statement, declaration };
  throw new Error(`${path}: no constant ${name}`);
}

/** An expression without `as`, `satisfies` and `Object.freeze(…)`. */
function unwrap(node) {
  for (;;) {
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node))
      node = node.expression;
    else if (ts.isParenthesizedExpression(node)) node = node.expression;
    else if (
      ts.isCallExpression(node) &&
      node.expression.getText() === "Object.freeze"
    )
      node = node.arguments[0];
    else return node;
  }
}

/**
 * The properties of an object-literal constant, in source order, with the
 * summary of each one's doc comment: `[{ name, doc }]`.
 */
export function properties(path, name) {
  const { declaration } = constant(path, name);
  const object = unwrap(declaration.initializer);
  if (!ts.isObjectLiteralExpression(object))
    throw new Error(`${path}: ${name} is not an object literal`);
  return object.properties.map((property) => ({
    name: property.name.getText().replace(/^"(.*)"$/, "$1"),
    doc: summary(docText(property)),
  }));
}

/** The doc comment of a constant (on its `export const` statement). */
export function constantDoc(path, name) {
  return docText(constant(path, name).statement);
}

/** An interface or type alias of a file, by name. */
export function declaration(path, name) {
  for (const statement of sourceFile(path).statements)
    if (
      (ts.isInterfaceDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name.text === name
    )
      return statement;
  throw new Error(`${path}: no declaration ${name}`);
}

/** The doc comment of an interface member, by name. */
export function memberDoc(path, name, member) {
  const node = declaration(path, name);
  const found = node.members?.find((m) => m.name?.getText() === member);
  if (!found) throw new Error(`${path}: no member ${name}.${member}`);
  return docText(found);
}

/** The string literals of a union type alias (`HostAction`). */
export function unionLiterals(path, name) {
  const node = declaration(path, name);
  if (!ts.isUnionTypeNode(node.type))
    throw new Error(`${path}: ${name} is not a union`);
  return node.type.types.map((type) => type.literal.text);
}

/** The names a module re-exports or declares as exported (`export { A }`). */
export function exportedNames(path) {
  const names = new Set();
  for (const statement of sourceFile(path).statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause)
      for (const element of statement.exportClause.elements)
        names.add(element.name.text);
    else if (
      statement.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      if (ts.isVariableStatement(statement))
        for (const d of statement.declarationList.declarations)
          names.add(d.name.getText());
      else if (statement.name) names.add(statement.name.text);
    }
  }
  return names;
}

export { ts, root };
