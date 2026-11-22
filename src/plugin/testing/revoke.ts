/**
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import type { TestHost } from "./index.ts";

/**
 * What the player undoes by itself when a plugin's run stops (SDK 1.11.0):
 * the plugin's own cleanup requests are not sent after `runtime.stop`
 * (`RequestQueue.close`), so the test host revokes what the run held, as
 * the player does at every stop (`host/lifecycle.rs` `stop_run` and the
 * playback worker's `owner.parked` / `owner.disabled`): the run's windows,
 * panels, commands, settings pages, resolvers, sequence provider, streams,
 * filter chains, display layer, render options and shaders. Its timeline
 * layer, always-on-top and cursor settings stay through a standby (an idle
 * stop, `keeps_shown_state`) and go at every other stop: disable, a
 * fault, uninstall, reload, upgrade, quit. By host.
 */
export const revokers = new WeakMap<TestHost, (reason?: string) => void>();

/**
 * Revoke what the plugin's run held, for a stop with `reason`
 * (`startPlugin`'s `stop`, `park()` with `idle`, `upgrade()`).
 */
export function revokeRun(host: TestHost, reason?: string) {
  revokers.get(host)?.(reason);
}
