/**
 * Signal generator in style B: the same plugin as main.ts, with the menu
 * item's check mark set explicitly when the stream starts and stops
 * instead of a `checked` function the update passes evaluate. To run it,
 * point the manifest's `entry` at this file.
 * Walkthrough: docs/examples/signal-generator.md, "In style B and C".
 */
import type { Plugin, Stream } from "@vestra-player/sdk";
import { frame, HEIGHT, WIDTH } from "./main.ts";

export default function activate(plugin: Plugin) {
  let stream: Stream | undefined;
  let starting = false;

  // #region command
  const command = plugin.commands.add({
    id: "signal-generator",
    path: ["@open", "Signal generator"],
    checked: false, // a value: no update pass evaluates this command
    run: () => {
      if (starting) return;
      return stream ? stop() : start();
    },
  });
  // #endregion command

  // #region start-stop
  async function start() {
    starting = true;
    try {
      stream = await plugin.player.openStream({
        width: WIDTH,
        height: HEIGHT,
        frame,
      });
      command.set({ checked: true }); // sends this command's state, nothing else
      stream.onStop(() => {
        stream = undefined;
        command.set({ checked: false });
      });
    } finally {
      starting = false;
    }
  }

  async function stop() {
    const running = stream;
    stream = undefined;
    command.set({ checked: false });
    await running?.stop();
  }
  // #endregion start-stop
}
