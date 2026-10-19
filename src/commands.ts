/** Finite candidate command registry. Host authenticates owner; no plugin supplies an owner id. */
import type { Transport, Json } from "./index.ts";
export type CommandState = {
  enabled: boolean;
  checked: boolean | null;
  busy: boolean;
  reason: string | null;
};
export type CommandDeclaration = {
  title: string;
  /** Complete primary menu path INCLUDING its leaf (title is the display label).
   * Example: title: "保存当前画面…", path: ["视频", "截图与导出", "保存当前画面…"].
   * A parent-only path would register the parent itself as a leaf and conflict. */
  path: string[];
  /** Unmodified main-canvas Space/ArrowLeft/ArrowRight route to this command.
   * Other values are display-only. F11/Escape remain host controls. */
  shortcut: string | null;
};
export type CommandExecution = { id: string; revision: number };
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
    update: (id: string, revision: number, state: CommandState) =>
      transport.request<{ revision: number }>("commands.update", {
        id,
        revision,
        state,
      }),
    snapshot: () => transport.request<Json>("commands.snapshot"),
    execute: (id: string) =>
      transport.request<void>("commands.execute", { id }),
    onExecute: (listener: (event: CommandExecution) => void) =>
      transport.on("commands.execute", (data) =>
        listener(data as CommandExecution),
      ),
  };
}
