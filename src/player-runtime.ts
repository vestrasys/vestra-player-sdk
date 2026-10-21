/**
 * `@vestra-player/sdk/runtime`: for the player only (its plugin runner and its
 * own tests). Not part of the plugin API and not covered by semver: it can
 * change in any release. Plugins use `@vestra-player/sdk` (types) and
 * `@vestra-player/sdk/testing`.
 */
export { createPlugin } from "./plugin/index.ts";
export type { PluginInstance, PluginManifest } from "./plugin/index.ts";
export { HostError } from "./wire.ts";
export type { Json, Transport } from "./wire.ts";
export { API_VERSION, CAPABILITIES } from "./capabilities.ts";
export { COMMAND_LIMITS } from "./commands.ts";
