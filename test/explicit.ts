// `startPlugin` for the tests written when a manifest declared capabilities
// (before 1.9.0). They still say which ones they meant: the `capabilities`
// option, or a `capabilities` list in the manifest a test writes for its
// temporary package. Only two of them ever changed how a plugin ran, and
// those are now calls first in `activate`, which this wrapper makes:
// `events` → `plugin.player.subscribe()`, `playback.read` → `await
// plugin.player.read()`. The rest means nothing any more and is dropped.
// Such a manifest is not handed to `startPlugin` (which refuses the field,
// as the player does): its id is passed instead. Without either list the
// call is `startPlugin`'s own.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startPlugin as start } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";

type Options = NonNullable<Parameters<typeof start>[1]>;

/** A test's manifest that still lists capabilities: its id and the list. */
function declared(options: Options) {
  if (!options.directory || options.id !== undefined) return undefined;
  const directory =
    options.directory instanceof URL
      ? fileURLToPath(options.directory)
      : options.directory;
  const manifest = JSON.parse(
    readFileSync(join(directory, "manifest.json"), "utf8"),
  ) as { id: string; capabilities?: string[] };
  return Array.isArray(manifest.capabilities)
    ? { id: manifest.id, capabilities: manifest.capabilities }
    : undefined;
}

export function startPlugin(
  activate: (plugin: Plugin) => unknown,
  options: Options & { capabilities?: readonly string[] } = {},
) {
  const { capabilities: given, ...rest } = options;
  const old = given
    ? { id: rest.id ?? "test.plugin", capabilities: given }
    : declared(rest);
  if (!old) return start(activate, rest);
  const { capabilities } = old;
  return start(
    async (plugin) => {
      if (capabilities.includes("events")) plugin.player.subscribe();
      if (capabilities.includes("playback.read")) await plugin.player.read();
      return activate(plugin);
    },
    { ...rest, id: old.id },
  );
}
