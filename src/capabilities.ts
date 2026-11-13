import { capabilityInfo } from "./capability-rules.ts";

/**
 * What one manifest capability is for: the members it opens and how the
 * plugin store describes it. An entry of {@link CAPABILITY_INFO}.
 *
 * A capability is a boundary, not a feature: a plugin declares one when it
 * touches things that are neither its own nor the playback session's: the
 * user's player settings (`player`), other plugins (`plugins`) or the
 * user's system (`clipboard`, `credentials`). The list is closed: a new
 * player API takes one of these names or needs none.
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export interface CapabilityInfo {
  /**
   * The members this capability opens, as `Interface.member` (for example
   * `Bindings.set` is `plugin.bindings.set`). A call to one of them without
   * the capability fails with code `capability`. Empty for a
   * {@link CapabilityInfo.reserved | reserved} capability.
   */
  readonly apis: readonly string[];
  /**
   * How the plugin store and the player's install confirmation describe the
   * capability to the user, in English (the player translates it).
   */
  readonly label: string;
  /**
   * `true` for a name kept for a later player API (`camera`,
   * `microphone`, `screen`, `notifications`): no member needs it yet. The
   * player accepts a manifest that declares it and grants nothing by it;
   * `vestra-plugin check` says so in a hint.
   *
   * @since 1.8.0
   */
  readonly reserved: boolean;
}

/**
 * Every manifest capability the player knows (`vestra/1`), in the player's
 * order, with the members it opens and the store's wording. Built from the player's own capability table (its
 * `src/host/capabilities.json`, copied into the SDK) and the requests each
 * member sends, the same rule `vestra-plugin check` and the SDK's
 * TypeScript plugin apply; the player's tests check that the copy is
 * current.
 *
 * A member not listed under any capability needs none: everything that is
 * the plugin's own (its commands, windows, panels, settings pages, messages
 * on the video, drops, resolvers, marks) and everything of the playback
 * session (playback, subtitles, filters, upscaling, motion smoothing,
 * snapshots and exports, media sources, the main window, keeping the
 * computer awake). Network, files and child processes are not capabilities
 * either: a plugin is a Node.js process with the user's access to them.
 *
 * Until 1.8.0 the list had 31 names, one per feature; the changelog of
 * 1.8.0 maps each old name to its new one or to "delete".
 *
 * @example Check in a test that the manifest declares only capabilities in use
 * The test fails, naming the capability, when the manifest declares a name
 * the player does not know or one that opens nothing yet. It reads the plugin's
 * own `manifest.json` and looks each declared name up in
 * `CAPABILITY_INFO`; `vestra-plugin check` reports the same, and also every
 * member the plugin uses whose capability is missing.
 * ```ts
 * import assert from "node:assert/strict";
 * import { readFile } from "node:fs/promises";
 * import { CAPABILITY_INFO } from "@vestra-player/sdk/testing";
 *
 * const manifest: { capabilities: string[] } = JSON.parse(
 *   await readFile(new URL("../manifest.json", import.meta.url), "utf8"),
 * );
 * for (const capability of manifest.capabilities) {
 *   // An unknown name (or one retired in 1.8.0) has no entry.
 *   const info = CAPABILITY_INFO[capability];
 *   assert.ok(info, `${capability} is not a capability`);
 *   // A reserved name opens no member yet: nothing to declare it for.
 *   assert.equal(info.reserved, false, `${capability} is reserved`);
 * }
 * ```
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export const CAPABILITY_INFO: Readonly<Record<string, CapabilityInfo>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(capabilityInfo()).map(([name, info]) => [
        name,
        Object.freeze({
          apis: Object.freeze(info.apis),
          label: info.label,
          reserved: info.reserved,
        }),
      ]),
    ),
  );

/**
 * Manifest capabilities the player knows (`vestra/1`): the keys of
 * {@link CAPABILITY_INFO}, in the player's order. The same list as the
 * player's `host/capabilities.json`; the player's tests check that they agree.
 */
export const CAPABILITIES: readonly string[] = Object.freeze(
  Object.keys(CAPABILITY_INFO),
);

/** The plugin API version this SDK implements (`manifest.apiVersion`). */
export const API_VERSION = "vestra/1";

/**
 * The longest message a plugin may send the player, in UTF-8 bytes of one
 * protocol line with its newline (1 MiB). The player stops a plugin that
 * writes a longer one, so the plugin's side refuses such a request before
 * sending it: it rejects with code `limit`. Property values meet
 * {@link UI_VALUE_LIMITS} before this.
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export const MESSAGE_LIMIT = 1024 * 1024;
