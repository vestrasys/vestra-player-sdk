/**
 * On-screen messages and the OSD panel (`osd.show`, `osd.panel`).
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import type { Json } from "../../wire.ts";
import { OSD_LIMITS } from "../osd.ts";
import { fitColumns } from "../../i18n.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";
import { shownText } from "./i18n.ts";

/** The default handlers of this area's wire methods, by method name. */
export function osdHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    "osd.show": (p) => {
      const text = shownText(host, inner, p.text, p.args, "text").replace(
        /[\n\r]/g,
        " ",
      );
      if (!text.trim() || [...text].length > OSD_LIMITS.messageChars)
        throw new HostError(
          "invalid",
          `osd text needs 1..${OSD_LIMITS.messageChars} characters`,
        );
      // Player 0.7.6: up to 2 buttons, each a command of this plugin.
      const sent = p.actions as { title: Json; command: Json }[] | undefined;
      if (
        sent !== undefined &&
        (!Array.isArray(sent) || sent.length > OSD_LIMITS.actions)
      )
        throw new HostError(
          "invalid",
          `actions is a list of at most ${OSD_LIMITS.actions}`,
        );
      const actions = (sent ?? []).map((action) => {
        const title = shownText(
          host,
          inner,
          action.title,
          undefined,
          "title",
        ).replace(/[\n\r]/g, " ");
        if (!title.trim() || [...title].length > OSD_LIMITS.actionChars)
          throw new HostError(
            "invalid",
            `an action title needs 1..=${OSD_LIMITS.actionChars} characters`,
          );
        const command = String(action.command);
        if (!host.commands.has(command))
          throw new HostError(
            "invalid",
            `${command} is not a command of this plugin`,
          );
        return { title, command };
      });
      host.osd.push(text);
      host.osdActions.push(actions);
    },
    "osd.panel": (p) => {
      if (p.text === null) return void (host.osdPanel = null);
      const max = p.maxColumns;
      if (
        max !== undefined &&
        !(
          Number.isInteger(max) &&
          Number(max) >= OSD_LIMITS.minColumns &&
          Number(max) <= OSD_LIMITS.maxColumns
        )
      )
        throw new HostError(
          "invalid",
          `maxColumns is an integer from ${OSD_LIMITS.minColumns} to ${OSD_LIMITS.maxColumns}`,
        );
      const shown = shownText(host, inner, p.text, p.args, "text");
      const text = max === undefined ? shown : fitColumns(shown, Number(max));
      // As the player: \n separates lines, a trailing one ends the last.
      const lines = text.split("\n");
      if (text.endsWith("\n")) lines.pop();
      if (
        Buffer.byteLength(text) > OSD_LIMITS.panelBytes ||
        lines.length > OSD_LIMITS.panelLines
      )
        throw new HostError(
          "invalid",
          `osd panel allows ${OSD_LIMITS.panelLines} lines, ${OSD_LIMITS.panelBytes} bytes`,
        );
      host.osdPanel = text;
    },
  };
}
