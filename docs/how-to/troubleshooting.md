---
title: Troubleshooting
description: Symptoms plugin authors run into, what causes each one and what to do about it.
---

# Troubleshooting

Each section starts from what you see. The cause links to the page that explains the mechanism; the error codes are in [Reference: error codes](../reference/errors.md).

## The interface

- **A window callback bound after the first `show()`.** It throws. Bind all callbacks right after `create()`; re-binding a name that already has a handler is fine.
- **A one-way binding on a control.** `value: root.x` stops following the plugin after the user touches the control. Use `in-out` and `<=>`.
- **`set()` inside a frequent loop.** `set` always sends, even an unchanged value; a periodic `set` of a slider value pulls the thumb back from under the user's pointer. Use `bind` for anything derived from state.
- **Changes after an `await` do not appear.** The update pass runs when the handler finishes; call `plugin.update()` for progress in between.
- **State only inside a panel component.** It is lost when the main window is rebuilt or the sidebar detaches. Keep anything that matters in bridge properties written by the plugin.
- **User edits the plugin does not record.** A settings page or tool window is rebuilt from the plugin's last written values; an `in-out` property the user changed without a callback updating your model reverts. Handle the callback and keep the value in your state (and `bind` it).
- **Hard-coded colours.** They do not follow the palette. Use `Theme.*`, and `Theme.danger` for errors.
- **A `Ctrl+W` default binding.** It never fires in tool windows and floating panels. Pick another key.
- **Two of a kind.** One panel per plugin, one backdrop per player, one OSD info block per plugin, one open dialog at a time (`busy`).
- **An `if` that flips under the pointer.** `if touch.has-hover: Rectangle { … }` (a hover highlight, an accent bar, a tooltip-like box that follows the pointer) creates and destroys an element on every hover change. While a video plays, each such change costs the player's UI thread far more than a property change: the player's accessibility tree (screen readers, UI Automation) is rebuilt for the whole window each time, measured at 100–160 ms per hover on Windows, enough to drop the video to 10–15 frames a second while the pointer moves. Keep the element and change properties instead: `Rectangle { visible: touch.has-hover; … }` or `opacity:`. Use `if` for things that change rarely (a mode, a selection made with a click, a list that was loaded), never for something that follows the pointer or a hover.
- **Slot state without `events`.** {@link "@vestra-player/sdk"!PanelSlot.state | PanelSlot.state}, {@link "@vestra-player/sdk"!Appearance.theme | appearance.theme} and their `onChange` listeners follow other plugins and the user only with the `events` capability.

## A value changed after an await does not appear

The SDK sends bound values in an update pass after a handler returns and again when its promise settles. A value changed after an `await` inside a longer task appears only when that task ends. Call `plugin.update()` when such a task has something new to show ([The update pass](../explanation/plugins.md#the-update-pass), [Keep a slider responsive while dragging](slider.md)).

## A call fails with `stale`

The user or another plugin changed the source (or the subtitle selection) after the state your call depended on; nothing was done. That is usually the right outcome: ignore `stale`, or read the new state and decide again. For slow work, pass the state you started from as `ifCurrent` so the call never acts on the wrong file ([Conditional controls](../explanation/playback.md#conditional-controls), [Control playback](control-playback.md)).

## A call fails with `capability`

The manifest does not declare the capability the call needs. `vestra-plugin check` and the SDK's TypeScript plugin in the editor point such calls out before the plugin runs ([Capabilities](../reference/capabilities.md#catching-a-missing-capability)).

## A key binding does not fire

Command key bindings belong to the main window (and the floating sidebar): they do not fire while a tool window or the Options window has focus, while a menu or a system dialog is open, or when a focused control takes the key (Space in a text field). The standard close keys are taken by the system first. A disabled command lets its key go on to the next command bound to it, unless it has a `reason`. See [How a key finds its command](../explanation/commands.md#how-a-key-finds-its-command) and [Keys the system takes first](../reference/commands.md#keys-the-system-takes-first).

## A test passes locally and fails in CI

`host.settle()` waits only for the plugin's calls to the player. Work the plugin does on its own (reading or parsing a file, a child process, a network request) can finish later on a loaded machine: poll the value you assert on ([Test a plugin](testing.md#wait-then-assert)). A debounce or timer needs `host.settle(ms)` past its delay.

## State is lost when the plugin restarts

Everything in the plugin's process is gone after a reload, an upgrade or a crash. Keep what must survive in `plugin.storage.session` (this run of the player) or `plugin.storage.json` (across runs), and build the interface from it in `activate` ([Restarts](../explanation/plugins.md#restarts-activate-can-run-more-than-once), [Store a plugin's data](store-data.md)).

## See also

- [Reference: error codes](../reference/errors.md)
- [How a plugin runs](../explanation/plugins.md#failures-and-recovery): where failures go.
- [Test a plugin](testing.md)
