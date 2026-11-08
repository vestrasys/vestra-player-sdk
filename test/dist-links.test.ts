// The `{@link}` targets of the published API declarations
// (dist/plugin/types/*.d.ts) resolve to the SDK's own declarations, as they
// do in src/plugin/types/*.ts. tsc drops imports a file uses only in doc
// comments; scripts/build.mjs puts them back, and without them an editor
// shows `{@link Scope.onError}` unresolved and `{@link Window}` as the DOM's
// `Window`. Needs `npm run build` (dist/).
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const types = join(root, "dist", "plugin", "types");
const slash = (path: string) => path.replaceAll("\\", "/");

test(
  "every {@link} in dist/plugin/types/*.d.ts resolves to an SDK declaration",
  { skip: !existsSync(types) && "dist/ is not built" },
  () => {
    const files = readdirSync(types)
      .filter((file) => file.endsWith(".d.ts"))
      .map((file) => join(types, file));
    const program = ts.createProgram(files, {
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      target: ts.ScriptTarget.ES2023,
      noEmit: true,
      types: ["node"],
    });
    const checker = program.getTypeChecker();
    const dist = slash(join(root, "dist")) + "/";
    const wrong = new Map<string, number>();
    let links = 0;
    const visit = (node: ts.Node): void => {
      for (const doc of (node as { jsDoc?: ts.JSDoc[] }).jsDoc ?? [])
        visit(doc);
      if (
        (ts.isJSDocLink(node) ||
          ts.isJSDocLinkCode(node) ||
          ts.isJSDocLinkPlain(node)) &&
        node.name
      ) {
        links++;
        let symbol = checker.getSymbolAtLocation(node.name);
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol);
        const file = symbol?.declarations?.[0]?.getSourceFile().fileName;
        if (!file || !slash(file).startsWith(dist)) {
          const key = `${node.name.getText()} → ${file ? slash(file).replace(/.*\/node_modules\//, "") : "nothing"}`;
          wrong.set(key, (wrong.get(key) ?? 0) + 1);
        }
      }
      ts.forEachChild(node, visit);
    };
    for (const file of files) visit(program.getSourceFile(file)!);
    assert.ok(links > 500, `only ${links} links found`);
    assert.deepEqual([...wrong], []);
  },
);
