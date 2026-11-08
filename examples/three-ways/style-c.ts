/**
 * Style C, direct messages: raw events and requests by name through
 * `plugin.wire`, property writes below the SDK's comparison, commands from
 * the player's own declaration. Experimental: the wire protocol is not
 * semver, so this code changes with player versions.
 * Walkthrough: docs/explanation/three-ways.md.
 */
import type { Plugin, Stream } from "@vestra-player/sdk";
import {
  declaration,
  Emulator,
  entries,
  HEIGHT,
  LIST_SIZE,
  nextRate,
  speedText,
  WIDTH,
} from "./shared.ts";

/**
 * A write or update the player refused (the view does not show, the
 * command is gone): nothing to do, the next one tries again.
 */
const dropped = () => {};

/** Scenario 1: the bottom panel shows the speed; C cycles it. */
export function speed(plugin: Plugin) {
  // #region speed
  const bar = plugin.panels.mount("bottom", "ui/speed.slint");
  const view = plugin.wire.view(bar); // raw writes for this panel
  let shown = "1.00×"; // what the panel shows: its Slint default at first
  plugin.wire.on("source.state", (data) => {
    const s = data as { rate: number }; // the plugin types the payload
    const rate = speedText(s.rate);
    if (rate === shown) return; // about ten events a second while playing
    shown = rate;
    view.write("rate", { value: rate }).catch(() => (shown = "")); // again next time
  });
  plugin.wire.commands.register({
    id: "rate.cycle",
    declaration: declaration(["Playback", "Cycle Speed"], ["C"]),
    run: async () => {
      const s = await plugin.wire.request<{ rate: number }>("source.state");
      await plugin.player.setRate(nextRate(s.rate)); // or source.submit
    },
  });
  // #endregion speed
}

/** Scenario 2: an emulator's status line, new on every frame (60 a second). */
export function frames(plugin: Plugin) {
  const emulator = new Emulator();
  // #region frames
  const screen = plugin.windows.create("ui/status.slint", { id: "status" });
  const direct = plugin.wire.view(screen);
  const command = plugin.wire.commands.register({
    id: "emulator",
    declaration: declaration(["@open", "Demo emulator"]),
    state: { checked: false },
    run: () => toggle(),
  });
  // #endregion frames
  let stream: Stream | undefined;
  let starting = false;
  const stopped = () => {
    stream = undefined;
    command.update({ checked: false }).catch(dropped);
    direct.write("status", { value: "Stopped" }).catch(dropped);
  };
  async function toggle() {
    if (starting) return;
    if (stream) {
      const running = stream;
      stopped();
      return running.stop();
    }
    starting = true;
    try {
      await screen.show(); // direct writes need a showing window
      // #region frames-stream
      stream = await plugin.player.openStream({
        width: WIDTH,
        height: HEIGHT,
        frame: () => {
          const next = emulator.step();
          // A PropertyWrite: one in flight, the newest waits; no limits checked.
          direct.write("status", { value: emulator.status() }).catch(dropped);
          return next;
        },
      });
      await command.update({ checked: true }); // one commands.update
      // #endregion frames-stream
      stream.onStop(stopped); // another source replaced it, or it failed
    } finally {
      starting = false;
    }
  }
}

/** Scenario 3: a sidebar list of 20,000 entries; a double click marks one played. */
export function list(plugin: Plugin) {
  // #region list
  const rows = entries(LIST_SIZE);
  const side = plugin.panels.mount("sidebar", "ui/list.slint", {
    title: "Entries",
  });
  const direct = plugin.wire.view(side);
  side.ready.then(() => direct.write("rows", { value: rows })).catch(dropped); // whole, once
  side.on("play", (index: number) => {
    const row = { ...rows[index]!, played: true };
    rows[index] = row;
    // The plugin's own row operation: only this row crosses to the player.
    direct.writeRows("rows", [{ op: "set", at: index, row }]).catch(dropped);
  });
  // #endregion list
}

/**
 * Scenario 4: Next Keyframe is enabled once an asynchronous check says
 * the current source has video. The answer is sent as the command's state.
 */
export function keyframes(plugin: Plugin) {
  // #region keyframes
  const next = plugin.wire.commands.register({
    id: "keyframe.next",
    declaration: declaration(["Playback", "Next Keyframe"]),
    state: { enabled: false },
    run: () =>
      plugin.wire.request("player.step", {
        unit: "keyframe",
        direction: "forward",
      }),
  });
  let current: number | null = null; // the ready source asked about
  plugin.wire.on("source.state", (data) => {
    const s = data as { phase: string; stamp: { generation: number } };
    const sourceId = s.phase === "ready" ? s.stamp.generation : null;
    if (sourceId === current) return;
    current = sourceId;
    next.update({ enabled: false }).catch(dropped); // unknown until the answer
    if (sourceId === null) return;
    void plugin.wire.request<{ video: unknown }>("playback.stats").then(
      (stats) => {
        if (current === sourceId)
          next.update({ enabled: stats.video !== null }).catch(dropped);
      },
      () => {}, // unknown: no steps
    );
  });
  // #endregion keyframes
}

/** All four scenarios in style C. */
export default function activate(plugin: Plugin) {
  speed(plugin);
  frames(plugin);
  list(plugin);
  keyframes(plugin);
}
