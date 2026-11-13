import type { Plugin } from "@vestra-player/sdk";

/** A speed slider in the adjust column. */
export default async function activate(plugin: Plugin) {
  plugin.player.subscribe(); // the player's events from now on
  await plugin.player.read(); // the player's state and timeline, read once
  // #region mount
  // "adjust": the panel changes what is playing. After the user closes it,
  // they do not keep looking at it (that would be the sidebar).
  const panel = plugin.panels.mount("adjust", "ui/speed.slint", {
    title: "Speed",
  });
  // Sent when the panel mounts, then whenever the playback state changes:
  panel.bind(() => ({
    rate: plugin.player.state.rate,
    enabled: plugin.player.state.can.rate,
  }));
  const setRate = (rate: number) =>
    plugin.player.setRate(Math.round(rate * 100) / 100);
  panel.on("rateChanged", setRate);
  // #endregion mount

  // #region commands
  // Opens the adjust column at this tab, and closes it when this tab is
  // already the one shown (`toggle`), like the player's own Alt+1…4.
  plugin.commands.add({
    id: "speed",
    title: "Speed Panel",
    category: "Playback",
    bindings: ["Alt+5"],
    run: () => panel.toggle(),
  });
  // `home` names the command that opens the panel this one lives in: the
  // player shows that command's key under the tab, and the command palette
  // shows where this command lives.
  plugin.commands.add({
    id: "speed-reset",
    title: "Normal Speed",
    category: "Playback",
    home: "speed",
    enabled: () => plugin.player.state.can.rate,
    run: () => setRate(1),
  });
  panel.on("reset", () => setRate(1));
  // #endregion commands
}
