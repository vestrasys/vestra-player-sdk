import type { Plugin, StateStream } from "@vestra-player/sdk";

/**
 * Remembers the current playback position and jumps back to it: a command,
 * a tool window, and reading and changing the playback state.
 */
// #region state
export default async function activate(plugin: Plugin) {
  const { player, storage } = plugin;
  await player.read(); // the player's state, read once
  // Session storage outlives standby: the player may stop this plugin while
  // the window is closed, and `activate` runs again at its next use.
  let mark = (await storage.session.get<number>("mark")) ?? null;
  // #endregion state

  // #region window
  const bookmarkWindow = plugin.windows.create("ui/bookmark.slint");
  // Re-evaluated after every handler and player change; only changes are sent.
  bookmarkWindow.bind(() => ({
    label: mark === null ? "No bookmark" : `Bookmark: ${mark.toFixed(1)} s`,
    canMark: player.state.position !== null,
    canJump: mark !== null && player.state.can.seek,
  }));
  // The Slint callbacks `mark` and `jump` of ui/bookmark.slint.
  bookmarkWindow.on("mark", () => {
    mark = player.state.position;
    return storage.session.set("mark", mark);
  });
  bookmarkWindow.on("jump", () => player.seek(mark!));
  // #endregion window

  // #region stream
  // The position has no event: while the window is open a stream keeps
  // `player.state` following the player and runs the binding above after
  // each change. Closed, nothing follows it and the plugin can go to standby.
  let feed: StateStream | undefined;
  bookmarkWindow.onClose(() => {
    feed?.stop();
    feed = undefined;
  });
  // #endregion stream

  // #region command
  plugin.commands.add({
    id: "bookmark.open",
    path: ["@playback", "Bookmark…"],
    order: 270,
    run: async () => {
      await bookmarkWindow.show(); // opens it, or brings back the open one
      feed ??= player.stream(() => {});
    },
  });
  // #endregion command
}
