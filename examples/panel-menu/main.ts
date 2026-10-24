import type { Plugin } from "@vestra-player/sdk";

/** A sidebar panel with its own right-click menu. */
export default async function activate(plugin: Plugin) {
  // #region state
  const items = ["First item", "Second item", "Third item"];
  let selected = 0;
  // #endregion state

  // #region mount
  const panel = plugin.panels.mount("sidebar", "ui/panel.slint", {
    title: "Example list",
  });
  panel.bind(() => ({ rows: items, selected }));
  // #endregion mount

  // #region commands
  const first = plugin.commands.add({
    id: "first",
    title: "Select the first item",
    run: () => (selected = 0),
  });
  const remove = plugin.commands.add({
    id: "remove",
    title: "Remove the selected item",
    enabled: () => items.length > 0,
    run: () => {
      items.splice(selected, 1);
      selected = Math.max(0, Math.min(selected, items.length - 1));
    },
  });
  // #endregion commands

  // #region menu
  panel.on("select", (index: number) => (selected = index));
  panel.on("contextMenu", (x: number, y: number) =>
    panel.showMenu([first, null, remove], { x, y }),
  );
  // #endregion menu
}
