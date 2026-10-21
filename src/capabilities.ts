/**
 * Manifest capabilities the player knows (`vestra/1`). The same list as the
 * player's `host/src/plugins.rs`; the player's tests check that they agree.
 */
export const CAPABILITIES: readonly string[] = [
  "producer.av",
  "playback.read",
  "playback.control",
  "source.resolve",
  "events",
  "commands",
  "ui.window",
  "ui.mount",
  "ui.dialog",
  "plugins.manage",
  "processing.video",
  "processing.audio",
  "subtitles.read",
  "subtitles.control",
  "media.read",
  "media.control",
  "ui.osd",
  "clipboard",
  "window.control",
  "bindings.manage",
  "timeline.marks",
  "ui.drop",
  "ui.settings",
  "ui.theme",
  "secrets",
];

/** The plugin API version this SDK implements (`manifest.apiVersion`). */
export const API_VERSION = "vestra/1";
