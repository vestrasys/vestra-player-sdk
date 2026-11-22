/**
 * The TypeScript language-service plugin `@vestra-player/sdk/ts-plugin`.
 * Up to 1.8 it showed a manifest checker's findings in the editor. SDK 1.9.0
 * removed that checker: the plugin now changes nothing and is kept only so
 * that a tsconfig.json that lists it
 *
 *   { "compilerOptions": { "plugins": [{ "name": "@vestra-player/sdk/ts-plugin" }] } }
 *
 * still loads without an error in the TypeScript server's log. Remove the
 * entry; a later major version removes the module.
 *
 * @internal
 */
import type TS from "typescript";

/** @internal The plugin factory tsserver calls (`ts-plugin/index.js`). */
export default function init(_modules: {
  typescript: typeof TS;
}): TS.server.PluginModule {
  return {
    create(info) {
      info.project?.projectService?.logger?.info(
        "[@vestra-player/sdk/ts-plugin] does nothing since SDK 1.9.0; remove it from tsconfig.json",
      );
      return info.languageService;
    },
  };
}
