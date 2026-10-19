import { commandClient } from "./commands.ts";
import { processingClient } from "./processing.ts";
import { subtitleClient } from "./subtitles.ts";
import { mediaClients } from "./media.ts";
import { producerClient } from "./producer.ts";
import { sourceClient } from "./source.ts";
import { sourceResolverClient } from "./source-resolvers.ts";
export type { ResolvedMedia, ResolvedResource, SourceResolverDeclaration } from "./source-resolvers.ts";
/** Working contract. Trusted plugin runtime, not a permissions sandbox. */
export const API_VERSION = "vestra.experimental/0.1" as const;
export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };
export type Primitive = boolean | number | string;
export interface PlaybackState {
  session: number;
  source: string | null;
  paused: boolean;
  position: number | null;
  duration: number | null;
  volume?: number;
  rate?: number;
  videoFrames: number;
}
export interface PlaybackProperties {
  pause: boolean;
  /** Shared device output control. Does not advance source intent. */
  muted: boolean;
  volume: number;
  speed: number;
  brightness: number;
  contrast: number;
  saturation: number;
  gamma: number;
  "audio-delay": number;
  "sub-delay": number;
}
export interface PluginInfo {
  id: string;
  apiVersion: string;
  entry: string;
  capabilities: string[];
}
export type PluginActivation =
  | { status: "unknown" | "ready" | "timedOut" }
  | { status: "pending"; runtimeReady: boolean; pendingUi: number }
  | { status: "failed"; message: string };
export type PluginLoadAccepted = PluginInfo & {
  owner: number;
  accepted: true;
  activation: PluginActivation;
};
export type PluginActivationState = {
  owner: number;
  id?: string;
  running: boolean;
  activation: PluginActivation;
};
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
  activation?: PluginActivationState;
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
export interface Capabilities {
  apiVersion: typeof API_VERSION;
  capabilities: string[];
  backend: string;
  ui: boolean;
}
export class HostError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "HostError";
  }
}
export interface MountVisibility {
  owner: number;
  preferred: boolean;
  effective: boolean;
  reason: "userHidden" | "space" | "fullscreen" | "idle" | null;
  overlay: boolean;
}
export interface WindowState {
  shellGeneration: number;
  /** Slint presentation report; not an OS geometry/transition fence. */
  fullscreen: boolean;
  logicalWidth: number;
  logicalHeight: number;
  canvasAvailableWidth: number;
  canvasAvailableHeight: number;
  menuOpen: boolean;
  dialogOpen: boolean;
  slots: {
    fullscreen: boolean;
    bottom: MountVisibility | null;
    sidebar: MountVisibility | null;
    sidebarWidth: number;
    nextDeadlineMs: number | null;
  };
}
export interface Transport {
  request<T>(method: string, params?: Json): Promise<T>;
  on(event: string, listener: (data: unknown) => void): () => void;
}
export function createSdk(transport: Transport) {
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
    window: {
      state: () => transport.request<WindowState | null>("window.state"),
      /** Acceptance only. state.fullscreen is a Slint report, not an OS transition fence. */
      setFullscreen: (fullscreen: boolean) =>
        transport.request<void>("window.setFullscreen", { fullscreen }),
    },
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
    capabilities: () => transport.request<Capabilities>("host.capabilities"),
    playback: {
      state: () => transport.request<PlaybackState>("playback.state"),
      /** Resolves when mpv accepts the load; actual load outcome arrives in playback.backend. */
      open: (source: string) =>
        transport.request<{ session: number }>("playback.open", { source }),
      seek: (seconds: number) =>
        transport.request<void>("playback.seek", { seconds }),
      set: <K extends keyof PlaybackProperties>(
        property: K,
        value: PlaybackProperties[K],
      ) => transport.request<void>("playback.set", { property, value }),
    },
    events: {
      async subscribe(
        event:
          | "playback.state"
          | "playback.backend"
          | "source.state"
          | "window.state"
          | "plugins.changed"
          | "host.error",
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
        properties?: Record<string, Json>;
      }) =>
        transport.request<{
          status: "ready";
          prepareMs: number;
          shellGeneration: number;
        }>("ui.mount", options),
      setMount: (property: string, value: Json) =>
        transport.request<void>("ui.setMount", { property, value }),
      showMount: (visible: boolean, scope?: "presentation") =>
        transport.request<void>("ui.showMount", {
          visible,
          ...(scope ? { scope } : {}),
        }),
      mountState: () =>
        transport.request<MountVisibility | null>("ui.mountState"),
      interaction: (locks: {
        focused: boolean;
        dragging: boolean;
        popupOpen: boolean;
      }) => transport.request<void>("ui.interaction", locks),
      unmount: () => transport.request<void>("ui.unmount"),
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
      onCallback: (listener: (event: UiCallback) => void) =>
        transport.on("ui.callback", (data) => listener(data as UiCallback)),
    },
    /** Executes trusted package code. Validation checks production JS and Slint;
     * TypeScript checking belongs to the authoring tool. Poll handles after timeout. */
    packages: {
      validate: (
        directory: string,
        digest?: string,
        apiVersion: string = API_VERSION,
      ) =>
        transport.request<PackageValidation>("packages.validate", {
          directory,
          apiVersion,
          ...(digest === undefined ? {} : { digest }),
        }),
      /** Optional requestId recovers a lost first reply in this owner session.
       * Exact digest replay returns the same trial, including after stop. Records
       * are retained until host exit; the finite 16-record limit rejects new work. */
      trial: (token: string, requestId?: string) =>
        transport.request<PackageTrial>("packages.trial", {
          token,
          ...(requestId === undefined ? {} : { requestId }),
        }),
      trialStateByRequest: (requestId: string) =>
        transport.request<PackageTrial>("packages.trialStateByRequest", { requestId }),
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
    plugins: {
      list: () => transport.request<PluginInfo[]>("plugins.list"),
      load: (directory: string, activationTimeoutMs?: number) =>
        transport.request<PluginLoadAccepted>("plugins.load", {
          directory,
          ...(activationTimeoutMs === undefined ? {} : { activationTimeoutMs }),
        }),
      activation: (owner: number) =>
        transport.request<PluginActivationState>("plugins.activation", {
          owner,
        }),
      disable: (id: string) =>
        transport.request<void>("plugins.disable", { id }),
    },
  };
}
export type Host = ReturnType<typeof createSdk>;
export interface PluginModule {
  activate(
    host: Host,
  ):
    | Promise<void | (() => void | Promise<void>)>
    | void
    | (() => void | Promise<void>);
}
