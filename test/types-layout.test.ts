// The layout of src/plugin/types/*.ts keeps the reference's order. TypeDoc
// sorts declarations by file path, then position (`sort: source-order`),
// lists inherited members by the parent's file, and builds a type's
// "Hierarchy" in the order of the `export type *` lines of types.ts. So:
// one documentation category per file, a parent (`extends`) in a file that
// sorts before its child's, and types.ts re-exporting every file once, a
// parent's file before its children's. See docs/maintaining.md.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const directory = join(root, "src", "plugin", "types");
const parse = (path: string) =>
  ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
const files = readdirSync(directory)
  .filter((file) => file.endsWith(".ts"))
  .sort();
type Declaration = ts.InterfaceDeclaration | ts.TypeAliasDeclaration;
const declarations = new Map<string, Declaration[]>(
  files.map((file) => [
    file,
    parse(join(directory, file)).statements.filter(
      (s): s is Declaration =>
        ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s),
    ),
  ]),
);
const fileOf = new Map(
  [...declarations].flatMap(([file, list]) =>
    list.map((d) => [d.name.text, file] as const),
  ),
);
const category = (d: Declaration) =>
  ts
    .getJSDocTags(d)
    .find((tag) => tag.tagName.text === "category")
    ?.comment?.toString()
    .trim();
/** Cross-file `extends`: [parent's file, child's file, child]. */
const inheritance = [...declarations].flatMap(([file, list]) =>
  list.flatMap((d) =>
    ts.isInterfaceDeclaration(d)
      ? (d.heritageClauses ?? []).flatMap((clause) =>
          clause.types
            .map((t) => fileOf.get(t.expression.getText()))
            .filter((parent) => parent !== undefined && parent !== file)
            .map((parent) => [parent!, file, d.name.text] as const),
        )
      : [],
  ),
);

test("each src/plugin/types/*.ts holds one documentation category", () => {
  for (const [file, list] of declarations) {
    const exported = list.filter((d) =>
      d.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword),
    );
    const categories = new Set(exported.map(category));
    assert.equal(categories.size, 1, `${file}: ${[...categories].join(", ")}`);
    assert.ok(
      !categories.has(undefined),
      `${file}: a declaration has no @category`,
    );
  }
});

test("a parent interface's file sorts before its child's", () => {
  for (const [parent, child, name] of inheritance)
    assert.ok(parent < child, `${name} (${child}) extends a type of ${parent}`);
});

test("types.ts re-exports every file once, parents' files first", () => {
  const lines = parse(join(root, "src", "plugin", "types.ts"))
    .statements.filter(
      (s): s is ts.ExportDeclaration =>
        ts.isExportDeclaration(s) && !s.exportClause && !!s.moduleSpecifier,
    )
    .map((s) => {
      assert.ok(s.isTypeOnly, "export type * only");
      return (s.moduleSpecifier as ts.StringLiteral).text.replace(
        /^\.\/types\//,
        "",
      );
    });
  assert.deepEqual([...lines].sort(), files);
  for (const [parent, child, name] of inheritance)
    assert.ok(
      lines.indexOf(parent) < lines.indexOf(child),
      `types.ts: ${parent} must come before ${child} (${name})`,
    );
});
