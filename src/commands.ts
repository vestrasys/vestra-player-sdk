/** Finite candidate command registry. Host authenticates owner; no plugin supplies an owner id. */
import type { Transport } from "./wire.ts";
/**
 * The player's command registry caps (host/src/commands.rs, reference.md §4).
 * Runaway guards, not product limits: past them `commands.register` fails
 * with code `limit`. `perPlugin` counts one plugin instance (a trial package
 * is its own instance); `total` counts every plugin plus the player's own.
 */
export const COMMAND_LIMITS = { perPlugin: 160, total: 1024 } as const;
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
