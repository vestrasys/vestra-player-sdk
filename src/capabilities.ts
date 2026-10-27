import { capabilityInfo } from "./capability-rules.ts";

/**
 * What one manifest capability is for: the members it opens, the
 * capabilities they also need, and how the plugin store describes it. An
 * entry of {@link CAPABILITY_INFO}.
 *
 * @since 1.5.14
 */
export interface CapabilityInfo {
  /**
   * The members this capability opens, as `Interface.member` (for example
   * `Commands.add` is `plugin.commands.add`). A call to one of them without
   * the capability fails with code `capability`; `Plugin.video.filter` is
   * `plugin.video.filter`. A member can be listed
   * under more than one capability when it needs all of them
   * (`Panel.onChange` needs `ui.mount` and `events`).
   */
  readonly apis: readonly string[];
  /**
   * Capabilities every member in {@link CapabilityInfo.apis} also needs:
   * declare them as well. What only one member or one option needs
   * (`Plugin.video.filter` also needs `events`) is documented at that member.
   */
  readonly requires: readonly string[];
  /**
   * How the plugin store and the player's install confirmation describe the
   * capability to the user, in English (the player translates it). Two
   * capabilities can share one description (`media.read` and
   * `media.control`); the store then shows it once.
   */
  readonly label: string;
  /**
   * `true` when the store highlights the capability as one to think about
   * before installing (it reaches outside the plugin's own features: the
   * clipboard, every shortcut, the keychain, other plugins).
   */
  readonly risky: boolean;
}

/**
 * Every manifest capability the player knows (`vestra/1`), in the player's
 * order, with the members it opens, the capabilities they also need and the
 * store's wording. Built from the player's own capability table (its
 * `src/host/capabilities.json`, copied into the SDK) and the requests each
 * member sends, the same rule `vestra-plugin check` and the SDK's
 * TypeScript plugin apply; the player's tests check that the copy is
 * current.
 *
 * A member not listed under any capability needs none (`plugin.tools`,
 * `plugin.storage`, `plugin.system`, `plugin.app`, `plugin.ui`,
 * `plugin.i18n`, reading `plugin.window.state`, `plugin.appearance.theme`
 * and `plugin.packages.list`).
 *
 * @example
 * ```ts
 * import { CAPABILITY_INFO } from "@vestra-player/sdk/testing";
 *
 * const manifest = JSON.parse(await readFile("manifest.json", "utf8"));
 * for (const capability of manifest.capabilities)
 *   for (const needed of CAPABILITY_INFO[capability].requires)
 *     assert.ok(manifest.capabilities.includes(needed), needed);
 * ```
 *
 * @since 1.5.14
 */
export const CAPABILITY_INFO: Readonly<Record<string, CapabilityInfo>> =
  Object.freeze(
    Object.fromEntries(
      Object.entries(capabilityInfo()).map(([name, info]) => [
        name,
        Object.freeze({
          apis: Object.freeze(info.apis),
          requires: Object.freeze(info.requires),
          label: info.label,
          risky: info.risky,
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
 */
export const MESSAGE_LIMIT = 1024 * 1024;
