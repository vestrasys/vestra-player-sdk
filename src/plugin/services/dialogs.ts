/**
 * System dialogs (`plugin.dialogs`): the player shows them; this side
 * checks the texts and fills their templates (L1, a service;
 * doc/specs/sdk-refactor.md §2.2 in the player repository).
 */
import { isTextValue } from "../../i18n.ts";
import type { Json } from "../../wire.ts";
import { failure } from "../errors.ts";
import { shownText, templateArgs } from "../osd.ts";
import type { ScopeImpl } from "../scope.ts";
import type { Dialogs, TextValue } from "../types.ts";

export const dialogs = (scope: ScopeImpl): Dialogs => {
  const open = async (
    kind: "openFile" | "openFiles" | "openDirectory" | "saveFile",
    options: { title?: TextValue; fileName?: TextValue } = {},
  ) => {
    const result = await scope.runtime.host.dialogs.open({
      kind,
      ...(options.title === undefined
        ? {}
        : { title: shownText(options.title, undefined, "title") }),
      ...(options.fileName === undefined
        ? {}
        : { fileName: shownText(options.fileName, undefined, "fileName") }),
    });
    return result.cancelled ? [] : result.paths;
  };
  return {
    async confirm(options) {
      const { message, detail, confirm, cancel, destructive, checkbox, args } =
        options ?? ({} as never);
      const values = templateArgs(args);
      // A string's length is checked here; a text value's (shown) length by
      // the player.
      const length = (text: unknown, min: number, max: number) =>
        isTextValue(text) ||
        (typeof text === "string" &&
          [...text].length >= min &&
          [...text].length <= max);
      if (
        !length(message, 1, 200) ||
        !length(confirm, 1, 40) ||
        (detail !== undefined && !length(detail, 0, 2000)) ||
        (cancel !== undefined && !length(cancel, 1, 40)) ||
        (checkbox !== undefined && !length(checkbox, 1, 40)) ||
        (destructive !== undefined && typeof destructive !== "boolean")
      )
        throw failure(
          "invalid",
          "confirm needs message 1–200, confirm/cancel/checkbox 1–40, detail ≤ 2000 characters",
        );
      // `args` fills the string templates; a text value carries its own.
      const shown = (text: TextValue, what: string) =>
        shownText(text, undefined, what);
      const answer = await scope.runtime.host.dialogs.confirm({
        message: shown(message, "message"),
        confirm: shown(confirm, "confirm"),
        ...(detail === undefined ? {} : { detail: shown(detail, "detail") }),
        ...(cancel === undefined ? {} : { cancel: shown(cancel, "cancel") }),
        ...(destructive === undefined ? {} : { destructive }),
        ...(checkbox === undefined
          ? {}
          : { checkbox: shown(checkbox, "checkbox") }),
        ...(values === undefined ? {} : { args: values }),
      } as { [key: string]: Json });
      return {
        confirmed: answer.confirmed === true,
        checked: answer.checked === true,
      };
    },
    openFile: async (options) => (await open("openFile", options))[0] ?? null,
    openFiles: (options) => open("openFiles", options),
    openDirectory: async (options) =>
      (await open("openDirectory", options))[0] ?? null,
    saveFile: async (options) => (await open("saveFile", options))[0] ?? null,
  };
};
