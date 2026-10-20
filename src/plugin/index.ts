/**
 * SDK v2 entry. Plugins import types from here:
 *
 *   import type { Plugin } from "../../sdk/plugin/index.ts";
 *   export default async function activate(plugin: Plugin) { ... }
 *
 * `createPlugin` is for the runner and the test host only.
 */
import type { Transport } from "../wire.ts";
import { Runtime } from "./runtime.ts";
import type { PluginManifest } from "./runtime.ts";
import { ScopeImpl } from "./scope.ts";
import { playerOf } from "./player.ts";
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
): Promise<PluginInstance> {
  const runtime = new Runtime(transport, manifest, directory);
  // The player state is synchronous for plugins, so read it before activation.
  await playerOf(runtime).init();
  const root = new ScopeImpl(runtime);
  return {
    plugin: root,
    activated: () => runtime.activated(),
    dispose: () => root.dispose(),
  };
}
