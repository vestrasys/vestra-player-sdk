---
title: Upgrading
description: What to change in a plugin when an SDK or player release deprecates, removes or changes something it uses.
---

# Upgrading

Additions never need a change in a plugin. These pages are for the releases that deprecated or removed something, or changed how plugins are written, each with a checklist. Every release's entry in the [CHANGELOG](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md) opens with who must change and what happens to a plugin that does not.

## Migrate a plugin to English source text

The checklist for a plugin written in one language before SDK 1.5.9: English menu paths, `@tr` in Slint, sentences moved out of TypeScript into Slint or templates, `zh-Hans.po` written from the old texts, and tests.

[Read the guide](i18n-migration.md)

## Migrate off package rollback

The player no longer keeps a previous plugin version: `packages.rollback` and `previousVersion` were deprecated in SDK 1.5.16 and removed in 1.5.17. The checklist for plugins with `plugins.manage`: remove rollback calls and UI and any "Undo install", keep to install, uninstall and disable/enable for third-party plugins (an older version is the user's uninstall plus a `.vxp`), offer no action for built-ins (from 1.5.18 they cannot be disabled either), and update tests.

[Read the guide](rollback-migration.md)

## Who must change, release by release

Every release's "who must change" in one table, newest first, with the migration guide where there is one.

[Read the table](releases.md)
