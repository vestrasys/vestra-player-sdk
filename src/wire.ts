/**
 * Wire clients for the `vestra/1` JSON-RPC protocol. Internal to
 * SDK v2 (`sdk/plugin/`): plugins never receive these objects. Each method maps
 * one call to one request and adds nothing; revisions, operation ids,
 * conditional stamps and recovery live in `sdk/plugin/`.
 */
import { commandClient } from "./commands.ts";
import { processingClient } from "./processing.ts";
import { subtitleClient } from "./subtitles.ts";
import { mediaClients } from "./media.ts";
import { producerClient } from "./producer.ts";
import { sourceClient } from "./source.ts";
import { sourceResolverClient } from "./source-resolvers.ts";
import type { SourceAudioTrack, SourceStamp } from "./source.ts";
import type { ArgJson, ListJson, TextJson } from "./i18n.ts";
export type {
  ResolvedMedia,
  ResolvedResource,
  SourceResolverDeclaration,
} from "./source-resolvers.ts";
/** Working contract. Trusted plugin runtime, not a permissions sandbox. */
export const API_VERSION = "vestra/1" as const;
/**
 * A JSON value: what crosses the wire to the player. Slint property values,
 * callback arguments and protocol parameters are all `Json`.
 */
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export interface PluginInfo {
  id: string;
  apiVersion: string;
  entry: string;
  capabilities: string[];
}
export interface PackageValidation {
  token: string;
  digest: string;
  apiVersion: string;
  manifest: PluginInfo & { version: string };
  checks: string[];
  trustedExecution: true;
}
export interface InstalledPackage {
  revision: number;
  current: null | {
    digest: string;
    manifest: PluginInfo & { version: string };
    directory: string;
  };
  previous: InstalledPackage["current"];
}
export interface PackageOperation {
  operationId: string;
  packageId?: string;
  status:
    | "preparing"
    | "activating"
    | "restoring"
    | "committed"
    | "cancelled"
    | "failed"
    | "failedDegraded"
    | "tooLate";
  owner?: number | null;
  installed?: InstalledPackage;
  message?: string | null;
  restored?: boolean;
  cancelRequested?: boolean;
  result?: PackageOperation;
}
export interface UiCallback {
  view: string;
  callback: string;
  args: Json[];
}
/**
 * A definite refusal from the player (or the plugin runner), with a stable
 * `code`. Plugin code sees it as a `PluginError` (an `Error` with `code`);
 * branch on `code`, never on `message`.
 *
 * In tests, throw one from a {@link TestHost.handle} override to simulate the
 * player refusing a request: the SDK treats it exactly like a real refusal
 * (the call rejects with that `code`, nothing is retried). Throwing a plain
 * `Error` instead simulates a lost reply, which makes the SDK run its
 * recovery path (asking the host about the operation again).
 *
 * Common codes: `stale` (the condition no longer holds; nothing was done),
 * `invalid` (bad argument), `missing` (unknown target), `capability`
 * (undeclared capability), `busy`, `conflict`, `unavailable`, `unsupported`
 * (refused, not executed), `backend` (load or parse failure), `failed`,
 * `timeout`, `aborted`, `limit` (a player limit such as the command count),
 * `disabled` (the plugin is stopping).
 *
 * @example
 * ```ts
 * import { HostError, startPlugin } from "@vestra-player/sdk/testing";
 *
 * const { host, plugin, stop } = await startPlugin(activate, { directory });
 * host.handle("clipboard.writeText", () => {
 *   throw new HostError("failed", "the system refused the write");
 * });
 * await assert.rejects(plugin.clipboard.writeText("x"), { code: "failed" });
 * host.reset("clipboard.writeText");
 * await stop();
 * ```
 */
export class HostError extends Error {
  /** The stable error code, e.g. `"invalid"`, `"stale"`, `"unavailable"`. */
  code: string;
  /**
   * @param code - The stable error code the caller will see as `error.code`.
   * @param message - Human-readable detail (not for branching on).
   */
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HostError";
  }
}
/** One plugin as `packages.list` reports it. */
export interface PackageInfo {
  id: string;
  version: string | null;
  origin: "installed" | "development";
  state: "starting" | "running" | "disabled" | "failed" | "stopped";
  error: string | null;
  capabilities: string[];
  directory: string;
  previousVersion: string | null;
  /** Player 0.2.0; absent from older players. */
  builtin?: boolean;
  source?: WireSource | null;
  dataDirectory?: string | null;
  /** What the plugin was refused because another plugin holds it (player 0.4.x, after 0.4.0). */
  warnings?: { code: string; slot?: string; owner?: string }[];
  /** The manifest's display texts in the interface language (player 0.4.3). */
  display?: {
    name: string | null;
    punchline: string | null;
    description: string | null;
    tags: string[];
  };
}
/** Where an installed package came from (`packages.install` `source`). */
export type WireSource =
  | { kind: "repository"; url: string }
  | { kind: "link"; url: string }
  | { kind: "file" }
  | { kind: "workshop" }
  | { kind: "bundled" };
/** `bindings.list`. */
export interface BindingTable {
  commands: {
    plugin: string;
    command: string;
    title: string;
    path: string[] | null;
    /** The path's keys (player 0.4.3). */
    key?: string[] | null;
    scope: "global" | "panel";
    defaults: string[];
    current: string[];
    overridden: boolean;
    shadowed: { input: string; by: { plugin: string; command: string } }[];
    labels: string[];
  }[];
  orphans: { ref: { plugin: string; command: string }; inputs: string[] }[];
}
/** `window.state`: the main window, in logical points (zero without one). */
export interface WindowFacts {
  fullscreen: boolean;
  videoArea: { width: number; height: number };
  /** System picture-in-picture (absent from older players: unsupported). */
  pictureInPicture?: { supported: boolean; active: boolean };
  /** The palette (`plugin.appearance`), with the `window.state` reply; a newer player may name a palette this SDK does not list. */
  appearance?: string;
  /** The file resolvers' extensions (`plugin.resolvers.fileTypes`; player 0.4.2). */
  fileTypes?: string[];
  /** The saved interface language, `"system"` or a locale (player 0.4.3). */
  language?: string;
  /** The interface language of this run (player 0.4.3). */
  locale?: string;
}
/** One timeline mark as the player merges them (`timeline.marks`). */
export interface WireMark {
  time: number;
  kind: "chapter" | "bookmark" | "marker";
  title: string | null;
  plugin: string;
}
/** The backdrop as `layout.state` reports it; `null` without one. */
export interface LayoutBackdrop {
  owner: number;
  effective: boolean;
}
/** One panel of a position, in tab order (`LayoutSlot.panels`). */
export interface LayoutPanel {
  owner: number;
  /** The manifest id of the plugin that mounted it. */
  plugin: string;
  /** The tab label: the mount's `title`, else the plugin's name. */
  title: string;
}
/** One position (bottom bar or sidebar) as `layout.state` reports it. */
export interface LayoutSlot {
  /** The current tab's panel (the only panel of the bottom bar). */
  owner: number;
  preferred: boolean;
  effective: boolean;
  reason: "userHidden" | "space" | "fullscreen" | "idle" | null;
  detached: boolean;
  /** The position's panels in tab order; absent from players without sidebar tabs (0.4.0 and older). */
  panels?: LayoutPanel[];
}
export interface PlaybackStats {
  backend: string;
  session: number;
  framesShown: number;
  framesDropped: number | null;
  /** Player 0.5.1 and newer; the SDK fills in `null`. */
  presentedFps?: number | null;
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    // Round 2 fields are optional on the wire so older test fixtures
    // (`host.stats = {...}`) still type-check; the SDK fills in `null`.
    decoder?: string | null;
    pixelFormat?: string | null;
    colorspace?: string | null;
    displayWidth?: number | null;
    displayHeight?: number | null;
    displayFps?: number | null;
    bitrate?: number | null;
    hwdec?: string | null;
    decoding?: "hardware" | "software" | null;
    transfer?: string | null;
  } | null;
  audio: {
    codec: string | null;
    sampleRate: number | null;
    channels: number | null;
    decoder?: string | null;
    format?: string | null;
    channelLayout?: string | null;
    bitrate?: number | null;
  } | null;
  avSyncMs?: number | null;
  cacheSeconds?: number | null;
}
/**
 * Work the plugin process does itself (no host protocol): external tools.
 * The runner uses the real system; the test host supplies fakes.
 */
export interface LocalServices {
  run(
    path: string,
    args: string[],
    options: { timeoutMs: number; maxOutput: number; signal: AbortSignal },
  ): Promise<{ stdout: Uint8Array; stderr: string }>;
  /** Where a tool's executable is, or null when it cannot be found. */
  locate(tool: "ffmpeg" | "ffprobe"): Promise<string | null>;
  /**
   * Fetch an image for a Markdown document (the test host's fake); the
   * real one downloads over `https:`.
   */
  download?(
    url: string,
    options: { maxBytes: number; signal: AbortSignal },
  ): Promise<Uint8Array>;
}

/** `app.system`: the operating system and the displays. */
export interface WireSystemInfo {
  os: "macos" | "windows" | "linux" | "other";
  name: string;
  version: string | null;
  build: string | null;
  model: string | null;
  arch: string;
  displays: {
    name: string | null;
    width: number;
    height: number;
    scale: number;
    refreshRate: number | null;
    primary: boolean;
  }[];
}
/**
 * Template arguments on the wire (`osd.show`, `osd.panel`, `dialogs.confirm`,
 * a text's `args`): data, or text values (player 0.4.3).
 */
export type TemplateArgsJson = ArgJson[] | { [name: string]: ArgJson };
/** A text the player shows: source text, or a text value (player 0.4.3). */
export type TextValueJson = string | TextJson | ListJson;

export interface Transport {
  request<T>(method: string, params?: Json): Promise<T>;
  on(event: string, listener: (data: unknown) => void): () => void;
  /** Replaces the real local services (test host). */
  local?: LocalServices;
  /**
   * The interface language of this run (`plugin.i18n.locale`): the runner
   * passes the player's `VESTRA_LOCALE`, the test host its `locale`.
   */
  locale?: string;
}

export function createWire(transport: Transport) {
  const subscriptions = new Map<
    string,
    { count: number; ready: Promise<unknown> }
  >();
  return {
    source: sourceClient(transport),
    sourceResolvers: sourceResolverClient(transport),
    producer: producerClient(transport),
    subtitles: subtitleClient(transport),
    ...mediaClients(transport),
    processing: processingClient(transport),
    commands: commandClient(transport),
    dialogs: {
      open: (options: {
        kind: "openFile" | "openFiles" | "openDirectory" | "saveFile";
        title?: TextValueJson;
        fileName?: TextValueJson;
      }) =>
        transport.request<{ cancelled: boolean; paths: string[] }>(
          "dialogs.open",
          options,
        ),
      /** Message and detail are templates formatted with `args` (player 0.4.3). */
      confirm: (options: { [key: string]: Json }) =>
        transport.request<{ confirmed: boolean; checked: boolean }>(
          "dialogs.confirm",
          options,
        ),
    },
    /** The main window: its state, size, level, pointer hiding and picture-in-picture. */
    window: {
      state: () => transport.request<WindowFacts>("window.state"),
      setVideoArea: (width: number, height: number) =>
        transport.request<{ width: number; height: number; clamped: boolean }>(
          "window.setVideoArea",
          { width, height },
        ),
      setAlwaysOnTop: (onTop: boolean) =>
        transport.request<void>("window.setAlwaysOnTop", { onTop }),
      setCursorAutoHide: (mode: "fullscreen" | "playing") =>
        transport.request<void>("window.setCursorAutoHide", { mode }),
      setPictureInPicture: (on: boolean) =>
        transport.request<void>("window.setPictureInPicture", { on }),
    },
    /** Output devices (mpv ids) and the one to play on. */
    audioOutput: {
      devices: () =>
        transport.request<{ id: string; name: string }[]>(
          "player.audioDevices",
        ),
      set: (id: string | null) =>
        transport.request<void>("player.setAudioDevice", { id }),
    },
    /** The binding table: list, user overlay (`bindings.manage`). */
    bindings: {
      list: () => transport.request<BindingTable>("bindings.list"),
      set: (plugin: string, command: string, inputs: string[]) =>
        transport.request<void>("bindings.set", { plugin, command, inputs }),
      reset: (ref?: { plugin: string; command: string }) =>
        transport.request<void>("bindings.reset", ref ?? {}),
    },
    /** File drops: providers by extension, panel listeners (`ui.drop`). */
    drops: {
      provide: (id: string, extensions: string[]) =>
        transport.request<void>("drops.provide", { id, extensions }),
      withdraw: (id: string) =>
        transport.request<void>("drops.withdraw", { id }),
      listen: (listen: boolean) =>
        transport.request<void>("drops.listen", { listen }),
    },
    /** The palette (`ui.theme` to change it). */
    appearance: {
      set: (theme: string) =>
        transport.request<void>("appearance.set", { theme }),
      /** The interface language for the next start (player 0.4.3). */
      setLanguage: (language: string) =>
        transport.request<void>("appearance.setLanguage", { language }),
    },
    /** Settings pages in the player's options window (`ui.settings`). */
    settings: {
      register: (options: {
        id: string;
        category: string;
        title: string;
        order?: number;
        file: string;
        component: string;
        global: string;
        properties: Record<string, Json>;
      }) => transport.request<void>("settings.register", options),
      set: (id: string, property: string, value: Json) =>
        transport.request<void>("settings.set", { id, property, value }),
      unregister: (id: string) =>
        transport.request<void>("settings.unregister", { id }),
      show: (id?: string) =>
        transport.request<void>(
          "settings.show",
          id === undefined ? {} : { id },
        ),
    },
    /** The display layer (`plugin.video.view()`); the host checks ownership. */
    video: {
      viewSet: (values: {
        aspect: number | null;
        fit: "keep" | "stretch" | "fill";
        zoom: number;
        panX: number;
        panY: number;
      }) =>
        transport.request<{ state: "applied" | "waiting" }>("video.view.set", {
          values,
        }),
      viewRelease: () => transport.request<void>("video.view.release"),
      /** The GPU renderer's options (`plugin.video.render()`). */
      renderSet: (values: {
        toneMapping: string;
        targetPeak: number;
        peakDetect: boolean;
        shaders: string[];
        interpolation: boolean;
      }) =>
        transport.request<{ state: "applied" | "waiting" }>(
          "video.render.set",
          { values },
        ),
      renderRelease: () => transport.request<void>("video.render.release"),
    },
    /** Mark layers on the seek bar (`plugin.timeline`). */
    timeline: {
      marks: () => transport.request<{ marks: WireMark[] }>("timeline.marks"),
      set: (
        marks: { time: number; kind: string; title?: string | TextJson }[],
        sourceId?: number,
      ) =>
        transport.request<{ applied: boolean }>("timeline.set", {
          marks,
          ...(sourceId === undefined ? {} : { sourceId }),
        }),
    },
    /** Chapters and the A-B loop of the current media. */
    marks: {
      chapters: () =>
        transport.request<{
          sourceId: number;
          chapters: { title: string | null; start: number }[];
        }>("player.chapters"),
      setLoop: (
        loop: { a: number; b: number; count?: number } | null,
        expected?: SourceStamp,
      ) =>
        transport.request<void>("player.setLoop", {
          loop,
          ...(expected ? { expected } : {}),
        }),
    },
    playback: {
      /** Shared device output. Does not advance source intent. */
      set: (property: "volume" | "muted", value: number | boolean) =>
        transport.request<void>("playback.set", { property, value }),
      stats: () => transport.request<PlaybackStats>("playback.stats"),
    },
    /** External audio files and the selected audio track of the current media. */
    audio: {
      add: (path: string, select: boolean, expected?: SourceStamp) =>
        transport.request<SourceAudioTrack>("audio.addTrack", {
          path,
          select,
          ...(expected ? { expected } : {}),
        }),
      select: (id: number, expected?: SourceStamp) =>
        transport.request<void>("audio.selectTrack", {
          id,
          ...(expected ? { expected } : {}),
        }),
    },
    /** The core's own playback actions; resolves when the action finished. */
    host: {
      run: (action: string) => transport.request<void>("host.run", { action }),
    },
    step: {
      step: (unit: string, direction: string, expected?: SourceStamp) =>
        transport.request<void>("player.step", {
          unit,
          direction,
          ...(expected ? { expected } : {}),
        }),
      setStepSeek: (seconds: number) =>
        transport.request<void>("player.setStepSeek", { seconds }),
    },
    clipboard: {
      readText: () => transport.request<string | null>("clipboard.readText"),
      writeText: (text: string) =>
        transport.request<void>("clipboard.writeText", { text }),
      writeImage: (path: string) =>
        transport.request<void>("clipboard.writeImage", { path }),
    },
    /** Files, folders and links shown or opened by the player. */
    system: {
      reveal: (paths: string[]) =>
        transport.request<void>("system.reveal", { paths }),
      openPath: (path: string) =>
        transport.request<void>("system.openPath", { path }),
      openUrl: (url: string) =>
        transport.request<void>("system.openUrl", { url }),
    },
    /** The system's secret store, per plugin (`secrets`). */
    secrets: {
      get: (name: string) =>
        transport.request<string | null>("secrets.get", { name }),
      set: (name: string, value: string) =>
        transport.request<void>("secrets.set", { name, value }),
      delete: (name: string) =>
        transport.request<void>("secrets.delete", { name }),
    },
    app: {
      system: () => transport.request<WireSystemInfo>("app.system"),
    },
    power: {
      preventSleep: (mode: "off" | "playing") =>
        transport.request<void>("power.preventSleep", { mode }),
    },
    /** Shared next/previous; the host routes `sequence.step` events to the provider. */
    sequence: {
      set: (flags: { canNext: boolean; canPrevious: boolean } | null) =>
        transport.request<void>("sequence.set", { flags }),
      step: (direction: "next" | "previous") =>
        transport.request<void>("sequence.step", { direction }),
    },
    /** `text` is a template in the plugin's catalog, formatted with `args` (player 0.4.3). */
    osd: {
      show: (text: TextValueJson, args?: TemplateArgsJson) =>
        transport.request<void>("osd.show", {
          text,
          ...(args === undefined ? {} : { args }),
        }),
      panel: (
        text: TextValueJson | null,
        args?: TemplateArgsJson,
        maxColumns?: number,
      ) =>
        transport.request<void>("osd.panel", {
          text,
          ...(args === undefined ? {} : { args }),
          ...(maxColumns === undefined ? {} : { maxColumns }),
        }),
    },
    layout: {
      state: () =>
        transport.request<{
          bottom: LayoutSlot | null;
          sidebar: LayoutSlot | null;
          backdrop?: LayoutBackdrop | null;
        }>("layout.state"),
      set: (options: {
        slot: "bottom" | "sidebar";
        visible?: boolean;
        detached?: boolean;
        /** The plugin id of the panel whose tab becomes the current one. */
        active?: string;
      }) => transport.request<void>("layout.set", options),
    },
    events: {
      /** One `events.subscribe` per name however many listeners. */
      async subscribe(
        event:
          | "source.state"
          | "playback.backend"
          | "window.state"
          | "packages.changed"
          | "bindings.changed"
          | "timeline.changed"
          | "appearance.changed",
        listener: (data: unknown) => void,
      ) {
        const off = transport.on(event, listener);
        let subscription = subscriptions.get(event);
        if (!subscription) {
          subscription = {
            count: 0,
            ready: transport.request("events.subscribe", { event }),
          };
          subscriptions.set(event, subscription);
        }
        subscription.count++;
        try {
          await subscription.ready;
        } catch (error) {
          off();
          subscriptions.delete(event);
          throw error;
        }
        let active = true;
        return async () => {
          if (!active) return;
          active = false;
          off();
          if (--subscription.count === 0) {
            subscriptions.delete(event);
            await transport.request("events.unsubscribe", { event });
          }
        };
      },
    },
    ui: {
      /** Player 0.2.0: the remote images a Markdown document shows. */
      markdownScan: (text: string, base: string | null) =>
        transport.request<{ images: string[] }>("ui.markdownScan", {
          text,
          base,
        }),
      mount: (options: {
        slot: "bottom" | "sidebar" | "backdrop";
        file: string;
        component: string;
        global: string;
        title?: string;
        properties?: Record<string, Json>;
      }) =>
        transport.request<{
          status: "ready";
          prepareMs: number;
          shellGeneration: number;
        }>("ui.mount", options),
      setMount: (property: string, value: Json) =>
        transport.request<void>("ui.setMount", { property, value }),
      interaction: (locks: {
        focused: boolean;
        dragging: boolean;
        popupOpen: boolean;
      }) => transport.request<void>("ui.interaction", locks),
      unmount: () => transport.request<void>("ui.unmount"),
      menu: (items: (string | null)[], x: number, y: number) =>
        transport.request<void>("ui.menu", { items, x, y }),
      open: (
        id: string,
        file: string,
        properties: Record<string, Json> = {},
        callbacks: string[] = [],
      ) =>
        transport.request<void>("ui.open", { id, file, properties, callbacks }),
      set: (id: string, property: string, value: Json) =>
        transport.request<void>("ui.set", { id, property, value }),
      show: (id: string, visible: boolean) =>
        transport.request<void>("ui.show", { id, visible }),
      close: (id: string) => transport.request<void>("ui.close", { id }),
    },
    /** Executes trusted package code. Validation checks production JS and Slint. */
    packages: {
      validate: (directory: string, apiVersion: string = API_VERSION) =>
        transport.request<PackageValidation>("packages.validate", {
          directory,
          apiVersion,
        }),
      /** Player 0.2.0: a `.vxp` file. */
      validateArchive: (file: string) =>
        transport.request<PackageValidation>("packages.validateArchive", {
          file,
        }),
      installed: (id: string) =>
        transport.request<InstalledPackage>("packages.installed", { id }),
      /** `source` and `replace` are sent only when given (player 0.2.0). */
      install: (
        token: string,
        expectedRevision: number,
        requestId: string,
        options: { source?: WireSource; replace?: boolean } = {},
      ) =>
        transport.request<PackageOperation>("packages.install", {
          token,
          expectedRevision,
          requestId,
          ...(options.source === undefined ? {} : { source: options.source }),
          ...(options.replace ? { replace: true } : {}),
        }),
      rollback: (id: string, expectedRevision: number, requestId: string) =>
        transport.request<PackageOperation>("packages.rollback", {
          id,
          expectedRevision,
          requestId,
        }),
      operation: (operationId: string) =>
        transport.request<PackageOperation>("packages.operation", {
          operationId,
        }),
      cancel: (operationId: string) =>
        transport.request<PackageOperation>("packages.cancel", { operationId }),
      list: () => transport.request<PackageInfo[]>("packages.list"),
      setEnabled: (id: string, enabled: boolean) =>
        transport.request<void>("packages.setEnabled", { id, enabled }),
      uninstall: (
        id: string,
        removeData: boolean,
        expectedRevision: number,
        requestId: string,
      ) =>
        transport.request<PackageOperation>("packages.uninstall", {
          id,
          removeData,
          expectedRevision,
          requestId,
        }),
    },
  };
}
export type Wire = ReturnType<typeof createWire>;
