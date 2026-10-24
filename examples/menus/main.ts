// #region setup
import type { Plugin, Scope } from "@vestra-player/sdk";

/** Menu items: radio items, separator groups and a title that changes. */
export default async function activate(plugin: Plugin) {
  const { player } = plugin;
  // #endregion setup

  // #region title
  let status: Scope = plugin.scope();
  async function showSpeed(rate: number) {
    await status.dispose(); // removes the previous item from the menu
    status = plugin.scope();
    status.commands.add({
      id: "speed",
      path: ["Examples", `Speed: ${rate}×`],
      order: 860,
      group: "status",
      enabled: false,
      run() {},
    });
  }
  await showSpeed(player.state.rate);
  // #endregion title

  // #region radio
  for (const [index, rate] of [0.5, 1, 1.5, 2].entries())
    plugin.commands.add({
      id: `rate-${rate}`,
      path: ["Examples", `${rate}×`],
      order: 850 + index,
      group: "speeds",
      radio: true,
      checked: () => player.state.rate === rate,
      enabled: () => player.state.can.rate,
      run: async () => {
        await player.setRate(rate);
        await showSpeed(rate);
      },
    });
  // #endregion radio
}
