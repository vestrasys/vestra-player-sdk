/**
 * Texts as the player shows them: translation with the plugin's catalog, the
 * player's own texts, menu display and the appearance and language settings.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import { THEMES } from "../appearance.ts";
import type { LanguagePreference, TemplateArgs, TextValue } from "../types.ts";
import {
  format as formatTemplate,
  HOST_GROUPS,
  HOST_ZH_HANS,
  LOCALES,
  isTextValue,
  menuKeys,
  renderTemplateArgs,
  renderText,
  resolveTexts,
  textKey,
  textProblem,
} from "../../i18n.ts";
import type { ListJson, TemplateArgsValue, TextJson } from "../../i18n.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";

/** Texts only the test host uses, with their Chinese. */
export const TEST_ZH_HANS: Readonly<Record<string, string>> = {
  "this site": "这个网站",
  "External SRT": "外部 SRT",
  "External ASS": "外部 ASS",
};

/**
 * A text of a request as the player shows it, refused as the player
 * refuses it: a string is a template (formatted with `args`, if given), a
 * text value carries its own arguments.
 */
export function shownText(
  host: TestHost,
  _inner: Internals,
  text: unknown,
  args: unknown,
  what: string,
): string {
  if (args !== undefined && args !== null) {
    const problem = textProblem(args, "args");
    if (problem) throw new HostError("invalid", problem);
  }
  if (typeof text === "string")
    return host.translate(text, (args ?? undefined) as TemplateArgs);
  if (!isTextValue(text))
    throw new HostError("invalid", `${what} requires a string or a text`);
  const problem = textProblem(text);
  if (problem) throw new HostError("invalid", `${what}: ${problem}`);
  if (args !== undefined && args !== null)
    throw new HostError("invalid", `${what}: a text value takes no args`);
  return host.translate(text as TextValue);
}

/** A declared text: a string is translated as it is, a text rendered. */
export function declaredText(
  host: TestHost,
  inner: Internals,
  text: unknown,
  what: string,
): string {
  return shownText(host, inner, text, undefined, what);
}

/** Property values with their text values shown, as the player does first. */
export function shownValues<T>(host: TestHost, inner: Internals, values: T): T {
  const resolved = resolveTexts(values, inner.catalog, host.locale);
  if ("problem" in resolved) throw new HostError("invalid", resolved.problem);
  return resolved.value;
}

/** A text of the player itself, in the player's language (see `locale`). */
export function hostText(
  _host: TestHost,
  inner: Internals,
  text: string,
  args?: TemplateArgs,
): string {
  const zh = inner.locale === undefined || inner.locale === "zh-Hans";
  const shown = (zh && (HOST_ZH_HANS[text] ?? TEST_ZH_HANS[text])) || text;
  return args === undefined
    ? shown
    : formatTemplate(shown, args as TemplateArgsValue);
}

/** A declared menu path and title as the player shows them. */
export function commandDisplay(
  host: TestHost,
  inner: Internals,
  path: readonly (string | TextJson)[],
  title: string | TextJson,
  reason: TextValue | null = null,
  category: string | TextJson | null = null,
) {
  const keys = menuKeys(
    path.map((segment) =>
      typeof segment === "string" ? segment : textKey(segment),
    ),
  );
  const display = {
    title: host.translate(title as TextValue),
    // The player's submenus by key, everything else as declared.
    path: keys.map((segment, index) =>
      index < keys.length - 1 &&
      HOST_GROUPS.includes(keys.slice(0, index + 1).join("/"))
        ? hostText(host, inner, segment)
        : host.translate((path[index] ?? segment) as TextValue),
    ),
  } as { title: string; path: string[]; reason: string | null };
  // Not enumerable: `deepEqual(display, { title, path })` keeps passing.
  Object.defineProperty(display, "reason", {
    value: reason === null ? null : host.translate(reason),
    enumerable: false,
  });
  Object.defineProperty(display, "category", {
    value: category === null ? null : host.translate(category as TextValue),
    enumerable: false,
  });
  return display;
}

/** Implements `TestHost.translate`. */
export function translate(
  host: TestHost,
  inner: Internals,
  text: TextValue,
  args?: TemplateArgs,
): string {
  if (typeof text !== "string")
    return renderText(text as TextJson | ListJson, inner.catalog, host.locale);
  const values = renderTemplateArgs(
    args as TextJson["args"],
    inner.catalog,
    host.locale,
  );
  return inner.catalog.template(text, values ?? null);
}

/** The default handlers of this area's wire methods, by method name. */
export function i18nHandlers(
  host: TestHost,
  _inner: Internals,
): Record<string, Handler> {
  return {
    "appearance.setLanguage": (p) => {
      const language = String(p.language);
      if (
        language !== "system" &&
        !(LOCALES as readonly string[]).includes(language)
      )
        throw new HostError("invalid", `unknown language ${language}`);
      if (language !== host.language)
        host.setLanguage(language as LanguagePreference);
    },
    "appearance.set": (p) => {
      // Like the player: an id it does not have selects the default (the
      // SDK's own `set` refuses one before it gets here).
      const theme = THEMES.find((t) => t === p.theme) ?? THEMES[0]!;
      if (theme !== host.appearance) host.setAppearance(theme);
    },
  };
}
