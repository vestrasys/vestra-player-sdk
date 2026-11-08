#!/usr/bin/env node
/**
 * The public API surface as a sorted text snapshot (characterisation test,
 * doc/specs/sdk-refactor.md §4.0 in the player repository):
 *
 *   node scripts/api-surface.mjs            # print it
 *   node scripts/api-surface.mjs --update   # write test/fixtures/api-surface.txt
 *   node scripts/api-surface.mjs --check    # exit 1 when the file differs
 *
 * Reads the built declaration files of the two public entries, found
 * through the `types` of their `exports` in package.json as a consumer's
 * compiler finds them: `@vestra-player/sdk` (`dist/index.d.ts`, which
 * re-exports `dist/plugin/types.d.ts`) and `@vestra-player/sdk/testing`,
 * with the TypeScript compiler API, and
 * lists every exported declaration with its signature: for an interface
 * or class each member on its own line, for a type alias, function,
 * variable or enum the whole declaration. Comments are dropped, whitespace
 * is normalised, lines are sorted, so the output depends only on the
 * declared surface, not on where a declaration lives or how it is
 * formatted. Re-exports are followed, so a type moved between files prints
 * the same line. `npm run build` first.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const require = createRequire(join(root, "package.json"));
/** @type {import("typescript")} */
const ts = require("typescript");

const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
/** An entry's declaration file, as package.json `exports` names it. */
function types(subpath) {
  const target = manifest.exports?.[subpath]?.types;
  if (typeof target !== "string")
    throw new Error(`package.json exports["${subpath}"] has no types`);
  return join(root, target);
}
const ENTRIES = {
  "@vestra-player/sdk": types("."),
  "@vestra-player/sdk/testing": types("./testing"),
};
const FIXTURE = join(root, "test/fixtures/api-surface.txt");

for (const file of Object.values(ENTRIES))
  if (!existsSync(file)) {
    console.error(`${file} is missing; run \`npm run build\` first`);
    process.exit(1);
  }

const program = ts.createProgram(Object.values(ENTRIES), {
  target: ts.ScriptTarget.ES2023,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  skipLibCheck: true,
  noEmit: true,
});
const checker = program.getTypeChecker();
const printer = ts.createPrinter({ removeComments: true });

/** One line of text for a node, comments dropped, whitespace normalised. */
function text(node) {
  return printer
    .printNode(ts.EmitHint.Unspecified, node, node.getSourceFile())
    .replace(/\s+/g, " ")
    .trim();
}

/** A declaration's lines: `name: member` per member, else the whole thing. */
function lines(entry, name, declaration) {
  const out = [];
  const kind = ts.SyntaxKind[declaration.kind];
  if (
    ts.isInterfaceDeclaration(declaration) ||
    ts.isClassDeclaration(declaration)
  ) {
    const heritage = (declaration.heritageClauses ?? [])
      .map((clause) => text(clause))
      .join(" ");
    const params = declaration.typeParameters
      ? `<${declaration.typeParameters.map(text).join(", ")}>`
      : "";
    out.push(
      `${entry} ${kind} ${name}${params}${heritage ? ` ${heritage}` : ""}`,
    );
    for (const member of declaration.members) {
      // A private (`#x`) or `private` member is not part of the surface.
      if (member.name && ts.isPrivateIdentifier(member.name)) continue;
      if (
        ts.canHaveModifiers(member) &&
        ts
          .getModifiers(member)
          ?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword)
      )
        continue;
      out.push(`${entry} ${kind} ${name} :: ${text(member)}`);
    }
  } else if (ts.isModuleDeclaration(declaration)) {
    out.push(`${entry} ${kind} ${name}`);
    const body = declaration.body;
    if (body && ts.isModuleBlock(body))
      for (const statement of body.statements)
        out.push(`${entry} ${kind} ${name} :: ${text(statement)}`);
  } else {
    out.push(`${entry} ${kind} ${name} = ${text(declaration)}`);
  }
  return out;
}

const all = [];
for (const [entry, file] of Object.entries(ENTRIES)) {
  const source = program.getSourceFile(file);
  const symbol = checker.getSymbolAtLocation(source);
  if (!symbol) throw new Error(`no module symbol for ${file}`);
  for (const exported of checker.getExportsOfModule(symbol)) {
    const name = exported.name;
    // Follow an alias (a re-export) to the declaration itself.
    const target =
      exported.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(exported)
        : exported;
    const declarations = target.declarations ?? [];
    if (declarations.length === 0) {
      all.push(
        `${entry} ${name} = ${checker.typeToString(checker.getTypeOfSymbol(target))}`,
      );
      continue;
    }
    for (const declaration of declarations)
      all.push(...lines(entry, name, declaration));
  }
}

const output = `${[...new Set(all)].sort().join("\n")}\n`;

const mode = process.argv[2];
if (mode === "--update") {
  writeFileSync(FIXTURE, output);
  console.log(`wrote ${FIXTURE} (${output.split("\n").length - 1} lines)`);
} else if (mode === "--check") {
  const current = existsSync(FIXTURE) ? readFileSync(FIXTURE, "utf8") : "";
  if (current !== output) {
    const was = new Set(current.split("\n"));
    const now = new Set(output.split("\n"));
    for (const line of was) if (!now.has(line)) console.error(`- ${line}`);
    for (const line of now) if (!was.has(line)) console.error(`+ ${line}`);
    console.error(
      `\n${FIXTURE} differs from dist/; if the change is intended, run \`node scripts/api-surface.mjs --update\``,
    );
    process.exit(1);
  }
  console.log(`${FIXTURE} matches dist/`);
} else {
  process.stdout.write(output);
}
