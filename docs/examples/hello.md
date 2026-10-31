---
title: Hello
description: "Walkthrough of examples/hello: the smallest plugin, with a manifest, one menu command and an on-screen message."
---

# Hello

The smallest useful plugin: one menu command that shows a message over the video. It is the README's Quick start as a runnable project.

## What it demonstrates

The manifest and capabilities · a menu command · the on-screen display.

[Getting started](../tutorials/getting-started.md) teaches the same steps from an empty folder.

## What you'll build

![Hello in Vestra Player](../../examples/hello/screenshot.png)

**Tools ▸ Hello** in the main menu. Choosing it shows "Hello" at the top left of the video for a moment.

## Files

```text
examples/hello/
  manifest.json          who the plugin is and what it may do
  main.ts                the code
  tests/main.test.ts     a test against the SDK's in-memory player
  package.json           the SDK as a dev dependency, and the scripts
```

The code below is pulled from these files, so it is exactly what CI builds and tests.

## The manifest

{@includeCode ../../examples/hello/manifest.json}

- `id` names the plugin, as `<owner>.<name>` (your GitHub user or organization). `vestra.` ids are reserved for the player's built-in plugins.
- `entry` is the module the player loads: the TypeScript file itself during development.
- `capabilities` lists what the plugin may do. `commands` lets it add a menu command, `ui.osd` lets it show a message over the video. A call without its capability fails with `code: "capability"`.

## The code

{@includeCode ../../examples/hello/main.ts}

From top to bottom:

1. `import type` brings in the SDK's types only. The player creates the `plugin` object, so the built plugin contains none of the SDK's code.
2. The default export, `activate`, is what the player calls when it loads the plugin.
3. {@link "@vestra-player/sdk"!Commands.add | plugin.commands.add} registers a command. `id` is its name inside the plugin; `path` puts it in the main menu, and the last segment is the label.
4. `run` is called when the user picks the item. {@link "@vestra-player/sdk"!Osd.show | plugin.osd.show} shows the message. Returning its promise lets the SDK report a failure instead of losing it.

Nothing needs cleaning up: the command belongs to `plugin` and is removed when the plugin stops.

## The test

{@includeCode ../../examples/hello/tests/main.test.ts}

- {@link "@vestra-player/sdk/testing"!startPlugin | startPlugin} runs `activate` against {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, an in-memory player. `directory` makes it read `manifest.json`, so the test has the plugin's real capabilities.
- `host.command("hello")` is the registered command: its `declaration` (here the menu path) and `run()`, which acts like a click.
- `host.osd` lists every message the plugin showed.

## Run it

```sh
npm ci                    # once, in the SDK repository root
cd examples/hello
npm install
npm run check && npm test
npm run pack              # examples.hello-0.1.0.vxp
```

Or start the player with `--plugin <path to examples/hello>` to run `main.ts` directly, without packing.

## Try next

1. **A shortcut.** Add `bindings: ["Ctrl+Alt+H"]` to the command; the key then runs it too.
2. **A different menu.** Use `path: ["@playback", "Hello"]` to join the player's own **Playback** menu, and add `"minPlayerVersion": "0.3.0"` to the manifest (menu ids are new in 0.3.0).
3. **Go further.** [Getting started](../tutorials/getting-started.md) adds a window and state; [Bookmark](bookmark.md) is the next example.
