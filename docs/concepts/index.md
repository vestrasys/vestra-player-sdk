---
title: Concepts
---

# Concepts

Concept pages explain how the player and its plugins fit together: what a thing is, why it works the way it does, and how it relates to its neighbours. They do not walk through code step by step (that is what the [Tutorials](../tutorials/index.md) do) and they do not list every member (that is the {@link "@vestra-player/sdk" | API reference}).

## Windows, panels, settings pages, dialogs and the OSD

A plugin can show its interface in five places, and choosing the right one matters more than any detail of the API. A **tool window** is a separate, non-modal window the plugin owns; a **panel** lives inside the player's main window (bottom bar, sidebar, or the backdrop shown while there is no video); a **settings page** is a page in the Options window; **dialogs** are the system's own confirm and file dialogs; the **OSD** is text over the video. The page compares them in a decision table, draws each one's life cycle (including what ⌘W / Ctrl+W does and why mounting a panel rebuilds the main window), explains how Slint and TypeScript exchange values (properties out, callbacks in, a bridge global for panels and pages, `set` versus `bind` and the update pass), and covers theme tokens, sizes, focus and keyboard, platform differences and the common pitfalls.

[Read the page](ui.md)

## Pages being written

Until a page is published, the reference documentation of the type named here is the best source.

- **Plugins and processes.** How the player starts a plugin in its own Node.js process, the `activate` function, and how scopes and handles release everything when the plugin stops ({@link "@vestra-player/sdk"!Plugin Plugin}, {@link "@vestra-player/sdk"!Scope Scope}).
- **Capabilities.** What the manifest's `capabilities` grant, and how the player checks them on every call.
- **Commands and menus.** Commands, menu paths and built-in menu ids, key bindings and how conflicts are resolved ({@link "@vestra-player/sdk"!Commands Commands}).
- **Player state and events.** Reading the playback state, following changes, and conditional controls that fail with `stale` instead of acting on the wrong source ({@link "@vestra-player/sdk"!Player Player}).
- **Filter chains.** Video and audio filters, how plugins' chains are joined, and live parameter changes.
- **Storage, secrets and the data directory.** Where a plugin keeps its files, settings and credentials.
- **Packages and the plugin store.** `.vxp` packages, validation and installation.
- **Errors and recovery.** Error codes, what to retry and what to report ({@link "@vestra-player/sdk"!PluginError PluginError}).
