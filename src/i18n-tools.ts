/**
 * `vestra-plugin i18n extract` and `vestra-plugin i18n check`, and the
 * catalog step of `vestra-plugin build` (docs/how-to/i18n.md): find the
 * translatable texts of a plugin, keep `locales/messages.pot` and
 * `locales/<lang>.po` up to date, warn about what cannot be translated, and
 * compile the `.po` files the player reads.
 *
 * Translatable texts are the `@tr` calls of the plugin's `.slint` files, the
 * declaration fields and sentences it hands the player (`commands.add`
 * title, path and reason, `Command.set` reason, `settings.page` and
 * `panels.mount` titles, `osd.show`, `OsdPanel.set`, `dialogs.*` texts) and
 * the manifest's display fields. Plugins write no translation code: the
 * player translates these with the plugin's catalog.
 *
 * @internal
 * @module
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import {
  compileCatalog,
  keyOf,
  LOCALES,
  parsePo,
  placeholders,
  scanSlint,
  writePo,
} from "./i18n.ts";
import type { PoEntry } from "./i18n.ts";

/** A translatable text found in the sources. */
export interface Message {
  context?: string;
  id: string;
  plural?: string;
  /** `#.` notes (from `TRANSLATORS:` comments). */
  notes: string[];
  /** `path:line` (or `manifest.json`), relative to the plugin, sorted. */
  references: string[];
}

/** Something extraction or the heuristics want the author to look at. */
export interface Finding {
  /** Relative path, forward slashes. */
  file: string;
  line: number;
  kind: "dynamic" | "composed" | "not-english" | "slint-text";
  message: string;
}

export interface ExtractOptions {
  /** The plugin directory. */
  directory: string;
  /** The plugin's `manifest.json` (display fields are extracted). */
  manifest: Record<string, unknown>;
  /** The plugin's `.slint` files, relative to `directory`. */
  slint: readonly string[];
  /** The plugin's production `.ts` / `.mts` files, relative to `directory`. */
  typescript: readonly string[];
  /** Compiler options for a program over those files (as `check` uses). */
  compilerOptions?: ts.CompilerOptions;
}

/** Locales whose plural has one form (`n == 1` and other are the same). */
const ONE_FORM = new Set(["zh-Hans", "ja", "ko"]);

export const pluralForms = (language: string) =>
  ONE_FORM.has(language)
    ? "nplurals=1; plural=0;"
    : "nplurals=2; plural=(n != 1);";

const slash = (path: string) => path.split(sep).join("/");

const CJK =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

const COMPOSED =
  'user-visible text composed in TypeScript: pass a template with args (osd.show("Speed {}×", [rate])) or move it into Slint';
const DYNAMIC = (what: string) =>
  `${what} is not a literal; its text cannot be extracted (use a string literal or an \`as const\` table)`;

/** Where a call site's texts are: an object argument's fields, or an argument. */
type Site =
  | { object: number; fields: readonly string[]; path?: boolean }
  | { argument: number };

const SITES: Record<string, Site> = {
  "Commands.add": { object: 0, fields: ["title", "reason"], path: true },
  "Command.set": { object: 0, fields: ["reason"] },
  "Settings.page": { object: 1, fields: ["title"] },
  "Panels.mount": { object: 2, fields: ["title"] },
  "Osd.show": { argument: 0 },
  "OsdPanel.set": { argument: 0 },
  "Dialogs.confirm": {
    object: 0,
    fields: ["message", "detail", "confirm", "cancel", "checkbox"],
  },
  "Dialogs.openFile": { object: 0, fields: ["title"] },
  "Dialogs.openFiles": { object: 0, fields: ["title"] },
  "Dialogs.openDirectory": { object: 0, fields: ["title"] },
  "Dialogs.saveFile": { object: 0, fields: ["title"] },
};

/** Without the SDK's types: the module property names in front of the method. */
const BY_NAME: Record<string, string> = {
  "commands.add": "Commands.add",
  "settings.page": "Settings.page",
  "panels.mount": "Panels.mount",
  "osd.show": "Osd.show",
  "dialogs.confirm": "Dialogs.confirm",
  "dialogs.openFile": "Dialogs.openFile",
  "dialogs.openFiles": "Dialogs.openFiles",
  "dialogs.openDirectory": "Dialogs.openDirectory",
  "dialogs.saveFile": "Dialogs.saveFile",
};

/** The value(s) an expression can have, as far as the source tells. */
interface Values {
  values: string[];
  dynamic: boolean;
  composed: boolean;
}
const none = (): Values => ({ values: [], dynamic: false, composed: false });
const join2 = (a: Values, b: Values): Values => ({
  values: [...a.values, ...b.values],
  dynamic: a.dynamic || b.dynamic,
  composed: a.composed || b.composed,
});

function notesOf(node: ts.Node, text: string): string[] {
  const notes: string[] = [];
  for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ??
    []) {
    const comment = text.slice(range.pos, range.end);
    const at = comment.indexOf("TRANSLATORS:");
    if (at < 0) continue;
    const note = comment
      .slice(at + "TRANSLATORS:".length)
      .replace(/\*\/\s*$/, "")
      .split("\n")
      .map((line) => line.replace(/^\s*(\*|\/\/)?\s?/, "").trim())
      .filter(Boolean)
      .join(" ");
    if (note) notes.push(note);
  }
  return notes;
}

/**
 * An `i18n-ignore` comment before the node: the text is not to be
 * translated (a language's own name, a product name). `extract` leaves it
 * out and `check` does not warn about it.
 */
function ignored(node: ts.Node, text: string): boolean {
  // The trivia before the node (getLeadingCommentRanges leaves out a
  // comment on the same line as the previous token).
  return text
    .slice(node.getFullStart(), node.getStart())
    .includes("i18n-ignore");
}

/** The statement (or class member) a node belongs to. */
function statementOf(node: ts.Node): ts.Node {
  let current = node;
  while (
    current.parent &&
    !ts.isSourceFile(current.parent) &&
    !ts.isBlock(current.parent)
  )
    current = current.parent;
  return current;
}

class Extractor {
  readonly found: (Message & { file: string; line: number })[] = [];
  readonly findings: Finding[] = [];
  readonly #checker: ts.TypeChecker | undefined;
  constructor(checker: ts.TypeChecker | undefined) {
    this.#checker = checker;
  }

  add(file: string, line: number, message: Omit<Message, "references">) {
    this.found.push({ ...message, file, line, references: [] });
  }

  finding(file: string, line: number, kind: Finding["kind"], message: string) {
    if (
      this.findings.some(
        (f) => f.file === file && f.line === line && f.kind === kind,
      )
    )
      return;
    this.findings.push({ file, line, kind, message });
  }

  /** Values of a type: string literals, or a union of them (null and undefined ignored). */
  #fromType(type: ts.Type, depth = 0): Values {
    const result = none();
    const parts = type.isUnion() ? type.types : [type];
    for (const part of parts) {
      if (part.isStringLiteral()) result.values.push(part.value);
      else if (
        part.flags &
        (ts.TypeFlags.Null |
          ts.TypeFlags.Undefined |
          ts.TypeFlags.Void |
          ts.TypeFlags.Never)
      )
        continue;
      else if (depth === 0 && part.getCallSignatures().length) {
        for (const signature of part.getCallSignatures())
          Object.assign(
            result,
            join2(result, this.#fromType(signature.getReturnType(), 1)),
          );
      } else result.dynamic = true;
    }
    return result;
  }

  values(node: ts.Expression): Values {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
      return { values: [node.text], dynamic: false, composed: false };
    if (ts.isTemplateExpression(node))
      return { values: [], dynamic: false, composed: true };
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node) ||
      ts.isTypeAssertionExpression(node)
    )
      return this.values(node.expression);
    if (ts.isConditionalExpression(node))
      return join2(this.values(node.whenTrue), this.values(node.whenFalse));
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (
        op === ts.SyntaxKind.QuestionQuestionToken ||
        op === ts.SyntaxKind.BarBarToken
      )
        return join2(this.values(node.left), this.values(node.right));
      if (op === ts.SyntaxKind.PlusToken) {
        const stringy = (side: ts.Expression) =>
          ts.isStringLiteralLike(side) ||
          ts.isTemplateExpression(side) ||
          (this.#checker &&
            this.#checker.getTypeAtLocation(side).flags &
              ts.TypeFlags.StringLike);
        if (stringy(node.left) || stringy(node.right))
          return { values: [], dynamic: false, composed: true };
      }
    }
    if (
      node.kind === ts.SyntaxKind.NullKeyword ||
      (ts.isIdentifier(node) && node.text === "undefined")
    )
      return none();
    if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
      if (!ts.isBlock(node.body)) return this.values(node.body);
      let result = none();
      const visit = (child: ts.Node) => {
        if (ts.isFunctionLike(child)) return;
        if (ts.isReturnStatement(child) && child.expression)
          result = join2(result, this.values(child.expression));
        ts.forEachChild(child, visit);
      };
      ts.forEachChild(node.body, visit);
      return result;
    }
    if (this.#checker)
      return this.#fromType(this.#checker.getTypeAtLocation(node));
    return { values: [], dynamic: true, composed: false };
  }

  /** The elements of a menu path: each segment's values, the leading `@id` skipped. */
  #path(node: ts.Expression, file: string, source: ts.SourceFile) {
    const add = (values: Values, at: ts.Node, first: boolean) => {
      this.#emit(
        values,
        at,
        file,
        source,
        "a menu path segment",
        (value) => !(first && value.startsWith("@")),
      );
    };
    const inner = (expr: ts.Expression): ts.Expression =>
      ts.isParenthesizedExpression(expr) ||
      ts.isAsExpression(expr) ||
      ts.isSatisfiesExpression(expr)
        ? inner(expr.expression)
        : expr;
    const array = inner(node);
    if (ts.isArrayLiteralExpression(array)) {
      array.elements.forEach((element, index) => {
        if (ts.isSpreadElement(element)) {
          this.#tuple(element.expression, file, source, index === 0);
          return;
        }
        if (ignored(element, source.text)) return;
        add(this.values(element), element, index === 0);
      });
      return;
    }
    this.#tuple(array, file, source, true);
  }

  /** A path given as a value: a tuple or array type of string literals. */
  #tuple(
    node: ts.Expression,
    file: string,
    source: ts.SourceFile,
    first: boolean,
  ) {
    const checker = this.#checker;
    const values = none();
    if (checker) {
      const type = checker.getTypeAtLocation(node);
      const elements =
        checker.isTupleType(type) || checker.isArrayType(type)
          ? checker.getTypeArguments(type as ts.TypeReference)
          : undefined;
      if (elements)
        elements.forEach((element, index) => {
          const found = this.#fromType(element);
          found.values = found.values.filter(
            (value) => !(first && index === 0 && value.startsWith("@")),
          );
          Object.assign(values, join2(values, found));
        });
      else values.dynamic = true;
    } else values.dynamic = true;
    this.#emit(values, node, file, source, "a menu path", () => true);
  }

  #emit(
    values: Values,
    at: ts.Node,
    file: string,
    source: ts.SourceFile,
    what: string,
    keep: (value: string) => boolean,
    notes: string[] = [],
  ) {
    const line =
      source.getLineAndCharacterOfPosition(at.getStart(source)).line + 1;
    for (const value of values.values)
      if (value.trim() !== "" && keep(value))
        this.add(file, line, { id: value, notes });
    if (values.composed) this.finding(file, line, "composed", COMPOSED);
    else if (values.dynamic) this.finding(file, line, "dynamic", DYNAMIC(what));
  }

  /** `Interface.method` of a call to the SDK, if it is one of `SITES`. */
  #site(call: ts.CallExpression): string | undefined {
    const callee = call.expression;
    if (!ts.isPropertyAccessExpression(callee)) return undefined;
    const method = callee.name.text;
    const declaration = this.#checker?.getResolvedSignature(call)?.declaration;
    if (
      declaration &&
      !ts.isJSDocSignature(declaration) &&
      declaration.parent &&
      ts.isInterfaceDeclaration(declaration.parent)
    ) {
      const file = slash(declaration.getSourceFile().fileName);
      if (/\/plugin\/types\.(d\.)?ts$/.test(file)) {
        const name = `${declaration.parent.name.text}.${method}`;
        return name in SITES ? name : undefined;
      }
    }
    // No SDK types (an untyped or broken program): by property names.
    if (declaration) return undefined;
    const owner = callee.expression;
    const ownerName = ts.isPropertyAccessExpression(owner)
      ? owner.name.text
      : ts.isIdentifier(owner)
        ? owner.text
        : "";
    return BY_NAME[`${ownerName}.${method}`];
  }

  typescript(file: string, source: ts.SourceFile) {
    const text = source.text;
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) this.#call(node, file, source, text);
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        CJK.test(node.text) &&
        !ts.isImportDeclaration(node.parent) &&
        !ts.isExportDeclaration(node.parent) &&
        !ignored(node, text) &&
        !ignored(node.parent, text) &&
        !ignored(statementOf(node), text)
      )
        this.finding(
          file,
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          "not-english",
          "not English: English is the source text",
        );
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  #call(
    call: ts.CallExpression,
    file: string,
    source: ts.SourceFile,
    text: string,
  ) {
    const name = this.#site(call);
    if (!name) return;
    const site = SITES[name]!;
    if (ignored(statementOf(call), text)) return;
    const statementNotes = notesOf(statementOf(call), text);
    if ("argument" in site) {
      const argument = call.arguments[site.argument];
      if (!argument || ignored(argument, text)) return;
      this.#emit(
        this.values(argument),
        argument,
        file,
        source,
        `the text of ${name}`,
        () => true,
        [...statementNotes, ...notesOf(argument, text)],
      );
      return;
    }
    const argument = call.arguments[site.object];
    if (!argument) return;
    const fields = [...site.fields, ...(site.path ? ["path"] : [])];
    const object = ts.isObjectLiteralExpression(argument) ? argument : null;
    if (!object) {
      // An options object built elsewhere: its fields' types.
      const checker = this.#checker;
      if (!checker) return;
      const type = checker.getTypeAtLocation(argument);
      for (const field of fields) {
        const symbol = type.getProperty(field);
        if (!symbol) continue;
        const fieldType = checker.getTypeOfSymbolAtLocation(symbol, argument);
        if (field === "path") continue;
        this.#emit(
          this.#fromType(fieldType),
          argument,
          file,
          source,
          `${field} of ${name}`,
          () => true,
          statementNotes,
        );
      }
      return;
    }
    for (const property of object.properties) {
      const key =
        property.name &&
        (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
          ? property.name.text
          : undefined;
      if (!key || !fields.includes(key) || ignored(property, text)) continue;
      let value: ts.Expression | undefined;
      if (ts.isPropertyAssignment(property)) value = property.initializer;
      else if (ts.isShorthandPropertyAssignment(property))
        value = property.name;
      else if (ts.isMethodDeclaration(property) && property.body) {
        // `reason() { return … }`
        const values = none();
        const visit = (child: ts.Node) => {
          if (ts.isFunctionLike(child)) return;
          if (ts.isReturnStatement(child) && child.expression)
            Object.assign(values, join2(values, this.values(child.expression)));
          ts.forEachChild(child, visit);
        };
        ts.forEachChild(property.body, visit);
        this.#emit(
          values,
          property,
          file,
          source,
          `${key} of ${name}`,
          () => true,
          [...statementNotes, ...notesOf(property, text)],
        );
        continue;
      }
      if (!value) continue;
      const notes = [...statementNotes, ...notesOf(property, text)];
      if (key === "path") {
        const before = this.found.length;
        this.#path(value, file, source);
        for (const message of this.found.slice(before))
          message.notes = [...message.notes, ...notes];
        continue;
      }
      this.#emit(
        this.values(value),
        value,
        file,
        source,
        `${key} of ${name}`,
        () => true,
        notes,
      );
    }
  }

  slint(file: string, text: string) {
    const lines = text.split("\n");
    for (const call of scanSlint(text)) {
      const above = lines[call.line - 2] ?? "";
      const at = above.indexOf("TRANSLATORS:");
      const notes =
        at >= 0 && /^\s*\/\//.test(above)
          ? [above.slice(at + "TRANSLATORS:".length).trim()].filter(Boolean)
          : [];
      const message: Omit<Message, "references"> = { id: call.id, notes };
      if (call.context !== undefined) message.context = call.context;
      if (call.plural !== undefined) message.plural = call.plural;
      this.add(file, call.line, message);
    }
    // Heuristics on the string literals that are not @tr texts.
    const translated = new Set<number>();
    for (const call of scanSlint(text)) {
      translated.add(call.idSpan[0]);
      if (call.pluralSpan) translated.add(call.pluralSpan[0]);
    }
    for (const literal of slintLiterals(text)) {
      if (translated.has(literal.start)) continue;
      const line = text.slice(0, literal.start).split("\n").length;
      const before = text.slice(
        text.lastIndexOf("\n", literal.start - 1) + 1,
        literal.start,
      );
      // `@tr("context" => …)` contexts are not texts either.
      if (/@tr\s*\(\s*$/.test(before)) continue;
      // `// i18n-ignore` on the line or the line above: not to be translated.
      const lineStart = text.lastIndexOf("\n", literal.start - 1) + 1;
      const lineEnd = text.indexOf("\n", literal.start);
      const above = text.slice(
        text.lastIndexOf("\n", Math.max(0, lineStart - 2)) + 1,
        lineStart,
      );
      if (
        text
          .slice(lineStart, lineEnd < 0 ? text.length : lineEnd)
          .includes("i18n-ignore") ||
        /^\s*\/\/.*i18n-ignore/.test(above)
      )
        continue;
      if (CJK.test(literal.value))
        this.finding(
          file,
          line,
          "not-english",
          "not English: English is the source text",
        );
      else if (
        /\p{L}/u.test(literal.value) &&
        /(?:^|[\s;{])(text|title|placeholder|tip|label|confirm-text|cancel-text)\s*:\s*$/.test(
          before,
        )
      )
        this.finding(
          file,
          line,
          "slint-text",
          `Slint text without @tr: "${literal.value}"`,
        );
    }
  }
}

/** The plain string literals of a Slint source (not interpolated ones). */
function slintLiterals(text: string): { start: number; value: string }[] {
  const found: { start: number; value: string }[] = [];
  const templates: number[] = [];
  let i = 0;
  const string = (from: number, start: number | null) => {
    let j = from;
    while (j < text.length) {
      if (text[j] === '"') {
        if (start !== null)
          found.push({ start, value: text.slice(start + 1, j) });
        return j + 1;
      }
      if (text[j] === "\\" && text[j + 1] === "{") {
        templates.push(0);
        return j + 2;
      }
      j += text[j] === "\\" ? 2 : 1;
    }
    return text.length;
  };
  while (i < text.length) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      i = end < 0 ? text.length : end;
    } else if (c === "/" && text[i + 1] === "*") {
      let depth = 0;
      i += 2;
      while (i < text.length) {
        if (text.startsWith("/*", i)) {
          depth++;
          i += 2;
        } else if (text.startsWith("*/", i)) {
          i += 2;
          if (depth-- === 0) break;
        } else i++;
      }
    } else if (c === '"') i = string(i + 1, i);
    else if (c === "{" && templates.length) {
      templates[templates.length - 1]!++;
      i++;
    } else if (c === "}" && templates.length) {
      if (templates[templates.length - 1] === 0) {
        templates.pop();
        i = string(i + 1, null);
      } else {
        templates[templates.length - 1]!--;
        i++;
      }
    } else i++;
  }
  return found;
}

/** Find every translatable text of a plugin, in reference order. */
export function extract(options: ExtractOptions): {
  messages: Message[];
  findings: Finding[];
} {
  const { directory } = options;
  let checker: ts.TypeChecker | undefined;
  let program: ts.Program | undefined;
  const files = options.typescript.map((file) => join(directory, file));
  if (files.length) {
    program = ts.createProgram(files, {
      ...(options.compilerOptions ?? {
        target: ts.ScriptTarget.ES2023,
        module: ts.ModuleKind.NodeNext,
        moduleResolution: ts.ModuleResolutionKind.NodeNext,
        strict: true,
        allowImportingTsExtensions: true,
        skipLibCheck: true,
      }),
      noEmit: true,
    });
    checker = program.getTypeChecker();
  }
  const extractor = new Extractor(checker);
  for (const file of [...options.typescript].sort()) {
    const path = join(directory, file);
    const source =
      program?.getSourceFile(path) ??
      ts.createSourceFile(
        path,
        readFileSync(path, "utf8"),
        ts.ScriptTarget.Latest,
        true,
      );
    extractor.typescript(slash(file), source);
  }
  for (const file of [...options.slint].sort())
    extractor.slint(slash(file), readFileSync(join(directory, file), "utf8"));
  const manifest = options.manifest;
  for (const field of ["name", "punchline", "description"])
    if (typeof manifest[field] === "string" && manifest[field] !== "")
      extractor.add("manifest.json", 0, { id: manifest[field], notes: [] });
  if (Array.isArray(manifest.tags))
    for (const tag of manifest.tags)
      if (typeof tag === "string" && tag !== "")
        extractor.add("manifest.json", 0, { id: tag, notes: [] });

  const occurrences = [...extractor.found].sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  const messages = new Map<string, Message>();
  for (const occurrence of occurrences) {
    const key = keyOf(occurrence.context, occurrence.id);
    const reference =
      occurrence.line > 0
        ? `${occurrence.file}:${occurrence.line}`
        : occurrence.file;
    let message = messages.get(key);
    if (!message) {
      message = { id: occurrence.id, notes: [], references: [] };
      if (occurrence.context !== undefined)
        message.context = occurrence.context;
      messages.set(key, message);
    }
    if (occurrence.plural !== undefined && message.plural === undefined)
      message.plural = occurrence.plural;
    for (const note of occurrence.notes)
      if (!message.notes.includes(note)) message.notes.push(note);
    if (!message.references.includes(reference))
      message.references.push(reference);
  }
  const findings = extractor.findings.sort((a, b) =>
    a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1,
  );
  return { messages: [...messages.values()], findings };
}

const entryOf = (message: Message): PoEntry => {
  const entry: PoEntry = {
    id: message.id,
    strings: message.plural === undefined ? [""] : ["", ""],
    fuzzy: false,
    notes: [...message.notes],
    references: [...message.references],
    flags: [],
    obsolete: false,
  };
  if (message.context !== undefined) entry.context = message.context;
  if (message.plural !== undefined) entry.plural = message.plural;
  return entry;
};

/** `locales/messages.pot` for these messages. */
export function template(
  manifest: Record<string, unknown>,
  messages: readonly Message[],
): string {
  const project = [manifest.id, manifest.version]
    .filter((part) => typeof part === "string")
    .join(" ");
  return writePo(
    `Project-Id-Version: ${project}\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\n`,
    messages.map(entryOf),
  );
}

/** The header of a new `<lang>.po`. */
export const newHeader = (language: string) =>
  `Language: ${language}\nContent-Type: text/plain; charset=UTF-8\nContent-Transfer-Encoding: 8bit\nPlural-Forms: ${pluralForms(language)}\n`;

const hasText = (entry: PoEntry) => entry.strings.some((s) => s !== "");

/**
 * Merge the template into a language's file: translations and fuzzy flags
 * of present messages stay, new ones come untranslated, notes and
 * references follow the template, vanished translated messages become
 * obsolete (`#~`, at the end) and come back with their translation.
 */
export function merge(
  existing: string | null,
  language: string,
  messages: readonly Message[],
): {
  text: string;
  total: number;
  translated: number;
  added: number;
  obsolete: number;
} {
  const parsed = existing === null ? null : parsePo(existing);
  const old = new Map<string, PoEntry>();
  for (const entry of parsed?.entries ?? [])
    old.set(keyOf(entry.context, entry.id), entry);
  const result: PoEntry[] = [];
  const present = new Set<string>();
  let added = 0;
  let translated = 0;
  for (const message of messages) {
    const key = keyOf(message.context, message.id);
    present.add(key);
    const entry = entryOf(message);
    const before = old.get(key);
    if (before && hasText(before)) {
      entry.strings = [...before.strings];
      if (message.plural === undefined) entry.strings = [entry.strings[0]!];
      else while (entry.strings.length < 2) entry.strings.push("");
      entry.fuzzy = before.fuzzy;
      entry.flags = [...before.flags];
    } else if (!before) added++;
    if (!entry.fuzzy && entry.strings[0] !== "") translated++;
    result.push(entry);
  }
  let obsolete = 0;
  for (const [key, entry] of old) {
    if (present.has(key) || !hasText(entry)) continue;
    result.push({ ...entry, obsolete: true, references: [] });
    obsolete++;
  }
  return {
    text: writePo(parsed?.header ?? newHeader(language), result),
    total: messages.length,
    translated,
    added,
    obsolete,
  };
}

/** Problems found by `check` in one plugin's catalogs, as text lines. */
export function checkCatalogs(
  directory: string,
  messages: readonly Message[],
  findings: readonly Finding[],
): { warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const locales = join(directory, "locales");
  const pot = join(locales, "messages.pot");
  const keys = (
    entries: readonly { context?: string; id: string; plural?: string }[],
  ) =>
    new Set(
      entries.map((e) => `${keyOf(e.context, e.id)}\u0000${e.plural ?? ""}`),
    );
  const wanted = keys(messages);
  if (!existsSync(pot))
    warnings.push(
      "locales/messages.pot is missing: run vestra-plugin i18n extract",
    );
  else {
    try {
      const have = keys(parsePo(readFileSync(pot, "utf8")).entries);
      const same =
        have.size === wanted.size && [...wanted].every((key) => have.has(key));
      if (!same)
        warnings.push(
          "locales/messages.pot is out of date: run vestra-plugin i18n extract",
        );
    } catch (error) {
      errors.push(`locales/messages.pot: ${(error as Error).message}`);
    }
  }
  const files = existsSync(locales)
    ? readdirSync(locales)
        .filter((name) => name.endsWith(".po"))
        .sort()
    : [];
  for (const name of files) {
    const language = name.slice(0, -3);
    if (language === "en") {
      warnings.push(
        `locales/${name}: English is the source language; the player never reads en.po`,
      );
      continue;
    }
    if (!(LOCALES as readonly string[]).includes(language)) {
      warnings.push(
        `locales/${name}: not a player language (${LOCALES.filter((l) => l !== "en").join(", ")}); the player never reads it`,
      );
      continue;
    }
    let entries: PoEntry[];
    try {
      entries = parsePo(readFileSync(join(locales, name), "utf8")).entries;
    } catch (error) {
      errors.push(`locales/${name}: ${(error as Error).message}`);
      continue;
    }
    const live = entries.filter((entry) => !entry.obsolete);
    const done = live.filter(
      (entry) =>
        !entry.fuzzy &&
        entry.strings[0] !== undefined &&
        entry.strings[0] !== "",
    ).length;
    const fuzzy = live.filter((entry) => entry.fuzzy).length;
    const obsolete = entries.length - live.length;
    warnings.push(
      `${language}: ${done}/${live.length} translated, ${fuzzy} fuzzy, ${obsolete} obsolete`,
    );
    const inFile = keys(live);
    const missing = [...wanted].filter((key) => !inFile.has(key)).length;
    if (missing)
      warnings.push(
        `locales/${name}: ${missing} ${missing === 1 ? "message is" : "messages are"} not in this file: run vestra-plugin i18n extract`,
      );
    for (const entry of live) {
      entry.strings.forEach((text, form) => {
        if (text === "") return;
        const source =
          form > 0 && entry.plural !== undefined ? entry.plural : entry.id;
        if (
          placeholders(text).join("\u0000") !==
          placeholders(source).join("\u0000")
        )
          warnings.push(
            `locales/${name}: placeholders of ${JSON.stringify(entry.id)}${entry.plural !== undefined ? `[${form}]` : ""} differ from the source (${JSON.stringify(text)}): keep every {…} as written in the msgid`,
          );
      });
      if (
        entry.plural !== undefined &&
        !ONE_FORM.has(language) &&
        (entry.strings[0] ?? "") !== "" &&
        (entry.strings[1] ?? "") === ""
      )
        warnings.push(
          `locales/${name}: ${JSON.stringify(entry.id)} has no msgstr[1] (the form for n ≠ 1)`,
        );
    }
  }
  for (const finding of findings)
    warnings.push(`${finding.file}:${finding.line}: ${finding.message}`);
  return { warnings, errors };
}

/**
 * Compile every `locales/<lang>.po` of a player language to
 * `<out>/locales/<lang>.json`. Returns the warnings (files the player never
 * reads); throws on a `.po` that does not parse.
 */
export function compileLocales(directory: string, out: string): string[] {
  const locales = join(directory, "locales");
  if (!existsSync(locales)) return [];
  const warnings: string[] = [];
  for (const name of readdirSync(locales).sort()) {
    if (!name.endsWith(".po")) continue;
    const language = name.slice(0, -3);
    if (
      language === "en" ||
      !(LOCALES as readonly string[]).includes(language)
    ) {
      warnings.push(
        `locales/${name}: not compiled (not a translation the player reads)`,
      );
      continue;
    }
    let entries: PoEntry[];
    try {
      entries = parsePo(readFileSync(join(locales, name), "utf8")).entries;
    } catch (error) {
      throw new Error(`locales/${name}: ${(error as Error).message}`, {
        cause: error,
      });
    }
    mkdirSync(join(out, "locales"), { recursive: true });
    writeFileSync(
      join(out, "locales", `${language}.json`),
      `${JSON.stringify(compileCatalog(language, entries))}\n`,
    );
  }
  return warnings;
}

/** The relative path of a file from the plugin directory, forward slashes. */
export const relativePath = (directory: string, file: string) =>
  slash(relative(directory, file));
