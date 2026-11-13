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
 *
 * @since 1.0.0
 * @category Plugin
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
 * One row operation of a list property's patch, by index, applied to the result
 * of the ones before (feature `ui.patch`).
 *
 * @remarks
 * Part of the wire protocol, which is not semver: this type changes with
 * versions. `set` replaces the row at `at`; `insert` puts `rows` before
 * index `at` (the list's length: at the end); `remove` takes `count` rows
 * out at `at`; `move` takes `count` rows out at `from` and puts them back
 * at `to`, an index of the list without them. The SDK sends them for
 * bound lists by itself; a plugin writes them with
 * {@link WireView.writeRows}.
 *
 * @example Move the first row to the end
 * A three-row list becomes rows 2, 3, 1: the first row is taken out and
 * put back at index 2 of the two rows left.
 * ```ts
 * const op: RowOp = { op: "move", from: 0, count: 1, to: 2 };
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export type RowOp =
  | {
      /** Replace one row. */
      op: "set";
      /** The row's index. */
      at: number;
      /** The new row. */
      row: Json;
    }
  | {
      /** Insert rows. */
      op: "insert";
      /** The index the first new row gets (the list's length: at the end). */
      at: number;
      /** The new rows, in order. */
      rows: Json[];
    }
  | {
      /** Remove a run of rows. */
      op: "remove";
      /** The index of the first row removed. */
      at: number;
      /** How many rows. */
      count: number;
    }
  | {
      /** Move a run of rows. */
      op: "move";
      /** The index of the first row moved. */
      from: number;
      /** How many rows. */
      count: number;
      /** Where they go, an index of the list without them. */
      to: number;
    };
/**
 * One write of a view property as the player takes it: a whole value, or
 * a row patch of a list.
 *
 * @remarks
 * Part of the wire protocol, which is not semver: this type changes with
 * versions. `{ value }` replaces the property; to a player that takes row
 * patches it carries a `seq` that later patches apply on.
 * `{ patch: { base, seq, ops } }` applies `ops` on the write numbered `base`
 * (0: the view's initial properties) and is numbered `seq` itself; the player
 * refuses it with `stale` when the property changed since `base`. `more` marks
 * a part of a whole value sent in several, not the last: the player shows the
 * value at the last part. The SDK writes these for `set()` and `bind()`; a
 * plugin writes them with {@link WireView.write}.
 *
 * @example Write a whole list, numbered
 * The property `items` becomes a list of two rows; a later patch with
 * `base: 7` applies on it.
 * ```ts
 * const write: PropertyWrite = { value: [{ id: "a" }, { id: "b" }], seq: 7 };
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export type PropertyWrite =
  | {
      /** The property's new value. */
      value: Json;
      /** This write's number, which later patches name as their `base`. */
      seq?: number;
      /** A part of a whole value sent in parts, not the last. */
      more?: boolean;
    }
  | {
      /** Row operations on a list property. */
      patch: {
        /** The `seq` of the write they apply on (0: the initial properties). */
        base: number;
        /** This patch's own number (1 or more). */
        seq: number;
        /** The operations, applied in order. */
        ops: RowOp[];
      };
      /** A part of a whole value sent in parts, not the last. */
      more?: boolean;
    };
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
 * @example Simulate the player refusing a clipboard write in a test
 * The test proves the plugin sees a refused write as an error with code
 * `failed`. `host.handle` replaces the test host's handler for one request
 * method; the `HostError` it throws travels back like the player's own
 * refusal, so the call rejects with that `code` and is not retried.
 * `host.reset` puts the default handler back for later steps.
 * ```ts
 * import assert from "node:assert/strict";
 * import { HostError, startPlugin } from "@vestra-player/sdk/testing";
 * import activate from "../main.ts";
 *
 * const { host, plugin, stop } = await startPlugin(activate, {
 *   directory: new URL("..", import.meta.url),
 * });
 * host.handle("clipboard.writeText", () => {
 *   throw new HostError("failed", "the system refused the write");
 * });
 * await assert.rejects(plugin.clipboard.writeText("x"), { code: "failed" });
 * host.reset("clipboard.writeText"); // writes succeed again
 * await stop();
 * ```
 *
 * @remarks
 * A definite refusal, as opposed to a lost reply: the SDK does not retry
 * it, and the plugin sees an `Error` with `code`.
 *
 * @capability None.
 * @since 1.0.0
 * @category Testing
 */
export class HostError extends Error {
  /** The stable error code, e.g. `"invalid"`, `"stale"`, `"unavailable"`. */
  code: string;
  /**
   * A refusal with this code, as the player would send it.
   *
   * @param code - The stable error code the caller will see as `error.code`.
   * @param message - Human-readable detail (not for branching on).
   */
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HostError";
  }
}
/**
 * One plugin as `packages.list` and the event `packages.changed` report
 * it: what `PluginInfo` (`plugin.packages`) is made from.
 *
 * @remarks
 * The player's wire shape (`packages.list`, `packages.changed`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface PackageInfo {
  /** The manifest id. */
  id: string;
  /** The installed version; `null` for a development directory without one. */
  version: string | null;
  /** Installed from a package, or loaded from a development directory. */
  origin: "installed" | "development";
  /** Its lifecycle state. */
  state: "starting" | "running" | "disabled" | "failed" | "stopped";
  /** Why it failed, when `state` is `failed`; else `null`. */
  error: string | null;
  /** The capabilities its manifest declares. */
  capabilities: string[];
  /** Its directory on disk. */
  directory: string;
  /** One of the player's built-in plugins. */
  builtin?: boolean;
  /** Where an installed package came from; `null` for a development directory. */
  source?: WireSource | null;
  /** Its data directory, `null` when it has none. */
  dataDirectory?: string | null;
  /** What the plugin was refused because another plugin holds it. */
  warnings?: {
    /** Why: `slot-occupied`, `sequence-taken` or `resolver-taken`; a newer player may add codes. */
    code: string;
    /** The panel position concerned, if any. */
    slot?: string;
    /** The manifest id of the plugin holding it, if any. */
    owner?: string;
  }[];
  /** The manifest's display texts in the interface language. */
  display?: {
    /** The display name, or `null`. */
    name: string | null;
    /** The one-line pitch, or `null`. */
    punchline: string | null;
    /** The description, or `null`. */
    description: string | null;
    /** The store tags. */
    tags: string[];
  };
  /** Whether it has a process now (`state: "running"`). */
  process?: "running" | "idle";
}
/**
 * Where an installed package came from (`packages.install` `source`),
 * as {@link PackageInfo.source} reports it.
 *
 * @remarks
 * The player's wire shape (`source` of `packages.list`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export type WireSource =
  | {
      /** A plugin repository. */
      kind: "repository";
      /** The repository's URL. */
      url: string;
    }
  | {
      /** A download link. */
      kind: "link";
      /** The link. */
      url: string;
    }
  | {
      /** A package file. */
      kind: "file";
    }
  | {
      /** The plugin workshop. */
      kind: "workshop";
    }
  | {
      /** Shipped with the player. */
      kind: "bundled";
    };
/** `bindings.list`. */
export interface BindingTable {
  commands: {
    plugin: string;
    command: string;
    title: string;
    path: string[] | null;
    /** The path's keys. */
    key?: string[] | null;
    /** The shown category. */
    category?: string | null;
    scope: "global" | "panel";
    defaults: string[];
    current: string[];
    overridden: boolean;
    shadowed: { input: string; by: { plugin: string; command: string } }[];
    labels: string[];
  }[];
  orphans: { ref: { plugin: string; command: string }; inputs: string[] }[];
}
/**
 * The main window as `window.state` reports it, in logical points (zero
 * without one): what `WindowState` (`plugin.window`) is made from, plus
 * the palette, the resolvers' file types and the language that come with
 * the same answer.
 *
 * @remarks
 * The player's wire shape (`window.state`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface WindowFacts {
  /** The main window is fullscreen. */
  fullscreen: boolean;
  /** The main window is maximized, `false` in fullscreen. */
  maximized?: boolean;
  /** The video area's size. */
  videoArea: {
    /** Width in logical points. */
    width: number;
    /** Height in logical points. */
    height: number;
  };
  /** System picture-in-picture. */
  pictureInPicture?: {
    /** The system offers it. */
    supported: boolean;
    /** It is on. */
    active: boolean;
  };
  /** The palette (`plugin.appearance`), with the `window.state` reply; a newer player may name a palette this SDK does not list. */
  appearance?: string;
  /** The file resolvers' extensions (as `resolvers.fileTypes` carries them). */
  fileTypes?: string[];
  /** The saved interface language, `"system"` or a locale. */
  language?: string;
  /** The interface language of this run. */
  locale?: string;
}
/**
 * One timeline mark as the player merges them (`timeline.marks`): what
 * `TimelineMark` is made from.
 *
 * @remarks
 * The player's wire shape (`timeline.marks`, `timeline.changed`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface WireMark {
  /** Its position in seconds. */
  time: number;
  /** What it marks. */
  kind: "chapter" | "bookmark" | "marker";
  /** Its title, or `null`. */
  title: string | null;
  /** The manifest id of the plugin that published it. */
  plugin: string;
}
/**
 * One timeline range as the player merges them: what `TimelineRange` is made
 * from.
 *
 * @remarks
 * The player's wire shape (`timeline.marks`, `timeline.changed`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface WireRange {
  /** Its start in seconds. */
  start: number;
  /** Its end in seconds. */
  end: number;
  /** How it is drawn. */
  style: "selection" | "region";
  /** Its title, or `null`. */
  title: string | null;
  /** The manifest id of the plugin that published it. */
  plugin: string;
}
/**
 * Every timeline mark and range, merged from every layer: the answer to
 * `timeline.marks` and the data of the event `timeline.changed`.
 *
 * @remarks
 * The player's wire shape (`timeline.marks`, `timeline.changed`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface WireTimeline {
  /** The marks, in time order. */
  marks: WireMark[];
  /** The ranges. */
  ranges?: WireRange[];
}
/** A panel position (`ui.mount`'s `slot`). */
export type MountSlot = "bottom" | "sidebar" | "backdrop" | "adjust";
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
/**
 * One position (the bottom bar, the sidebar or, the adjust column) as
 * `layout.state` reports it.
 */
export interface LayoutSlot {
  /** The current tab's panel (the only panel of the bottom bar). */
  owner: number;
  preferred: boolean;
  effective: boolean;
  reason: "userHidden" | "space" | "fullscreen" | "idle" | null;
  detached: boolean;
  /** The position's panels in tab order. */
  panels?: LayoutPanel[];
}
export interface PlaybackStats {
  backend: string;
  session: number;
  framesShown: number;
  framesDropped: number | null;
  /** Frames presented per second; the SDK fills in `null` when absent. */
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

/** `app.system`: the operating system, the displays and the renderer. */
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
  /** The renderer drawing now. */
  rendering?: "gpu" | "software";
  /** Why `rendering` is what it is. */
  renderingReason?: WireRenderingReason;
}
/**
 * A rendering reason: a stable kebab-case `code` and English text.
 *
 * @remarks
 * The player's wire shape (`rendering.state`, `app.system`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface WireRenderingReason {
  /** The stable code, to branch on. */
  code: string;
  /** English text, to show. */
  message: string;
}
/** `rendering.state` and `rendering.setPreference`. */
export interface WireRenderingState {
  mode: "gpu" | "software";
  reason: WireRenderingReason;
  preference: "auto" | "gpu" | "software";
  nextMode: "gpu" | "software";
  nextReason: WireRenderingReason;
  restartPending: boolean;
  gpu: { available: boolean; reason: WireRenderingReason | null };
}
/**
 * An upscaling reason: `{ code, message }` as a rendering reason; with
 * `decoding` a `cause`, with cause `copy-back` the `plugins`. What
 * `UpscalingReason` is made from.
 *
 * @remarks
 * The player's wire shape (`video.upscaling.state`, `video.upscaling.changed`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface WireUpscalingReason extends WireRenderingReason {
  /** Why decoding stands in the way, with code `decoding`. */
  cause?: string;
  /** The plugins whose filters copy frames back, with cause `copy-back`. */
  plugins?: {
    /** The plugin's id. */
    id: string;
    /** Its display name. */
    name: string;
  }[];
}
/**
 * The GPU video upscaler's state as `video.upscaling.state` and
 * `video.upscaling.set` answer it (also sent without `enabled` as the event
 * `video.upscaling.changed`): what `UpscalingState` is made from.
 *
 * @remarks
 * The player's wire shape (`video.upscaling.state`, `video.upscaling.changed`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.0
 * @category Playback
 */
export interface WireUpscalingState {
  /** The upscaler works now. */
  available: boolean;
  /** Why not, when `available` is `false`; else `null`. */
  reason: WireUpscalingReason | null;
  /** This plugin asked for upscaling and has not turned it off. */
  enabled: boolean;
  /** The player has the upscaler in the video filter chain now, for this plugin or another one. */
  requested: boolean;
  /** The scale factor the upscaler was asked for, in hundredths; `null` while nothing is requested. */
  factor: number | null;
  /** The video's size as the upscaler gets it; `null` while no video decodes. */
  video?: {
    /** The frames' stored width in pixels. */
    width: number;
    /** The frames' stored height in pixels. */
    height: number;
    /** The width the video is meant to be shown at (non-square pixels). */
    displayWidth: number;
    /** The height the video is meant to be shown at. */
    displayHeight: number;
  } | null;
  /** The area the video is shown in, in pixels; `null` while the player shows no video area. */
  area?: {
    /** Width in physical pixels. */
    width: number;
    /** Height in physical pixels. */
    height: number;
  } | null;
  /** The name of the GPU that renders; `null` in software rendering or where the player does not know it. */
  gpu?: string | null;
  /** The hardware decoder in use, as mpv names it (`no`: software); `null` while no video decodes. */
  hwdecCurrent?: string | null;
  /** The upscaler is in the player's video filter chain now, read from the chain itself. */
  inChain?: boolean;
}
/**
 * Motion smoothing's state as `video.motion.state` and `video.motion.set`
 * answer it (also sent without `mode` as the event `video.motion.changed`):
 * what `MotionState` is made from. A reason is `{ code, message }`, as a
 * rendering reason.
 *
 * @remarks
 * The player's wire shape (`video.motion.state`, `video.motion.changed`), part of the protocol, which is not
 * semver: it can gain fields with a player version.
 *
 * @since 1.7.19
 * @category Playback
 */
export interface WireMotionState {
  /** The converter this state is of (`amd`; `nvidia` is reserved). */
  engine: string;
  /** This plugin's own mode (`off`, `double` or `display`). */
  mode: "off" | "double" | "display";
  /** What the player does now, for this plugin or another one. */
  active: "off" | "double" | "display";
  /** Why Double Frame Rate cannot work now; `null` while it can. */
  double: WireRenderingReason | null;
  /** Why Match Display cannot work now; `null` while it can. */
  display: WireRenderingReason | null;
  /** The converter's motion search while it runs; `null` while off. */
  searchMode: "native" | "performance" | null;
  /** The converter's input rate (`MotionState.sourceFps`); `null` while unknown. */
  sourceFps: number | null;
  /** The converter's output rate, measured; `null` while off. */
  outputFps: number | null;
  /** The display's refresh rate the player paces to. */
  displayFps: number;
  /** The GPU that converts; `null` where there is none. */
  gpu: string | null;
  /** The converter is in the player's video filter chain now. */
  inChain: boolean;
}
/**
 * Template arguments on the wire (`osd.show`, `osd.panel`, `dialogs.confirm`, a
 * text's `args`): data, or text values.
 */
export type TemplateArgsJson = ArgJson[] | { [name: string]: ArgJson };
/** A text the player shows: source text, or a text value. */
export type TextValueJson = string | TextJson | ListJson;

export interface Transport {
  /**
   * One request. `options` belong to the plugin's side (the SDK's request
   * queue, `request-queue.ts`) and are never sent; a runner ignores them.
   */
  request<T>(
    method: string,
    params?: Json,
    options?: { signal?: AbortSignal },
  ): Promise<T>;
  on(event: string, listener: (data: unknown) => void): () => void;
  /** Replaces the real local services (test host). */
  local?: LocalServices;
  /**
   * The interface language of this run (`plugin.i18n.locale`): the runner
   * passes the player's `VESTRA_LOCALE`, the test host its `locale`.
   */
  locale?: string;
}

/**
 * The events a plugin subscribes to (`events.subscribe`). The plugin API names
 * the same list `HostEvent` (`plugin.player.on`); a test keeps the two equal.
 */
export type HostEvent =
  | "source.state"
  | "playback.backend"
  | "window.state"
  | "packages.changed"
  | "bindings.changed"
  | "commands.keys"
  | "timeline.changed"
  | "appearance.changed"
  | "resolvers.fileTypes"
  | "video.upscaling.changed"
  | "video.motion.changed";

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
    /** The command palette's lead row. */
    palette: {
      set: (options: { [key: string]: Json }) =>
        transport.request<void>("palette.lead.set", options),
      clear: () => transport.request<void>("palette.lead.clear", {}),
      done: (ticket: string) =>
        transport.request<void>("palette.lead.done", { ticket }),
    },
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
      /** Message and detail are templates formatted with `args`. */
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
    /** The binding table: list, user overlay (`player`). */
    bindings: {
      list: () => transport.request<BindingTable>("bindings.list"),
      set: (plugin: string, command: string, inputs: string[]) =>
        transport.request<void>("bindings.set", { plugin, command, inputs }),
      reset: (ref?: { plugin: string; command: string }) =>
        transport.request<void>("bindings.reset", ref ?? {}),
    },
    /** File drops: providers by extension, panel listeners. */
    drops: {
      provide: (id: string, extensions: string[]) =>
        transport.request<void>("drops.provide", { id, extensions }),
      withdraw: (id: string) =>
        transport.request<void>("drops.withdraw", { id }),
      listen: (listen: boolean) =>
        transport.request<void>("drops.listen", { listen }),
    },
    /** The palette (`player` to change it). */
    appearance: {
      set: (theme: string) =>
        transport.request<void>("appearance.set", { theme }),
      /** The interface language for the next start. */
      setLanguage: (language: string) =>
        transport.request<void>("appearance.setLanguage", { language }),
    },
    /** Settings pages in the player's options window. */
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
      set: (id: string, property: string, write: PropertyWrite) =>
        transport.request<void>("settings.set", { id, property, ...write }),
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
      /**
       * One shader channel handle's list (`plugin.video.shaders(id)`); `[]`
       * removes it.
       */
      shadersSet: (id: string, paths: string[]) =>
        transport.request<{ state: "applied" | "waiting" }>(
          "video.shaders.set",
          { id, paths },
        ),
      /** The GPU's video upscaler (`plugin.video.upscaling`). */
      upscalingState: () =>
        transport.request<WireUpscalingState>("video.upscaling.state"),
      upscalingSet: (enabled: boolean) =>
        transport.request<WireUpscalingState>("video.upscaling.set", {
          enabled,
        }),
      /** Motion smoothing (`plugin.video.motion`). */
      motionState: (engine: string) =>
        transport.request<WireMotionState>("video.motion.state", { engine }),
      motionSet: (engine: string, mode: string) =>
        transport.request<WireMotionState>("video.motion.set", {
          engine,
          mode,
        }),
    },
    /** Mark layers on the seek bar (`plugin.timeline`). */
    timeline: {
      marks: () => transport.request<WireTimeline>("timeline.marks"),
      set: (
        marks: { time: number; kind: string; title?: string | TextJson }[],
        sourceId?: number,
      ) =>
        transport.request<{ applied: boolean }>("timeline.set", {
          marks,
          ...(sourceId === undefined ? {} : { sourceId }),
        }),
      /** Replace this layer's ranges. */
      setRanges: (
        ranges: {
          start: number;
          end: number;
          style: string;
          title?: string | TextJson;
        }[],
        sourceId?: number,
      ) =>
        transport.request<{ applied: boolean }>("timeline.setRanges", {
          ranges,
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
      run: (action: string, seconds?: number) =>
        transport.request<void>(
          "host.run",
          seconds === undefined ? { action } : { action, seconds },
        ),
    },
    step: {
      step: (unit: string, direction: string, expected?: SourceStamp) =>
        transport.request<void>("player.step", {
          unit,
          direction,
          ...(expected ? { expected } : {}),
        }),
      setStepSeek: (seconds: number, keyframes?: boolean) =>
        transport.request<void>(
          "player.setStepSeek",
          keyframes === undefined ? { seconds } : { seconds, keyframes },
        ),
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
    /** The system's secret store, per plugin (`credentials`). */
    secrets: {
      get: (name: string) =>
        transport.request<string | null>("secrets.get", { name }),
      set: (name: string, value: string) =>
        transport.request<void>("secrets.set", { name, value }),
      delete: (name: string) =>
        transport.request<void>("secrets.delete", { name }),
    },
    /**
     * JSON values the player keeps per plugin until it quits. `get` answers
     * `{}` for a missing key.
     */
    storageSession: {
      get: (key: string) =>
        transport.request<{ value?: Json }>("storage.session.get", { key }),
      set: (key: string, value: Json) =>
        transport.request<void>("storage.session.set", { key, value }),
      delete: (key: string) =>
        transport.request<void>("storage.session.delete", { key }),
      keys: () => transport.request<string[]>("storage.session.keys"),
    },
    app: {
      system: () => transport.request<WireSystemInfo>("app.system"),
    },
    /**
     * The rendering choice: `state` needs no capability, `setPreference` and
     * `restart` need `player`.
     */
    rendering: {
      state: () => transport.request<WireRenderingState>("rendering.state"),
      setPreference: (preference: string) =>
        transport.request<WireRenderingState>("rendering.setPreference", {
          preference,
        }),
      restart: () => transport.request<null>("rendering.restart"),
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
    /** `text` is a template in the plugin's catalog, formatted with `args`. */
    osd: {
      show: (
        text: TextValueJson,
        args?: TemplateArgsJson,
        actions?: { title: TextValueJson; command: string }[],
      ) =>
        transport.request<void>("osd.show", {
          text,
          ...(args === undefined ? {} : { args }),
          // Sent only when given.
          ...(actions === undefined ? {} : { actions }),
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
          /** The adjust column. */
          adjust?: LayoutSlot | null;
          backdrop?: LayoutBackdrop | null;
        }>("layout.state"),
      set: (options: {
        /** The panel's position. */
        slot: "bottom" | "sidebar" | "adjust";
        visible?: boolean;
        detached?: boolean;
        /** The plugin id of the panel whose tab becomes the current one. */
        active?: string;
        /**
         * With `visible: true`: `false` switches the position on without
         * popping a column out in fullscreen (`toggle()`). Absent: reveal, as
         * `show()` and `setVisible` do.
         */
        reveal?: boolean;
      }) => transport.request<void>("layout.set", options),
    },
    events: {
      /**
       * One `events.subscribe` per name however many listeners. `mirror`: only
       * the SDK keeps a copy of the state; `listen` changes it.
       */
      async subscribe(
        event: HostEvent,
        listener: (data: unknown) => void,
        mirror = false,
        /** What listens (the player logs it). */
        why?: string[],
      ) {
        const off = transport.on(event, listener);
        let subscription = subscriptions.get(event);
        if (!subscription) {
          subscription = {
            count: 0,
            ready: transport.request(
              "events.subscribe",
              mirror
                ? { event, mirror: true }
                : why?.length
                  ? { event, why }
                  : { event },
            ),
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
      /**
       * Tell the player whether a subscribed event has a real listener
       * (`active`) or only the SDK's copy of the state: `events.subscribe`
       * again, which replaces the mark.
       */
      listen: (event: HostEvent, active: boolean, why?: string[]) =>
        transport.request<void>(
          "events.subscribe",
          active
            ? why?.length
              ? { event, why }
              : { event }
            : { event, mirror: true },
        ),
    },
    ui: {
      /** The remote images a Markdown document shows. */
      markdownScan: (text: string, base: string | null) =>
        transport.request<{ images: string[] }>("ui.markdownScan", {
          text,
          base,
        }),
      mount: (options: {
        /** The panel's position. */
        slot: "bottom" | "sidebar" | "backdrop" | "adjust";
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
      // `slot`: which of the plugin's panels (one per slot).
      setMount: (property: string, write: PropertyWrite, slot?: MountSlot) =>
        transport.request<void>("ui.setMount", {
          property,
          ...write,
          ...(slot ? { slot } : {}),
        }),
      interaction: (
        locks: {
          focused: boolean;
          dragging: boolean;
          popupOpen: boolean;
        },
        slot?: MountSlot,
      ) =>
        transport.request<void>("ui.interaction", {
          ...locks,
          ...(slot ? { slot } : {}),
        }),
      unmount: (slot?: MountSlot) =>
        transport.request<void>("ui.unmount", slot ? { slot } : undefined),
      menu: (
        items: (string | null)[],
        x: number,
        y: number,
        slot?: MountSlot,
      ) =>
        transport.request<void>("ui.menu", {
          items,
          x,
          y,
          ...(slot ? { slot } : {}),
        }),
      open: (
        id: string,
        file: string,
        properties: Record<string, Json> = {},
        callbacks: string[] = [],
      ) =>
        transport.request<void>("ui.open", { id, file, properties, callbacks }),
      set: (id: string, property: string, write: PropertyWrite) =>
        transport.request<void>("ui.set", { id, property, ...write }),
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
      /** A `.vxp` file. */
      validateArchive: (file: string) =>
        transport.request<PackageValidation>("packages.validateArchive", {
          file,
        }),
      installed: (id: string) =>
        transport.request<InstalledPackage>("packages.installed", { id }),
      /**
       * `source` and `replace` are sent only when given; `enabled` only when
       * given.
       */
      install: (
        token: string,
        expectedRevision: number,
        requestId: string,
        options: {
          source?: WireSource;
          replace?: boolean;
          enabled?: boolean;
        } = {},
      ) =>
        transport.request<PackageOperation>("packages.install", {
          token,
          expectedRevision,
          requestId,
          ...(options.source === undefined ? {} : { source: options.source }),
          ...(options.replace ? { replace: true } : {}),
          ...(options.enabled === undefined
            ? {}
            : { enabled: options.enabled }),
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
      reload: (id: string) =>
        transport.request<void>("packages.reload", { id }),
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
