---
title: Open a tool window and remember its state
description: Open a tool window from a menu item, wire its controls to the plugin, and bring back its values and whether it was open at the next start.
---

# Open a tool window and remember its state

**Goal:** a menu item opens a tool window whose controls act on the player, and the window comes back the way the user left it: its controls hold the last values, and if it was open when the player quit, it opens again at the next start.

A tool window keeps nothing by itself: closing it destroys the window instance, and the plugin process ends with the player. The plugin holds the state, stores it with {@link "@vestra-player/sdk"!Storage.json | plugin.storage.json}, shows it with `bind`, and reopens the window during activation.

## Steps

### Declare the capabilities

Add `ui.window` to the manifest's `capabilities`, plus whatever the window's controls do (`playback.control` to seek, `processing.video` for a video filter).

### Write the window in Slint

Create a `.slint` file under `ui/` whose exported component inherits `Window`. Declare an `in` property for each value the plugin writes, an `in-out` property for a value both the plugin and a control change (a slider), and a `callback` for each thing the user does. Take colours, sizes and widgets from the player:

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

For your editor, point the Slint language server's library path `vestra` at `node_modules/@vestra-player/sdk/slint/vestra`.

### Create, bind and open it

Create the window once in `activate`, bind its properties, handle its callbacks, and show it from a command:

```ts
const helloWindow = plugin.windows.create("ui/hello.slint");
helloWindow.bind(() => ({
  message: plugin.player.state.source ?? "Nothing is playing",
  canSeek: plugin.player.state.can.seek,
}));
helloWindow.on("jump", (delta: number) =>
  plugin.player.seek(Math.max(0, (plugin.player.state.position ?? 0) + delta)),
);
plugin.commands.add({
  id: "hello",
  path: ["Tools", "Hello…"],
  run: () => helloWindow.show(),
});
```

`canSeek` reaches the Slint property `can-seek`. Bind callbacks with `on` before the window is first shown. Because the window is bound before it opens, it shows current values at once, without flashing defaults.

### Load the stored state

At the start of `activate`, create the store with `plugin.storage.json(name, { defaults, validate })`, holding the window's values and an `open` flag. Always pass `validate`: the file is outside your control, and a file that fails it is set aside and `defaults` is used.

### Bind to the stored value and save every change

Bind the window to `store.value`, not a copy of it. In each callback that changes a value, call `store.save({ ...store.value, … })`. Do not debounce it yourself (the file is written 300 ms after the last call, and flushed when the plugin stops), and do not change `store.value` in place.

### Record whether the window is open, and reopen it

Save `open: true` when your command shows the window, and `open: false` in `onClose`, which runs only when the user closes the window. When the player quits, the window closes without `onClose`, so `open` stays `true`. At the end of `activate`, after creating and binding the window, show it if `store.value.open` is true; if that fails, save `open: false` instead of failing activation.

## Complete example

A **Brightness** window under **Video ▸ Brightness…**: a slider from −1 to 1, a value label and a Reset button. It remembers the brightness and whether it was open. The manifest's `capabilities` are `commands`, `ui.window`, `processing.video`, `playback.read` and `events`.

`ui/brightness.slint`:

```slint
import { Theme } from "@vestra/theme.slint";
import { Button, Slider } from "@vestra/widgets.slint";

export component BrightnessWindow inherits Window {
    title: "Brightness";
    width: 300px;
    background: Theme.bg-panel;

    in-out property <float> brightness; // the plugin and the slider write it
    in property <string> label;
    callback brightness-changed(float);
    callback reset();

    HorizontalLayout {
        padding: Theme.dialog-padding;
        spacing: 8px;
        Slider {
            minimum: -1; maximum: 1;
            value <=> root.brightness;
            changed(value) => { root.brightness-changed(value); }
        }
        Text {
            width: 36px; text: root.label; color: Theme.text; font-size: Theme.font-body;
            horizontal-alignment: right; vertical-alignment: center;
        }
        Button { text: "Reset"; small: true; clicked => { root.reset(); } }
    }
}
```

`main.ts`:

```ts
import type { Plugin } from "@vestra-player/sdk";

/** Everything the plugin remembers, in <dataDirectory>/brightness.json. */
interface Saved {
  /** −1–1, 0 = unchanged. */
  brightness: number;
  /** The window was open when the player quit. */
  open: boolean;
}

const DEFAULTS: Saved = { brightness: 0, open: false };

/** A missing, broken or outdated file falls back to DEFAULTS. */
function isSaved(value: unknown): value is Saved {
  const v = value as Partial<Saved> | null;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof v.brightness === "number" &&
    Math.abs(v.brightness) <= 1 &&
    typeof v.open === "boolean"
  );
}

export default async function activate(plugin: Plugin) {
  // Load: read once, synchronously; defaults if there is no valid file.
  const store = plugin.storage.json<Saved>("brightness", {
    defaults: DEFAULTS,
    validate: isSaved,
  });
  const remember = (patch: Partial<Saved>) =>
    store.save({ ...store.value, ...patch });

  const filter = plugin.video.filter("brightness");
  const apply = () =>
    filter.set([
      {
        kind: "eq",
        brightness: store.value.brightness,
        contrast: 1,
        saturation: 1,
        gamma: 1,
      },
    ]);
  apply(); // the effect is back before the window is

  // Show: the window always displays the stored state.
  const brightnessWindow = plugin.windows.create("ui/brightness.slint");
  brightnessWindow.bind(() => ({
    brightness: store.value.brightness,
    label: store.value.brightness.toFixed(2),
  }));
  brightnessWindow.on("brightnessChanged", (value: number) => {
    remember({ brightness: Math.min(1, Math.max(-1, value)) });
    apply();
  });
  brightnessWindow.on("reset", () => {
    remember({ brightness: 0 });
    apply();
  });

  // Track whether it is open: only the user closing it counts as "closed".
  brightnessWindow.onClose(() => remember({ open: false }));
  const open = async () => {
    await brightnessWindow.show();
    remember({ open: true });
  };
  plugin.commands.add({
    id: "brightness",
    path: ["@video", "Brightness…"],
    run: open,
  });

  // Restore: reopen it if it was open when the player quit.
  if (store.value.open) await open().catch(() => remember({ open: false }));
}
```

## What is not restored

- **Position and size.** The operating system places a tool window when it opens, and the API cannot read or set its frame; the size comes from the Slint file (`width`, `preferred-width`).
- **State only Slint knows.** Text in a field, a scroll position or a selected tab survives only if a callback reports it, the plugin stores it, and a property writes it back, as `brightness` does here.
- **Several windows from one file** (`windows.create(file, { id })`): store an object keyed by window id and restore each one. Large or binary data goes in your own files in {@link "@vestra-player/sdk"!Plugin.dataDirectory | plugin.dataDirectory}.

## See also

- [Keep a slider responsive while dragging](./slider.md): the same window, tuned for fast drags.
- [Add settings and translations](./i18n.md): preferences belong on a settings page.
- [Design rules](./design-rules.md): how a tool window should look.
- [Theme](../reference/theme.md): every token, icon and widget.
- {@link "@vestra-player/sdk"!Window | Window}, {@link "@vestra-player/sdk"!JsonStore | JsonStore}, {@link "@vestra-player/sdk"!Window.onClose | Window.onClose}
