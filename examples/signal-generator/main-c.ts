/**
 * Signal generator in style C: the same plugin as main.ts, with its menu
 * item registered from the player's own declaration through `plugin.wire`
 * and its check mark sent as explicit state. Experimental: the wire
 * protocol is not semver, so this code changes with player versions. To
 * run it, point the manifest's `entry` at this file.
 * Walkthrough: docs/examples/signal-generator.md, "In style B and C".
 */
import type { Plugin, Stream } from "@vestra-player/sdk";
import { frame, HEIGHT, WIDTH } from "./main.ts";

export default function activate(plugin: Plugin) {
  let stream: Stream | undefined;
  let starting = false;

  // #region command
  const command = plugin.wire.commands.register({
    id: "signal-generator",
    // The player's declaration, as `commands.register` takes it.
    declaration: {
      title: "Signal generator",
      path: ["@open", "Signal generator"],
      order: 0,
      group: "domain",
      radio: false,
      bindings: [],
      focus: null,
      repeat: false,
    },
    state: { checked: false },
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
      await command.update({ checked: true }); // one commands.update
      stream.onStop(() => {
        stream = undefined;
        void command.update({ checked: false }).catch(() => {});
      });
    } finally {
      starting = false;
    }
  }

  async function stop() {
    const running = stream;
    stream = undefined;
    await command.update({ checked: false });
    await running?.stop();
  }
  // #endregion start-stop
}
