/**
 * Signal Generator: a plugin that generates its own video and audio.
 *
 * "Open ▸ Signal Generator…" shows the control window and starts a 640×360,
 * 30 fps stream with a 48 kHz stereo test tone. Every control applies live.
 */
import type { Plugin, PluginError, Stream, StreamStartError } from "@vestra-player/sdk";
import {
  DEFAULTS,
  FILTERS,
  FPS,
  HEIGHT,
  MAX_DB,
  MIN_DB,
  PATTERNS,
  WAVEFORMS,
  WIDTH,
  bounded,
  frequencyAt,
  isControls,
  positionOf,
} from "./controls.ts";
import type { Controls } from "./controls.ts";
import { describeFilter, nodesFor } from "./filter.ts";
import { SignalGenerator } from "./generator.ts";

export default async function activate(plugin: Plugin) {
  // #region state
  // The last settings survive a restart of the player.
  const store = plugin.storage.json<Controls>("controls", {
    defaults: DEFAULTS,
    validate: isControls,
  });
  /** One object for the whole plugin: the window writes it, frame() reads it. */
  const controls: Controls = { ...store.value };
  /** The running stream, `undefined` when stopped. */
  let stream: Stream | undefined;
  /** Set while openStream is in progress; aborting it cancels the start. */
  let starting: AbortController | undefined;
  let status = "Stopped";
  let problem = "";
  // #endregion state

  // #region filter
  // The player-side chain. Nothing is sent before the first set(); the SDK
  // re-applies it to every new source and withdraws it when the plugin stops.
  const filter = plugin.audio.filter("tone");
  filter.set({ nodes: nodesFor(controls.filter) });
  // #endregion filter

  // #region bind
  const window = plugin.windows.create("ui/controls.slint", { id: "signal-generator" });
  // Re-evaluated after every callback and state change; only changed values are sent.
  window.bind(() => ({
    pattern: PATTERNS.indexOf(controls.pattern),
    waveform: WAVEFORMS.indexOf(controls.waveform),
    frequency: positionOf(controls.frequency),
    frequencyText: `${Math.round(controls.frequency)} Hz`,
    sweep: controls.sweep,
    level: controls.levelDb,
    levelText: `${Math.round(controls.levelDb)} dB`,
    mute: controls.mute,
    balance: controls.balance,
    balanceText: balanceText(controls.balance),
    filter: FILTERS.indexOf(controls.filter),
    filterStatus: describeFilter(controls.filter, filter.status, plugin.player.state),
    running: stream !== undefined,
    starting: starting !== undefined,
    status,
    problem,
  }));
  // #endregion bind

  // #region callbacks
  /** Change the controls in place: the next frame() call reads the new values. */
  const change = (patch: Partial<Controls>) => {
    Object.assign(controls, patch);
    store.save({ ...controls }); // written 300 ms after the last change
  };
  window.on("patternChosen", (index: number) =>
    change({ pattern: PATTERNS[index] ?? controls.pattern }),
  );
  window.on("waveformChosen", (index: number) =>
    change({ waveform: WAVEFORMS[index] ?? controls.waveform }),
  );
  window.on("frequencyMoved", (position: number) =>
    change({ frequency: frequencyAt(bounded(position, 0, 1, positionOf(controls.frequency))) }),
  );
  window.on("sweepToggled", (on: boolean) => change({ sweep: on === true }));
  window.on("levelMoved", (db: number) =>
    change({ levelDb: bounded(db, MIN_DB, MAX_DB, controls.levelDb) }),
  );
  window.on("muteToggled", (on: boolean) => change({ mute: on === true }));
  window.on("balanceMoved", (value: number) => {
    const balance = bounded(value, -1, 1, controls.balance);
    change({ balance: Math.abs(balance) < 0.03 ? 0 : balance }); // snap to the centre
  });
  window.on("filterChosen", (index: number) => {
    change({ filter: FILTERS[index] ?? controls.filter });
    filter.set({ nodes: nodesFor(controls.filter) }); // last write wins
  });
  window.on("start", start);
  window.on("stop", stop);
  // #endregion callbacks

  // #region start
  async function start() {
    if (stream || starting) return; // already running, or on its way
    const attempt = (starting = new AbortController());
    status = "Starting…";
    problem = "";
    plugin.update(); // show "Starting…" now, not when this handler finishes
    // A fresh generator per run: the timecode starts at 00:00:00:00.
    const generator = new SignalGenerator(controls);
    try {
      const opened = await plugin.player.openStream({
        width: WIDTH,
        height: HEIGHT,
        frame: () => generator.frame(),
        signal: attempt.signal,
      });
      if (attempt.signal.aborted) {
        await opened.stop(); // Stop was pressed just as the stream came up
        return;
      }
      stream = opened;
      status = `Running · ${WIDTH}×${HEIGHT} · ${FPS.num / FPS.den} fps · 48 kHz stereo`;
      opened.onStop((error) => {
        if (stream !== opened) return; // our own stop(): nothing to report
        stream = undefined;
        status = "Stopped";
        problem = error ? `The stream failed: ${error.message}` : "Another source replaced the stream.";
      });
    } catch (error) {
      if (attempt.signal.aborted) return; // cancelled by stop(): not a failure
      status = "Stopped";
      problem = startFailure(error);
    } finally {
      if (starting === attempt) starting = undefined;
    }
  }
  // #endregion start

  // #region stop
  async function stop() {
    starting?.abort(); // 1. a stream still starting must never become the source
    const current = stream;
    stream = undefined; // 2. forget it first, so its onStop does not report a failure
    status = "Stopped";
    problem = "";
    await current?.stop(); // 3. the SDK closes the source, then the connection, then the producer
  }
  // #endregion stop

  // #region command
  plugin.commands.add({
    id: "open",
    path: ["Open", "Signal Generator…"],
    run: async () => {
      await window.show();
      await start();
    },
  });
  // Errors thrown in callbacks (and failed property writes) end up here.
  plugin.onError((error) => {
    problem = error.message;
  });
  // #endregion command
}

const balanceText = (balance: number) =>
  balance === 0
    ? "Centre"
    : `${balance < 0 ? "L" : "R"} ${Math.round(Math.abs(balance) * 100)} %`;

// #region errors
/** Start-up failures, by `code` (never by message). */
export function startFailure(error: unknown): string {
  const { code, message } = error as PluginError;
  switch (code) {
    case "timeout":
      // StreamStartError: which start-up step ran out of its 10 seconds.
      return (error as StreamStartError).stage === "prefill"
        ? "Timed out preparing the first frames (prefill)."
        : "Timed out waiting for the player to switch to the stream (activation).";
    case "device":
      return "The audio output device is not ready.";
    case "stream":
      return `The player rejected the stream: ${message}`;
    default:
      return message;
  }
}
// #endregion errors
