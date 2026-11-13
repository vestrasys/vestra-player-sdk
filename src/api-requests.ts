/**
 * Which player requests each member of the plugin API sends, written
 * `Interface.member`; members declared on `Scope` are written `Plugin.…`.
 * The generated reference pages read it: the Stability column of the
 * message table (docs/reference/messages.md) and the members of each event
 * (docs/reference/events.md). For a listener the row is the
 * `events.subscribe` with its event name.
 *
 * A row lists the request the member sends to do its work. Members whose
 * requests come from a handle another member returned (a `Window` from
 * `Windows.create`) are listed in the message table's `WRAPPED_BY`
 * (scripts/doc-tables/messages.mjs) instead.
 *
 * @internal
 */

/** @internal One request a member sends. */
export interface ApiRequest {
  /** The wire method (`source.submit`). */
  readonly method: string;
  /** String parameters that name what is meant (`event`, `stage`). */
  readonly params?: Readonly<Record<string, string>>;
}

const submit = [{ method: "source.submit" }, { method: "source.operation" }];
const readsSubtitles: ApiRequest = { method: "subtitles.state" };
const listen = (event: string): ApiRequest => ({
  method: "events.subscribe",
  params: { event },
});

/** @internal */
export const API_REQUESTS: Readonly<Record<string, readonly ApiRequest[]>> =
  Object.freeze({
    "Player.state": [{ method: "source.state" }],
    "Player.refresh": [{ method: "source.state" }],
    "Player.stats": [{ method: "playback.stats" }],
    "Player.chapters": [{ method: "player.chapters" }],
    "Player.audioDevices": [{ method: "player.audioDevices" }],
    "Player.onChange": [listen("source.state")],
    "Player.open": submit,
    "Player.openStream": [
      { method: "producer.prepare" },
      { method: "source.submit" },
    ],
    "Player.setPaused": submit,
    "Player.seek": submit,
    "Player.setRate": submit,
    "Player.restart": submit,
    "Player.close": submit,
    "Player.scrub": submit,
    "Player.setOutput": [{ method: "playback.set" }],
    "Player.provideSequence": [{ method: "sequence.set" }],
    "Player.next": [{ method: "sequence.step" }],
    "Player.previous": [{ method: "sequence.step" }],
    "Player.addAudioTrack": [{ method: "audio.addTrack" }],
    "Player.selectAudioTrack": [{ method: "audio.selectTrack" }],
    "Player.step": [{ method: "player.step" }],
    "Player.setStepSeek": [{ method: "player.setStepSeek" }],
    "Player.setLoop": [{ method: "player.setLoop" }],
    "Player.setAudioDevice": [{ method: "player.setAudioDevice" }],
    "Power.preventSleep": [{ method: "power.preventSleep" }],
    "Subtitles.state": [{ method: "subtitles.state" }],
    "Subtitles.onChange": [
      listen("source.state"),
      { method: "subtitles.state" },
    ],
    "Subtitles.refresh": [{ method: "subtitles.state" }],
    // Changes read the current selection first (`refresh`), unless
    // `ifCurrent` pins one; `load` always does.
    "Subtitles.select": [{ method: "subtitles.select" }, readsSubtitles],
    "Subtitles.load": [{ method: "subtitles.upload.begin" }, readsSubtitles],
    "Subtitles.remove": [{ method: "subtitles.remove" }, readsSubtitles],
    "Subtitles.setStyle": [{ method: "subtitles.style" }, readsSubtitles],
    "Timeline.marks": [{ method: "timeline.marks" }],
    "Timeline.ranges": [{ method: "timeline.marks" }],
    "Timeline.layer": [
      { method: "timeline.set" },
      { method: "timeline.setRanges" },
    ],
    "MainWindow.onChange": [listen("window.state")],
    "MainWindow.setVideoArea": [{ method: "window.setVideoArea" }],
    "MainWindow.setAlwaysOnTop": [{ method: "window.setAlwaysOnTop" }],
    "MainWindow.setCursorAutoHide": [{ method: "window.setCursorAutoHide" }],
    "MainWindow.setPictureInPicture": [
      { method: "window.setPictureInPicture" },
    ],
    "Appearance.set": [{ method: "appearance.set" }],
    "Appearance.setLanguage": [{ method: "appearance.setLanguage" }],
    "Drops.provide": [{ method: "drops.provide" }],
    "Panels.mount": [{ method: "ui.mount" }],
    "Panels.bottom": [{ method: "layout.state" }],
    "Panels.sidebar": [{ method: "layout.state" }],
    "Panels.backdrop": [{ method: "layout.state" }],
    "PanelSlot.onChange": [{ method: "layout.state" }, listen("window.state")],
    "Panel.onChange": [{ method: "layout.state" }, listen("window.state")],
    "Panel.onDrop": [{ method: "drops.listen" }],
    "BackdropSlot.onChange": [
      { method: "layout.state" },
      listen("window.state"),
    ],
    "Resolvers.add": [{ method: "sourceResolvers.register" }],
    "Commands.add": [{ method: "commands.register" }],
    "Commands.keys": [{ method: "commands.keys" }, listen("commands.keys")],
    "Commands.list": [{ method: "commands.list" }],
    "Commands.run": [{ method: "commands.run" }],
    "Palette.lead": [{ method: "palette.lead.set" }],
    "Host.run": [{ method: "host.run" }],
    "Windows.create": [{ method: "ui.open" }],
    "Dialogs.confirm": [{ method: "dialogs.confirm" }],
    "Dialogs.openFile": [{ method: "dialogs.open" }],
    "Dialogs.openFiles": [{ method: "dialogs.open" }],
    "Dialogs.openDirectory": [{ method: "dialogs.open" }],
    "Dialogs.saveFile": [{ method: "dialogs.open" }],
    "Packages.list": [{ method: "packages.list" }],
    "Packages.onChange": [listen("packages.changed")],
    "Packages.validate": [{ method: "packages.validate" }],
    "Packages.validateArchive": [{ method: "packages.validateArchive" }],
    "Packages.setEnabled": [{ method: "packages.setEnabled" }],
    "Packages.reload": [{ method: "packages.reload" }],
    "Packages.uninstall": [{ method: "packages.uninstall" }],
    "Plugin.video.filter": [
      { method: "processing.replace", params: { stage: "video" } },
      listen("source.state"),
    ],
    "Plugin.video.view": [{ method: "video.view.set" }],
    "Plugin.video.render": [{ method: "video.render.set" }],
    "Plugin.video.shaders": [{ method: "video.shaders.set" }],
    "Plugin.audio.filter": [
      { method: "processing.replace", params: { stage: "audio" } },
    ],
    "MediaCapture.capture": [
      { method: "snapshot.state" },
      { method: "snapshot.capture" },
    ],
    "Snapshot.export": [{ method: "jobs.state" }, { method: "jobs.start" }],
    "MediaCapture.export": [{ method: "jobs.state" }, { method: "jobs.start" }],
    "MediaCapture.exportCheck": [{ method: "jobs.check" }],
    "MediaSources.remember": [{ method: "media.sources.remember" }],
    "MediaSources.get": [{ method: "media.sources.get" }],
    "MediaSources.locate": [{ method: "media.sources.locate" }],
    "MediaSources.forget": [{ method: "media.sources.forget" }],
    "MediaSources.list": [{ method: "media.sources.list" }],
    // An open like Player.open, followed with source.operation.
    "MediaSources.open": [
      { method: "media.sources.open" },
      { method: "source.operation" },
    ],
    "Osd.show": [{ method: "osd.show" }],
    "Osd.panel": [{ method: "osd.panel" }],
    "Clipboard.readText": [{ method: "clipboard.readText" }],
    "Clipboard.writeText": [{ method: "clipboard.writeText" }],
    "Clipboard.writeImage": [{ method: "clipboard.writeImage" }],
    "Bindings.list": [{ method: "bindings.list" }],
    "Bindings.set": [{ method: "bindings.set" }],
    "Bindings.reset": [{ method: "bindings.reset" }],
    "Bindings.onChange": [listen("bindings.changed")],
    "Settings.page": [{ method: "settings.register" }],
    "Settings.show": [{ method: "settings.show" }],
    "Secrets.get": [{ method: "secrets.get" }],
    "Secrets.set": [{ method: "secrets.set" }],
    "Secrets.delete": [{ method: "secrets.delete" }],
    "Rendering.state": [{ method: "rendering.state" }],
    "Rendering.setPreference": [{ method: "rendering.setPreference" }],
    "Rendering.restartPlayer": [{ method: "rendering.restart" }],
    "VideoUpscaling.state": [{ method: "video.upscaling.state" }],
    "VideoUpscaling.set": [{ method: "video.upscaling.set" }],
    "VideoUpscaling.onChange": [listen("video.upscaling.changed")],
    "VideoMotion.state": [{ method: "video.motion.state" }],
    "VideoMotion.set": [{ method: "video.motion.set" }],
    "VideoMotion.onChange": [listen("video.motion.changed")],
    "WireCommands.register": [{ method: "commands.register" }],
    "Mpv.command": [{ method: "mpv.command" }],
    "Mpv.get": [{ method: "mpv.get" }],
    "Mpv.set": [{ method: "mpv.set" }],
    "Mpv.observe": [{ method: "mpv.observe" }],
  });

/**
 * The events whose listener subscribes (`events.subscribe` with the event
 * name): the plugin API's `HostEvent`. Other names a plugin listens to
 * (`commands.execute`, `ui.callback`) arrive unasked and need nothing.
 * test/wire-facade.test.ts keeps it equal to `HostEvent`.
 *
 * @internal
 */
export const SUBSCRIBED_EVENTS: readonly string[] = Object.freeze([
  "source.state",
  "playback.backend",
  "window.state",
  "packages.changed",
  "bindings.changed",
  "commands.keys",
  "timeline.changed",
  "appearance.changed",
  "resolvers.fileTypes",
  "video.upscaling.changed",
  "video.motion.changed",
]);
