/**
 * The second batch of events in the test host (SDK 1.11.0; the player's
 * `src/host/src/fact_events.rs`): after the host's state changed, the
 * facts that changed are sent once each, by the player's rules.
 *
 * - `audio.tracks.changed`: after a `source.state`, the source's audio
 *   track list when it is known and differs from the state before.
 * - `window.changed`, `layout.changed`: after a `window.state`, when the
 *   window's state or the panel layout differ from what was last sent (the
 *   test host has no resize gesture: each change is one event).
 * - `subtitles.changed`: when a loaded source's subtitle tracks or its
 *   primary or secondary selection differ from what was last sent.
 * - `audio.devices.changed`: when the device list, the requested device or
 *   the device in use differ from what was last sent.
 * - `video.reconfigured`, `audio.reconfigured`: when a source becomes
 *   ready, from `host.stats` (its `video` and `audio`), once per source.
 *
 * The first look at each is the start, not a change. `app.started` is not
 * sent by itself: a test sends it with `host.emit("app.started", …)`.
 *
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import type { SourceState } from "../../source.ts";
import type { TestHost } from "./index.ts";

/** What was last sent of each fact, as JSON (`undefined`: not looked at yet). */
export interface FactsSent {
  window?: string;
  layout?: string;
  subtitles?: string;
  devices?: string;
  /** The source the reconfigurations were sent for. */
  reconfigured?: number;
  /** Set while the facts are being sent (their own emits look at nothing). */
  busy?: boolean;
}

const sent = new WeakMap<TestHost, FactsSent>();
const of = (host: TestHost) => {
  let facts = sent.get(host);
  if (!facts) sent.set(host, (facts = {}));
  return facts;
};

/** `data` when its JSON differs from `facts[key]` (set to it); the first look sends nothing. */
function changed(
  facts: FactsSent,
  key: "window" | "layout" | "devices",
  data: unknown,
) {
  const text = JSON.stringify(data);
  const first = facts[key] === undefined;
  if (facts[key] === text) return false;
  facts[key] = text;
  return !first;
}

/** `audio.tracks.changed` for the `source.state` `next` after `previous` (the player's rule). */
export function tracksChanged(previous: SourceState, next: SourceState) {
  if (!Array.isArray(next.audioTracks) || next.source === null) return null;
  if (
    previous.stamp.generation === next.stamp.generation &&
    JSON.stringify(previous.audioTracks) === JSON.stringify(next.audioTracks)
  )
    return null;
  return { sourceId: next.stamp.generation, audioTracks: next.audioTracks };
}

/**
 * After the host's state may have changed (a request answered, an event
 * sent): send the facts that changed. `event` is the event just sent, if
 * any.
 */
export function sendFacts(host: TestHost, event?: string) {
  const facts = of(host);
  if (facts.busy) return;
  facts.busy = true;
  try {
    if (event === undefined || event === "window.state") {
      const w = host.mainWindow;
      const window = {
        fullscreen: w.fullscreen,
        maximized: w.maximized && !w.fullscreen,
        videoArea: { ...w.videoArea },
        pictureInPicture: { ...w.pictureInPicture },
      };
      if (changed(facts, "window", window)) host.emit("window.changed", window);
      const layout = {
        ...host.layout,
        backdrop: host.backdrop && {
          owner: 1,
          effective: host.backdrop.effective,
        },
      };
      if (changed(facts, "layout", layout))
        host.emit("layout.changed", structuredClone(layout));
    }
    const subtitles = host.subtitles;
    if (["ready", "ended"].includes(host.source.phase)) {
      const part = {
        source: host.source.stamp.generation,
        tracks: subtitles.tracks,
        target: subtitles.selection.target,
        secondary: subtitles.selection.secondary ?? null,
      };
      // Sent for the first loaded source too, as the player does.
      const text = JSON.stringify(part);
      if (facts.subtitles !== text && (facts.subtitles = text))
        host.emit("subtitles.changed", { state: structuredClone(subtitles) });
    }
    const output = host.source.audioOutput ?? { requested: null, active: null };
    const devices = {
      devices: host.audioDevices.map(({ id, name }) => ({ id, name })),
      requested: output.requested,
      active: output.active,
    };
    if (changed(facts, "devices", devices))
      host.emit("audio.devices.changed", devices);
    const source = host.source;
    if (
      source.phase === "ready" &&
      facts.reconfigured !== source.stamp.generation
    ) {
      facts.reconfigured = source.stamp.generation;
      const { video, audio } = host.stats;
      if (video?.width && video.height)
        host.emit("video.reconfigured", {
          sourceId: source.stamp.generation,
          width: video.width,
          height: video.height,
          displayWidth: video.displayWidth ?? video.width,
          displayHeight: video.displayHeight ?? video.height,
          fps: video.fps,
          rotation: 0,
          hdr: video.transfer === "pq" || video.transfer === "hlg",
        });
      if (audio?.sampleRate)
        host.emit("audio.reconfigured", {
          sourceId: source.stamp.generation,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          format: audio.format ?? null,
        });
    }
  } finally {
    facts.busy = false;
  }
}
