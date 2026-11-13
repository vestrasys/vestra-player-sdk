---
title: Guides
description: One page per task, from adding a window to publishing a plugin, plus the design rules and troubleshooting.
---

# Guides

Each guide answers one practical question: "how do I do X?". A guide states its goal, gives the steps, often a complete example, and ends with where to read on. They assume you know the basics from the [Tutorial](../tutorial/index.md).

## How a plugin works

The rules every guide assumes, on one page: the plugin process and what it follows, handles and scopes, the update pass (`set` against `bind`, when a change shows), how values cross between TypeScript and Slint and which Slint types a plugin can write, commands, menus and keys, what keeps a plugin running and what is lost when it is stopped, the four places that change the picture and sound, the playback state, and how failures are reported.

[Read the guide](how-plugins-work.md)

## Open a tool window and remember its state

A tool window is a Slint component the plugin creates from TypeScript. The guide opens one from a menu item, wires its controls to the plugin, stores its values, and brings back the values and whether it was open at the next start.

[Read the guide](windows.md)

## Add settings and translations

A settings page keeps its values in the plugin's storage. The player shows its interface in seven languages, chosen at start-up; a plugin writes every text in English (menu paths and titles, `@tr("…")` in its Slint files, templates such as `osd.show("Speed {}×", [rate])`) and ships one gettext file per language in `locales/`; the player translates, and the plugin contains no translation code. The guide adds a settings page, then covers the three places text lives, `vestra-plugin i18n extract` and `check`, and testing in another language.

[Read the guide](i18n.md)

## Control playback

Every control of `plugin.player` is conditional: it acts on the state the plugin last saw and fails with `stale`, doing nothing, when the user or another plugin changed the source meanwhile. The guide shows how to read and follow the state, bind menu items to `state.can`, handle `stale` and pass `ifCurrent` across slow work, open a file and follow it with its `Media` handle, use the player's own core actions for buttons, provide Next and Previous, and where sliders, loops and the output fit in.

[Read the guide](control-playback.md)

## Store a plugin's data

A plugin has three places to keep data, all private to it: settings files (`storage.json`, across player restarts), session values (`storage.session`, across plugin restarts within one player run) and the system's secret store (`secrets`, for tokens). The guide says which to use for what, how each one writes and fails (debounced atomic files, the 1 MiB session limit, a missing or refused keychain), and where larger files go.

[Read the guide](store-data.md)

## Keep a slider responsive while dragging

A slider reports every pointer move, often more than 60 times a second, so a slider that drives a video filter, the volume or a preview can lag or queue up requests. The guide builds a Brightness window and shows the four habits that keep it smooth: the callback records the newest value and never awaits; the expensive part is a call that keeps only the latest value (`filter.set`, `player.setOutput`, `Scrub.seek`); the slider's value is bound with `bind`, not `set`, so the plugin never fights the pointer; and one-off work waits for the release. It ends with a small helper that gives your own slow work latest-value behaviour, and with when to call `plugin.update()`.

[Read the guide](slider.md)

## Load subtitles from a plugin

A subtitle plugin reads the tracks of the playing file, selects one (and handles `stale` when the user changed the selection meanwhile), uploads a file it found or converted (SRT or ASS, with the limits), and can set a style layer. The guide also explains which plugin's style the player shows when several set one.

[Read the guide](subtitles.md)

## Process video with a shader or a filter

The guide blurs the video with a kernel of your own, first as a GPU shader, then as a convolution node that also reaches snapshots, and finally with the ready-made `gblur` filter.

[Read the guide](filters.md)

## Offer a GPU rendering switch

The player can draw the video on the GPU or in software, and keeps the user's choice itself, applied from the next start. The guide builds a settings item "GPU Rendering (Experimental)" from `plugin.rendering.state()`: checked when the next start uses the GPU, greyed out with the player's reason where the GPU cannot be chosen, "(Restart to Apply)" while a change waits, and a restart item that calls `restartPlayer()`. It also covers testing with `TestHost.rendering`.

[Read the guide](gpu-rendering.md)

## Keep a command's state without keeping the plugin running

A menu item whose `enabled` or `checked` is a function that reads `plugin.player.state` keeps the plugin running, because the SDK must evaluate it on every change. The guide finds such bindings with `TestHost.keepsRunning`, replaces them with `plugin.when` conditions that the player evaluates itself (`when.can("snapshot")`, `when.theme(id)`, combined with `and`, `or`, `not`), keeps the plugin's own state as values, and tests that nothing keeps the plugin running.

[Read the guide](command-state.md)

## Test a plugin

`@vestra-player/sdk/testing` runs a plugin against `TestHost`, an in-memory player that speaks the real protocol. The guide shows the shape of a test (start, act, settle, assert, stop), how to act like the user (run commands, press keys and what `press` reports, fire window callbacks, answer dialogs), how to simulate sources and the main window, how to inject a refusal or a lost reply with `host.handle`, when `settle()` is enough and when to poll, and what to assert on.

[Read the guide](testing.md)

## Publish a plugin

Plugins reach the store through pull requests to the official plugin repository. The guide covers preparing the package, choosing the id, adding the plugin to the repository, the pull request and its checks, updating, withdrawing, asking for a revocation, and what users see of the plugin in the store.

[Read the guide](publish.md)

## Host your own plugin store

A store is any https address that serves an `index.json`; users add it to the player's store under ⚙ ▸ Repositories…, and its plugins install and update from there, marked Unofficial and with a warning. The guide covers ids, the index format (packages with their size and sha256, icon, README and changelog, `minPlayerVersion`, revocations), what users see, testing on `localhost`, and a GitHub repository whose Actions pack every plugin with `vestra-plugin pack` and publish the index on GitHub Pages.

[Read the guide](own-store.md)

## Give a coding agent the documentation

Claude Code, Cursor or the player's own Vestra Player AI read this documentation as a tree of short nodes, like `go doc`: `npx -p @vestra-player/sdk vestra-plugin docs Snapshot.dispose` prints one member's signature, errors, and examples, `--search` finds paths, and every answer stays under 8 KB. The guide shows what to put in the agent's instructions, the path scheme, searching, paging, and the same calls from a program with `@vestra-player/sdk/docs`.

[Read the guide](agent-docs.md)

## Design rules

The rules every plugin follows: only the public SDK, no other plugins' internals, both systems, its own id; how its windows, panels and on-screen messages use the theme and fit long or CJK text; where its commands go in the menus and which keys it may take.

[Read the rules](design-rules.md)

## Troubleshooting

Symptoms and their causes: interface pitfalls (callbacks bound too late, one-way bindings, state lost when a panel gets a new instance, hover effects that cost frames), values that do not appear after an `await`, `stale` and `capability` failures, key bindings that do not fire, tests that fail only in CI, state lost at a restart.

[Read the page](troubleshooting.md)
