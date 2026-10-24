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
 *   cases check all three), and the command limits ({@link COMMAND_LIMITS})
 *   and menu ids ({@link MENU_IDS}) are enforced.
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
 * @example
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
import { existsSync, readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostError } from "../wire.ts";
import type { PackageManifest, PackageSource } from "./types.ts";
import type {
  Json,
  LayoutPanel,
  LayoutSlot,
  LocalServices,
  PlaybackStats,
  Transport,
  WireSystemInfo,
} from "../wire.ts";
import { COMMAND_LIMITS, MENU_IDS } from "../commands.ts";
import type { CommandDeclaration } from "../commands.ts";
import type { SourceState, SourceStamp } from "../source.ts";
import type { SubtitleState } from "../subtitles.ts";
import { nodeProblem } from "../processing.ts";
import {
  RENDER_DEFAULTS,
  renderProblem,
  VIEW_DEFAULTS,
  viewProblem,
} from "./view.ts";
import type { RenderSettings, ViewSettings } from "./types.ts";
import type { MediaJob } from "../media.ts";
import { createPlugin } from "./index.ts";
import { THEMES } from "./appearance.ts";
import type { Plugin, ThemeId } from "./types.ts";

/** Throw one of these from `host.handle(...)` to simulate a definite refusal. */
export { HostError };
/** The player's command caps, which the test host enforces as well. */
export { COMMAND_LIMITS, MENU_IDS };

type Handler = (params: Record<string, Json>) => unknown;
type Call = { method: string; params: Record<string, Json> };

/**
 * A tool window as the test host keeps it: the record of a
 * `plugin.windows.create(...)` window after its first `show()`. Get one with
 * {@link TestHost.window}.
 *
 * @example
 * ```ts
 * await host.command("open-picture").run(); // the plugin calls window.show()
 * const picture = host.window("picture");
 * assert.equal(picture.visible, true);
 * picture.emit("adjust", "brightness", 40); // fire a Slint callback
 * await host.settle();
 * assert.equal(picture.props["brightness"], 40);
 * ```
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
   */
  emit(callback: string, ...args: Json[]): void;
  /**
   * The user closes the window with its title-bar button: the window closes
   * and the plugin's `window.onClose` listeners run (unlike the plugin's own
   * `close()`).
   */
  userClose(): void;
}

/**
 * A command the plugin registered with `plugin.commands.add`, as the test
 * host keeps it. Get one with {@link TestHost.command} (the plugin's own) or
 * {@link TestHost.coreAction} (the player's core actions).
 *
 * @example
 * ```ts
 * const toggle = host.command("toggle-loop");
 * assert.deepEqual(toggle.declaration.path, ["Playback", "Loop"]);
 * assert.equal(toggle.state.checked, false);
 * await toggle.run();
 * assert.equal(host.command("toggle-loop").state.checked, true);
 * ```
 */
export interface FakeCommand {
  /**
   * What the plugin declared: id, menu path, title, order, group, default
   * bindings, focus and repeat. Wire-level shape; it may gain fields in minor
   * versions.
   */
  declaration: CommandDeclaration;
  /** The command state the player last received (after the update pass). */
  state: {
    /** `false` when the plugin disabled the command. */
    enabled: boolean;
    /** The check mark: `true`, `false`, or `null` for none. */
    checked: boolean | null;
    /** `true` while the plugin reports the command as busy. */
    busy: boolean;
    /** The reason shown when the command is disabled or busy. */
    reason: string | null;
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
   */
  run(): Promise<void>;
}

/**
 * A generated stream (`plugin.player.openStream`) as the test host sees it:
 * the fake player end of the frame connection. Assertion surface; see
 * {@link TestHost.producers}.
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
   * `true` if the frame connection closed while this stream was still the
   * player's source: the player reports that as a playback failure
   * ("producer transport closed"). `stop()` closes the source first.
   */
  droppedWhileSelected: boolean;
}

const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function initialSource(): SourceState {
  return {
    kind: "media",
    container: null,
    audioTracks: null,
    stamp: { generation: 0, intentVersion: 0 },
    cycle: 0,
    eventSequence: 0,
    phase: "empty",
    source: null,
    loadingOwner: null,
    terminalReason: null,
    paused: false,
    position: null,
    duration: null,
    capabilities: {
      pause: false,
      seek: false,
      rate: false,
      restart: false,
      close: false,
      snapshotSource: false,
    },
    output: { volume: 100, muted: false },
    rate: 1,
  };
}

const readyCapabilities = {
  pause: true,
  seek: true,
  rate: true,
  restart: true,
  close: true,
  snapshotSource: true,
};

/** A Markdown document as {@link TestHost.markdown} reads it back. */
export interface MarkdownWire {
  /** The Markdown text. */
  text: string;
  /** The base given to `ui.markdown`, or `null`. */
  base: string | null;
  /** Remote image address → the file the SDK downloaded for it. */
  images: Record<string, string>;
}

/**
 * Refusals for a position or resolver another plugin holds: not activation
 * failures (`startPlugin`).
 */
const takenErrors = new WeakSet<Error>();
const taken = (message: string) => {
  const error = new HostError("conflict", message);
  takenErrors.add(error);
  return error;
};
const SLOT_LABELS: Record<string, string> = {
  bottom: "底栏",
  sidebar: "侧栏",
  backdrop: "视频背景",
};
/** The player's limit of sidebar tabs. */
const MAX_SIDEBAR_TABS = 8;

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
 *   {@link TestHost.tools}.
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
 * @example
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
 */
export class TestHost implements Transport {
  /**
   * Every request the plugin sent, in order: `{ method, params }`.
   * Wire-level; prefer {@link TestHost.sent} for one method.
   */
  readonly calls: Call[] = [];
  /** The host events the plugin subscribed to (needs `events` etc.). */
  readonly subscriptions = new Set<string>();
  /**
   * The player's source facts (phase, position, duration, paused, rate,
   * audio tracks, loop, ...). Wire-level shape; change it with
   * {@link TestHost.setSource}, which also broadcasts it.
   */
  source: SourceState = initialSource();
  /** Tool windows by id (see {@link TestHost.window}). */
  readonly windows = new Map<string, FakeWindow>();
  /**
   * The plugin's mounted panel (bottom bar, sidebar or backdrop), or `null`.
   * See {@link TestHost.mounted}.
   */
  panel:
    | (Omit<FakeWindow, "callbacks" | "userClose"> & {
        /** `"bottom"`, `"sidebar"` or `"backdrop"`. */
        slot: string;
        /** The exported component the SDK found in the file. */
        component: string;
        /** The last `panel.setInteraction(...)` locks, `null` before any. */
        locks: Json;
      })
    | null = null;
  /** The plugin's commands by local id (see {@link TestHost.command}). */
  readonly commands = new Map<string, FakeCommand>();
  /** The player's 14 core actions (`host/<id>`), kept apart from the plugin's `commands`. */
  readonly coreCommands = new Map<string, FakeCommand>();
  /**
   * Both panel positions as the player reports them (`null` while no panel
   * is mounted there). You may change a slot directly and then call
   * `host.emit("window.state", {})` to simulate a change made elsewhere.
   *
   * @example
   * ```ts
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
  } = {
    bottom: null,
    sidebar: null,
  };
  /** Every `osd.show` text, newest last. */
  readonly osd: string[] = [];
  /** The text of this plugin's osd panel, `null` when hidden. */
  osdPanel: string | null = null;
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
   * @example
   * ```ts
   * host.stats = {
   *   ...host.stats,
   *   video: { codec: "h264", width: 1920, height: 1080, fps: 24 },
   * } as typeof host.stats;
   * ```
   */
  stats: PlaybackStats = {
    backend: "test",
    session: 0,
    framesShown: 0,
    framesDropped: 0,
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
   * @example
   * ```ts
   * host.tools.handle("ffprobe", (args) => {
   *   assert.ok(args.includes("-show_streams"));
   *   return { stdout: JSON.stringify({ streams: [] }) };
   * });
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
  };
  /**
   * Simulate another plugin publishing its timeline layer (or clearing it
   * with `[]`); pushes `timeline.changed` when the plugin subscribed.
   *
   * @param pluginId - The other plugin's manifest id.
   * @param marks - Its whole layer.
   *
   * @example
   * ```ts
   * host.setTimelineLayer("community.chapters", [
   *   { time: 0, kind: "chapter", title: "Intro" },
   *   { time: 95, kind: "chapter", title: "Part 1" },
   * ]);
   * await host.settle();
   * assert.equal(plugin.timeline.marks.length, 2);
   * ```
   */
  setTimelineLayer(
    pluginId: string,
    marks: { time: number; kind: string; title?: string | null }[],
  ) {
    if (marks.length)
      this.timeline.layers.set(
        pluginId,
        marks.map((m) => ({
          time: m.time,
          kind: m.kind,
          title: m.title ?? null,
        })),
      );
    else this.timeline.layers.delete(pluginId);
    this.#timelineChanged();
  }
  #timelineChanged() {
    this.emit("timeline.changed", { marks: this.timeline.marks });
  }
  /**
   * Runtime images written to views (`plugin.ui.image`), newest last. The
   * SDK refuses images of released scopes before anything is sent.
   */
  readonly images: {
    /** The image file's path, as given to `ui.image`. */
    path: string;
    /** The SDK's reference number for that `ImageRef`. */
    ref: number;
  }[] = [];
  /**
   * The file an image property shows, or `null` when the value is not a
   * runtime image. View properties hold images in their wire form; this
   * reads the path back.
   *
   * @example
   * ```ts
   * assert.equal(
   *   host.imagePath(host.window("cover").props["cover"]),
   *   join(plugin.dataDirectory, "cover.png"),
   * );
   * ```
   */
  imagePath(value: Json | undefined): string | null {
    const image = value as { $vestraImage?: unknown } | null | undefined;
    return image &&
      typeof image === "object" &&
      typeof image.$vestraImage === "string"
      ? image.$vestraImage
      : null;
  }
  #validate(path: string) {
    const manifest = this.candidates.get(path);
    if (!manifest) throw new HostError("missing", `no test package at ${path}`);
    return {
      token: path,
      digest: "0".repeat(64),
      apiVersion: "vestra/1",
      manifest: structuredClone(manifest),
      checks: ["manifest", "digest", "productionJavaScript", "slintCompile"],
      trustedExecution: true,
    };
  }
  #seeImages(values: Record<string, Json> | Json[]) {
    for (const value of Object.values(values)) {
      const path = this.imagePath(value);
      if (path !== null)
        this.images.push({
          path,
          ref: Number((value as { ref?: number }).ref),
        });
    }
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
   * whole list goes there; otherwise (and on the video area) grouped by
   * extension to the first provider (`folder` for existing directories).
   * Files nobody takes are ignored. Resolves once the host is idle again.
   *
   * @param paths - The dropped paths, in the order the file manager gives.
   * @param options - `target`: `"video"` (default) or `"panel"`; `at`: the
   *   drop point in panel coordinates (default `{ x: 0, y: 0 }`);
   *   `modifiers`: keys held (default all `false`).
   *
   * @example
   * ```ts
   * await host.drop(["/media/a.srt", "/media/b.mkv"]);
   * await host.drop(["/media/list.m3u"], {
   *   target: "panel",
   *   at: { x: 10, y: 48 },
   *   modifiers: { alt: true },
   * });
   * ```
   */
  drop(
    paths: string[],
    options: {
      target?: "video" | "panel";
      at?: { x: number; y: number };
      modifiers?: Partial<{ alt: boolean; shift: boolean; cmd: boolean }>;
    } = {},
  ) {
    const modifiers = {
      alt: false,
      shift: false,
      cmd: false,
      ...options.modifiers,
    };
    if (options.target === "panel" && this.panelDrops) {
      this.emit("drops.panel", {
        paths,
        at: options.at ?? { x: 0, y: 0 },
        modifiers,
      });
      return this.settle();
    }
    const groups = new Map<string, string[]>();
    for (const path of paths) {
      const kind = statSync(path, { throwIfNoEntry: false })?.isDirectory()
        ? "folder"
        : (/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "");
      const provider = this.dropProviders.find((p) =>
        p.extensions.includes(kind),
      );
      if (provider)
        groups.set(provider.id, [...(groups.get(provider.id) ?? []), path]);
    }
    for (const [id, group] of groups)
      this.emit("drops.drop", { id, paths: group, modifiers });
    return this.settle();
  }
  /** The palette (`plugin.appearance.theme`); `setAppearance` changes it elsewhere. */
  appearance: ThemeId = "vestra";
  /**
   * Simulate another plugin switching the palette: updates
   * {@link TestHost.appearance} and pushes `appearance.changed`.
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
   * @example
   * ```ts
   * const page = host.settingsPage("general");
   * page.emit("setStep", 10);
   * await host.settle();
   * assert.equal(page.props["step"], 10);
   * ```
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
   */
  setBackdropEffective(effective: boolean) {
    if (this.backdrop) this.backdrop.effective = effective;
    this.emit("window.state", this.#windowFacts());
  }
  #nextOwner = 2;
  /** Owners of other plugins' panels, by plugin id ({@link TestHost.mountOther}). */
  readonly #others = new Map<string, { slot: string; owner: number }>();
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
   * @example The playlist next to this plugin's sidebar panel
   * ```ts
   * const host = new TestHost();
   * host.mountOther("sidebar", "vestra.playlist", { title: "播放列表" });
   * const { plugin } = await startPlugin(activate, { host, directory });
   * assert.equal(host.layout.sidebar?.panels?.length, 2);
   * ```
   *
   * @since 1.5.2
   */
  mountOther(
    slot: "bottom" | "sidebar" | "backdrop",
    plugin: string,
    options: { title?: string } = {},
  ) {
    if (this.#others.has(plugin))
      throw new Error(`${plugin} already has a panel`);
    const owner = this.#nextOwner++;
    if (slot === "backdrop") {
      if (this.backdrop) throw new Error("the backdrop is taken");
      this.backdrop = { owner: plugin, effective: true };
    } else {
      if (slot === "bottom" && this.layout.bottom)
        throw new Error("the bottom bar is taken");
      this.#addPanel(slot, { owner, plugin, title: options.title ?? plugin });
    }
    this.#others.set(plugin, { slot, owner });
    this.emit("window.state", this.#windowFacts());
  }
  /**
   * Simulate another plugin's panel going away ({@link TestHost.mountOther}):
   * when its tab was current, the next tab (else the previous one) is.
   *
   * @since 1.5.2
   */
  unmountOther(plugin: string) {
    const other = this.#others.get(plugin);
    if (!other) throw new Error(`${plugin} has no panel`);
    this.#others.delete(plugin);
    if (other.slot === "backdrop") this.backdrop = null;
    else this.#removePanel(other.slot as "bottom" | "sidebar", other.owner);
    this.emit("window.state", this.#windowFacts());
  }
  /**
   * Simulate the user clicking a sidebar tab: `plugin`'s panel (the plugin
   * under test's `manifestId`, or one of {@link TestHost.mountOther})
   * becomes the current tab. Pushed as a `window.state` change.
   *
   * @since 1.5.2
   */
  selectTab(plugin: string) {
    const slot = this.layout.sidebar;
    const panel = slot?.panels?.find((entry) => entry.plugin === plugin);
    if (!slot || !panel) throw new Error(`${plugin} has no sidebar tab`);
    slot.owner = panel.owner;
    this.emit("window.state", this.#windowFacts());
  }
  #addPanel(slot: "bottom" | "sidebar", panel: LayoutPanel) {
    const state = this.layout[slot];
    if (state) state.panels = [...(state.panels ?? []), panel];
    else
      this.layout[slot] = {
        owner: panel.owner,
        preferred: true,
        effective: true,
        reason: null,
        detached: false,
        panels: [panel],
      };
  }
  #removePanel(slot: "bottom" | "sidebar", owner: number) {
    const state = this.layout[slot];
    if (!state) return;
    const panels = state.panels ?? [];
    const index = panels.findIndex((panel) => panel.owner === owner);
    const rest = panels.filter((panel) => panel.owner !== owner);
    if (rest.length === 0) {
      this.layout[slot] = null;
      return;
    }
    state.panels = rest;
    if (state.owner === owner)
      state.owner = (rest[index] ?? rest[rest.length - 1]!).owner;
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
    /** `true`: GPU rendering; `false`: software rendering (`unsupported`). */
    gpu: boolean;
  } = { owner: null, values: { ...RENDER_DEFAULTS, shaders: [] }, gpu: true };
  /**
   * Simulate another plugin owning the render options (the plugin's
   * `video.render()` then fails with `conflict`), or, with `null`, releasing
   * them (values reset to the defaults).
   */
  setVideoRenderOwner(pluginId: string | null) {
    this.videoRender.owner = pluginId;
    if (pluginId === null)
      this.videoRender.values = { ...RENDER_DEFAULTS, shaders: [] };
  }
  /**
   * What the player pushes when mpv cannot compile a shader (code `failed`)
   * or switches to software rendering (`unsupported`, which also sets
   * `videoRender.gpu` to false). Pushed only when this plugin is the owner.
   *
   * @example
   * ```ts
   * host.failVideoRender("failed", "shader compile failed: ERROR: 0:39: ...");
   * await host.settle();
   * assert.equal(render.status.state, "failed");
   * ```
   */
  failVideoRender(code: "failed" | "unsupported", message: string) {
    if (code === "unsupported") this.videoRender.gpu = false;
    if (this.videoRender.owner === this.manifestId)
      this.emit("video.render.status", {
        state: "failed",
        error: { code, message },
      });
  }
  /**
   * The player's processing (filter) state. Wire-level; may change in minor
   * versions. `resources` holds each `video.filter` / `audio.filter` chain the
   * plugin applied, keyed by the SDK's resource id.
   *
   * @example
   * ```ts
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
    }
  >();
  /** Snapshots taken with `media.capture`, by snapshot id. Wire-level. */
  readonly snapshots = new Map<number, Json>();
  /** Every `jobs.start` request (`kind`, `destination`, `quality`, …), newest last. */
  readonly exports: Record<string, Json>[] = [];
  /**
   * Export jobs by job id. Each state query advances a job one step
   * (`queued` → `running` → `completed`; `cancelling` → `cancelled`).
   * Wire-level.
   */
  readonly jobs = new Map<number, MediaJob>();
  /**
   * `openStream`'s transport: a Unix socket (macOS, Linux) or, with `"tcp"`,
   * loopback TCP where the plugin must send the token first (Windows).
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
   * @example
   * ```ts
   * const host = new TestHost();
   * host.otherResolvers.push({ owner: "vestra.nes", extensions: ["nes"] });
   * ```
   */
  readonly otherResolvers: {
    owner: string;
    extensions?: string[];
    schemes?: string[];
    hosts?: string[];
  }[] = [];
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
    { resolverId: string; source: string; paused: boolean }
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
   * @example
   * ```ts
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
   * `setMainWindow` (the user resized it, entered fullscreen, closed the
   * picture-in-picture window); `onTop`, `cursorAutoHide` and
   * `pictureInPicture.active` record the plugin's `window.set…` calls.
   * `pictureInPicture.supported: false` stands for Windows and Linux.
   */
  readonly mainWindow = {
    /** Whether the main window is fullscreen. */
    fullscreen: false,
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
  /** What `plugin.app.system()` reports. */
  systemInfo: WireSystemInfo = {
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
  /** What `player.chapters()` lists while media is ready. */
  chapters: {
    /** The chapter title, `null` without one. */
    title: string | null;
    /** Start time in seconds. */
    start: number;
  }[] = [];
  readonly #overrides = new Map<string, Handler>();
  readonly #listeners = new Map<string, Set<(data: unknown) => void>>();
  #inFlight = 0;
  #next = { snapshot: 0, job: 0, producer: 0, source: 0, resolution: 0 };
  #sourceBook = new Map<number, Json>();
  /** The pending resolutions' stamps and operations (beside `resolutions`). */
  #resolving = new Map<number, { stamp: SourceStamp; operation?: number }>();
  /** The producer the source is (`openProvider`, a resolved stream). */
  #selected: number | null = null;
  readonly #scratch = mkdtempSync(join(tmpdir(), "vestra-test-host-"));
  /**
   * `plugin.dataDirectory`: a fresh empty temporary directory, removed with
   * the host on `stop()`. `plugin.storage.json` reads and writes real files
   * here. Pass `startPlugin(..., { dataDirectory })` to use another one.
   */
  readonly dataDirectory = join(this.#scratch, "data");
  /**
   * The manifest id of the plugin under test (set by {@link startPlugin};
   * `"test.plugin"` by default).
   */
  manifestId = "test.plugin";

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
    this.#registerCoreActions();
  }

  // ------------------------------------------------------------ core actions

  /** The `player.setStepSeek` value in effect (default 5). */
  stepSeek = 5;
  /** Every `player.step`, newest last. */
  readonly steps: {
    /** `"frame"` or `"keyframe"`. */
    unit: string;
    /** `"backward"` or `"forward"`. */
    direction: string;
  }[] = [];
  /** Every core action run (`host.run`, a core command, a pressed core binding), newest last. */
  readonly coreRuns: string[] = [];

  /**
   * One of the 14 core actions (`play-pause`, `stop`, `seek-forward`, ...)
   * that the test host registers like the player, as `host/<id>`. Throws for
   * an unknown id. `run()` executes it with the player's checks and writes
   * its on-screen text to {@link TestHost.osd}.
   *
   * @example
   * ```ts
   * host.setSource({ phase: "ready", duration: 100, position: 10 });
   * await host.coreAction("play-pause").run();
   * assert.equal(host.source.paused, true);
   * assert.deepEqual(host.coreRuns, ["play-pause"]);
   * ```
   */
  coreAction(id: string): FakeCommand {
    const command = this.coreCommands.get(`host/${id}`);
    if (!command) throw new Error(`no core action ${id}`);
    return command;
  }
  #facts() {
    const s = this.source;
    const ready = s.phase === "ready";
    const ended = s.phase === "ended";
    return {
      ready,
      ended,
      toggle:
        (s.capabilities.pause && ready) || (ended && s.capabilities.restart),
      step: s.capabilities.seek && ready && s.position !== null,
      rate: s.capabilities.rate && ready,
      close: s.capabilities.close && s.phase !== "empty",
    };
  }
  /** Why one frame that way is impossible (B07), or null; the player's rules. */
  #frameCheck(forward: boolean): string | null {
    const s = this.source;
    const unsupported = "当前来源不支持此操作";
    const noBack = "当前来源不支持逐帧后退";
    if (s.phase !== "ready" && s.phase !== "ended") return unsupported;
    if (s.kind !== "media") return forward ? unsupported : noBack;
    if (s.hasVideo === false) return "没有视频";
    if (forward && s.phase !== "ready") return unsupported;
    if (!forward && !s.capabilities.seek) return noBack;
    return null;
  }
  /** The same enabled rules and reasons as the player's core actions. */
  #coreState(action: string) {
    const f = this.#facts();
    const s = this.source;
    const unsupported = "当前来源不支持此操作";
    const rule: Record<string, [boolean, boolean | null, string]> = {
      "play-pause": [f.toggle, f.ready ? s.paused : null, unsupported],
      stop: [f.close, null, unsupported],
      previous: [!!this.sequence?.canPrevious, null, "没有上一个"],
      next: [!!this.sequence?.canNext, null, "没有下一个"],
      "frame-back": [
        !this.#frameCheck(false),
        null,
        this.#frameCheck(false) ?? unsupported,
      ],
      "frame-forward": [
        !this.#frameCheck(true),
        null,
        this.#frameCheck(true) ?? unsupported,
      ],
      "seek-backward": [f.step, null, unsupported],
      "seek-forward": [f.step, null, unsupported],
      "rate-normal": [f.rate, s.rate === 1, unsupported],
      "rate-down": [f.rate, null, unsupported],
      "rate-up": [f.rate, null, unsupported],
      "volume-up": [true, null, unsupported],
      "volume-down": [true, null, unsupported],
      mute: [true, s.output.muted, unsupported],
    };
    const [enabled, checked, reason] = rule[action]!;
    return { enabled, checked, busy: false, reason: enabled ? null : reason };
  }
  #registerCoreActions() {
    const table: [
      string,
      string[],
      number,
      string,
      string[],
      boolean,
      boolean?,
    ][] = [
      ["stop", ["关闭"], 120, "open", ["F4"], false],
      ["play-pause", ["播放", "播放/暂停"], 201, "domain", ["Space"], false],
      [
        "previous",
        ["播放", "上一个"],
        202,
        "domain",
        ["PageUp", "Mouse:X1"],
        false,
      ],
      [
        "next",
        ["播放", "下一个"],
        203,
        "domain",
        ["PageDown", "Mouse:X2"],
        false,
      ],
      ["frame-back", ["播放", "跳转", "上一帧"], 204, "frame", ["D"], true],
      ["frame-forward", ["播放", "跳转", "下一帧"], 205, "frame", ["F"], true],
      [
        "seek-backward",
        ["播放", "跳转", "后退5秒"],
        210,
        "step",
        ["ArrowLeft"],
        true,
      ],
      [
        "seek-forward",
        ["播放", "跳转", "前进5秒"],
        211,
        "step",
        ["ArrowRight"],
        true,
      ],
      [
        "rate-normal",
        ["播放", "速度", "正常"],
        220,
        "domain",
        ["Z"],
        false,
        true,
      ],
      ["rate-down", ["播放", "速度", "减速 0.1"], 221, "domain", ["X"], false],
      ["rate-up", ["播放", "速度", "加速 0.1"], 222, "domain", ["C"], false],
      [
        "volume-up",
        ["声音", "音量 +"],
        501,
        "domain",
        ["ArrowUp", "Mouse:WheelUp"],
        true,
      ],
      [
        "volume-down",
        ["声音", "音量 −"],
        502,
        "domain",
        ["ArrowDown", "Mouse:WheelDown"],
        true,
      ],
      ["mute", ["声音", "静音"], 503, "domain", ["M"], false],
    ];
    const host = this;
    for (const [id, path, order, group, bindings, repeat, radio] of table) {
      const command: FakeCommand = {
        declaration: {
          title: path.at(-1)!,
          path,
          order,
          group,
          radio: radio ?? false,
          bindings,
          repeat,
        } as unknown as CommandDeclaration,
        get state() {
          return host.#coreState(id);
        },
        set state(_value) {},
        revision: 1,
        async run() {
          await host.request("host.run", { action: id });
          await host.settle();
        },
      };
      this.coreCommands.set(`host/${id}`, command);
    }
  }
  #runCore(action: string) {
    const state = this.#coreState(action);
    if (!state.enabled)
      throw new HostError("unavailable", state.reason ?? "unavailable");
    this.coreRuns.push(action);
    const s = this.source;
    const time = (t: number | null) => {
      if (t === null) return "--:--";
      const w = Math.max(0, Math.floor(t));
      const mm = String(Math.floor(w / 60) % 60).padStart(2, "0");
      const ss = String(w % 60).padStart(2, "0");
      return w >= 3600 ? `${Math.floor(w / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
    };
    const rateText = (r: number) => String(Math.round(r * 100) / 100);
    switch (action) {
      case "play-pause":
        if (s.phase === "ended") this.#intent({ kind: "restart" });
        else
          this.#intent({
            kind: "control",
            control: { kind: "pause", paused: !s.paused },
          });
        this.osd.push(s.phase !== "ended" && !s.paused ? "已暂停" : "播放");
        return;
      case "stop":
        this.#intent({ kind: "close" });
        return;
      case "previous":
      case "next":
        this.emit("sequence.step", { direction: action });
        return;
      case "frame-back":
      case "frame-forward":
        this.steps.push({
          unit: "frame",
          direction: action === "frame-back" ? "backward" : "forward",
        });
        return;
      case "seek-backward":
      case "seek-forward": {
        const delta =
          action === "seek-forward" ? this.stepSeek : -this.stepSeek;
        const base = s.position ?? 0;
        const target = Math.max(
          0,
          Math.min(s.duration ?? Infinity, base + delta),
        );
        this.#intent({
          kind: "control",
          control: { kind: "seek", seconds: target },
        });

        this.osd.push(
          `${delta < 0 ? "后退" : "前进"} ${Math.abs(delta)}秒: ${time(target)} / ${time(s.duration)}`,
        );
        return;
      }
      case "rate-normal":
      case "rate-down":
      case "rate-up": {
        const rate =
          action === "rate-normal"
            ? 1
            : Math.max(
                0.25,
                Math.min(
                  4,
                  Math.round(
                    (s.rate + (action === "rate-up" ? 0.1 : -0.1)) * 100,
                  ) / 100,
                ),
              );
        this.#intent({ kind: "control", control: { kind: "rate", rate } });
        this.osd.push(`播放速度: ${rateText(rate)}x`);
        return;
      }
      case "volume-up":
      case "volume-down": {
        // Like the player: up stops at 100 (a louder volume set through
        // setOutput stays), down steps by 5 to 0.
        const volume =
          action === "volume-up"
            ? Math.max(
                s.output.volume,
                Math.min(100, Math.round(s.output.volume + 5)),
              )
            : Math.max(0, Math.min(200, Math.round(s.output.volume - 5)));
        this.setSource({ output: { volume, muted: false } });
        this.osd.push(`音量: ${volume}%`);
        return;
      }
      case "mute":
        this.setSource({ output: { ...s.output, muted: !s.output.muted } });
        this.osd.push(s.output.muted ? "静音: 关" : "静音: 开");
        return;
    }
  }

  // ------------------------------------------------------------ transport

  /**
   * @internal The transport side the SDK calls: answer one request with the
   * override from {@link TestHost.handle} or the default behaviour.
   */
  async request<T>(method: string, params: Json = {}): Promise<T> {
    const record = (params ?? {}) as Record<string, Json>;
    this.calls.push({ method, params: record });
    this.#inFlight++;
    try {
      await tick();
      const handler = this.#overrides.get(method) ?? this.#defaults[method];
      if (!handler)
        throw new HostError("unsupported", `test host has no ${method}`);
      return (await handler(record)) as T;
    } finally {
      this.#inFlight--;
    }
  }
  /** @internal The transport side the SDK calls: listen to a host event. */
  on(event: string, listener: (data: unknown) => void) {
    const group = this.#listeners.get(event) ?? new Set();
    group.add(listener);
    this.#listeners.set(event, group);
    return () => {
      group.delete(listener);
    };
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
   * @example
   * ```ts
   * host.handle("system.openPath", () => {
   *   throw new HostError("missing", "no such file");
   * });
   * await host.command("open-folder").run();
   * assert.deepEqual(host.osd, ["Folder not found"]);
   * host.reset("system.openPath");
   * ```
   */
  handle(method: string, handler: Handler) {
    this.#overrides.set(method, handler);
  }
  /** Restore the default behaviour of a method replaced with {@link TestHost.handle}. */
  reset(method: string) {
    this.#overrides.delete(method);
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
   */
  emit(event: string, data: unknown) {
    if (
      [
        "source.state",
        "playback.backend",
        "window.state",
        "timeline.changed",
        "appearance.changed",
      ].includes(event) &&
      !this.subscriptions.has(event)
    )
      return;
    for (const listener of [...(this.#listeners.get(event) ?? [])])
      listener(data);
  }
  /**
   * Change the source facts and broadcast them, as if the player's state
   * changed (the user paused, playback reached the end, a file finished
   * loading). Any phase other than `empty` also turns on the source
   * capabilities (pause, seek, rate, ...) unless the patch sets them.
   * `phase: "loading"` makes a mounted backdrop effective, like the player.
   *
   * @param patch - Wire-level source fields, e.g. `phase`, `position`,
   *   `duration`, `paused`, `audioTracks`.
   *
   * @example
   * ```ts
   * host.setSource({ phase: "ready", duration: 60, position: 0 });
   * await host.settle();
   * assert.equal(plugin.player.state.phase, "ready");
   * host.setSource({ phase: "ended", terminalReason: "natural" });
   * await host.settle();
   * ```
   */
  setSource(patch: Partial<SourceState>) {
    this.source = {
      ...this.source,
      ...patch,
      eventSequence: this.source.eventSequence + 1,
    };
    if (patch.phase && patch.phase !== "empty" && !patch.capabilities)
      this.source.capabilities = { ...readyCapabilities };
    this.subtitles.source = {
      generation: this.source.stamp.generation,
      phase: this.source.phase,
    };
    this.emit("source.state", this.source);
    // Like the player (reference §6.3): loading shows the backdrop.
    if (patch.phase === "loading" && this.backdrop && !this.backdrop.effective)
      this.setBackdropEffective(true);
  }
  /**
   * Simulate the user changing the main window (resizing it, entering or
   * leaving fullscreen, closing the picture-in-picture window) and broadcast
   * it. Like the player, entering fullscreen collapses an attached, visible
   * sidebar (`effective: false`, `reason: "fullscreen"`) and leaving
   * fullscreen docks it again.
   *
   * @example
   * ```ts
   * host.setMainWindow({ fullscreen: true, videoArea: { width: 1920, height: 1080 } });
   * await host.settle();
   * assert.equal(plugin.window.state.fullscreen, true);
   * host.setMainWindow({ pictureInPicture: { supported: true, active: false } });
   * ```
   */
  setMainWindow(
    patch: Partial<{
      fullscreen: boolean;
      videoArea: { width: number; height: number };
      pictureInPicture: { supported: boolean; active: boolean };
    }>,
  ) {
    const entering =
      patch.fullscreen !== undefined &&
      patch.fullscreen !== this.mainWindow.fullscreen;
    Object.assign(this.mainWindow, patch);
    // Like the player (reference §6.3): in fullscreen the attached sidebar
    // starts collapsed at the right edge; leaving fullscreen docks it again.
    const sidebar = this.layout.sidebar;
    if (entering && sidebar && sidebar.preferred && !sidebar.detached) {
      sidebar.effective = !this.mainWindow.fullscreen;
      sidebar.reason = this.mainWindow.fullscreen ? "fullscreen" : null;
    }
    this.emit("window.state", this.#windowFacts());
  }
  /**
   * The pointer reached the right edge in fullscreen (`true`) or left the
   * popped-out sidebar (`false`): the attached sidebar pops out or collapses
   * (reference §6.3). No effect outside fullscreen, when hidden or floating.
   */
  popSidebar(popped: boolean) {
    const sidebar = this.layout.sidebar;
    if (!this.mainWindow.fullscreen || !sidebar?.preferred || sidebar.detached)
      return;
    sidebar.effective = popped;
    sidebar.reason = popped ? null : "fullscreen";
    this.emit("window.state", this.#windowFacts());
  }
  #windowFacts() {
    return {
      fullscreen: this.mainWindow.fullscreen,
      videoArea: { ...this.mainWindow.videoArea },
      pictureInPicture: { ...this.mainWindow.pictureInPicture },
      appearance: this.appearance,
    };
  }
  /**
   * Simulate another plugin (or the user) opening a source: a new
   * `sourceId`, then the given phase. Calls the plugin made against the old
   * state now fail with `stale`.
   *
   * @param source - The path or URL.
   * @param phase - The phase to end in (default `"ready"`).
   *
   * @example
   * ```ts
   * const before = plugin.player.state;
   * host.openElsewhere("/media/other.mp4");
   * await host.settle();
   * assert.equal(plugin.player.isCurrent(before), false);
   * ```
   */
  openElsewhere(source: string, phase: SourceState["phase"] = "ready") {
    this.#intent({ kind: "open", source, startPaused: false });
    // A file this plugin's file resolver claims waits for its answer.
    if (this.#resolve(source, false) === null) this.setSource({ phase });
  }
  /**
   * Press a binding like the host's table would: panel-focus bindings first
   * when `panel` is true, then global ones; the earliest registration wins a
   * conflict. Resolves after the command ran; rejects when nothing is bound
   * or the command is disabled or busy. Bindings use the reference syntax
   * (`"Space"`, `"Ctrl+O"`, `"Mouse:WheelUp"`); the player's core actions
   * match first, and user overrides in `bindings.overlay` apply.
   *
   * @example
   * ```ts
   * await host.press("Ctrl+B"); // a global binding
   * await host.press("Delete", { panel: true }); // while the panel has focus
   * ```
   */
  async press(binding: string, options: { panel?: boolean } = {}) {
    const claims = this.#claims();
    const id =
      (options.panel ? claims.get(`panel ${binding}`)?.[0] : undefined) ??
      claims.get(`global ${binding}`)?.[0];
    if (!id) throw new Error(`test host: nothing is bound to ${binding}`);
    await (this.coreCommands.get(id) ?? this.command(id)).run();
  }
  /**
   * Bindings declared by more than one command, each as
   * `[binding, winner, ...ignored]` (command ids; core actions as
   * `host/<id>`). Empty when there are none.
   *
   * @example
   * ```ts
   * assert.deepEqual(host.conflicts, []);
   * ```
   */
  get conflicts(): string[][] {
    return [...this.#claims()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => [key.split(" ")[1]!, ...ids]);
  }
  #claims() {
    const claims = new Map<string, string[]>();
    // The player's own commands win a conflict, as in the binding table.
    for (const [id, { declaration }] of [
      ...this.coreCommands,
      ...this.commands,
    ]) {
      const scope = declaration.focus ? "panel" : "global";
      // The user overlay (`bindings.set`) replaces a command's own bindings.
      const overridden = this.bindings.overlay.get(this.#bindingKey(id));
      for (const binding of overridden ?? declaration.bindings) {
        const key = `${scope} ${binding}`;
        claims.set(key, [...(claims.get(key) ?? []), id]);
      }
    }
    return claims;
  }
  /** `host/<id>` for core commands, `<manifest id>/<id>` for the plugin's. */
  #bindingKey(id: string) {
    return this.coreCommands.has(id) ? id : `${this.manifestId}/${id}`;
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
    origin: "installed" | "development" | "trial";
    /** Its run state. */
    state: "starting" | "running" | "disabled" | "failed" | "stopped";
    /** Why it failed (`state: "failed"`). */
    error: string | null;
    /** Its declared capabilities. */
    capabilities: string[];
    /** The package directory. */
    directory: string;
    /** The version a rollback would restore, `null` without one. */
    previousVersion: string | null;
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
    method: "setEnabled" | "uninstall" | "install";
    /** The target plugin id. */
    id: string;
    /** `setEnabled`'s value. */
    enabled?: boolean;
    /** `uninstall`'s `removeData` option. */
    removeData?: boolean;
    /** `install`'s source (`{ kind: "file" }` when not given). */
    source?: PackageSource;
    /** `install`'s `replace` option. */
    replace?: boolean;
  }[] = [];
  /**
   * Packages `validate` and `validateArchive` accept: path (directory or
   * `.vxp` file) → its manifest. Other paths fail with `missing`. `install`
   * adds or upgrades the entry in {@link TestHost.packages} following the
   * player's source rules: the same source upgrades, another source needs
   * `replace` (`conflict` otherwise), a built-in id is `unsupported`.
   *
   * @example
   * ```ts
   * host.candidates.set("/downloads/someone.demo-1.0.0.vxp", {
   *   id: "someone.demo", version: "1.0.0", apiVersion: "vestra/1",
   *   entry: "main.js", capabilities: [],
   * });
   * ```
   */
  readonly candidates = new Map<string, PackageManifest>();
  /**
   * Remote Markdown images (`plugin.ui.markdown`): address → a local PNG or
   * JPEG file served for it, or `null` for a failing download. Nothing is
   * fetched from the network in tests; unknown addresses fail.
   */
  readonly remoteImages = new Map<string, string | null>();
  /**
   * The Markdown document a property holds (its wire form read back), or
   * `null` when the value is not one. `images` maps each remote address to
   * the downloaded file.
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
   */
  setPackages(list: TestHost["packages"]) {
    this.packages = list;
    this.emit("packages.changed", structuredClone(list));
  }
  #split(key: string) {
    const at = key.indexOf("/");
    return { plugin: key.slice(0, at), command: key.slice(at + 1) };
  }
  #bindingTable() {
    const claims = this.#claims();
    const commands = [...this.coreCommands, ...this.commands].map(
      ([id, { declaration }]) => {
        const key = this.#bindingKey(id);
        const scope = declaration.focus ? "panel" : "global";
        const current = this.bindings.overlay.get(key) ?? declaration.bindings;
        return {
          ...this.#split(key),
          title: declaration.title,
          path: declaration.path?.length ? declaration.path : null,
          scope: scope as "panel" | "global",
          defaults: declaration.bindings,
          current,
          overridden: this.bindings.overlay.has(key),
          shadowed: current.flatMap((input) => {
            const winner = claims.get(`${scope} ${input}`)?.[0];
            return !winner || winner === id
              ? []
              : [{ input, by: this.#split(this.#bindingKey(winner)) }];
          }),
          labels: [...current],
        };
      },
    );
    const declared = new Set(commands.map((c) => `${c.plugin}/${c.command}`));
    const orphans = [...this.bindings.overlay]
      .filter(([key]) => !declared.has(key))
      .map(([key, inputs]) => ({ ref: this.#split(key), inputs }));
    return { commands, orphans };
  }
  /**
   * Simulate another plugin calling `player.next()` / `previous()`: the host
   * asks this plugin's sequence provider. Rejects with `unavailable` when
   * there is no provider or its flag is false.
   */
  step(direction: "next" | "previous") {
    return this.request("sequence.step", { direction });
  }
  /**
   * The plugin's command with this local id. Throws when it is not
   * registered (never added, or disposed).
   */
  command(id: string): FakeCommand {
    const command = this.commands.get(id);
    if (!command) throw new Error(`command ${id} is not registered`);
    return command;
  }
  /**
   * The plugin's tool window with this id (by default the file name without
   * extension: `ui/picture.slint` → `picture`). Throws when it was never
   * opened with `show()`.
   *
   * @example
   * ```ts
   * host.window("picture").emit("reset");
   * await host.settle();
   * assert.equal(host.window("picture").props["brightness"], 0);
   * ```
   */
  window(id: string): FakeWindow {
    const window = this.windows.get(id);
    if (!window) throw new Error(`window ${id} was never opened`);
    return window;
  }
  /**
   * The plugin's mounted panel (bottom bar, sidebar or backdrop). Throws when
   * none is mounted. Its `props` use Slint (kebab-case) names; `emit` fires a
   * callback on the panel's global.
   *
   * @example
   * ```ts
   * const panel = host.mounted();
   * assert.equal(panel.slot, "sidebar");
   * panel.emit("select", 2);
   * await host.settle();
   * ```
   */
  mounted() {
    if (!this.panel) throw new Error("no panel mounted");
    return this.panel;
  }
  /**
   * The parameters of every request of one wire method, oldest first.
   *
   * @example
   * ```ts
   * assert.deepEqual(host.sent("osd.show").at(-1), { text: "Saved" });
   * ```
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
   * @param ms - Extra time to wait, for debounces and timers (default 0).
   *
   * @example
   * ```ts
   * store.save({ step: 10 });
   * await host.settle(400); // past storage.json's 300 ms debounce
   * ```
   *
   * @example
   * ```ts
   * window.emit("load-file"); // the plugin reads and parses the file itself
   * for (let i = 0; i < 100 && window.props["status-text"] !== expected; i++)
   *   await host.settle(20);
   * assert.equal(window.props["status-text"], expected);
   * ```
   */
  async settle(ms = 0) {
    const deadline = Date.now() + ms;
    for (let idle = 0; idle < 3;) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 1));
      idle = this.#inFlight === 0 && Date.now() >= deadline ? idle + 1 : 0;
    }
  }
  /**
   * Close the fake stream servers and delete the host's temporary
   * directories. `stop()` from {@link startPlugin} calls it.
   */
  close() {
    for (const producer of this.producers.values()) producer.server.close();
    rmSync(this.#scratch, { recursive: true, force: true });
  }

  // ------------------------------------------------------------ simulated host

  #intent(intent: Record<string, Json>): { ticket: Json } {
    const expected = intent.expected as SourceStamp | undefined;
    const stamp = this.source.stamp;
    if (
      expected &&
      (expected.generation !== stamp.generation ||
        expected.intentVersion !== stamp.intentVersion)
    )
      throw new HostError("stale", "stale");
    const next = {
      ...this.source,
      stamp: { ...stamp, intentVersion: stamp.intentVersion + 1 },
      eventSequence: this.source.eventSequence + 1,
    };
    if (intent.kind === "open" || intent.kind === "openProvider") {
      next.stamp.generation++;
      next.cycle++;
      next.kind = intent.kind === "open" ? "media" : "producer";
      next.source =
        intent.kind === "open"
          ? String(intent.source)
          : `producer://${intent.producerId}`;
      next.phase = intent.kind === "open" ? "loading" : "ready";
      next.paused = intent.startPaused === true;
      next.position = null;
      next.duration = null;
      next.terminalReason = null;
      next.capabilities = { ...readyCapabilities };
      next.loop = null; // a new source clears the A-B loop
      if (this.timeline.layers.size) {
        this.timeline.layers.clear(); // and every timeline layer
        queueMicrotask(() => this.#timelineChanged());
      }
    } else if (intent.kind === "close") {
      if (!this.source.source) throw new HostError("invalid", "noSource");
      Object.assign(next, {
        phase: "empty",
        source: null,
        position: null,
        duration: null,
        terminalReason: "stopped",
      });
    } else if (intent.kind === "restart") {
      next.cycle++;
      Object.assign(next, {
        phase: "ready",
        position: 0,
        paused: false,
        terminalReason: null,
      });
    } else if (intent.kind === "control") {
      if (!this.source.source) throw new HostError("invalid", "noSource");
      const control = intent.control as Record<string, Json>;
      if (control.kind === "pause") next.paused = control.paused === true;
      if (control.kind === "seek") next.position = Number(control.seconds);
      if (control.kind === "rate") next.rate = Number(control.rate);
    }
    if (intent.kind === "openProvider")
      this.#selected = Number(intent.producerId);
    if (intent.kind === "open" || intent.kind === "close")
      this.#selected = null;
    this.source = next;
    this.subtitles.source = {
      generation: next.stamp.generation,
      phase: next.phase,
    };
    this.emit("source.state", this.source);
    this.#cancelResolutions();
    return { ticket: { stamp: next.stamp, cycle: next.cycle, owner: 1 } };
  }

  /** The file resolver of this plugin that claims `source`, if any. */
  #fileResolver(source: string): string | null {
    if (source.includes("://") || !isAbsolute(source)) return null;
    const extension = extname(source).slice(1).toLowerCase();
    if (!extension) return null;
    for (const [id, declaration] of this.resolvers) {
      const extensions = (declaration as { extensions?: string[] }).extensions;
      if (extensions?.includes(extension)) return id;
    }
    return null;
  }
  /** Whether producer `id` is the player's source. */
  #current(id: number) {
    return (
      this.source.kind === "producer" &&
      (this.#selected === id || this.source.source === `producer://${id}`)
    );
  }
  /** Start resolving `source` for the open just made; its request id, or null. */
  #resolve(source: string, paused: boolean, operation?: number): number | null {
    const resolverId = this.#fileResolver(source);
    if (resolverId === null) return null;
    const requestId = ++this.#next.resolution;
    this.resolutions.set(requestId, { resolverId, source, paused });
    this.#resolving.set(requestId, {
      stamp: { ...this.source.stamp },
      ...(operation === undefined ? {} : { operation }),
    });
    this.emit("source.resolveRequest", { requestId, resolverId, url: source });
    return requestId;
  }
  /** Settle a resolution's open; `error` fails it. */
  #settle(requestId: number, error?: string) {
    const operation = this.#resolving.get(requestId)?.operation;
    this.resolutions.delete(requestId);
    this.#resolving.delete(requestId);
    if (operation === undefined) return;
    const entry = this.#sourceBook.get(operation) as
      { ticket?: Json } | undefined;
    this.#sourceBook.set(
      operation,
      error === undefined
        ? { status: "completed", ticket: entry?.ticket ?? null }
        : { status: "failed", error: { backend: error } },
    );
  }
  /** Resolutions whose open is no longer the source (or whose resolver left). */
  #cancelResolutions() {
    const stamp = this.source.stamp;
    for (const [requestId, resolution] of [...this.resolutions]) {
      const pending = this.#resolving.get(requestId)!;
      if (
        pending.stamp.generation === stamp.generation &&
        pending.stamp.intentVersion === stamp.intentVersion &&
        this.resolvers.has(resolution.resolverId)
      )
        continue;
      this.#settle(
        requestId,
        "source resolution cancelled, expired or superseded",
      );
      this.emit("source.resolveCancel", {
        requestId,
        resolverId: resolution.resolverId,
      });
    }
  }
  /** `sourceResolvers.register`: the player's rules for both forms. */
  #register(p: Record<string, Json>) {
    const id = String(p.id);
    const extensions = p.extensions as string[] | undefined;
    if (this.resolvers.has(id))
      throw new HostError("conflict", "resolver id already registered");
    if (extensions !== undefined) {
      if (
        p.schemes !== undefined ||
        p.hosts !== undefined ||
        !Array.isArray(extensions) ||
        extensions.length < 1 ||
        extensions.length > 16 ||
        extensions.some(
          (e) =>
            typeof e !== "string" ||
            !/^[a-z0-9]{1,16}$/.test(e) ||
            e === "folder",
        )
      )
        throw new HostError(
          "invalid",
          "file resolvers take 1–16 file extensions (lower case, no dot, not folder)",
        );
    }
    const claims = (other: {
      extensions?: string[];
      schemes?: string[];
      hosts?: string[];
    }) =>
      extensions?.find((e) => other.extensions?.includes(e)) ??
      (other.hosts?.some((h) =>
        (p.hosts as string[] | undefined)?.includes(h),
      ) &&
      other.schemes?.some((x) =>
        (p.schemes as string[] | undefined)?.includes(x),
      )
        ? "host"
        : undefined);
    for (const own of this.resolvers.values())
      if (claims(own as never))
        throw new HostError("conflict", "already registered by this plugin");
    for (const other of this.otherResolvers) {
      const what = claims(other);
      if (what) {
        const target = what === "host" ? "这个网站" : `文件类型 .${what}`;
        throw taken(`${target} 已由 ${other.owner} 解析`);
      }
    }
    this.resolvers.set(id, p);
  }
  /** `sourceResolvers.respond` for a simulated file resolution. */
  #respond(p: Record<string, Json>) {
    const requestId = Number(p.requestId);
    const resolution = this.resolutions.get(requestId);
    if (!resolution) {
      // Web resolutions are not simulated: their answers are only recorded.
      if (requestId > this.#next.resolution) return null;
      throw new HostError("stale", "resolution no longer pending");
    }
    const fail = (message: string): never => {
      this.#settle(requestId, message);
      this.setSource({
        phase: "error",
        terminalReason: { failed: message },
      } as Partial<SourceState>);
      throw new HostError("resolution", message);
    };
    if (typeof p.error === "string")
      fail(p.error.trim() ? p.error.slice(0, 2048) : "resolver failed");
    const result = (p.result ?? {}) as { kind?: string; producerId?: number };
    const producer = this.producers.get(Number(result.producerId));
    if (result.kind !== "stream") fail("invalid resolved stream descriptor");
    if (!producer || producer.released) fail("unavailable: producer absent");
    // Like openProvider, but the source keeps the path and `startPaused`.
    this.#selected = producer!.id;
    producer!.active = true;
    producer!.acknowledged = false;
    producer!.pending = {
      producerId: producer!.id,
      epoch: producer!.epoch + 1,
      baseSample: producer!.receivedFrames,
      paused: resolution.paused,
    };
    this.#settle(requestId);
    this.setSource({
      kind: "producer",
      phase: "ready",
      paused: resolution.paused,
      capabilities: {
        pause: true,
        seek: false,
        rate: false,
        restart: false,
        close: true,
        snapshotSource: false,
      },
    } as Partial<SourceState>);
    return { stamp: { ...this.source.stamp } };
  }

  #processingState() {
    const list = (stage: string) =>
      [...this.processing.resources]
        .filter(([, value]) => value.stage === stage)
        .map(([key, value]) => ({
          owner: 1,
          revision: value.revision,
          resource: {
            manifestId: this.manifestId,
            resourceId: key.split(":")[1]!,
            nodes: value.nodes,
          },
          ...(stage === "audio" ? { offsetMs: value.offsetMs ?? 0 } : {}),
        }));
    return {
      configurationRevision: this.processing.configurationRevision,
      audioOffsetMs: 0,
      source: {
        generation: this.source.stamp.generation,
        phase: this.source.phase,
        load: null,
        stages: {},
      },
      video: list("video"),
      audio: list("audio"),
      backendUncertain: this.processing.backendUncertain,
    };
  }

  /** Audio track calls need ready media and the source the caller saw. */
  #audioCondition(expected: Json | undefined) {
    const want = expected as SourceStamp | undefined;
    const stamp = this.source.stamp;
    if (
      want &&
      (want.generation !== stamp.generation ||
        want.intentVersion !== stamp.intentVersion)
    )
      throw new HostError("stale", "source changed");
    if (
      this.source.kind !== "media" ||
      !["ready", "ended"].includes(this.source.phase)
    )
      throw new HostError("unavailable", "audio tracks need ready media");
  }

  #subtitleChange(expected: Json) {
    const stamp = this.subtitles.selection.stamp;
    const want = expected as { generation: number; revision: number };
    if (
      want.generation !== stamp.generation ||
      want.revision !== stamp.revision
    )
      throw new HostError("stale", "subtitle selection changed");
    this.subtitles.selection.stamp = {
      generation: this.source.stamp.generation,
      revision: stamp.revision + 1,
    };
  }

  readonly #defaults: Record<string, Handler> = {
    "events.subscribe": (p) => void this.subscriptions.add(String(p.event)),
    "events.unsubscribe": (p) =>
      void this.subscriptions.delete(String(p.event)),
    "commands.register": (p) => {
      const id = String(p.id);
      // The player's built-in menu ids (MENU_IDS) in the first path segment.
      const path = ((p.declaration as { path?: string[] })?.path ?? []).map(
        String,
      );
      const menu = path[0]?.startsWith("@") ? path[0].slice(1) : null;
      if (menu !== null && !(MENU_IDS as readonly string[]).includes(menu))
        throw new HostError("invalid", `unknown menu id @${menu}`);
      if (menu !== null && path.length < 2)
        throw new HostError(
          "invalid",
          `menu id @${menu} needs an item after it`,
        );
      if (this.commands.has(id))
        throw new HostError("command", "owner/localId already registered");
      // The player's caps (COMMAND_LIMITS): the total counts the core commands too.
      if (
        this.commands.size >= COMMAND_LIMITS.perPlugin ||
        this.commands.size + this.coreCommands.size >= COMMAND_LIMITS.total
      )
        throw new HostError("limit", "command registry limit reached");
      const host = this;
      this.commands.set(id, {
        declaration: p.declaration as FakeCommand["declaration"],
        state: p.state as FakeCommand["state"],
        revision: Number(p.revision),
        async run() {
          if (this.state.busy || !this.state.enabled)
            throw new HostError(
              "command",
              `${id} is ${this.state.busy ? "busy" : "disabled"}`,
            );
          host.emit("commands.execute", { id, revision: this.revision });
          await host.settle();
        },
      });
      return { revision: 1 };
    },
    "commands.unregister": (p) => {
      if (!this.commands.delete(String(p.id)))
        throw new HostError("missing", `command ${p.id} is not registered`);
    },
    "commands.update": (p) => {
      const command = this.command(String(p.id));
      if (Number(p.revision) <= command.revision)
        throw new HostError("command", `stale command revision ${p.revision}`);
      command.revision = Number(p.revision);
      command.state = p.state as FakeCommand["state"];
      return { revision: command.revision };
    },
    "ui.open": (p) => {
      const id = String(p.id);
      if (this.windows.has(id))
        throw new HostError("conflict", "view already exists");
      this.#seeImages(p.properties as Record<string, Json>);
      const host = this;
      this.windows.set(id, {
        file: String(p.file),
        visible: true,
        props: { ...(p.properties as Record<string, Json>) },
        callbacks: p.callbacks as string[],
        userClose() {
          host.windows.delete(id);
          host.emit("ui.closed", { view: id });
        },
        emit(callback, ...args) {
          const name = kebab(callback);
          if (!this.callbacks.includes(name))
            throw new Error(`window ${id} did not register callback ${name}`);
          host.emit("ui.callback", { view: id, callback: name, args });
        },
      });
    },
    "ui.set": (p) => {
      const window = this.windows.get(String(p.id));
      if (!window) throw new HostError("missing", "view not found");
      this.#seeImages([p.value!]);
      window.props[String(p.property)] = p.value!;
    },
    "ui.show": (p) => {
      const window = this.windows.get(String(p.id));
      if (!window) throw new HostError("missing", "view not found");
      window.visible = p.visible === true;
    },
    "ui.close": (p) => {
      if (!this.windows.delete(String(p.id)))
        throw new HostError("missing", "view not found");
    },
    "ui.mount": (p) => {
      if (this.panel) throw new HostError("conflict", "owner already mounted");
      // Like the player: one panel in the bottom bar and the backdrop, tabs
      // in the sidebar (up to 8).
      const holder =
        p.slot === "backdrop"
          ? this.backdrop?.owner
          : p.slot === "bottom"
            ? this.layout.bottom?.panels?.[0]?.plugin
            : undefined;
      if (holder !== undefined || (p.slot === "bottom" && this.layout.bottom))
        throw taken(`${SLOT_LABELS[String(p.slot)]}已被 ${holder} 使用`);
      if (
        p.slot === "sidebar" &&
        (this.layout.sidebar?.panels?.length ?? 0) >= MAX_SIDEBAR_TABS
      )
        throw taken(`侧栏最多 ${MAX_SIDEBAR_TABS} 个页签`);
      this.#seeImages(p.properties as Record<string, Json>);
      const host = this;
      this.panel = {
        slot: String(p.slot),
        file: String(p.file),
        component: String(p.component),
        visible: true,
        props: { ...(p.properties as Record<string, Json>) },
        locks: null,
        emit(callback, ...args) {
          host.emit("ui.callback", {
            view: "$mount",
            callback: kebab(callback),
            args,
          });
        },
      };
      if (p.slot === "backdrop") {
        this.backdrop = { owner: this.manifestId, effective: true };
        return { status: "ready", prepareMs: 0, shellGeneration: 1 };
      }
      const slot = String(p.slot) as "bottom" | "sidebar";
      this.#addPanel(slot, {
        owner: 1,
        plugin: this.manifestId,
        title:
          typeof p.title === "string" && p.title ? p.title : this.manifestId,
      });
      return { status: "ready", prepareMs: 0, shellGeneration: 1 };
    },
    "ui.unmount": () => {
      if (this.panel?.slot === "backdrop") this.backdrop = null;
      else if (this.panel)
        this.#removePanel(this.panel.slot as "bottom" | "sidebar", 1);
      this.panel = null;
    },
    "ui.menu": (p) => {
      if (!this.panel) throw new HostError("unavailable", "panel not shown");
      if (this.panel.slot === "sidebar" && this.layout.sidebar?.owner !== 1)
        throw new HostError(
          "unavailable",
          "the panel's tab is not the current one",
        );
      const items = p.items as (string | null)[];
      for (const id of items)
        if (id !== null && !this.commands.has(id))
          throw new HostError("missing", `command ${id} not registered`);
      this.menus.push({ items, x: Number(p.x), y: Number(p.y) });
    },
    "layout.state": () => ({
      ...this.layout,
      backdrop: this.backdrop && {
        owner: 1,
        effective: this.backdrop.effective,
      },
    }),
    "layout.set": (p) => {
      const slot = String(p.slot) as "bottom" | "sidebar";
      const state = this.layout[slot];
      if (!state) throw new HostError("missing", "no panel at this position");
      if (p.detached !== undefined && slot === "bottom")
        throw new HostError("invalid", "the bottom bar cannot be detached");
      if (p.active !== undefined && p.active !== null) {
        const panel = state.panels?.find((entry) => entry.plugin === p.active);
        if (!panel)
          throw new HostError(
            "missing",
            `${String(p.active)} has no panel at this position`,
          );
        state.owner = panel.owner;
      }
      if (typeof p.visible === "boolean") {
        state.preferred = p.visible;
        state.effective = p.visible;
        state.reason = p.visible ? null : "userHidden";
        if (this.panel?.slot === slot) this.panel.visible = p.visible;
      }
      if (typeof p.detached === "boolean") state.detached = p.detached;
    },
    "osd.show": (p) => {
      const text = String(p.text);
      if (!text || [...text].length > 200)
        throw new HostError("invalid", "osd text needs 1..200 characters");
      this.osd.push(text);
    },
    "osd.panel": (p) =>
      void (this.osdPanel = p.text === null ? null : String(p.text)),
    "playback.stats": () => this.stats,
    "audio.addTrack": (p) => {
      this.#audioCondition(p.expected);
      const path = String(p.path);
      if (!path.startsWith("/") || path.includes("://"))
        throw new HostError(
          "invalid",
          "path must be an existing absolute file",
        );
      const tracks = this.source.audioTracks ?? [];
      const track = {
        trackId: Math.max(0, ...tracks.map((t) => t.trackId)) + 1,
        streamIndex: null,
        selected: p.select !== false,
        external: true,
        codec: null,
        title: path.split("/").pop() ?? null,
        language: null,
      };
      this.setSource({
        audioTracks: [
          ...tracks.map((t) => ({
            ...t,
            selected: track.selected ? false : t.selected,
          })),
          track,
        ],
      });
      return track;
    },
    "audio.selectTrack": (p) => {
      this.#audioCondition(p.expected);
      const tracks = this.source.audioTracks ?? [];
      if (!tracks.some((t) => t.trackId === p.id))
        throw new HostError("invalid", "no such audio track");
      this.setSource({
        audioTracks: tracks.map((t) => ({
          ...t,
          selected: t.trackId === p.id,
        })),
      });
    },
    // The player validates again; these mirror what reaches it.
    "system.reveal": (p) =>
      void this.system.revealed.push(...(p.paths as string[])),
    "system.openPath": (p) => void this.system.opened.push(String(p.path)),
    "system.openUrl": (p) => void this.system.urls.push(String(p.url)),
    "secrets.get": (p) => this.secrets.get(String(p.name)) ?? null,
    "secrets.set": (p) => {
      const name = String(p.name);
      if (!this.secrets.has(name) && this.secrets.size >= 256)
        throw new HostError(
          "limit",
          "a plugin stores at most 256 secret names",
        );
      this.secrets.set(name, String(p.value));
    },
    "secrets.delete": (p) => void this.secrets.delete(String(p.name)),
    "app.system": () => structuredClone(this.systemInfo),
    "clipboard.readText": () => this.clipboard.text,
    "clipboard.writeText": (p) => {
      if (typeof p.text !== "string")
        throw new HostError("invalid", "text requires a string");
      if (Buffer.byteLength(p.text) > 1024 * 1024)
        throw new HostError("invalid", "text must be at most 1 MiB");
      this.clipboard.text = p.text;
    },
    "clipboard.writeImage": (p) => {
      const path = String(p.path);
      if (!path.startsWith("/"))
        throw new HostError("invalid", "image path must be absolute");
      if (!/\.(png|jpe?g)$/i.test(path))
        throw new HostError("invalid", "image must be PNG or JPEG");
      this.clipboard.images.push(path);
    },
    "host.run": (p) => {
      const actions = [
        "play-pause",
        "stop",
        "previous",
        "next",
        "frame-back",
        "frame-forward",
        "seek-backward",
        "seek-forward",
        "rate-down",
        "rate-up",
        "rate-normal",
        "volume-up",
        "volume-down",
        "mute",
      ];
      if (!actions.includes(String(p.action)))
        throw new HostError("invalid", `unknown host action ${p.action}`);
      this.#runCore(String(p.action));
    },
    "player.setStepSeek": (p) => {
      const seconds = Number(p.seconds);
      if (
        !(seconds >= 0.1 && seconds <= 3600) ||
        Math.abs(Math.round(seconds * 10) - seconds * 10) > 1e-9
      )
        throw new HostError("invalid", "seconds must be 0.1..3600 in tenths");
      this.stepSeek = seconds;
    },
    "player.step": (p) => {
      this.#audioCondition(p.expected);
      const s = this.source;
      const reason =
        p.unit === "keyframe"
          ? s.phase === "ready" && s.capabilities.seek && s.hasVideo !== false
            ? null
            : "当前来源不支持此操作"
          : this.#frameCheck(p.direction === "forward");
      if (reason) throw new HostError("unsupported", reason);
      this.steps.push({ unit: String(p.unit), direction: String(p.direction) });
    },
    "power.preventSleep": (p) => {
      if (p.mode !== "off" && p.mode !== "playing")
        throw new HostError("invalid", 'mode must be "off" or "playing"');
      this.power = p.mode;
    },
    "sequence.set": (p) => {
      this.sequence = p.flags as TestHost["sequence"];
      this.setSource({
        sequence: {
          next: this.sequence?.canNext ?? false,
          previous: this.sequence?.canPrevious ?? false,
        },
      });
    },
    "sequence.step": (p) => {
      const direction = String(p.direction);
      const can =
        direction === "next"
          ? this.sequence?.canNext
          : this.sequence?.canPrevious;
      if (!can) throw new HostError("unavailable", `cannot go ${direction}`);
      this.emit("sequence.step", { direction });
    },
    "ui.setMount": (p) => {
      this.#seeImages([p.value!]);
      this.mounted().props[String(p.property)] = p.value!;
    },
    "timeline.marks": () => ({ marks: this.timeline.marks }),
    "drops.provide": (p) => {
      const id = String(p.id);
      const index = this.dropProviders.findIndex((d) => d.id === id);
      if (index >= 0) this.dropProviders.splice(index, 1);
      this.dropProviders.push({ id, extensions: p.extensions as string[] });
    },
    "drops.withdraw": (p) => {
      const index = this.dropProviders.findIndex((d) => d.id === String(p.id));
      if (index >= 0) this.dropProviders.splice(index, 1);
    },
    "drops.listen": (p) => void (this.panelDrops = p.listen === true),
    "appearance.set": (p) => {
      // Like the player: an id it does not have selects the default (the
      // SDK's own `set` refuses one before it gets here).
      const theme = THEMES.find((t) => t === p.theme) ?? THEMES[0]!;
      if (theme !== this.appearance) this.setAppearance(theme);
    },
    "settings.register": (p) => {
      const id = String(p.id);
      if (this.settings.pages.has(id))
        throw new HostError("invalid", `page ${id} already exists`);
      if (this.settings.pages.size >= 8)
        throw new HostError("invalid", "a plugin has at most 8 settings pages");
      this.#seeImages(p.properties as Record<string, Json>);
      const host = this;
      this.settings.pages.set(id, {
        category: String(p.category),
        title: String(p.title),
        order: Number(p.order ?? 0),
        file: String(p.file),
        component: String(p.component),
        global: String(p.global),
        props: { ...(p.properties as Record<string, Json>) },
        emit(callback, ...args) {
          host.emit("ui.callback", {
            view: `$settings:${id}`,
            callback: kebab(callback),
            args,
          });
        },
      });
    },
    "settings.set": (p) => {
      const page = this.settings.pages.get(String(p.id));
      if (!page) throw new HostError("missing", "page not registered");
      this.#seeImages([p.value!]);
      page.props[String(p.property)] = p.value!;
    },
    "settings.unregister": (p) => {
      this.settings.pages.delete(String(p.id));
      if (this.settings.current === String(p.id))
        this.settings.current = [...this.settings.pages.keys()][0] ?? null;
    },
    "settings.show": (p) => {
      const id = p.id === undefined ? null : String(p.id);
      if (id !== null && !this.settings.pages.has(id))
        throw new HostError("invalid", "not a settings page of this plugin");
      this.settings.shows.push(id);
      this.settings.open = true;
      this.settings.current =
        id ??
        (this.settings.current && this.settings.pages.has(this.settings.current)
          ? this.settings.current
          : ([...this.settings.pages.keys()][0] ?? null));
    },
    "video.view.set": (p) => {
      const owner = this.videoView.owner;
      if (owner !== null && owner !== this.manifestId)
        throw new HostError(
          "conflict",
          "another plugin owns the display layer",
        );
      const problem = viewProblem(p.values);
      if (problem) throw new HostError("invalid", problem);
      this.videoView.owner = this.manifestId;
      this.videoView.values = {
        ...this.videoView.values,
        ...(p.values as Partial<ViewSettings>),
      };
      return { state: this.source.phase === "ready" ? "applied" : "waiting" };
    },
    "video.view.release": () => {
      if (this.videoView.owner === this.manifestId)
        this.setVideoViewOwner(null);
      return null;
    },
    "video.render.set": (p) => {
      if (!this.videoRender.gpu)
        throw new HostError(
          "unsupported",
          "render options need GPU rendering; the player renders in software",
        );
      const owner = this.videoRender.owner;
      if (owner !== null && owner !== this.manifestId)
        throw new HostError(
          "conflict",
          "another plugin owns the render options",
        );
      const problem = renderProblem(p.values);
      if (problem) throw new HostError("invalid", problem);
      const values = p.values as Partial<RenderSettings>;
      const missing = values.shaders?.find((path) => !existsSync(path));
      if (missing !== undefined)
        throw new HostError(
          "invalid",
          `shader file does not exist: ${missing}`,
        );
      this.videoRender.owner = this.manifestId;
      this.videoRender.values = { ...this.videoRender.values, ...values };
      return { state: this.source.phase === "ready" ? "applied" : "waiting" };
    },
    "video.render.release": () => {
      if (this.videoRender.owner === this.manifestId)
        this.setVideoRenderOwner(null);
      return null;
    },
    "timeline.set": (p) => {
      if (
        p.sourceId !== undefined &&
        p.sourceId !== this.source.stamp.generation
      )
        return { applied: false };
      const marks = p.marks as { time: Json; kind: Json; title?: Json }[];
      const duration = this.source.duration;
      if (!Array.isArray(marks) || marks.length > 1000)
        throw new HostError("invalid", "a layer holds at most 1000 marks");
      for (const mark of marks) {
        const time = mark.time;
        if (
          typeof time !== "number" ||
          !Number.isFinite(time) ||
          time < 0 ||
          (duration !== null && time > duration)
        )
          throw new HostError("invalid", `time ${time} is outside the media`);
        if (!["chapter", "bookmark", "marker"].includes(String(mark.kind)))
          throw new HostError("invalid", "kind is chapter, bookmark or marker");
        if (
          mark.title !== undefined &&
          mark.title !== null &&
          (typeof mark.title !== "string" || [...mark.title].length > 100)
        )
          throw new HostError("invalid", "title must be ≤ 100 characters");
      }
      this.setTimelineLayer(
        this.manifestId,
        marks.map((m) => ({
          time: m.time as number,
          kind: String(m.kind),
          title: (m.title as string | undefined) ?? null,
        })),
      );
      return { applied: true };
    },
    "ui.interaction": (p) => void (this.mounted().locks = p),
    "dialogs.confirm": (p) => {
      this.confirms.push(p);
      const answer = this.dialogAnswers.shift();
      if (answer === undefined)
        throw new Error("test host: no dialog answer queued");
      if (answer === null || Array.isArray(answer))
        throw new Error("test host: a file dialog answer was queued");
      return { confirmed: answer.confirmed, checked: answer.checked };
    },
    "window.state": () => this.#windowFacts(),
    "window.setVideoArea": (p) => {
      if (this.mainWindow.fullscreen)
        throw new HostError("unavailable", "全屏时不可用");
      const width = Math.max(318, Number(p.width));
      const height = Math.max(120, Number(p.height));
      const clamped = width !== p.width || height !== p.height;
      this.setMainWindow({ videoArea: { width, height } });
      return { width, height, clamped };
    },
    "window.setAlwaysOnTop": (p) =>
      void (this.mainWindow.onTop = p.onTop === true),
    "window.setCursorAutoHide": (p) => {
      if (p.mode !== "fullscreen" && p.mode !== "playing")
        throw new HostError("invalid", "mode is fullscreen or playing");
      this.mainWindow.cursorAutoHide = p.mode;
    },
    "window.setPictureInPicture": (p) => {
      if (typeof p.on !== "boolean")
        throw new HostError("invalid", "on requires a boolean");
      const pip = this.mainWindow.pictureInPicture;
      if (p.on === pip.active) return;
      if (p.on && !pip.supported)
        throw new HostError("unsupported", "此系统不支持画中画");
      const video =
        this.source.phase !== "empty" && this.source.hasVideo !== false;
      if (p.on && !video) throw new HostError("unavailable", "没有视频");
      this.setMainWindow({
        // The player leaves fullscreen before the window opens.
        fullscreen: p.on ? false : this.mainWindow.fullscreen,
        pictureInPicture: { ...pip, active: p.on },
      });
    },
    "player.chapters": () => ({
      sourceId: this.source.stamp.generation,
      chapters:
        this.source.kind === "media" &&
        ["ready", "ended"].includes(this.source.phase)
          ? structuredClone(this.chapters)
          : [],
    }),
    "player.setLoop": (p) => {
      if (this.source.kind === "producer")
        throw new HostError("unsupported", "a generated stream cannot loop");
      this.#audioCondition(p.expected);
      const loop = p.loop as { a: number; b: number; count?: number } | null;
      if (loop && !this.source.capabilities.seek)
        throw new HostError("unsupported", "the source cannot seek");
      if (
        loop &&
        !(
          loop.a >= 0 &&
          loop.a < loop.b &&
          loop.b <= (this.source.duration ?? 0)
        )
      )
        throw new HostError("invalid", "loop needs 0 <= a < b <= duration");
      this.setSource({
        loop: loop && { a: loop.a, b: loop.b, count: loop.count ?? null },
      });
    },
    "dialogs.open": () => {
      const answer = this.dialogAnswers.shift();
      if (answer === undefined)
        throw new Error("test host: no dialog answer queued");
      if (answer !== null && !Array.isArray(answer))
        throw new Error("test host: a confirm answer was queued");
      return answer
        ? { cancelled: false, paths: answer }
        : { cancelled: true, paths: [] };
    },
    "source.state": () => this.source,
    "source.submit": (p) => {
      const intent = p.intent as Record<string, Json>;
      const ticket = this.#intent(intent);
      const operation = Number(p.operationId);
      // A file this plugin's file resolver claims: pending until it answers.
      if (
        intent.kind === "open" &&
        this.#resolve(
          String(intent.source),
          intent.startPaused === true,
          operation,
        ) !== null
      ) {
        const pending = { status: "pending", ...ticket };
        this.#sourceBook.set(operation, pending);
        return pending;
      }
      const result = { status: "completed", ...ticket };
      this.#sourceBook.set(operation, result);
      // Selecting a provider asks it to acknowledge a start control.
      const producer = this.producers.get(Number(intent.producerId));
      if (intent.kind === "openProvider" && producer) {
        producer.acknowledged = false;
        producer.pending = {
          producerId: producer.id,
          epoch: producer.epoch + 1,
          baseSample: producer.receivedFrames,
          paused: false,
        };
      }
      return result;
    },
    "source.operation": (p) => {
      const result = this.#sourceBook.get(Number(p.operationId));
      if (!result) throw new HostError("unknown-expired", "UnknownExpired");
      return result;
    },
    "playback.set": (p) => {
      if (p.property === "volume")
        this.source.output = { ...this.source.output, volume: Number(p.value) };
      if (p.property === "muted")
        this.source.output = { ...this.source.output, muted: p.value === true };
      this.source = {
        ...this.source,
        eventSequence: this.source.eventSequence + 1,
      };
    },
    "processing.state": () => this.#processingState(),
    "processing.replace": (p) => {
      const stage = String(p.stage);
      const key = `${stage}:${p.resourceId}`;
      const token = `${key}:${p.revision}`;
      const finish = (outcome: {
        status: "completed" | "failed";
        result?: Json;
        error?: { code: string; message: string };
      }) => {
        this.processing.book.set(token, outcome);
        if (outcome.error)
          throw new HostError(outcome.error.code, outcome.error.message);
        return outcome.result;
      };
      if (this.processing.backendUncertain[stage as "video"])
        return finish({
          status: "failed",
          error: {
            code: "backend-uncertain",
            message: this.processing.backendUncertain[stage as "video"]!,
          },
        });
      // The same node and delay rules as the player.
      const problem = nodeProblem(
        stage as "video" | "audio",
        (p.nodes ?? []) as { kind: string }[],
      );
      // frameBlend: at most one across every chain (this plugin's others too).
      const blends = [...this.processing.resources]
        .filter(([other]) => other !== key)
        .flatMap(([, resource]) => resource.nodes as { kind: string }[])
        .concat((p.nodes ?? []) as { kind: string }[])
        .filter((node) => node.kind === "frameBlend").length;
      const blend =
        !problem && blends > 1
          ? "only one frameBlend node across all plugins"
          : null;
      const offset = Number(p.offsetMs ?? 0);
      const delay =
        stage === "audio" &&
        (!Number.isInteger(offset) ||
          Math.abs(offset) > 10_000 ||
          offset % 10 !== 0)
          ? "audio offsetMs must be -10000..10000 in 10ms increments"
          : null;
      if (problem || blend || delay)
        return finish({
          status: "failed",
          error: { code: "invalid", message: (problem ?? blend ?? delay)! },
        });
      if (this.source.phase !== "ready")
        return finish({
          status: "failed",
          error: { code: "unavailable", message: "source must be ready" },
        });
      // An empty chain removes the resource (audio: with no delay either).
      const removal =
        ((p.nodes ?? []) as Json[]).length === 0 &&
        (stage === "video" || offset === 0);
      // A generated stream's frames never reach the player's filters.
      if (this.source.kind === "producer" && !removal)
        return finish({
          status: "failed",
          error: {
            code: "unsupported",
            message:
              "generated streams (openStream) do not pass through the player's filters; the chain applies to the next media the player decodes",
          },
        });
      if (p.expectedGeneration !== this.source.stamp.generation)
        return finish({
          status: "failed",
          error: { code: "stale", message: "source generation changed" },
        });
      const old = this.processing.resources.get(key);
      if (old && Number(p.revision) <= old.revision)
        return finish({
          status: "failed",
          error: { code: "stale", message: "resource revision must increase" },
        });
      if (removal) this.processing.resources.delete(key);
      else
        this.processing.resources.set(key, {
          stage,
          revision: Number(p.revision),
          nodes: p.nodes!,
          ...(stage === "audio" ? { offsetMs: Number(p.offsetMs ?? 0) } : {}),
        });
      this.processing.configurationRevision++;
      return finish({
        status: "completed",
        result: {
          stage,
          revision: p.revision!,
          generation: this.source.stamp.generation,
          status: "applied",
        },
      });
    },
    "processing.operation": (p) =>
      this.processing.book.get(`${p.stage}:${p.resourceId}:${p.revision}`) ?? {
        status: "unknown",
      },
    "subtitles.state": () => structuredClone(this.subtitles),
    "subtitles.select": (p) => {
      const target = p.target as SubtitleState["selection"]["target"];
      const same = (a: unknown, b: unknown) =>
        a != null && JSON.stringify(a) === JSON.stringify(b);
      if (p.role === "secondary") {
        if (same(target, this.subtitles.selection.target))
          throw new HostError("invalid", "secondary equals the primary");
        const track = this.subtitles.tracks.find((t) => same(t.target, target));
        if (track && track.text === false)
          throw new HostError(
            "invalid",
            "a bitmap subtitle cannot be secondary",
          );
        this.#subtitleChange(p.expected!);
        this.subtitles.selection.secondary = target;
        return structuredClone(this.subtitles);
      }
      if (same(target, this.subtitles.selection.secondary))
        throw new HostError("invalid", "primary equals the secondary");
      this.#subtitleChange(p.expected!);
      this.subtitles.selection.target = target;
      return structuredClone(this.subtitles);
    },
    "bindings.list": () => this.#bindingTable(),
    "bindings.set": (p) => {
      const key = `${p.plugin}/${p.command}`;
      const known = this.#bindingTable().commands.some(
        (c) => `${c.plugin}/${c.command}` === key,
      );
      if (!known && !this.bindings.overlay.has(key))
        throw new HostError("missing", `no command ${key}`);
      this.bindings.overlay.set(key, [...(p.inputs as string[])]);
      this.emit("bindings.changed", null);
    },
    "bindings.reset": (p) => {
      if (p.plugin === undefined) this.bindings.overlay.clear();
      else this.bindings.overlay.delete(`${p.plugin}/${p.command}`);
      this.emit("bindings.changed", null);
    },
    "packages.list": () => structuredClone(this.packages),
    "packages.setEnabled": (p) => {
      const id = String(p.id);
      if (id === this.manifestId && p.enabled === false)
        throw new HostError("invalid", "a plugin cannot disable itself");
      const entry = this.packages.find((each) => each.id === id);
      if (!entry) throw new HostError("missing", `no plugin ${id}`);
      if (entry.origin === "trial")
        throw new HostError(
          "unsupported",
          "a trial is stopped with its handle",
        );
      this.packageCalls.push({
        method: "setEnabled",
        id,
        enabled: p.enabled === true,
      });
      entry.state = p.enabled === true ? "running" : "disabled";
      this.setPackages(this.packages);
    },
    "packages.validate": (p) => this.#validate(String(p.directory)),
    "packages.validateArchive": (p) => this.#validate(String(p.file)),
    "packages.install": (p) => {
      const manifest = this.candidates.get(String(p.token));
      if (!manifest) throw new HostError("stale", "unknown validation token");
      const source = (p.source as PackageSource | undefined) ?? {
        kind: "file",
      };
      if (source.kind === "bundled")
        throw new HostError("invalid", "source bundled is reserved");
      const replace = p.replace === true;
      const entry = this.packages.find((each) => each.id === manifest.id);
      if (entry?.builtin)
        throw new HostError(
          "unsupported",
          "built-in plugins are updated with the player",
        );
      const identity = (s: PackageSource | null | undefined) =>
        !s || s.kind === "link" || s.kind === "file"
          ? "manual"
          : s.kind === "repository"
            ? `repository ${s.url}`
            : s.kind;
      if (entry && identity(entry.source) !== identity(source) && !replace)
        throw new HostError(
          "conflict",
          `${manifest.id} is installed from another source`,
        );
      this.packageCalls.push({
        method: "install",
        id: manifest.id,
        source,
        replace,
      });
      const next = {
        id: manifest.id,
        version: manifest.version,
        origin: "installed" as const,
        state: "running" as const,
        error: null,
        capabilities: [...manifest.capabilities],
        directory: `/test-host/packages/${manifest.id}`,
        previousVersion:
          entry && identity(entry.source) === identity(source)
            ? entry.version
            : null,
        builtin: false,
        source,
        dataDirectory: entry?.dataDirectory ?? null,
      };
      this.setPackages([
        ...this.packages.filter((each) => each.id !== manifest.id),
        next,
      ]);
      return { operationId: String(p.requestId), status: "committed" };
    },
    "packages.uninstall": (p) => {
      const id = String(p.id);
      const entry = this.packages.find((each) => each.id === id);
      if (!entry) throw new HostError("missing", `no plugin ${id}`);
      if (entry.builtin)
        throw new HostError(
          "unsupported",
          "built-in plugins can be disabled but not uninstalled",
        );
      if (entry.origin !== "installed")
        throw new HostError(
          "unsupported",
          "only installed plugins can be uninstalled",
        );
      this.packageCalls.push({
        method: "uninstall",
        id,
        removeData: p.removeData === true,
      });
      this.setPackages(this.packages.filter((each) => each.id !== id));
      return { operationId: String(p.requestId), status: "committed" };
    },
    "ui.markdownScan": (p) => {
      const text = String(p.text);
      const images = [
        ...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g),
      ].map((m) => m[1]!);
      return { images: [...new Set(images)].slice(0, 64) };
    },
    "packages.installed": (p) => ({
      revision: this.packages.some((each) => each.id === p.id) ? 1 : 0,
      current: null,
      previous: null,
    }),
    "player.audioDevices": () => structuredClone(this.audioDevices),
    "player.setAudioDevice": (p) => {
      const requested = p.id === null ? null : String(p.id);
      const present = this.audioDevices.some((d) => d.id === requested);
      this.setSource({
        audioOutput: { requested, active: present ? requested : null },
      });
    },
    "subtitles.style": (p) => {
      this.#subtitleChange(p.expected!);
      this.subtitles.presentation.revision++;
      this.subtitles.presentation.effective = p.style
        ? {
            owner: 1,
            manifestId: this.manifestId,
            revision: Number(p.revision),
            style: p.style as never,
          }
        : null;
      return structuredClone(this.subtitles);
    },
    "subtitles.upload.begin": (p) => {
      if (p.generation !== this.source.stamp.generation)
        throw new HostError("stale", "source generation changed");
      this.uploads.set(Number(p.uploadId), {
        bytes: [],
        expected: Number(p.expectedBytes),
      });
      return {
        generation: p.generation!,
        expectedBytes: p.expectedBytes!,
        receivedBytes: 0,
        complete: false,
      };
    },
    "subtitles.upload.append": (p) => {
      const upload = this.uploads.get(Number(p.uploadId));
      if (!upload) throw new HostError("missing", "upload");
      upload.bytes.push(Buffer.from(String(p.base64), "base64"));
      return {};
    },
    "subtitles.upload.discard": (p) =>
      void this.uploads.delete(Number(p.uploadId)),
    "subtitles.commit": (p) => {
      const upload = this.uploads.get(Number(p.uploadId));
      if (!upload) throw new HostError("missing", "upload");
      const format = p.format === "ass" ? "ass" : "srt";
      const select =
        p.select === "none"
          ? "none"
          : p.select === "secondary"
            ? "secondary"
            : "primary";
      const title = typeof p.title === "string" ? p.title : null;
      if (title !== null && ([...title].length < 1 || [...title].length > 200))
        throw new HostError(
          "invalid",
          "subtitle title needs 1..200 characters",
        );
      const bytes = Buffer.concat(upload.bytes);
      if (
        format === "ass" &&
        !(
          /\[Script Info\]/i.test(bytes.toString()) &&
          /\[Events\]/i.test(bytes.toString())
        )
      )
        throw new HostError(
          "invalid",
          "ASS requires [Script Info] and [Events] sections",
        );
      this.#subtitleChange(p.expected!);
      const target = {
        kind: "external" as const,
        owner: 1,
        resourceId: String(p.resourceId),
        contentRevision: 1,
      };
      this.subtitles.tracks.push({
        target,
        title: title ?? (format === "ass" ? "外部 ASS" : "外部 SRT"),
        language: null,
        styleSupported: true,
        styleReason: null,
        codec: format === "ass" ? "ass" : "webvtt",
        text: true,
        streamIndex: null,
      });
      if (select === "primary") this.subtitles.selection.target = target;
      if (select === "secondary") this.subtitles.selection.secondary = target;
      this.subtitleLoads.push({ format, title, select, bytes });
      this.uploads.delete(Number(p.uploadId));
      return structuredClone(this.subtitles);
    },
    "subtitles.remove": (p) => {
      this.#subtitleChange(p.expected!);
      this.subtitles.tracks = this.subtitles.tracks.filter(
        (t) =>
          t.target.kind !== "external" || t.target.resourceId !== p.resourceId,
      );
      const selected = this.subtitles.selection.target;
      if (selected?.kind === "external" && selected.resourceId === p.resourceId)
        this.subtitles.selection.target = null;
      const secondary = this.subtitles.selection.secondary;
      if (
        secondary?.kind === "external" &&
        secondary.resourceId === p.resourceId
      )
        this.subtitles.selection.secondary = null;
      return structuredClone(this.subtitles);
    },
    "subtitles.operation": () => ({ status: "unknown" }),
    "snapshot.capture": (p) => {
      const expected = p.expected as SourceStamp;
      if (
        expected.generation !== this.source.stamp.generation ||
        expected.intentVersion !== this.source.stamp.intentVersion
      )
        throw new HostError("stale", "source changed");
      const snapshotId = ++this.#next.snapshot;
      const snapshot = {
        snapshotId,
        kind: p.mode === "processed" ? "processed" : "raw",
        sourceStamp: expected,
        time: Number(p.time ?? this.source.position ?? 0),
        source: this.source.source ?? "",
        duration: this.source.duration ?? 0,
        audio: null,
        ...(p.mode === "processed"
          ? {
              presentation: { width: 1920, height: 1080 },
              processing: { revision: this.processing.configurationRevision },
            }
          : {}),
      };
      this.snapshots.set(snapshotId, snapshot);
      return snapshot;
    },
    "snapshot.state": (p) => this.snapshots.get(Number(p.snapshotId)) ?? null,
    "snapshot.release": (p) => void this.snapshots.delete(Number(p.snapshotId)),
    "jobs.start": (p) => {
      if (!this.snapshots.has(Number(p.snapshotId)))
        throw new HostError("missing", "snapshot released");
      if (
        !/^(raw|processed)(Png|Jpeg|Bmp|Mp4)$/.test(String(p.kind)) ||
        (p.quality !== undefined && !String(p.kind).endsWith("Jpeg"))
      )
        throw new HostError("invalid", `unknown job kind ${p.kind}`);
      this.exports.push(structuredClone(p));
      const jobId = ++this.#next.job;
      this.jobs.set(jobId, {
        jobId,
        status: "queued",
        publicationStarted: false,
        facts: null,
        outcome: null,
      });
      return { jobId, status: "queued", snapshotId: p.snapshotId! };
    },
    // Each read advances a job one step: queued → running → completed.
    "jobs.state": (p) => {
      const job = this.jobs.get(Number(p.jobId));
      if (!job) throw new HostError("missing", "job");
      const current = structuredClone(job);
      if (job.status === "queued") job.status = "running";
      else if (job.status === "running")
        Object.assign(job, {
          status: "completed",
          publicationStarted: true,
          outcome: { destination: "/tmp/output" },
        });
      else if (job.status === "cancelling")
        Object.assign(job, {
          status: "cancelled",
          outcome: { cancelled: true },
        });
      return current;
    },
    "jobs.cancel": (p) => {
      const job = this.jobs.get(Number(p.jobId));
      if (!job) throw new HostError("missing", "job");
      if (["completed", "failed", "cancelled"].includes(job.status))
        return { jobId: job.jobId, cancel: "terminal" };
      job.status = "cancelling";
      return { jobId: job.jobId, cancel: "requested" };
    },
    "jobs.operation": () => ({ status: "unknown" }),
    "sourceResolvers.register": (p) => void this.#register(p),
    "sourceResolvers.unregister": (p) => {
      this.resolvers.delete(String(p.id));
      this.#cancelResolutions();
    },
    "sourceResolvers.respond": (p) => this.#respond(p),
    "producer.prepare": async () => {
      const id = ++this.#next.producer;
      const tcp = this.producerTransport === "tcp";
      const token = tcp ? randomBytes(32) : null;
      const path = join(this.#scratch, `producer-${id}.sock`);
      const producer = {
        id,
        receivedFrames: 0,
        videoFrames: 0,
        released: false,
        droppedWhileSelected: false,
        path,
        admitted: !tcp,
        epoch: 1,
        pending: null as Json | null,
        acknowledged: true,
        active: false,
        server: createServer(),
      };
      producer.server.on("connection", (socket) => {
        let buffer: Buffer = Buffer.alloc(0);
        let admitted = !token;
        socket.on("data", (data: Buffer) => {
          buffer = Buffer.concat([buffer, data]);
          if (!admitted && token) {
            if (buffer.length < token.length) return;
            if (!buffer.subarray(0, token.length).equals(token))
              return void socket.destroy();
            admitted = producer.admitted = true;
            buffer = buffer.subarray(token.length);
          }
          while (buffer.length >= 32) {
            const length = buffer.readUInt32LE(24);
            if (buffer.length < 32 + length) break;
            if (buffer[4] === 1) producer.receivedFrames += length / 8;
            else producer.videoFrames++;
            buffer = buffer.subarray(32 + length);
          }
        });
        socket.on("error", () => {});
        socket.on("close", () => {
          if (this.#current(producer.id)) producer.droppedWhileSelected = true;
        });
      });
      let socket = path;
      if (tcp) {
        await new Promise<void>((resolve) =>
          producer.server.listen(0, "127.0.0.1", resolve),
        );
        const { port } = producer.server.address() as { port: number };
        socket = `tcp://127.0.0.1:${port}`;
      } else producer.server.listen(path);
      this.producers.set(id, producer);
      return {
        producerId: id,
        socket,
        ...(token ? { token: token.toString("hex") } : {}),
        epoch: 1,
        sampleRate: 48000,
        channels: 2,
        sampleFormat: "f32le",
        videoFormat: "rgba8",
        maxAudioFrames: 4800,
        audioCapacityFrames: 9600,
        videoCapacity: 8,
      };
    },
    "producer.state": (p) => {
      const producer = this.producers.get(Number(p.producerId));
      if (!producer) throw new HostError("missing", "producer");
      const current = this.#current(producer.id);
      return {
        input: null,
        pendingControl: producer.pending,
        producerId: producer.id,
        epoch: producer.epoch,
        acknowledged: producer.acknowledged,
        paused: this.source.paused,
        // The fake device consumes everything immediately.
        consumedFrames: producer.receivedFrames,
        underrunFrames: 0,
        deviceErrors: 0,
        health: "ok",
        xrunEvents: 0,
        deviceChangeEvents: 0,
        errorDetails: [],
        errorOverflow: 0,
        buffer: {},
        receivedFrames: producer.receivedFrames,
        hasVideo: producer.videoFrames > 0,
        error: null,
        active: producer.active && current,
      };
    },
    "producer.ack": (p) => {
      const control = (p.control ?? {}) as Record<string, Json>;
      const producer = this.producers.get(Number(control.producerId));
      if (!producer) throw new HostError("missing", "producer");
      producer.pending = null;
      producer.acknowledged = true;
      producer.epoch = Number(control.epoch);
      producer.active = true;
      return { status: "acknowledged", control };
    },
    "producer.ackInput": () => ({ status: "acknowledged", sequence: 0 }),
    "producer.release": (p) => {
      const producer = this.producers.get(Number(p.producerId));
      if (!producer) return;
      producer.released = true;
      producer.server.close();
    },
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
 * `capabilities` are used and no manifest is read. Calls that need an
 * undeclared capability fail with `capability`, as in the player.
 *
 * Rejects when `manifest.json` cannot be read or parsed, when `activate`
 * throws, or when a registration made during activation fails (for example
 * `limit`, `conflict`, `invalid`), which is when the player would fail the
 * activation.
 *
 * @param activate - The plugin's default-exported `activate` function.
 * @param options - Where the plugin lives and how to start it.
 * @returns `host`: the {@link TestHost}; `plugin`: the object passed to
 *   `activate` (call the plugin API on it directly); `stop()`: dispose the
 *   plugin like the player stopping it (scopes released, stores flushed),
 *   wait until the host is idle and remove the host's temporary files.
 *
 * @example
 * ```ts
 * test("remembers the step across restarts", async () => {
 *   const directory = new URL("..", import.meta.url);
 *   const first = await startPlugin(activate, { directory });
 *   await first.host.command("step-10").run();
 *   const data = mkdtempSync(join(tmpdir(), "data-"));
 *   cpSync(first.host.dataDirectory, data, { recursive: true });
 *   await first.stop();
 *
 *   const second = await startPlugin(activate, { directory, dataDirectory: data });
 *   assert.equal(second.host.command("step-10").state.checked, true);
 *   await second.stop();
 * });
 * ```
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
    /** A host to use (to preset data before activation). Default: a new one. */
    host?: TestHost;
    /** Use an existing directory as `plugin.dataDirectory` (to test a restart). */
    dataDirectory?: string;
  } = {},
) {
  const host = options.host ?? new TestHost();
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
  const data = options.dataDirectory ?? host.dataDirectory;
  mkdirSync(data, { recursive: true });
  const instance = await createPlugin(
    host,
    manifest,
    directory,
    data,
    host.app,
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
  return {
    /** The test host the plugin talks to. */
    host,
    /** The `plugin` object passed to `activate`. */
    plugin: instance.plugin,
    /** Stop the plugin, wait for the host, and remove temporary files. */
    async stop() {
      await instance.dispose();
      await host.settle();
      host.close();
    },
  };
}
