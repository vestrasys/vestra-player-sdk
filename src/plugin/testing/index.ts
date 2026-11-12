/**
 * Test tools for Vestra Player plugins: an in-memory fake player
 * ({@link TestHost}) and {@link startPlugin}, which activates a plugin against
 * it.
 *
 * `TestHost` speaks the real wire protocol, so the SDK's own logic (revisions,
 * conditional commits, recovery after lost replies, coalescing of updates)
 * runs exactly as it does inside the player. Only the player side is faked,
 * and its semantics are simplified:
 *
 * - no media decoding: sources are facts you set with
 *   {@link TestHost.setSource} or {@link TestHost.openElsewhere};
 * - no Slint and no native windows: views are records of their properties
 *   and callbacks ({@link FakeWindow}), and you fire callbacks yourself;
 * - export jobs advance one step on every state query
 *   (`queued` → `running` → `completed`);
 * - video and audio processing nodes are validated with the player's own
 *   value ranges (an out-of-range `filter.set` ends in `failed` with
 *   `invalid`), an empty chain removes the plugin's chain, a chain on a
 *   generated stream fails `unsupported` (the player's own conformance
 *   cases check all three), and the command limits ({@link COMMAND_LIMITS}),
 *   property value limits ({@link UI_VALUE_LIMITS}) and menu ids
 *   ({@link MENU_IDS}) are enforced.
 *
 * Typical workflow: start the plugin with {@link startPlugin} (it reads the
 * plugin's `manifest.json`), drive it the way the user or another plugin
 * would (run commands, press bindings, fire view callbacks, change the
 * source), wait with {@link TestHost.settle}, assert on what the host
 * recorded (`host.osd`, `host.window(id).props`, `host.sent(method)`, …), and
 * finally call `stop()`.
 *
 * Use it from `node:test` (what `vestra-plugin test` runs). Each test should
 * create its own host; `stop()` removes the host's temporary directories.
 *
 * @example Test that a menu item shows a message
 * A complete test file: it activates the plugin against an in-memory
 * player, picks its Hello menu item and checks what the OSD showed.
 * `startPlugin` reads the plugin's `manifest.json` from `directory`, calls
 * `activate` and waits for its registrations; `run()` executes the command
 * as the menu would and waits until the host is idle. `stop()` disposes
 * the plugin and removes the host's temporary files, even when an
 * assertion fails.
 * ```ts
 * // tests/main.test.ts
 * import assert from "node:assert/strict";
 * import test from "node:test";
 * import { startPlugin } from "@vestra-player/sdk/testing";
 * import activate from "../main.ts";
 *
 * test("the Hello command shows a message", async () => {
 *   const { host, stop } = await startPlugin(activate, {
 *     directory: new URL("..", import.meta.url),
 *   });
 *   try {
 *     assert.equal(host.command("hello").state.enabled, true);
 *     await host.command("hello").run();
 *     assert.deepEqual(host.osd, ["Hello"]);
 *   } finally {
 *     await stop();
 *   }
 * });
 * ```
 *
 * @packageDocumentation
 * @module @vestra-player/sdk/testing
 */
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import type { Server } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostError } from "../../wire.ts";
import type { PackageManifest, PackageSource } from "../types.ts";
import type {
  Json,
  LayoutSlot,
  LocalServices,
  PlaybackStats,
  Transport,
  WireSystemInfo,
} from "../../wire.ts";
import {
  BAR_BUTTON_ICONS,
  BAR_BUTTON_LIMITS,
  BUILTIN_COMMANDS,
  BUILTIN_SUBMENUS,
  COMMAND_LIMITS,
  MENU_IDS,
} from "../../commands.ts";
import type { BuiltinCommand, BuiltinSubmenu } from "../../commands.ts";
import { CAPABILITY_INFO, MESSAGE_LIMIT } from "../../capabilities.ts";
import type { CapabilityInfo } from "../../capabilities.ts";
import { OSD_LIMITS } from "../osd.ts";
import { TIMELINE_LIMITS } from "../timeline.ts";
import { SECRET_LIMITS, SESSION_STORAGE_LIMITS } from "../services.ts";
import { SUBTITLE_LIMITS } from "../subtitles.ts";
import { BINDING_INPUTS, canonical } from "../bindings.ts";
import { THEME_PALETTES } from "../../palettes.ts";
import { IMAGE_LIMITS, UI_VALUE_LIMITS } from "../values.ts";
import type { CommandDeclaration } from "../../commands.ts";
import type { SourceState } from "../../source.ts";
import type { SubtitleState } from "../../subtitles.ts";
import { VIDEO_PROCESSING_LIMITS } from "../../processing.ts";
import { RENDER_DEFAULTS, VIEW_DEFAULTS } from "../view.ts";
import type {
  MotionMode,
  MotionReason,
  RenderingMode,
  RenderingPreference,
  RenderingReason,
  RenderSettings,
  UpscalingDecodingCause,
  UpscalingPlugin,
  UpscalingReason,
  UpscalingVideoSize,
  ViewSettings,
} from "../types.ts";
import type { MediaJob } from "../../media.ts";
import { createPlugin } from "../index.ts";
import { PATCH_FEATURE } from "../patch.ts";
import type {
  LanguagePreference,
  Locale,
  Plugin,
  StopReason,
  TemplateArgs,
  TextValue,
  ThemeId,
} from "../types.ts";
import {
  LOCALES,
  LIST_SEPARATORS,
  loadPackageCatalog,
  TEXT_LIMITS,
} from "../../i18n.ts";
import { Internals } from "./internals.ts";
import {
  on,
  emit,
  settle,
  close,
  keepsRunning,
  transportHandlers,
  tick,
  takenErrors,
  tellResidency,
} from "./transport.ts";
import {
  bindingClaims,
  bindingKey,
  keysChanged,
  press,
  barButtons,
  commandsHandlers,
  builtinHandlers,
  runPaletteLead,
  pluginCapabilities,
} from "./commands.ts";
import {
  registerCoreActions,
  windowFacts,
  coreActionsHandlers,
} from "./core-actions.ts";
import { translate, i18nHandlers } from "./i18n.ts";
import {
  mountOther,
  unmountOther,
  mounted,
  setTimelineRanges,
  setTimelineLayer,
  layoutHandlers,
} from "./layout.ts";
import { osdHandlers } from "./osd.ts";
import { packageDirectories } from "./slint-types.ts";
import { failStream, jobsHandlers } from "./jobs.ts";
import {
  motionState,
  upscalingState,
  failVideoRender,
  failVideoShaders,
  upscalingDecoding,
  processingHandlers,
} from "./processing.ts";
import {
  sourceIntent,
  startResolution,
  setSource,
  mediaHandlers,
  initialSource,
} from "./media.ts";
import {
  drop,
  setMainWindow,
  servicesHandlers,
  sortedJson,
} from "./services.ts";

/** Throw one of these from `host.handle(...)` to simulate a definite refusal. */
export { HostError };
/** The player's command caps, which the test host enforces as well. */
export { COMMAND_LIMITS, MENU_IDS };
/** The icons and limits of bottom-bar buttons, which the test host checks as well. */
export { BAR_BUTTON_ICONS, BAR_BUTTON_LIMITS };
/** The submenus of the player's built-in plugins, by key path. */
export { BUILTIN_COMMANDS, BUILTIN_SUBMENUS };
export type { BuiltinCommand, BuiltinSubmenu };
/** The manifest capabilities: what each opens and how the store shows it. */
export { CAPABILITY_INFO };
export type { CapabilityInfo };
/** The longest message a plugin may send the player. */
export { MESSAGE_LIMIT };
/** The player's limits on the on-screen display. */
export { OSD_LIMITS };
/** The player's limits on a timeline layer. */
export { TIMELINE_LIMITS };
/** The player's limits on stored secrets. */
export { SECRET_LIMITS };
/** The player's limits on `plugin.storage.session`. */
export { SESSION_STORAGE_LIMITS };
/** The player's limits on loaded subtitle files, which the test host enforces as well. */
export { SUBTITLE_LIMITS };
/** The player's bounds on convolution, lut3d and shader-channel requests, which the test host enforces as well. */
export { VIDEO_PROCESSING_LIMITS };
/** The names bindings are made of. */
export { BINDING_INPUTS };
/** The colours of the player's palettes, by `Theme` token. */
export { THEME_PALETTES };
/** The player's property value limits, which the test host enforces as well. */
export { IMAGE_LIMITS, UI_VALUE_LIMITS };
/**
 * The player's limits on one text value ({@link Text}, {@link TextList},
 * with everything nested in it), which the test host enforces as well:
 * nesting depth 8, 1024 texts, lists and arguments in all, 16 arguments per
 * text, 256 items per list, 4096 bytes per source text or string argument.
 *
 * @since 1.5.11
 */
export { TEXT_LIMITS };
/**
 * The separator of each {@link ListStyle} per interface language, as the
 * player joins a {@link TextList}.
 *
 * @since 1.5.11
 */
export { LIST_SEPARATORS };
/**
 * The player's interface languages, English (the source) first, as the
 * player's own table: `["en", "zh-Hans", "ja", "ko", "de", "fr", "es"]`.
 *
 * @example Check that every language translates a menu item
 * The test fails for each interface language in which the "Open…" item
 * still shows English. It starts the plugin once per language except
 * English (`LOCALES[0]`): the `locale` option loads the plugin's
 * `locales/<locale>.po` and the host shows menu texts translated with it,
 * which `display` reports.
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 * declare function activate(plugin: Plugin): Promise<void>;
 * // ---cut---
 * import assert from "node:assert/strict";
 * import { LOCALES, startPlugin } from "@vestra-player/sdk/testing";
 *
 * const directory = new URL("..", import.meta.url);
 * for (const locale of LOCALES.slice(1)) {
 *   const { host, stop } = await startPlugin(activate, { directory, locale });
 *   try {
 *     assert.notEqual(host.command("open").display.title, "Open…", locale);
 *   } finally {
 *     await stop(); // also when the assertion fails
 *   }
 * }
 * ```
 */
export { LOCALES };

type Handler = (params: Record<string, Json>) => unknown;
type Call = { method: string; params: Record<string, Json> };

/**
 * A tool window as the test host keeps it: the record of a
 * `plugin.windows.create(...)` window after its first `show()`. Get one with
 * {@link TestHost.window}.
 *
 * @example Change a setting in a tool window from a test
 * The test opens the plugin's Picture window, moves its brightness control
 * and checks that the plugin wrote the value back. `emit` fires a Slint
 * callback as if the user used the control; the plugin's `on` handler runs
 * and sets properties, which reach the host as requests, so `settle()`
 * waits for them before `props` is read.
 * ```ts
 * import assert from "node:assert/strict";
 * declare const host: TestHost;
 * // ---cut---
 * await host.command("open-picture").run(); // the plugin calls pictureWindow.show()
 * const picture = host.window("picture");
 * assert.equal(picture.visible, true);
 * picture.emit("adjust", "brightness", 40); // fire a Slint callback
 * await host.settle();
 * assert.equal(picture.props["brightness"], 40);
 * ```
 *
 * @remarks
 * A record, not a window: no Slint file is compiled and nothing is drawn.
 * `props` holds what the plugin wrote, by Slint name; `emit` fires a
 * callback the way the user's input would; `userClose` closes it the way
 * the title-bar button would.
 *
 * @capability None.
 * @since 1.0.0
 * @category Testing
 */
export interface FakeWindow {
  /** The `.slint` file the window was created from (package-relative). */
  file: string;
  /** Whether the window is shown (`show()`) or hidden (`hide()`). */
  visible: boolean;
  /**
   * The properties the plugin wrote, by their Slint (kebab-case) names:
   * `canMark` is stored as `can-mark`. Runtime images appear in their wire
   * form; read the path with {@link TestHost.imagePath}.
   */
  props: Record<string, Json>;
  /** The Slint callback names (kebab-case) the plugin bound with `on()`. */
  callbacks: string[];
  /**
   * Fire a Slint callback as if the user triggered it in the window. The
   * name may be kebab-case or camelCase; `args` are the callback arguments.
   * Follow it with `await host.settle()` before asserting.
   *
   * @capability None.
   *
   * @example Type into a window's search field
   * The test types "cat" into the window's search box and checks the
   * plugin's results. `emit` delivers the Slint callback `search-changed`
   * with its argument to the plugin's `on` handler; `settle()` waits for the
   * properties the handler wrote.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const search = host.window("search");
   * search.emit("searchChanged", "cat"); // camelCase or kebab-case
   * await host.settle();
   * assert.ok((search.props["results"] as unknown[]).length > 0);
   * ```
   *
   * @since 1.0.0
   */
  emit(callback: string, ...args: Json[]): void;
  /**
   * The user closes the window with its title-bar button: the window closes
   * and the plugin's `window.onClose` listeners run (unlike the plugin's own
   * `close()`).
   *
   * @capability None.
   *
   * @example Close a window the way the user does
   * The test closes the plugin's window with its title-bar button and checks
   * that the plugin stopped its timer. Unlike the plugin's own `close()`,
   * `userClose` runs the plugin's `onClose` listeners.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.window("clock").userClose();
   * await host.settle();
   * assert.equal(host.window("clock").visible, false);
   * ```
   *
   * @since 1.0.0
   */
  userClose(): void;
}

/**
 * A file dialog as the player shows it ({@link TestHost.fileDialogs}).
 *
 * @since 1.5.11
 *
 * @category Testing
 */
export interface FileDialogText {
  /** Which dialog. */
  kind: "openFile" | "openFiles" | "openDirectory" | "saveFile";
  /** Its title as shown, if the plugin gave one. */
  title?: string;
  /** The proposed file name as shown, if the plugin gave one. */
  fileName?: string;
}

/**
 * A command the plugin registered with `plugin.commands.add`, as the test
 * host keeps it. Get one with {@link TestHost.command} (the plugin's own) or
 * {@link TestHost.coreAction} (the player's core actions).
 *
 * @example Run a checkable menu item from a test
 * The test checks the Loop item's menu place, picks it and sees its check
 * mark turn on. `host.command(id)` is the host's record of what the plugin
 * declared and the state it last sent; `run()` calls the plugin's `run`
 * like the menu, after which the SDK re-evaluates the command's state and
 * sends it, and `run()` resolves once the host is idle again.
 * ```ts
 * import assert from "node:assert/strict";
 * declare const host: TestHost;
 * // ---cut---
 * const toggle = host.command("toggle-loop");
 * assert.deepEqual(toggle.declaration.path, ["Playback", "Loop"]);
 * assert.equal(toggle.state.checked, false);
 * await toggle.run();
 * assert.equal(host.command("toggle-loop").state.checked, true);
 * ```
 *
 * @remarks
 * The host's record of one command: what the plugin declared, the state
 * it last sent, and how the menu shows it in {@link TestHost.locale}.
 * Read it again after `settle()` to see changes; `run` executes it as the
 * menu would.
 *
 * @capability None.
 * @since 1.0.0
 * @category Testing
 */
export interface FakeCommand {
  /**
   * What the plugin declared: id, menu path, title, order, group, default
   * bindings, focus and repeat. Wire-level shape; it may gain fields in minor
   * versions.
   */
  declaration: CommandDeclaration;
  /**
   * What the menu shows, as the player shows it in the test host's
   * {@link TestHost.locale}: the title and each path segment translated with
   * the plugin's catalog (the player's own menus in the player's words), the
   * keys normalized (`@video` is "Video").
   *
   * @since 1.5.9
   */
  readonly display: {
    /** The menu text of the item. */
    title: string;
    /** Each segment of the path as shown; empty without a path. */
    path: string[];
    /**
     * The disabled or busy reason as shown, `null` without one (a plugin
     * command's; not enumerable, so comparing `display` with
     * `{ title, path }` still works).
     *
     * @since 1.5.11
     */
    reason?: string | null;
    /**
     * The category as shown (`CommandOptions.category`, translated with
     * the plugin's catalog), `null` without one. Not enumerable, like
     * `reason`.
     *
     * @since 1.6.4
     */
    category?: string | null;
  };
  /**
   * The conditions the plugin sent for `enabled` and `checked`
   * (`plugin.when`, wire form), `undefined` without. Like the player, the
   * host evaluates them in {@link FakeCommand.state} against `source`,
   * `mainWindow.fullscreen`, `appearance` and `language`.
   *
   * @since 1.5.40
   */
  when?: {
    /** The condition of `enabled`. */
    enabled?: Json;
    /** The condition of `checked`. */
    checked?: Json;
  };
  /**
   * The command state as the player shows it: what the plugin last sent
   * (after the update pass), with the fields given as conditions
   * (`plugin.when`) evaluated now. With an `enabled` condition, `reason`
   * is `null` while the command is enabled and not busy.
   */
  state: {
    /** `false` when the plugin disabled the command. */
    enabled: boolean;
    /** The check mark: `true`, `false`, or `null` for none. */
    checked: boolean | null;
    /** `true` while the plugin reports the command as busy. */
    busy: boolean;
    /** The reason the plugin sent (source text or a text value; see `display.reason`). */
    reason: TextValue | null;
  };
  /**
   * The state revision the player holds; increases with every state update
   * the SDK sends.
   */
  revision: number;
  /**
   * Execute the command the way the menu would, then wait until the host is
   * idle. Rejects (with a {@link HostError}) when the command is disabled or
   * busy, like the player, which does not call `run` then.
   *
   * @capability None.
   * @throws `command` (rejects) A `HostError`: the command is disabled or
   *   busy (the message says which).
   *
   * @example Check that a disabled item refuses to run
   * The test checks that Export cannot run while nothing is open. Like the
   * player, the host does not call `run` for a disabled or busy command;
   * the promise rejects with a `HostError`.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * await assert.rejects(host.command("export").run());
   * ```
   *
   * @since 1.0.0
   */
  run(): Promise<void>;
}

/**
 * A command's bottom-bar button (`CommandOptions.button`) as the player shows
 * it: an entry of {@link TestHost.barButtons}.
 *
 * @since 1.5.29
 *
 * @remarks
 * A bottom-bar button as the player would show it, derived from the
 * command's declaration and state each time it is read: clickable while
 * the command is enabled and not busy, accent-coloured while checked, with
 * the command's title (and reason) as the tooltip.
 *
 * @capability None.
 *
 * @example Check a bar button's tooltip while it is disabled
 * The test checks that the Export button shows why it cannot be clicked.
 * The tooltip is the command's title; while the command is disabled or
 * busy and has a non-empty `reason`, the reason follows on a second line.
 * ```ts
 * import assert from "node:assert/strict";
 * declare const host: TestHost;
 * // ---cut---
 * const [button] = host.barButtons;
 * assert.equal(button?.enabled, false);
 * assert.match(button?.tooltip ?? "", /\n/); // the command declares a reason
 * ```
 *
 * @category Testing
 */
export interface FakeBarButton {
  /** The command's local id. */
  readonly command: string;
  /** The icon name, or the image's path for a `plugin.ui.image` icon. */
  readonly icon: string;
  /** `true` when the icon is the plugin's image. */
  readonly image: boolean;
  /** The declared `order`. */
  readonly order: number;
  /** Clickable: the command is enabled and not busy. */
  readonly enabled: boolean;
  /** Shown with the on dot under its icon: the command is checked. */
  readonly checked: boolean;
  /**
   * The tooltip without the key: the command's shown title (trailing "…"
   * removed), then, while it cannot run, its reason on a second line.
   */
  readonly tooltip: string;
  /**
   * Click the button, then wait until the host is idle: runs the command
   * as its menu item would. Rejects (with a {@link HostError}) while the
   * button is disabled, and once the command is gone.
   *
   * @capability None.
   * @throws `command` (rejects) A `HostError`: the command is disabled or
   *   busy.
   * @throws `missing` (rejects) A `HostError`: the command is gone.
   *
   * @example Click the button and wait for its effect
   * The test clicks the plugin's button and checks the OSD. `click` runs the
   * command like its menu item and resolves once the host is idle.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * await host.barButtons[0]?.click();
   * assert.ok(host.osd.length > 0);
   * ```
   *
   * @since 1.5.29
   */
  click(): Promise<void>;
}

/**
 * A generated stream (`plugin.player.openStream`) as the test host sees it:
 * the fake player end of the frame connection. Assertion surface; see
 * {@link TestHost.producers}.
 *
 * @remarks
 * The player's end of a generated stream's frame connection
 * ({@link TestHost.producers}): how many frames arrived and whether the
 * plugin released it or the player retired it. Tests assert on it; nothing
 * is played.
 *
 * @capability None.
 *
 * @example Check that the stream delivers frames
 * The test starts the plugin's generator and checks that video and audio
 * arrive. The counters grow as the SDK pulls frames and sends them over
 * the fake connection.
 * ```ts
 * import assert from "node:assert/strict";
 * declare const host: TestHost;
 * // ---cut---
 * await host.command("start-generator").run();
 * await host.settle(200); // let a few frames through
 * const [producer] = host.producers.values();
 * assert.ok((producer?.videoFrames ?? 0) > 0 && (producer?.receivedFrames ?? 0) > 0);
 * ```
 *
 * @since 1.0.0
 * @category Testing
 */
export interface FakeProducer {
  /** The producer id the host assigned (`1`, `2`, … per host). */
  id: number;
  /** Audio sample frames received so far (one stereo f32 pair = 1 frame). */
  receivedFrames: number;
  /** Video frames received so far. */
  videoFrames: number;
  /** `true` once the plugin released the producer (stream stopped or disposed). */
  released: boolean;
  /**
   * `true` once the player retired the producer, as the real player does at
   * once: another source replaced it (`open`, another stream, a resolved
   * file), the source was closed, or {@link TestHost.failStream} failed it.
   * A retired producer's `producer.state` answers `unavailable`.
   */
  retired: boolean;
  /**
   * `true` if the frame connection closed while this stream was still the
   * player's source: the player reports that as a playback failure
   * ("producer transport closed"). `stop()` closes the source first.
   */
  droppedWhileSelected: boolean;
}

/**
 * A Markdown document as {@link TestHost.markdown} reads it back.
 *
 * @since 1.1.0
 * @category Testing
 */
export interface MarkdownWire {
  /** The Markdown text. */
  text: string;
  /** The base given to `ui.markdown`, or `null`. */
  base: string | null;
  /** Remote image address → the file the SDK downloaded for it. */
  images: Record<string, string>;
}
/**
 * One mounted panel of the plugin under test ({@link TestHost.mounted},
 * {@link TestHost.panels}): a {@link FakeWindow} record with its slot,
 * component and interaction locks.
 *
 * @remarks
 * One per slot the plugin mounted, kept in {@link TestHost.panels}; disposing a
 * panel removes only its own.
 *
 * @example Check the adjust panel's locks
 * The plugin's adjust panel reports a drag; the test reads the locks it
 * sent. `mounted(slot)` picks one of the plugin's panels by slot.
 * ```ts
 * import assert from "node:assert/strict";
 * declare const host: TestHost;
 * // ---cut---
 * const panel: FakePanel = host.mounted("adjust");
 * assert.deepEqual(panel.locks, { focused: false, dragging: true, popupOpen: false });
 * ```n *
 * @capability None.
 * @since 1.6.15
 * @category Testing
 */
export type FakePanel = Omit<FakeWindow, "callbacks" | "userClose"> & {
  /** `"bottom"`, `"sidebar"`, `"adjust"` or `"backdrop"`. */
  slot: string;
  /** The exported component the SDK found in the file. */
  component: string;
  /** The last `panel.setInteraction(...)` locks, `null` before any. */
  locks: Json;
};

/**
 * An in-memory fake Vestra Player for plugin tests.
 *
 * The plugin under test talks to it over the real wire protocol (the host is
 * the plugin's transport), so everything the SDK does runs unchanged. The
 * host answers each request with simplified player behaviour, records what
 * the plugin did, and lets the test act as the user or another plugin.
 *
 * Members fall into a few groups:
 *
 * - **Drive the plugin**: {@link TestHost.command}`(id).run()`,
 *   {@link TestHost.press}, {@link TestHost.window}`(id).emit(...)`,
 *   {@link TestHost.mounted}`().emit(...)`, {@link TestHost.drop},
 *   {@link TestHost.step}, {@link TestHost.dialogAnswers}.
 * - **Simulate the player and other plugins**: {@link TestHost.setSource},
 *   {@link TestHost.openElsewhere}, {@link TestHost.setMainWindow},
 *   {@link TestHost.setTimelineLayer}, {@link TestHost.setAppearance},
 *   {@link TestHost.setPackages}, {@link TestHost.emit}.
 * - **Preset data** the plugin reads: {@link TestHost.stats},
 *   {@link TestHost.app}, {@link TestHost.systemInfo},
 *   {@link TestHost.chapters}, {@link TestHost.audioDevices},
 *   {@link TestHost.secrets}, {@link TestHost.clipboard},
 *   {@link TestHost.tools}, {@link TestHost.rendering},
 *   {@link TestHost.upscaling}, {@link TestHost.motion}.
 * - **Assert** on records: {@link TestHost.osd}, {@link TestHost.calls},
 *   {@link TestHost.sent}, {@link TestHost.conflicts},
 *   {@link TestHost.layout}, {@link TestHost.menus}, and many more.
 * - **Inject failures**: {@link TestHost.handle} / {@link TestHost.reset}.
 * - **Synchronise**: {@link TestHost.settle}.
 *
 * Usually created by {@link startPlugin}. Create one yourself only to preset
 * data that the plugin reads during activation (`app`, `appearance`,
 * `secrets`, ...), then pass it as `startPlugin(activate, { host })`.
 *
 * Fields that mirror player state at the wire level (`source`, `subtitles`,
 * `processing`, `snapshots`, `jobs`, `producers`, `uploads`, `resolvers`,
 * `calls`) use the protocol's shapes. They are fine for assertions but are
 * not part of the plugin API: their shape may change in minor versions.
 *
 * @example Preset the player, then react to another plugin's file
 * The test starts the plugin in a player with the dark theme, opens a file
 * the way another plugin would, and checks the plugin's panel title. A host
 * created first can be preset with data the plugin reads during
 * activation; `startPlugin` then uses it. `openElsewhere` changes the
 * source and broadcasts it, the plugin's listener updates its panel, and
 * `settle()` waits for those requests before the assertion.
 * ```ts
 * import assert from "node:assert/strict";
 * import test from "node:test";
 * import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
 * import activate from "../main.ts";
 *
 * test("shows the playing file in the panel", async () => {
 *   const host = new TestHost();
 *   host.appearance = "vestra"; // read during activation
 *   const { stop } = await startPlugin(activate, {
 *     directory: new URL("..", import.meta.url),
 *     host,
 *   });
 *   host.openElsewhere("/media/clip.mp4"); // another plugin opened a file
 *   await host.settle();
 *   assert.equal(host.mounted().props["title"], "clip.mp4");
 *   await stop();
 * });
 * ```
 *
 * @remarks
 * An in-memory player that speaks the real wire protocol, so the SDK's own
 * logic runs as it does in the player; only the player side is simulated
 * (no decoding, no Slint, no windows). Make one per test, preset it if the
 * plugin reads something during activation, start the plugin with
 * {@link startPlugin}, drive it, `settle()`, and assert on what it
 * recorded.
 *
 * @capability None.
 * @see [Test a plugin](../../../docs/guides/testing.md)
 * @since 1.0.0
 * @category Testing
 */
export class TestHost implements Transport {
  readonly #inner = new Internals();
  /**
   * Every request the plugin sent, in order: `{ method, params }`.
   * Wire-level; prefer {@link TestHost.sent} for one method.
   */
  readonly calls: Call[] = [];
  /** The host events the plugin subscribed to (needs `events` etc.). */
  readonly subscriptions = new Set<string>();
  /**
   * The subscribed events the plugin really listens to: an `onChange` and
   * the like, or a binding that reads the state. The SDK's own copies of
   * the state (what keeps `plugin.player.state` current) are left out.
   * Empty means the player may stop the plugin while nothing uses it
   * (unless it holds something else: a window, a panel, a filter…).
   *
   * @since 1.5.38
   */
  readonly listening = new Set<string>();
  /**
   * Why the plugin listens to each event of {@link TestHost.listening}:
   * every listener and every binding that reads its state, as the
   * player's log says them (`a listener added at main.ts:12`,
   * `command "Save" enabled is a function that reads plugin.player.state
   * (main.ts:40) — use plugin.when`), in the order they came.
   *
   * @since 1.5.40
   */
  readonly listeningWhy = new Map<string, string[]>();
  /**
   * The player's source facts (phase, position, duration, paused, rate,
   * audio tracks, loop, ...). Wire-level shape; change it with
   * {@link TestHost.setSource}, which also broadcasts it.
   */
  source: SourceState = initialSource();
  /** Tool windows by id (see {@link TestHost.window}). */
  readonly windows = new Map<string, FakeWindow>();
  /**
   * The plugin's mounted panels by slot, in mount order (one panel per slot).
   * See {@link TestHost.mounted}.
   */
  readonly panels = new Map<string, FakePanel>();
  /**
   * The plugin's mounted panel (bottom bar, sidebar, adjust column or
   * backdrop), the last mounted when it has several, or `null`. See
   * {@link TestHost.mounted}.
   */
  get panel(): FakePanel | null {
    return [...this.panels.values()].at(-1) ?? null;
  }
  /** The plugin's commands by local id (see {@link TestHost.command}). */
  readonly commands = new Map<string, FakeCommand>();
  /** The player's 14 core actions (`host/<id>`), kept apart from the plugin's `commands`. */
  readonly coreCommands = new Map<string, FakeCommand>();
  /**
   * Both panel positions as the player reports them (`null` while no panel
   * is mounted there). You may change a slot directly and then call
   * `host.emit("window.state", {})` to simulate a change made elsewhere.
   *
   * @example Hide the sidebar and check the player's layout
   * With the plugin's panel in the sidebar, toggling the sidebar records
   * that the user prefers it hidden. `toggle()` reads the slot from the
   * player, asks for the opposite of its `preferred` flag and resolves once
   * the player answered, so the host's `layout` already shows the new value.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * assert.equal(host.layout.sidebar?.preferred, true);
   * await plugin.panels.sidebar.toggle();
   * assert.equal(host.layout.sidebar?.preferred, false);
   * ```
   */
  readonly layout: {
    /**
     * The bottom bar position: `preferred`, `effective`, `reason`,
     * `detached`, `owner` and `panels` (its one panel).
     */
    bottom: LayoutSlot | null;
    /**
     * The sidebar position: `preferred`, `effective`, `reason`, `detached`;
     * `panels` are its tabs in order (`{ owner, plugin, title }`), `owner`
     * the current tab's (the plugin under test is owner 1).
     */
    sidebar: LayoutSlot | null;
    /**
     * The adjust column, like the sidebar but never `detached`. It starts
     * hidden (`preferred: false`, `reason: "userHidden"`), as the player's does
     * until the user opens it.
     */
    adjust: LayoutSlot | null;
  } = {
    bottom: null,
    sidebar: null,
    adjust: null,
  };
  /**
   * Every `osd.show` text as the player shows it (translated with the
   * plugin's catalog and formatted with its args), newest last. The
   * template and args the plugin sent are in `host.sent("osd.show")`.
   */
  readonly osd: string[] = [];
  /**
   * The action buttons of each `osd.show` message, in step with `osd` (index
   * for index): each button's title as shown and its command; `[]` for a
   * message without actions.
   */
  readonly osdActions: {
    /** The button title as shown, in the plugin's locale. */
    title: string;
    /** The local id of the plugin's command the button runs. */
    command: string;
  }[][] = [];
  /**
   * Press button `index` of the newest OSD message, as the user does: its
   * command runs as if picked from a menu, and settles. A disabled or busy
   * command does nothing, as in the player.
   *
   * @param index - 0 or 1.
   *
   * @throws `Error` (rejects) The newest message has no button `index`.
   *
   * @example Press "Show in Folder" on the saved message
   * The test checks the button the plugin put on its newest message, then
   * presses it as the user would: the plugin's `reveal` command runs.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * assert.deepEqual(host.osdActions.at(-1), [
   *   { title: "Show in Folder", command: "reveal" },
   * ]);
   * await host.pressOsdAction(0); // runs the plugin's `reveal` command
   * ```
   *
   * @capability None.
   * @since 1.6.9
   */
  async pressOsdAction(index: number) {
    const action = this.osdActions.at(-1)?.[index];
    if (!action)
      throw new Error(`the newest OSD message has no button ${index}`);
    const command = this.commands.get(action.command);
    if (!command || command.state.busy || !command.state.enabled) return;
    await command.run();
  }
  /** The text of this plugin's osd panel as shown, `null` when hidden. */
  osdPanel: string | null = null;

  /**
   * The interface language the test host plays (`plugin.i18n.locale`), `"en"`
   * by default. Set it before {@link startPlugin} (or pass its `locale`
   * option): the plugin's catalog for it is read from the package's
   * `locales/` then, and the menus ({@link FakeCommand.display}), OSD
   * messages, dialog texts, settings page and panel titles show its
   * translations, the way the player shows them.
   *
   * The player's own texts (core actions' messages and menus, its refusals) are
   * English, or the player's Simplified Chinese for `"zh-Hans"`. While `locale`
   * was never set they stay in Chinese; set `locale` to test what a user sees
   * now.
   *
   * @example Check a menu path in Simplified Chinese
   * The test starts the plugin with a Chinese interface and checks the
   * menu path its Blur item shows. The `locale` option sets
   * `host.locale` before activation, so the plugin's `locales/zh-Hans.po`
   * is loaded; the built-in menu `@video` shows in the player's own words
   * (视频), the item's title in the plugin's translation.
   * ```ts
   * import assert from "node:assert/strict";
   * declare function activate(plugin: Plugin): Promise<void>;
   * declare const directory: URL;
   * // ---cut---
   * const { host, stop } = await startPlugin(activate, { directory, locale: "zh-Hans" });
   * assert.deepEqual(host.command("blur").display.path, ["视频", "模糊…"]);
   * await stop();
   * ```
   *
   * @since 1.5.9
   */
  get locale(): Locale {
    return this.#inner.locale ?? "en";
  }
  set locale(locale: Locale) {
    if (!(LOCALES as readonly string[]).includes(locale))
      throw new Error(`test host: unknown locale ${locale}`);
    this.#inner.locale = locale;
  }

  /**
   * Read the plugin's translations for {@link TestHost.locale} from a
   * package directory, as the player would (`locales/<locale>.json` of a
   * built package, else the source `locales/<locale>.po`); `startPlugin`
   * does this. None for English; a missing file means none; a broken `.po`
   * throws.
   *
   * @param directory - The package directory (holding `locales/`).
   * @since 1.5.9
   *
   * @capability None.
   *
   * @example Load the translations after changing the language
   * The test switches the host to German before starting the plugin and
   * loads that catalog itself (`startPlugin` does the same). Texts are then
   * shown in German.
   * ```ts
   * declare const host: TestHost;
   * declare const directory: string;
   * // ---cut---
   * host.locale = "de";
   * host.loadCatalog(directory); // locales/de.po (or de.json)
   * ```
   */
  loadCatalog(directory: string) {
    this.#inner.catalog = loadPackageCatalog(directory, this.locale);
  }
  /**
   * A text of the plugin as the player shows it: translated with the
   * plugin's catalog ({@link TestHost.loadCatalog}), then formatted with
   * `args` when given.
   *
   * @param text - English source text or template.
   * @param args - Values for its placeholders.
   * @returns The shown text.
   *
   * @example Compare with a translated message
   * The test expects the text a Chinese user sees for a template the plugin
   * shows. `translate` looks the English source up in the plugin's catalog
   * for `host.locale` and fills in the arguments, the way the player does.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * assert.equal(host.translate("Speed {}×", [2]), "倍速 2×");
   * ```
   *
   * @since 1.5.9
   *
   * @capability None.
   */
  translate(text: TextValue, args?: TemplateArgs): string {
    return translate(this, this.#inner, text, args);
  }

  /**
   * The saved interface language (`plugin.appearance.language`), changed by
   * `appearance.setLanguage` or {@link TestHost.setLanguage}.
   *
   * @since 1.5.9
   */
  language: LanguagePreference = "system";
  /**
   * Simulate another plugin (or the user) saving the interface language:
   * pushes `appearance.changed`.
   *
   * @param language - `"system"` or a locale.
   * @since 1.5.9
   *
   * @capability None.
   *
   * @example Simulate the user choosing French for the next start
   * The plugin hears that the saved interface language changed. The host
   * pushes `appearance.changed`, which a plugin with `events` sees in
   * `appearance.language` once it has read it and subscribed; this run's
   * language does not change.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * void plugin.appearance.language; // read once: the SDK then follows it
   * plugin.player.on("appearance.changed", () => {}); // subscribes to appearance events
   * host.setLanguage("fr");
   * await host.settle();
   * assert.equal(plugin.appearance.language, "fr");
   * ```
   */
  setLanguage(language: LanguagePreference) {
    this.language = language;
    this.emit("appearance.changed", { theme: this.appearance, language });
  }
  /**
   * Every `dialogs.confirm` as the player shows it: its texts translated
   * (message and detail formatted with `args`), newest last. The options
   * the plugin sent are in {@link TestHost.confirms}.
   *
   * @since 1.5.9
   */
  readonly confirmTexts: {
    /** The question. */
    message: string;
    /** The text under it, if any. */
    detail?: string;
    /** The confirm button. */
    confirm: string;
    /** The cancel button (the player's "Cancel" by default). */
    cancel: string;
    /** The checkbox, if any. */
    checkbox?: string;
  }[] = [];
  /**
   * Every file dialog (`openFile`, `openFiles`, `openDirectory`,
   * `saveFile`) as the player shows it: the title translated, a text file
   * name translated, newest last. The options the plugin sent are in
   * `host.sent("dialogs.open")`.
   *
   * @since 1.5.11
   */
  readonly fileDialogs: FileDialogText[] = [];
  /** The sequence provider's flags, `null` without a provider. */
  sequence: {
    /** The provider's `canNext`, as last evaluated. */
    canNext: boolean;
    /** The provider's `canPrevious`, as last evaluated. */
    canPrevious: boolean;
  } | null = null;
  /**
   * What `player.stats()` returns. Fields added in later rounds may be left
   * out; the SDK fills them with `null`.
   *
   * @example Pretend a 1080p H.264 video is playing
   * The plugin's `player.stats()` now reports a 1920×1080 H.264 stream at
   * 24 fps. The host answers `stats()` with this object as it stands, so a
   * test sets it before the plugin asks; fields it leaves out come back as
   * `null` from the SDK.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.stats = {
   *   ...host.stats, // keep the other fields
   *   video: { codec: "h264", width: 1920, height: 1080, fps: 24 },
   * } as typeof host.stats;
   * ```
   */
  stats: PlaybackStats = {
    backend: "test",
    session: 0,
    framesShown: 0,
    framesDropped: 0,
    presentedFps: null,
    video: null,
    audio: null,
    avSyncMs: null,
    cacheSeconds: null,
  };
  /** Every `subtitles.load`: its options and bytes, newest last. */
  readonly subtitleLoads: {
    /** The `format` option (`"srt"` by default). */
    format: "srt" | "ass";
    /** The `title` option, `null` when omitted. */
    title: string | null;
    /** The `select` option (`"primary"` by default). */
    select: "primary" | "secondary" | "none";
    /** The uploaded file bytes. */
    bytes: Buffer;
  }[] = [];
  /**
   * The fake system clipboard. Preset `text` to test `readText`;
   * `writeText` replaces it and `writeImage` appends the image path.
   */
  readonly clipboard: {
    /** The clipboard's text, `null` when it holds none. */
    text: string | null;
    /** Paths given to `clipboard.writeImage`, newest last. */
    images: string[];
  } = {
    text: null,
    images: [],
  };
  /** The effective `power.preventSleep` mode. */
  power: "off" | "playing" = "off";
  /**
   * The fake `ffmpeg` / `ffprobe` behind `plugin.tools`. A tool without a
   * handler is not found (`available()` is false, `run()` rejects with
   * `unavailable`).
   *
   * @example Fake ffprobe and a failing ffmpeg
   * The plugin's Probe command gets an empty stream list from ffprobe, and
   * any ffmpeg run fails as it would on a broken file. `handle` makes the
   * tool available and answers each `tools.run` with the handler's result;
   * a thrown `HostError` makes the run reject with that code. `calls`
   * records every run with its arguments.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.tools.handle("ffprobe", (args) => {
   *   assert.ok(args.includes("-show_streams")); // what the plugin asked for
   *   return { stdout: JSON.stringify({ streams: [] }) }; // a file with no streams
   * });
   * // Every ffmpeg run rejects with code `failed`.
   * host.tools.handle("ffmpeg", () => {
   *   throw new HostError("failed", "Invalid data found when processing input");
   * });
   * await host.command("probe").run();
   * assert.equal(host.tools.calls[0]?.tool, "ffprobe");
   * ```
   */
  readonly tools = {
    /** Every run: the tool name and its arguments, newest last. */
    calls: [] as {
      /** `"ffmpeg"` or `"ffprobe"`. */
      tool: string;
      /** The arguments, as passed to `tools.run`. */
      args: string[];
    }[],
    /** @internal The installed handlers by tool; use `handle()`. */
    handlers: new Map<
      string,
      (
        args: string[],
      ) =>
        | { stdout?: Uint8Array | string; stderr?: string }
        | Promise<{ stdout?: Uint8Array | string; stderr?: string }>
    >(),
    /**
     * Make `tool` available and answer each run with `handler(args)`. Return
     * `{ stdout?, stderr? }` (a string `stdout` is UTF-8 encoded), or throw a
     * {@link HostError} to fail the run with that code. A later call
     * replaces the handler.
     */
    handle(
      tool: "ffmpeg" | "ffprobe",
      handler: (
        args: string[],
      ) =>
        | { stdout?: Uint8Array | string; stderr?: string }
        | Promise<{ stdout?: Uint8Array | string; stderr?: string }>,
    ) {
      this.handlers.set(tool, handler);
    },
  };
  /**
   * Paths given to `system.reveal` / `system.openPath`, newest last; inject
   * failures with `host.handle("system.openPath", …)`.
   */
  readonly system = {
    /** Paths given to `system.reveal`, newest last. */
    revealed: [] as string[],
    /** Paths given to `system.openPath`, newest last. */
    opened: [] as string[],
    /** `system.openUrl` addresses, newest last. */
    urls: [] as string[],
  };
  /** @internal Local processes, faked: see {@link TestHost.tools}. */
  readonly local: LocalServices = {
    download: async (url) => {
      const file = this.remoteImages.get(url);
      if (!file) throw new HostError("failed", `no test image for ${url}`);
      return new Uint8Array(readFileSync(file));
    },
    locate: async (tool) =>
      this.tools.handlers.has(tool) ? `/test-host/${tool}` : null,
    run: async (path, args, options) => {
      const tool = path.split("/").pop()!;
      const handler = this.tools.handlers.get(tool);
      if (!handler) throw new HostError("unavailable", `${tool} was not found`);
      this.tools.calls.push({ tool, args });
      if (options.signal.aborted) {
        const error = new HostError("aborted", "aborted");
        error.name = "AbortError";
        throw error;
      }
      const result = await handler(args);
      const stdout =
        typeof result.stdout === "string"
          ? new Uint8Array(Buffer.from(result.stdout))
          : (result.stdout ?? new Uint8Array());
      if (stdout.length > options.maxOutput)
        throw new HostError(
          "invalid",
          `output exceeds ${options.maxOutput} bytes`,
        );
      return { stdout, stderr: result.stderr ?? "" };
    },
  };
  /** Every `panel.showMenu`, newest last. */
  readonly menus: {
    /** Command ids, `null` for a separator. */
    items: (string | null)[];
    /** `at.x`, in window coordinates. */
    x: number;
    /** `at.y`, in window coordinates. */
    y: number;
  }[] = [];

  // ------------------------------------------------------------ round 3b

  /**
   * Timeline layers by plugin id (this plugin's is `manifestId`) and the
   * merged list `plugin.timeline.marks` reads. A new source clears them.
   */
  readonly timeline = {
    /** Each plugin's layer by plugin id; layers with no marks are absent. */
    layers: new Map<
      string,
      {
        /** Seconds from the start. */
        time: number;
        /** `"chapter"`, `"bookmark"` or `"marker"`. */
        kind: string;
        /** The mark's title, `null` without one. */
        title: string | null;
      }[]
    >(),
    /** Every layer merged, sorted by time, with the publishing plugin's id. */
    get marks() {
      return [...this.layers]
        .flatMap(([plugin, marks]) =>
          marks.map((mark) => ({
            ...mark,
            /** The manifest id of the plugin that published the mark. */
            plugin,
          })),
        )
        .sort((a, b) => a.time - b.time);
    },
    /**
     * Each plugin's ranges by plugin id; layers without ranges are absent.
     */
    rangeLayers: new Map<
      string,
      {
        /** Seconds from the start. */
        start: number;
        /** Seconds from the start, after `start`. */
        end: number;
        /** `"selection"` or `"region"`. */
        style: string;
        /** The range's title, `null` without one. */
        title: string | null;
      }[]
    >(),
    /** Every layer's ranges merged, sorted by start, with the plugin's id. */
    get ranges() {
      return [...this.rangeLayers]
        .flatMap(([plugin, ranges]) =>
          ranges.map((range) => ({
            ...range,
            /** The manifest id of the plugin that published the range. */
            plugin,
          })),
        )
        .sort((a, b) => a.start - b.start);
    },
  };
  /**
   * Simulate another plugin publishing its timeline ranges (or clearing
   * them with `[]`); pushes `timeline.changed` when the plugin subscribed.
   *
   * @param pluginId - The other plugin's manifest id.
   * @param ranges - All its ranges.
   *
   * @example Let another plugin publish a clip range
   * The plugin under test sees a range another plugin put on the seek bar:
   * `setTimelineRanges` stores that plugin's ranges and pushes
   * `timeline.changed`, and `settle()` lets it arrive.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setTimelineRanges("community.clips", [
   *   { start: 40, end: 52.5, style: "selection", title: "Clip" },
   * ]);
   * await host.settle();
   * assert.equal(plugin.timeline.ranges[0]?.plugin, "community.clips");
   * ```
   *
   * @capability None.
   * @since 1.6.9
   */
  setTimelineRanges(
    pluginId: string,
    ranges: {
      start: number;
      end: number;
      style: string;
      title?: string | null;
    }[],
  ) {
    return setTimelineRanges(this, this.#inner, pluginId, ranges);
  }
  /**
   * Simulate another plugin publishing its timeline layer (or clearing it
   * with `[]`); pushes `timeline.changed` when the plugin subscribed.
   *
   * @param pluginId - The other plugin's manifest id.
   * @param marks - Its whole layer.
   *
   * @example Let another plugin publish chapters
   * The plugin under test sees two chapter marks another plugin put on the
   * timeline. `setTimelineLayer` stores that plugin's whole layer and pushes
   * `timeline.changed`; once the plugin uses `plugin.timeline` (with
   * `events`) the SDK keeps `marks` current from that event, and `settle()`
   * lets it arrive.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setTimelineLayer("community.chapters", [
   *   { time: 0, kind: "chapter", title: "Intro" },
   *   { time: 95, kind: "chapter", title: "Part 1" },
   * ]); // replaces that plugin's whole layer; [] would clear it
   * await host.settle();
   * assert.equal(plugin.timeline.marks.length, 2);
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  setTimelineLayer(
    pluginId: string,
    marks: { time: number; kind: string; title?: string | null }[],
  ) {
    return setTimelineLayer(this, this.#inner, pluginId, marks);
  }

  /**
   * Runtime images written to views (`plugin.ui.image`,
   * `plugin.ui.remoteImage`), whole values and images nested in rows, newest
   * last. The SDK refuses images of released scopes before anything is sent.
   * The test host does not read the files, so it does not check the player's
   * per-view budget (`IMAGE_LIMITS.viewBytes`).
   */
  readonly images: {
    /** The image file's path, as given to `ui.image`. */
    path: string;
    /** The SDK's reference number for that `ImageRef`. */
    ref: number;
    /** Its `maxSide` option, when given. */
    maxSide?: number;
  }[] = [];
  /**
   * The file an image property shows, or `null` when the value is not a
   * runtime image. View properties hold images in their wire form; this
   * reads the path back.
   *
   * @example Check which file a window shows as its cover
   * The test checks that the Cover window's image comes from the plugin's
   * data directory. An image property holds the SDK's wire form of
   * `plugin.ui.image(path)`, not a path; `imagePath` reads the path back.
   * ```ts
   * import assert from "node:assert/strict";
   * import { join } from "node:path";
   * declare const host: TestHost;
   * // ---cut---
   * assert.equal(
   *   host.imagePath(host.window("cover").props["cover"]),
   *   join(plugin.dataDirectory, "cover.png"),
   * );
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  imagePath(value: Json | undefined): string | null {
    const image = value as { $vestraImage?: unknown } | null | undefined;
    return image &&
      typeof image === "object" &&
      typeof image.$vestraImage === "string"
      ? image.$vestraImage
      : null;
  }

  // ------------------------------------------------------------ round 3b batch 2

  /** `drops.provide` registrations of this plugin, in order (`id` is the SDK's). */
  readonly dropProviders: {
    /** The SDK's provider id. */
    id: string;
    /** The extensions it takes (lower case, `"folder"` for directories). */
    extensions: string[];
  }[] = [];
  /** The panel has an `onDrop` listener. */
  panelDrops = false;
  /**
   * Drop files like the player: on a panel with an `onDrop` listener the
   * whole list goes there; otherwise (and on the video area) each path goes
   * to the first provider of its extension (`folder` for existing
   * directories), one call per provider with all of its paths.
   * Files nobody takes are ignored. Resolves once the host is idle again.
   *
   * @param paths - The dropped paths, in the order the file manager gives.
   * @param options - `target`: `"video"` (default) or `"panel"`; `at`: the
   *   drop point in panel coordinates (default `{ x: 0, y: 0 }`);
   *   `modifiers`: keys held (default all `false`).
   *
   * @example Drop files on the video and on the panel
   * The first drop lands on the video area: each extension belongs to the
   * provider that registered it first, and each provider gets one call with
   * all of its paths. The second lands on the panel at a point, with Alt
   * held, and the panel's `onDrop` gets the whole list. `drop` resolves
   * once the host is idle.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * await host.drop(["/media/a.srt", "/media/b.mkv"]); // on the video area
   * // On the panel, 10 px from its left and 48 px from its top, Alt held.
   * await host.drop(["/media/list.m3u"], {
   *   target: "panel",
   *   at: { x: 10, y: 48 },
   *   modifiers: { alt: true },
   * });
   * ```
   *
   * @capability None.
   * @throws Never: files nobody takes are ignored, as in the player.
   * @since 1.0.0
   */
  drop(
    paths: string[],
    options: {
      target?: "video" | "panel";
      at?: { x: number; y: number };
      modifiers?: Partial<{ alt: boolean; shift: boolean; cmd: boolean }>;
    } = {},
  ) {
    return drop(this, this.#inner, paths, options);
  }
  /** The palette (`plugin.appearance.theme`); `setAppearance` changes it elsewhere. */
  appearance: ThemeId = "vestra";
  /**
   * Simulate another plugin switching the palette: updates
   * {@link TestHost.appearance} and pushes `appearance.changed`.
   *
   * @capability None.
   *
   * @example Simulate another plugin switching to the light palette
   * The plugin hears the palette change. The host updates `appearance` and
   * pushes `appearance.changed` to a plugin that listens with `events`.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const themes: string[] = [];
   * plugin.player.on("appearance.changed", ({ theme }) => themes.push(theme)); // subscribes (`events`)
   * host.setAppearance("vestra-light");
   * await host.settle();
   * assert.deepEqual(themes, ["vestra-light"]);
   * ```
   *
   * @since 1.0.0
   */
  setAppearance(theme: ThemeId) {
    this.appearance = theme;
    this.emit("appearance.changed", { theme });
  }
  /**
   * Settings pages by id (`plugin.settings.page`), every `show` (page id or
   * null), and the page the options window shows.
   */
  readonly settings = {
    /** Registered pages by page id. */
    pages: new Map<
      string,
      {
        /** The page's settings category. */
        category: string;
        /** The page title. */
        title: string;
        /** The page order within its category. */
        order: number;
        /** The `.slint` file (package-relative). */
        file: string;
        /** The exported component the SDK found. */
        component: string;
        /** The exported global (the page's bridge) the SDK found. */
        global: string;
        /** The page's properties by Slint (kebab-case) name. */
        props: Record<string, Json>;
        /** Fire one of the page's callbacks. */
        emit(callback: string, ...args: Json[]): void;
      }
    >(),
    /** Every `settings.show(pageId)`: the page id, `null` when omitted. */
    shows: [] as (string | null)[],
    /** The page the options window shows, `null` before any `show`. */
    current: null as string | null,
    /** Whether the options window is open. */
    open: false,
  };
  /**
   * One settings page by id. Throws when it was never registered.
   *
   * @example Change a value on the plugin's settings page
   * The test sets the step on the General page and checks the page shows
   * it. `emit` fires the page's callback as the user's input would; the
   * plugin's handler stores the value and its `bind` function sends it back
   * as a property, which `settle()` waits for.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const page = host.settingsPage("general");
   * page.emit("setStep", 10);
   * await host.settle();
   * assert.equal(page.props["step"], 10);
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  settingsPage(id: string) {
    const page = this.settings.pages.get(id);
    if (!page) throw new Error(`settings page ${id} is not registered`);
    return page;
  }
  /** The backdrop: who mounted it and whether it shows (`panels.backdrop.state`). */
  backdrop: {
    /** The manifest id of the plugin that mounted it. */
    owner: string;
    /** Whether it shows now (no video frame). `true` when mounted. */
    effective: boolean;
  } | null = null;
  /**
   * Simulate the backdrop's `effective` changing (`false`: a video frame
   * appeared; `true`: there is none again); pushed to the plugin.
   *
   * @capability None.
   *
   * @example Make a video picture replace the backdrop
   * The plugin's backdrop hears that a video frame now covers it. `false`
   * means a picture appeared; the change is pushed like the player's
   * `window.state`.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setBackdropEffective(false);
   * await host.settle();
   * assert.equal(plugin.panels.backdrop.state?.effective, false);
   * ```
   *
   * @since 1.0.0
   */
  setBackdropEffective(effective: boolean) {
    if (this.backdrop) this.backdrop.effective = effective;
    this.emit("window.state", windowFacts(this, this.#inner));
  }

  /**
   * Simulate another plugin mounting a panel, before or after the plugin
   * under test, as the player handles it: in the sidebar it is another tab
   * (after the existing ones; the first panel's tab is current); the bottom
   * bar and the backdrop take one panel, so the plugin's own mount there
   * then rejects with `conflict` (not an activation failure, as in the
   * player). Pushed as a `window.state` change.
   *
   * @param slot - The position.
   * @param plugin - The other plugin's manifest id.
   * @param options - `title`: its tab label (default: `plugin`).
   *
   * @example Put the playlist next to this plugin's sidebar panel
   * The sidebar ends up with two tabs: the playlist, mounted first, and the
   * plugin's own panel after it. `mountOther` before `startPlugin` mounts
   * another plugin's panel as the player would, so the plugin's mount
   * during activation becomes the second tab (in the bottom bar or the
   * backdrop it would be refused with `conflict` instead).
   * ```ts
   * import assert from "node:assert/strict";
   * declare function activate(plugin: Plugin): Promise<void>;
   * declare const directory: URL;
   * // ---cut---
   * const host = new TestHost();
   * host.mountOther("sidebar", "vestra.playlist", { title: "播放列表" });
   * await startPlugin(activate, { host, directory });
   * assert.equal(host.layout.sidebar?.panels?.length, 2);
   * ```
   *
   * @since 1.5.2
   *
   * @capability None.
   */
  mountOther(
    slot: "bottom" | "sidebar" | "adjust" | "backdrop",
    plugin: string,
    options: { title?: string } = {},
  ) {
    return mountOther(this, this.#inner, slot, plugin, options);
  }
  /**
   * Simulate another plugin's panel going away ({@link TestHost.mountOther}):
   * when its tab was current, the next tab (else the previous one) is.
   *
   * @since 1.5.2
   *
   * @capability None.
   *
   * @example Let the playlist's tab go away
   * The other plugin's sidebar tab disappears and the plugin's own tab
   * becomes current. When the removed tab was current, the next tab (else
   * the previous one) becomes current, as in the player.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.unmountOther("vestra.playlist");
   * await host.settle();
   * assert.equal(host.layout.sidebar?.panels?.length, 1);
   * ```
   */
  unmountOther(plugin: string) {
    return unmountOther(this, this.#inner, plugin);
  }
  /**
   * Simulate the user clicking a sidebar tab: `plugin`'s panel (the plugin
   * under test's `manifestId`, or one of {@link TestHost.mountOther})
   * becomes the current tab. Pushed as a `window.state` change.
   *
   * @since 1.5.2
   *
   * @capability None.
   *
   * @example Click another plugin's sidebar tab
   * The user switches the sidebar to the playlist; the plugin's panel is in
   * a background tab now. The change is pushed as `window.state`.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.selectTab("vestra.playlist");
   * await host.settle();
   * assert.notEqual(host.layout.sidebar?.owner, 1); // the plugin under test is owner 1
   * ```
   */
  selectTab(plugin: string) {
    const slot = [this.layout.sidebar, this.layout.adjust].find((each) =>
      each?.panels?.some((entry) => entry.plugin === plugin),
    );
    const panel = slot?.panels?.find((entry) => entry.plugin === plugin);
    if (!slot || !panel) throw new Error(`${plugin} has no tab`);
    slot.owner = panel.owner;
    this.emit("window.state", windowFacts(this, this.#inner));
  }

  /**
   * The display layer (`plugin.video.view()`): who owns it (this plugin is
   * `manifestId`) and the values the player holds.
   */
  readonly videoView: {
    /** The owning plugin's manifest id, `null` while nobody owns it. */
    owner: string | null;
    /** The values the player holds. */
    values: ViewSettings;
  } = {
    owner: null,
    values: { ...VIEW_DEFAULTS },
  };
  /**
   * Simulate another plugin taking the display layer first (the plugin's
   * `video.view()` then fails with `conflict`), or, with `null`, releasing
   * it (values reset to the defaults).
   *
   * @capability None.
   *
   * @example Let another plugin own the display layer
   * The plugin's `video.view()` fails with `conflict` because another plugin
   * took the display layer first. `null` releases it again.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setVideoViewOwner("someone.zoom");
   * const view = plugin.video.view();
   * view.set({ zoom: 2 });
   * await host.settle();
   * assert.equal(view.status.state, "failed");
   * ```
   *
   * @since 1.0.0
   */
  setVideoViewOwner(pluginId: string | null) {
    this.videoView.owner = pluginId;
    if (pluginId === null) this.videoView.values = { ...VIEW_DEFAULTS };
  }
  /**
   * The render options (`plugin.video.render()`): who owns them, the values
   * the player holds, and whether it renders on the GPU (`gpu: false` is
   * software rendering, where every `set` fails with `unsupported`).
   */
  readonly videoRender: {
    /** The owning plugin's manifest id, `null` while nobody owns them. */
    owner: string | null;
    /** The values the player holds. */
    values: RenderSettings;
    /**
     * `true`: GPU rendering; `false`: software rendering (`unsupported`).
     * `plugin.app.system()` reports it as `rendering`.
     */
    gpu: boolean;
  } = { owner: null, values: { ...RENDER_DEFAULTS, shaders: [] }, gpu: true };
  /**
   * Simulate another plugin owning the render options (the plugin's
   * `video.render()` then fails with `conflict`), or, with `null`, releasing
   * them (values reset to the defaults).
   *
   * @capability None.
   *
   * @example Let another plugin own the render options
   * The plugin's render options report `conflict` while another plugin owns
   * them; `null` releases them and resets the values to the defaults.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setVideoRenderOwner("someone.hdr");
   * const render = plugin.video.render();
   * render.set({ toneMapping: "bt.2390" });
   * await host.settle();
   * assert.equal(render.status.state, "failed");
   * ```
   *
   * @since 1.0.0
   */
  setVideoRenderOwner(pluginId: string | null) {
    this.videoRender.owner = pluginId;
    if (pluginId === null)
      this.videoRender.values = { ...RENDER_DEFAULTS, shaders: [] };
  }
  /**
   * What the player pushes when mpv cannot compile a shader (code `failed`) or
   * switches to software rendering (`unsupported`, which also sets
   * `videoRender.gpu` to false and `rendering.reason` to `window-fallback` with
   * `message`). Pushed only when this plugin is the owner. `previous-crash` is
   * a shortcut that only sets the handle's status and reaches `onError`: the
   * real player never pushes it, it refuses the `set` request itself. To test
   * that, set {@link TestHost.previousCrash}.
   *
   * @example Make a shader fail to compile
   * The plugin's render options report `failed`, as when mpv rejects a
   * shader. The host pushes the failure only while this plugin owns the
   * render options, which its first accepted `set` made it; the SDK updates
   * the handle's `status` when the push arrives, so the test settles first.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const render = plugin.video.render();
   * render.set({ toneMapping: "bt.2390" }); // makes the plugin the owner
   * await host.settle();
   * host.failVideoRender("failed", "shader compile failed: ERROR: 0:39: ...");
   * await host.settle();
   * assert.equal(render.status.state, "failed");
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  failVideoRender(
    code: "failed" | "unsupported" | "previous-crash",
    message: string,
  ) {
    return failVideoRender(this, this.#inner, code, message);
  }
  /**
   * The shader channel (`plugin.video.shaders(id)`): the lists the player holds
   * for this plugin's handles by id (the real paths, after following links),
   * and how many shaders other plugins hold, which count against
   * {@link VIDEO_PROCESSING_LIMITS}`.shaders` (`limit`). Files must be under
   * {@link TestHost.fileRoots}; under software rendering
   * (`videoRender.gpu = false`) a non-empty list fails with `unsupported`.
   *
   * @since 1.5.39
   */
  readonly videoShaders: {
    /** This plugin's lists by handle id; a cleared handle has none. */
    handles: Map<string, string[]>;
    /** Shaders other plugins hold (0–16). */
    others: number;
  } = { handles: new Map(), others: 0 };
  /**
   * Where the plugin's own files may be: its package directory and its
   * data directory ({@link startPlugin} sets both when the list is still
   * empty). `lut3d` files and shader-channel files outside them fail with
   * `invalid`, as in the player.
   *
   * @since 1.5.39
   */
  fileRoots: string[] = [];
  /**
   * What the player pushes to a shader handle when mpv cannot compile a
   * shader (code `failed`; the player cannot tell whose shader failed, so
   * every handle with shaders hears it) or the player switches to software
   * rendering (`unsupported`; use {@link TestHost.failVideoRender}, which
   * also tells the handles). Pushed only to a handle that holds shaders.
   *
   * `code` (default `failed`) is the error code pushed. `previous-crash` is a
   * shortcut that only sets the handle's status and reaches `onError`: the real
   * player never pushes it, it refuses the `set` request itself after
   * an abnormal end. To test that, set {@link TestHost.previousCrash}.
   *
   * @capability None.
   *
   * @example Make the plugin's shader fail to compile
   * The plugin's shader handle reports `failed`, as when mpv rejects a
   * shader. The host pushes the failure only to a handle that holds
   * shaders, which its accepted `set` made it; the SDK updates the
   * handle's `status` when the push arrives, so the test settles first.
   * ```ts
   * import assert from "node:assert/strict";
   * import { join } from "node:path";
   * import { writeFileSync } from "node:fs";
   * declare const host: TestHost;
   * // ---cut---
   * const file = join(plugin.dataDirectory, "sharpen.glsl");
   * writeFileSync(file, "//!HOOK MAIN\n");
   * const shaders = plugin.video.shaders("sharpen");
   * shaders.set([file]); // the handle now holds a shader
   * await host.settle();
   * host.failVideoShaders("sharpen", "shader compile failed: ERROR: 0:3: ...");
   * await host.settle();
   * assert.equal(shaders.status.state, "failed");
   * ```
   *
   * @since 1.5.39
   */
  failVideoShaders(
    id: string,
    message: string,
    code: "failed" | "previous-crash" = "failed",
  ) {
    return failVideoShaders(this, this.#inner, id, message, code);
  }
  /**
   * Play a run after an abnormal end with plugin shaders on: while set, a
   * non-empty `video.shaders` list and a render options `set` with a non-empty
   * `shaders` list are refused with `previous-crash` and this message; clearing
   * still works. `null` (default): shaders apply.
   *
   * @example Check that the plugin stops retrying while shaders are off
   * The plugin's shader handle turns `failed` with `previous-crash`, as
   * in the player after a crash while plugin shaders were drawing. The
   * player refuses the list itself (and shows its own OSD line), so the
   * plugin should report it once and not set the list again.
   * ```ts
   * import assert from "node:assert/strict";
   * import { join } from "node:path";
   * import { writeFileSync } from "node:fs";
   * declare const host: TestHost;
   * // ---cut---
   * host.previousCrash = "plugin shaders are off for this start";
   * const file = join(plugin.dataDirectory, "sharpen.glsl");
   * writeFileSync(file, "//!HOOK MAIN\n");
   * const shaders = plugin.video.shaders("sharpen");
   * shaders.set([file]); // refused: the previous run ended abnormally
   * await host.settle();
   * assert.equal(shaders.status.state, "failed");
   * ```
   *
   * @since 1.5.54
   */
  previousCrash: string | null = null;
  /**
   * The player's processing (filter) state. Wire-level; may change in minor
   * versions. `resources` holds each `video.filter` / `audio.filter` chain the
   * plugin applied, keyed by the SDK's resource id.
   *
   * @example Check the filter chain the plugin applied
   * After the plugin set its picture chain, the test reads the one chain
   * the host holds and compares its nodes. `resources` keeps each applied
   * `video.filter` / `audio.filter` chain by the SDK's resource id, after
   * the host validated it with the player's value ranges.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const [chain] = [...host.processing.resources.values()];
   * assert.deepEqual(chain?.nodes, [{ kind: "hue", degrees: 30 }]);
   * ```
   */
  readonly processing = {
    /** Increases with every accepted change. */
    configurationRevision: 0,
    /** Set a stage here to simulate a blocked backend (`backend-uncertain`). */
    backendUncertain: {} as Partial<Record<"video" | "audio", string>>,
    /** Applied chains by resource id; an empty chain removes its entry, as in the player. */
    resources: new Map<
      string,
      {
        /** `"video"` or `"audio"`. */
        stage: string;
        /** The chain's revision. */
        revision: number;
        /** The applied nodes. */
        nodes: Json;
        /** The audio delay in milliseconds (audio chains only). */
        offsetMs?: number;
      }
    >(),
    /** Outcomes of processing operations, for the SDK's recovery queries. */
    book: new Map<
      string,
      {
        /** The operation's outcome. */
        status: "completed" | "failed";
        /** The result of a completed operation. */
        result?: Json;
        /** The refusal of a failed operation. */
        error?: {
          /** The error code. */
          code: string;
          /** The error message. */
          message: string;
        };
      }
    >(),
  };
  /**
   * The player's subtitle state: tracks, selection, style layers, fonts and
   * loaded resources. Wire-level shape (may change in minor versions); add
   * tracks to `subtitles.tracks` (entries may carry `codec`, `text`,
   * `streamIndex`) to simulate a source's subtitles.
   */
  subtitles: SubtitleState;
  /** Subtitle uploads in progress, by upload id. Wire-level. */
  readonly uploads = new Map<
    number,
    {
      /** The chunks received so far. */
      bytes: Buffer[];
      /** The announced total size in bytes. */
      expected: number;
      /**
       * The source generation it was begun for; like the player, a new
       * source drops the uploads of the old one.
       *
       * @since 1.5.34
       */
      generation?: number;
    }
  >();
  /** Snapshots taken with `media.capture`, by snapshot id. Wire-level. */
  readonly snapshots = new Map<number, Json>();
  /**
   * Every `jobs.start` request (`kind`, `destination`, `quality`, …),
   * newest last: a snapshot's (`snapshotId`) or, since 1.7.8, an export of
   * remembered files' parts (`parts`), whose job runs half way through its
   * middle part (`progress.part`), then completes (a copy's destination gets
   * the extension of its container).
   */
  readonly exports: Record<string, Json>[] = [];
  /**
   * Local files as the fake player knows them, by path, for
   * `plugin.media.sources` and exports of their parts. A file not listed is a 1080p 30 fps
   * H.264 file with AAC stereo 48 kHz sound, as long as the current
   * source. Set `status` to `missing` or `changed` to stand for a moved or
   * rewritten file; `video: null` or `audio: null` for a file without one.
   *
   * @example A second file that a copy cannot join to the first
   * The plugin's list gets a part of a 4K file, then one of a 1080p file:
   * the check then says `size` and the job has to re-encode.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.mediaFiles.set("/media/b.mp4", {
   *   duration: 30,
   *   video: { codec: "h264", width: 1920, height: 818, fps: 30, pixelFormat: "yuv420p" },
   * });
   * host.setSource({ phase: "ready", source: "/media/b.mp4", duration: 30 });
   * ```
   *
   * @since 1.7.8
   */
  readonly mediaFiles = new Map<
    string,
    {
      /** Seconds; default the current source's duration (60 without one). */
      duration?: number;
      /** `ok` (default), `missing` or `changed`. */
      status?: "ok" | "missing" | "changed";
      /**
       * Stands for the file's size and modification time (default 0): a
       * reference made at another version reads `changed`, and
       * `remember` gives a new token for the file at a new version, as
       * the player does for a rewritten file.
       *
       * @since 1.7.8
       */
      version?: number;
      /** The video stream; `null` for none. */
      video?: {
        /** FFmpeg's codec name. */
        codec: string;
        /** Pixels. */
        width: number;
        /** Pixels. */
        height: number;
        /** Frames per second. */
        fps: number;
        /** FFmpeg's pixel format. */
        pixelFormat: string | null;
      } | null;
      /** The audio stream; `null` for none. */
      audio?: {
        /** FFmpeg's codec name. */
        codec: string;
        /** Samples per second. */
        sampleRate: number;
        /** Channel count. */
        channels: number;
      } | null;
    }
  >();
  /**
   * Every `plugin.media.sources.open` the plugin made (its token and
   * start, 0 for the beginning), newest last. Each opens the token's path
   * as an ordinary open: `source` becomes that path, `position` the start.
   *
   * @since 1.7.8
   */
  readonly sourceOpens: {
    /** The token opened. */
    token: string;
    /** Seconds it started at. */
    start: number;
  }[] = [];
  /**
   * The plugin's source references (`plugin.media.sources`) by token: the
   * path each stands for. `locate` takes its answer from
   * {@link TestHost.dialogAnswers}. Wire-level.
   *
   * @since 1.7.8
   */
  readonly sourceReferences = new Map<
    string,
    {
      /** The file's path (never shown to the plugin). */
      path: string;
      /** The file's `mediaFiles` version when it was remembered. */
      version?: number;
    }
  >();
  /**
   * Export jobs by job id. Each state query advances a job one step
   * (`queued` → `running` → `completed`; `cancelling` → `cancelled`).
   * A running clip reports half its `progress`; a finished clip's
   * `outcome` has `start` and `end` (a stream copy starts 1 s before the
   * snapshot time, as if snapped to a keyframe, and its destination gets
   * the extension of its container: `.mkv` for `container: "mkv"`, else
   * `.mp4`). Wire-level.
   */
  readonly jobs = new Map<number, MediaJob>();
  /**
   * Set it to make every running export end `failed` with this error on
   * its next state query, as the player reports one (`unsupported` for a
   * stream copy it cannot make, `export-failed` otherwise); `null` (the
   * default) completes them.
   *
   * @since 1.6.10
   */
  exportFailure: {
    /** The `outcome.error.code`. */
    code: string;
    /** The `outcome.error.message`. */
    message: string;
  } | null = null;

  /**
   * `openStream`'s transport: a local stream (a Unix socket on macOS and
   * Linux, a named pipe on Windows) or, with `"tcp"`, loopback TCP where the
   * plugin must send the token first, as the player on Windows answers.
   * Set it before the plugin calls `openStream`.
   */
  producerTransport: "unix" | "tcp" = "unix";
  /**
   * Generated streams (`player.openStream`) by producer id: the fake player
   * end of each frame connection. Wire-level beyond the
   * {@link FakeProducer} fields.
   */
  readonly producers = new Map<
    number,
    FakeProducer & {
      /** The listening server for the frame connection. */
      server: Server;
      /** The Unix socket path (unused with TCP). */
      path: string;
      /** TCP: the connection sent the right token (always true for Unix). */
      admitted: boolean;
      /** The current start/stop control epoch. */
      epoch: number;
      /** A control waiting for the plugin's acknowledgement, or `null`. */
      pending: Json | null;
      /** Whether the last control was acknowledged. */
      acknowledged: boolean;
      /** Whether the stream is producing (selected and started). */
      active: boolean;
    }
  >();
  /** Registered source resolvers (`resolvers.add`) by id: their declarations. */
  readonly resolvers = new Map<string, Json>();
  /**
   * Resolvers other plugins hold, as `resolvers.add` declares them plus the
   * holder's id: a registration of this plugin that claims one of their
   * extensions (or scheme + host pairs) is refused with `conflict`, which
   * does not fail activation, like the player.
   *
   * @example Start with another plugin holding a file type
   * The plugin starts in a player where another plugin already resolves
   * `.ch8` files. Pushed before `startPlugin`, the entry makes the plugin's
   * own resolver for `.ch8` fail with `conflict` during activation, which
   * (as in the player) does not fail the activation.
   * ```ts
   * const host = new TestHost();
   * host.otherResolvers.push({ owner: "example.emulator", extensions: ["ch8"] });
   * ```
   */
  readonly otherResolvers: {
    /** The manifest id of the plugin holding them (shown in the refusal). */
    owner: string;
    /** File extensions it resolves (a file resolver), lower case, no dot. */
    extensions?: string[];
    /** URL schemes it resolves (a web resolver), with `hosts`. */
    schemes?: string[];
    /** Exact host names it resolves (a web resolver), with `schemes`. */
    hosts?: string[];
  }[] = [];
  /**
   * The list `resolvers.fileTypes` carries: the extensions of this
   * plugin's file resolvers and of {@link TestHost.otherResolvers}, sorted,
   * each once.
   *
   * @capability None.
   *
   * @example Check the file types a resolver adds
   * The test checks the list the plugin will hear in
   * `resolvers.fileTypes`: the extensions of its own file resolvers and of
   * `otherResolvers`, sorted, each once.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * assert.deepEqual(host.fileTypes(), ["ch8"]);
   * ```
   *
   * @since 1.5.8
   */
  fileTypes(): string[] {
    const types = new Set<string>();
    for (const declaration of [
      ...this.resolvers.values(),
      ...this.otherResolvers,
    ] as { extensions?: string[] }[])
      for (const type of declaration.extensions ?? []) types.add(type);
    return [...types].sort();
  }

  /**
   * Push `resolvers.fileTypes` when {@link TestHost.fileTypes} changed:
   * called after this plugin's resolvers come and go; call it yourself
   * after changing {@link TestHost.otherResolvers} (another plugin started
   * or stopped).
   *
   * @example Let another plugin's file type appear while running
   * Another plugin starts and adds `.ch8`; the plugin under test, which
   * listens with `player.on("resolvers.fileTypes")`, then hears it.
   * Changing `otherResolvers` alone pushes nothing: `updateFileTypes` sends
   * the new list as the player does when a plugin starts or stops, and
   * `settle()` lets the listener run.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const heard: string[][] = [];
   * // A listener of the event (`events`): each list the player sends.
   * plugin.player.on("resolvers.fileTypes", ({ fileTypes }) => heard.push(fileTypes));
   * // Another plugin starts with a resolver for .ch8 files.
   * host.otherResolvers.push({ owner: "example.emulator", extensions: ["ch8"] });
   * host.updateFileTypes();
   * await host.settle();
   * assert.deepEqual(heard, [["ch8"]]);
   * ```
   *
   * @capability None.
   * @since 1.5.8
   */
  updateFileTypes() {
    const types = this.fileTypes();
    if (JSON.stringify(types) === this.#inner.sentTypes) return;
    this.#inner.sentTypes = JSON.stringify(types);
    this.emit("resolvers.fileTypes", { fileTypes: types });
  }
  /**
   * File opens waiting for this plugin's file resolver (`extensions`), by
   * request id: the path and how it was opened. Opening a matching path
   * (`player.open`, {@link TestHost.openElsewhere}) sends
   * `source.resolveRequest`; the answer selects the stream, fails the open
   * or, once the source changed, is `stale`. Any later source change
   * cancels it (`source.resolveCancel`). Web resolvers are not simulated:
   * emit `source.resolveRequest` yourself.
   */
  readonly resolutions = new Map<
    number,
    {
      /** The id of this plugin's resolver asked (`resolvers.add` `id`). */
      resolverId: string;
      /** The path being opened, as sent to `resolve`. */
      source: string;
      /** The open asked for a paused start (`player.open(path, { paused })`). */
      paused: boolean;
    }
  >();
  /**
   * Answers for `dialogs.open` (paths, `null` = cancelled) and
   * `dialogs.confirm` (`{ confirmed, checked }`), consumed in order. A
   * dialog with no queued answer, or with the wrong kind, fails the request
   * (as a lost reply).
   *
   * For `openFile` / `openDirectory` / `saveFile` queue a one-path array;
   * for `openFiles` any number of paths.
   *
   * @example Answer the plugin's dialogs in advance
   * The plugin's Open command gets a picked file, then a cancelled file
   * dialog, then a confirmed question. All answers share one queue, taken
   * from the front in the order the plugin opens dialogs of any kind: if
   * the next queued answer is missing or of the wrong kind, the dialog
   * fails like a lost reply, so queue them in the order the plugin asks.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.dialogAnswers.push(["/media/movie.mkv"]); // openFile picks it
   * host.dialogAnswers.push(null); // the next file dialog is cancelled
   * host.dialogAnswers.push({ confirmed: true, checked: false }); // confirm
   * await host.command("open").run();
   * ```
   */
  readonly dialogAnswers: (
    | string[]
    | null
    | {
        /** The user clicked the confirm button. */
        confirmed: boolean;
        /** The checkbox state. */
        checked: boolean;
      }
  )[] = [];
  /** Every `dialogs.confirm` request (its options), newest last. */
  readonly confirms: Record<string, Json>[] = [];
  /**
   * The main window as the player would show it. Change it with
   * `setMainWindow` (the user resized or maximized it, entered fullscreen,
   * closed the picture-in-picture window); `onTop`, `cursorAutoHide` and
   * `pictureInPicture.active` record the plugin's `window.set…` calls.
   * `pictureInPicture.supported: false` stands for Windows and Linux.
   */
  readonly mainWindow = {
    /** Whether the main window is fullscreen. */
    fullscreen: false,
    /**
     * Whether the main window is maximized (default `false`). Like the
     * player, `window.state` reports `false` while fullscreen and this
     * value again after leaving it.
     *
     * @since 1.5.52
     */
    maximized: false,
    /** The video area in logical points (default 780×609). */
    videoArea: {
      /** Width in logical points. */
      width: 780,
      /** Height in logical points. */
      height: 609,
    },
    /** The effective `window.setAlwaysOnTop` value. */
    onTop: false,
    /** The effective `window.setCursorAutoHide` mode. */
    cursorAutoHide: "fullscreen" as "fullscreen" | "playing",
    /** Picture-in-picture: `supported` (preset) and `active`. */
    pictureInPicture: {
      /** Set to `false` to simulate Windows or Linux. */
      supported: true,
      /** Whether the picture-in-picture window shows the video. */
      active: false,
    },
  };
  /**
   * The player's secret store for this plugin: name → value. Preset entries
   * to simulate stored secrets; inject failures with
   * `host.handle("secrets.get", ...)`. Like the player, `secrets.set` of a
   * new name fails `limit` once 256 names are stored.
   */
  readonly secrets = new Map<string, string>();
  /**
   * `plugin.storage.session`: key → value, as the player keeps them. Preset
   * entries to simulate values an earlier run of the plugin stored in the
   * same player session, or pass `startPlugin(..., { sessionStorage })`.
   * Like the player, a key is 1–1024 bytes, a `set` that would make the
   * entries larger than 1 MiB (keys, values as compact JSON and
   * `SESSION_STORAGE_LIMITS.entryBytes` per key) fails `limit`, and an
   * object's properties are stored sorted, as the player hands them back.
   *
   * @since 1.5.25
   */
  readonly sessionStorage = new Map<string, Json>();
  /**
   * What `plugin.app.system()` reports. Its `rendering` follows
   * {@link TestHost.videoRender | videoRender.gpu} (`"gpu"` or
   * `"software"`), so one switch covers the render options and the fact;
   * its `renderingReason` is {@link TestHost.rendering | rendering.reason}.
   */
  systemInfo: Omit<WireSystemInfo, "rendering" | "renderingReason"> = {
    os: "macos",
    name: "macOS",
    version: "26.2",
    build: "25C56",
    model: "Mac15,6",
    arch: "aarch64",
    displays: [
      {
        name: "Built-in Retina Display",
        width: 3024,
        height: 1964,
        scale: 2,
        refreshRate: 120,
        primary: true,
      },
    ],
  };
  /**
   * What `plugin.app` reports. Set it before {@link startPlugin}: the plugin
   * receives it once at start-up.
   */
  app: {
    /** The player version. */
    version: string;
    /** The short git hash of the build, `null` when unknown. */
    build: string | null;
    /** Component versions. */
    components: {
      /** libmpv's `mpv-version`. */
      mpv: string | null;
      /** `{ ffmpeg: <version> }`. */
      libav: Record<string, string>;
      /** The Slint version. */
      slint: string;
    };
  } = {
    version: "0.1.0",
    build: "test",
    components: {
      mpv: "mpv 0.41.0",
      libav: { ffmpeg: "7.1" },
      slint: "1.18.1",
    },
  };
  /**
   * The player's rendering choice behind `plugin.rendering`. The mode drawing
   * now is {@link TestHost.videoRender | videoRender.gpu}, as for
   * `plugin.app.system()`; the rest is preset here and changed by the plugin's
   * calls, as the player would:
   *
   * - `setPreference` saves `preference` and never changes the mode. It
   *   refuses `"gpu"` while `gpu.available` is false: with `unsupported`
   *   when `gpu.reason.code` is `no-gpu-backend` or `headless`, otherwise
   *   with `unavailable`, the reason's message in both cases.
   * - The next start uses `"software"` for the `"software"` choice, else
   *   software with `gpu.reason` while the GPU is not available, else the
   *   GPU (code `preference` for a `"gpu"` choice, `default` for
   *   `"auto"`). `restartPending` compares that with `startedWith`.
   * - `restartPlayer` counts in `restarts` and leaves the plugin running
   *   (call `stop()` yourself); a second one rejects with `busy`, as a
   *   restart is then under way.
   *
   * Inject other refusals (`failed` for an unwritable settings file or a
   * new process that could not start) with `host.handle("rendering.setPreference", …)`
   * or `host.handle("rendering.restart", …)`. The defaults are a macOS
   * player on the GPU: `"auto"`, available, started on the GPU.
   *
   * @example Test a GPU switch on a system without a GPU renderer
   * The plugin's GPU menu item is greyed out with the player's reason when
   * the GPU cannot be chosen. The host is preset before the plugin starts,
   * because the plugin reads the state while activating; software
   * rendering is `videoRender.gpu = false`, and `gpu` says why the GPU
   * cannot be chosen.
   * ```ts
   * import assert from "node:assert/strict";
   * import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
   * import activate from "../main.ts";
   *
   * const host = new TestHost();
   * host.videoRender.gpu = false; // software draws now (Linux)
   * host.rendering.startedWith = "software";
   * host.rendering.reason = { code: "no-gpu-backend", message: "this player has no GPU renderer on Linux yet" };
   * host.rendering.gpu = { available: false, reason: host.rendering.reason };
   * const { stop } = await startPlugin(activate, {
   *   directory: new URL("..", import.meta.url),
   *   host,
   * });
   * const item = host.command("gpu-rendering");
   * assert.equal(item.state.enabled, false);
   * assert.equal(item.state.reason, "this player has no GPU renderer on Linux yet");
   * await stop();
   * ```
   *
   * @since 1.5.35
   */
  readonly rendering: {
    /** Why the mode drawing now is what it is (`RenderingState.reason`, `SystemInfo.renderingReason`). */
    reason: RenderingReason;
    /** The saved choice: `"auto"`, `"gpu"` or `"software"`. */
    preference: RenderingPreference;
    /** The mode this run started with; `restartPending` compares the next start's mode with it. */
    startedWith: RenderingMode;
    /** Whether the plugin may choose `"gpu"`, and why not (`null` while available). */
    gpu: {
      /** `false`: `setPreference("gpu")` is refused. */
      available: boolean;
      /** Why the GPU cannot be chosen; `null` while it can. */
      reason: RenderingReason | null;
    };
    /** Accepted `restartPlayer` calls. */
    restarts: number;
  } = {
    reason: { code: "default", message: "nothing rules GPU rendering out" },
    preference: "auto",
    startedWith: "gpu",
    gpu: { available: true, reason: null },
    restarts: 0,
  };
  /**
   * The GPU's video upscaler behind `plugin.video.upscaling`, answered as the
   * player would:
   *
   * - `state()` and `set(true)` set `checked` (the player's one GPU check; a
   *   plugin that should not wake the GPU while it starts can assert it is
   *   still `false`) and report `available` from `reason` (`null`: it
   *   works), this plugin's `enabled`, and `requested` with `factor` while
   *   enabled, available and `factor` is above 1.
   * - `set(true)` refuses with `unsupported` and the reason's message while
   *   `reason` is set, unless its code is `decoding`, or `rendering` with
   *   `renderingStarting` (GPU rendering still starting): those can pass
   *   during the run, so the player keeps the request. Nothing changes when
   *   it refuses.
   * - `set(false)` always succeeds and does not check the GPU: before any
   *   check it reports `available: false` with the reason `unchecked`.
   *
   * Inject other answers with `host.handle("video.upscaling.set", …)`. The
   * defaults are a player where upscaling works and a 1080p video shown
   * full screen on a 4K display (`factor` 2), whatever `systemInfo` says.
   *
   * @example Test the menu item on a computer without an RTX GPU
   * The plugin's upscaling item is greyed out with the player's reason after
   * the user first picks it. Starting the plugin checks nothing (`checked`
   * stays false, so no GPU wakes up); the first pick reads the state, and
   * `set(true)` would reject with `unsupported`, as in the player.
   * ```ts
   * import assert from "node:assert/strict";
   * import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
   * import activate from "../main.ts";
   *
   * const host = new TestHost();
   * host.upscaling.reason = { code: "no-gpu", message: "no NVIDIA GPU" };
   * const { stop } = await startPlugin(activate, {
   *   directory: new URL("..", import.meta.url),
   *   host,
   * });
   * assert.equal(host.upscaling.checked, false); // starting woke no GPU
   * const item = host.command("upscaling");
   * await item.run(); // the first pick checks the GPU
   * assert.equal(item.state.enabled, false); // greyed out
   * assert.equal(item.state.reason, "no NVIDIA GPU"); // the player's message
   * await stop();
   * ```
   *
   * @since 1.5.37
   */
  readonly upscaling: {
    /** Why upscaling does not work; `null` while it does. */
    reason: UpscalingReason | null;
    /** Whether this plugin has upscaling on (`set`); a test may preset it. */
    enabled: boolean;
    /** The factor the player would request; `null` or at most 1: the video needs no upscaling. */
    factor: number | null;
    /** Whether the plugin made the player check the GPU (`state`, `set(true)`). */
    checked: boolean;
    /** GPU rendering is still starting: a `rendering` reason then lets `set(true)` keep the request. */
    renderingStarting: boolean;
    /** The video's size the state reports; `null`: no video. */
    video: UpscalingVideoSize | null;
    /** The video area the state reports; `null`: none. */
    area: {
      /** Width in physical pixels. */
      width: number;
      /** Height in physical pixels. */
      height: number;
    } | null;
    /** The rendering GPU's name the state reports. */
    gpu: string | null;
    /** mpv's decoder the state reports; `null`: no video. */
    hwdecCurrent: string | null;
  } = {
    reason: null,
    enabled: false,
    factor: 2,
    checked: false,
    renderingStarting: false,
    video: {
      width: 1920,
      height: 1080,
      displayWidth: 1920,
      displayHeight: 1080,
    },
    area: { width: 3840, height: 2160 },
    gpu: "NVIDIA GeForce RTX 4070 Laptop GPU",
    hwdecCurrent: "d3d11va",
  };
  /**
   * Make the upscaler's reason `decoding` with `cause`, with the player's
   * message, and set `upscaling.hwdecCurrent` to match (`d3d11va-copy`, `no`,
   * `nvdec`). `plugins` are named for `copy-back` only, as the player does.
   * Returns the reason; call {@link TestHost.upscalingChanged} to tell a
   * listening plugin.
   *
   * @example Test the window's advice for each cause
   * The plugin's window explains why upscaling waits. The test fakes the
   * copy-back cause that Picture Adjustments' filters cause and checks
   * that the window names the plugin.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.upscalingDecoding("copy-back", [{ id: "vestra.video", name: "Picture Adjustments" }]);
   * host.upscalingChanged();
   * await host.settle();
   * assert.match(String(host.window("upscale").props.blocker), /Picture Adjustments/);
   * ```
   *
   * @capability None.
   * @since 1.5.43
   */
  upscalingDecoding(
    cause: UpscalingDecodingCause,
    plugins: readonly UpscalingPlugin[] = [],
  ): UpscalingReason {
    return upscalingDecoding(this, this.#inner, cause, plugins);
  }
  /**
   * Send `video.upscaling.changed` with the state {@link TestHost.upscaling}
   * describes now (without `enabled`), as the player does when it changes; a
   * plugin listening with `plugin.video.upscaling.onChange` receives it.
   * Nothing reaches a plugin that does not listen.
   *
   * @capability None.
   *
   * @example Show the new factor in the plugin's window
   * The window resized: the test changes the area and the factor, sends
   * the change, and checks that the plugin's window shows the new factor.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.upscaling.area = { width: 2560, height: 1440 };
   * host.upscaling.factor = 1.33; // 1080p in a 1440p area
   * host.upscalingChanged(); // as the player after the resize settled
   * await host.settle();
   * assert.equal(host.window("upscale").props.factor, "×1.33");
   * ```
   *
   * @since 1.5.43
   */
  upscalingChanged() {
    if (!this.subscriptions.has("video.upscaling.changed")) return;
    const { enabled: _, ...state } = upscalingState(this, this.#inner, false);
    this.emit("video.upscaling.changed", state);
  }
  /**
   * Motion smoothing behind `plugin.video.motion`, answered as the player
   * would:
   *
   * - `state()` and `set()` report this plugin's `mode`, the reasons
   *   `double` and `display` (`null`: that mode works) and `active`: the
   *   mode while its reason is `null` and `sourceFps` is known, else
   *   `off`; while active, `searchMode` (`performance` with
   *   `performance`) and `outputFps` (`outputFps`, or twice `sourceFps`).
   * - `set(mode)` refuses with `unsupported` and the reason's message while
   *   that mode's reason is `platform`, `no-gpu`, `runtime`, `filter` or
   *   `rendering` (unless `renderingStarting`): those hold for the run. The
   *   others can pass, so the player keeps the request. `off` always
   *   succeeds; an unknown mode is `invalid`.
   *
   * Inject other answers with `host.handle("video.motion.set", …)`. The
   * defaults are a player where both modes work on a 24 fps video and a
   * 60 Hz display.
   *
   * @example Test the Picture panel on software rendering
   * Match Display needs GPU rendering: the plugin greys it with the
   * player's reason, and Double waits for a rate that fits.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.motion.display = { code: "rendering", message: "Match Display needs GPU rendering" };
   * host.motion.double = { code: "rate", message: "24 fps doubled is 48 fps on a 60 Hz display" };
   * host.motionChanged();
   * await host.settle();
   * assert.equal(host.motion.mode, "off");
   * ```
   *
   * @since 1.7.19
   */
  readonly motion: {
    /** This plugin's mode (`set`); a test may preset it. */
    mode: MotionMode;
    /** Why Double Frame Rate does not work; `null` while it does. */
    double: MotionReason | null;
    /** Why Match Display does not work; `null` while it does. */
    display: MotionReason | null;
    /** GPU rendering is still starting: a `rendering` reason then lets `set` keep the request. */
    renderingStarting: boolean;
    /** The video's rate; `null`: not known yet (nothing is active). */
    sourceFps: number | null;
    /** The measured output rate while active; `null`: twice `sourceFps`. */
    outputFps: number | null;
    /** The faster motion search (the player's first fallback step). */
    performance: boolean;
    /** The display's refresh rate. */
    displayFps: number;
    /** The converting GPU's name; `null`: none. */
    gpu: string | null;
  } = {
    mode: "off",
    double: null,
    display: null,
    renderingStarting: false,
    sourceFps: 24,
    outputFps: null,
    performance: false,
    displayFps: 60,
    gpu: "AMD Radeon 780M Graphics",
  };
  /**
   * Send `video.motion.changed` with the state {@link TestHost.motion}
   * describes now (without `mode`), as the player does when it changes; a
   * plugin listening with `plugin.video.motion("amd").onChange` receives it.
   * Nothing reaches a plugin that does not listen.
   *
   * @capability None.
   *
   * @example The GPU fell behind
   * The player turned the converter off for this video; the plugin's
   * panel shows the reason.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.motion.double = { code: "overload", message: "the GPU could not keep up with this video" };
   * host.motionChanged();
   * await host.settle();
   * ```
   *
   * @since 1.7.19
   */
  motionChanged() {
    if (!this.subscriptions.has("video.motion.changed")) return;
    const { mode: _, ...state } = motionState(this);
    this.emit("video.motion.changed", state);
  }
  /** What `player.chapters()` lists while media is ready. */
  chapters: {
    /** The chapter title, `null` without one. */
    title: string | null;
    /** Start time in seconds. */
    start: number;
  }[] = [];

  /**
   * @internal `startPlugin`'s `disconnect()`: refuse every request, the
   * ones in flight included, as the runner does once the player is gone.
   */
  loseConnection() {
    this.#inner.lost = true;
    this.#inner.lose(new HostError("disabled", "plugin stopped"));
  }

  /**
   * `plugin.dataDirectory`: a fresh empty temporary directory, removed with
   * the host on `stop()`. `plugin.storage.json` reads and writes real files
   * here. Pass `startPlugin(..., { dataDirectory })` to use another one.
   */
  readonly dataDirectory = join(this.#inner.scratch, "data");
  /**
   * The manifest id of the plugin under test (set by {@link startPlugin};
   * `"test.plugin"` by default).
   */
  manifestId = "test.plugin";

  /**
   * A fresh in-memory player: nothing open, no plugin, the player's core
   * actions registered. Preset what the plugin reads during activation, then
   * pass it to {@link startPlugin} as `host`.
   */
  constructor() {
    this.subtitles = {
      presentation: {
        revision: 1,
        referenceHeight: 1080,
        layers: [],
        effective: null,
        confirmation: "applied",
        fonts: [
          {
            id: "sans",
            family: "Sans",
            resolution: "fixedFace",
            snapshotEligible: true,
            digest: "0",
            faceIndex: 0,
          },
        ],
        actualFont: {
          fontId: "sans",
          family: "Sans",
          postscript: "Sans",
          faceIndex: 0,
          digest: "0",
          sizeBytes: 0,
        },
        snapshotEligible: true,
        coverageCheckedOnCapture: true,
      },
      source: { generation: 0, phase: "empty" },
      confirmation: "applied",
      error: null,
      selection: { stamp: { generation: 0, revision: 0 }, target: null },
      tracks: [],
      resources: [],
    };
    // The player always owns these, as `host/<id>` commands.
    registerCoreActions(this, this.#inner);
  }

  // ------------------------------------------------------------ core actions

  /** The `player.setStepSeek` value in effect (default 5). */
  stepSeek = 5;
  /** The `player.setStepSeek` `keyframes` in effect (default `false`). */
  stepSeekKeyframes = false;
  /**
   * Test data: the keyframe times (seconds, ascending) of the current
   * source, for keyframe step seeks. `null` (the default): none modelled,
   * and step seeks are exact even with `stepSeekKeyframes`.
   *
   * @example Step forward to the next keyframe
   * With keyframe step seeks on, Forward from 0:12 lands on the keyframe at
   * 0:20, not at 0:17, and the OSD says so. `keyframes` gives the source's
   * keyframe times; `setStepSeek` turns on keyframe steps of 5 s, and the
   * core action `seek-forward` seeks to the first keyframe at or after
   * the target, as the player does.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setSource({ phase: "ready", duration: 45, position: 12 });
   * host.keyframes = [0, 10, 20, 30, 40];
   * await plugin.player.setStepSeek({ seconds: 5, keyframes: true });
   * await plugin.host.run("seek-forward"); // target 17 s, next keyframe 20 s
   * assert.equal(host.source.position, 20);
   * assert.equal(host.osd.at(-1), "Forward 5 s: 00:20 / 00:45");
   * ```
   */
  keyframes: number[] | null = null;
  /**
   * Every step seek the core ran (`seek-backward` / `seek-forward`, from a
   * key, the menu or `host.run`), newest last: the step, whether it went to
   * a keyframe, and where it landed.
   */
  readonly coreSeeks: {
    /** `seek-backward` or `seek-forward`. */
    action: string;
    /** The step: `host.run`'s `seconds`, else `setStepSeek`'s. */
    seconds: number;
    /** It landed on a keyframe (`stepSeekKeyframes` and keyframes modelled). */
    keyframes: boolean;
    /** The new position. */
    landed: number;
  }[] = [];
  /**
   * Every seek a plugin submitted (`player.seek`, `Scrub.seek`), newest
   * last, with the mode it asked for. The test host lands on the exact
   * target either way (the player lands a `keyframes` seek on the last
   * keyframe at or before it); the core's step seeks are in `coreSeeks`.
   */
  readonly seeks: {
    /** The target. */
    seconds: number;
    /** `Scrub.seek(seconds, { keyframes: true })`. */
    keyframes: boolean;
  }[] = [];
  /**
   * Every `player.step` and core frame step, newest last. The position does
   * not move, except a step back after the end: like the player, a seek
   * that stays paused, one frame back (`stats` fps, else 30) for a frame,
   * to the last {@link TestHost.keyframes | keyframe} before the position
   * (none modelled: 1 ms back) for a keyframe. A keyframe step forward
   * after the end goes nowhere.
   */
  readonly steps: {
    /** `"frame"` or `"keyframe"`. */
    unit: string;
    /** `"backward"` or `"forward"`. */
    direction: string;
  }[] = [];
  /** Every core action run (`host.run`, a core command, a pressed core binding), newest last. */
  readonly coreRuns: string[] = [];

  // ------------------------------------------------------------ built-in only

  /**
   * The plugin is built into the player (`startPlugin`'s `builtin`). Only
   * then does the host take the built-in-only capabilities
   * (`commands.run`, `palette.lead`); otherwise their calls fail with
   * `capability`, as in the player.
   *
   * @since 1.7.9
   */
  builtin = false;
  /**
   * The palette's lead row as the plugin last set it (`palette.lead.set`,
   * wire form), `null` without one. Wire-level.
   *
   * @since 1.7.9
   */
  paletteLead: Record<string, Json> | null = null;
  /**
   * Simulate the user activating the palette's lead row: Enter (`keep`:
   * Shift+Enter) with `query` typed, or Enter on the status row
   * (`status`). Mints a ticket, sends the `palette.lead` event, waits until
   * the host is idle and returns the ticket.
   *
   * Like the player, `commands.run` takes the ticket until
   * `PaletteLead.done` or 120 s after its last run, at most 30 runs, 4 a
   * second, and 120 runs a minute per plugin (`limit`). A command declared
   * `destructive` (and the player's `host/stop` and `host/quit`, and the
   * Settings and Reset menus) is confirmed first: the answer comes from
   * {@link TestHost.dialogAnswers} (`{ confirmed: false, checked: false }`
   * is Don't Run, `confirmed: true` Run, with `checked: true` Run and
   * "Don't ask again", which runs like Run since every command a test host
   * lists is built in). A run with `then` (since 1.7.16) takes one answer
   * for its whole plan and remembers an approved plan for the ticket, as
   * the player does ({@link "@vestra-player/sdk"!CommandRunOptions.then}). Each run adds the
   * command's title (and ` · step/of`) to {@link TestHost.osd}.
   *
   * @param query - What the user typed.
   * @param options - `keep`: Shift+Enter; `status`: the status row.
   * @returns The ticket of this user action.
   *
   * @example Test a request that runs a destructive command
   * The user asks the plugin to stop playback and declines the
   * confirmation. `builtin` lets the plugin hold the lead; the ticket
   * minted here is what its listener passes to `commands.run`, and the
   * queued answer declines the player's alert for `host/stop`. One answer
   * covers a request whose first run names the rest of its plan in `then`.
   * ```ts
   * import assert from "node:assert/strict";
   * import { startPlugin } from "@vestra-player/sdk/testing";
   * import activate from "../main.ts";
   *
   * const { host, stop } = await startPlugin(activate, {
   *   directory: new URL("..", import.meta.url),
   *   builtin: true, // as a plugin built into the player
   * });
   * host.dialogAnswers.push({ confirmed: false, checked: false }); // Don't Run
   * await host.runPaletteLead("stop playback");
   * assert.deepEqual(host.coreRuns, []); // declined: nothing ran
   * await stop();
   * ```
   *
   * @capability None.
   * @throws `Error` without a code (rejects) The plugin has no lead row.
   * @since 1.7.9
   */
  runPaletteLead(
    query: string,
    options: { keep?: boolean; status?: boolean } = {},
  ): Promise<string> {
    return runPaletteLead(this, this.#inner, query, options);
  }

  /**
   * One of the 14 core actions (`play-pause`, `stop`, `seek-forward`, ...)
   * that the test host registers like the player, as `host/<id>`. Throws for
   * an unknown id. `run()` executes it like its menu item: a disabled
   * action rejects with `command`, as in the player (`plugin.host.run`
   * rejects with `unavailable` instead); otherwise it runs with the
   * player's checks and writes its on-screen text to {@link TestHost.osd}.
   *
   * @example Pause through the player's own action
   * The test pauses playback the way the Space key does and checks that the
   * host recorded it. Core actions belong to the player (`host/<id>`);
   * `run()` applies the player's checks, so a source must be ready first,
   * and every run is appended to `coreRuns`.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setSource({ phase: "ready", duration: 100, position: 10 });
   * await host.coreAction("play-pause").run();
   * assert.equal(host.source.paused, true);
   * assert.deepEqual(host.coreRuns, ["play-pause"]);
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  coreAction(id: string): FakeCommand {
    const command = this.coreCommands.get(`host/${id}`);
    if (!command) throw new Error(`no core action ${id}`);
    return command;
  }

  // ------------------------------------------------------------ transport

  /**
   * @internal The transport side the SDK calls: answer one request with the
   * override from {@link TestHost.handle} or the default behaviour.
   */
  async request<T>(method: string, params: Json = {}): Promise<T> {
    // After `disconnect()`: refused as the runner refuses them once the
    // player is gone.
    if (this.#inner.lost) throw new HostError("disabled", "plugin is stopping");
    const record = (params ?? {}) as Record<string, Json>;
    // The plugin runner refuses a request over the message limit before
    // sending it (runtime/runner.ts): the player never sees it.
    const line = JSON.stringify({ id: this.calls.length + 1, method, params });
    if (Buffer.byteLength(line, "utf8") + 1 > MESSAGE_LIMIT)
      throw new HostError(
        "limit",
        `${method}: request exceeds the player's 1 MiB message limit`,
      );
    this.calls.push({ method, params: record });
    this.#inner.inFlight++;
    try {
      await tick();
      if (this.#inner.lost) throw new HostError("disabled", "plugin stopped");
      const handler =
        this.#inner.overrides.get(method) ?? this.#defaults[method];
      if (!handler)
        throw new HostError("unsupported", `test host has no ${method}`);
      const work = Promise.resolve(handler(record));
      // `disconnect()` fails the requests still waiting, as the runner does.
      work.catch(() => {});
      return (await Promise.race([work, this.#inner.gone])) as T;
    } finally {
      this.#inner.inFlight--;
    }
  }
  /** @internal The transport side the SDK calls: listen to a host event. */
  on(event: string, listener: (data: unknown) => void) {
    return on(this, this.#inner, event, listener);
  }

  // ------------------------------------------------------------ test controls

  /**
   * Replace the host's behaviour for one wire method until
   * {@link TestHost.reset}. The handler receives the request parameters and
   * returns the reply (or a promise of it).
   *
   * Throw a {@link HostError} to simulate a definite refusal (the plugin's
   * call rejects with that `code`); throw a plain `Error` to simulate a lost
   * reply (the SDK then runs its recovery path). Method names are protocol
   * names, e.g. `"clipboard.writeText"`, `"secrets.get"`,
   * `"system.openPath"`, `"audio.addTrack"`; see {@link TestHost.sent} to
   * find the one a call uses.
   *
   * @param method - The wire method name.
   * @param handler - Produces the reply from the request parameters.
   *
   * @example Make opening a folder fail
   * The plugin's Open Folder command meets a missing folder and must tell
   * the user. `handle` replaces the host's answer to one wire method; the
   * `HostError` it throws reaches the plugin as a rejection with code
   * `missing`, like the player's refusal. `reset` restores the default
   * behaviour for the rest of the test.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.handle("system.openPath", () => {
   *   throw new HostError("missing", "no such file");
   * });
   * await host.command("open-folder").run(); // the plugin catches `missing`
   * assert.deepEqual(host.osd, ["Folder not found"]);
   * host.reset("system.openPath");
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  handle(method: string, handler: Handler) {
    this.#inner.overrides.set(method, handler);
  }
  /**
   * Restore the default behaviour of a method replaced with {@link TestHost.handle}.
   *
   * @capability None.
   *
   * @example Restore the default answer after a simulated failure
   * The first write fails, the second succeeds. `reset` removes the handler
   * that `handle` installed, so the method is answered by the test host
   * again.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.handle("clipboard.writeText", () => {
   *   throw new HostError("failed", "denied");
   * });
   * await assert.rejects(plugin.clipboard.writeText("x"));
   * host.reset("clipboard.writeText");
   * await plugin.clipboard.writeText("x"); // the default handler again
   * ```
   *
   * @since 1.0.0
   */
  reset(method: string) {
    this.#inner.overrides.delete(method);
  }
  /**
   * Deliver a host event to the plugin. Like the player, subscription-based
   * events (`source.state`, `playback.backend`, `window.state`,
   * `timeline.changed`, `appearance.changed`) are delivered only when the
   * plugin subscribed (it declared `events` and listens). Most tests use the
   * higher-level helpers (`setSource`, `setMainWindow`, ...) instead.
   *
   * @param event - The wire event name.
   * @param data - The event payload (wire-level shape).
   *
   * @capability None.
   *
   * @example Deliver a raw event the helpers do not cover
   * The test pushes a `window.state` event after changing `layout` by hand.
   * Like the player, the host delivers it only when the plugin subscribed;
   * most tests use `setSource`, `setMainWindow` and the other helpers
   * instead.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.emit("window.state", {}); // no facts: the SDK reads window.state again
   * await host.settle();
   * ```
   *
   * @since 1.0.0
   */
  emit(event: string, data: unknown) {
    return emit(this, this.#inner, event, data);
  }
  /**
   * Change the source facts and broadcast them, as if the player's state
   * changed (the user paused, playback reached the end, a file finished
   * loading). Any phase other than `empty` also turns on the source
   * capabilities (pause, seek, rate, ...) unless the patch sets them.
   * After `phase: "ended"`, a seek (a plugin's, a core step seek) returns
   * to `ready` and plays on (`paused: false`), as in the player; it stays
   * paused when the end was reached while paused or by a frame step. A
   * seek at or past the end (the smaller of `position` and `duration`,
   * 0.5 ms slack) goes nowhere: accepted, still ended and paused.
   * `phase: "loading"` makes a mounted backdrop effective, like the player.
   *
   * @param patch - Wire-level source fields, e.g. `phase`, `position`,
   *   `duration`, `paused`, `audioTracks`.
   *
   * @example Load a file, then let it play to the end
   * The plugin sees a one-minute source become ready, then end on its own.
   * `setSource` changes the host's source facts and broadcasts them like
   * the player's events; the SDK updates `player.state` when the event
   * arrives, so the test settles before reading it.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setSource({ phase: "ready", duration: 60, position: 0 });
   * await host.settle();
   * assert.equal(plugin.player.state.phase, "ready");
   * host.setSource({ phase: "ended", terminalReason: "natural" });
   * await host.settle();
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  setSource(patch: Partial<SourceState>) {
    return setSource(this, this.#inner, patch);
  }
  /**
   * Simulate the user changing the main window (resizing, maximizing or
   * restoring it, entering or leaving fullscreen, closing the
   * picture-in-picture window) and broadcast it. `maximized` reads `false`
   * while fullscreen. Like the player, entering fullscreen collapses an
   * attached, visible sidebar (`effective: false`, `reason: "fullscreen"`) and
   * leaving fullscreen docks it again.
   *
   * @example Go fullscreen, report picture-in-picture support, maximize
   * The plugin sees the main window fullscreen at 1920×1080, then learns
   * that picture-in-picture is available, then sees the window leave
   * fullscreen maximized. `setMainWindow` changes the
   * host's window facts and broadcasts them as the player does when the
   * user resizes or toggles fullscreen; entering fullscreen also collapses
   * an attached sidebar.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setMainWindow({ fullscreen: true, videoArea: { width: 1920, height: 1080 } });
   * await host.settle();
   * assert.equal(plugin.window.state.fullscreen, true);
   * host.setMainWindow({ pictureInPicture: { supported: true, active: false } });
   * // Leaving fullscreen into a maximized window: `maximized` reads true again.
   * host.setMainWindow({ fullscreen: false, maximized: true });
   * await host.settle();
   * assert.equal(plugin.window.state.maximized, true);
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  setMainWindow(
    patch: Partial<{
      fullscreen: boolean;
      maximized: boolean;
      videoArea: { width: number; height: number };
      pictureInPicture: { supported: boolean; active: boolean };
    }>,
  ) {
    return setMainWindow(this, this.#inner, patch);
  }
  /**
   * The pointer reached the right edge in fullscreen (`true`) or left the
   * popped-out columns (`false`): the attached sidebar and the adjust column,
   * those switched on, pop out or collapse (reference §6.3). No effect outside
   * fullscreen, or on a column switched off or floating.
   *
   * @capability None.
   *
   * @example Pop the sidebar out in fullscreen
   * The pointer reaches the right edge in fullscreen and the attached
   * sidebar pops out over the video. Outside fullscreen, or with the
   * sidebar hidden or floating, nothing happens.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.setMainWindow({ fullscreen: true });
   * host.popSidebar(true);
   * await host.settle();
   * ```
   *
   * @since 1.0.0
   */
  popSidebar(popped: boolean) {
    if (!this.mainWindow.fullscreen) return;
    for (const column of [this.layout.sidebar, this.layout.adjust]) {
      if (!column?.preferred || column.detached) continue;
      column.effective = popped;
      column.reason = popped ? null : "fullscreen";
    }
    this.emit("window.state", windowFacts(this, this.#inner));
  }

  /**
   * Simulate another plugin (or the user) opening a source: a new
   * `sourceId`, then the given phase. Calls the plugin made against the old
   * state now fail with `stale`.
   *
   * @param source - The path or URL.
   * @param phase - The phase to end in (default `"ready"`).
   *
   * @example Let the user open another file meanwhile
   * A state the plugin captured before stops being current once another
   * file opens. `openElsewhere` gives the source a new `sourceId`, so
   * `isCurrent` turns false. Promise-returning calls made with
   * `ifCurrent: before` then reject with `stale`; calls that return nothing
   * drop the write silently instead (`TimelineLayer.set` with `ifCurrent`).
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const before = plugin.player.state;
   * host.openElsewhere("/media/other.mp4");
   * await host.settle();
   * assert.equal(plugin.player.isCurrent(before), false);
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  openElsewhere(source: string, phase: SourceState["phase"] = "ready") {
    sourceIntent(this, this.#inner, {
      kind: "open",
      source,
      startPaused: false,
    });
    // A file this plugin's file resolver claims waits for its answer.
    if (startResolution(this, this.#inner, source, false) === null)
      this.setSource({ phase });
  }
  /**
   * Simulate a generated stream failing in the player (its audio device
   * lost, its frame connection broken), like the player: the source fails
   * with `message` (`phase: "error"`) and the producer is retired at once.
   * The stream's `onStop` listeners get a `stream` error with `message`.
   *
   * @param producerId - The producer, from {@link TestHost.producers}.
   * @param message - The player's failure text.
   *
   * @example Break the plugin's generated stream
   * The plugin's stream stops with an error, as when the player loses its
   * audio device. `failStream` puts the source into `error` with the
   * message and retires the producer at once; the stream's `onStop`
   * listeners get a `stream` error carrying the message.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * const [producer] = host.producers.values();
   * host.failStream(producer!.id, "producer transport closed");
   * ```
   *
   * @capability None.
   * @since 1.5.7
   */
  failStream(producerId: number, message: string) {
    return failStream(this, this.#inner, producerId, message);
  }
  /**
   * Press a binding like the host's table would: panel-focus bindings first
   * when `panel` is true, then global ones; within a scope the earliest
   * registration first (the player's own commands before the plugin's), as the
   * conflict rule orders them. A disabled command lets the key pass to the next
   * command bound to it: the one it shadowed, then the global
   * scope. The first enabled one runs; `press` resolves after it ran (`"ran"`).
   * When only disabled commands hold the key, the first of them decides, as in
   * the player: with a `reason` it shows the reason on the OSD and eats the key
   * (`"reason"`, see `host.osd`); without one the key goes on to the focused
   * control (`"passed"`, nothing runs). Unlike the player, which only logs a
   * key that reaches a busy command, `press` then rejects, so a test notices.
   * Rejects when nothing is bound. Bindings use the reference syntax
   * (`"Space"`, `"Ctrl+O"`, `"Mouse:WheelUp"`), and user overrides in
   * `bindings.overlay` apply.
   *
   * @returns What the key did: `"ran"`, `"reason"` or `"passed"`.
   *
   * @example Press a global key and a panel key
   * Ctrl+B runs whatever is bound globally; Delete is pressed while the
   * plugin's panel has focus, so panel bindings are tried first. `press`
   * follows the player's binding table and resolves with what happened:
   * `"ran"`, `"reason"` (a disabled command showed why) or `"passed"`.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * await host.press("Ctrl+B"); // a global binding
   * await host.press("Delete", { panel: true }); // while the panel has focus
   * ```
   *
   * @capability None.
   * @throws `command` (rejects) A `HostError`: the command that would run is
   *   busy (the player only logs this).
   * @throws `Error` (rejects) Nothing is bound to the key.
   * @since 1.0.0
   */
  press(
    binding: string,
    options: { panel?: boolean } = {},
  ): Promise<"ran" | "reason" | "passed"> {
    return press(this, this.#inner, binding, options);
  }
  /**
   * Bindings declared by more than one command, each as
   * `[binding, winner, ...ignored]` (command ids; core actions as
   * `host/<id>`). Empty when there are none.
   *
   * @example Check that no default keys collide
   * The test fails when two commands, the player's or the plugin's, declare
   * the same binding. Each entry is `[binding, winner, ...ignored]`, so an
   * empty list means every key does what its command says.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * assert.deepEqual(host.conflicts, []);
   * ```
   */
  get conflicts(): string[][] {
    return [...bindingClaims(this, this.#inner)]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => [key.split(" ")[1]!, ...ids]);
  }

  /**
   * Change the keys of one of the plugin's commands, or of one of the player's
   * core commands by its `host/<id>`, as the user does in Keyboard Shortcuts:
   * `inputs` replaces its keys (`[]` clears them, as Ignore Default Shortcuts
   * does for every default), `null` gives it its own defaults back. It writes
   * {@link TestHost.bindings | bindings.overlay}, and the plugin hears it as
   * from the player: `bindings.changed` and, when what `plugin.commands.keys`
   * reads changed, `commands.keys`.
   *
   * @example Check that a key hint follows a rebinding
   * The view showed W for Brightness −; after the user moves it to
   * Shift+W, it shows the new key. `rebind` changes the overlay and
   * pushes the new labels, and `settle` lets the binding run again. The
   * test host is a Mac unless `systemInfo.os` says otherwise, hence ⇧W.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.rebind("brightness.down", ["Shift+W"]);
   * await host.settle();
   * assert.equal(host.window("picture").props["brightness-down"], "⇧W");
   * ```
   *
   * @capability None.
   * @throws `Error` `command` is neither a command of the plugin nor a
   *   core command.
   * @since 1.6.6
   */
  rebind(command: string, inputs: readonly string[] | null) {
    if (!this.commands.has(command) && !this.coreCommands.has(command))
      throw new Error(`test host: no command ${command}`);
    const key = bindingKey(this, this.#inner, command);
    if (inputs === null) this.bindings.overlay.delete(key);
    else this.bindings.overlay.set(key, inputs.map(canonical));
    this.emit("bindings.changed", null);
    keysChanged(this, this.#inner);
  }

  /**
   * The binding overlay `plugin.bindings.set` writes (`"<plugin>/<command>"`
   * to inputs; preset it to simulate saved overrides). `press` honours it.
   */
  readonly bindings = {
    /** `"<plugin>/<command>"` → the user's inputs for it. */
    overlay: new Map<string, string[]>(),
  };
  /**
   * What `packages.list` reports; `setEnabled`, `uninstall` and `install`
   * update it. `builtin`, `source` and `dataDirectory` are optional here
   * (default `false`, `null`, `null`).
   */
  packages: {
    /** The plugin's manifest id. */
    id: string;
    /** Its version, `null` when unknown. */
    version: string | null;
    /** Where it was loaded from. */
    origin: "installed" | "development";
    /** Its run state. */
    state: "starting" | "running" | "disabled" | "failed" | "stopped";
    /** Why it failed (`state: "failed"`). */
    error: string | null;
    /** Its declared capabilities. */
    capabilities: string[];
    /** The package directory. */
    directory: string;
    /** Shipped with the player: `uninstall` and `install` are `unsupported`. */
    builtin?: boolean;
    /** Where it was installed from. */
    source?: PackageSource | null;
    /** Its data directory. */
    dataDirectory?: string | null;
  }[] = [];
  /** Every `packages.setEnabled` / `uninstall` / `install`, newest last. */
  readonly packageCalls: {
    /** Which call. */
    method: "setEnabled" | "reload" | "uninstall" | "install";
    /** The target plugin id. */
    id: string;
    /** `setEnabled`'s value, or `install`'s `enabled` option when given. */
    enabled?: boolean;
    /** `uninstall`'s `removeData` option. */
    removeData?: boolean;
    /** `install`'s source (`{ kind: "file" }` when not given). */
    source?: PackageSource;
    /** `install`'s `replace` option. */
    replace?: boolean;
  }[] = [];
  /**
   * Packages `validate` and `validateArchive` accept: path (directory or `.vxp`
   * file) → its manifest. Other paths fail with `missing`. `install` adds or
   * upgrades the entry in {@link TestHost.packages} following the player's
   * source rules: the same source upgrades, another source needs `replace`
   * (`conflict` otherwise), a built-in id is `unsupported`. The installed
   * entry's `state` follows
   * {@link "@vestra-player/sdk"!InstallOptions.enabled}: a first install runs,
   * an update of a `disabled` entry stays `disabled` unless `enabled` is
   * `true`, and `enabled: false` installs it `disabled`.
   *
   * @example Offer a package file the plugin can install
   * The plugin can validate and install `/downloads/someone.demo-1.0.0.vxp`
   * as if the file existed. The host accepts only paths listed here (others
   * fail with `missing`) and returns this manifest from `validate`; an
   * install then follows the player's source rules.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.candidates.set("/downloads/someone.demo-1.0.0.vxp", {
   *   id: "someone.demo", version: "1.0.0", apiVersion: "vestra/1",
   *   entry: "main.js", capabilities: [],
   * });
   * ```
   */
  readonly candidates = new Map<string, PackageManifest>();
  /**
   * Which install rule `packages.install` plays. `true` (default): an update
   * or reinstall keeps a `disabled` plugin disabled unless the plugin passes
   * {@link "@vestra-player/sdk"!InstallOptions.enabled}. `false`: every
   * install runs the plugin and `enabled` is ignored (it is still checked and
   * recorded in {@link TestHost.packageCalls}).
   *
   * @example Every install runs
   * The plugin under test installs an update over a plugin the user
   * disabled and expects it to run afterwards. With `false` the host plays
   * that rule; the default keeps the update disabled.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.installKeepsDisabled = false; // every install runs
   * ```
   *
   * @capability None.
   * @since 1.5.55
   */
  installKeepsDisabled = true;
  /**
   * Remote images (`plugin.ui.markdown`, `plugin.ui.remoteImage`): address
   * → a local PNG or JPEG file served for it, or `null` for a failing
   * download. Nothing is fetched from the network in tests; unknown
   * addresses fail.
   */
  readonly remoteImages = new Map<string, string | null>();
  /**
   * The Markdown document a value holds (its wire form read back), or
   * `null` when the value is not one. `images` maps each remote address to
   * the downloaded file. Pass a whole property value or a field of one: a
   * document nested in rows is read the same way.
   *
   * @example Read back a Markdown message in a chat window
   * The test checks the Markdown source of the first chat message. Rows
   * hold the document in its wire form, as `plugin.ui.markdown` produced
   * it; `markdown` reads it back, nested in a row or not.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const rows = host.window("chat").props["messages"] as { body: Json }[];
   * assert.equal(host.markdown(rows[0]!.body)?.text, "**Hello**");
   * ```
   *
   * @capability None.
   * @since 1.1.0
   */
  markdown(value: Json | undefined): MarkdownWire | null {
    const doc = (value as { $vestraMarkdown?: unknown } | null | undefined)
      ?.$vestraMarkdown as MarkdownWire | undefined;
    return doc && typeof doc === "object" && typeof doc.text === "string"
      ? { text: doc.text, base: doc.base, images: { ...doc.images } }
      : null;
  }
  /**
   * What `player.audioDevices()` lists. `setAudioDevice` updates
   * `host.source.audioOutput`.
   */
  audioDevices: {
    /** The device id, e.g. `coreaudio/<UID>`. */
    id: string;
    /** The system's name for it. */
    name: string;
  }[] = [];
  /**
   * Replace the plugin list and push `packages.changed` (another plugin
   * started, stopped, was installed or removed).
   *
   * @capability None.
   *
   * @example Simulate another plugin starting
   * The plugin's store window hears that a plugin is running now. The list
   * replaces `packages` and is pushed as `packages.changed`, which the
   * plugin's `packages.onChange` listeners receive.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * host.setPackages([...host.packages]); // edit a copy, then push it
   * await host.settle();
   * ```
   *
   * @since 1.0.0
   */
  setPackages(list: TestHost["packages"]) {
    this.packages = list;
    this.emit("packages.changed", structuredClone(this.packages));
  }

  /**
   * Simulate another plugin calling `player.next()` / `previous()`: the host
   * asks this plugin's sequence provider. Rejects with `unavailable` when
   * there is no provider or its flag is false.
   *
   * @capability None.
   * @throws `unavailable` (rejects) A `HostError`: there is no sequence
   *   provider, or its flag is false.
   *
   * @example Ask the plugin's provider for the next item
   * Another plugin calls `player.next()`; the host asks the plugin under
   * test, which is the sequence provider, and the test checks what it
   * opened.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * await host.step("next");
   * await host.settle();
   * assert.equal(host.source.source, "/media/b.mp4");
   * ```
   *
   * @since 1.0.0
   */
  step(direction: "next" | "previous") {
    return this.request("sequence.step", { direction });
  }
  /**
   * The plugin's command with this local id. Throws when it is not
   * registered (never added, or disposed).
   *
   * @capability None.
   *
   * @example Read a command's state after a change
   * The test checks that Export becomes enabled once a file is ready. The
   * record is updated as the plugin sends new state; read it after
   * `settle()`.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.setSource({ phase: "ready", duration: 60 });
   * await host.settle();
   * assert.equal(host.command("export").state.enabled, true); // throws if not registered
   * ```
   *
   * @since 1.0.0
   */
  command(id: string): FakeCommand {
    const command = this.commands.get(id);
    if (!command) throw new Error(`command ${id} is not registered`);
    return command;
  }
  /**
   * The plugin's bottom-bar buttons (`CommandOptions.button`) as the player
   * shows them: at most one, the first declared (`BAR_BUTTON_LIMITS`; a
   * later one stays a menu item only). Empty once the command is disposed.
   * Whether one is in the strip or its » menu is the player's business
   * (the room and the other plugins' buttons).
   *
   * @example Click the plugin's bottom-bar button in a test
   * The test finds the plugin's Store button, clicks it and checks that the
   * Store window opened. `barButtons` lists the buttons of the plugin's
   * commands declared with `button`, as the bar shows them; `click()` runs
   * the command like its menu item and waits until the host is idle, and
   * rejects while the command is disabled or busy.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const [button] = host.barButtons; // one button per plugin
   * assert.equal(button?.icon, "store");
   * await button?.click();
   * assert.equal(host.window("store").visible, true);
   * ```
   *
   * @since 1.5.29
   */
  get barButtons(): readonly FakeBarButton[] {
    return barButtons(this, this.#inner);
  }
  /**
   * The plugin's tool window with this id (by default the file name without
   * extension: `ui/picture.slint` → `picture`). Throws when it was never
   * opened with `show()`.
   *
   * @example Press a window's Reset button from a test
   * The Picture window's Reset callback runs and the brightness returns to
   * 0. The window is found by its id (the `.slint` file name by default);
   * `emit` fires the callback the plugin bound, and `settle()` waits for
   * the property the handler wrote.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * host.window("picture").emit("reset");
   * await host.settle();
   * assert.equal(host.window("picture").props["brightness"], 0);
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  window(id: string): FakeWindow {
    const window = this.windows.get(id);
    if (!window) throw new Error(`window ${id} was never opened`);
    return window;
  }
  /**
   * The plugin's mounted panel (bottom bar, sidebar, adjust column or
   * backdrop): the one in `slot`, or without it the only one (a plugin mounts
   * one panel per slot; with several, name the slot). Throws when there is
   * none. Its `props` use Slint (kebab-case) names; `emit` fires a callback on
   * the panel's global.
   *
   * @example Select a row in the plugin's sidebar panel
   * The test checks the panel sits in the sidebar and selects its third
   * row. `emit` fires a callback on the panel's global as a click would;
   * the plugin's handler runs, and `settle()` waits for what it sent.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * const panel = host.mounted();
   * assert.equal(panel.slot, "sidebar");
   * panel.emit("select", 2);
   * await host.settle();
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  mounted(slot?: "bottom" | "sidebar" | "adjust" | "backdrop"): FakePanel {
    return mounted(this, this.#inner, slot);
  }

  /**
   * The parameters of every request of one wire method, oldest first.
   *
   * @example Check the request behind an OSD message
   * The test checks the last OSD request the plugin sent, before
   * translation. `sent` lists the parameters of every request of one wire
   * method, oldest first; `host.osd` holds the texts as shown instead.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * assert.deepEqual(host.sent("osd.show").at(-1), { text: "Saved" });
   * ```
   *
   * @capability None.
   * @since 1.0.0
   */
  sent(method: string) {
    return this.calls
      .filter((call) => call.method === method)
      .map((call) => call.params);
  }
  /**
   * Wait until no request is in flight (and the SDK's follow-up passes ran),
   * and at least `ms` milliseconds have passed so that timers due by then
   * fired. Call it after every action that makes the plugin talk to the host,
   * before asserting.
   *
   * It only waits for host calls. Work the plugin does on its own (reading
   * or parsing a file, a child process, a network request) is not waited
   * for: on a loaded machine it can finish after `settle()` returns. Poll
   * the result you assert on instead (second example).
   *
   * `settle()` does not wait for the SDK's once-a-second full update pass.
   * After `setSource` (or another player state change) only the bindings that
   * read a changed field of `plugin.player.state` run again; state the plugin
   * changed outside a handler without `plugin.update()` shows only in the next
   * full pass. Have the plugin call `plugin.update()` after such a change, or
   * wait `settle(1000)`.
   *
   * @param ms - Extra time to wait, for debounces and timers (default 0).
   *
   * @example Wait past a debounced save
   * The plugin's store writes its file 300 ms after the last `save`, so
   * the test waits 400 ms before it checks what the plugin did next.
   * `settle(ms)` returns when no request is in flight and at least `ms`
   * have passed, so the store's timer has fired. The file write itself is
   * the plugin's own work, which `settle` does not wait for: a test that
   * reads the file calls `await store.flush()` instead.
   * ```ts
   * declare const host: TestHost;
   * // ---cut---
   * const store = plugin.storage.json("prefs", { defaults: { step: 5 } });
   * store.save({ step: 10 });
   * await host.settle(400); // past storage.json's 300 ms debounce
   * ```
   *
   * @example Poll for work the plugin does on its own
   * The plugin reads and parses a file before it shows a status; `settle`
   * does not wait for that (it only waits for host requests), so the test
   * polls the property it asserts on, 20 ms at a time, for up to 2 seconds.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * declare const expected: string;
   * // ---cut---
   * const importWindow = host.window("import");
   * importWindow.emit("load-file"); // the plugin reads and parses the file itself
   * for (let i = 0; i < 100 && importWindow.props["status-text"] !== expected; i++)
   *   await host.settle(20);
   * assert.equal(importWindow.props["status-text"], expected);
   * ```
   *
   * @capability None.
   * @throws Never.
   * @since 1.0.0
   */
  settle(ms = 0) {
    return settle(this, this.#inner, ms);
  }
  /**
   * Close the fake stream servers and delete the host's temporary
   * directories. `stop()` from {@link startPlugin} calls it. It never
   * throws: a directory that a closing file handle still holds (Windows:
   * `ENOTEMPTY`, `EBUSY`, `EPERM`) is retried for about 1.5 s, then left
   * for the system to clean, with a warning on the console.
   *
   * @capability None.
   *
   * @example Clean up a host that was never started
   * A test that made a host but failed before `startPlugin` removes the
   * host's temporary directories itself. `stop()` from `startPlugin` calls
   * `close` for you otherwise.
   * ```ts
   * const host = new TestHost();
   * try {
   *   // … preset the host; the test fails here …
   * } finally {
   *   host.close(); // deletes the host's temporary data
   * }
   * ```
   *
   * @since 1.0.0
   */
  close() {
    return close(this, this.#inner);
  }

  // ------------------------------------------------------------ simulated host

  /**
   * Why the player would keep this plugin running while nothing uses it (lazy
   * activation), one line per reason: an event it listens to that is not one
   * the player wakes it for (with what listens and where it was added), its
   * panel in the bottom bar or the backdrop, its open windows (these as the
   * player's log says them), and its sidebar tab while that is the current tab.
   * The player counts the current tab as busy work, not as something live: it
   * keeps the plugin running only while the tab is shown, and a sidebar panel
   * in a background tab is no reason at all (the plugin may go to standby;
   * showing the tab starts it again). Empty: the player may stop it while idle
   * and start it again on its next use. Filter chains, streams, jobs and the
   * like (which also keep a plugin running) are not listed.
   *
   * @capability None.
   * @since 1.5.40
   *
   * @example Check that a plugin can be stopped while idle
   * The test fails if the plugin keeps running for no reason after it
   * starts, and names the reason (a command whose `enabled` reads
   * `plugin.player.state`, say: give it a `plugin.when` condition). The
   * player stops such a plugin while nothing uses it and starts it again
   * on its next use, so it costs no process meanwhile.
   * ```ts
   * import assert from "node:assert/strict";
   * declare const host: TestHost;
   * // ---cut---
   * assert.deepEqual(host.keepsRunning, []);
   * ```
   */
  get keepsRunning(): string[] {
    return keepsRunning(this, this.#inner);
  }

  readonly #defaults: Record<string, Handler> = {
    ...transportHandlers(this, this.#inner),
    ...commandsHandlers(this, this.#inner),
    ...builtinHandlers(this, this.#inner),
    ...coreActionsHandlers(this, this.#inner),
    ...i18nHandlers(this, this.#inner),
    ...layoutHandlers(this, this.#inner),
    ...osdHandlers(this, this.#inner),
    ...jobsHandlers(this, this.#inner),
    ...processingHandlers(this, this.#inner),
    ...mediaHandlers(this, this.#inner),
    ...servicesHandlers(this, this.#inner),
  };
}

/**
 * Activate a plugin against a test host, the way the player's runner does:
 * build the `plugin` object, call `activate(plugin)`, wait for every
 * registration started during activation (commands, panels, resolvers, ...),
 * then wait until the host is idle.
 *
 * The manifest id and capabilities come from `directory/manifest.json`
 * unless `capabilities` is given; then `id` (default `"test.plugin"`) and
 * `capabilities` are used and no manifest is read. The test host does not
 * apply the player's capability table to every request: the members that
 * check a capability on the plugin's side (`plugin.media.sources` and its
 * `open`, which also needs `playback.control`, `plugin.secrets`, timeline
 * marks, video shaders and views, among others) fail with `capability` as in
 * the player, but a call the player refuses for an undeclared capability can
 * succeed here. `vestra-plugin check` (and the TypeScript plugin) reports
 * those calls from the sources.
 *
 * Rejects when `manifest.json` cannot be read or parsed, when `activate`
 * throws, or when a registration made during activation fails (for example
 * `limit`, `conflict`, `invalid`). Stricter than the player's runner for
 * commands: there the SDK logs a command declaration the player refuses during
 * activation, skips it and activates the rest of the plugin (`onError` hears
 * it); `startPlugin` fails, so a test shows the bad declaration.
 *
 * @param activate - The plugin's default-exported `activate` function.
 * @param options - Where the plugin lives and how to start it.
 * @returns `host`: the {@link TestHost}; `plugin`: the object passed to
 * `activate` (call the plugin API on it directly); `stop()`: dispose the plugin
 * like the player stopping it (scopes released, stores flushed), wait until the
 * host is idle and remove the host's temporary files; `stop({ reason })`:
 * `reason` is the `StopReason` the player sends; `disconnect()` stops it as
 * when the player is lost (`host-lost`, requests refused with `disabled`).
 * Removing the temporary files never fails a test.
 *
 * @example Test that a setting survives a restart
 * The test turns on the 10-step option, stops the plugin, starts it again
 * on the same data directory and checks the option is still on. Both runs
 * get a directory the test made (`dataDirectory`): `stop()` disposes the
 * plugin like the player, which writes its pending stores there, and only
 * removes the host's own temporary directory, so the second run reads what
 * the first one saved.
 * ```ts
 * import assert from "node:assert/strict";
 * import { mkdtempSync, rmSync } from "node:fs";
 * import { tmpdir } from "node:os";
 * import { join } from "node:path";
 * import test from "node:test";
 * import { startPlugin } from "@vestra-player/sdk/testing";
 * import activate from "../main.ts";
 *
 * test("remembers the step across restarts", async () => {
 *   const directory = new URL("..", import.meta.url);
 *   const data = mkdtempSync(join(tmpdir(), "data-"));
 *   try {
 *     const first = await startPlugin(activate, { directory, dataDirectory: data });
 *     try {
 *       await first.host.command("step-10").run();
 *     } finally {
 *       await first.stop(); // flushes the plugin's stores into `data`
 *     }
 *
 *     // A restart: a new host and a new plugin instance on the same data.
 *     const second = await startPlugin(activate, { directory, dataDirectory: data });
 *     try {
 *       assert.equal(second.host.command("step-10").state.checked, true);
 *     } finally {
 *       await second.stop();
 *     }
 *   } finally {
 *     rmSync(data, { recursive: true, force: true });
 *   }
 * });
 * ```
 *
 * @remarks
 * The way into a plugin's tests: one call starts the plugin the way the
 * player's runner does and returns the host to drive, the `plugin` object
 * to call directly, and `stop` to end it like the player.
 *
 * @capability None.
 * @see [Test a plugin](../../../docs/guides/testing.md)
 * @since 1.0.0
 * @category Testing
 */
export async function startPlugin(
  activate: (plugin: Plugin) => unknown,
  options: {
    /**
     * The plugin's package directory, as a path or a `file:` URL (e.g.
     * `new URL("..", import.meta.url)` from `tests/`). Relative `.slint`
     * files resolve against it. Default: the current working directory.
     */
    directory?: string | URL;
    /** The manifest id when `capabilities` is given. Default `"test.plugin"`. */
    id?: string;
    /** Use these capabilities instead of reading `manifest.json`. */
    capabilities?: string[];
    /**
     * Run the plugin as one built into the player
     * ({@link TestHost.builtin}): only then do `commands.run` and
     * `palette.lead` work. Default `false`.
     *
     * @since 1.7.9
     */
    builtin?: boolean;
    /** A host to use (to preset data before activation). Default: a new one. */
    host?: TestHost;
    /** Use an existing directory as `plugin.dataDirectory` (to test a restart). */
    dataDirectory?: string;
    /**
     * Start with these `plugin.storage.session` values (to test a restart
     * within one player session): pass the previous run's
     * `host.sessionStorage`. They are copied into the new host's
     * {@link TestHost.sessionStorage}.
     *
     * @since 1.5.25
     */
    sessionStorage?: ReadonlyMap<string, Json>;
    /**
     * The interface language to play ({@link TestHost.locale}): the plugin's
     * `locales/<locale>.po` (or `.json`) in `directory` is loaded and its
     * menus, messages and titles show translated. Default: the host's.
     *
     * @since 1.5.9
     */
    locale?: Locale;
  } = {},
) {
  const host = options.host ?? new TestHost();
  if (options.locale !== undefined) host.locale = options.locale;
  const directory =
    options.directory instanceof URL
      ? fileURLToPath(options.directory)
      : (options.directory ?? process.cwd());
  let manifest = {
    id: options.id ?? "test.plugin",
    capabilities: options.capabilities ?? [],
  };
  if (options.directory && !options.capabilities) {
    const read = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
    manifest = { id: read.id, capabilities: read.capabilities };
  }
  host.manifestId = manifest.id;
  pluginCapabilities.set(host, manifest.capabilities);
  if (options.builtin) host.builtin = true;
  host.loadCatalog(directory);
  // Its Slint files: the values its views are given are checked against
  // their declared types.
  packageDirectories.set(host, directory);
  const data = options.dataDirectory ?? host.dataDirectory;
  for (const [key, value] of options.sessionStorage ?? [])
    host.sessionStorage.set(key, sortedJson(value));
  mkdirSync(data, { recursive: true });
  if (host.fileRoots.length === 0) host.fileRoots = [directory, data];
  const instance = await createPlugin(
    host,
    manifest,
    directory,
    data,
    // Like the player: protocol additions it takes (`app.features` set on
    // the host replaces them, e.g. `[]` for an older player's behaviour).
    { features: [PATCH_FEATURE], ...host.app },
    // Unlike the player's runner, which logs a refused command declaration
    // and activates the rest: a plugin's tests show the refusal.
    { strictDeclarations: true },
  );
  await activate(instance.plugin);
  // Like the player: a position or resolver another plugin holds is not an
  // activation failure.
  for (;;) {
    try {
      await instance.activated();
      break;
    } catch (error) {
      if (!(error instanceof Error && takenErrors.has(error))) throw error;
    }
  }
  await host.settle();
  tellResidency(host);
  // Zero declared parameters (`stop.length === 0`) and a `()` overload, so
  // `t.after(stop)`, `promise.then(stop)` and done-callback test runners
  // see the same function as before 1.5.54.
  const stop: {
    (): Promise<void>;
    (options: { reason?: StopReason }): Promise<void>;
  } = async (...args: unknown[]) => {
    // Only an object with `reason` counts (a value `then` or a test
    // runner passes is ignored; an unknown reason reads as none).
    const first = args[0];
    const reason =
      typeof first === "object" && first !== null && "reason" in first
        ? (first as { reason?: unknown }).reason
        : undefined;
    await instance.dispose({ reason });
    await host.settle();
    host.close();
  };
  return {
    /** The test host the plugin talks to. */
    host,
    /** The `plugin` object passed to `activate`. */
    plugin: instance.plugin,
    /**
     * Stop the plugin, wait for the host, and remove temporary files.
     * `stop({ reason })`: `reason` is the reason the player gives
     * (`plugin.stopReason`, the `onDispose` cleanups' `info.reason`); `stop()`:
     * none (`undefined`). It still
     * takes no declared parameter, so it can be passed as a callback
     * (`t.after(stop)`, `promise.then(stop)`).
     */
    stop,
    /**
     * Lose the player: as when it crashes or is killed, the runner stops the
     * plugin with reason `host-lost`; requests still waiting for their answer
     * and every later request are refused with `disabled`. Then waits and
     * removes the temporary files like `stop`.
     */
    async disconnect() {
      host.loseConnection();
      await instance.dispose({ reason: "host-lost" });
      await host.settle();
      host.close();
    },
  };
}
