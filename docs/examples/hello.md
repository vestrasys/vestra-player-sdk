---
title: Hello
---

# Hello

The smallest useful plugin: one menu command, **Tools → Hello**, that shows an on-screen message. It is the README's Quick start as a runnable project in [`examples/hello`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/hello). The code on this page is taken from the example's files, so it is always the code CI checks.

## The manifest

{@includeCode ../../examples/hello/manifest.json}

- `id` identifies the plugin. Use `<owner>.<name>`; the examples use the owner `examples`.
- `entry` is the module the player loads. During development it is the TypeScript file itself; `vestra-plugin build` writes `main.js` into `dist/`.
- `capabilities` lists what the plugin may do: `commands` to add a command, `ui.osd` to show an on-screen message. A call that needs a capability the manifest does not declare fails with `code: "capability"`.

## The plugin

{@includeCode ../../examples/hello/main.ts}

- The SDK is imported with `import type` only. The player creates the `plugin` object and passes it to the default export, `activate`; the built plugin contains none of the SDK's code.
- {@link "@vestra-player/sdk"!Commands.add | plugin.commands.add} registers a command. `path` places it in the main menu (the last segment is the label); `run` is called when the user picks it or presses one of its `bindings`.
- {@link "@vestra-player/sdk"!Osd.show | plugin.osd.show} shows a short message over the video. It returns a promise; returning it from `run` lets the SDK report a failure to {@link "@vestra-player/sdk"!Scope.onError | onError}.
- Nothing has to be cleaned up: the command belongs to `plugin` and is removed when the plugin stops.

## The test

{@includeCode ../../examples/hello/tests/main.test.ts}

{@link "@vestra-player/sdk/testing"!startPlugin | startPlugin} runs `activate` against {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, an in-memory player that speaks the real protocol. `host.command("hello")` reaches the registered command; `host.osd` records every message.

## Run it

```sh
cd examples/hello
npm install                 # links the SDK from the repository
npm run check && npm test
npm run pack                # examples.hello-0.1.0.vxp
```

Start the player with `--plugin <path to examples/hello>` to run `main.ts` without packing. Next: [Getting started](../tutorials/getting-started.md) adds a window, state and key bindings.
