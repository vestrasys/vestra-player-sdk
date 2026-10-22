import type { Plugin } from "@vestra-player/sdk";

/**
 * Remembers the current playback position and jumps back to it: a command,
 * a tool window, and reading and changing the playback state.
 */
export default async function activate(plugin: Plugin) {
  const { player } = plugin;
  let mark: number | null = null;

  // #region window
  const window = plugin.windows.create("ui/bookmark.slint");
  window.bind(() => ({
    label: mark === null ? "No bookmark" : `Bookmark: ${mark.toFixed(1)} s`,
    canMark: player.state.position !== null,
    canJump: mark !== null && player.state.can.seek,
  }));
  window.on("mark", () => (mark = player.state.position));
  window.on("jump", () => player.seek(mark!));
  // #endregion window

  // #region command
  plugin.commands.add({
    id: "bookmark.open",
    path: ["@playback", "Bookmark…"],
    order: 270,
    run: () => window.show(),
  });
  // #endregion command
}
