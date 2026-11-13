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
export type {
  PluginInstance,
  PluginManifest,
  RuntimeOptions,
} from "./plugin/index.ts";
export { HostError } from "./wire.ts";
export type { Json, Transport } from "./wire.ts";
export { API_VERSION, MESSAGE_LIMIT } from "./protocol.ts";
export {
  BAR_BUTTON_ICONS,
  BAR_BUTTON_LIMITS,
  BUILTIN_COMMANDS,
  BUILTIN_SUBMENUS,
  COMMAND_LIMITS,
  MENU_IDS,
} from "./commands.ts";
export { BINDING_INPUTS } from "./plugin/bindings.ts";
export { MEDIA_SOURCE_LIMITS } from "./plugin/media.ts";
export { REQUEST_LIMITS, UNQUEUED_METHODS } from "./request-queue.ts";
export {
  COMMAND_RUN_LIMITS,
  PALETTE_LEAD_LIMITS,
  PALETTE_LEAD_STATES,
} from "./commands.ts";
export { MPV_LIMITS, MPV_RULES } from "./mpv.ts";
export { OSD_LIMITS } from "./plugin/osd.ts";
export { TIMELINE_LIMITS } from "./plugin/timeline.ts";
export { SECRET_LIMITS, SESSION_STORAGE_LIMITS } from "./plugin/services.ts";
export { SUBTITLE_LIMITS } from "./plugin/subtitles.ts";
export { VIDEO_PROCESSING_LIMITS } from "./processing.ts";
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
export { PATCH_FEATURE, PATCH_OPS } from "./plugin/patch.ts";
