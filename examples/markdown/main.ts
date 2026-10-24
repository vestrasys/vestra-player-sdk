// #region imports
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@vestra-player/sdk";
// #endregion imports

/** A tool window that shows a Markdown document. */
export default async function activate(plugin: Plugin) {
  // #region document
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const window = plugin.windows.create("ui/document.slint");
  plugin.commands.add({
    id: "show",
    path: ["Examples", "Markdown example…"],
    run: async () => {
      const text = readFileSync(new URL("sample.md", import.meta.url), "utf8");
      window.set({ doc: await plugin.ui.markdown(text, { base: directory }) });
      await window.show();
    },
  });
  // #endregion document
}
