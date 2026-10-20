/** Finite candidate command registry. Host authenticates owner; no plugin supplies an owner id. */
import type { Transport } from "./wire.ts";
export type CommandState = {
  enabled: boolean;
  checked: boolean | null;
  busy: boolean;
  reason: string | null;
};
/**
 * Migration-window form (P1b–P3): only `title`, `path` and the display-only
 * `shortcut`. Removed in P4; the host still accepts it until then.
 */
export type LegacyCommandDeclaration = {
  title: string;
  path: string[];
  shortcut: string | null;
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
      declaration: CommandDeclaration | LegacyCommandDeclaration,
      state: CommandState,
    ) =>
      transport.request<{ revision: number }>("commands.register", {
        id,
        revision,
        declaration,
        state,
      }),
    update: (id: string, revision: number, state: CommandState) =>
      transport.request<{ revision: number }>("commands.update", {
        id,
        revision,
        state,
      }),
  };
}
