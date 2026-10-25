/**
 * What one manifest capability is for: the members it opens, the
 * capabilities they also need, and how the plugin store describes it. An
 * entry of {@link CAPABILITY_INFO}.
 *
 * @since 1.5.14
 */
export interface CapabilityInfo {
  /**
   * The members this capability opens, as `Interface.member` (for example
   * `Commands.add` is `plugin.commands.add`). A call to one of them without
   * the capability fails with code `capability`; `Plugin.video.filter` is
   * `plugin.video.filter`. A member can be listed
   * under more than one capability when it needs all of them
   * (`Panel.onChange` needs `ui.mount` and `events`).
   */
  readonly apis: readonly string[];
  /**
   * Capabilities every member in {@link CapabilityInfo.apis} also needs:
   * declare them as well. What only one member or one option needs
   * (`Plugin.video.filter` also needs `events`) is documented at that member.
   */
  readonly requires: readonly string[];
  /**
   * How the plugin store and the player's install confirmation describe the
   * capability to the user, in English (the player translates it). Two
   * capabilities can share one description (`media.read` and
   * `media.control`); the store then shows it once.
   */
  readonly label: string;
  /**
   * `true` when the store highlights the capability as one to think about
   * before installing (it reaches outside the plugin's own features: the
   * clipboard, every shortcut, the keychain, other plugins).
   */
  readonly risky: boolean;
}

/**
 * Every manifest capability the player knows (`vestra/1`), in the player's
 * order, with the members it opens, the capabilities they also need and the
 * store's wording. The player's tests check that the names agree with the
 * player's `host/src/plugins.rs` and the labels with its plugin store.
 *
 * A member not listed under any capability needs none (`plugin.tools`,
 * `plugin.storage`, `plugin.system`, `plugin.app`, `plugin.ui`,
 * `plugin.i18n`, reading `plugin.window.state`, `plugin.appearance.theme`
 * and `plugin.packages.list`).
 *
 * @example
 * ```ts
 * import { CAPABILITY_INFO } from "@vestra-player/sdk/testing";
 *
 * const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
 * for (const capability of manifest.capabilities)
 *   for (const needed of CAPABILITY_INFO[capability].requires)
 *     assert.ok(manifest.capabilities.includes(needed), needed);
 * ```
 *
 * @since 1.5.14
 */
export const CAPABILITY_INFO: Readonly<Record<string, CapabilityInfo>> =
  Object.freeze({
    "producer.av": {
      apis: ["Player.openStream"],
      requires: ["playback.control"],
      label: "Provide audio and video it generates itself",
      risky: false,
    },
    "playback.read": {
      apis: [
        "Player.state",
        "Player.refresh",
        "Player.stats",
        "Player.chapters",
        "Player.audioDevices",
        "Timeline.marks",
      ],
      requires: [],
      label: "Read what is playing and the position",
      risky: false,
    },
    "playback.control": {
      apis: [
        "Player.open",
        "Player.setPaused",
        "Player.seek",
        "Player.setRate",
        "Player.restart",
        "Player.close",
        "Player.scrub",
        "Player.setOutput",
        "Player.provideSequence",
        "Player.next",
        "Player.previous",
        "Player.addAudioTrack",
        "Player.selectAudioTrack",
        "Player.step",
        "Player.setStepSeek",
        "Player.setLoop",
        "Player.setAudioDevice",
        "Power.preventSleep",
      ],
      requires: [],
      label: "Open media, control playback, keep the computer awake",
      risky: false,
    },
    "source.resolve": {
      apis: ["Resolvers.add"],
      requires: [],
      label: "Resolve online video addresses",
      risky: false,
    },
    events: {
      apis: [
        "Player.onChange",
        "Subtitles.onChange",
        "Timeline.onChange",
        "MainWindow.onChange",
        "Appearance.onChange",
        "PanelSlot.onChange",
        "Panel.onChange",
        "BackdropSlot.onChange",
        "Resolvers.onFileTypesChange",
      ],
      requires: [],
      label: "Receive playback changes as they happen",
      risky: false,
    },
    commands: {
      apis: ["Commands.add", "Host.run"],
      requires: [],
      label: "Add menu commands and shortcuts",
      risky: false,
    },
    "ui.window": {
      apis: ["Windows.create"],
      requires: [],
      label: "Open tool windows",
      risky: false,
    },
    "ui.mount": {
      apis: [
        "Panels.mount",
        "Panels.bottom",
        "Panels.sidebar",
        "Panels.backdrop",
        "PanelSlot.onChange",
        "Panel.onChange",
        "BackdropSlot.onChange",
      ],
      requires: [],
      label: "Show panels in the bottom bar, the sidebar or behind the video",
      risky: false,
    },
    "ui.dialog": {
      apis: [
        "Dialogs.confirm",
        "Dialogs.openFile",
        "Dialogs.openFiles",
        "Dialogs.openDirectory",
        "Dialogs.saveFile",
      ],
      requires: [],
      label: "Show file pickers and confirmations",
      risky: false,
    },
    "plugins.manage": {
      apis: [
        "Packages.validate",
        "Packages.validateArchive",
        "Packages.rollback",
        "Packages.setEnabled",
        "Packages.uninstall",
      ],
      requires: [],
      label: "Install, uninstall and disable other plugins",
      risky: true,
    },
    "processing.video": {
      apis: ["Plugin.video.filter", "Plugin.video.view", "Plugin.video.render"],
      requires: ["playback.read"],
      label: "Process the picture (filters, shaders)",
      risky: false,
    },
    "processing.audio": {
      apis: ["Plugin.audio.filter"],
      requires: ["playback.read", "events"],
      label: "Process the sound",
      risky: false,
    },
    "subtitles.read": {
      apis: ["Subtitles.state", "Subtitles.onChange", "Subtitles.refresh"],
      requires: [],
      label: "Read subtitles",
      risky: false,
    },
    "subtitles.control": {
      apis: [
        "Subtitles.select",
        "Subtitles.load",
        "Subtitles.remove",
        "Subtitles.setStyle",
      ],
      requires: [],
      label: "Load and change subtitles",
      risky: false,
    },
    "media.read": {
      apis: ["MediaCapture.capture", "Snapshot.export"],
      requires: ["media.control"],
      label: "Take snapshots and export clips",
      risky: false,
    },
    "media.control": {
      apis: ["MediaCapture.capture", "Snapshot.export"],
      requires: ["media.read"],
      label: "Take snapshots and export clips",
      risky: false,
    },
    "ui.osd": {
      apis: ["Osd.show", "Osd.panel"],
      requires: [],
      label: "Show messages on the video",
      risky: false,
    },
    clipboard: {
      apis: [
        "Clipboard.readText",
        "Clipboard.writeText",
        "Clipboard.writeImage",
      ],
      requires: [],
      label: "Read and write the clipboard",
      risky: true,
    },
    "window.control": {
      apis: [
        "MainWindow.setVideoArea",
        "MainWindow.setAlwaysOnTop",
        "MainWindow.setCursorAutoHide",
        "MainWindow.setPictureInPicture",
      ],
      requires: [],
      label: "Adjust the main window (size, on top, picture-in-picture)",
      risky: false,
    },
    "bindings.manage": {
      apis: [
        "Bindings.list",
        "Bindings.set",
        "Bindings.reset",
        "Bindings.onChange",
      ],
      requires: [],
      label: "Change all shortcuts",
      risky: true,
    },
    "timeline.marks": {
      apis: ["Timeline.layer"],
      requires: [],
      label: "Show marks on the progress bar",
      risky: false,
    },
    "ui.drop": {
      apis: ["Drops.provide", "Panel.onDrop"],
      requires: [],
      label: "Receive files dropped on the player",
      risky: false,
    },
    "ui.settings": {
      apis: ["Settings.page", "Settings.show"],
      requires: [],
      label: "Add pages to the Options window",
      risky: false,
    },
    "ui.theme": {
      apis: ["Appearance.set", "Appearance.setLanguage"],
      requires: [],
      label: "Change the player's palette",
      risky: false,
    },
    secrets: {
      apis: ["Secrets.get", "Secrets.set", "Secrets.delete"],
      requires: [],
      label: "Store sign-in details in the system keychain",
      risky: true,
    },
  } satisfies Record<string, CapabilityInfo>);

/**
 * Manifest capabilities the player knows (`vestra/1`): the keys of
 * {@link CAPABILITY_INFO}, in the player's order. The same list as the
 * player's `host/src/plugins.rs`; the player's tests check that they agree.
 */
export const CAPABILITIES: readonly string[] = Object.freeze(
  Object.keys(CAPABILITY_INFO),
);

/** The plugin API version this SDK implements (`manifest.apiVersion`). */
export const API_VERSION = "vestra/1";

/**
 * The longest message a plugin may send the player, in UTF-8 bytes of one
 * protocol line with its newline (1 MiB). The player stops a plugin that
 * writes a longer one, so the plugin's side refuses such a request before
 * sending it: it rejects with code `limit`. Property values meet
 * {@link UI_VALUE_LIMITS} before this.
 *
 * @since 1.5.14
 */
export const MESSAGE_LIMIT = 1024 * 1024;
