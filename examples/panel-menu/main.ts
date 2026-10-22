import type { Plugin } from "@vestra-player/sdk";

/**
 * A sidebar panel with its own right-click menu, a key that works only
 * while the panel has focus, commands outside the main menu, and the shared
 * next/previous it provides. Detach it with the core-ui example.
 * Use it instead of the playlist: there is one sidebar.
 */
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
  // #region move
  const move = (step: number) =>
    (selected = Math.max(0, Math.min(items.length - 1, selected + step)));
  // #endregion move

  // #region commands
  const first = plugin.commands.add({
    id: "first",
    title: "Select the first item",
    focus: "panel",
    bindings: ["Home"],
    run: () => (selected = 0),
  });
  const remove = plugin.commands.add({
    id: "remove",
    title: "Remove the selected item",
    focus: "panel",
    bindings: ["Delete"],
    enabled: () => items.length > 0,
    run: () => {
      items.splice(selected, 1);
      move(0);
    },
  });
  // #endregion commands
  // #region menu
  panel.on("select", (index: number) => (selected = index));
  panel.on("contextMenu", (x: number, y: number) =>
    panel.showMenu([first, null, remove], { x, y }),
  );
  // #endregion menu

  // #region sequence
  plugin.player.provideSequence({
    canNext: () => selected < items.length - 1,
    canPrevious: () => selected > 0,
    next: () => move(1),
    previous: () => move(-1),
  });
  // #endregion sequence
}
