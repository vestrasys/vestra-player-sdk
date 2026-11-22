/**
 * Style B, listen and write: the plugin listens to the player's events
 * by name (`plugin.player.on`) and writes values when it knows they
 * changed (`set`). No update pass runs for these views and commands.
 * Walkthrough: docs/tutorial/index.md.
 */
import type { Plugin, Stream } from "@vestra-player/sdk";
import {
  Emulator,
  entries,
  HEIGHT,
  LIST_SIZE,
  nextRate,
  speedText,
  whileShown,
  WIDTH,
} from "./shared.ts";

/** Scenario 1: the bottom panel shows the speed; C cycles it. */
export function speed(plugin: Plugin) {
  // #region speed
  const bar = plugin.panels.mount("bottom", "ui/speed.slint");
  let shown = "1.00×"; // what the panel shows: its Slint default at first
  const show = (value: number) => {
    const rate = speedText(value);
    if (rate === shown) return; // compare, or each event is a write
    shown = rate;
    bar.set({ rate });
  };
  // The speed has no event of its own: while the bar is on screen, read it
  // once, then hear every source.state event (about ten a second while
  // media plays; the payload is typed, SourceState).
  whileShown(bar, () => {
    void plugin.player.refresh().then(
      (s) => show(s.rate),
      () => {},
    );
    const listener = plugin.player.on("source.state", (s) => show(s.rate));
    return () => void listener.dispose();
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
  // Once per source; listening to them keeps no plugin running.
  const gone = () => {
    current = null;
    next.set({ enabled: false }); // unknown until the next answer
  };
  plugin.player.on("source.opening", gone);
  plugin.player.on("source.ended", gone);
  plugin.player.on("source.ready", ({ state: { sourceId } }) => {
    current = sourceId;
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
export default async function activate(plugin: Plugin) {
  await plugin.player.read(); // the player's state, read once
  speed(plugin);
  frames(plugin);
  list(plugin);
  keyframes(plugin);
}
