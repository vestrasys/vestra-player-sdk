import type { Plugin } from "@vestra-player/sdk";

/** A tool window drawn with the player's own theme and widgets. */
export default async function activate(plugin: Plugin) {
  // #region window
  let level = 0.5;
  const themeWidgetsWindow = plugin.windows.create("ui/theme-widgets.slint");
  themeWidgetsWindow.bind(() => ({
    level,
    label: `Level ${Math.round(level * 100)}`,
  }));
  themeWidgetsWindow.on("levelChanged", (value: number) => (level = value));
  themeWidgetsWindow.on("reset", () => (level = 0.5));
  // #endregion window

  // #region command
  plugin.commands.add({
    id: "open",
    path: ["Examples", "Theme widgets…"],
    run: () => themeWidgetsWindow.show(),
  });
  // #endregion command
}
