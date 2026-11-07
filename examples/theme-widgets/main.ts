import type { Plugin } from "@vestra-player/sdk";

/** A tool window drawn with the player's own theme and widgets. */
export default async function activate(plugin: Plugin) {
  // #region window
  let level = 0.5;
  const step = (delta: number) =>
    (level = Math.min(1, Math.max(0, Math.round((level + delta) * 100) / 100)));
  const themeWidgetsWindow = plugin.windows.create("ui/theme-widgets.slint");
  themeWidgetsWindow.bind(() => ({
    level,
    label: `Level ${Math.round(level * 100)}`,
    // The keys of the two commands below as the menus write them, always
    // the current ones: "" hides a cap (no key, or the user cleared it).
    levelDown: plugin.commands.keys("level.down")[0] ?? "",
    levelUp: plugin.commands.keys("level.up")[0] ?? "",
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

  // #region keys
  // Outside the menu (no path), in the command palette and on their keys.
  plugin.commands.add({
    id: "level.down",
    title: "Level −",
    bindings: ["F7"],
    repeat: true,
    run: () => step(-0.05),
  });
  plugin.commands.add({
    id: "level.up",
    title: "Level +",
    bindings: ["F8"],
    repeat: true,
    run: () => step(0.05),
  });
  // #endregion keys
}
