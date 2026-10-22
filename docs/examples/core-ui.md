---
title: "Example: Core UI"
---

# Example: Core UI

This walkthrough builds **Core UI**, a tour of the player's core user interface API in one **Examples** menu: radio items, ordering and separator groups, a menu item whose title changes, a key that repeats while held, a command that is not in any menu, on-screen messages, next/previous, the shared sidebar, and a tool window drawn with the player's own theme and widgets. Each feature takes a few lines, so this page is a series of short, independent steps.

The complete source is in [`examples/core-ui/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/core-ui). Every code block on this page is pulled from those files, so what you read is exactly what is built and tested.

## What you'll build

![Core UI in Vestra Player](../../examples/core-ui/screenshot.png)

An **Examples** menu at the top level of the main menu, in a separator group of its own:

| Item | What it shows |
| --- | --- |
| **Speed ▸ 0.5× / 1× / 2×** | Radio items. The choice is remembered across restarts. |
| **Last speed: 1×** | A disabled item whose title changes with the speed. |
| **Volume +5** (Ctrl+Alt+↑) | A key binding that repeats while the key is held. |
| **Next** (Ctrl+Alt+N), **Previous** (Ctrl+Alt+P) | Commands that are enabled only when another plugin provides a sequence. |
| **Show sidebar**, **Detach sidebar** (Ctrl+Alt+D) | Check items that control the sidebar, whichever plugin mounted it. |
| **Theme widgets…** | A tool window built from `@vestra/theme.slint` and `@vestra/widgets.slint`. |

And one command with no menu item at all: **Ctrl+Alt+W** shows the playback position over the video.

## Prerequisites

- Node.js 26 or newer and npm.
- Vestra Player, to see the result. The sidebar items need a plugin that mounts a sidebar panel, such as the [Panel menu](panel-menu.md) example; **Next** and **Previous** need a sequence provider, which Panel menu also is.
- You have read [Getting started](../tutorials/getting-started.md), and ideally the [Bookmark](bookmark.md) walkthrough, which explains `bind`, `on` and the test host with a smaller window.

## File layout

```text
examples/core-ui/
  manifest.json              identity and capabilities
  main.ts                    activate(): every feature, one block each
  ui/theme.slint             the Theme widgets tool window
  tests/core-ui.test.ts      tests against the SDK's TestHost
  package.json               the SDK as a dev dependency, scripts
  README.md
```

## Step 1: The manifest and its capabilities

{@includeCode ../../examples/core-ui/manifest.json}

| Capability | What uses it |
| --- | --- |
| `commands` | {@link "@vestra-player/sdk"!Commands.add | plugin.commands.add}: every menu item and key. |
| `playback.read`, `events` | {@link "@vestra-player/sdk"!Player.state | player.state}, read at start and kept live: whether the speed can change, the volume, the position, whether next/previous are possible. |
| `playback.control` | {@link "@vestra-player/sdk"!Player.setRate | setRate}, {@link "@vestra-player/sdk"!Player.setOutput | setOutput}, {@link "@vestra-player/sdk"!Player.next | next} and {@link "@vestra-player/sdk"!Player.previous | previous}. |
| `ui.mount` | {@link "@vestra-player/sdk"!Panels.sidebar | plugin.panels.sidebar}: reading and changing the sidebar, though this plugin mounts no panel. |
| `ui.osd` | {@link "@vestra-player/sdk"!Osd.show | plugin.osd.show}: the on-screen messages. |
| `ui.window` | {@link "@vestra-player/sdk"!Windows.create | plugin.windows.create}: the Theme widgets window. |

## Step 2: Shortcuts used everywhere

{@includeCode ../../examples/core-ui/main.ts#setup}

- `menu(title)` builds a path in the **Examples** menu. Menu paths are matched by their exact text, so every item that uses the same first segment ends up in the same submenu.
- `say` shows a one-line message at the top left of the video for two seconds. It returns a promise; the commands below return or await it, so a failure reaches {@link "@vestra-player/sdk"!Scope.onError | plugin.onError} instead of being lost.

## Step 3: Remembering a value in the data directory

{@includeCode ../../examples/core-ui/main.ts#settings}

- {@link "@vestra-player/sdk"!Plugin.dataDirectory | plugin.dataDirectory} is a writable directory that belongs to the plugin and survives restarts, disabling and upgrades.
- `load` falls back to 1× when the file is missing or broken, so a damaged file can never stop the plugin from starting.
- `save` writes a temporary file and renames it over the real one. A rename is atomic: if the player quits halfway through, the old file is still whole.

This is the do-it-yourself version. For JSON settings, {@link "@vestra-player/sdk"!Scope.storage | plugin.storage}`.json()` does the same with validation and delayed, coalesced writes; the [Blur](blur.md) walkthrough uses it.

## Step 4: A menu item whose title changes

A command's title and path cannot change after it is added. To change them, remove the command and add it again. A child scope makes that clean:

{@includeCode ../../examples/core-ui/main.ts#title}

- {@link "@vestra-player/sdk"!Scope.scope | plugin.scope()} makes a child scope. Everything created through it belongs to it, and disposing it releases only that.
- `remember` disposes the previous scope (which removes the old **Last speed** item from the menu), makes a new one and adds the item again with the new title. The id `last` can be reused at once because the old command is gone.
- `enabled: false` greys the item out: it only displays information. `run() {}` is still required.
- The same pattern rebuilds lists that change: audio tracks, presets, recent files. Put them in a child scope and rebuild the scope.

## Step 5: Radio items, ordering and groups

{@includeCode ../../examples/core-ui/main.ts#radio}

- On start the plugin reads the remembered speed and adds the **Last speed** item with it. `void` marks the promise as deliberately not awaited: `activate` does not need to wait for the item, and a failure to register it is reported like any other.
- `path: ["Examples", "Speed", "2×"]` has three segments, so **Speed** becomes a submenu of **Examples**.
- `order` sorts siblings. A submenu sits where its first command sits and takes that command's `group`, so the **Speed** submenu sits at 850 and every other item follows from 859 to 865. The **Examples** menu itself, at 850, falls in the `windows` range (800–899) that {@link "@vestra-player/sdk"!CommandOptions | CommandOptions} recommends for top-level menus such as tools.
- `group: "examples"` is a separator label: the player draws a line between neighbouring items of different groups. Giving every item the same group keeps the **Examples** menu in one block, separated from the menus around it.
- `radio: true` draws `checked` as a radio dot instead of a check mark. The plugin decides which item is checked: `checked: () => speed === rate`. There is no built-in "one of" logic.
- `enabled: () => player.state.can.rate` greys the items out while the current source cannot change speed (for example with nothing open).
- `run` sets the speed, then updates everything that depends on it. When `run`'s promise settles, the SDK re-evaluates every `checked` and `enabled` function and sends what changed, so the radio dot moves.

The remembered speed only sets which item is checked and the **Last speed** title; the plugin does not change the player's speed at start-up. [What to try next](#what-to-try-next) has the change.

## Step 6: A repeating key and a command without a menu item

{@includeCode ../../examples/core-ui/main.ts#bindings}

- `bindings: ["Ctrl+Alt+ArrowUp"]` is the default key. On macOS a `Ctrl+…` binding fires for both ⌃ and ⌘, so ⌘⌥↑ works too. Users can reassign any binding in the player's shortcut settings.
- `repeat: true` runs the command again on the keyboard's auto-repeat while the key is held. Without it, holding the key runs the command once. Repeat suits small steps like volume; it does not suit a toggle.
- {@link "@vestra-player/sdk"!Player.setOutput | player.setOutput} sets the device volume, 0–200.
- `where` has no `path`, so it is not in any menu; a `title` is then required, and it is what the shortcut settings list. The key is the only way to run it.

## Step 7: Next and previous

{@includeCode ../../examples/core-ui/main.ts#sequence}

- {@link "@vestra-player/sdk"!Player.next | player.next()} and `previous()` ask whichever plugin is the **sequence provider** (a playlist, or the [Panel menu](panel-menu.md) example) to step. They reject with `unavailable` when there is none or it cannot step.
- `player.state.can.next` and `can.previous` are the provider's own flags, so the items are greyed out exactly when stepping would fail.
- `as const` keeps each entry a fixed tuple, so `id` has the type `"next" | "previous"` and `player.state.can[id]` type-checks.

## Step 8: The shared sidebar

The sidebar does not belong to the plugin that mounted a panel there. Any plugin with `ui.mount` can read and change it, so a "Show sidebar" item can live in a different plugin from the panel:

{@includeCode ../../examples/core-ui/main.ts#sidebar}

- {@link "@vestra-player/sdk"!PanelSlot.state | sidebar.state} is `null` while no plugin has a panel in the sidebar; then both items are greyed out. Otherwise it is a {@link "@vestra-player/sdk"!SlotState | SlotState}: `preferred` is the user's choice, `detached` whether the sidebar floats in its own window. With `events` it follows every change, wherever it came from.
- {@link "@vestra-player/sdk"!PanelSlot.toggle | toggle()} flips the user's preference, exactly like the player's own menu item, and is remembered. The check mark follows `preferred`, not whether the sidebar is on screen right now: a window too narrow for the sidebar keeps the preference.
- {@link "@vestra-player/sdk"!SidebarSlot.setDetached | setDetached()} floats the sidebar panel in a window of its own (titled with the panel's `title`) or docks it again. The panel's properties and callbacks stay the same; the floating window holds a new instance of its component.

## Step 9: A tool window drawn with the player's theme and widgets

{@includeCode ../../examples/core-ui/ui/theme.slint}

- Lines 1–2: `@vestra/theme.slint` and `@vestra/widgets.slint` are supplied by the player at run time. `Theme` holds the palette, fonts and sizes; `Button`, `Slider` and `ToolTipArea` look like the player's own controls. For editor support, point the Slint language server's library path `vestra` at `node_modules/@vestra-player/sdk/slint/vestra`.
- Lines 6–7: a fixed `width` makes the window not resizable in that direction. `Theme.bg-panel` instead of a hard-coded colour makes the window follow the player's colour scheme.
- Lines 8–11: `level` is `in-out`, because both the plugin and the user change it; `label` is only written by the plugin.
- Line 13: `Theme.dialog-padding` (14px) and the font tokens keep the spacing and type the same as the player's dialogs.
- Lines 17–21: a `ToolTipArea` shows its `text` after the pointer rests on its content for 600 ms.
- Lines 22 and 25: two sliders bound **two-way** to the same `level` with `<=>`, the panel style (`panel: true`) and the default bar style. Dragging either moves the other at once, inside Slint, and reports the value to the plugin through `level-changed`. A one-way binding (`value: root.level`) would be broken by Slint the first time the user moved the slider, and the plugin could no longer move it.
- Line 23: `small: true` is the 18-pixel button.
- Lines 30–34: icon buttons. `icon` is SVG-style path data drawn in an `icon-width` × `icon-height` box (14×12 by default); `stroked: true` draws it as lines instead of filling it. `checked` draws the icon in the accent colour, here while the level is above 50 %. The play icon has no click handler; it only shows the state.
- Line 35: in this demo **OK** also resets the level.

The TypeScript side:

{@includeCode ../../examples/core-ui/main.ts#window}

- `bind` keeps `level` and `label` in step with the plugin's `level`. **Default**, the cross and **OK** call `reset`, which only changes the model; `bind` then moves both sliders and the label.
- `levelChanged` stores the dragged value. `bind` sends it back, but it is the value the slider already shows, so nothing jumps. The [slider how-to](../how-to/slider.md) covers dragging in detail.
- Callbacks are bound before the first `show()`, as tool windows require.

The [concept page](../concepts/ui.md) lists every `Theme` token and every widget property.

## Step 10: Tests

{@includeCode ../../examples/core-ui/tests/core-ui.test.ts}

The first test drives the menu and the keys:

- `host.openElsewhere("/a.mp4")` opens a file, so `can.rate` is true.
- `host.command(id).declaration` is the command as the plugin declared it: `radio`, `group` and `path` can be checked directly. After running **2×**, the `last` command has been declared again with the new title, and `settings.json` in {@link "@vestra-player/sdk/testing"!TestHost.dataDirectory | host.dataDirectory} holds the new speed.
- `host.osd` lists every on-screen message, newest last.
- {@link "@vestra-player/sdk/testing"!TestHost.press | host.press(binding)} presses a key like the player's binding table would. The volume starts at 100, so the first press shows 105 %.
- `where` has an empty path: it is in no menu.
- {@link "@vestra-player/sdk/testing"!TestHost.conflicts | host.conflicts} is empty: none of the default keys collides with the player's own or another command.

The second test plays the other plugins' part:

- With no sequence provider, **Next** is disabled and {@link "@vestra-player/sdk/testing"!TestHost.step | host.step("next")} rejects with `unavailable`. With no sidebar panel, **Detach sidebar** is disabled.
- `host.layout.sidebar` puts another plugin's sidebar (owner 9) in the fake player's layout, and `host.emit("window.state", {})` is the event after which the SDK reads the layout again. `host.request("sequence.set", …)` is another plugin becoming the provider.
- After `settle()`, the items follow: **Next** is enabled and **Show sidebar** is checked. Ctrl+Alt+D detaches the sidebar; running **Show sidebar** clears the preference.

Run them with `npm test`.

## Step 11: Build and run

In the SDK repository, build the SDK once (`npm ci` at the root), then in `examples/core-ui`:

```sh
npm install
npm run check   # manifest rules and a strict type check, tests included
npm test
npm run pack    # builds dist/ and packs examples.core-ui-0.1.0.vxp
```

Start the player with `--plugin <path to examples/core-ui>`, and add `--plugin <path to examples/panel-menu>` to have a sidebar and a sequence provider. Try it:

1. Open a video. Choose **Examples ▸ Speed ▸ 2×**: playback speeds up, "Speed: 2×" appears, and the item below reads **Last speed: 2×**. Restart the player: **2×** is still checked.
2. Hold **Ctrl+Alt+↑**: the volume climbs in steps of 5 while you hold the key.
3. Press **Ctrl+Alt+W**: the position appears over the video.
4. With Panel menu loaded, use **Next** and **Previous**, then **Detach sidebar** and **Show sidebar**.
5. Choose **Theme widgets…** and drag either slider: the other follows, and the play icon lights up above 50.

## What to try next

1. **Apply the remembered speed.** Call `player.setRate(speed)` when a source becomes ready: listen with `plugin.player.onChange` and check `player.state.phase === "ready"` and `can.rate`.
2. **Use `plugin.storage`.** Replace `load` and `save` with `plugin.storage.json("settings", { defaults: { speed: 1 } })` and `store.save(...)`.
3. **A Volume − item.** Add the opposite command with `Ctrl+Alt+ArrowDown`, `repeat: true` and `Math.max(0, …)`. Give it the same order, 860: equal orders keep the declaration order, so it lands right after **Volume +5**.
4. **Show the sidebar's reason.** Use `sidebar.onChange` to show "Widen the window" with `osd.show` when `state.reason` is `"space"`.
5. **Close the window from OK.** Make **OK** call a new `done` callback, and handle it with `window.close()`.

## See also

- [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md): the surfaces, the theme and widgets, focus and keyboard.
- {@link "@vestra-player/sdk"!CommandOptions | CommandOptions} (`path`, `order`, `group`, `radio`, `bindings`, `repeat`), {@link "@vestra-player/sdk"!Commands.add | Commands.add}
- {@link "@vestra-player/sdk"!Scope.scope | Scope.scope}, {@link "@vestra-player/sdk"!Plugin.dataDirectory | Plugin.dataDirectory}
- {@link "@vestra-player/sdk"!PanelSlot | PanelSlot}, {@link "@vestra-player/sdk"!SidebarSlot | SidebarSlot}, {@link "@vestra-player/sdk"!SlotState | SlotState}
- {@link "@vestra-player/sdk"!Player | Player}, {@link "@vestra-player/sdk"!Osd | Osd}
- {@link "@vestra-player/sdk/testing"!TestHost | TestHost}
