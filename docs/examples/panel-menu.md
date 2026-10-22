---
title: "Example: Panel menu"
---

# Example: Panel menu

This walkthrough builds **Panel menu**, a plugin that puts a small list in the player's **sidebar**. The list has its own right-click menu, keys that only work while the list has focus, and it tells the player what "next" and "previous" mean, so the player's own next/previous controls step through it. It is about 50 lines of TypeScript and 35 lines of Slint, and it covers what makes a panel different from a tool window.

The complete source is in [`examples/panel-menu/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/panel-menu). Every code block on this page is pulled from those files, so what you read is exactly what is built and tested.

## What you'll build

![Panel menu in Vestra Player](../../examples/panel-menu/screenshot.png)

- A list of three items in the sidebar, right of the video. The selected item is highlighted. The user can detach the sidebar into a floating window titled **Example list**.
- A click selects an item. A right-click selects it and opens a menu with **Select the first item** and **Remove the selected item**, separated by a line.
- While the list has focus, **Home** selects the first item and **Delete** removes the selected one. Elsewhere in the player these keys keep their usual meaning.
- The player's next/previous (and any plugin that calls `player.next()`) move the selection down and up the list.

Each plugin mounts at most one panel, and the sidebar holds one panel for all plugins. If a playlist plugin already has the sidebar, this plugin cannot start; load one or the other.

## Prerequisites

- Node.js 26 or newer and npm.
- Vestra Player, to see the result. Nothing here needs more than the first release of the API (`vestra/1`).
- You have read [Getting started](../tutorials/getting-started.md), and ideally the [Bookmark](bookmark.md) walkthrough, which explains `bind`, `on` and the test host with a tool window.

## File layout

```text
examples/panel-menu/
  manifest.json                identity and capabilities
  main.ts                      activate(): panel, commands, menu, next/previous
  ui/panel.slint               the list: a bridge global and a component
  tests/panel-menu.test.ts     a test against the SDK's TestHost
  package.json                 the SDK as a dev dependency, scripts
  README.md
```

## Panels and tool windows

A **tool window** is a separate operating-system window that the user opens and closes. A **panel** is part of the player's main window: it sits in the bottom bar, the sidebar or the backdrop, moves and resizes with the player's layout, and hides in fullscreen. Two consequences shape this example:

- The player builds a **new instance** of the panel's component whenever it rebuilds its main window (for example when any plugin mounts or unmounts a panel) and when the sidebar is detached into its own window. So the panel's properties and callbacks cannot live on the component, which comes and goes. They live on an exported **global**, the *bridge*, which is one stable address.
- Anything that matters must be in a bridge property the plugin writes. State kept only inside the component (a scroll position, a selection the plugin does not know about) starts over after a rebuild.

The [concept page](../concepts/ui.md) compares all five surfaces and their life cycles.

## Step 1: The manifest and its capabilities

{@includeCode ../../examples/panel-menu/manifest.json}

| Capability | Why Panel menu needs it |
| --- | --- |
| `commands` | {@link "@vestra-player/sdk"!Commands.add | plugin.commands.add}: the two commands behind the menu and the keys. |
| `ui.mount` | {@link "@vestra-player/sdk"!Panels.mount | plugin.panels.mount} and {@link "@vestra-player/sdk"!Panel.showMenu | panel.showMenu}. |
| `playback.read`, `events` | The player state behind `plugin.player`, read at start and kept live. |
| `playback.control` | {@link "@vestra-player/sdk"!Player.provideSequence | player.provideSequence}: answering the player's next/previous is a playback control. |

## Step 2: The list in Slint

{@includeCode ../../examples/panel-menu/ui/panel.slint}

- Line 1: `Theme` is the player's palette and sizes, supplied by the player at run time as `@vestra/theme.slint`. Colours taken from it follow the user's colour scheme.
- Lines 3–8: the bridge global. `rows` is a Slint model (`[string]`, an array in TypeScript) and `selected` an index. `select(int)` and `context-menu(float, float)` are the two callbacks.
- Line 10: the component inherits `Rectangle`, not `Window`: the player places it. A sidebar panel is as tall as the window and as wide as the user drags the splitter (at least 317 logical pixels); `min-width` is the narrowest the component accepts.
- Line 14: `for row[index] in ListBridge.rows` draws one 20-pixel row per item.
- Lines 16 and 20: the selected row has a darker background and the brighter `Theme.text` colour.
- Lines 24–33: a `TouchArea` per row. On any button press it reports the row with `select(index)`. On a **right** press it also reports where the pointer is, in the window's logical pixels: `absolute-position` is the row's position in the window and `mouse-x`/`mouse-y` the pointer's position in the row. `/ 1px` turns a length into a plain number for the callback.

Everything the list shows comes from the bridge, so a rebuild or a detach redraws it exactly as it was.

## Step 3: The state

{@includeCode ../../examples/panel-menu/main.ts#state}

The model is an array of titles and the selected index. Every part of the plugin (the panel, the menu, the keys, next/previous) reads and changes these two values; the SDK takes care of showing the result.

## Step 4: Mounting the panel

{@includeCode ../../examples/panel-menu/main.ts#mount}

- {@link "@vestra-player/sdk"!Panels.mount | plugin.panels.mount} takes the position (`"bottom"`, `"sidebar"` or `"backdrop"`), the Slint file and options. The file exports one component and one global, so the SDK finds both without their names. `title` is the floating sidebar window's title.
- `mount()` returns at once. In the next microtask the SDK sends the mount with every property bound or set so far, so the `bind` on the following line is part of the first values and the list never appears empty. {@link "@vestra-player/sdk"!Panel.ready | panel.ready} resolves once the player shows the panel. A mount made during activation must succeed, or activation fails; that is what happens when another plugin already has the sidebar.
- `bind(() => ({ rows: items, selected }))` keeps the bridge in step with the model. The SDK re-runs it after every handler (a callback, a command, a next/previous step) and sends only what changed. Because `items` is the same array, changed in place by `splice`, the SDK compares the values it sent last with the new ones, not the references, and sends `rows` when the contents differ.

`move` is a small helper that changes the selection and keeps it inside the list:

{@includeCode ../../examples/panel-menu/main.ts#move}

`move(0)` only clamps, which is what removing the last item needs.

## Step 5: Commands outside the main menu, with panel-only keys

{@includeCode ../../examples/panel-menu/main.ts#commands}

- Neither command has a `path`, so neither appears in the main menu. A command without a path needs a `title`: it is the text in the right-click menu and in the player's shortcut settings.
- `focus: "panel"` makes the `bindings` apply only while this plugin's panel has focus (docked or floating), and there they win over global bindings. **Home** and **Delete** are common keys; scoped to the panel they cannot interfere with the rest of the player.
- `enabled: () => items.length > 0` greys **Remove** out in the menu when the list is empty, and the player then never calls `run`.
- `run` changes the model and returns. The SDK then re-evaluates the bindings, so the panel shows the new list and selection with no explicit update.

## Step 6: The callbacks and the right-click menu

{@includeCode ../../examples/panel-menu/main.ts#menu}

- {@link "@vestra-player/sdk"!View.on | panel.on} handles a callback of the bridge. Unlike a tool window, a panel forwards every callback of its global, so there is no "bind before show" rule. `contextMenu` is the TypeScript spelling of Slint's `context-menu`.
- Slint calls `select` before `context-menu` for a right-click, so the menu always acts on the row under the pointer.
- {@link "@vestra-player/sdk"!Panel.showMenu | panel.showMenu} pops up a one-level menu of **this plugin's commands** at the given point, styled like the main menu: check marks, shortcut text and disabled items included. `null` draws a separator. Picking an item runs that command, exactly as its key would. The menu is made of commands, not of free text and callbacks, so every action in it also has a key, a disabled state and an entry in the shortcut settings.
- This example opens the menu as soon as the right button goes **down**. The API reference recommends opening it when the button is **released**, as the main menu does; [What to try next](#what-to-try-next) has the change.

## Step 7: Next and previous

{@link "@vestra-player/sdk"!Player.provideSequence | player.provideSequence} makes the plugin the player's **sequence provider**: the one that decides what next and previous mean.

{@includeCode ../../examples/panel-menu/main.ts#sequence}

- `canNext` and `canPrevious` are functions the SDK re-evaluates like a binding. The player shows them as `player.state.can.next` and `can.previous`, which greys its own next/previous controls in and out, and which other plugins can read (the [Core UI](core-ui.md) example's **Next** and **Previous** items do).
- `next` and `previous` are called when the user, the player or another plugin (`player.next()`) asks to step. A real playlist would open the next file here; this example only moves the selection.
- There is one provider at a time. Another plugin that provides a sequence fails with `conflict`. Disposing the handle, or stopping the plugin, gives the role back.

## Step 8: The test

{@includeCode ../../examples/panel-menu/tests/panel-menu.test.ts}

- `startPlugin(activate, { directory })` creates a {@link "@vestra-player/sdk/testing"!TestHost | TestHost} itself and returns it as `host`.
- `host.mounted()` is the plugin's panel: `props` by their Slint names and `emit(callback, ...args)` to fire a callback on the bridge. `host.sent("ui.mount")[0]` is the mount request as the player received it, title included.
- After a right-click on row 2 at (40, 60), `host.menus.at(-1)` is the menu the plugin asked for: command ids, `null` for the separator, and the point.
- {@link "@vestra-player/sdk/testing"!TestHost.press | host.press("Home")} without options presses the key as if the main window had focus: nothing is bound there, so it rejects. With `{ panel: true }` the panel has focus and the command runs.
- `host.sequence` holds the provider's flags as last evaluated. {@link "@vestra-player/sdk/testing"!TestHost.step | host.step("next")} simulates another plugin calling `player.next()`.
- The last step removes the selected second item; `rows` follows.

Run it with `npm test`.

## Step 9: Build and run

In the SDK repository, build the SDK once (`npm ci` at the root), then in `examples/panel-menu`:

```sh
npm install
npm run check   # manifest rules and a strict type check, tests included
npm test
npm run pack    # builds dist/ and packs examples.panel-menu-0.1.0.vxp
```

Start the player with `--plugin <path to examples/panel-menu>` (and no playlist plugin). Try it:

1. The list appears in the sidebar. Click **Second item**, then right-click **Third item**: the menu opens with the third item selected.
2. Click in the list and press **Home**: the first item is selected. Press **Delete**: it is removed.
3. Use the player's next/previous: the selection moves; at either end the control is greyed out.
4. Load the [Core UI](core-ui.md) example as well (`--plugin` can be repeated) and choose **Examples ▸ Detach sidebar**: the list moves into a floating window titled **Example list**, still showing the same selection.

## What to try next

1. **Open the menu on release.** In `panel.slint`, report `context-menu` when `event.kind == PointerEventKind.up` and the button is the right one, and keep `select` on the press.
2. **Use the theme's selection colour.** Replace `#2b2b2b` with `Theme.selected-bg`, so the highlight follows the player's colour scheme like the text already does.
3. **A third menu item with a check mark.** Add a command with `checked: () => …` (for example "Wrap around at the end") and put it in the `showMenu` list; let `canNext` and `next` respect it.
4. **Accept dropped files.** Add `ui.drop` and use {@link "@vestra-player/sdk"!Panel.onDrop | panel.onDrop} to append the dropped file names to `items`.
5. **Play the items.** Make the items file paths and call `plugin.player.open(path)` in `next` and `previous`: that is the core of a playlist plugin.

## See also

- [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md): panels, their life cycle, focus and keyboard.
- {@link "@vestra-player/sdk"!Panels | Panels}, {@link "@vestra-player/sdk"!Panel | Panel}, {@link "@vestra-player/sdk"!PanelSlot | PanelSlot}
- {@link "@vestra-player/sdk"!CommandOptions | CommandOptions} (`focus`, `title`, `enabled`)
- {@link "@vestra-player/sdk"!SequenceProvider | SequenceProvider}, {@link "@vestra-player/sdk"!Player.provideSequence | Player.provideSequence}
- {@link "@vestra-player/sdk/testing"!TestHost | TestHost}
