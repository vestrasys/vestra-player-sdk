/**
 * Builds the `plugin` object. Plugins import the types from the package entry
 * (`@vestra-player/sdk`, src/index.ts); `createPlugin` is for the player's
 * runner (`@vestra-player/sdk/runtime`) and the test host only.
 *
 * @internal
 */
import type { Transport } from "../wire.ts";
import { failure, Runtime, stopReason } from "./runtime.ts";
import type { PluginManifest, RuntimeOptions } from "./runtime.ts";
import { ScopeImpl } from "./scope.ts";
import { playerOf } from "./player.ts";
import { windowOf } from "./window.ts";
import { timelineOf } from "./timeline.ts";
import type { Plugin } from "./types.ts";

export type * from "./types.ts";
export type { PluginManifest, RuntimeOptions };

export interface PluginInstance {
  plugin: Plugin;
  /**
   * Wait for registrations started during activation; rejects if one failed.
   * A command declaration the player refused is not a failure (it is
   * logged, skipped and reported to `onError`) unless
   * `RuntimeOptions.strictDeclarations` is set.
   */
  activated(): Promise<void>;
  /**
   * Stop the plugin: dispose the root scope, then stop the runtime.
   * `info.reason` (SDK 1.5.54) is why: the runner passes `runtime.stop`'s
   * `data.reason` (planned for player 0.6.4), or `"host-lost"` when its input closed
   * without a `runtime.stop`. It reaches `plugin.stopReason` and every
   * `onDispose` cleanup; a reason the SDK does not know reads as
   * `undefined`. A second call runs no cleanup again and keeps the first reason.
   */
  dispose(info?: { reason?: unknown }): Promise<void>;
}

export async function createPlugin(
  transport: Transport,
  manifest: PluginManifest,
  directory: string,
  dataDirectory?: string,
  /** `plugin.app` (the runner passes the player's `VESTRA_APP_INFO`). */
  app?: unknown,
  /** `TestHost` sets `strictDeclarations`; the player's runner does not. */
  options?: RuntimeOptions,
): Promise<PluginInstance> {
  const runtime = new Runtime(
    transport,
    manifest,
    directory,
    dataDirectory,
    app,
    options,
  );
  // Player, window and timeline state are synchronous for plugins: read them first.
  await Promise.all([
    playerOf(runtime).init(),
    windowOf(runtime).init(),
    timelineOf(runtime).init(),
  ]);
  const root = new ScopeImpl(runtime);
  // Failures the plugin did not ask about: a property the player could not
  // show when it rebuilt a panel or the Options window (an image removed
  // since), a callback whose arguments it could not convert, a detached
  // sidebar that could not be prepared. Older players send no code.
  root.add(
    runtime.raw("ui.error", (data) => {
      const { code, message } = (data ?? {}) as {
        code?: string;
        message?: string;
      };
      root.report(failure(code ?? "ui", message ?? "user interface error"));
    }),
  );
  return {
    plugin: root,
    activated: () => runtime.activated(),
    dispose: async (info) => {
      runtime.stopping ??= { reason: stopReason(info?.reason) };
      await root.dispose();
      runtime.stop();
    },
  };
}
