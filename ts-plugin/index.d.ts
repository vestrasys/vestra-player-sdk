// @vestra-player/sdk/ts-plugin: the TypeScript language-service plugin. List
// it in tsconfig.json; it is not meant to be imported.
import type ts from "typescript";

declare function init(modules: {
  typescript: typeof ts;
}): ts.server.PluginModule;
export = init;
