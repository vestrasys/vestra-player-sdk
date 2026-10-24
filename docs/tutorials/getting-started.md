---
title: Getting started
---

# Getting started

This guide walks through a complete Vestra Player plugin: the files it is made of, the manifest, a first command, a window, tests, and packaging. The API reference is split into {@link "@vestra-player/sdk" | @vestra-player/sdk} (the plugin API) and {@link "@vestra-player/sdk/testing" | @vestra-player/sdk/testing} (the test host); start from {@link "@vestra-player/sdk"!Plugin | Plugin} and {@link "@vestra-player/sdk"!Scope | Scope}.

## How plugins run

- Each plugin runs in its own Node.js process (Node.js 26, which the player ships) started by the player. It can use the Node standard library, the file system, the network and npm packages.
- The player loads the entry module and calls its **default export** `activate(plugin)`. The `plugin` object is created by the player; the plugin imports the SDK **as types only**, so a built plugin contains nothing but its own code.
- Everything a plugin creates (commands, windows, panels, filters, listeners…) is a handle owned by `plugin` or a child scope, and is released automatically when the plugin stops. There is no cleanup function to return.
- Plugins are trusted code. Manifest capabilities are a contract that the player enforces per call (a missing one fails with `code: "capability"`), not a security sandbox.
- The API is the same on macOS and Windows. A feature a system cannot provide fails with `unsupported`; each method documents its platform differences.

## Install

```sh
mkdir my-plugin && cd my-plugin
npm init -y
npm pkg set type=module
npm i -D @vestra-player/sdk
```

The package brings its own TypeScript 5.x and `@types/node`, and the `vestra-plugin` command line tool.

## Files

```text
my-plugin/
  manifest.json        identity and capabilities
  main.ts              the entry module
  ui/hello.slint       optional: user interface
  tests/main.test.ts   tests (node:test)
  package.json         dev dependency and scripts
```

`package.json` scripts:

```json
{
  "type": "module",
  "scripts": {
    "check": "vestra-plugin check",
    "test": "vestra-plugin test",
    "build": "vestra-plugin build",
    "pack": "vestra-plugin pack"
  },
  "devDependencies": { "@vestra-player/sdk": "^1.5.0" }
}
```

## The manifest

```json
{
  "id": "me.hello",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": ["commands", "ui.osd", "playback.read", "events"]
}
```

| Field              | Rule                                                                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `id`               | Non-empty, globally unique identifier; use `author.plugin`.                                                                                                                                                  |
| `version`          | Three non-negative integers `x.y.z`. `vestra-plugin build` writes it into `dist/manifest.json`.                                                                                                              |
| `apiVersion`       | Always `"vestra/1"` for this major version of the SDK.                                                                                                                                                       |
| `entry`            | Relative path inside the package: `.ts` during development, `.js` after building.                                                                                                                            |
| `capabilities`     | Only names from the table below.                                                                                                                                                                             |
| `minPlayerVersion` | Optional `x.y.z`: the oldest player that can load the plugin. Older players refuse it with `versionMismatch` ("requires Vestra Player ≥ x.y.z"). Set it when you use API added after SDK 1.0 (see Versions). |

Optional display fields (player 0.2.0), shown by the plugin store and plugin manager:

| Field         | Rule                                                                                          |
| ------------- | --------------------------------------------------------------------------------------------- |
| `name`        | 1–64 characters, one line.                                                                    |
| `author`      | 1–64 characters, one line.                                                                    |
| `punchline`   | One-line summary, 1–120 characters.                                                           |
| `description` | Plain text, 1–2000 characters; line breaks allowed.                                           |
| `tags`        | Up to 8 tags, 1–24 characters each, unique ignoring case.                                     |
| `icon`        | Package path of a PNG or JPEG, at most 512 KB and 1024 pixels per side (256×256 recommended). |
| `readme`      | Package path of a UTF-8 `.md` file (≤ 256 KB). Default: `README.md` when present.             |
| `changelog`   | Same, default `CHANGELOG.md` when present.                                                    |
| `sourceUrl`   | `https:` address of the source code.                                                          |
| `license`     | 1–64 characters, preferably an SPDX expression such as `MIT`.                                 |

Unknown fields, unknown capabilities and paths that leave the package directory (including through symbolic links) are rejected. The id's characters are ASCII letters, digits, `.`, `-` and `_`; the official plugin repository additionally requires `<GitHub user or organization>.<plugin name>`. The `vestra.` prefix (and the id `vestra`, in any case) is reserved for the plugins built into the player: from player 0.4.1 the player refuses to install or trial such a package (`reserved`). Every other plugin is a third-party plugin, including those hosted in the official repository.

| Capability                             | Opens                                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `commands`                             | `commands.add`, `host.run`                                                                              |
| `ui.window`                            | `windows.create`                                                                                        |
| `ui.mount`                             | `panels.mount`, `panels.bottom` / `.sidebar` / `.backdrop`                                              |
| `ui.dialog`                            | `dialogs.*`                                                                                             |
| `ui.osd`                               | `osd.show`, `osd.panel`                                                                                 |
| `ui.drop`                              | `drops.provide`, `Panel.onDrop`                                                                         |
| `ui.theme`                             | `appearance.set`                                                                                        |
| `ui.settings`                          | `settings.page`, `settings.show`                                                                        |
| `playback.read`                        | reading `player.state` at start, `refresh`, `stats`, `chapters`, `audioDevices`, `timeline.marks`       |
| `events`                               | live `player.state` / `onChange`, panel visibility, subtitle and window updates                         |
| `playback.control`                     | `player.open`, `setPaused`, `seek`, `setRate`, … and `power.preventSleep`                               |
| `producer.av`                          | `player.openStream` (with `playback.control`: the stream becomes the player's source)                   |
| `processing.video`                     | `video.filter` (with `playback.read` and `events`), `video.view`, `video.render` (with `playback.read`) |
| `processing.audio`                     | `audio.filter` (with `playback.read` and `events`)                                                      |
| `subtitles.read` / `subtitles.control` | reading / changing subtitles                                                                            |
| `media.read` / `media.control`         | `media.capture`, snapshot exports                                                                       |
| `source.resolve`                       | `resolvers.add`                                                                                         |
| `plugins.manage`                       | `packages.validate`, `rollback`, `setEnabled`, `uninstall`                                              |
| `clipboard`                            | `clipboard.*`                                                                                           |
| `window.control`                       | `window.setVideoArea`, `setAlwaysOnTop`, `setCursorAutoHide`, `setPictureInPicture`                     |
| `bindings.manage`                      | `bindings.*`                                                                                            |
| `timeline.marks`                       | `timeline.layer()`                                                                                      |
| `secrets`                              | `secrets.*`                                                                                             |

No capability is needed for `tools`, `storage`, `system`, `ui.image`, `plugin.app`, reading `window.state` and `appearance.theme`, and `packages.list`.

## A first plugin

```ts
// main.ts
import type { Plugin } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  plugin.commands.add({
    id: "where",
    path: ["Tools", "Where am I?"],
    bindings: ["Ctrl+Alt+W"],
    enabled: () => plugin.player.state.phase === "ready",
    run: () => {
      const { position, duration } = plugin.player.state;
      return plugin.osd.show(
        `${position?.toFixed(1)} s of ${duration?.toFixed(1)} s`,
      );
    },
  });
}
```

- `path` is the menu path, matched by exact titles. "Tools" is a new top-level menu of this plugin. To put an item into one of the player's own menus, start the path with its id instead of its title, which depends on the player's language: `["@video", "Blur"]` (also `@open`, `@playback`, `@subtitles`, `@audio`, `@screen`, `@settings`; player 0.3.0).
- `enabled` is a function: the SDK re-evaluates it after every handler and every state change it receives, and sends only changes. This needs `events` to follow outside changes.
- `run` may return a promise. Errors thrown or rejected there go to `plugin.onError`, then to the plugin log.
- Commands are registered in the background; activation succeeds once every registration made during `activate` succeeded.

## A window

User interfaces are Slint files in the package. The plugin writes properties and handles callbacks; property and callback names may be written in camelCase and are converted to Slint's kebab-case.

```slint
// ui/hello.slint
import { Button } from "@vestra/widgets.slint";
import { Theme } from "@vestra/theme.slint";

export component Hello inherits Window {
    title: "Hello";
    in property <string> message;
    in property <bool> can-seek;
    callback jump(float);
    background: Theme.bg-panel;
    VerticalLayout {
        Text { text: root.message; color: Theme.text; }
        Button { text: "Back 10 s"; enabled: root.can-seek; clicked => { root.jump(-10); } }
    }
}
```

```ts
const window = plugin.windows.create("ui/hello.slint");
window.bind(() => ({
  message: plugin.player.state.source ?? "Nothing is playing",
  canSeek: plugin.player.state.can.seek,
}));
window.on("jump", (delta: number) =>
  plugin.player.seek(Math.max(0, (plugin.player.state.position ?? 0) + delta)),
);
plugin.commands.add({
  id: "hello",
  path: ["Tools", "Hello…"],
  run: () => window.show(),
});
```

This needs `ui.window`, `commands`, `playback.read`, `events` and `playback.control`. Bind callbacks before the first `show()`.

`@vestra/theme.slint` and `@vestra/widgets.slint` come from the player at run time. For editor support, point the Slint language server's library path `vestra` at `node_modules/@vestra-player/sdk/slint/vestra` (a read-only copy that matches the player).

## Testing

`@vestra-player/sdk/testing` runs a plugin against `TestHost`, an in-memory player that speaks the real protocol, so the SDK's own logic runs unchanged. There is no decoding, Slint or native window.

```ts
// tests/main.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("shows the position", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url), // reads manifest.json
  });
  host.setSource({ phase: "ready", position: 12, duration: 60 });
  await host.settle();
  await host.command("where").run();
  assert.deepEqual(host.osd, ["12.0 s of 60.0 s"]);
  await stop();
});
```

Useful controls: `host.command(id).run()`, `host.press("Ctrl+Alt+W")`, `host.window(id).emit(callback, ...args)` and `.props`, `host.openElsewhere(path)`, `host.handle(method, fn)` to inject failures (throw a `HostError`), `host.settle()` to wait until the plugin's host calls are answered (it does not wait for the plugin's own file reads or child processes: poll the result you assert on, see `settle`). See {@link "@vestra-player/sdk/testing"!TestHost | TestHost}.

Run them with `npm test` (`vestra-plugin test`, which is `node --test tests/*.test.{ts,mjs}`).

## Check, run, build and pack

```text
vestra-plugin check [plugin-dir...]
vestra-plugin test  [plugin-dir...]
vestra-plugin build [plugin-dir...] [--version x.y.z]
vestra-plugin pack  [plugin-dir...] [--version x.y.z] [--out dir]
```

- `check`: checks the manifest (every rule above), then a strict type check of the plugin's `.ts` files and `tests/`. It extends the nearest `tsconfig.json` at or above the plugin directory, else built-in strict settings. Hints that do not fail the check (such as an id without an owner prefix) are printed.
- `build`: checks, then writes `dist/`: `.ts` files with types stripped (relative imports rewritten to `.js`), `.slint`, `.mjs` and data files copied, the manifest's `icon`, `readme` and `changelog` (and `README.md` / `CHANGELOG.md` when present) copied, `dist/manifest.json` with the version (from `--version`, else the manifest, else `package.json`). Tests, `node_modules/`, other Markdown and `package*.json` are left out. A runtime import of `@vestra-player/sdk` fails the build.
- `pack`: builds, then packs `dist/` as `<id>-<version>.vxp` (a zip with `manifest.json` at its root; the same input gives the same bytes) and prints its size and sha256. This is the file users install and repositories list.
- Runtime npm dependencies must be bundled: set `"vestra": { "bundle": true }` (or `{ "bundle": { "external": [...] } }`) in the plugin's `package.json` and add `esbuild` as a dev dependency. `"vestra": { "assets": ["vendor"] }` copies extra files verbatim.

During development no build is needed: start the player with `--plugin <plugin-dir>` (repeatable) to run `main.ts` directly.

## Versions

| SDK package | Plugin `apiVersion` | Notes                                                                                                                                                                                                                                       |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `1.x`       | `vestra/1`          | Minor releases only add backwards-compatible API; patch releases fix documentation and bugs.                                                                                                                                                |
| `1.1`       | `vestra/1`          | The additions need player 0.2.0: set `"minPlayerVersion": "0.2.0"` when you use them.                                                                                                                                                       |
| `1.3`       | `vestra/1`          | Menu ids (`@video`), `Theme.danger` and removing a video chain with `[]` need player 0.3.0: set `"minPlayerVersion": "0.3.0"` when you use them.                                                                                            |
| `1.4`       | `vestra/1`          | One exception to "only add": `ThemeId` lost the second palette and is `"vestra"` only. A plugin that compared with or set the removed id fails to type check; the player treats that id as `vestra`, so already built plugins keep running. |
| `1.5`       | `vestra/1`          | The light palette `vestra-light` and `@vestra/icons.slint` need player 0.4.0: set `"minPlayerVersion": "0.4.0"` when you use them.                                                                                                          |

A breaking change to the plugin API gets a new `apiVersion` and a new major version of this package. The `@vestra-player/sdk/runtime` entry is for the player only and is not covered by semver.

## Next

- {@link "@vestra-player/sdk"!Scope | Scope}: every module available on `plugin`.
- {@link "@vestra-player/sdk"!PluginError | PluginError}: error codes.
- {@link "@vestra-player/sdk"!Player | Player}: playback state and conditional controls.
- {@link "@vestra-player/sdk"!View | View}: windows, panels and settings pages.
