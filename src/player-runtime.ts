/**
 * `@vestra-player/sdk/runtime`: for the player only (its plugin runner and its
 * own tests). Not part of the plugin API and not covered by semver: it can
 * change in any release. Plugins use `@vestra-player/sdk` (types) and
 * `@vestra-player/sdk/testing`.
 *
 * @internal
 * @packageDocumentation
 */
export { createPlugin } from "./plugin/index.ts";
export type { PluginInstance, PluginManifest } from "./plugin/index.ts";
export { HostError } from "./wire.ts";
export type { Json, Transport } from "./wire.ts";
export { API_VERSION, CAPABILITIES } from "./capabilities.ts";
export { COMMAND_LIMITS, MENU_IDS } from "./commands.ts";
export {
  Catalog,
  HOST_ZH_HANS,
  LOCALES,
  MENU_KEYS,
  matchLocale,
  parsePo,
  rewriteSlint,
  scanSlint,
} from "./i18n.ts";
export { MANIFEST_FIELDS, MANIFEST_LIMITS } from "./manifest.ts";
export { MARKDOWN_LIMITS } from "./plugin/markdown.ts";
