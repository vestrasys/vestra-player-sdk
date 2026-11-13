---
title: Tutorial
description: "Write a first plugin for Vestra Player: a menu item that shows the playback position, then the three styles a plugin can use, and how to test and publish it."
---

# Tutorial

A plugin for Vestra Player is a separate Node.js process that talks to the player over one connection. It is a folder with a `manifest.json` (who the plugin is and its capabilities, the things it may do), TypeScript modules that the player runs, and optional Slint files for its windows, panels and settings pages.

In this tutorial you write one: a menu item **Tools ▸ Where am I?** (also on Ctrl+Alt+W) that shows the playback position on the screen. Then you see the three styles a plugin can be written in, and how to test and publish it.

## Before you start

You need Node.js 26 or newer, a terminal, an editor, and Vestra Player with a video to play.

## 1. Set up the folder

Create the folder and install the SDK:

```sh
mkdir my-plugin && cd my-plugin
npm init -y
npm pkg set type=module
npm i -D @vestra-player/sdk
```

The package brings its own TypeScript and the `vestra-plugin` command line tool. A finished plugin folder looks like this:

```text
my-plugin/
  manifest.json        identity and capabilities
  main.ts              the entry module
  ui/*.slint           windows, panels and settings pages
  locales/*.po         translations
  tests/*.test.ts      tests (node:test)
  package.json         dev dependency and scripts
```

Add the scripts to `package.json`:

```json
{
  "type": "module",
  "scripts": {
    "check": "vestra-plugin check",
    "test": "vestra-plugin test",
    "build": "vestra-plugin build",
    "pack": "vestra-plugin pack"
  },
  "devDependencies": { "@vestra-player/sdk": "^1.8.0" }
}
```

Add a `tsconfig.json` for your editor. Its `plugins` entry marks a call whose capability the manifest does not declare while you type:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "skipLibCheck": true,
    "types": ["node"],
    "plugins": [{ "name": "@vestra-player/sdk/ts-plugin" }]
  },
  "include": ["*.ts", "tests/*.ts"]
}
```

In VS Code, open a `.ts` file, run **TypeScript: Select TypeScript Version** and pick **Use Workspace Version**. For the Slint files of windows and panels, the `@vestra/…` imports come from the player; point the Slint language server's `libraryPaths` at the SDK's copy: `{ "vestra": "node_modules/@vestra-player/sdk/slint/vestra" }`.

## 2. Write the manifest

Create `manifest.json`. Replace `me` with your GitHub user name:

```json
{
  "id": "me.hello",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": []
}
```

The plugin declares no capability: menu items, on-screen messages and the playback state need none, and `plugin.player.state` follows the player from the plugin's start. A manifest lists a capability only when the plugin changes the user's player settings, manages other plugins, or uses the clipboard or the keychain; a call whose capability is missing fails. Every field is in [Manifest](../reference/manifest.md), every capability in [Capabilities](../reference/capabilities.md).

## 3. Add a menu item

Create `main.ts`:

```ts
// main.ts
import type { Plugin } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  plugin.commands.add({
    id: "where",
    path: ["Tools", "Where am I?"],
    bindings: ["Ctrl+Alt+W"],
    enabled: plugin.when.ready, // the player evaluates it
    run: () => {
      const { position, duration } = plugin.player.state;
      return plugin.osd.show("{} s of {} s", [
        (position ?? 0).toFixed(1),
        (duration ?? 0).toFixed(1),
      ]);
    },
  });
}
```

- The player calls the default export, `activate`, when it starts the plugin.
- `path` is the menu path in English; the player translates it. To put the item into one of the player's own menus, start the path with that menu's id, such as `["@video", "Where am I?"]` ([Built-in menus](../reference/commands.md#built-in-menus)).
- `enabled` greys the item out while nothing plays. `plugin.when.ready` is a condition the player evaluates itself, so the plugin need not run to keep the item current and the player can stop it while idle ([Keep a command's state without keeping the plugin running](../guides/command-state.md)). `run` shows the message, a template with its arguments.
- Do not `await` a click on your own command or a callback of your own window inside `activate`: the player holds them until activation is done, so `activate` would wait until the start timeout (60 s) and the plugin would stop with `failed`.
- The SDK is imported with `import type` only; a runtime import fails `vestra-plugin build`.

Check it:

```sh
npm run check
```

## 4. Run it in the player

Start the player with your folder; no build is needed (repeat `--plugin` to load several plugins):

```sh
vestra-player --plugin ./my-plugin
```

Open a video, then choose **Tools ▸ Where am I?** in the right-click menu, or press Ctrl+Alt+W. The position appears at the top left of the video. After a change to `main.ts`, reload the plugin from the plugin manager, or start the player again.

## 5. Choose a style

The menu item above follows the playback state through `plugin.player.state` and the SDK decides when to tell the player. That is one of three styles. Here is the same job in each: a panel at the bottom shows the playback speed, and **C** cycles it. The code comes from the example plugin [`examples/three-ways`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/three-ways), where `speedText` and `nextRate` are two small helpers in `shared.ts`. It needs the capabilities `ui.mount` and `playback.control` as well.

### A: declare with `bind()`

{@includeCode ../../examples/three-ways/style-a.ts#speed}

The binding is a function of state. The SDK runs it again when the speed changes, and only then, and sends only what changed. The command's `enabled` works the same way. This is the default style, and the one the guides use: choose it for anything the SDK can see, such as the player's state, a window's state or your own `plugin.state`.

### B: listen with `plugin.player.on` and write with `set`

{@includeCode ../../examples/three-ways/style-b.ts#speed}

The listener receives every `source.state` event with a typed payload ([Events](../reference/events.md)), and `set` sends the value whole each time. Nothing compares for you, so the plugin keeps `shown` to avoid sending the same text ten times a second. Choose it when the value comes from outside the SDK (a timer, a socket, an emulator's frame) and you know exactly when it changed.

### C: direct messages with `plugin.wire`

{@includeCode ../../examples/three-ways/style-c.ts#speed}

Events, requests and property writes by the player's own names ([Messages](../reference/messages.md)), untyped and without the SDK's value checks. This layer changes with player versions. Choose it only to try a player method the SDK does not wrap yet, or to send list row operations you already have.

The styles mix freely in one plugin, with one rule: a property is either bound or set (A, B) or written directly (C), never both; the SDK refuses the second with `invalid`.

## 6. Test and publish

Create `tests/main.test.ts`. `startPlugin` runs the plugin against an in-memory player that reads your `manifest.json`:

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
  await host.command("where").run(); // as if the user chose the item
  assert.deepEqual(host.osd, ["12.0 s of 60.0 s"]);
  await stop();
});
```

Then run the tests and the checks, and pack:

```sh
npm test                     # tests/*.test.ts against an in-memory player
npm run check                # the manifest, then a strict type check
npm run pack                 # dist/, then me.hello-0.1.0.vxp
```

- The tests need no player; simulating sources, failures and restarts is in [Test a plugin](../guides/testing.md).
- Install the `.vxp` in the player to try what users will get.
- To publish, push the plugin to a public GitHub repository and register it with a pull request to the plugin repository: [Publish a plugin](../guides/publish.md).

## Next

- [How a plugin works](../guides/how-plugins-work.md): the rules behind every plugin, on one page.
- [Open a tool window and remember its state](../guides/windows.md): a window with a button.
- [Add settings and translations](../guides/i18n.md): a settings page and a second language.
- [Design rules](../guides/design-rules.md): make the plugin feel like part of the player.
- [Examples](../examples/index.md): complete plugins to read.
- [Reference](../reference/index.md): manifest, capabilities, commands, events, limits.
