/**
 * Style B, subscribe and write: the plugin listens to the player's events
 * by name (`plugin.player.on`) and writes values when it knows they
 * changed (`set`). No update pass runs for these views and commands.
 * Walkthrough: docs/explanation/three-ways.md.
 */
import type { Plugin, Stream } from "@vestra-player/sdk";
import {
  Emulator,
  entries,
  HEIGHT,
  LIST_SIZE,
  nextRate,
  speedText,
  WIDTH,
} from "./shared.ts";

/** Scenario 1: the bottom panel shows the speed; C cycles it. */
export function speed(plugin: Plugin) {
  // #region speed
  const bar = plugin.panels.mount("bottom", "ui/speed.slint");
  let shown = "1.00×"; // what the panel shows: its Slint default at first
  // Every source.state event, about ten a second while media plays; the
  // payload is typed (SourceState). Compare, or each one is a write.
  plugin.player.on("source.state", (s) => {
    const rate = speedText(s.rate);
    if (rate === shown) return;
    shown = rate;
    bar.set({ rate });
  });
  plugin.commands.add({
    id: "rate.cycle",
    path: ["Playback", "Cycle Speed"],
    bindings: ["C"],
    run: async () => {
      const s = await plugin.player.refresh(); // no copy kept: ask
      await plugin.player.setRate(nextRate(s.rate));
    },
  });
  // #endregion speed
}

/** Scenario 2: an emulator's status line, new on every frame (60 a second). */
export function frames(plugin: Plugin) {
  const emulator = new Emulator();
  // #region frames
  const screen = plugin.windows.create("ui/status.slint", { id: "status" });
  const command = plugin.commands.add({
    id: "emulator",
    path: ["@open", "Demo emulator"],
    checked: false, // a value, not a function: set explicitly below
    run: () => toggle(),
  });
  // #endregion frames
  let stream: Stream | undefined;
  let starting = false;
  const stopped = () => {
    stream = undefined;
    command.set({ checked: false });
    screen.set({ status: "Stopped" });
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
      await screen.show();
      // #region frames-stream
      stream = await plugin.player.openStream({
        width: WIDTH,
        height: HEIGHT,
        frame: () => {
          const next = emulator.step();
          // One write in flight; a newer line replaces the waiting one.
          screen.set({ status: emulator.status() });
          return next;
        },
      });
      command.set({ checked: true }); // only this command is sent again
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
  side.set({ rows }); // the initial value, whole
  side.on("play", (index: number) => {
    rows[index] = { ...rows[index]!, played: true };
    side.set({ rows }); // whole again: 20,000 rows, sent in parts
  });
  // #endregion list
}

/**
 * Scenario 4: Next Keyframe is enabled once an asynchronous check says
 * the current source has video. The answer is set on the command.
 */
export function keyframes(plugin: Plugin) {
  // #region keyframes
  const next = plugin.commands.add({
    id: "keyframe.next",
    path: ["Playback", "Next Keyframe"],
    enabled: false,
    run: () => plugin.player.step("keyframe", "forward"),
  });
  let current: number | null = null; // the ready source asked about
  plugin.player.on("source.state", (s) => {
    // `stamp.generation` is the wire's name for PlayerState's sourceId.
    const sourceId = s.phase === "ready" ? s.stamp.generation : null;
    if (sourceId === current) return;
    current = sourceId;
    next.set({ enabled: false }); // unknown until the answer
    if (sourceId === null) return;
    void plugin.player.stats().then(
      (stats) => {
        if (current === sourceId) next.set({ enabled: stats.video !== null });
      },
      () => {}, // unknown: no steps
    );
  });
  // #endregion keyframes
}

/** All four scenarios in style B. */
export default function activate(plugin: Plugin) {
  speed(plugin);
  frames(plugin);
  list(plugin);
  keyframes(plugin);
}
