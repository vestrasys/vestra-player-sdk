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
    let boundary = true;
    while (at() !== undefined) {
      const v = at()!.v;
      if (depth === 0 && boundary && at()!.t === "id") {
        let visibility: Visibility = "private";
        let offset = 0;
        if (VISIBILITY[v] && is("property", 1)) {
          visibility = VISIBILITY[v]!;
          offset = 1;
        }
        if (is("property", offset)) {
          p += offset + 1;
          let declared: TypeExpr | null = null;
          if (is("<")) {
            p++;
            declared = type();
            expect(">");
          }
          const name = normalize(identifier());
          const rows = is(":") && is("[", 1) && !is("]", 2);
          element.members.set(name, { visibility, type: declared, rows });
          boundary = false;
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
      boundary = v === ";" || v === "{" || v === "}";
      p++;
    }
    return element;
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

/** A file, parsed once while it is unchanged; `null` if it cannot be read. */
function load(path: string | null | undefined): SlintFile | null {
  if (!path) return null;
  let mtime: number;
  try {
    mtime = statSync(path).mtimeMs;
  } catch {
    return null;
  }
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
  | { struct: [string, TypeExpr][]; file: SlintFile }
  | { enum: true }
  | { element: Element; file: SlintFile };

/** What `name` exported from `file` is. */
function exportOf(
  file: SlintFile | null,
  name: string,
  depth: number,
): Found | null {
  if (!file || depth > 16) return null;
  const entry = file.exports.get(name);
  if (entry)
    return entry.from === undefined
      ? local(file, entry.name, depth + 1)
      : exportOf(load(entry.from), entry.name, depth + 1);
  for (const star of file.stars) {
    const found = exportOf(load(star), name, depth + 1);
    if (found) return found;
  }
  return null;
}

/** What `name` is in the scope of `file`: declared there or imported. */
function local(file: SlintFile, name: string, depth = 0): Found | null {
  if (depth > 16) return null;
  const struct = file.structs.get(name);
  if (struct) return { struct, file };
  if (file.enums.has(name)) return { enum: true };
  const element = file.elements.get(name);
  if (element) return { element, file };
  const imported = file.imports.get(name);
  if (imported) return exportOf(load(imported.from), imported.name, depth + 1);
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

function resolveType(file: SlintFile, expr: TypeExpr, depth = 0): SlintType {
  if (depth > 32) return { k: "any" };
  if ("array" in expr)
    return { k: "array", of: resolveType(file, expr.array, depth + 1) };
  if ("fields" in expr) return structType(file, expr.fields, depth);
  const builtin = BUILTIN[expr.name];
  if (builtin) return { k: builtin } as SlintType;
  const found = local(file, expr.name);
  if (found && "struct" in found)
    return structType(found.file, found.struct, depth);
  if (found && "enum" in found) return { k: "enum" };
  return { k: "any" };
}

function structType(
  file: SlintFile,
  fields: [string, TypeExpr][],
  depth: number,
): SlintType {
  return {
    k: "struct",
    fields: new Map(
      fields.map(([name, type]) => [name, resolveType(file, type, depth + 1)]),
    ),
  };
}

/** A property as declared: its visibility, type and default rows. */
export interface Declared {
  visibility: Visibility;
  type: SlintType;
  rows: boolean;
}

/**
 * The writable surface of a view: its properties by normalized name.
 * `open`: names not listed may still exist (the component inherits one
 * this parser does not look into), so they are not refused.
 */
export interface ViewTypes {
  properties: Map<string, Declared>;
  open: boolean;
}

const views = new Map<string, { mtime: number; view: ViewTypes | null }>();

/**
 * The properties of the view `file` (relative to `directory`) shows: its
 * one exported component (a window), or the exported `global` (a panel or
 * settings page). `null` when the file cannot be read or the view cannot
 * be found: then nothing is checked.
 */
export function viewTypes(
  directory: string,
  file: string,
  global?: string,
): ViewTypes | null {
  const path = resolve(directory, file);
  const parsed = load(path);
  if (!parsed) return null;
  const key = `${path}\u0000${global ?? ""}`;
  const mtime = files.get(path)!.mtime;
  const cached = views.get(key);
  if (cached && cached.mtime === mtime) return cached.view;
  let found: Found | null = null;
  if (global !== undefined) {
    found = exportOf(parsed, normalize(global), 0);
    if (!found || !("element" in found) || found.element.kind !== "global")
      found = null;
  } else {
    const components = [...parsed.exports.keys()]
      .map((name) => exportOf(parsed, name, 0))
      .filter(
        (each): each is Found & { element: Element; file: SlintFile } =>
          each !== null &&
          "element" in each &&
          each.element.kind === "component",
      );
    found = components.length === 1 ? components[0]! : null;
  }
  let view: ViewTypes | null = null;
  if (found && "element" in found) {
    const { element, file: owner } = found;
    const properties = new Map<string, Declared>();
    for (const [name, member] of element.members)
      properties.set(name, {
        visibility: member.visibility,
        type: member.type ? resolveType(owner, member.type) : { k: "any" },
        rows: member.rows,
      });
    // A component of the plugin's own as the base: its properties are
    // not read here.
    const base = element.base;
    const open =
      base !== null && (owner.elements.has(base) || owner.imports.has(base));
    view = { properties, open };
  }
  views.set(key, { mtime, view });
  return view;
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

const isStruct = (value: Json): value is { [key: string]: Json } =>
  isObject(value) && !isImage(value) && !isDocument(value);

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
      if (isDocument(value)) return true;
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
  if (isDocument(value)) return { k: "array", first: null };
  if (Array.isArray(value)) {
    const of = type.k === "array" ? type.of : ({ k: "any" } as const);
    return {
      k: "array",
      first: value.length ? heldOf(of, value[0]!, false, plain) : null,
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
    if (!current.first || !Array.isArray(next)) return null;
    for (const [index, row] of next.entries()) {
      const found = mismatch(`${path}[${index}]`, current.first, row, plain);
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
): Refusal | null {
  const declared = types.properties.get(normalize(property));
  if (!declared || declared.visibility === "private") {
    if (types.open && !declared) return null;
    return { why: "missing", message: `${property}: no such property` };
  }
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
