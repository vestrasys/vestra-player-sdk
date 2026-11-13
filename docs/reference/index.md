---
title: Reference
description: Lookup tables that span many symbols, from manifest fields and capabilities to the test host, mostly generated from the SDK's code.
---

# Reference

Tables to look things up in while you write a plugin. Each page collects facts that belong to many API symbols at once; what a single symbol does is in the {@link "@vestra-player/sdk" | API reference}, and how the pieces fit together is in the [Tutorial](../tutorial/index.md). Most tables are generated from the SDK's own constants and Slint files, so they match the SDK you read them for.

- [Manifest](manifest.md): every `manifest.json` field and its rules.
- [Capabilities](capabilities.md): the eight capabilities, what each opens, how the store describes it, what replaced the names of SDK 1.7, and how a missing one is caught.
- [Limits](limits.md): commands, property and text values, Markdown, the OSD, the timeline, secrets, session storage, subtitles, messages, video processing and plugin processes.
- [Commands, menus and bindings](commands.md): menu ids and paths, the top level and its groups, submenu keys in use, every built-in command, bottom-bar buttons, the binding syntax and names, the core actions and the keys the system takes first.
- [Platforms](platforms.md): what differs between macOS and Windows.
- [Theme](theme.md): `Theme` tokens and values, fonts, surface sizes and layouts, icons, `@vestra/widgets.slint`, `@vestra/markdown.slint`, `@vestra/focus.slint` and the bar buttons.
- [Command line](cli.md): the `vestra-plugin` commands and options, what `build` puts into a package, and the `vestra` field of `package.json`.
- [Error codes](errors.md): every `error.code` and what it means.
- [Events](events.md): every event a plugin can listen to, its payload, its listeners and whether it wakes a stopped plugin.
- [Messages](messages.md): every request method of the player's protocol, with its capability, parameters, result, errors and the SDK member that sends it.
- [mpv](mpv.md): the mpv pass-through: members and messages, what it refuses and why, who owns filters and observers, limits.
- [Translations](i18n.md): languages, where English source text goes, templates, files, `i18n extract` and `i18n check`, review markers and limits.
- [Test host](testing.md): what `startPlugin` takes, how `TestHost` acts like the user and simulates the player, and every member.
