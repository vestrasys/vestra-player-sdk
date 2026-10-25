---
title: Getting started
description: "The one tutorial, from an empty folder to a packed plugin: files, manifest, a first command, a window, tests and packaging."
---

# Getting started

This guide walks through a complete Vestra Player plugin: the files it is made of, the manifest, a first command, a window, tests, and packaging. The API reference is split into {@link "@vestra-player/sdk" | @vestra-player/sdk} (the plugin API) and {@link "@vestra-player/sdk/testing" | @vestra-player/sdk/testing} (the test host); start from {@link "@vestra-player/sdk"!Plugin | Plugin} and {@link "@vestra-player/sdk"!Scope | Scope}.

## How plugins run

- Each plugin runs in its own Node.js process (Node.js 26, which the player ships). It can use the Node standard library, the file system, the network and npm packages.
- The player loads the entry module and calls its **default export** `activate(plugin)`. The plugin imports the SDK **as types only**, so a built plugin contains nothing but its own code.
- Everything a plugin creates (commands, windows, panels, filters, listeners…) is a handle that is released automatically when the plugin stops. There is no cleanup function to return.

[How a plugin runs](../concepts/plugins.md) explains the process, activation, handles, the update pass and failures in full.

## Rules for plugins

Every plugin, in the official plugin repository or not, follows these rules. They keep plugins independent of each other and portable.

- **Only the public SDK.** Import `@vestra-player/sdk` with `import type` only (a runtime import fails `vestra-plugin build`) and `@vestra-player/sdk/testing` only in tests. `@vestra-player/sdk/runtime` and the SDK's internal modules are for the player.
- **No other plugins.** Do not import another plugin's code, read its directory or data directory, or talk to it privately (shared files, sockets, messages). A plugin must load, run and stop while no other plugin is installed. Plugins share only what the API makes public: player state, timeline marks, menus, settings pages.
- **No system commands.** Do not run `open`, `sips`, `plutil`, `security`, `cmd`, `powershell` or similar. Use the API (`plugin.system` to open files and links, `plugin.clipboard`, `plugin.secrets`, `plugin.tools` for ffmpeg and ffprobe) or portable Node.js code. If the API lacks something every system needs, ask for it in the SDK repository.
- **macOS and Windows.** The same code runs on both: build paths with `node:path`, write package paths with `/`, and handle `unsupported` where a method documents a platform difference.
- **Your own id.** `<owner>.<name>`, where the owner is your GitHub user or organization. `vestra` and `vestra.*` are reserved for the plugins built into the player.

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

- `id` is your plugin's identifier: `<owner>.<name>`, ASCII letters, digits, `.`, `-` and `_`.
- `version` is `x.y.z`; `vestra-plugin build` writes it into the package.
- `apiVersion` is always `"vestra/1"` for this major version of the SDK.
- `entry` is the entry module: `.ts` while you develop, `.js` after building.
- `capabilities` lists what the plugin may do. A call to a member whose capability is missing fails with `code: "capability"`.

Optional display fields (`name`, `author`, `punchline`, `description`, `tags`, `icon`, `readme`, `changelog`, `sourceUrl`, `license`) are shown by the plugin store and the plugin manager, and `minPlayerVersion` names the oldest player that can load the plugin. Every field with its exact rules is in [Manifest](../reference/manifest.md#fields).

The capabilities you need first:

| Capability      | Opens                                                                                              |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `commands`      | `plugin.commands.add` (menu items and key bindings) and `plugin.host.run`                          |
| `ui.window`     | `plugin.windows.create` (tool windows)                                                             |
| `playback.read` | reading `plugin.player.state` (what is playing, the position), `stats`, `chapters`, timeline marks |

The plugin on this page also uses `ui.osd` (on-screen messages), `events` (follow playback changes as they happen) and `playback.control` (seeking). Every capability, with the members it opens and the capabilities they also need, is in [Capabilities](../reference/capabilities.md).

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

Useful controls: `host.command(id).run()`, `host.press("Ctrl+Alt+W")`, `host.window(id).emit(callback, ...args)` and `.props`, `host.openElsewhere(path)`, `host.handle(method, fn)` to inject failures (throw a `HostError`), `host.settle()` to wait until the plugin's host calls are answered (it does not wait for the plugin's own file reads or child processes: poll the result you assert on, see `settle`). See {@link "@vestra-player/sdk/testing"!TestHost | TestHost} and [Test a plugin](../how-to/testing.md).

Run them with `npm test` (`vestra-plugin test`, which is `node --test tests/*.test.{ts,mjs}`).

## Check, run, build and pack

```text
vestra-plugin check [plugin-dir...]
vestra-plugin test  [plugin-dir...]
vestra-plugin build [plugin-dir...] [--version x.y.z]
vestra-plugin pack  [plugin-dir...] [--version x.y.z] [--out dir]
```

- `check` checks the manifest, then type checks the plugin's `.ts` files and `tests/` strictly.
- `build` checks, then writes `dist/`: the code with types stripped, the Slint and data files, and `dist/manifest.json` with the version. A runtime import of `@vestra-player/sdk` fails the build.
- `pack` builds, then packs `dist/` as `<id>-<version>.vxp`, the file users install and the plugin store lists.

What `build` puts into the package, how to bundle npm dependencies and the translation commands are in [Command line](../reference/cli.md).

During development no build is needed: start the player with `--plugin <plugin-dir>` (repeatable) to run `main.ts` directly.

## Versions

Every 1.x release of the SDK implements the plugin API `vestra/1`; minor releases only add to it, and a breaking change gets a new `apiVersion` and a new major version. Some additions need a newer player: when you use one, set `minPlayerVersion` to the version it names. [Player versions](../reference/manifest.md#player-versions) lists which API needs which player.

## Next

- [Examples](../examples/index.md): complete plugins, each with a step-by-step walkthrough.
- [Concepts](../concepts/index.md): how plugins, commands, playback, processing and the interface work.
- [Test a plugin](../how-to/testing.md) and [Publish a plugin](../how-to/publish.md).
- {@link "@vestra-player/sdk"!Scope | Scope}: every module available on `plugin`; {@link "@vestra-player/sdk"!PluginError | PluginError}: error codes.
