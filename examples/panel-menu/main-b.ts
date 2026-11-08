import type { Plugin } from "@vestra-player/sdk";

/**
 * The panel menu in style B: the same plugin as main.ts, with the panel's
 * values and the command's state sent explicitly after each change instead
 * of `bind` and an `enabled` function. To run it, point the manifest's
 * `entry` at this file. Walkthrough: docs/examples/panel-menu.md.
 */
export default async function activate(plugin: Plugin) {
  const items = ["First item", "Second item", "Third item"];
  let selected = 0;
  const panel = plugin.panels.mount("sidebar", "ui/panel.slint", {
    title: "Example list",
  });

  // #region show
  // Send the state: whole values, as often as it changes.
  const show = () => {
    panel.set({ rows: items, selected });
    remove.set({ enabled: items.length > 0 });
  };
  // #endregion show

  // #region commands
  const first = plugin.commands.add({
    id: "first",
    title: "Select the first item",
    run: () => {
      selected = 0;
      show();
    },
  });
  const remove = plugin.commands.add({
    id: "remove",
    title: "Remove the selected item",
    run: () => {
      items.splice(selected, 1);
      selected = Math.max(0, Math.min(selected, items.length - 1));
      show(); // the whole list again
    },
  });
  // #endregion commands

  panel.on("select", (index: number) => {
    selected = index;
    panel.set({ selected });
  });
  panel.on("contextMenu", (x: number, y: number) =>
    panel.showMenu([first, null, remove], { x, y }),
  );
  show(); // the initial values
}
