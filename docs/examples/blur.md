---
title: "Example: Blur"
description: "Walkthrough of examples/blur: a command in the Video menu, a tool window with one slider and a live video filter."
---

# Example: Blur

This walkthrough builds **Blur**: a menu command opens a small window with one slider, and the slider blurs the video that is playing. It is about 40 lines of TypeScript and 40 lines of Slint, and it shows three parts of the API working together: a command, a tool window and a video filter.

The complete source is in [`examples/blur/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/blur). Every code block on this page is taken from those files, so it is always the code CI checks and tests.

## What you'll build

![The Blur window over a playing video](../../examples/blur/screenshot.png)

- **Video ▸ Blur…** in the player's own Video menu opens the **Blur** window.
- The window has one slider, the blur strength from 0 to 10. The video follows the slider while you drag it. At 0 the blur is off.
- If the player cannot apply the blur, the window says why in one line of red text.

You should know the basics from [Hello](hello.md): a plugin is a folder with a `manifest.json` and a `main.ts` whose default export, `activate(plugin)`, the player calls.

## The files

```text
examples/blur/
  manifest.json       id and capabilities
  main.ts             the filter, the window and the menu command
  ui/blur.slint       the window: one slider
  tests/blur.test.ts  tests against the SDK's in-memory test host
  package.json        the SDK as a dev dependency, and the npm scripts
```

## The manifest

{@includeCode ../../examples/blur/manifest.json}

A call whose capability is missing from the manifest fails with `code: "capability"`. Blur needs five:

| Capability                | Why                                                                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`                | `plugin.commands.add`: the menu item.                                                                                                                                                 |
| `ui.window`               | `plugin.windows.create`: the Blur window.                                                                                                                                             |
| `processing.video`        | `plugin.video.filter`: the blur itself.                                                                                                                                               |
| `playback.read`, `events` | A filter reads the player's state, and follows its changes, to know when there is a video to apply the blur to. Without `events` a blur set before a video starts would stay waiting. |

`minPlayerVersion` is 0.3.0 because the menu path uses the `@video` menu id and the window uses `Theme.danger`, both new in that version. Older players refuse to load the plugin with a clear message.

## main.ts, top to bottom

### Activation

{@includeCode ../../examples/blur/main.ts#activate}

The SDK is imported with `import type` only: the player passes the `plugin` object to `activate`, and everything the plugin creates through it (the filter, the window, the command) is released when the plugin stops. There is no cleanup code to write.

### The filter

{@includeCode ../../examples/blur/main.ts#filter}

- `plugin.video.filter("blur")` creates this plugin's **filter chain**, a list of processing nodes the player runs on every decoded frame. Creating it sends nothing.
- `strength` is the plugin's only state. The window shows it and the slider changes it.
- `Math.round(value * 10) / 10` keeps one decimal. The window's label shows one decimal too, and a slider dragged all the way left lands on exactly 0 instead of 0.02.
- `{ kind: "gblur", sigma, steps: 3 }` is FFmpeg's Gaussian blur. `sigma` is the radius, 0–10 (the slider's range); `steps` must be 3. A value out of range would be refused with `invalid`.
- `[]` is the empty chain: it removes this plugin's blur and leaves other plugins' filters alone.
- `blur.set(chain)` returns immediately. The SDK applies the chain when a video plays and again for every new video, so the plugin calls `set` only when the strength changes.

**Calling `set` on every mouse move is fine.** While you drag, the window reports a new value dozens of times a second. The filter sends at most one request at a time; a `set` while a request is on its way only replaces the pending value, so the player always ends up with the latest value and never works through a queue of old ones.

### The window

{@includeCode ../../examples/blur/main.ts#window}

- `plugin.windows.create("ui/blur.slint")` loads the window file but does not open it. The window's id is the file name, `blur`.
- `bind(() => ({ … }))` keeps the window's properties equal to what the function returns. The SDK calls it again after every callback and every change of the filter's status, and sends only the values that changed. The plugin never pushes updates by hand.
- `blur.status` is `waiting`, `applying`, `applied` or `failed`. Only a failure is worth showing here, with the player's reason in `error.message`. One failure you can see on purpose: a **generated stream** (such as the [signal generator](signal-generator.md)) does not pass through the player's filters, so while one plays the status is `failed` with the code `unsupported`. The blur comes back by itself when a video plays again.
- `on("strengthChanged", setStrength)` connects the Slint callback `strength-changed` to the function above. TypeScript may use either spelling.

### The command

{@includeCode ../../examples/blur/main.ts#command}

- `path: ["@video", "Blur…"]` puts the item in the player's own **Video** menu. Paths merge by their English keys in every interface language, so `["Video", "Blur…"]` reaches the same menu; the id form `@video` says plainly that a built-in menu is meant, and an unknown id fails with `invalid` instead of making a new menu ([Menu paths](../reference/commands.md#menu-paths)). Players up to 0.4.2 titled their menus in Chinese and are reached only by the id. The built-in menu stays where it is, and an item without `order` goes at the end of it.
- `run` opens the window, or shows it again after the user closed it. Returning the promise of `show()` lets the SDK report a failure to the plugin log.

## ui/blur.slint

{@includeCode ../../examples/blur/ui/blur.slint}

- The imports come from the player at run time: `Theme` holds its colours and sizes, so the window follows the player's colour scheme, and `Slider` looks like the player's own sliders.
- A window file exports one component that inherits `Window`.
- **Properties carry data from the plugin to the window.** `strength` is `in-out` because the user changes it too; `problem` is `in` because only the plugin writes it.
- **Callbacks carry actions from the window to the plugin.** `strength-changed` passes the slider's new value.
- `value <=> root.strength` is a **two-way binding**. A one-way binding (`value: root.strength`) would be broken by Slint the first time the user drags the slider, and from then on the plugin could no longer move it, for example when the window is opened again.
- `changed(value)` fires on every mouse move during a drag: that is what makes the blur follow the slider live.
- The label rounds the value to one decimal, like `setStrength`.

## The tests

{@includeCode ../../examples/blur/tests/blur.test.ts}

`startPlugin` runs `activate` against `TestHost`, an in-memory player that speaks the real protocol, so the SDK's filter logic runs unchanged; there is no video and no Slint. `host.setSource({ phase: "ready" })` pretends a video is playing, `window.emit` fires a Slint callback as if the user had moved the slider, and `host.processing.resources` holds what the player currently applies for each plugin. Always `await host.settle()` before checking: it waits until every request has been answered.

## Run it

In the SDK repository, build the SDK once (`npm ci` at the root), then:

```sh
cd examples/blur
npm install
npm run check   # manifest rules and a strict type check
npm test
```

Start the player with `--plugin <path to examples/blur>`: it runs `main.ts` directly, with no build step. Open a video, choose **Video ▸ Blur…** and drag the slider. `npm run pack` builds `examples.blur-1.0.0.vxp`, the file users install.

## Try next

1. **Remember the strength.** Keep it in `plugin.storage.json("blur", { defaults: { strength: 0 } })`, call `save` in `setStrength`, and call `setStrength(store.value.strength)` at activation. See `Storage`.
2. **A shortcut and a check mark.** Add a second command with `bindings: ["Ctrl+Shift+B"]` that switches between 0 and the last strength, and `checked: () => strength > 0` so the menu shows whether the blur is on. See `CommandOptions`.
3. **Presets.** Add a `ComboBox` with Light, Medium and Strong to the window and a callback that calls `setStrength` with 2, 5 or 9. Because `strength` is bound two-way, the slider moves with it.

## See also

- `VideoFilter`, `FilterStatus` and `VideoNode`: filters, their status and every node type with its ranges.
- `View` and `Window`: properties, callbacks and `bind`.
- [Keep a slider responsive while dragging](../how-to/slider.md).
- `TestHost` in `@vestra-player/sdk/testing`.
