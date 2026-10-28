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
export {
  API_VERSION,
  CAPABILITIES,
  CAPABILITY_INFO,
  MESSAGE_LIMIT,
} from "./capabilities.ts";
export { HOST_CAPABILITIES } from "./host-capabilities.ts";
export {
  BAR_BUTTON_ICONS,
  BAR_BUTTON_LIMITS,
  BUILTIN_COMMANDS,
  BUILTIN_SUBMENUS,
  COMMAND_LIMITS,
  MENU_IDS,
} from "./commands.ts";
export { BINDING_INPUTS } from "./plugin/bindings.ts";
export { OSD_LIMITS } from "./plugin/osd.ts";
export { SECRET_LIMITS, SESSION_STORAGE_LIMITS } from "./plugin/services.ts";
export { SUBTITLE_LIMITS } from "./plugin/subtitles.ts";
export { THEME_PALETTES } from "./palettes.ts";
export {
  Catalog,
  HOST_ZH_HANS,
  LIST_SEPARATORS,
  LOCALES,
  MENU_KEYS,
  matchLocale,
  parsePo,
  rewriteSlint,
  renderText,
  scanSlint,
  TEXT_LIMITS,
  textKey,
  textProblem,
} from "./i18n.ts";
export { MANIFEST_FIELDS, MANIFEST_LIMITS } from "./manifest.ts";
export { MARKDOWN_LIMITS } from "./plugin/markdown.ts";
export { IMAGE_LIMITS, UI_VALUE_LIMITS } from "./plugin/values.ts";
