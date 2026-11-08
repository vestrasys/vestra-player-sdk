/**
 * The plugin API types (`apiVersion: "vestra/1"`).
 *
 * A plugin module default-exports `async function activate(plugin: Plugin)`;
 * everything it creates is a handle owned by `plugin` (or a sub-scope) and is
 * released automatically when the plugin stops.
 *
 * Plugins import these names as types only. The player's runner supplies the
 * object, so a built plugin has no runtime dependency on this package.
 *
 * The declarations live in `./types/*.ts`, one file per documentation
 * category (`@category`; UI in four parts, in the order of the reference),
 * and are re-exported here with `export type *`: this module exports the
 * same names as before the split.
 */
import type {
  Json,
  PackageInfo,
  PropertyWrite,
  RowOp,
  WindowFacts,
  WireMark,
  WireRange,
  WireRenderingReason,
  WireSource,
  WireTimeline,
  WireUpscalingReason,
  WireUpscalingState,
} from "../wire.ts";
import type { CommandKeys } from "../commands.ts";
import type { AudioNode, ConvolutionPlane, VideoNode } from "../processing.ts";
import type { SubtitleStyle } from "../subtitles.ts";
import type { ResolvedMedia } from "../source-resolvers.ts";

export type {
  Json,
  PropertyWrite,
  RowOp,
  AudioNode,
  ConvolutionPlane,
  VideoNode,
  SubtitleStyle,
  ResolvedMedia,
  // The wire shapes of the events `EventPayloads` lists.
  CommandKeys,
  PackageInfo,
  WindowFacts,
  WireMark,
  WireRange,
  WireRenderingReason,
  WireSource,
  WireTimeline,
  WireUpscalingReason,
  WireUpscalingState,
};

export type * from "./types/base.ts";
export type * from "./types/commands.ts";
export type * from "./types/ui-content.ts";
export type * from "./types/ui-layout.ts";
export type * from "./types/ui-locale.ts";
export type * from "./types/playback.ts";
export type * from "./types/ui-shell.ts";
export type * from "./types/processing.ts";
export type * from "./types/subtitles.ts";
export type * from "./types/snapshots.ts";
export type * from "./types/sources.ts";
export type * from "./types/packages.ts";
export type * from "./types/services.ts";
export type * from "./types/plugin-wire.ts";
