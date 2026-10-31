---
title: Getting started
description: "Tutorial 1 of 4: from an empty folder to a plugin with a menu item that shows the playback position on the screen, running in the player."
---

# Getting started

In this tutorial you write a plugin for Vestra Player: a menu item **Tools ▸ Where am I?** (also on Ctrl+Alt+W) that shows the playback position on the screen. The next tutorials add a window, settings and translations, tests and packaging to the same plugin.

## Before you start

You need Node.js 26 or newer, a terminal, an editor, and Vestra Player 0.2 or newer with a video to play. Why the steps work the way they do is explained in [How a plugin runs](../explanation/plugins.md); you do not need it to follow along.

## 1. Set up the folder

Create the folder and install the SDK:

```sh
mkdir my-plugin && cd my-plugin
npm init -y
npm pkg set type=module
npm i -D @vestra-player/sdk
```

The package brings its own TypeScript and the `vestra-plugin` command line tool. By the end of the series the folder looks like this:

```text
my-plugin/
  manifest.json        identity and capabilities
  main.ts              the entry module
  ui/hello.slint       optional: user interface
  tests/main.test.ts   tests (node:test)
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
  "devDependencies": { "@vestra-player/sdk": "^1.5.0" }
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

In VS Code, open a `.ts` file, run **TypeScript: Select TypeScript Version** and pick **Use Workspace Version**.

## 2. Write the manifest

Create `manifest.json`. Replace `me` with your GitHub user name:

```json
{
  "id": "me.hello",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": ["commands", "ui.osd", "playback.read", "events"]
}
```

The capabilities say what the plugin may do: add menu items (`commands`), show on-screen messages (`ui.osd`), read the playback state (`playback.read`) and follow its changes (`events`). Every field is in [Manifest](../reference/manifest.md), every capability in [Capabilities](../reference/capabilities.md).

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

The player calls the default export `activate` when it starts the plugin. `path` is the menu path in English, `enabled` greys the item out while nothing plays, and `run` shows the message. The SDK is imported with `import type` only. To put the item into one of the player's own menus instead of a new **Tools** menu, start the path with that menu's id, such as `["@video", "Where am I?"]` ([Built-in menus](../reference/commands.md#built-in-menus)).

Check it:

```sh
npm run check
```

## 4. Run it in the player

Start the player with your folder; no build is needed (repeat `--plugin` to load several plugins):

```sh
vestra-player --plugin ./my-plugin
```

Open a video, then choose **Tools ▸ Where am I?** in the right-click menu, or press Ctrl+Alt+W. The position appears at the top left of the video for two seconds. After a change to `main.ts`, reload the plugin from the plugin manager, or start the player again.

## Next

- [Add a window](add-a-window.md): the second tutorial gives the plugin a window with a button.
- [Explanation](../explanation/index.md): how plugins, commands, playback and the interface work.
- [Examples](../examples/index.md): complete plugins to read.
