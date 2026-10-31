---
title: Troubleshooting
description: Symptoms plugin authors run into, what causes each one and what to do about it.
---

# Troubleshooting

Each section starts from what you see, then gives the cause and the fix. The cause links to the page that explains the mechanism; the error codes are in [Reference: error codes](../reference/errors.md).

## Binding a window callback throws

**Cause:** The callback was bound with `on()` after the window's first `show()`; callbacks are registered when the window opens.

**Fix:** Bind every callback right after `create()`. Re-binding a name that already has a handler is fine.

## A control stops following the plugin after the user touches it

**Cause:** A one-way binding in Slint (`value: root.x`), which Slint breaks the first time the user moves the control.

**Fix:** Declare the property `in-out` and bind it two-way: `value <=> root.x`.

## A slider's thumb jumps back under the pointer

**Cause:** The plugin writes the value with `set()` in a frequent loop; `set` always sends, even an unchanged value.

**Fix:** Use `bind` for anything derived from state ([Keep a slider responsive while dragging](slider.md)).

## A value the user changed reverts

**Cause:** A settings page, tool window or panel is rebuilt from the plugin's last written values; an `in-out` property the user changed without a callback updating the plugin's model goes back to that value.

**Fix:** Handle the control's callback, keep the value in your state and `bind` it.

## A panel loses its scroll position or the text in a field

**Cause:** State kept only inside the panel's Slint component is lost when the main window is rebuilt (any plugin mounting or unmounting a panel) or the sidebar is detached or attached.

**Fix:** Keep anything that matters in bridge properties the plugin writes ([Life cycles: panel](../explanation/ui.md#panel)).

## Colours do not follow the palette

**Cause:** Colours hard-coded in the Slint file.

**Fix:** Use `Theme.*` tokens, and `Theme.danger` for errors ([Reference: theme](../reference/theme.md#colours)).

## A panel mount or a dialog is refused

**Cause:** There is one panel per plugin, one bottom bar and one backdrop for all plugins (`conflict`), one OSD info block per plugin, and one open dialog at a time player-wide (`busy`).

**Fix:** Mount only the plugin's one panel and treat a `conflict` for a shared slot as "another plugin is there"; keep one OSD info block handle and change its text; wait for an open dialog to be answered.

## The video drops frames while the pointer moves over a window

**Cause:** An `if` that flips under the pointer (`if touch.has-hover: Rectangle { … }`, a hover highlight, an accent bar, a tooltip-like box) creates and destroys an element on every hover change. While a video plays, the player's accessibility tree (screen readers, UI Automation) is rebuilt for the whole window each time, measured at 100–160 ms per hover on Windows, enough to drop the video to 10–15 frames a second.

**Fix:** Keep the element and change properties instead: `Rectangle { visible: touch.has-hover; … }` or `opacity:`. Use `if` only for things that change rarely (a mode, a selection made with a click, a list that was loaded).

## Panel position or palette state does not follow other plugins or the user

**Cause:** The plugin lacks the `events` capability: {@link "@vestra-player/sdk"!PanelSlot.state | PanelSlot.state}, {@link "@vestra-player/sdk"!Appearance.theme | appearance.theme} and their `onChange` listeners follow outside changes only with it.

**Fix:** Declare `events` in the manifest.

## A value changed after an await does not appear

**Cause:** The SDK sends bound values in an update pass after a handler returns and again when its promise settles; a value changed after an `await` inside a longer task appears only when that task ends.

**Fix:** Call `plugin.update()` when such a task has something new to show ([The update pass](../explanation/plugins.md#the-update-pass), [Keep a slider responsive while dragging](slider.md)).

## A call fails with `stale`

**Cause:** The user or another plugin changed the source (or the subtitle selection) after the state your call depended on; nothing was done.

**Fix:** Usually ignore `stale`, or read the new state and decide again. For slow work, pass the state you started from as `ifCurrent` so the call never acts on the wrong file ([Conditional controls](../explanation/playback.md#conditional-controls), [Control playback](control-playback.md)).

## A call fails with `capability`

**Cause:** The manifest does not declare the capability the call needs.

**Fix:** Add it to `capabilities`. `vestra-plugin check` and the SDK's TypeScript plugin in the editor point such calls out before the plugin runs ([Capabilities](../reference/capabilities.md#catching-a-missing-capability)).

## A key binding does not fire

**Cause:** Command key bindings belong to the main window (and the floating sidebar): they do not fire while a tool window or the Options window has focus, while a menu or a system dialog is open, or when a focused control takes the key (Space in a text field). In a tool window, the floating sidebar or the Options window, the standard close keys (Ctrl+W and Ctrl+F4 on Windows, ⌘W on macOS) close that window before any binding sees them. A disabled command lets its key go on to the next command bound to it, unless it has a `reason`.

**Fix:** Choose a default key the system does not take, and give a disabled command a `reason` when its key should be eaten. See [How a key finds its command](../explanation/commands.md#how-a-key-finds-its-command) and [Keys the system takes first](../reference/commands.md#keys-the-system-takes-first).

## A test passes locally and fails in CI

**Cause:** `host.settle()` waits only for the plugin's calls to the player. Work the plugin does on its own (reading or parsing a file, a child process, a network request) can finish later on a loaded machine; a debounce or timer needs time too.

**Fix:** Poll the value you assert on ([Test a plugin](testing.md#wait-then-assert)), and use `host.settle(ms)` past a debounce or timer.

## State is lost when the plugin restarts

**Cause:** Everything in the plugin's process is gone after a reload, an upgrade or a crash.

**Fix:** Keep what must survive in `plugin.storage.session` (this run of the player) or `plugin.storage.json` (across runs), and build the interface from it in `activate` ([Restarts](../explanation/plugins.md#restarts-activate-can-run-more-than-once), [Store a plugin's data](store-data.md)).

## See also

- [Reference: error codes](../reference/errors.md)
- [How a plugin runs](../explanation/plugins.md#failures-and-recovery): where failures go.
- [Test a plugin](testing.md)
