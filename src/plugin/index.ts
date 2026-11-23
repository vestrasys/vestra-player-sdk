/**
 * Builds the `plugin` object. Plugins import the types from the package entry
 * (`@vestra-player/sdk`, src/index.ts); `createPlugin` is for the player's
 * runner (`@vestra-player/sdk/runtime`) and the test host only.
 *
 * @internal
 */
import type { Transport } from "../wire.ts";
import { Runtime } from "./runtime.ts";
import { stopReason } from "./connection.ts";
import { failure } from "./errors.ts";
import type { PluginManifest, RuntimeOptions } from "./connection.ts";
import { ScopeImpl } from "./scope.ts";
import { windowOf } from "./window.ts";
import { timelineOf } from "./timeline.ts";
import { triggersOf } from "./triggers.ts";
import type { Plugin } from "./types.ts";

export type * from "./types.ts";
export type { PluginManifest, RuntimeOptions };

export interface PluginInstance {
  plugin: Plugin;
  /**
   * Call the plugin's `activate(plugin)` as `entry`: `plugin.trigger()`
   * works only during its synchronous part, after which the player is told
   * which triggers it declared (1.10.0). Returns what `entry` returned, as a
   * promise. The runner and the test host call it instead of `entry`.
   */
  activate(entry: (plugin: Plugin) => unknown): Promise<unknown>;
  /**
   * Wait for registrations started during activation; rejects if one failed.
   * A command declaration the player refused is not a failure (it is
   * logged, skipped and reported to `onError`) unless
   * `RuntimeOptions.strictDeclarations` is set.
   */
  activated(): Promise<void>;
  /**
   * Stop the plugin: dispose the root scope, then stop the runtime.
   * `info.reason` is why: the runner passes `runtime.stop`'s `data.reason`, or
   * `"host-lost"` when its input closed without a `runtime.stop`. It reaches
   * `plugin.stopReason` and every `onDispose` cleanup; a reason the SDK does
   * not know reads as `undefined`. A second call runs no cleanup again and
   * keeps the first reason.
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
  // The window state is synchronous for plugins: read it first. The
  // player's state and the timeline are the plugin's explicit calls, first
  // in `activate`: `await plugin.player.read()` (state and timeline read
  // once); the copies follow the player's events while something holds
  // them (a listener, a watcher, a stream; `Connection.hold`). Window and
  // timeline subscribe on their first use. The timeline's copy exists from
  // the start: it tells the connection how `read()` reads the lists.
  timelineOf(runtime);
  await windowOf(runtime).init();
  const root = new ScopeImpl(runtime);
  // A runaway of the update passes goes to the plugin's error handlers.
  runtime.passes.report = (error) => root.report(error);
  // A state copy that throws on an event, as a listener's error would be.
  runtime.reportMirror = (error) => root.report(error);
  // Failures the plugin did not ask about: a property the player could not
  // show when it rebuilt a panel or the Options window (an image removed
  // since), a callback whose arguments it could not convert, a detached
  // sidebar that could not be prepared. A warning may come without a code.
  root.add(
    runtime.raw("ui.error", (data) => {
      const { code, message } = (data ?? {}) as {
        code?: string;
        message?: string;
      };
      root.report(failure(code ?? "ui", message ?? "user interface error"));
    }),
  );
  const triggers = triggersOf(runtime);
  return {
    plugin: root,
    activate(entry) {
      triggers.begin();
      let result: unknown;
      try {
        result = entry(root);
      } finally {
        triggers.end();
      }
      return Promise.resolve(result);
    },
    activated: () => runtime.activated(),
    dispose: async (info) => {
      runtime.stopping ??= { reason: stopReason(info?.reason) };
      // Before the cleanup runs (the player sent `runtime.stop`): what
      // still waits to be sent rejects as the requests in flight do when the
      // runner stops (`disabled`), and every later request, the cleanup's
      // own included, is refused without being sent (`RequestQueue.close`):
      // the player has let go of the plugin and undoes what it held itself.
      runtime.requests.close();
      await root.dispose();
      runtime.stop();
    },
  };
}
