/** `plugin.i18n`: the interface language of this run and text values (read-only). */
import {
  Catalog,
  isTextValue,
  LIST_STYLES,
  loadPackageCatalog,
  renderText,
  textKey,
  textProblem,
} from "../i18n.ts";
import type { ListJson, TextJson } from "../i18n.ts";
import { failure } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  I18n,
  ListStyle,
  TemplateArgs,
  Text,
  TextArg,
  TextError,
  TextList,
} from "./types.ts";

/** Copy arguments (arrays and objects only; texts are already frozen). */
const copyArgs = (args: TemplateArgs) =>
  Array.isArray(args) ? Object.freeze([...args]) : Object.freeze({ ...args });

/** `plugin.i18n.text`: a plain, frozen text value (no translation here). */
export function text(source: string, args?: TemplateArgs): Text {
  const value: TextJson = { $vestraText: source };
  if (args !== undefined && args !== null)
    (value as { args?: unknown }).args = copyArgs(args);
  const problem = textProblem(value);
  if (problem) throw failure("invalid", `text: ${problem}`);
  return Object.freeze(value) as unknown as Text;
}

/** `plugin.i18n.list`: a plain, frozen list value. */
export function list(items: readonly TextArg[], style?: ListStyle): TextList {
  if (!Array.isArray(items))
    throw failure("invalid", "list: items is an array");
  if (
    style !== undefined &&
    !(LIST_STYLES as readonly string[]).includes(style)
  )
    throw failure("invalid", `list: style is one of ${LIST_STYLES.join(", ")}`);
  const value: ListJson = {
    $vestraList: Object.freeze([
      ...items,
    ]) as unknown as ListJson["$vestraList"],
    ...(style === undefined ? {} : { style }),
  };
  const problem = textProblem(value);
  if (problem) throw failure("invalid", `list: ${problem}`);
  return Object.freeze(value) as unknown as TextList;
}

/** `plugin.i18n.error`: an Error whose message the player shows translated. */
class TextErrorImpl extends Error implements TextError {
  readonly text: Text;
  constructor(value: Text) {
    super(textKey(value as never));
    this.name = "TextError";
    this.text = value;
  }
}
export const error = (source: string, args?: TemplateArgs): TextError =>
  new TextErrorImpl(text(source, args));

/** The plugin's catalog for this run's language, read once per runtime. */
const catalogs = new WeakMap<object, Catalog>();
function catalogOf(scope: ScopeImpl): Catalog {
  const runtime = scope.runtime;
  let catalog = catalogs.get(runtime);
  if (!catalog) {
    try {
      catalog = loadPackageCatalog(runtime.directory, runtime.locale);
    } catch (error) {
      // As the player: a broken catalog is reported and treated as missing.
      console.error(`[${scope.id}] i18n: ${(error as Error).message}`);
      catalog = new Catalog();
    }
    catalogs.set(runtime, catalog);
  }
  return catalog;
}

export const i18n = (scope: ScopeImpl): I18n =>
  Object.freeze({
    get locale() {
      return scope.runtime.locale;
    },
    text,
    list,
    error,
    resolve(value: unknown): string {
      if (typeof value === "string") return catalogOf(scope).text(value);
      const problem = isTextValue(value)
        ? textProblem(value)
        : "resolve takes a string or a text value";
      if (problem) throw failure("invalid", `resolve: ${problem}`);
      return renderText(value as never, catalogOf(scope), scope.runtime.locale);
    },
  });
