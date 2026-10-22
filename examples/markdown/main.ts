import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Plugin } from "@vestra-player/sdk";

/**
 * Demonstrates the core Markdown component: a tool window with
 * `MarkdownView` from `@vestra/markdown.slint`, filled with
 * `plugin.ui.markdown`. Relative images resolve against this package's
 * directory; `https:` images are downloaded by the SDK. Links: web
 * addresses open in the browser, `#anchors` only show an on-screen message.
 */
export default async function activate(plugin: Plugin) {
  // #region document
  const directory = fileURLToPath(new URL(".", import.meta.url));
  const window = plugin.windows.create("ui/document.slint");
  window.on("openLink", (url: string) => {
    if (/^https?:\/\//.test(url)) return plugin.system.openUrl(url);
    return plugin.osd.show(`Link: ${url}`);
  });
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
