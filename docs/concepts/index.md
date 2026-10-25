---
title: Concepts
description: What each part of the player and its plugins is, why it works the way it does and how the parts fit together.
---

# Concepts

Concept pages explain how the player and its plugins fit together: what a thing is, why it works the way it does, and how it relates to its neighbours. They do not walk through code step by step (that is what the [Tutorials](../tutorials/index.md) do), they do not list every member (that is the {@link "@vestra-player/sdk" | API reference}), and they do not collect constants and names (that is the [Reference](../reference/index.md)). Start with the first page; the others build on it.

## How a plugin runs

Each plugin runs in a Node.js process of its own and receives a `plugin` object in `activate`. Everything it creates is a handle owned by a scope, so stopping the plugin releases everything. The page covers the process, activation and what makes it fail, handles and child scopes, the update pass that sends bound values to the player, what happens when a plugin stops, the data directory and installation instances, and how failures reach the plugin (`code`, `onError`, no timeouts, no blind retries).

[Read the page](plugins.md)

## Commands, menus and key bindings

A command is one action with one state, reachable from the menu, a key, a panel's context menu and tests. The page explains declared state, how menu paths from every plugin merge into the player's one menu by their English keys and how they are ordered, how a key press finds its command (focus, scopes, conflicts, disabled commands that let their key go, what a key name matches), the user's own bindings and the player's own commands.

[Read the page](commands.md)

## Playback state, controls and sources

The player plays one source that the user and every plugin share. The page explains the playback state and how to follow it, why controls are conditional on the state the plugin saw and fail with `stale` instead of acting on the wrong source, where sources come from (files and URLs, web and file resolvers, generated streams), the next/previous sequence and the core actions.

[Read the page](playback.md)

## Video and audio processing

Filter chains change the frames and samples; the display layer and the render options change only how the video is shown. The page compares the three, explains how each plugin's chain is joined with the others and re-applied for every source, what the chain's status means, which parameters change live, and why the display layer and render options have a single owner.

[Read the page](processing.md)

## Windows, panels, settings pages, dialogs and the OSD

A plugin can show its interface in five places, and choosing the right one matters more than any detail of the API. The page compares tool windows, panels, settings pages, dialogs and the OSD, draws each one's life cycle (including what ⌘W / Ctrl+W does and why mounting a panel rebuilds the main window), explains how Slint and TypeScript exchange values and the rules for plugin Slint files, and covers the theme, sizes, focus and keyboard and the common pitfalls.

[Read the page](ui.md)
