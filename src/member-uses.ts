/**
 * Where a plugin's TypeScript uses SDK members: the type-aware resolution
 * the capability scan (`capability-scan.ts`) reads a plugin's code with. A
 * use is a property access, an element access with a literal name or a
 * destructured property whose symbol is the SDK's declaration of a member
 * asked for, however the object was reached (`plugin.player.seek`,
 * `const { player } = plugin; player.seek`, a parameter typed `Player`, a
 * `Panel` from `panels.mount`). Not detected: access with a computed name
 * (`player[name]`), values typed `any` or `unknown`, plain JavaScript
 * without types.
 *
 * Requests sent by name (`plugin.wire.request`) are found too, with the
 * method when its type fixes it to one string.
 *
 * The TypeScript module is passed in, never imported: the CLI uses the
 * SDK's own compiler.
 *
 * @internal
 */
import type TS from "typescript";

/** @internal The module plugins import the API types from. */
export const SDK_MODULE = "@vestra-player/sdk";

/** The members that send a request by the method name they are given. */
const SENDERS = ["Wire.request"];

type Members = Map<TS.Declaration, string>;

/**
 * The module `@vestra-player/sdk` as the program resolved it: from the
 * first import or export of it in the program's own (non-declaration) files.
 */
function sdkModule(
  ts: typeof TS,
  program: TS.Program,
  checker: TS.TypeChecker,
): TS.Symbol | undefined {
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile || program.isSourceFileFromExternalLibrary(file))
      continue;
    for (const statement of file.statements) {
      const specifier =
        ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)
          ? statement.moduleSpecifier
          : undefined;
      if (
        specifier &&
        ts.isStringLiteral(specifier) &&
        specifier.text === SDK_MODULE
      ) {
        const module = checker.getSymbolAtLocation(specifier);
        if (module) return module;
      }
    }
  }
  return undefined;
}

/** The SDK's declarations of the members named (`Interface.member`). */
function resolveMembers(
  ts: typeof TS,
  program: TS.Program,
  apis: Iterable<string>,
): Members {
  const members: Members = new Map();
  const checker = program.getTypeChecker();
  const module = sdkModule(ts, program, checker);
  if (!module) return members;
  const exports = new Map<string, TS.Symbol>();
  for (const symbol of checker.getExportsOfModule(module))
    exports.set(
      symbol.name,
      symbol.flags & ts.SymbolFlags.Alias
        ? checker.getAliasedSymbol(symbol)
        : symbol,
    );
  for (const api of apis) {
    const [head, ...path] = api.split(".");
    const root = exports.get(head!);
    if (!root || !path.length) continue;
    let type: TS.Type | undefined = checker.getDeclaredTypeOfSymbol(root);
    let property: TS.Symbol | undefined;
    for (const name of path) {
      property = type?.getProperty(name);
      type = property && checker.getTypeOfSymbol(property);
    }
    for (const declaration of property?.declarations ?? [])
      if (!members.has(declaration)) members.set(declaration, api);
  }
  return members;
}

/**
 * The strings an expression's type fixes: a string literal, a constant of
 * one, or a union of them (the caller takes one only); `undefined` when
 * the type allows any other.
 */
function literalStrings(
  ts: typeof TS,
  checker: TS.TypeChecker,
  node: TS.Expression | undefined,
): string[] | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteralLike(node)) return [node.text];
  const type = checker.getTypeAtLocation(node);
  const parts = type.isUnion() ? type.types : [type];
  const values: string[] = [];
  for (const part of parts) {
    if (!part.isStringLiteral()) return undefined;
    values.push(part.value);
  }
  return values.length ? values : undefined;
}

/** @internal One use of an SDK member, where {@link findMemberUses} found it. */
export interface MemberUse {
  readonly file: string;
  /** 1-based line and column of the member's name. */
  readonly line: number;
  readonly column: number;
  /** The member, as it was asked for (`Clipboard.readText`). */
  readonly api: string;
}

/**
 * @internal A request sent by name (`plugin.wire.request("clipboard.readText")`):
 * the method when the types fix it to one string, else `undefined` (a
 * computed name, a union of several, the member taken as a value).
 */
export interface RequestUse {
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly method: string | undefined;
}

/**
 * Every use, in `files`, of the SDK members named by `apis`
 * (`Interface.member`), and every request sent by name (`Wire.request`),
 * in file and position order. It reads no manifest (the capability scan,
 * `capability-scan.ts`, gives it its lists).
 *
 * `resolved` is `false` when the program has no import of
 * `@vestra-player/sdk` that resolves: nothing can be found by type then.
 *
 * @internal
 */
export function findMemberUses(
  ts: typeof TS,
  program: TS.Program,
  options: {
    readonly files: readonly string[];
    readonly apis: Iterable<string>;
  },
): { resolved: boolean; uses: MemberUse[]; requests: RequestUse[] } {
  const uses: MemberUse[] = [];
  const requests: RequestUse[] = [];
  const members = resolveMembers(ts, program, options.apis);
  const senders = resolveMembers(ts, program, SENDERS);
  const resolved = members.size > 0 || senders.size > 0;
  if (!resolved) return { resolved, uses, requests };
  const checker = program.getTypeChecker();
  const apiOf = (table: Members, symbol: TS.Symbol | undefined) => {
    for (const declaration of symbol?.declarations ?? []) {
      const api = table.get(declaration);
      if (api) return api;
    }
    return undefined;
  };
  for (const fileName of options.files) {
    const file = program.getSourceFile(fileName);
    if (!file) continue;
    const position = (name: TS.Node) => {
      const { line, character } = file.getLineAndCharacterOfPosition(
        name.getStart(file),
      );
      return { file: file.fileName, line: line + 1, column: character + 1 };
    };
    const seen = (name: TS.Node, symbol: TS.Symbol | undefined) => {
      const api = apiOf(members, symbol);
      if (api) uses.push({ ...position(name), api });
      if (!apiOf(senders, symbol)) return;
      // A direct call with one literal name is a request of that name;
      // anything else (a computed name, the member taken as a value) is a
      // request the scan cannot name.
      const access = name.parent;
      const call = access?.parent;
      const direct =
        access &&
        (ts.isPropertyAccessExpression(access) ||
          ts.isElementAccessExpression(access)) &&
        call &&
        ts.isCallExpression(call) &&
        call.expression === access
          ? call
          : undefined;
      const values = direct
        ? literalStrings(ts, checker, direct.arguments[0])
        : undefined;
      requests.push({
        ...position(name),
        method: values?.length === 1 ? values[0] : undefined,
      });
    };
    const visit = (node: TS.Node): void => {
      if (ts.isPropertyAccessExpression(node))
        seen(node.name, checker.getSymbolAtLocation(node.name));
      else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression)
      )
        seen(
          node.argumentExpression,
          checker.getSymbolAtLocation(node.argumentExpression),
        );
      else if (
        ts.isBindingElement(node) &&
        ts.isObjectBindingPattern(node.parent)
      ) {
        const name = node.propertyName ?? node.name;
        const text =
          ts.isIdentifier(name) || ts.isStringLiteralLike(name)
            ? name.text
            : undefined;
        if (text !== undefined)
          seen(name, checker.getTypeAtLocation(node.parent).getProperty(text));
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return { resolved, uses, requests };
}
