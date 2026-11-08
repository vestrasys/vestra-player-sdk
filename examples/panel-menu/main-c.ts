import type { Plugin } from "@vestra-player/sdk";

/**
 * The panel menu in style C: the same plugin as main.ts, with the list
 * written directly through `plugin.wire` and a removal sent as the
 * plugin's own row operation. Experimental: the wire protocol is not
 * semver, so this code changes with player versions. To run it, point the
 * manifest's `entry` at this file. Walkthrough: docs/examples/panel-menu.md.
 */
export default async function activate(plugin: Plugin) {
  const items = ["First item", "Second item", "Third item"];
  let selected = 0;
  const panel = plugin.panels.mount("sidebar", "ui/panel.slint", {
    title: "Example list",
  });

  // #region direct
  const direct = plugin.wire.view(panel); // writes below set() and bind()
  /** A write refused because the panel does not show: nothing to do. */
  const dropped = () => {};
  const select = (index: number) => {
    selected = index;
    direct.write("selected", { value: selected }).catch(dropped);
  };
  // Direct writes need a panel that shows: the whole list once it does.
  panel.ready
    .then(() => direct.write("rows", { value: items }))
    .then(() => select(selected))
    .catch(dropped);
  // #endregion direct

  // #region commands
  // showMenu takes commands made with commands.add, so they stay.
  const first = plugin.commands.add({
    id: "first",
    title: "Select the first item",
    run: () => select(0),
  });
  const remove = plugin.commands.add({
    id: "remove",
    title: "Remove the selected item",
    run: () => {
      const at = selected;
      items.splice(at, 1);
      // One row operation: only the removal crosses to the player.
      direct.writeRows("rows", [{ op: "remove", at, count: 1 }]).catch(dropped);
      select(Math.max(0, Math.min(at, items.length - 1)));
      remove.set({ enabled: items.length > 0 });
    },
  });
  // #endregion commands

  panel.on("select", (index: number) => select(index));
  panel.on("contextMenu", (x: number, y: number) =>
    panel.showMenu([first, null, remove], { x, y }),
  );
}
