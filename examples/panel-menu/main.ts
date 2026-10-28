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
  // Sent when the panel mounts, then whenever a value changes.
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
  // Callbacks of the bridge global; `bind` above sends the new selection.
  panel.on("select", (index: number) => (selected = index));
  // x and y: the pointer in window pixels, from the Slint file.
  panel.on("contextMenu", (x: number, y: number) =>
    panel.showMenu([first, null, remove], { x, y }),
  );
  // #endregion menu
}
