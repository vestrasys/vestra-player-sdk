---
title: How-to guides
description: Short guides that each answer one practical question about writing, translating, testing or publishing a plugin.
---

# How-to guides

How-to guides are short answers to one practical question each: "how do I do X?". They assume you already know the basics from [Getting started](../tutorials/getting-started.md).

## Control playback

Every control of `plugin.player` is conditional: it acts on the state the plugin last saw and fails with `stale`, doing nothing, when the user or another plugin changed the source meanwhile. The guide shows how to read and follow the state, bind menu items to `state.can`, handle `stale` and pass `ifCurrent` across slow work, open a file and follow it with its `Media` handle, use the player's own core actions for buttons, provide Next and Previous, and where sliders, loops and the output fit in.

[Read the guide](control-playback.md)

## Store a plugin's data

A plugin has three places to keep data, all private to it: settings files (`storage.json`, across player restarts), session values (`storage.session`, across plugin restarts within one player run) and the system's secret store (`secrets`, for tokens). The guide says which to use for what, how each one writes and fails (debounced atomic files, the 1 MiB session limit, a missing or refused keychain), and where larger files go.

[Read the guide](store-data.md)

## Load subtitles from a plugin

A subtitle plugin reads the tracks of the playing file, selects one (and handles `stale` when the user changed the selection meanwhile), uploads a file it found or converted (SRT or ASS, with the limits), and can set a style layer. The guide also explains which plugin's style the player shows when several set one.

[Read the guide](subtitles.md)

## Keep a slider responsive while dragging

A slider reports every pointer move, often more than 60 times a second, so a slider that drives a video filter, the volume or a preview can lag or queue up requests. The guide builds a Brightness window and shows the four habits that keep it smooth: the callback records the newest value and never awaits; the expensive part is a call that keeps only the latest value (`filter.set`, `player.setOutput`, `Scrub.seek`); the slider's value is bound with `bind`, not `set`, so the plugin never fights the pointer; and one-off work waits for the release. It ends with a small helper that gives your own slow work latest-value behaviour, and with when to call `plugin.update()`.

[Read the guide](slider.md)

## Remember a window's state between runs

A tool window keeps nothing by itself: closing it destroys it, and the plugin process ends with the player. The guide keeps the window's values in `plugin.storage.json` (validated, debounced, flushed when the plugin stops), binds the window to the stored state, records whether the window is open (only the user's close counts as closed, so a window open at quit comes back), and reopens it during activation. It also says what cannot be restored: the operating system places tool windows, and the API has no position or size.

[Read the guide](window-state.md)

## Translate a plugin

The player shows its interface in seven languages, chosen at start-up. A plugin writes every text in English (menu paths and titles, `@tr("…")` in its Slint files, templates such as `osd.show("Speed {}×", [rate])`) and ships one gettext file per language in `locales/`; the player translates, and the plugin contains no translation code. The guide covers the three places text lives, `vestra-plugin i18n extract` and `check`, and testing in another language.

[Read the guide](i18n.md)

## Migrate a plugin to English source text

The checklist for a plugin written in one language before SDK 1.5.9: English menu paths, `@tr` in Slint, sentences moved out of TypeScript into Slint or templates, `zh-Hans.po` written from the old texts, and tests.

[Read the guide](i18n-migration.md)

## Test a plugin

`@vestra-player/sdk/testing` runs a plugin against `TestHost`, an in-memory player that speaks the real protocol. The guide shows the shape of a test (start, act, settle, assert, stop), how to act like the user (run commands, press keys and what `press` reports, fire window callbacks, answer dialogs), how to simulate sources and the main window, how to inject a refusal or a lost reply with `host.handle`, when `settle()` is enough and when to poll, and what to assert on.

[Read the guide](testing.md)

## Publish a plugin

Plugins reach the store through pull requests to the official plugin repository. The guide covers preparing the package, choosing the id, registering the source repository (or hosting the plugin there), the pull request and its checks, updating, withdrawing, asking for a revocation, and what users see of the plugin in the store.

[Read the guide](publish.md)

## Migrate off package rollback

The player no longer keeps a previous plugin version: `packages.rollback` and `previousVersion` were deprecated in SDK 1.5.16 and removed in 1.5.17. The checklist for plugins with `plugins.manage`: remove rollback calls and UI and any "Undo install", keep to install, uninstall and disable/enable for third-party plugins (an older version is the user's uninstall plus a `.vxp`), offer no action for built-ins (from 1.5.18 they cannot be disabled either), and update tests.

[Read the guide](rollback-migration.md)
