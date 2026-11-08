/**
 * The player's checks of a command declaration (capabilities/commands.rs,
 * commands.rs), with its codes and messages.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import { COMMAND_LIMITS } from "../../commands.ts";
import { isTextValue, textKey, textProblem } from "../../i18n.ts";

/**
 * The player's refusal of a declaration (commands.rs `CommandError`): code
 * `invalid`, `conflict` or `limit`, its message prefixed as the player's.
 */
export const commandInvalid = (message: string) =>
  new HostError("invalid", `invalid command: ${message}`);

export const commandConflict = (message: string) =>
  new HostError("conflict", `command conflict: ${message}`);

/**
 * The player's check of a command text (commands.rs `text`): 1 to `limit`
 * UTF-8 bytes, no control character (`char::is_control`: C0, DEL and C1)
 * and no whitespace at either end (`str::trim`: Unicode White_Space).
 */
export function commandText(value: string, label: string, limit: number) {
  const bytes = Buffer.byteLength(value, "utf8");
  if (
    bytes === 0 ||
    bytes > limit ||
    /^\p{White_Space}|\p{White_Space}$/u.test(value) ||
    /\p{Cc}/u.test(value)
  )
    throw commandInvalid(
      `${label} requires 1..=${limit} bytes, no controls or surrounding whitespace`,
    );
}

/**
 * A menu text (title or path segment) as the player keys it: a string as
 * declared, a text value by its English rendering (capabilities/commands.rs
 * `menu_text`).
 */
export function menuTextKey(value: unknown): string {
  if (typeof value === "string") return value;
  if (!isTextValue(value))
    throw new HostError(
      "invalid",
      "title and path segments are strings or texts",
    );
  if ("$vestraList" in value)
    throw new HostError(
      "invalid",
      "a menu text is a string or a text, not a list",
    );
  const problem = textProblem(value);
  if (problem) throw new HostError("invalid", problem);
  return textKey(value);
}

/**
 * The declaration checks of the player's `Registry::register`, in its
 * order, on the keyed title and path (`@<id>` already replaced).
 */
export function checkDeclaration(
  id: string,
  title: string,
  path: readonly string[],
  declaration: {
    group?: unknown;
    order?: unknown;
    bindings?: unknown;
    home?: unknown;
  },
  category: string | null = null,
) {
  commandText(id, "localId", COMMAND_LIMITS.idBytes);
  if (!/^[A-Za-z0-9._-]+$/.test(id))
    throw commandInvalid(
      "localId permits ASCII letters, digits, '.', '_' and '-'",
    );
  commandText(title, "title", COMMAND_LIMITS.titleBytes);
  if (path.length > COMMAND_LIMITS.depth)
    throw commandInvalid(
      `menu path allows at most ${COMMAND_LIMITS.depth} segments`,
    );
  for (const segment of path)
    commandText(segment, "path segment", COMMAND_LIMITS.segmentBytes);
  const group = declaration.group ?? "domain";
  if (typeof group !== "string")
    throw new HostError("invalid", "group is a string");
  commandText(group, "group", COMMAND_LIMITS.groupBytes);
  // Player 0.7.6: the category and the home command's local id.
  if (category !== null)
    commandText(category, "category", COMMAND_LIMITS.categoryBytes);
  const home = declaration.home;
  if (home !== undefined && home !== null) {
    if (typeof home !== "string")
      throw new HostError("invalid", "home is a command id");
    commandText(home, "home", COMMAND_LIMITS.idBytes);
    if (!/^[A-Za-z0-9._-]+$/.test(home))
      throw commandInvalid(
        "home permits ASCII letters, digits, '.', '_' and '-'",
      );
  }
  const order = declaration.order ?? 0;
  if (
    !Number.isInteger(order) ||
    Math.abs(order as number) > COMMAND_LIMITS.order
  )
    throw commandInvalid("order must be within ±1000000");
}
