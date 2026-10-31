---
title: Add a window
description: "Tutorial 2 of 4: give the plugin a tool window that shows what is playing and a button that seeks back ten seconds."
---

# Add a window

In this tutorial the plugin from [Getting started](getting-started.md) gets a window: **Tools ▸ Hello…** opens it, it shows the playing file, and its **Back 10 s** button seeks back.

## Before you start

Finish [Getting started](getting-started.md): you have `my-plugin/` with `manifest.json` and `main.ts`, and the plugin runs with `vestra-player --plugin ./my-plugin`. How windows, Slint and TypeScript work together is explained in [Windows, panels, settings pages, dialogs and the OSD](../explanation/ui.md).

## 1. Declare the new capabilities

The window needs `ui.window`, and seeking needs `playback.control`. Add both to `manifest.json`:

```json
{
  "id": "me.hello",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": [
    "commands",
    "ui.osd",
    "playback.read",
    "events",
    "ui.window",
    "playback.control"
  ]
}
```

## 2. Write the Slint file

Create `ui/hello.slint`. It declares two properties the plugin writes and one callback the plugin handles, and uses the player's theme and button:

```slint
// ui/hello.slint
import { Button } from "@vestra/widgets.slint";
import { Theme } from "@vestra/theme.slint";

export component Hello inherits Window {
    title: "Hello";
    in property <string> message;
    in property <bool> can-seek;
    callback jump(float);
    background: Theme.bg-panel;
    VerticalLayout {
        Text { text: root.message; color: Theme.text; }
        Button { text: "Back 10 s"; enabled: root.can-seek; clicked => { root.jump(-10); } }
    }
}
```

`@vestra/theme.slint` and `@vestra/widgets.slint` come from the player. For your editor, point the Slint language server's library path `vestra` at `node_modules/@vestra-player/sdk/slint/vestra`.

## 3. Open it from a command

Add to the end of `activate` in `main.ts`:

```ts
const window = plugin.windows.create("ui/hello.slint");
window.bind(() => ({
  message: plugin.player.state.source ?? "Nothing is playing",
  canSeek: plugin.player.state.can.seek,
}));
window.on("jump", (delta: number) =>
  plugin.player.seek(Math.max(0, (plugin.player.state.position ?? 0) + delta)),
);
plugin.commands.add({
  id: "hello",
  path: ["Tools", "Hello…"],
  run: () => window.show(),
});
```

`bind` keeps the window's properties equal to the playback state; `canSeek` reaches the Slint property `can-seek`. Bind callbacks with `on` before the window is first shown.

## 4. Try it

Run `npm run check`, start the player with `--plugin ./my-plugin`, open a video and choose **Tools ▸ Hello…**. The window shows the file; **Back 10 s** jumps back, and is greyed out while the video cannot seek. Close the window and open it again: it shows the current file at once.

## Next

- [Add settings and translations](settings-and-translations.md): the third tutorial adds a settings page and a Chinese translation.
- [Interface guidelines](../guidelines/interface.md): how a window should look to fit in.
- [Reference: theme](../reference/theme.md): every token, icon and widget.
