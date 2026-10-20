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
 * Work the plugin process does itself (no host protocol): external tools
 * and opening files in the Finder. The runner uses the real system; the
 * test host supplies fakes.
 */
export interface LocalServices {
  run(
    path: string,
    args: string[],
    options: { timeoutMs: number; maxOutput: number; signal: AbortSignal },
  ): Promise<{ stdout: Uint8Array; stderr: string }>;
  /** Where a tool's executable is, or null when it cannot be found. */
  locate(tool: "ffmpeg" | "ffprobe"): Promise<string | null>;
  /** `/usr/bin/open -R path` (reveal) or `/usr/bin/open path`. */
  open(path: string, reveal: boolean): Promise<void>;
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
    clipboard: {
      readText: () => transport.request<string | null>("clipboard.readText"),
      writeText: (text: string) =>
        transport.request<void>("clipboard.writeText", { text }),
      writeImage: (path: string) =>
        transport.request<void>("clipboard.writeImage", { path }),
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
        event: "source.state" | "playback.backend" | "window.state",
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
        slot: "bottom" | "sidebar";
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
    },
  };
}
export type Wire = ReturnType<typeof createWire>;
