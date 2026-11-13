/**
 * The TypeScript language-service plugin `@vestra-player/sdk/ts-plugin`.
 * Up to 1.8 it showed the capability checker's findings in the editor, with
 * the quick fix "Add '<capability>' to manifest.json". SDK 1.9.0 removed
 * manifest capabilities, and with them the checker: the plugin now changes
 * nothing and is kept only so that a tsconfig.json that lists it
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
        "[@vestra-player/sdk/ts-plugin] does nothing since SDK 1.9.0 (no manifest capabilities); remove it from tsconfig.json",
      );
      return info.languageService;
    },
  };
}
