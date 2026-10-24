/*
 * Translation catalogs, the same way the player reads them (the player's
 * `src/host/src/i18n/`): gettext `.po` files, the compiled
 * `locales/<lang>.json` a package carries, template formatting and the
 * Slint `@tr` scanner. Used by `vestra-plugin i18n`, `vestra-plugin build`
 * and {@link TestHost}; not part of the plugin API (plugins write no
 * translation code: see docs/how-to/i18n.md).
 * Internal: the player's runner and tests reach it through
 * `@vestra-player/sdk/runtime`, `LOCALES` through `./testing`.
 */

/**
 * The player's interface languages: English (the source language) first,
 * then the translations, as the player's own table (its tests check that
 * they agree).
 */
export const LOCALES = ["en", "zh-Hans", "ja", "ko", "de", "fr", "es"] as const;

/** One message of a `.po` file (the header `msgid ""` is not one). */
export interface PoEntry {
  /** `msgctxt`, if any. */
  context?: string;
  /** `msgid`: the English source text. */
  id: string;
  /** `msgid_plural`, for a plural message. */
  plural?: string;
  /** `msgstr`, or `msgstr[0]`, `msgstr[1]`, … of a plural message. */
  strings: string[];
  /** Flagged `fuzzy`: left out of the compiled catalog. */
  fuzzy: boolean;
  /** `#.` lines: notes for translators. */
  notes: string[];
  /** `#:` references (`file:line`). */
  references: string[];
  /** Other `#,` flags than `fuzzy`. */
  flags: string[];
  /** A `#~` entry: no longer in the source. */
  obsolete: boolean;
}

/** The catalog key: `msgid`, or `msgctxt` U+0004 `msgid`. */
export const keyOf = (context: string | undefined, id: string) =>
  context === undefined ? id : `${context}\u0004${id}`;

const translated = (entry: PoEntry) =>
  !entry.fuzzy && !entry.obsolete && (entry.strings[0] ?? "") !== "";

/** Parse a `.po` (or `.pot`) file. Throws with the line number on errors. */
export function parsePo(text: string): { header: string; entries: PoEntry[] } {
  const entries: PoEntry[] = [];
  let header = "";
  const blank = (): PoEntry => ({
    id: "",
    strings: [],
    fuzzy: false,
    notes: [],
    references: [],
    flags: [],
    obsolete: false,
  });
  let entry = blank();
  let started = false;
  type Field = "none" | "context" | "id" | "plural" | number;
  let field = "none" as Field;
  // Comments seen before the entry's first keyword.
  let pending = blank();
  const finish = () => {
    if (started) {
      if (entry.id === "" && entry.context === undefined)
        header = entry.strings[0] ?? "";
      else entries.push(entry);
    }
    entry = blank();
    started = false;
    field = "none";
  };
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index]!.trim();
    const at = (message: string) => new Error(`line ${index + 1}: ${message}`);
    if (line === "") {
      finish();
      continue;
    }
    let obsolete = false;
    if (line.startsWith("#~")) {
      obsolete = true;
      line = line.slice(2).trim();
      if (line === "") continue;
    } else if (line.startsWith("#")) {
      if (started) finish();
      const body = line.slice(2).trim();
      if (line.startsWith("#.")) pending.notes.push(body);
      else if (line.startsWith("#:"))
        pending.references.push(...body.split(/\s+/).filter(Boolean));
      else if (line.startsWith("#,"))
        for (const flag of body.split(",").map((f) => f.trim()))
          if (flag === "fuzzy") pending.fuzzy = true;
          else if (flag) pending.flags.push(flag);
      continue;
    }
    let keyword = "";
    let rest = line;
    if (!line.startsWith('"')) {
      const split = line.search(/\s/);
      if (split < 0) throw at("a keyword without a string");
      keyword = line.slice(0, split);
      rest = line.slice(split).trim();
    }
    let next: Field;
    if (keyword === "") {
      if (field === "none") throw at("a string without a keyword");
      next = field;
    } else if (keyword === "msgctxt") next = "context";
    else if (keyword === "msgid") next = "id";
    else if (keyword === "msgid_plural") next = "plural";
    else if (keyword === "msgstr") next = 0;
    else {
      const match = /^msgstr\[(\d+)\]$/.exec(keyword);
      if (!match || Number(match[1]) > 16)
        throw at(`unknown keyword ${keyword}`);
      next = Number(match[1]);
    }
    if (keyword !== "") {
      const opens =
        next === "context" || (next === "id" && field !== "context");
      if (opens && started) finish();
      if (!started) {
        if (!opens) throw at("an entry starts with msgctxt or msgid");
        started = true;
        entry = { ...pending, obsolete };
        pending = blank();
      }
    }
    const value = unquote(rest, at);
    if (next === "context") entry.context = (entry.context ?? "") + value;
    else if (next === "id") entry.id += value;
    else if (next === "plural") entry.plural = (entry.plural ?? "") + value;
    else if (typeof next === "number") {
      while (entry.strings.length <= next) entry.strings.push("");
      entry.strings[next] += value;
    }
    field = next;
  }
  finish();
  return { header, entries };
}

function unquote(text: string, at: (message: string) => Error): string {
  if (text.length < 2 || !text.startsWith('"') || !text.endsWith('"'))
    throw at("expected a quoted string");
  let out = "";
  const inner = text.slice(1, -1);
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i]!;
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = inner[++i];
    if (n === "n") out += "\n";
    else if (n === "t") out += "\t";
    else if (n === "r") out += "\r";
    else if (n === '"') out += '"';
    else if (n === "\\") out += "\\";
    else throw at(`unknown escape \\${n ?? ""}`);
  }
  return out;
}

const poString = (text: string) =>
  `"${text.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("\t", "\\t").replaceAll("\r", "\\r").replaceAll("\n", "\\n")}"`;

/** A `.po` string field: one line, or `""` then one line per `\n`. */
function field(keyword: string, text: string): string {
  const parts = text.split(/(?<=\n)/);
  if (parts.length <= 1) return `${keyword} ${poString(text)}`;
  return [`${keyword} ""`, ...parts.map(poString)].join("\n");
}

/** Write a `.po` file: the header, then the entries in the given order. */
export function writePo(header: string, entries: readonly PoEntry[]): string {
  const blocks = [`msgid ""\n${field("msgstr", header)}`];
  for (const entry of entries) {
    const prefix = entry.obsolete ? "#~ " : "";
    const lines: string[] = [];
    for (const note of entry.notes) lines.push(`#. ${note}`);
    if (entry.references.length && !entry.obsolete)
      lines.push(`#: ${entry.references.join(" ")}`);
    const flags = [...(entry.fuzzy ? ["fuzzy"] : []), ...entry.flags];
    if (flags.length) lines.push(`#, ${flags.join(", ")}`);
    const body: string[] = [];
    if (entry.context !== undefined) body.push(field("msgctxt", entry.context));
    body.push(field("msgid", entry.id));
    if (entry.plural !== undefined) {
      body.push(field("msgid_plural", entry.plural));
      const strings = entry.strings.length ? entry.strings : ["", ""];
      strings.forEach((text, n) => body.push(field(`msgstr[${n}]`, text)));
    } else body.push(field("msgstr", entry.strings[0] ?? ""));
    for (const text of body)
      for (const line of text.split("\n")) lines.push(prefix + line);
    blocks.push(lines.join("\n"));
  }
  return `${blocks.join("\n\n")}\n`;
}

/** A message of a compiled catalog: a translation, or `[one, other]`. */
export type CompiledMessage = string | [string, string];

/**
 * The compiled catalog of one language (`locales/<lang>.json`): translated
 * entries only (not fuzzy, not obsolete, not empty), keys sorted. Plurals
 * have two forms, as the player shows them: `msgstr[0]` for `n == 1` and
 * `msgstr[1]` (else `msgstr[0]`) for every other `n`.
 */
export function compileCatalog(
  language: string,
  entries: readonly PoEntry[],
): { language: string; messages: Record<string, CompiledMessage> } {
  const messages: Record<string, CompiledMessage> = {};
  for (const entry of [...entries].sort((a, b) =>
    keyOf(a.context, a.id) < keyOf(b.context, b.id) ? -1 : 1,
  )) {
    if (!translated(entry)) continue;
    const key = keyOf(entry.context, entry.id);
    if (key in messages) continue;
    const one = entry.strings[0]!;
    messages[key] =
      entry.plural === undefined ? one : [one, entry.strings[1] || one];
  }
  return { language, messages };
}

/** Lookups in one language's messages, as the player does them. */
export class Catalog {
  readonly messages: ReadonlyMap<string, CompiledMessage>;
  constructor(messages: Record<string, CompiledMessage> = {}) {
    this.messages = new Map(Object.entries(messages));
  }
  /** From parsed `.po` entries. */
  static fromEntries(entries: readonly PoEntry[]) {
    return new Catalog(compileCatalog("", entries).messages);
  }
  /** The translation of `id` (the one form of a plural), or `undefined`. */
  lookup(id: string, context?: string): string | undefined {
    const message = this.messages.get(keyOf(context, id));
    return Array.isArray(message) ? message[0] : message;
  }
  /** The translation of `id`, or `id` itself. */
  text(id: string): string {
    return this.lookup(id) ?? id;
  }
  /**
   * A plugin sentence (`osd.show(template, args)`, dialogs): translated,
   * then formatted with `args` when given; without `args` the text shows
   * as it is, braces included.
   */
  template(text: string, args?: TemplateArgsValue): string {
    const template = this.text(text);
    return args === undefined || args === null
      ? template
      : format(template, args);
  }
  /** What an `@tr` call becomes, `undefined` when untranslated. */
  slint(call: TrCall): [string, string | undefined] | undefined {
    const message = this.messages.get(keyOf(call.context, call.id));
    if (message === undefined) return undefined;
    if (Array.isArray(message) !== (call.plural !== undefined))
      return undefined;
    return Array.isArray(message)
      ? [message[0], message[1]]
      : [message, undefined];
  }
}

/** Template arguments: positional (`{}`, `{0}`) or named (`{name}`). */
export type TemplateArgsValue =
  | readonly (string | number)[]
  | Readonly<Record<string, string | number>>
  | null;

const argument = (value: string | number | undefined) =>
  typeof value === "number"
    ? Number.isInteger(value)
      ? value.toFixed(0)
      : String(value)
    : (value ?? "");

/**
 * Format a template the way Slint's `@tr` and the player do: `{}` takes
 * the next argument, `{0}` the first, `{name}` a field of an object; `{{`
 * and `}}` are braces. A placeholder without an argument stays as written.
 */
export function format(template: string, args: TemplateArgsValue): string {
  let out = "";
  let next = 0;
  let rest = template;
  for (;;) {
    const at = rest.search(/[{}]/);
    if (at < 0) break;
    out += rest.slice(0, at);
    const tail = rest.slice(at);
    if (tail.startsWith("{{") || tail.startsWith("}}")) {
      out += tail[0];
      rest = tail.slice(2);
      continue;
    }
    if (tail.startsWith("}")) {
      out += "}";
      rest = tail.slice(1);
      continue;
    }
    const close = tail.indexOf("}");
    if (close < 0) {
      out += tail;
      rest = "";
      break;
    }
    const name = tail.slice(1, close);
    let value: string | number | undefined;
    const list = Array.isArray(args)
      ? (args as readonly (string | number)[])
      : null;
    if (name === "") value = list?.[next++];
    else if (/^\d+$/.test(name)) value = list?.[Number(name)];
    else if (args && !list)
      value = (args as Record<string, string | number>)[name];
    out += value === undefined ? tail.slice(0, close + 1) : argument(value);
    rest = tail.slice(close + 1);
  }
  return out + rest;
}

/**
 * The placeholders of a template, sorted: `""` per `{}`, else the name or
 * number (`{n}` of a Slint plural is `"n"`). Translations must keep them.
 */
export function placeholders(text: string): string[] {
  const found: string[] = [];
  const plain = text.replaceAll("{{", "").replaceAll("}}", "");
  for (const match of plain.matchAll(/\{([^{}]*)\}/g)) found.push(match[1]!);
  return found.sort();
}

// ---------------------------------------------------------------- Slint @tr

/** One `@tr("context" => "id" | "plural" % n, args…)` call. */
export interface TrCall {
  context?: string;
  id: string;
  plural?: string;
  /** 1-based line of `@tr`. */
  line: number;
  /** Source offsets of the id literal (quotes included). */
  idSpan: [number, number];
  /** And of the plural literal. */
  pluralSpan?: [number, number];
}

const lineEnd = (s: string, i: number) => {
  const found = s.slice(i).search(/[\n\r]/);
  return found < 0 ? s.length : i + found;
};

function commentEnd(s: string, from: number): number {
  let depth = 0;
  let i = from + 2;
  while (i + 1 < s.length) {
    if (s[i] === "/" && s[i + 1] === "*") {
      depth++;
      i += 2;
    } else if (s[i] === "*" && s[i + 1] === "/") {
      if (depth === 0) return i + 2;
      depth--;
      i += 2;
    } else i++;
  }
  return s.length;
}

function stringEnd(s: string, from: number, templates: number[]): number {
  let i = from;
  while (i < s.length) {
    if (s[i] === '"') return i + 1;
    if (s[i] === "\\" && s[i + 1] === "{") {
      templates.push(0);
      return i + 2;
    }
    i += s[i] === "\\" ? 2 : 1;
  }
  return s.length;
}

function skip(s: string, i: number): number {
  for (;;) {
    if (/\s/.test(s[i] ?? "")) i++;
    else if (s[i] === "/" && s[i + 1] === "/") i = lineEnd(s, i);
    else if (s[i] === "/" && s[i + 1] === "*") i = commentEnd(s, i);
    else return i;
  }
}

/** A plain string literal at `i`: its span and value (no interpolation). */
function literal(s: string, i: number): [[number, number], string] | null {
  if (s[i] !== '"') return null;
  let j = i + 1;
  let value = "";
  for (;;) {
    const c = s[j];
    if (c === undefined) return null;
    if (c === '"') return [[i, j + 1], value];
    if (c !== "\\") {
      value += c;
      j++;
      continue;
    }
    const n = s[j + 1];
    if (n === '"' || n === "\\") value += n;
    else if (n === "n") value += "\n";
    else if (n === "u") {
      if (s[j + 2] !== "{") return null;
      const close = s.indexOf("}", j + 3);
      if (close < 0) return null;
      const code = Number.parseInt(s.slice(j + 3, close), 16);
      if (!/^[0-9a-fA-F]+$/.test(s.slice(j + 3, close)) || code > 0x10ffff)
        return null;
      value += String.fromCodePoint(code);
      j = close + 1;
      continue;
    } else return null;
    j += 2;
  }
}

function callAt(s: string, at: number): [TrCall, number] | null {
  let i = skip(s, at + 1);
  if (!s.startsWith("tr", i)) return null;
  i += 2;
  if (/[A-Za-z0-9_-]/.test(s[i] ?? "")) return null;
  i = skip(s, i);
  if (s[i] !== "(") return null;
  let found = literal(s, skip(s, i + 1));
  if (!found) return null;
  let [span, text] = found;
  let context: string | undefined;
  let end = skip(s, span[1]);
  if (s.startsWith("=>", end)) {
    context = text;
    found = literal(s, skip(s, end + 2));
    if (!found) return null;
    [span, text] = found;
    end = skip(s, span[1]);
  }
  let resume = span[1];
  const call: TrCall = {
    id: text,
    line: s.slice(0, at).split("\n").length,
    idSpan: span,
  };
  if (context !== undefined) call.context = context;
  if (s[end] === "|") {
    const other = literal(s, skip(s, end + 1));
    if (!other) return null;
    call.plural = other[1];
    call.pluralSpan = other[0];
    resume = other[0][1];
  }
  return [call, resume];
}

/**
 * Every `@tr` call of a Slint source, in order; the same scanner as the
 * player's (both run the shared cases of the player's
 * `src/host/tests/fixtures/slint-tr.json`). Comments, strings and string
 * interpolation are skipped; a malformed call is left out.
 */
export function scanSlint(source: string): TrCall[] {
  const calls: TrCall[] = [];
  const templates: number[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === "/" && source[i + 1] === "/") i = lineEnd(source, i);
    else if (c === "/" && source[i + 1] === "*") i = commentEnd(source, i);
    else if (c === '"') i = stringEnd(source, i + 1, templates);
    else if (c === "{" && templates.length) {
      templates[templates.length - 1]!++;
      i++;
    } else if (c === "}" && templates.length) {
      if (templates[templates.length - 1] === 0) {
        templates.pop();
        i = stringEnd(source, i + 1, templates);
      } else {
        templates[templates.length - 1]!--;
        i++;
      }
    } else if (c === "@") {
      const found = callAt(source, i);
      if (found) {
        calls.push(found[0]);
        i = found[1];
      } else i++;
    } else i++;
  }
  return calls;
}

/** A Slint string literal for `text`. */
export function slintQuote(text: string): string {
  let out = '"';
  for (const c of text) {
    if (c === '"') out += '\\"';
    else if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (/\p{Cc}/u.test(c)) out += `\\u{${c.codePointAt(0)!.toString(16)}}`;
    else out += c;
  }
  return `${out}"`;
}

/** `source` with its `@tr` literals translated (what the player compiles). */
export function rewriteSlint(source: string, catalog: Catalog): string {
  let out = "";
  let copied = 0;
  for (const call of scanSlint(source)) {
    const translation = catalog.slint(call);
    if (!translation) continue;
    out += source.slice(copied, call.idSpan[0]) + slintQuote(translation[0]);
    copied = call.idSpan[1];
    if (call.pluralSpan && translation[1] !== undefined) {
      out +=
        source.slice(copied, call.pluralSpan[0]) + slintQuote(translation[1]);
      copied = call.pluralSpan[1];
    }
  }
  return out + source.slice(copied);
}

/**
 * The supported locale for a BCP 47 tag, as the player maps the system's
 * languages: Simplified Chinese is `zh-Hans`; Traditional Chinese (`zh-Hant`,
 * or Taiwan, Hong Kong, Macao) is English; other languages by their primary
 * subtag; `undefined` for a language the player does not have.
 */
export function matchLocale(tag: string): (typeof LOCALES)[number] | undefined {
  const parts = tag
    .replaceAll("_", "-")
    .toLowerCase()
    .split(/[.@]/)[0]!
    .split("-");
  const [language, ...rest] = parts;
  if (language === "zh") {
    const script = rest.find((part) => part.length === 4);
    if (script) return script === "hans" ? "zh-Hans" : "en";
    return rest.some((r) => ["tw", "hk", "mo"].includes(r)) ? "en" : "zh-Hans";
  }
  return LOCALES.find((locale) => !locale.includes("-") && locale === language);
}

// ---------------------------------------------------------------- menus

/**
 * The player's built-in top-level menus: id → key (the English text paths
 * merge by), as the player's `MENU_ANCHORS`.
 */
export const MENU_KEYS: Readonly<Record<string, string>> = {
  open: "Open",
  playback: "Playback",
  subtitles: "Subtitles",
  video: "Video",
  audio: "Audio",
  screen: "Screen",
  settings: "Settings",
};

/** The player's old Chinese titles of its own menus: parent, title, key. */
const LEGACY_MENUS: [string[], string, string][] = [
  [[], "打开", "Open"],
  [[], "播放", "Playback"],
  [[], "字幕", "Subtitles"],
  [[], "视频", "Video"],
  [[], "声音", "Audio"],
  [[], "屏幕", "Screen"],
  [[], "设置", "Settings"],
  [["Playback"], "速度", "Speed"],
  [["Playback"], "跳转", "Seek"],
  // Shared with a migrated built-in plugin (until all are migrated).
  [["Settings"], "外观", "Appearance"],
];

/** The player's own submenus, by key path (their labels are the player's). */
export const HOST_GROUPS = [
  "Open",
  "Playback",
  "Subtitles",
  "Video",
  "Audio",
  "Screen",
  "Settings",
  "Playback/Speed",
  "Playback/Seek",
];

/**
 * The keys a path merges by, as the player normalizes it: `@id` becomes the
 * built-in menu's key, the player's old Chinese titles of its own submenus
 * their keys.
 */
export function menuKeys(path: readonly string[]): string[] {
  const keys = [...path];
  const id = keys[0]?.startsWith("@") ? keys[0].slice(1) : null;
  if (id !== null && MENU_KEYS[id]) keys[0] = MENU_KEYS[id];
  for (const [parent, old, key] of LEGACY_MENUS) {
    const depth = parent.length;
    if (
      keys.length > depth + 1 &&
      parent.every((segment, i) => keys[i] === segment) &&
      keys[depth] === old
    )
      keys[depth] = key;
  }
  return keys;
}

/**
 * The player's own texts that the test host repeats (core actions, its
 * refusals, its menus), English → the player's Simplified Chinese
 * (`src/host/locales/zh-Hans.po` in the player; its tests check that they
 * agree).
 */
export const HOST_ZH_HANS: Readonly<Record<string, string>> = {
  Open: "打开",
  Playback: "播放",
  Subtitles: "字幕",
  Video: "视频",
  Audio: "声音",
  Screen: "屏幕",
  Settings: "设置",
  Speed: "速度",
  Seek: "跳转",
  Close: "关闭",
  Cancel: "取消",
  "Play/Pause": "播放/暂停",
  Previous: "上一个",
  Next: "下一个",
  "Previous Frame": "上一帧",
  "Next Frame": "下一帧",
  "Back {} s": "后退{}秒",
  "Forward {} s": "前进{}秒",
  Normal: "正常",
  "Slower 0.1": "减速 0.1",
  "Faster 0.1": "加速 0.1",
  "Volume +": "音量 +",
  "Volume −": "音量 −",
  Mute: "静音",
  "Not supported by the current source": "当前来源不支持此操作",
  "The current source cannot step back a frame": "当前来源不支持逐帧后退",
  "No video": "没有视频",
  "No previous item": "没有上一个",
  "No next item": "没有下一个",
  Paused: "已暂停",
  Playing: "播放",
  "Back {} s: {} / {}": "后退 {}秒: {} / {}",
  "Forward {} s: {} / {}": "前进 {}秒: {} / {}",
  "Speed: {}x": "播放速度: {}x",
  "Volume: {}%": "音量: {}%",
  "Mute: On": "静音: 开",
  "Mute: Off": "静音: 关",
  "bottom bar": "底栏",
  sidebar: "侧栏",
  "video backdrop": "视频背景",
  "The {} is used by {}": "{}已被 {} 使用",
  "The sidebar holds at most {} tabs": "侧栏最多 {} 个页签",
  "{} is resolved by {}": "{} 已由 {} 解析",
  "File type .{}": "文件类型 .{}",
  "Not available in fullscreen": "全屏时不可用",
  "Picture-in-picture is not supported on this system": "此系统不支持画中画",
};
