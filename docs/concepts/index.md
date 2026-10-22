---
title: Concepts
---

# Concepts

Concept pages explain how the player and its plugins fit together: what a thing is, why it works the way it does, and how it relates to its neighbours. They do not walk through code step by step (that is what the [Tutorials](../tutorials/index.md) do) and they do not list every member (that is the {@link "@vestra-player/sdk" | API reference}).

The pages are being written. Until a page is published, the reference documentation of the type named in brackets is the best source.

| Concept | What it covers |
| --- | --- |
| Plugins and processes | How the player starts a plugin, the `activate` function, scopes and handles ({@link "@vestra-player/sdk"!Plugin \| Plugin}, {@link "@vestra-player/sdk"!Scope \| Scope}). |
| Capabilities | What the manifest's `capabilities` grant and how the player checks them per call. |
| Commands and menus | Commands, menu paths, key bindings and their conflicts ({@link "@vestra-player/sdk"!Commands \| Commands}). |
| Windows, panels and settings pages | What each kind of user interface is, its life cycle and when to use which ({@link "@vestra-player/sdk"!View \| View}). |
| Player state and events | Reading the playback state, following changes and conditional controls ({@link "@vestra-player/sdk"!Player \| Player}). |
| Filter chains | Video and audio filters, their order and live parameter changes. |
| Storage, secrets and the data directory | Where a plugin keeps its files, settings and credentials. |
| Packages and the plugin store | `.vxp` packages, validation, trial runs and installation. |
| Errors and recovery | Error codes, what to retry and what to report ({@link "@vestra-player/sdk"!PluginError \| PluginError}). |
