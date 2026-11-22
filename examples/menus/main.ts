// #region setup
import type { Plugin, Scope } from "@vestra-player/sdk";

/** Menu items: radio items, separator groups and a title that changes. */
export default async function activate(plugin: Plugin) {
  const { player, when } = plugin;
  await player.read(); // the player's state, read once
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
  // The check marks and the enabled state are conditions: the player
  // evaluates them itself, also when the speed changes elsewhere and while
  // this plugin is in standby. `when.rate` takes an interval, min ≤ rate < max.
  for (const [index, rate] of [0.5, 1, 1.5, 2].entries())
    plugin.commands.add({
      id: `rate-${rate}`,
      path: ["Examples", `${rate}×`],
      order: 850 + index,
      group: "speeds",
      radio: true,
      checked: when.rate({ min: rate - 0.005, max: rate + 0.005 }),
      enabled: when.can("rate"),
      run: async () => {
        await player.setRate(rate);
        await showSpeed(rate);
      },
    });
  // #endregion radio
}
