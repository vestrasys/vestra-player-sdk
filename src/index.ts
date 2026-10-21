/**
 * `@vestra-player/sdk`: the plugin API, types only.
 *
 *   import type { Plugin } from "@vestra-player/sdk";
 *   export default async function activate(plugin: Plugin) { ... }
 *
 * The player creates the `plugin` object and passes it to `activate`; a plugin
 * never imports SDK code at run time (a built plugin contains only its own
 * code). Tests use `@vestra-player/sdk/testing`.
 */
export type * from "./plugin/types.ts";
