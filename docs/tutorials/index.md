---
title: Tutorials
description: Step-by-step lessons; the first four build one plugin, from an empty folder to a tested package in the plugin store.
---

# Tutorials

Tutorials take you from an empty folder to a working plugin, one step at a time, and end with something that runs in the player. If you want to look something up instead, use the [Reference](../reference/index.md) tables or the {@link "@vestra-player/sdk" | API reference}; to understand how the pieces fit together, read the [Explanation](../explanation/index.md); for one task at a time, the [How-to guides](../how-to/index.md).

The four tutorials build one plugin, each continuing the last:

| Tutorial | You will learn |
| --- | --- |
| 1. [Getting started](getting-started.md) | The plugin folder, the manifest, a menu item with a key that shows a message on the video, running it in the player. |
| 2. [Add a window](add-a-window.md) | A Slint tool window with properties bound to the playback state and a button that seeks. |
| 3. [Add settings and translations](settings-and-translations.md) | A settings page whose value the plugin remembers, templates and `@tr`, a Simplified Chinese translation. |
| 4. [Test, check, pack and publish](test-and-publish.md) | A test without the player, the checks, a `.vxp` package and the store submission. |

One more lesson stands on its own, for when you know the basics:

| Tutorial | You will learn |
| --- | --- |
| [Write your own blur kernel](blur-kernel.md) | What the numbers of a blur kernel do; the kernel as a GPU shader (`plugin.video.shaders`), then as a `convolution` node that also reaches snapshots; the ready-made `gblur` filter as the shortcut. |

After them, the [Examples](../examples/index.md) walk through complete plugins (tool windows, panels, menus, filters, generated streams, translations).

You need Node.js 26 or newer and Vestra Player 0.4.3 or newer to try the plugin.
