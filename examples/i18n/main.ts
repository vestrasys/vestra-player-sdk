/**
 * Counter: Tools ▸ Counter… opens a window with one button that counts
 * clicks, in the player's language. The texts are English; the player
 * translates them with locales/<lang>.po. Walkthrough: docs/examples/i18n.md.
 */
// #region activate
import type { Plugin } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  let count = 0;
  // #endregion activate

  // #region window
  // The window's texts are in its Slint file (@tr); TypeScript passes data.
  const window = plugin.windows.create("ui/counter.slint");
  window.bind(() => ({ count }));
  window.on("add", () => {
    count += 1;
    // A template and its arguments, never a sentence built in TypeScript.
    return plugin.osd.show("Count: {}", [count]);
  });
  // #endregion window

  // #region command
  // Declared texts are English; the player shows them translated.
  plugin.commands.add({
    id: "counter",
    path: ["Tools", "Counter…"],
    run: () => window.show(),
  });
  // #endregion command
}
