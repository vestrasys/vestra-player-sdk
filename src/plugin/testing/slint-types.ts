/**
 * The types of the properties a plugin's Slint files declare, and the
 * player's check of a value written to one (`ui_values::set`: Slint's
 * `check_and_coerce`, the refusal in words of `ui_values::refusal`).
 *
 * The player sets each value on the compiled component, and Slint refuses
 * one of another type: a string where the declaration has a brush, a row
 * whose struct has a field the declared struct does not. Without this the
 * test host kept every value as plain JSON and such a plugin passed its
 * tests, then failed in the player when its window opened.
 *
 * A small parser of declarations only: `import`, `export`, `struct`,
 * `enum`, and the `property` declarations directly in a `component` or
 * `global` body; everything else is skipped. What it cannot resolve (a
 * type of `std-widgets.slint`, a file it cannot read) is taken as any
 * value, so a check here never refuses what the player takes. Each file
 * is parsed once while it is unchanged.
 *
 * Part of `TestHost` (`./index.ts`). Internal to the SDK; not exported
 * from `@vestra-player/sdk/testing`.
 */
import { readFileSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "../../wire.ts";
import type { TestHost } from "./index.ts";

/** The package directory of the plugin a host runs (set by `startPlugin`). */
export const packageDirectories = new WeakMap<TestHost, string>();

/** The SDK's Slint library (`@vestra/…`), as the player's `vestra` library path. */
const LIBRARY = fileURLToPath(
  new URL("../../../slint/vestra/", import.meta.url),
);

// ------------------------------------------------------------------ types

/** A declared type, resolved. `any`: not known here, every value passes. */
export type SlintType =
  | { k: "number" | "string" | "bool" | "image" | "brush" | "enum" | "other" }
  | { k: "array"; of: SlintType }
  | { k: "struct"; fields: Map<string, SlintType> }
  | { k: "any" };

/** A type as written: a name, `[T]`, or `{ a: T, … }`. */
type TypeExpr =
  { name: string } | { array: TypeExpr } | { fields: [string, TypeExpr][] };

type Visibility = "in" | "out" | "in-out" | "private";

interface Member {
  visibility: Visibility;
  /** `null`: no type written (`property x <=> y.z`). */
  type: TypeExpr | null;
  /** The default binding is an array literal with rows. */
  rows: boolean;
  /**
   * The value it starts with, when the test host can tell: a literal
   * default (`: 3`, `: "a"`, `: true`, `: []`); `undefined` for another
   * binding (`: root.x`, `<=> y`). `null` written: no binding.
   */
  initial: Json | undefined | null;
}

interface Element {
  kind: "component" | "global";
  /** The component it inherits; `null` for none or a global. */
  base: string | null;
  members: Map<string, Member>;
}

interface SlintFile {
  path: string;
  structs: Map<string, [string, TypeExpr][]>;
  enums: Set<string>;
  elements: Map<string, Element>;
  /** Local name → the file (`null`: built in or unknown) and its name there. */
  imports: Map<string, { from: string | null; name: string }>;
  /** Exported name → the local name, or a name of another file. */
  exports: Map<string, { name: string; from?: string | null }>;
  /** `export * from "…"`. */
  stars: (string | null)[];
}

/**
 * Slint's `normalize_identifier`: `_` is `-` except as the first
 * character, where `-` is `_`.
 */
export const normalize = (name: string) =>
  name.replace(/^-/, "_").replace(/(?<!^)_/g, "-");

// -------------------------------------------------------------- tokenizer

interface Token {
  t: "id" | "str" | "num" | "p";
  v: string;
}

function tokenize(text: string): Token[] {
  const out: Token[] = [];
  const n = text.length;
  let i = 0;
  // A string literal from its opening quote; `\{ … }` interpolations may
  // hold braces and strings of their own.
  const string = () => {
    const start = ++i;
    while (i < n) {
      const c = text[i];
      if (c === "\\") {
        if (text[i + 1] === "{") {
          i += 2;
          let depth = 1;
          while (i < n && depth > 0) {
            if (text[i] === '"') {
              string();
              continue;
            }
            if (text[i] === "{") depth++;
            else if (text[i] === "}") depth--;
            i++;
          }
          continue;
        }
        i += 2;
        continue;
      }
      if (c === '"') return text.slice(start, i++);
      i++;
    }
    return text.slice(start);
  };
  while (i < n) {
    const c = text[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") i++;
    } else if (c === "/" && text[i + 1] === "*") {
      let depth = 0;
      while (i < n) {
        if (text[i] === "/" && text[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (text[i] === "*" && text[i + 1] === "/") {
          depth--;
          i += 2;
          if (depth === 0) break;
        } else i++;
      }
    } else if (c === '"') {
      out.push({ t: "str", v: string() });
    } else if (/[A-Za-z_]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_-]/.test(text[i]!)) i++;
      out.push({ t: "id", v: text.slice(start, i) });
    } else if (/[0-9]/.test(c)) {
      const start = i;
      while (i < n && /[A-Za-z0-9_.%]/.test(text[i]!)) i++;
      out.push({ t: "num", v: text.slice(start, i) });
    } else if (text.startsWith("<=>", i)) {
      out.push({ t: "p", v: "<=>" });
      i += 3;
    } else if (text.startsWith(":=", i)) {
      out.push({ t: "p", v: ":=" });
      i += 2;
    } else {
      out.push({ t: "p", v: c });
      i++;
    }
  }
  return out;
}

// ----------------------------------------------------------------- parser

const OPEN = new Set(["{", "[", "("]);
const CLOSE = new Set(["}", "]", ")"]);
const VISIBILITY: Record<string, Visibility> = {
  in: "in",
  out: "out",
  "in-out": "in-out",
  in_out: "in-out",
  private: "private",
};

/** The import path as the player's compiler resolves it. */
function importPath(from: string, spec: string): string | null {
  if (spec.startsWith("@vestra/")) return resolve(LIBRARY, spec.slice(8));
  if (spec.startsWith("@") || spec === "std-widgets.slint") return null;
  if (!spec.endsWith(".slint")) return null;
  return resolve(dirname(from), spec);
}

function parse(path: string, text: string): SlintFile {
  const file: SlintFile = {
    path,
    structs: new Map(),
    enums: new Set(),
    elements: new Map(),
    imports: new Map(),
    exports: new Map(),
    stars: [],
  };
  const tokens = tokenize(text);
  let p = 0;
  const at = (offset = 0) => tokens[p + offset];
  const is = (v: string, offset = 0) => at(offset)?.v === v;
  const fail = (): never => {
    throw new Error("unexpected");
  };
  const expect = (v: string) => {
    if (!is(v)) fail();
    p++;
  };
  const identifier = () => {
    const token = at();
    if (token?.t !== "id") fail();
    p++;
    return token!.v;
  };
  /** Past the bracket that closes the one at `p`. */
  const skipBlock = () => {
    let depth = 0;
    do {
      const v = at()?.v;
      if (v === undefined) return;
      if (OPEN.has(v)) depth++;
      else if (CLOSE.has(v)) depth--;
      p++;
    } while (depth > 0);
  };
  const type = (): TypeExpr => {
    if (is("[")) {
      p++;
      const inner = type();
      expect("]");
      return { array: inner };
    }
    if (is("{")) {
      p++;
      const fields: [string, TypeExpr][] = [];
      while (!is("}")) {
        const name = identifier();
        expect(":");
        fields.push([normalize(name), type()]);
        if (is(",")) p++;
        else if (!is("}")) fail();
      }
      p++;
      return { fields };
    }
    return { name: normalize(identifier()) };
  };
  /** `{ a, b as c }` of an import or export: [name, local name]. */
  const names = () => {
    const list: [string, string][] = [];
    expect("{");
    while (!is("}")) {
      const name = identifier();
      let alias = name;
      if (is("as")) {
        p++;
        alias = identifier();
      }
      list.push([normalize(name), normalize(alias)]);
      if (is(",")) p++;
      else if (!is("}")) fail();
    }
    p++;
    return list;
  };
  const body = (kind: "component" | "global", base: string | null) => {
    const element: Element = { kind, base, members: new Map() };
    expect("{");
    let depth = 0;
    while (at() !== undefined) {
      const v = at()!.v;
      // A declaration directly in the body, wherever it stands (after a
      // `states [...]`, `transitions [...]` or `@children` too): `property`
      // (after its visibility) followed by `<` or by a name and `<=>`.
      if (depth === 0 && at()!.t === "id") {
        let visibility: Visibility = "private";
        let offset = 0;
        if (VISIBILITY[v] && is("property", 1)) {
          visibility = VISIBILITY[v]!;
          offset = 1;
        }
        if (
          is("property", offset) &&
          (is("<", offset + 1) ||
            (at(offset + 1)?.t === "id" && is("<=>", offset + 2)))
        ) {
          p += offset + 1;
          let declared: TypeExpr | null = null;
          if (is("<")) {
            p++;
            declared = type();
            expect(">");
          }
          const name = normalize(identifier());
          const rows = is(":") && is("[", 1) && !is("]", 2);
          const initial = is(":") ? literal() : is("<=>") ? undefined : null;
          element.members.set(name, {
            visibility,
            type: declared,
            rows,
            initial,
          });
          continue;
        }
      }
      if (OPEN.has(v)) depth++;
      else if (CLOSE.has(v)) {
        if (depth === 0) {
          p++;
          break;
        }
        depth--;
      }
      p++;
    }
    return element;
  };
  /** The literal after `:` that ends the binding (`;`), or `undefined`. */
  const literal = (): Json | undefined => {
    const value = at(1);
    let end = 2;
    let result: Json | undefined;
    if (value?.t === "num" && /^\d+(\.\d+)?$/.test(value.v))
      result = Number(value.v);
    else if (value?.t === "str" && !value.v.includes("\\")) result = value.v;
    else if (value?.v === "true" || value?.v === "false")
      result = value.v === "true";
    else if (value?.v === "[" && is("]", 2)) {
      result = [];
      end = 3;
    }
    return result !== undefined && is(";", end) ? result : undefined;
  };
  const declaration = (exported: boolean) => {
    const keyword = at()!.v;
    p++;
    const name = normalize(identifier());
    if (exported) file.exports.set(name, { name });
    if (keyword === "struct") {
      if (is(":=")) p++;
      const shape = type();
      if (!("fields" in shape)) fail();
      file.structs.set(
        name,
        (shape as { fields: [string, TypeExpr][] }).fields,
      );
    } else if (keyword === "enum") {
      file.enums.add(name);
      skipBlock();
    } else if (keyword === "global") {
      if (is(":=")) p++;
      file.elements.set(name, body("global", null));
    } else {
      let base: string | null = null;
      if (is("inherits")) {
        p++;
        base = normalize(identifier());
      }
      file.elements.set(name, body("component", base));
    }
  };
  const DECLARATIONS = new Set(["struct", "enum", "global", "component"]);
  while (p < tokens.length) {
    const start = p;
    try {
      if (is("import") && is("{", 1)) {
        p++;
        const list = names();
        expect("from");
        const spec = at();
        if (spec?.t !== "str") fail();
        p++;
        const from = importPath(path, spec!.v);
        for (const [name, local] of list)
          file.imports.set(local, { from, name });
      } else if (is("export") && is("{", 1)) {
        p++;
        const list = names();
        let from: string | null | undefined;
        if (is("from")) {
          p++;
          const spec = at();
          if (spec?.t !== "str") fail();
          p++;
          from = importPath(path, spec!.v);
        }
        for (const [name, alias] of list)
          file.exports.set(
            alias,
            from === undefined ? { name } : { name, from },
          );
      } else if (is("export") && is("*", 1) && is("from", 2)) {
        p += 3;
        const spec = at();
        if (spec?.t !== "str") fail();
        p++;
        file.stars.push(importPath(path, spec!.v));
      } else if (is("export") && DECLARATIONS.has(at(1)?.v ?? "")) {
        p++;
        declaration(true);
      } else if (DECLARATIONS.has(at()!.v) && at(1)?.t === "id") {
        declaration(false);
      } else if (OPEN.has(at()!.v)) {
        skipBlock();
      } else {
        p++;
      }
    } catch {
      // Not a declaration this parser reads: go on after its first token.
      p = start + 1;
    }
  }
  return file;
}

// ------------------------------------------------------------- resolution

const files = new Map<string, { mtime: number; file: SlintFile | null }>();

/** The files read while a view's types are resolved (`viewTypes`). */
let reading: Set<string> | null = null;

const mtimeOf = (path: string) => {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return -1;
  }
};

/** A file, parsed once while it is unchanged; `null` if it cannot be read. */
function load(path: string | null | undefined): SlintFile | null {
  if (!path) return null;
  reading?.add(path);
  const mtime = mtimeOf(path);
  if (mtime < 0) return null;
  const cached = files.get(path);
  if (cached && cached.mtime === mtime) return cached.file;
  let file: SlintFile | null = null;
  try {
    file = parse(path, readFileSync(path, "utf8"));
  } catch {
    file = null;
  }
  files.set(path, { mtime, file });
  return file;
}

type Found =
  | { struct: [string, TypeExpr][]; name: string; file: SlintFile }
  | { enum: true }
  | { element: Element; file: SlintFile };

/**
 * What `name` exported from `file` is. `seen`: the (file, name) pairs
 * already asked on this lookup, so that files exporting each other
 * (`export * from`) end it.
 */
function exportOf(
  file: SlintFile | null,
  name: string,
  seen = new Set<string>(),
): Found | null {
  if (!file) return null;
  const key = `${file.path}\u0000${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const entry = file.exports.get(name);
  if (entry)
    return entry.from === undefined
      ? local(file, entry.name, seen)
      : exportOf(load(entry.from), entry.name, seen);
  for (const star of file.stars) {
    const found = exportOf(load(star), name, seen);
    if (found) return found;
  }
  return null;
}

/** What `name` is in the scope of `file`: declared there or imported. */
function local(
  file: SlintFile,
  name: string,
  seen = new Set<string>(),
): Found | null {
  const struct = file.structs.get(name);
  if (struct) return { struct, name, file };
  if (file.enums.has(name)) return { enum: true };
  const element = file.elements.get(name);
  if (element) return { element, file };
  const imported = file.imports.get(name);
  if (imported) return exportOf(load(imported.from), imported.name, seen);
  return null;
}

const BUILTIN: Record<string, SlintType["k"]> = {
  int: "number",
  float: "number",
  length: "number",
  "physical-length": "number",
  "relative-font-size": "number",
  duration: "number",
  angle: "number",
  percent: "number",
  string: "string",
  bool: "bool",
  image: "image",
  color: "brush",
  brush: "brush",
  easing: "other",
};

/**
 * Each named struct resolved once per view read (`viewTypes`), by file
 * and name. A struct that holds itself (Slint refuses it; the test host
 * must not loop or expand it without end) is `any` where it recurs.
 */
let structs = new Map<string, SlintType | null>();

function resolveType(file: SlintFile, expr: TypeExpr): SlintType {
  if ("array" in expr) return { k: "array", of: resolveType(file, expr.array) };
  if ("fields" in expr) return structType(file, expr.fields);
  const builtin = BUILTIN[expr.name];
  if (builtin) return { k: builtin } as SlintType;
  const found = local(file, expr.name);
  if (found && "struct" in found) {
    const key = `${found.file.path}\u0000${found.name}`;
    const known = structs.get(key);
    // `null`: being resolved, so this is a cycle.
    if (known === null) return { k: "any" };
    if (known) return known;
    structs.set(key, null);
    const type = structType(found.file, found.struct);
    structs.set(key, type);
    return type;
  }
  if (found && "enum" in found) return { k: "enum" };
  return { k: "any" };
}

function structType(file: SlintFile, fields: [string, TypeExpr][]): SlintType {
  return {
    k: "struct",
    fields: new Map(
      fields.map(([name, type]) => [name, resolveType(file, type)]),
    ),
  };
}

/** A property as declared: its visibility, type and default rows. */
export interface Declared {
  visibility: Visibility;
  type: SlintType;
  rows: boolean;
  /**
   * The value it holds before any write, as the player's `to_json` gives
   * it, when the test host can tell (`undefined`: it cannot).
   */
  initial: Json | undefined;
}

/**
 * The writable surface of a view: its properties by normalized name.
 * `open`: names not listed may still exist (the component inherits a
 * component this parser does not look into), so they are not refused.
 */
export interface ViewTypes {
  properties: Map<string, Declared>;
  open: boolean;
}

/** A view's types, and the files they were read from with their times. */
const views = new Map<
  string,
  { files: Map<string, number>; view: ViewTypes | null }
>();

/**
 * The properties of the view `file` (relative to `directory`) shows: its
 * one exported component (a window), or the exported `global` (a panel or
 * settings page). `null` when the file cannot be read or the view cannot
 * be found: then nothing is checked. Kept while none of the files it was
 * read from (the view's and those it imports) changed.
 */
export function viewTypes(
  directory: string,
  file: string,
  global?: string,
): ViewTypes | null {
  const path = resolve(directory, file);
  const key = `${path}\u0000${global ?? ""}`;
  const cached = views.get(key);
  if (
    cached &&
    [...cached.files].every(([each, mtime]) => mtimeOf(each) === mtime)
  )
    return cached.view;
  reading = new Set();
  structs = new Map();
  let view: ViewTypes | null = null;
  try {
    view = readView(path, global);
  } finally {
    const read = reading;
    reading = null;
    structs = new Map();
    views.set(key, {
      files: new Map([...read].map((each) => [each, mtimeOf(each)])),
      view,
    });
  }
  return view;
}

function readView(path: string, global?: string): ViewTypes | null {
  const parsed = load(path);
  if (!parsed) return null;
  let found: Found | null = null;
  if (global !== undefined) {
    found = exportOf(parsed, normalize(global));
    if (!found || !("element" in found) || found.element.kind !== "global")
      found = null;
  } else {
    const components = [...parsed.exports.keys()]
      .map((name) => exportOf(parsed, name))
      .filter(
        (each): each is Found & { element: Element; file: SlintFile } =>
          each !== null &&
          "element" in each &&
          each.element.kind === "component",
      );
    found = components.length === 1 ? components[0]! : null;
  }
  if (!found || !("element" in found)) return null;
  const { element, file: owner } = found;
  const properties = new Map<string, Declared>();
  for (const [name, member] of element.members) {
    const type = member.type ? resolveType(owner, member.type) : anyType;
    properties.set(name, {
      visibility: member.visibility,
      type,
      rows: member.rows,
      initial: member.initial === null ? jsonDefault(type) : member.initial,
    });
  }
  // A component of the plugin's own as the base, or one it imports (from
  // std-widgets.slint too): its properties are not read here.
  const base = element.base;
  const open =
    base !== null && (owner.elements.has(base) || owner.imports.has(base));
  return { properties, open };
}

const anyType: SlintType = { k: "any" };

/**
 * A type's default as the player's `to_json` writes it (`0`, `""`,
 * `false`, `[]`, a struct of those); `undefined` where it has none (an
 * image, a brush, an enum, a type not known here).
 */
function jsonDefault(type: SlintType): Json | undefined {
  switch (type.k) {
    case "number":
      return 0;
    case "string":
      return "";
    case "bool":
      return false;
    case "array":
      return [];
    case "struct": {
      const out: { [key: string]: Json } = {};
      for (const [name, field] of type.fields) {
        const value = jsonDefault(field);
        if (value === undefined) return undefined;
        out[name] = value;
      }
      return out;
    }
    default:
      return undefined;
  }
}

// ------------------------------------------------------------------ check

const isObject = (value: unknown): value is { [key: string]: Json } =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The player's image reference (`ui_image::reference`). */
const isImage = (value: Json) =>
  isObject(value) &&
  "$vestraImage" in value &&
  Object.keys(value).every(
    (key) => key === "$vestraImage" || key === "ref" || key === "maxSide",
  );

/** A Markdown document (`ui_markdown::reference`): rows of blocks. */
const isDocument = (value: Json) =>
  isObject(value) &&
  "$vestraMarkdown" in value &&
  Object.keys(value).every((key) => key === "$vestraMarkdown" || key === "ref");

/** A field holding styled text (a Markdown row's `text`): no JSON value is one. */
const STYLED: Json = Object.freeze({});

const isStruct = (value: Json): value is { [key: string]: Json } =>
  value !== STYLED && isObject(value) && !isImage(value) && !isDocument(value);

/**
 * One row of a converted Markdown document, as the player builds it
 * (`ui_markdown::row_value`, a `MarkdownBlock`): every block has these
 * fields, its lists empty or not.
 */
const MARKDOWN_ROW: { [key: string]: Json } = {
  kind: "",
  level: 0,
  indent: 0,
  quote: 0,
  marker: "",
  task: 0,
  aligns: [],
  text: STYLED,
  plain: "",
  links: [],
  code: "",
  alt: "",
  "has-image": false,
  image: { $vestraImage: "" },
  "image-width": 0,
  "image-height": 0,
  rows: [],
};

/**
 * The rows a Markdown document converts to, as far as the type check sees
 * them: blocks of the shape above, none for an empty text.
 */
function documentRows(value: Json): Json[] {
  const doc = (value as { $vestraMarkdown?: { text?: unknown } })
    .$vestraMarkdown;
  const text = typeof doc?.text === "string" ? doc.text : "";
  return text.trim() === "" ? [] : [MARKDOWN_ROW];
}

/** A Markdown document anywhere in `value`. */
const hasDocument = (value: Json): boolean =>
  isDocument(value) ||
  (Array.isArray(value)
    ? value.some(hasDocument)
    : isObject(value) &&
      !isImage(value) &&
      Object.values(value).some(hasDocument));

/**
 * The player converts an array without documents to plain rows
 * (`ui_values::plain_rows`), where `null` is an empty image
 * (`ui_rows::Plain::to_value`); anywhere else `null` stays null, which
 * no declared type takes.
 */
const plainRows = (value: Json) => Array.isArray(value) && !hasDocument(value);

/**
 * The kind of the Slint value the player converts `value` to (`kind`);
 * `plain`: inside plain rows.
 */
function kind(value: Json, plain = false): string {
  if (value === STYLED) return "a value";
  if (value === null) return plain ? "an image" : "null";
  if (typeof value === "boolean") return "a bool";
  if (typeof value === "number") return "a number";
  if (typeof value === "string") return "a string";
  if (Array.isArray(value) || isDocument(value)) return "an array";
  if (isImage(value)) return "an image";
  return "a struct";
}

/** Slint's `check_and_coerce`: whether `type` takes `value` (`plain`: inside plain rows). */
function takes(type: SlintType, value: Json, plain: boolean): boolean {
  switch (type.k) {
    case "any":
      return true;
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "bool":
      return typeof value === "boolean";
    case "image":
      return isImage(value) || (plain && value === null);
    case "array":
      // A document's rows are checked like any other (`MarkdownBlock`
      // structs).
      if (isDocument(value))
        return documentRows(value).every((row) => takes(type.of, row, false));
      return (
        Array.isArray(value) && value.every((row) => takes(type.of, row, plain))
      );
    case "struct":
      return (
        isStruct(value) &&
        Object.entries(value).every(([name, field]) => {
          const declared = type.fields.get(normalize(name));
          return declared !== undefined && takes(declared, field, plain);
        })
      );
    // Brushes, colors, enumerations and easings: no JSON value is one.
    default:
      return false;
  }
}

/**
 * The value a property holds, as far as `mismatch` reads it: a struct's
 * fields, an array's first row, a leaf's kind (`?`: not known).
 */
type Held =
  | { k: "struct"; fields: Map<string, Held> }
  | { k: "array"; first: Held | null }
  | { k: "leaf"; kind: string };

const LEAF: Record<string, string> = {
  number: "a number",
  string: "a string",
  bool: "a bool",
  image: "an image",
  brush: "a brush",
  enum: "an enum value",
  other: "a value",
  any: "?",
};

/** Slint's default value of `type` (`default_value_for_type`). */
function defaultOf(type: SlintType, rows = false): Held {
  if (type.k === "struct")
    return {
      k: "struct",
      fields: new Map(
        [...type.fields].map(([name, field]) => [name, defaultOf(field)]),
      ),
    };
  // An array literal with rows: its rows have the declared struct's fields.
  if (type.k === "array")
    return { k: "array", first: rows ? defaultOf(type.of) : null };
  return { k: "leaf", kind: LEAF[type.k]! };
}

/**
 * The value a property holds after `value` was set: a struct gets the
 * declared fields it left out (`check_and_coerce` fills them, `fill`), the
 * rows of an array stay as written.
 */
function heldOf(
  type: SlintType,
  value: Json,
  fill: boolean,
  plain: boolean,
): Held {
  if (Array.isArray(value) || isDocument(value)) {
    const document = isDocument(value);
    const rows = document ? documentRows(value) : (value as Json[]);
    const of = type.k === "array" ? type.of : ({ k: "any" } as const);
    return {
      k: "array",
      first: rows.length
        ? heldOf(of, rows[0]!, false, plain && !document)
        : null,
    };
  }
  if (isStruct(value)) {
    const declared = type.k === "struct" ? type.fields : undefined;
    const fields = new Map<string, Held>();
    for (const [name, field] of Object.entries(value)) {
      const key = normalize(name);
      fields.set(
        key,
        heldOf(declared?.get(key) ?? { k: "any" }, field, fill, plain),
      );
    }
    if (fill && declared)
      for (const [name, field] of declared)
        if (!fields.has(name)) fields.set(name, defaultOf(field));
    return { k: "struct", fields };
  }
  return { k: "leaf", kind: kind(value, plain) };
}

const heldKind = (held: Held) =>
  held.k === "struct"
    ? "a struct"
    : held.k === "array"
      ? "an array"
      : held.kind;

/** `ui_values::mismatch`: the first place `next` differs from `current`. */
function mismatch(
  path: string,
  current: Held,
  next: Json,
  plain: boolean,
): string | null {
  if (current.k === "struct" && isStruct(next)) {
    const fields = Object.keys(next)
      .map((name) => [normalize(name), next[name]!] as const)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    for (const [name, value] of fields) {
      const field = `${path}.${name}`;
      const declared = current.fields.get(name);
      if (!declared)
        return `${field} is not a field of the declared struct (${[
          ...current.fields.keys(),
        ]
          .sort()
          .join(", ")})`;
      const found = mismatch(field, declared, value, plain);
      if (found) return found;
    }
    return null;
  }
  if (current.k === "array" && (Array.isArray(next) || isDocument(next))) {
    if (!current.first) return null;
    const document = isDocument(next);
    const rows = document ? documentRows(next) : (next as Json[]);
    for (const [index, row] of rows.entries()) {
      const found = mismatch(
        `${path}[${index}]`,
        current.first,
        row,
        plain && !document,
      );
      if (found) return found;
    }
    return null;
  }
  const declared = heldKind(current);
  const given = kind(next, plain);
  if (declared === "?" || declared === given) return null;
  return `${path} is ${given} where the declaration has ${declared}`;
}

/** Why the player refuses a write: no such property, an out property, or the type. */
export interface Refusal {
  why: "missing" | "readonly" | "type";
  /** The player's words (`ui_values::refusal`), the property named first. */
  message: string;
}

/**
 * The player's refusal of `value` for `property` of a view of `types`, or
 * `null` when it takes it. `current`: what the property holds (the last
 * value it took; none: its default), which the words of a type refusal
 * describe the declaration by, as the player's do.
 */
export function refusal(
  types: ViewTypes,
  property: string,
  value: Json,
  current: Json | undefined,
  options: { reconciles?: boolean } = {},
): Refusal | null {
  const declared = types.properties.get(normalize(property));
  if (!declared || declared.visibility === "private") {
    if (types.open && !declared) return null;
    return { why: "missing", message: `${property}: no such property` };
  }
  // A write that compares first (`ui_values::reconcile_in`: `ui.set`, a
  // panel, a settings page; not `ui.open`) does nothing when the value is
  // what the property holds, for an `out` one too.
  if (
    declared.visibility === "out" &&
    options.reconciles &&
    declared.initial !== undefined &&
    sameJson(declared.initial, value)
  )
    return null;
  if (declared.visibility === "out")
    return {
      why: "readonly",
      message: `${property}: not writable (an out property)`,
    };
  const plain = plainRows(value);
  if (takes(declared.type, value, plain)) return null;
  const held =
    current === undefined
      ? defaultOf(declared.type, declared.rows)
      : heldOf(declared.type, current, true, plainRows(current));
  const detail =
    mismatch(property, held, value, plain) ??
    `${property} is ${kind(value)} that does not match the declared ${heldKind(held)} type`;
  return { why: "type", message: `${property}: wrong type: ${detail}` };
}

/**
 * Two values the player's `to_json` writes alike (numbers by value);
 * `null` in an array is an image there, which has no JSON: never alike.
 */
function sameJson(a: Json, b: Json, inArray = false): boolean {
  if (a === null || b === null) return a === b && !inArray;
  if (Array.isArray(a) || Array.isArray(b))
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameJson(item, b[index]!, true))
    );
  if (isObject(a) || isObject(b)) {
    if (!isStruct(a) || !isStruct(b)) return false;
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => key in b && sameJson(a[key]!, b[key]!, inArray))
    );
  }
  return a === b;
}

/** Rust's `{:?}` of a string: quoted, with its escapes. */
function debugQuoted(text: string): string {
  let out = '"';
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (char === '"' || char === "\\") out += "\\" + char;
    else if (char === "\n") out += "\\n";
    else if (char === "\r") out += "\\r";
    else if (char === "\t") out += "\\t";
    else if (code === 0) out += "\\0";
    else if (code < 0x20 || code === 0x7f) out += `\\u{${code.toString(16)}}`;
    else out += char;
  }
  return out + '"';
}

const byName = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The player's conversion refuses a struct field name not in Slint's
 * canonical spelling (`ui_values`: no `-` first, no `_` after the first
 * character), whatever the declaration says: the first such name in the
 * order the player meets them (fields by name, a field's value before its
 * name), in its words; `null` when there is none. Image references and
 * Markdown documents are not structs.
 */
export function spellingProblem(value: Json): string | null {
  if (isDocument(value) || isImage(value)) return null;
  if (Array.isArray(value)) {
    for (const row of value) {
      const found = spellingProblem(row);
      if (found) return found;
    }
    return null;
  }
  if (!isObject(value)) return null;
  for (const name of Object.keys(value).sort(byName)) {
    const found = spellingProblem(value[name]!);
    if (found) return found;
    if (name.startsWith("-") || name.slice(1).includes("_"))
      return `UI object field ${debugQuoted(name)} is not in Slint canonical spelling`;
  }
  return null;
}
