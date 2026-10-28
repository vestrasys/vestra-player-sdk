/** On-screen display: a transient line and a persistent information block. */
import { Latest } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import { failure } from "./runtime.ts";
import type {
  Osd,
  OsdPanel,
  OsdPanelOptions,
  TemplateArgs,
  TextValue,
} from "./types.ts";
import type { TemplateArgsJson, TextValueJson } from "../wire.ts";
import { isTextValue, textProblem } from "../i18n.ts";
import type { ArgJson } from "../i18n.ts";

/**
 * The player's limits on the on-screen display ({@link Osd}), counted on
 * the text as shown: after the player translated it and filled in its
 * arguments. A text over them fails with code `invalid`: `osd.show`
 * rejects, `OsdPanel.set` reports to `Scope.onError`. The player's tests
 * check that these agree with the player.
 *
 * @example Keep a long list inside the information block's limits
 * The block shows the first 32 rows of a list, each cut at 60 columns. The
 * player counts the text as shown (after it is translated and formatted); a
 * block over `panelLines` lines or `panelBytes` bytes is refused whole with
 * `invalid`, reported to `Scope.onError` because `set` never throws, so
 * the plugin trims the list itself (for very long non-ASCII rows, check the
 * bytes too).
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * declare const rows: string[];
 * // ---cut---
 * import { OSD_LIMITS } from "@vestra-player/sdk/testing";
 *
 * const panel = plugin.osd.panel();
 * const lines = rows.slice(0, OSD_LIMITS.panelLines);
 * // maxColumns cuts each longer line and ends it with "…".
 * panel.set(lines.join("\n"), null, { maxColumns: 60 });
 * ```
 *
 * @since 1.5.14
 */
export const OSD_LIMITS = Object.freeze({
  /**
   * Characters of one `osd.show` message (200; at least 1 that is not
   * white space). Line breaks are shown as spaces.
   */
  messageChars: 200,
  /** Lines of the information block (`OsdPanel.set`) (32). */
  panelLines: 32,
  /** UTF-8 bytes of the information block (4096). */
  panelBytes: 4096,
  /** The smallest `OsdPanelOptions.maxColumns` (8). */
  minColumns: 8,
  /** The largest `OsdPanelOptions.maxColumns` (1000). */
  maxColumns: 1000,
} as const);

/**
 * Copy and check template arguments: an array or object of at most 16
 * strings, finite numbers, texts and lists (`TEXT_LIMITS`).
 */
export function templateArgs(args: unknown): TemplateArgsJson | undefined {
  if (args === undefined || args === null) return undefined;
  const problem = textProblem(args, "args");
  if (problem) throw failure("invalid", problem);
  return Array.isArray(args)
    ? [...(args as ArgJson[])]
    : { ...(args as Record<string, ArgJson>) };
}

/**
 * Check a shown text (`osd.show`, dialogs): source text, or a text value
 * that carries its own arguments (then `args` is not given).
 */
export function shownText(
  text: unknown,
  args: unknown,
  what = "text",
): TextValueJson {
  if (typeof text === "string") return text;
  if (isTextValue(text)) {
    const problem = textProblem(text);
    if (problem) throw failure("invalid", `${what}: ${problem}`);
    if (args !== undefined && args !== null)
      throw failure(
        "invalid",
        `${what} is a text value: its args go inside it, not in args`,
      );
    return text;
  }
  throw failure("invalid", `${what} is a string or a text value`);
}

type PanelText = {
  text: TextValueJson | null;
  args?: TemplateArgsJson;
  maxColumns?: number;
};

class PanelHandle implements OsdPanel {
  readonly #scope: ScopeImpl;
  readonly #pump: Latest<PanelText>;
  /** The last value sent, as JSON (`null` text: hidden). */
  #last = JSON.stringify({ text: null });
  #disposed = false;
  constructor(scope: ScopeImpl) {
    if (scope.runtime.services.has("osd.panel"))
      throw new Error("a plugin can have only one osd panel");
    scope.runtime.services.set("osd.panel", this);
    this.#scope = scope;
    this.#pump = new Latest(({ text, args, maxColumns }) =>
      scope.runtime.host.osd.panel(text, args, maxColumns),
    );
    scope.add(this);
  }
  set(
    text: TextValue | null,
    args?: TemplateArgs | null,
    options: OsdPanelOptions = {},
  ) {
    if (this.#disposed) return;
    let value: PanelText;
    try {
      const max = options?.maxColumns;
      if (
        max !== undefined &&
        !(
          Number.isInteger(max) &&
          max >= OSD_LIMITS.minColumns &&
          max <= OSD_LIMITS.maxColumns
        )
      )
        throw failure(
          "invalid",
          `maxColumns is an integer from ${OSD_LIMITS.minColumns} to ${OSD_LIMITS.maxColumns}`,
        );
      value = {
        text: text === null ? null : shownText(text, args),
        ...(text === null || args === undefined || args === null
          ? {}
          : { args: templateArgs(args)! }),
        ...(text === null || max === undefined ? {} : { maxColumns: max }),
      };
    } catch (error) {
      this.#scope.report(error);
      return;
    }
    const key = JSON.stringify(value);
    if (key === this.#last) return;
    this.#last = key;
    this.#pump.push(value).catch((error) => this.#scope.report(error));
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    this.#scope.runtime.services.delete("osd.panel");
    if (this.#last !== JSON.stringify({ text: null }))
      await this.#pump.push({ text: null }).catch(() => {});
    this.#pump.stop();
  }
}

export const osd = (scope: ScopeImpl): Osd => ({
  show: async (text, args) =>
    scope.runtime.host.osd.show(shownText(text, args), templateArgs(args)),
  panel: () => new PanelHandle(scope),
});
