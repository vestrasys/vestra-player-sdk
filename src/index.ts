/**
 * The Vestra Player plugin API (`apiVersion: "vestra/1"`), types only.
 *
 * A plugin's entry module default-exports `activate`. The player creates
 * the {@link Plugin} object and passes it in; a plugin never imports SDK
 * code at run time (a built plugin contains only its own code, and
 * `vestra-plugin build` fails on a runtime import of this package), so
 * import with `import type`.
 *
 * Start with {@link Plugin} and {@link Scope}: every module
 * (`plugin.commands`, `plugin.player`, `plugin.windows`…) hangs off them and
 * documents the manifest capability it needs. Errors are described at
 * {@link PluginError}. Tests use `@vestra-player/sdk/testing`.
 *
 * @example
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 *
 * export default async function activate(plugin: Plugin) {
 *   plugin.commands.add({
 *     id: "hello",
 *     path: ["Tools", "Hello"],
 *     run: () => plugin.osd.show("Hello"),
 *   });
 * }
 * ```
 *
 * @packageDocumentation
 * @module @vestra-player/sdk
 */
export type * from "./plugin/types.ts";
