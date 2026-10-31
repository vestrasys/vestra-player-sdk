---
title: "Example: Bookmark"
description: "Walkthrough of examples/bookmark: a tool window bound to the playback state, with Mark and Jump buttons."
---

# Example: Bookmark

A tool window whose buttons follow the playback state: **Mark** remembers where playback is, **Jump** goes back there. It shows the pattern most plugins with a window use: the window's properties are _bound_ to state, and its buttons call back into the plugin.

## What it demonstrates

A tool window whose properties are bound to the playback state · handling its buttons.

[Add a window](../tutorials/add-a-window.md) teaches a window bound to the playback state; [Test a plugin](../how-to/testing.md) uses its test as the complete example.

## What you'll build

![Bookmark in Vestra Player](../../examples/bookmark/screenshot.png)

- **Playback ▸ Bookmark…** opens the **Bookmark** window.
- **Mark this position** stores the current position. It is greyed out while nothing is open.
- **Jump to bookmark** seeks back to it. It is greyed out until there is a bookmark and the video can seek.

## Files

```text
examples/bookmark/
  manifest.json              identity and capabilities
  main.ts                    the code
  ui/bookmark.slint          the window
  tests/bookmark.test.ts     a test against the SDK's in-memory player
  package.json               the SDK as a dev dependency, and the scripts
```

## The manifest

{@includeCode ../../examples/bookmark/manifest.json}

| Capability         | Used for                                            |
| ------------------ | --------------------------------------------------- |
| `commands`         | the menu item                                       |
| `ui.window`        | the window                                          |
| `playback.read`    | reading the position and whether the video can seek |
| `events`           | keeping that state up to date while the plugin runs |
| `playback.control` | the seek                                            |

`minPlayerVersion` is 0.3.0 because the menu path uses the `@playback` menu id, which is new in that version.

## The window

{@includeCode ../../examples/bookmark/ui/bookmark.slint}

- The buttons and layouts come from Slint's standard library.
- The file exports one component that inherits `Window`. `title` is the title bar's text.
- The three `in property` lines are the data the plugin writes: the label and whether each button is enabled.
- The two `callback` lines are what the window reports back: a click on each button.
- Each `Button` is enabled by one property and calls one callback.

Names are converted for you: Slint's `can-mark` is `canMark` in TypeScript.

## The code

### The state

{@includeCode ../../examples/bookmark/main.ts#state}

- `player` is `plugin.player`, kept in a constant because the code reads it several times.
- `mark` is the plugin's whole state: a position in seconds, or `null` for no bookmark.

### The window, bound to the state

{@includeCode ../../examples/bookmark/main.ts#window}

- {@link "@vestra-player/sdk"!Windows.create | plugin.windows.create} makes a handle. Nothing opens yet.
- {@link "@vestra-player/sdk"!View.bind | window.bind} gives the function that computes the window's properties. The SDK calls it again after every handler and every change of the player's state, and sends only what changed. So there is no update code:
  - `label` follows `mark`.
  - `canMark` follows `player.state.position`, which is `null` while nothing is open.
  - `canJump` needs a bookmark and a video that can seek.
- {@link "@vestra-player/sdk"!View.on | window.on} handles a callback. `mark` stores the position; `jump` seeks back. The `!` is safe because the button is only enabled while there is a bookmark.
- Register callbacks before the first `show()`: a tool window takes its callbacks when it opens.

### The menu command

{@includeCode ../../examples/bookmark/main.ts#command}

- `path: ["@playback", "Bookmark…"]` adds the item to the player's own **Playback** menu. A first segment that starts with `@` names a built-in menu ({@link "@vestra-player/sdk"!MenuId | MenuId}).
- `order: 270` places it among the Playback menu's items.
- `run` opens the window with {@link "@vestra-player/sdk"!Window.show | window.show()}. The bound values are already in place when it appears.

## The test

{@includeCode ../../examples/bookmark/tests/bookmark.test.ts}

- `host.openElsewhere` and `host.setSource` play the user's part: a file is open at 42 seconds.
- `host.window("bookmark")` is the window, named after its file. `emit("mark")` acts like a click; `props` holds its properties by their Slint names.
- `await host.settle()` waits until the SDK has caught up. Settle before every assertion.
- After the jump, `host.source.position` is back at 42.

## Run it

```sh
npm ci                    # once, in the SDK repository root
cd examples/bookmark
npm install
npm run check && npm test
npm run pack              # examples.bookmark-0.1.0.vxp
```

Start the player with `--plugin <path to examples/bookmark>`, open a video, choose **Playback ▸ Bookmark…**, click **Mark**, let it play on, then click **Jump**.

## Try next

1. **Keep the bookmark after a restart** with {@link "@vestra-player/sdk"!Scope.storage | plugin.storage}`.json("bookmark", { defaults: { mark: null } })`. See [Remember a window's state between runs](../how-to/window-state.md).
2. **Show it on the seek bar** with a mark of kind `"bookmark"` from `plugin.timeline.layer()` (capability `timeline.marks`).
3. **A shortcut to jump**: a command with `title: "Jump to bookmark"`, `bindings: ["Ctrl+Alt+J"]` and `enabled: () => mark !== null`.
