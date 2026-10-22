---
title: "Example: Blur"
---

# Example: Blur

This walkthrough builds **Blur**, a plugin that puts a live Gaussian blur over the video that is playing. It is small (about 250 lines of TypeScript and 150 lines of Slint), but it uses most of what a real plugin needs: a menu command with a shortcut, a tool window, a page in the options window, a video filter, saved settings, on-screen messages and tests.

The complete source is in [`examples/blur/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/blur). Every code block on this page is pulled from those files, so what you read is exactly what is built and tested.

## What you'll build

![The Blur window over a playing video](../../examples/blur/screenshot.png)

- **Video ▸ Blur**: a menu item with a check mark that turns the blur on and off. The shortcut is Ctrl+Shift+B (⌘⇧B also works on macOS).
- **Video ▸ Blur Controls…** opens the **Blur** window:
  - an on/off switch;
  - a **Strength** slider (0–10). The video follows the slider while you drag it;
  - a **Preset** drop-down (Light, Medium, Strong);
  - the filter's status (waiting for a video, applying, applied, failed), with a **Retry** button after a failure;
  - **Options…** and **Reset** buttons.
- **Options ▸ Video ▸ Blur**: whether blur comes back on at startup, and whether to show on-screen messages.
- The strength is remembered across restarts. A short message appears over the video when something changes.

## Prerequisites

- Node.js 26 or newer and npm.
- Vestra Player 0.2.0 or newer, to see the result.
- You have read [Getting started](../tutorials/getting-started.md), or at least know that a plugin is a folder with a `manifest.json` and an entry module that default-exports `activate(plugin)`.

## File layout

```text
examples/blur/
  manifest.json      identity, capabilities and the store listing
  main.ts            activate(): storage, filter, commands, window, settings page
  model.ts           the settings type, presets, filter chain and status line
  ui/window.slint    the Blur tool window
  ui/settings.slint  the Options ▸ Video ▸ Blur page
  tests/blur.test.ts tests that run against the SDK's TestHost
  package.json       the SDK as a dev dependency, scripts
  tsconfig.json      strict TypeScript settings for `vestra-plugin check`
  README.md
```

`model.ts` holds plain functions with no player calls. Keeping them out of `main.ts` leaves `main.ts` about wiring, and makes the logic easy to read and test.

## Step 1: The manifest and its capabilities

{@includeCode ../../examples/blur/manifest.json}

- `id` is unique across all plugins. The official plugin repository expects `<owner>.<name>`.
- `entry` is `main.ts`. The player runs TypeScript directly during development; `vestra-plugin build` rewrites it to `main.js` in `dist/manifest.json`.
- `name`, `author`, `punchline`, `description` and `tags` are only shown by the plugin store and the plugin manager.

Capabilities are a contract: the player refuses a call whose capability is missing, with `code: "capability"`. List exactly what you use:

| Capability | Why Blur needs it |
| --- | --- |
| `commands` | `plugin.commands.add`: the two menu items and the shortcut. |
| `ui.window` | `plugin.windows.create`: the Blur window. |
| `ui.settings` | `plugin.settings.page` and `plugin.settings.show`: the options page and the Options… button. |
| `ui.osd` | `plugin.osd.show`: the on-screen messages. |
| `processing.video` | `plugin.video.filter`: the blur itself. |
| `playback.read` | A filter reads the player's source state to know whether there is a video to apply to. `processing.video` always comes with it. |
| `events` | Live updates of that source state. Without it, the filter never learns that a video started playing: a blur turned on before a video was opened would stay "waiting" forever. |

`plugin.storage` needs no capability.

## Step 2: Activation

{@includeCode ../../examples/blur/main.ts#activate}

The player starts one Node.js process per plugin and calls the default export with the `plugin` object. Everything the plugin creates through `plugin` (commands, windows, pages, filters, listeners) belongs to it and is released when the plugin stops, so there is no `deactivate` function. Step 9 shows what that means in practice.

Calls such as `commands.add` return immediately and register in the background. The plugin is reported ready once all of them have succeeded; if one fails, activation fails and the reason goes to the plugin log.

## Step 3: Settings that survive a restart

Blur remembers four values. The type, its defaults and a validator live in `model.ts`:

{@includeCode ../../examples/blur/model.ts#settings}

`main.ts` opens the file and wraps writes in a small `change` helper:

{@includeCode ../../examples/blur/main.ts#store}

- `plugin.storage.json("blur", …)` reads `<dataDirectory>/blur.json` synchronously, so `store.value` is ready on the next line. A missing file gives `defaults`.
- `validate` protects you from a damaged or hand-edited file. If it returns `false`, or the file is not JSON, the SDK renames the file to `blur.json.bad-<timestamp>` and starts from the defaults instead of crashing.
- `store.save(next)` replaces `store.value` immediately and writes the file 300 ms after the last call (writes go to a temporary file, then a rename). Dragging a slider therefore costs one write, not hundreds. Only `save` writes: changing a field of `store.value` in place is not saved.
- On startup, "on" is cleared unless the user asked for it on the options page (`restoreOnStart`). A video that suddenly appears blurred the next day is surprising; a remembered strength is not.

**Why storage and not the settings page?** A settings page (Step 8) is a view: it shows values and reports clicks, but it saves nothing. `plugin.storage` is where values persist. Blur keeps one store and lets both the window and the page read from it and write to it, so the menu, the window and the page can never disagree.

## Step 4: The filter

A **filter chain** is a list of processing nodes that the player runs on every decoded frame, in order, before the frame is shown. Each plugin owns its own chains, named by `id`, and the player joins all plugins' chains in a stable order (at most 64 nodes in total). Blur's chain has at most one node:

{@includeCode ../../examples/blur/model.ts#chain}

- `{ kind: "gblur", sigma, steps: 3 }` is FFmpeg's Gaussian blur. `sigma` is the radius of the blur, 0–10; `steps` must be 3 in this API version. A value out of range is refused with `invalid`, so `clampSigma` keeps it in range.
- `[]` (blur off) is a valid chain: it withdraws this plugin's effect and leaves other plugins' filters alone.

`main.ts` creates the filter, sends the first value and watches for failures:

{@includeCode ../../examples/blur/main.ts#filter}

- `plugin.video.filter("blur")` creates the handle but sends nothing; `set()` sends the chain.
- `set()` returns immediately. It does not throw for a bad value or a missing video; the outcome arrives as a **status** instead.
- The SDK re-applies the chain for every new video. You call `set()` only when *your* value changes.
- `say` is the on-screen message helper from Step 6.

### Filter status

`blur.status` is always one of four states, and `onStatus` reports every change:

| State | Meaning |
| --- | --- |
| `waiting` | There is no playing video. The value is kept and applied as soon as there is one. |
| `applying` | A request is on its way to the player. |
| `applied` | The player accepted the chain. (It does not guarantee that the next frame on screen already shows it.) |
| `failed` | The player refused it; `status.error.code` and `status.error.message` say why. Nothing retries automatically until the next `set()`, `retry()` or a new video. `backend-uncertain` means the video backend temporarily blocked the stage: `retry()` is the right answer. |

`model.ts` turns the status into the line the window shows:

{@includeCode ../../examples/blur/model.ts#status}

### Continuous `set()`: only the latest value counts

While you drag the strength slider, the window reports a new value on every mouse move, dozens of times a second, and Blur calls `set()` for each one. That is safe because of how a filter handles calls:

1. At most **one request is in flight** per filter.
2. A `set()` while a request is in flight does not queue another request. It replaces the *pending* value; the last write wins.
3. When the request finishes, the filter sends the newest pending value, if there is one.

Ten moves while the player is busy cost two requests: the first value and the last one. The final state on screen is always the value of the last `set()`, and the status shows `applied` only once that last value is in. The test in Step 10 checks exactly this.

Continuous `set()` suits `gblur` because `sigma` is a **live** field: the player changes it in place while the video plays. Fields that are not live (for example `sharpen`'s `amount` or `denoise`) make the player rebuild the stage, which can stall the picture for a frame. For those, send the value when the slider is released instead. The `VideoNode` reference marks which fields are live.

## Step 5: The menu command and the shortcut

{@includeCode ../../examples/blur/main.ts#toggle}

{@includeCode ../../examples/blur/main.ts#commands}

- `path: ["Video", "Blur"]` puts the item in the **Video** menu. Menu paths are matched by their exact text, so the player creates the **Video** menu if no menu with that title exists yet.
- `order` sorts siblings; 200–699 is the range for domain menus such as video and audio.
- `bindings: ["Ctrl+Shift+B"]` is the default shortcut. On macOS a `Ctrl+…` binding fires for both ⌃ and ⌘. If another command already uses the key, that is not an error: the user's own assignments win, then the player's own commands, then the plugin that loaded first. The player's built-in video and subtitle plugins already use Ctrl+B and Alt+B, which is why Blur uses Ctrl+Shift+B. Users can reassign any binding in the player's shortcut settings.
- `checked` is a function, not a value. The SDK calls it again after every handler it runs (menu, shortcut, window callback, settings page, filter status), and sends the check mark only when it changed. So when the window's switch turns blur off, the menu's check mark follows without any extra code.
- `run` may return a promise. Errors it throws go to `plugin.onError` and the plugin log.
- The second command calls `controls.show()`. `controls` is the window created a few lines later (Step 7); that is fine because `run` only executes when the user picks the item, long after activation.

## Step 6: On-screen messages

{@includeCode ../../examples/blur/main.ts#osd}

`plugin.osd.show(text)` shows one line at the top-left of the video for two seconds, replacing the previous message. It returns a promise that rejects with `unavailable` when the player runs without a user interface. Blur does not care about that case, so it uses `void`: an unawaited rejection is written to the plugin log and never crashes the plugin.

## Step 7: The Blur window

A tool window is a `.slint` file in your package. The plugin writes **properties** into it and receives **callbacks** from it. Here is `ui/window.slint`, piece by piece.

### Imports and the component

{@includeCode ../../examples/blur/ui/window.slint:1-10}

- Lines 3–5: `std-widgets.slint` is Slint's standard library (here `ComboBox` and `Switch`). `@vestra/theme.slint` and `@vestra/widgets.slint` are supplied by the player at run time: `Theme` holds the palette and sizes, so the window follows the player's colour scheme; `Button` and `Slider` look like the player's own controls. For editor support, point the Slint language server's library path `vestra` at `node_modules/@vestra-player/sdk/slint/vestra`.
- Line 7: a window file exports exactly one component, and it inherits `Window`.
- Line 10: `Theme.bg-panel` instead of a hard-coded colour, so the window changes with the player's palette.

### Properties and callbacks: the bridge to TypeScript

{@includeCode ../../examples/blur/ui/window.slint:12-27}

- Properties carry data from the plugin to the window. `in` properties are only ever written by the plugin (`presets`, `status`, `failed`). `in-out` properties are also changed by the user through a control (`enabled`, `strength`, `preset-index`).
- Callbacks carry user actions from the window to the plugin. They return nothing; their arguments must be JSON values (numbers, strings, booleans, arrays, structs).
- Names are converted for you: TypeScript's `presetIndex` is Slint's `preset-index`, and `controls.on("strengthChanged", …)` handles `strength-changed`. Either spelling works on the TypeScript side.

### The switch

{@includeCode ../../examples/blur/ui/window.slint:33-37}

- Line 35: `checked <=> root.enabled` is a **two-way binding**. A one-way binding (`checked: root.enabled`) would be replaced the first time the user clicks the switch, and from then on the plugin could no longer move it, for example when blur is turned off from the menu. Every control whose value the plugin also changes needs `<=>` to an `in-out` property.
- Line 36: `toggled` fires on a user click only, and passes the new state to the plugin.

### The strength slider

{@includeCode ../../examples/blur/ui/window.slint:48-63}

- Lines 49–50: the slider covers the whole `gblur` range, 0–10.
- Line 51: the slider is greyed out while blur is off.
- Line 52: two-way binding again, so **Reset** and the presets can move the slider.
- Line 53: `changed` fires on every mouse move during a drag: the live preview.
- Line 54: `released` fires once when the mouse button goes up. Blur only uses it for an on-screen message; a filter whose fields are not live would send its value here.
- Line 58: the label rounds to one decimal. The plugin stores the exact value, so what it writes back to `strength` is what the slider already shows, and the thumb does not jump.

### Preset, status and buttons

{@includeCode ../../examples/blur/ui/window.slint:75-109}

- Lines 77–78: the plugin supplies the list (`presets`) and the selected index.
- Line 79: `selected` fires when the user picks an entry.
- Line 87: the status line uses the accent colour after a failure.
- Line 92: `if root.failed:` creates the **Retry** button only while there is a failure.

### The TypeScript side: properties

{@includeCode ../../examples/blur/main.ts#window-bind}

- `plugin.windows.create` loads the file but opens nothing. The window id is the file name without extension, `window`; tests use it as `host.window("window")`.
- `bind(() => props)` keeps the window's properties equal to what the function returns. The SDK re-runs the function after every handler and every status change, and sends only properties whose values changed. You never push updates by hand: change the store, and the window follows. Because the first `show()` opens the window with these values already set, it never flashes its Slint defaults.
- `...statusLine(…)` spreads `{ status, failed }` into the props. `blur.status` is read inside the function, so a status change refreshes the line.

The presets themselves are in `model.ts`. `presetIndex` maps a strength back to a preset, or to "Custom" when it matches none:

{@includeCode ../../examples/blur/model.ts#presets}

### The TypeScript side: callbacks

{@includeCode ../../examples/blur/main.ts#window-callbacks}

- Bind every callback with `on()` **before the first `show()`**. Binding a new callback name afterwards throws. Here all of them are bound during activation.
- `strengthChanged` is the live preview: store the value, `apply()`, done. The filter's latest-value rule (Step 4) keeps this cheap. `clampSigma` guards against values outside 0–10.
- `presetChosen` with the "Custom" entry is the interesting case. The user moved the drop-down, but there is nothing to apply, and `presetIndex(...)` returns the same value as before, so `bind()` sees no change and sends nothing. `controls.set({ presetIndex })` writes the property **even if unchanged**, which pulls the drop-down back to the preset that matches the strength. That is the difference between `set` and `bind`: `bind` sends changes, `set` always sends.
- `reset` only changes the store; `bind()` moves the slider and the drop-down.
- `retry` calls `blur.retry()`, which re-checks the player and sends the current value again.
- `openOptions` opens the options window at this plugin's page (`"blur"` is the page id from Step 8).

## Step 8: The options page

A page in the options window is also a Slint file, but it is built like a panel: it exports **one global**, the bridge the plugin talks to, and **one component**, the layout. Properties and callbacks live on the global.

{@includeCode ../../examples/blur/ui/settings.slint:6-11}

{@includeCode ../../examples/blur/ui/settings.slint:13-36}

- The component inherits `Rectangle`, not `Window`: the options window hosts it. Pages are 440 logical pixels wide; the options window scrolls taller pages.
- The checkboxes bind two-way to the global (`checked <=> BlurPage.restore-on-start`) and report clicks through its callbacks, just like the window does with `root`.

{@includeCode ../../examples/blur/main.ts#settings-page}

- `category: "video"` puts the page under Options ▸ Video. `id` is unique within the plugin; `title` is shown in the category tree.
- `page.bind` and `page.on` work like the window's. Unlike a window, a page has no "bind callbacks before showing" rule.
- The handlers only `change()` the store. The next time Blur starts, Step 3 reads `restoreOnStart`; `say` reads `messages` on every call.

## Step 9: Cleanup

Blur has no cleanup code, and needs none. Every handle was created through `plugin`, so it belongs to the plugin's root scope. When the user disables the plugin, or the player quits:

- the player removes the menu items, the binding, the window and the options page;
- the filter is withdrawn, and the video is no longer blurred;
- the store writes any pending save to `blur.json`;
- listeners such as `onStatus` are unsubscribed.

You would add code only for resources the SDK does not know about: a timer, a socket, a child process. Register those with `plugin.onDispose(() => clearInterval(timer))`. For a feature that comes and goes while the plugin runs (a temporary window and its listeners, a menu that is rebuilt), create a child scope with `plugin.scope()` and dispose it on its own.

The last test in Step 10 stops the plugin and checks that the player no longer holds a blur.

## Step 10: Tests

`@vestra-player/sdk/testing` provides `TestHost`, an in-memory player that speaks the real protocol, so the SDK's own logic (bindings, filter requests, storage) runs unchanged. There is no video decoding and no Slint: a window is its properties and callbacks.

Three helpers keep the tests short:

{@includeCode ../../examples/blur/tests/blur.test.ts#helpers}

- `host.setSource({ phase: "ready" })` before starting simulates a video that is already playing.
- `startPlugin` reads `manifest.json` from the directory, so the tests run with the same capabilities as the real plugin.
- `host.processing.resources` is what the player currently holds for each chain.

**The command and the shortcut.** `host.command(id).run()` behaves like the menu, `host.press(binding)` like the keyboard:

{@includeCode ../../examples/blur/tests/blur.test.ts#test-toggle}

**Latest-value semantics.** Ten slider moves in a row, then one `settle()`. `host.sent(method)` lists the requests the plugin sent; there are two, the first move and the last:

{@includeCode ../../examples/blur/tests/blur.test.ts#test-drag}

`window.emit(callback, ...args)` fires a Slint callback as if the user had used the control; `window.props` holds the properties by their Slint names. Always `await host.settle()` before asserting: it waits until every request has been answered and the bindings have been re-evaluated.

**Presets, `set` versus `bind`, and Reset:**

{@includeCode ../../examples/blur/tests/blur.test.ts#test-presets}

**Persistence across restarts.** Pass the same `dataDirectory` to several `startPlugin` calls; `stop()` flushes the store like a real shutdown. `host.settingsPage(id)` gives the page's properties and callbacks:

{@includeCode ../../examples/blur/tests/blur.test.ts#test-persistence}

**Status: waiting, failure, retry.** `host.handle(method, fn)` replaces how the fake player answers a request; throwing a `HostError` simulates a refusal. `host.reset(method)` restores the default:

{@includeCode ../../examples/blur/tests/blur.test.ts#test-status}

**Cleanup:**

{@includeCode ../../examples/blur/tests/blur.test.ts#test-dispose}

Run them with `npm test`.

## Step 11: Build and run

In the SDK repository, build the SDK once (`npm ci` at the root), then in `examples/blur`:

```sh
npm install
npm run check   # manifest rules and a strict type check, tests included
npm test
npx vestra-plugin build
```

`build` writes `dist/`: the TypeScript with its types stripped, the `.slint` files, the README and `dist/manifest.json` with `entry: "main.js"`. Start the player with it:

```sh
# macOS
"/Applications/Vestra Player.app/Contents/MacOS/vestra-host" --plugin "$PWD/dist"
# Windows (per-user install)
"%LOCALAPPDATA%\Programs\Vestra Player\vestra-host.exe" --plugin "%CD%\dist"
```

While you are working on the plugin, pass the plugin directory itself (`--plugin "$PWD"`): the player then runs `main.ts` directly, so there is no build step. `--plugin` can be repeated.

Try it:

1. Open a video. Press Ctrl+Shift+B: the picture blurs, "Blur on (strength 4.0)" appears, and Video ▸ Blur has a check mark.
2. Choose Video ▸ Blur Controls…. Drag **Strength**: the blur follows while you drag. Release: "Blur strength …" appears.
3. Pick **Strong**, then **Reset**: the slider jumps to 9, then back to 4.
4. Click **Options…**: the options window opens at Video ▸ Blur. Turn on "Turn blur back on when the player starts", quit with blur on and start again: the video is blurred straight away.

`npm run pack` produces `examples.blur-1.0.0.vxp`, the package users install.

## What to try next

Each of these is a small change that teaches one more part of the API.

1. **Stronger and weaker from the keyboard.** Add two commands without a menu path (give them a `title`) and with `bindings: ["Ctrl+Shift+ArrowUp"]` / `["Ctrl+Shift+ArrowDown"]` and `repeat: true`, each changing `sigma` by 0.5. See `CommandOptions`.
2. **A second live node.** Add a `{ kind: "hue", degrees }` node after `gblur` and a second slider. `degrees` is live too, so the same continuous `set()` works.
3. **A node that is not live.** Add `{ kind: "sharpen", amount, size: "small" }`. Its fields rebuild the stage, so call `apply()` from the slider's `released` callback instead of `changed`, and compare how dragging feels.
4. **Blur while paused.** Use `plugin.player.onChange` to turn the blur on whenever playback is paused, a privacy screen. You already have the `events` capability.
5. **A status panel.** Replace the one-line messages with `plugin.osd.panel()`, a small block of text that stays on screen, and show the strength and status there.
6. **Test a corrupt settings file.** Write invalid JSON to `join(host.dataDirectory, "blur.json")` before `startPlugin`, then check that the plugin starts with the defaults.

## See also

- [Getting started](../tutorials/getting-started.md): the files of a plugin, the CLI and the manifest rules.
- `Scope`: every module on `plugin`.
- `VideoFilter`, `FilterStatus` and `VideoNode`: filters, their status and every node type with its ranges.
- `View` and `Window`: properties, callbacks, `bind` and `set`.
- `Settings` and `Storage`: options pages and JSON files.
- `TestHost` in `@vestra-player/sdk/testing`.
