---
title: Remember a window's state between runs
---

# Remember a window's state between runs

**Goal:** a tool window comes back the way the user left it: its controls hold the last values, and if it was open when the player quit, it opens again at the next start.

A tool window keeps nothing by itself: closing it destroys the window instance, and the plugin process ends with the player. Keep the state in your plugin, store it with {@link "@vestra-player/sdk"!Storage.json | plugin.storage.json}, show it with `bind`, and reopen the window during activation.

## The complete example

The **Brightness** window from [Keep a slider responsive while dragging](slider.md), now remembering the brightness and whether the window was open. The manifest is the same as there, without `ui.osd`:

```json
{
  "id": "examples.brightness",
  "version": "1.0.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "minPlayerVersion": "0.3.0",
  "capabilities": ["commands", "ui.window", "processing.video", "playback.read", "events"]
}
```

`ui/brightness.slint` is unchanged: it declares `in-out property <float> brightness`, `in property <string> label` and the callbacks `brightness-changed(float)`, `brightness-released(float)` and `reset()` (the full file is on the [slider page](slider.md)).

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
  // 1. Load: read once, synchronously; defaults if there is no valid file.
  const store = plugin.storage.json<Saved>("brightness", {
    defaults: DEFAULTS,
    validate: isSaved,
  });
  /** Change part of the state; the file is written 300 ms after the last change. */
  const remember = (patch: Partial<Saved>) =>
    store.save({ ...store.value, ...patch });

  const filter = plugin.video.filter("brightness");
  const apply = () =>
    filter.set([
      { kind: "eq", brightness: store.value.brightness, contrast: 1, saturation: 1, gamma: 1 },
    ]);
  apply(); // the effect is back before the window is

  // 2. Show: the window always displays the stored state.
  const window = plugin.windows.create("ui/brightness.slint");
  window.bind(() => ({
    brightness: store.value.brightness,
    label: store.value.brightness.toFixed(2),
  }));
  window.on("brightnessChanged", (value: number) => {
    remember({ brightness: Math.min(1, Math.max(-1, value)) });
    apply();
  });
  window.on("reset", () => {
    remember({ brightness: 0 });
    apply();
  });

  // 3. Track whether it is open: only the user closing it counts as "closed".
  window.onClose(() => remember({ open: false }));
  const open = async () => {
    await window.show();
    remember({ open: true });
  };
  plugin.commands.add({
    id: "brightness",
    path: ["@video", "Brightness…"],
    run: open,
  });

  // 4. Restore: reopen it if it was open when the player quit.
  if (store.value.open) await open().catch(() => remember({ open: false }));
}
```

## How it works

- **Load once, at activation.** `storage.json` reads `<dataDirectory>/brightness.json` synchronously when it is created. A file that cannot be parsed or fails `validate` is renamed to `brightness.json.bad-<timestamp>` and `defaults` is used, so a damaged or older file never breaks the plugin. Always pass a `validate` function: the file is outside your control.
- **Bind the stored value, not a copy.** `window.bind` reads `store.value` in every update pass, so whatever changes the state (a callback, Reset, a command) updates the window, and a window opened later starts with the current values.
- **Save on every change; the store debounces.** `save()` replaces `store.value` at once and writes the file 300 ms after the last call (a temporary file, then a rename). Dragging the slider writes the file once, after the drag. When the plugin stops (the player quits, the user disables the plugin), the store is flushed, so the last value is not lost.
- **"Open" means "the user did not close it".** `onClose` runs only when the user closes the window (title-bar button, ⌘W, Ctrl+W, Ctrl+F4). When the player quits, the plugin stops and its windows close *without* `onClose`, so `open` stays `true` and the window comes back next time. That is the behaviour users expect from an application's tool windows.
- **Restore after binding.** The window is created and bound before `open()` runs, so it opens with the stored values and without flashing defaults. If it cannot open (for example in a player without a user interface), the plugin forgets that it was open instead of failing activation.

## What you cannot restore

- **Position and size.** The operating system places a tool window when it opens. The player does not remember tool window frames, and the API has no way to read or set them; the window's size comes from its Slint file (`width`, `preferred-width` and so on).
- **State that only Slint knows.** Text in a field, a scroll position or a selected tab survives only if a callback reports it to the plugin and the plugin stores it and writes it back as a property, as `brightness` does here.

## Variations

- **Several windows from one file** (one per document, created with `windows.create(file, { id })`): store an object keyed by the window id and restore each one.
- **Preferences rather than state:** a choice such as "reopen my windows at startup" belongs on a settings page ({@link "@vestra-player/sdk"!Settings.page | plugin.settings.page}) that reads and writes the same store (the `SettingsPage` reference has an example).
- **Large or binary data:** write your own files in {@link "@vestra-player/sdk"!Plugin.dataDirectory | plugin.dataDirectory} (to a temporary name, then rename) and keep only small settings in `storage.json`.

## See also

- [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md): the tool window life cycle.
- {@link "@vestra-player/sdk"!Storage | Storage}, {@link "@vestra-player/sdk"!JsonStore | JsonStore}, {@link "@vestra-player/sdk"!Window.onClose | Window.onClose}
