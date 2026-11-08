/**
 * Style A, declarative: the plugin says what each view and command shows
 * as a function of state (`bind`, function fields), and the SDK's update
 * passes decide when to send. The default style.
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
  WIDTH,
} from "./shared.ts";

/** Scenario 1: the bottom panel shows the speed; C cycles it. */
export function speed(plugin: Plugin) {
  // #region speed
  const bar = plugin.panels.mount("bottom", "ui/speed.slint");
  // Reads state.rate: runs again when the speed changes, and only then.
  bar.bind(() => ({ rate: speedText(plugin.player.state.rate) }));
  plugin.commands.add({
    id: "rate.cycle",
    path: ["Playback", "Cycle Speed"],
    bindings: ["C"],
    enabled: () => plugin.player.state.can.rate, // evaluated in the passes
    run: () => plugin.player.setRate(nextRate(plugin.player.state.rate)),
  });
  // #endregion speed
}

/** Scenario 2: an emulator's status line, new on every frame (60 a second). */
export function frames(plugin: Plugin) {
  const emulator = new Emulator();
  // #region frames
  const st = plugin.state({ status: "Stopped", running: false });
  const screen = plugin.windows.create("ui/status.slint", { id: "status" });
  screen.bind(() => ({ status: st.status })); // runs again after every frame
  // #endregion frames
  let stream: Stream | undefined;
  let starting = false;
  const stopped = () => {
    stream = undefined;
    st.running = false;
    st.status = "Stopped";
  };
  plugin.commands.add({
    id: "emulator",
    path: ["@open", "Demo emulator"],
    checked: () => st.running,
    run: async () => {
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
            st.status = emulator.status(); // one pass per frame, coalesced
            return next;
          },
        });
        st.running = true; // the command's check mark follows
        // #endregion frames-stream
        stream.onStop(stopped); // another source replaced it, or it failed
      } finally {
        starting = false;
      }
    },
  });
}

/** Scenario 3: a sidebar list of 20,000 entries; a double click marks one played. */
export function list(plugin: Plugin) {
  // #region list
  const rows = entries(LIST_SIZE);
  const side = plugin.panels.mount("sidebar", "ui/list.slint", {
    title: "Entries",
  });
  // Rows with an `id` are keyed: a changed row becomes one row patch.
  side.bind(() => ({ rows }));
  side.on("play", (index: number) => {
    rows[index] = { ...rows[index]!, played: true };
    // The pass after the handler compares and sends one `set` operation.
  });
  // #endregion list
}

/**
 * Scenario 4: Next Keyframe is enabled once an asynchronous check says
 * the current source has video. The answer lives in `plugin.state`.
 */
export function keyframes(plugin: Plugin) {
  // #region keyframes
  const st = plugin.state({
    video: null as { sourceId: number; video: boolean } | null,
  });
  let asking: number | null = null;
  plugin.player.onChange(({ phase, sourceId }) => {
    if (phase !== "ready" || sourceId === null) return;
    if (st.video?.sourceId === sourceId || asking === sourceId) return;
    asking = sourceId;
    void plugin.player.stats().then(
      (stats) => (st.video = { sourceId, video: stats.video !== null }),
      () => (st.video = { sourceId, video: false }), // unknown: no steps
    );
  });
  plugin.commands.add({
    id: "keyframe.next",
    path: ["Playback", "Next Keyframe"],
    // Reads st.video: the write above re-runs this, and nothing else.
    enabled: () =>
      st.video?.sourceId === plugin.player.state.sourceId && st.video.video,
    run: () => plugin.player.step("keyframe", "forward"),
  });
  // #endregion keyframes
}

/**
 * Scenario 4 without `plugin.state`: the answer in a plain variable and a
 * manual `plugin.update()`.
 */
export function keyframesManual(plugin: Plugin) {
  // #region keyframes-manual
  let video: { sourceId: number; video: boolean } | null = null;
  let asking: number | null = null;
  plugin.player.onChange(({ phase, sourceId }) => {
    if (phase !== "ready" || sourceId === null) return;
    if (video?.sourceId === sourceId || asking === sourceId) return;
    asking = sourceId;
    void plugin.player.stats().then((stats) => {
      video = { sourceId, video: stats.video !== null };
      plugin.update(); // a full pass: every binding and command of the plugin
    });
  });
  plugin.commands.add({
    id: "keyframe.next",
    path: ["Playback", "Next Keyframe"],
    enabled: () =>
      video?.sourceId === plugin.player.state.sourceId && video.video,
    run: () => plugin.player.step("keyframe", "forward"),
  });
  // #endregion keyframes-manual
}

/** All four scenarios in style A. */
export default function activate(plugin: Plugin) {
  speed(plugin);
  frames(plugin);
  list(plugin);
  keyframes(plugin);
}
