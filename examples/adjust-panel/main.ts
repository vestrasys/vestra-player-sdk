import type { Plugin, StateStream } from "@vestra-player/sdk";

/** A speed slider in the adjust column. */
export default async function activate(plugin: Plugin) {
  const { player, when } = plugin;
  await player.read(); // the player's state, read once
  // #region mount
  // "adjust": the panel changes what is playing. After the user closes it,
  // they do not keep looking at it (that would be the sidebar).
  const panel = plugin.panels.mount("adjust", "ui/speed.slint", {
    title: "Speed",
  });
  // #endregion mount

  // #region follow
  // The speed has no event: while the tab is on screen a stream keeps
  // `player.state` following the player (and runs the binding below after
  // each change). While the column is closed nothing follows it, and the
  // plugin can go to standby.
  let feed: StateStream | undefined;
  const follow = () => {
    if (panel.state?.effective) feed ??= player.stream(() => {});
    else {
      feed?.stop();
      feed = undefined;
    }
  };
  // Sent once per change of the layout (the column opened or closed, another
  // tab chosen); listening to it keeps no plugin running.
  player.on("layout.changed", follow);
  // And once at the mount, for a column already open when the plugin starts.
  // `panel.state` is read on first use; touched before the mount, it is
  // current when `ready` resolves.
  void panel.state;
  void panel.ready.then(follow, () => {});
  // #endregion follow

  // #region bind
  // Sent when the panel mounts, then whenever the playback state changes.
  panel.bind(() => ({
    rate: player.state.rate,
    enabled: player.state.can.rate,
  }));
  const setRate = (rate: number) =>
    player.setRate(Math.round(rate * 100) / 100);
  panel.on("rateChanged", setRate);
  // #endregion bind

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
    enabled: when.can("rate"), // evaluated by the player, also in standby
    run: () => setRate(1),
  });
  panel.on("reset", () => setRate(1));
  // #endregion commands
}
