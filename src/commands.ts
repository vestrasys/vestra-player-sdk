/** Finite candidate command registry. Host authenticates owner; no plugin supplies an owner id. */
import type { Transport } from "./wire.ts";
/**
 * The player's command registry caps, the same values as the player's own
 * table (the player's tests check that they agree). They are runaway guards,
 * not product limits: a command added past them fails with code `limit`
 * (its `ready` rejects; during activation, activation fails), commands
 * already registered are unaffected, and disposing a command frees its slot
 * at once. {@link TestHost} enforces the same caps.
 *
 * For menus built from media content (tracks, chapters, presets), set your
 * own sensible display cap well below `perPlugin`.
 *
 * @example
 * ```ts
 * import { COMMAND_LIMITS } from "@vestra-player/sdk/testing";
 *
 * const shown = chapters.slice(0, Math.min(50, COMMAND_LIMITS.perPlugin - 20));
 * ```
 */
export const COMMAND_LIMITS = {
  /**
   * Commands one plugin instance may have at the same time (160). A trial
   * package is its own instance.
   */
  perPlugin: 160,
  /** Commands of every plugin plus the player's own, together (1024). */
  total: 1024,
} as const;
export type CommandState = {
  enabled: boolean;
  checked: boolean | null;
  busy: boolean;
  reason: string | null;
};
export type CommandDeclaration = {
  title: string;
  /** Complete primary menu path INCLUDING its leaf; empty = not in the main menu. */
  path: string[];
  /** Sibling order, ascending; a submenu takes its first command's order. */
  order: number;
  /** Separator label: adjacent siblings of different groups get a line. */
  group: string;
  /** Draw `checked` as a radio dot. */
  radio: boolean;
  /** Default input bindings, canonical strings (see sdk/plugin/bindings.ts). */
  bindings: string[];
  /** "panel": bindings apply only while this plugin's panel has focus. */
  focus: "panel" | null;
  /** Fire again on keyboard auto-repeat while held. */
  repeat: boolean;
};
export function commandClient(transport: Transport) {
  return {
    register: (
      id: string,
      revision: number,
      declaration: CommandDeclaration,
      state: CommandState,
    ) =>
      transport.request<{ revision: number }>("commands.register", {
        id,
        revision,
        declaration,
        state,
      }),
    /** Remove the command from the menu and the binding table; the id is free again. */
    unregister: (id: string) =>
      transport.request<void>("commands.unregister", { id }),
    update: (id: string, revision: number, state: CommandState) =>
      transport.request<{ revision: number }>("commands.update", {
        id,
        revision,
        state,
      }),
  };
}
