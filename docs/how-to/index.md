---
title: How-to guides
---

# How-to guides

How-to guides are short answers to one practical question each: "how do I do X?". They assume you already know the basics from [Getting started](../tutorials/getting-started.md).

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

## Guides being written

- Show "Starting…" while a callback awaits something slow (`plugin.update()` sends bound properties before the callback returns; see the signal generator, Step 7).
- Build file paths that work on macOS and Windows.
- Run an external program and read its output.
- Test a plugin with the in-memory test host.
- Bundle npm dependencies into a package.

Until a guide exists, the [Examples](../examples/index.md) show most of these techniques in complete plugins.
