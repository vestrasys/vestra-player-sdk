/**
 * Wire clients for the `vestra.experimental/0.1` JSON-RPC protocol. Internal to
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
export type {
  ResolvedMedia,
  ResolvedResource,
  SourceResolverDeclaration,
} from "./source-resolvers.ts";
/** Working contract. Trusted plugin runtime, not a permissions sandbox. */
export const API_VERSION = "vestra.experimental/0.1" as const;
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
export interface PackageTrial {
  trialId: number;
  activationOwner?: number;
  status: string;
  cleanupConfirmed?: boolean;
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
/** A definite refusal from the host (or the runner): `code` is stable. */
export class HostError extends Error {
  code: string;
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
  origin: "installed" | "development" | "trial";
  state: "starting" | "running" | "disabled" | "failed" | "stopped";
  error: string | null;
  capabilities: string[];
  directory: string;
  previousVersion: string | null;
}
/** `bindings.list`. */
export interface BindingTable {
  commands: {
    plugin: string;
    command: string;
    title: string;
    path: string[] | null;
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
  /** The palette (`plugin.appearance`), with the `window.state` reply. */
  appearance?: "vestra" | "potplayer";
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
/** One position (bottom bar or sidebar) as `layout.state` reports it. */
export interface LayoutSlot {
  owner: number;
  preferred: boolean;
  effective: boolean;
  reason: "userHidden" | "space" | "fullscreen" | "idle" | null;
  detached: boolean;
}
export interface PlaybackStats {
  backend: string;
  session: number;
  framesShown: number;
  framesDropped: number | null;
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
export interface Transport {
  request<T>(method: string, params?: Json): Promise<T>;
  on(event: string, listener: (data: unknown) => void): () => void;
  /** Replaces the real local services (test host). */
  local?: LocalServices;
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
        title?: string;
        fileName?: string;
      }) =>
        transport.request<{ cancelled: boolean; paths: string[] }>(
          "dialogs.open",
          options,
        ),
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
        marks: { time: number; kind: string; title?: string }[],
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
    osd: {
      show: (text: string) => transport.request<void>("osd.show", { text }),
      panel: (text: string | null) =>
        transport.request<void>("osd.panel", { text }),
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
      /** `requestId` recovers a lost first reply in this owner session. */
      trial: (token: string, requestId: string) =>
        transport.request<PackageTrial>("packages.trial", {
          token,
          requestId,
        }),
      trialStateByRequest: (requestId: string) =>
        transport.request<PackageTrial>("packages.trialStateByRequest", {
          requestId,
        }),
      trialState: (trialId: number) =>
        transport.request<PackageTrial>("packages.trialState", { trialId }),
      stopTrial: (trialId: number) =>
        transport.request<PackageTrial>("packages.stopTrial", { trialId }),
      installed: (id: string) =>
        transport.request<InstalledPackage>("packages.installed", { id }),
      install: (token: string, expectedRevision: number, requestId: string) =>
        transport.request<PackageOperation>("packages.install", {
          token,
          expectedRevision,
          requestId,
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
