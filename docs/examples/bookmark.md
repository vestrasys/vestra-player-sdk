---
title: "Example: Bookmark"
---

# Example: Bookmark

This walkthrough builds **Bookmark**, a plugin that remembers the current playback position and jumps back to it. It is about 30 lines of TypeScript and 17 lines of Slint, and it shows the pattern almost every plugin with a window uses: a menu command opens a tool window, the window's properties follow the player's state through `bind()`, and the window's buttons call back into the plugin, which reads and changes playback.

The complete source is in [`examples/bookmark/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/bookmark). Every code block on this page is pulled from those files, so what you read is exactly what is built and tested.

## What you'll build

![Bookmark in Vestra Player](../../examples/bookmark/screenshot.png)

- **Playback ▸ Bookmark…**: a menu item in the player's own **Playback** menu that opens the **Bookmark** window.
- The window shows the bookmark ("No bookmark", or "Bookmark: 42.0 s") and two buttons:
  - **Mark this position** stores where playback is now. It is greyed out while nothing is open.
  - **Jump to bookmark** seeks back to it. It is greyed out until there is a bookmark and the current source can seek.
- The buttons follow the player by themselves: open a file and **Mark** becomes available, without any code that pushes updates to the window.

## Prerequisites

- Node.js 26 or newer and npm.
- Vestra Player 0.3.0 or newer, to see the result: the `@playback` menu id in the command's path is new in 0.3.0. A plugin of your own that uses a menu id should say so with `"minPlayerVersion": "0.3.0"` in its manifest, as [Blur](blur.md) does; older players then refuse to load it with a clear message instead of failing to add the command.
- You have read [Getting started](../tutorials/getting-started.md), or at least know that a plugin is a folder with a `manifest.json` and an entry module that default-exports `activate(plugin)`.

## File layout

```text
examples/bookmark/
  manifest.json              identity and capabilities
  main.ts                    activate(): the window and the command
  ui/bookmark.slint          the Bookmark tool window
  tests/bookmark.test.ts     a test against the SDK's TestHost
  package.json               the SDK as a dev dependency, scripts
  README.md
```

## Step 1: The manifest and its capabilities

{@includeCode ../../examples/bookmark/manifest.json}

- `id` is unique across all plugins; the examples use the owner `examples`. `entry` is `main.ts` during development; `vestra-plugin build` rewrites it to `main.js` in `dist/manifest.json`.
- There are no display fields (`name`, `description`…): they only matter for the plugin store. The [Markdown](markdown.md) example shows them.

Capabilities are a contract: the player refuses a call whose capability is missing, with `code: "capability"`. Bookmark needs five:

| Capability | Why Bookmark needs it |
| --- | --- |
| `commands` | {@link "@vestra-player/sdk"!Commands.add | plugin.commands.add}: the menu item. |
| `ui.window` | {@link "@vestra-player/sdk"!Windows.create | plugin.windows.create}: the Bookmark window. |
| `playback.read` | Reading {@link "@vestra-player/sdk"!Player.state | player.state}: the position and whether the source can seek. |
| `events` | Keeping `player.state` live. Without it the state is only read once, when the plugin starts, so the buttons would never notice that a file was opened later. |
| `playback.control` | {@link "@vestra-player/sdk"!Player.seek | player.seek}: the jump. |

## Step 2: The plugin's state

{@includeCode ../../examples/bookmark/main.ts#state}

- The SDK is imported with `import type` only: the player creates the `plugin` object and passes it to `activate`, so the built plugin contains none of the SDK's code.
- `player` is `plugin.player`, kept in a constant because the plugin reads it in several places.
- `mark` is the whole model: a position in seconds, or `null` for no bookmark. It lives in memory, so it is gone when the player quits ([What to try next](#what-to-try-next) keeps it).

## Step 3: The window

A tool window is a `.slint` file in the package. The plugin writes **properties** into it and receives **callbacks** from it. Here is the whole file:

{@includeCode ../../examples/bookmark/ui/bookmark.slint}

- Line 1: the buttons and layouts come from Slint's standard library. The player compiles plugin files with the `fluent-dark` style, so they look dark like the player. (The [Core UI](core-ui.md) example uses the player's own `@vestra/` widgets instead.)
- Line 2: a window file exports exactly one component, and it inherits `Window`. `title` is the title bar's text; `preferred-width` is the initial width, which the user can change.
- Lines 5–7: `in` properties carry data from the plugin to the window. The plugin only writes them; nothing in the window changes them. `label` has a default, but the plugin's values are already in place when the window first appears, so it is never seen.
- Lines 8–9: callbacks carry user actions from the window to the plugin. They return nothing.
- Lines 13–14: each button is enabled by one property and calls one callback when clicked.

Names are converted for you: TypeScript's `canMark` is Slint's `can-mark`. See [How Slint and TypeScript talk](../concepts/ui.md) in the concept page for the full rules.

The TypeScript side creates the window, binds its properties and handles its callbacks:

{@includeCode ../../examples/bookmark/main.ts#window}

- {@link "@vestra-player/sdk"!Windows.create | plugin.windows.create} makes a handle and opens nothing. The window's id is the file name without its extension, `bookmark`; the test uses it as `host.window("bookmark")`.
- {@link "@vestra-player/sdk"!View.bind | window.bind} keeps the properties equal to what the function returns. The SDK calls the function again after every handler it runs and every player state change it receives, and sends only the values that changed. That is why there is no update code anywhere:
  - `canMark` follows `player.state.position`, which is `null` while nothing is open. When the user opens a file, the state changes, the SDK re-runs the function, and the button lights up.
  - `canJump` needs a bookmark **and** `player.state.can.seek`. A live stream that cannot seek keeps the button greyed out.
  - `label` follows `mark`. Clicking **Mark** runs a handler, after which the SDK re-runs the function, so the new label appears with no further call.
- {@link "@vestra-player/sdk"!View.on | window.on} handles a callback. Bind every callback name **before the first `show()`**: a tool window registers its callbacks when it opens, and binding a new name while it is open throws.
- `mark` stores the current position. `bind` reads `mark` on the next pass.
- `jump` returns the promise of `player.seek`. If the seek fails, the rejection goes to {@link "@vestra-player/sdk"!Scope.onError | plugin.onError} and the plugin log, never to an unhandled-rejection crash. The `!` is safe because the button is only enabled while `mark !== null`.

**Why `bind` and not `set`?** {@link "@vestra-player/sdk"!View.set | set()} sends values once, now. Every one of these properties depends on state that changes on its own (the player's position, its capabilities), so a function that the SDK re-evaluates is simpler and cannot fall out of date.

## Step 4: The menu command

{@includeCode ../../examples/bookmark/main.ts#command}

- `id` is local to the plugin; the global id is `examples.bookmark/bookmark.open`.
- `path: ["@playback", "Bookmark…"]` adds the item to the player's own **Playback** menu. Menu paths are matched by their exact text, and the player's menus are titled in its own language, so `["Playback", "Bookmark…"]` would create a second top-level menu. A first segment that starts with `@` names a built-in menu instead ({@link "@vestra-player/sdk"!MenuId | MenuId}). The ellipsis says, as usual, that the item opens a window.
- `order: 270` places it among the Playback menu's items; 200–699 is the range for domain menus such as playback, video and audio.
- `run` opens the window with {@link "@vestra-player/sdk"!Window.show | window.show()}, or shows it again if it is hidden. The first `show()` opens it with the bound values already in place. Returning its promise lets the SDK report a failure (for example a Slint file that does not compile) to `onError`.

Nothing has to be cleaned up: the command and the window belong to `plugin` and are removed when the plugin stops.

## Step 5: The test

`@vestra-player/sdk/testing` provides {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, an in-memory player that speaks the real protocol, so the SDK's own logic (bindings, callbacks, requests) runs unchanged. There is no video decoding and no Slint: a window is its properties and callbacks.

{@includeCode ../../examples/bookmark/tests/bookmark.test.ts}

- {@link "@vestra-player/sdk/testing"!TestHost.openElsewhere | host.openElsewhere} simulates the user opening a file, and {@link "@vestra-player/sdk/testing"!TestHost.setSource | host.setSource} sets its duration and position.
- {@link "@vestra-player/sdk/testing"!startPlugin | startPlugin} reads `manifest.json` from the directory, so the test runs with the same capabilities as the real plugin.
- `host.command("bookmark.open").run()` behaves like the menu item and opens the window. `host.window("bookmark")` exists only after a `show()`.
- `window.emit("mark")` fires the Slint callback as if the button had been clicked. `window.props` holds the properties by their Slint names.
- `await host.settle()` waits until every request has been answered and the bindings have been re-evaluated. Always settle before asserting.
- After the jump, `host.source.position` is where the fake player now is: 42 again.

Run it with `npm test`.

## Step 6: Build and run

In the SDK repository, build the SDK once (`npm ci` at the root), then in `examples/bookmark`:

```sh
npm install
npm run check   # manifest rules and a strict type check, tests included
npm test
npm run pack    # builds dist/ and packs examples.bookmark-0.1.0.vxp
```

While you work on the plugin, start the player with `--plugin <path to examples/bookmark>`: it then runs `main.ts` directly, with no build step. Try it:

1. Choose **Playback ▸ Bookmark…** with nothing open: both buttons are greyed out.
2. Open a video. **Mark this position** becomes available. Click it: the label shows the position.
3. Let the video play on, then click **Jump to bookmark**: playback goes back to the mark.

## What to try next

1. **Keep the bookmark.** Save it with {@link "@vestra-player/sdk"!Scope.storage | plugin.storage}`.json("bookmark", { defaults: { mark: null } })` and call `save` in the `mark` handler, so it survives a restart. The [Blur](blur.md) walkthrough explains the store.
2. **One bookmark per file.** Store a map from `player.state.source` to position, and show the current file's bookmark only.
3. **Show it on the seek bar.** Add a mark of kind `"bookmark"` with `plugin.timeline.layer()` (capability `timeline.marks`).
4. **A shortcut.** Add a command with no menu path (`title: "Jump to bookmark"`), `bindings: ["Ctrl+Alt+J"]` and `enabled: () => mark !== null`. Command bindings fire while the main window has focus, not while the tool window does.
5. **A message.** Add `ui.osd` to the capabilities and call `plugin.osd.show("Bookmark set")` in the `mark` handler.

## See also

- [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md): what a tool window is, its life cycle, and how properties and callbacks work.
- {@link "@vestra-player/sdk"!Window | Window}, {@link "@vestra-player/sdk"!View | View} (`bind`, `on`, `set`), {@link "@vestra-player/sdk"!Windows | Windows}
- {@link "@vestra-player/sdk"!Player | Player}, {@link "@vestra-player/sdk"!PlayerState | PlayerState}
- {@link "@vestra-player/sdk"!CommandOptions | CommandOptions}
- {@link "@vestra-player/sdk/testing"!TestHost | TestHost}
