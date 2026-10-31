---
title: Reference
description: Lookup tables that span many symbols (capabilities, manifest fields and player versions, limits, menu and binding names, platform differences, theme, command line), generated from the SDK's code.
---

# Reference

These pages are tables to look things up in while you write a plugin. Each one collects facts that belong to many API symbols at once; what a single symbol does is in the {@link "@vestra-player/sdk" | API reference}, and how the pieces fit together is in the [Explanation](../explanation/index.md). Most tables are generated from the SDK's own constants and Slint files, so they match the version of the SDK you read them for.

## Manifest

Every `manifest.json` field and its rules, and which player version the newer parts of the API need (`minPlayerVersion`).

[Read the manifest reference](manifest.md)

## Capabilities

Every capability a manifest can declare: the members it opens, the capabilities they also need, and how the plugin store describes it to the user.

[Read the capabilities reference](capabilities.md)

## Limits

The player's runtime limits in one place: commands, property values, text values, Markdown, the on-screen display, secrets and the size of a message.

[Read the limits reference](limits.md)

## Commands, menus and bindings

Built-in menu ids, the submenu keys already in use, every command the player and its built-in plugins register with its default keys, the binding syntax and input names, the core actions and the keys the system takes first.

[Read the commands reference](commands.md)

## Platforms

What differs between macOS and Windows: the clipboard, dialogs, window control, keychains, rendering, keys and fonts.

[Read the platforms reference](platforms.md)

## Theme

The `Theme` tokens with their current values, fonts, the icon names, and the components of `@vestra/widgets.slint` and `@vestra/markdown.slint`.

[Read the theme reference](theme.md)

## Command line

The `vestra-plugin` commands and options, what `build` puts into a package, and the `vestra` field of `package.json`.

[Read the command line reference](cli.md)
