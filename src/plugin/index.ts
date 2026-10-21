/**
 * Builds the `plugin` object. Plugins import the types from the package entry
 * (`@vestra-player/sdk`, src/index.ts); `createPlugin` is for the player's
 * runner (`@vestra-player/sdk/runtime`) and the test host only.
 */
import type { Transport } from "../wire.ts";
import { Runtime } from "./runtime.ts";
import type { PluginManifest } from "./runtime.ts";
import { ScopeImpl } from "./scope.ts";
import { playerOf } from "./player.ts";
import { windowOf } from "./window.ts";
import { timelineOf } from "./timeline.ts";
import type { Plugin } from "./types.ts";

export type * from "./types.ts";
export type { PluginManifest };

export interface PluginInstance {
  plugin: Plugin;
  /** Wait for registrations started during activation; rejects if one failed. */
  activated(): Promise<void>;
  dispose(): Promise<void>;
}

export async function createPlugin(
  transport: Transport,
  manifest: PluginManifest,
  directory: string,
  dataDirectory?: string,
  /** `plugin.app` (the runner passes the player's `VESTRA_APP_INFO`). */
  app?: unknown,
): Promise<PluginInstance> {
  const runtime = new Runtime(
    transport,
    manifest,
    directory,
    dataDirectory,
    app,
  );
  // Player, window and timeline state are synchronous for plugins: read them first.
  await Promise.all([
    playerOf(runtime).init(),
    windowOf(runtime).init(),
    timelineOf(runtime).init(),
  ]);
  const root = new ScopeImpl(runtime);
  return {
    plugin: root,
    activated: () => runtime.activated(),
    dispose: () => root.dispose(),
  };
}
