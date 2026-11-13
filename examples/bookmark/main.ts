import type { Plugin } from "@vestra-player/sdk";

/**
 * Remembers the current playback position and jumps back to it: a command,
 * a tool window, and reading and changing the playback state.
 */
// #region state
export default async function activate(plugin: Plugin) {
  plugin.player.subscribe(); // the player's events from now on
  await plugin.player.read(); // the player's state and timeline, read once
  const { player } = plugin;
  let mark: number | null = null;
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
  bookmarkWindow.on("mark", () => (mark = player.state.position));
  bookmarkWindow.on("jump", () => player.seek(mark!));
  // #endregion window

  // #region command
  plugin.commands.add({
    id: "bookmark.open",
    path: ["@playback", "Bookmark…"],
    order: 270,
    run: () => bookmarkWindow.show(), // opens it, or brings back the open one
  });
  // #endregion command
}
