/**
 * The capability checker: every use of a plugin API member whose capability
 * the plugin's `manifest.json` does not declare. `vestra-plugin check` (and
 * so `build` and `pack`) and the TypeScript language-service plugin
 * (`@vestra-player/sdk/ts-plugin`) both run it; the rule is
 * `capability-rules.ts` (the player's table and the SDK's requests).
 *
 * It is type-aware: a use is a property access, an element access with a
 * literal name or a destructured property whose symbol is the SDK's
 * declaration of a member in the table, however the object was reached
 * (`plugin.player.seek`, `const { player } = plugin; player.seek`, a
 * parameter typed `Player`, a `Panel` from `panels.mount`). Not detected:
 * access with a computed name (`player[name]`), values typed `any` or
 * `unknown`, plain JavaScript without types, members inherited from `View`
 * (their object comes from a call that is checked) and options that need
 * more (a `processed` capture, a file resolver).
 *
 * The TypeScript module is passed in, never imported: the CLI uses the
 * SDK's own compiler, the editor its TypeScript server's.
 *
 * @internal
 */
import type TS from "typescript";
import { memberNeeds, RULES } from "./capability-rules.ts";
import type { CapabilityRules } from "./capability-rules.ts";

/** @internal The module plugins import the API types from. */
export const SDK_MODULE = "@vestra-player/sdk";

/** @internal The diagnostic code the editor shows (and its quick fix keys on). */
export const CAPABILITY_DIAGNOSTIC = 95_301;

/** @internal One use of a member whose capability is not declared. */
export interface CapabilityFinding {
  /** The source file, as the program names it. */
  readonly file: string;
  /** 1-based line and column of the member's name. */
  readonly line: number;
  readonly column: number;
  /** Offset and length of the member's name in the file. */
  readonly start: number;
  readonly length: number;
  /** The member, `Interface.member` (`Player.seek`). */
  readonly api: string;
  /** The capability to declare. */
  readonly capability: string;
  /** The request that needs it. */
  readonly method: string;
  /** The declared-or-needed capability whose `requires` names it. */
  readonly requiredBy?: string;
  /** One line for people. */
  readonly message: string;
}

/** @internal */
export interface CheckOptions {
  /** The files to check (others in the program are only read for types). */
  readonly files: readonly string[];
  /** The manifest's `capabilities`. */
  readonly capabilities: readonly string[];
  /** Default: the SDK's rules. */
  readonly rules?: CapabilityRules;
}

type Members = Map<TS.Declaration, string>;
const memberCache = new WeakMap<TS.Program, Members>();

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

/** The SDK's declarations of the members in the table. */
function sdkMembers(
  ts: typeof TS,
  program: TS.Program,
  rules: CapabilityRules,
): Members {
  const cached = memberCache.get(program);
  if (cached && rules === RULES) return cached;
  const members: Members = new Map();
  const checker = program.getTypeChecker();
  const module = sdkModule(ts, program, checker);
  if (module) {
    const exports = new Map<string, TS.Symbol>();
    for (const symbol of checker.getExportsOfModule(module))
      exports.set(
        symbol.name,
        symbol.flags & ts.SymbolFlags.Alias
          ? checker.getAliasedSymbol(symbol)
          : symbol,
      );
    for (const api of Object.keys(rules.apis)) {
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
  }
  if (rules === RULES) memberCache.set(program, members);
  return members;
}

/**
 * Every use, in `options.files`, of a member whose capability the manifest
 * does not declare, in file and position order.
 *
 * @internal
 */
export function findUndeclaredCapabilities(
  ts: typeof TS,
  program: TS.Program,
  options: CheckOptions,
): CapabilityFinding[] {
  const rules = options.rules ?? RULES;
  const files = options.files
    .map((file) => program.getSourceFile(file))
    .filter((file): file is TS.SourceFile => !!file);
  if (!files.length) return [];
  const members = sdkMembers(ts, program, rules);
  if (!members.size) return [];
  const checker = program.getTypeChecker();
  const findings: CapabilityFinding[] = [];
  const memberOf = (symbol: TS.Symbol | undefined) => {
    for (const declaration of symbol?.declarations ?? []) {
      const api = members.get(declaration);
      if (api) return api;
    }
    return undefined;
  };
  for (const file of files) {
    const report = (name: TS.Node, symbol: TS.Symbol | undefined) => {
      const api = memberOf(symbol);
      if (!api) return;
      const start = name.getStart(file);
      const { line, character } = file.getLineAndCharacterOfPosition(start);
      for (const need of memberNeeds(api, options.capabilities, rules) ?? []) {
        if (options.capabilities.includes(need.capability)) continue;
        findings.push({
          file: file.fileName,
          line: line + 1,
          column: character + 1,
          start,
          length: name.getEnd() - start,
          api,
          capability: need.capability,
          method: need.method,
          ...(need.requiredBy ? { requiredBy: need.requiredBy } : {}),
          message: need.requiredBy
            ? `${api} needs the capability "${need.capability}" (required by "${need.requiredBy}"), which manifest.json does not declare`
            : `${api} needs the capability "${need.capability}", which manifest.json does not declare`,
        });
      }
    };
    const visit = (node: TS.Node): void => {
      if (ts.isPropertyAccessExpression(node))
        report(node.name, checker.getSymbolAtLocation(node.name));
      else if (
        ts.isElementAccessExpression(node) &&
        ts.isStringLiteralLike(node.argumentExpression)
      )
        report(
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
          report(
            name,
            checker.getTypeAtLocation(node.parent).getProperty(text),
          );
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return findings;
}

/**
 * Whether a file belongs to the plugin's production code, given the
 * directory of its `manifest.json`: not in `tests/`, `node_modules/`,
 * `dist/`, `vendor/` or a dot directory (what `vestra-plugin build` leaves
 * out), and not a declaration file.
 *
 * @internal
 */
export function isPluginSource(directory: string, file: string): boolean {
  const normal = (path: string) =>
    path.replaceAll("\\", "/").replace(/\/$/, "");
  const base = normal(directory);
  const path = normal(file);
  const caseless = /^[a-z]:\//i.test(path);
  const same = (a: string, b: string) =>
    caseless ? a.toLowerCase() === b.toLowerCase() : a === b;
  if (!same(path.slice(0, base.length + 1), `${base}/`)) return false;
  if (/\.d\.[mc]?ts$/.test(path) || !/\.[mc]?tsx?$/.test(path)) return false;
  const parts = path
    .slice(base.length + 1)
    .split("/")
    .slice(0, -1);
  return !parts.some(
    (part) =>
      part.startsWith(".") ||
      ["tests", "node_modules", "dist", "vendor"].includes(part),
  );
}

/**
 * The edit that adds a capability to a manifest's `capabilities` array, in
 * the array's own layout; `undefined` when the text has no such array.
 *
 * @internal
 */
export function addCapabilityEdit(
  ts: typeof TS,
  text: string,
  capability: string,
): { start: number; length: number; newText: string } | undefined {
  const json = ts.parseJsonText("manifest.json", text);
  const root = json.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) return undefined;
  const property = root.properties.find(
    (each): each is TS.PropertyAssignment =>
      ts.isPropertyAssignment(each) &&
      ts.isStringLiteral(each.name) &&
      each.name.text === "capabilities",
  );
  const array = property?.initializer;
  if (!array || !ts.isArrayLiteralExpression(array)) return undefined;
  const quoted = JSON.stringify(capability);
  const last = array.elements.at(-1);
  if (!last) {
    const start = array.getStart(json);
    return {
      start,
      length: array.getEnd() - start,
      newText: `[${quoted}]`,
    };
  }
  const first = array.elements[0]!;
  const lineStart = text.lastIndexOf("\n", first.getStart(json)) + 1;
  const multiline = text
    .slice(array.getStart(json), first.getStart(json))
    .includes("\n");
  const indent = text.slice(lineStart, first.getStart(json));
  return {
    start: last.getEnd(),
    length: 0,
    // The manifest's own line endings (CRLF on many Windows checkouts).
    newText: multiline
      ? `,${text.includes("\r\n") ? "\r\n" : "\n"}${indent}${quoted}`
      : `, ${quoted}`,
  };
}
