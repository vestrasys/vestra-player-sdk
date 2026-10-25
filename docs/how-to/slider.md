---
title: Keep a slider responsive while dragging
description: Make a slider that drives a filter, the volume or a preview follow the pointer without lagging or queueing requests.
---

# Keep a slider responsive while dragging

**Goal:** a slider in your window drives something live (a video filter, the volume, a preview), the effect follows the pointer while the user drags, and nothing lags behind or queues up.

A slider reports every pointer movement, often more than 60 times a second. Each report is a callback in your plugin. The plugin stays responsive if every callback only **records the newest value and hands it to something that keeps only the newest value**. It stutters when every callback starts its own slow request and the requests queue up behind each other.

## The complete example

A **Brightness** window with a slider from −1 to 1, a value label and a Reset button. The video follows the slider while it moves; an on-screen message reports the value when the user lets go.

`manifest.json`:

```json
{
  "id": "examples.brightness",
  "version": "1.0.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "minPlayerVersion": "0.3.0",
  "capabilities": [
    "commands",
    "ui.window",
    "ui.osd",
    "processing.video",
    "playback.read",
    "events"
  ]
}
```

`ui/brightness.slint`:

```slint
import { Theme } from "@vestra/theme.slint";
import { Button, Slider } from "@vestra/widgets.slint";

export component BrightnessWindow inherits Window {
    title: "Brightness";
    width: 300px;
    background: Theme.bg-panel;

    // Written by the plugin and by the slider: in-out, bound two-way below.
    in-out property <float> brightness;
    in property <string> label;
    callback brightness-changed(float); // every pointer move
    callback brightness-released(float); // once, when the button is released
    callback reset();

    HorizontalLayout {
        padding: Theme.dialog-padding;
        spacing: 8px;
        Slider {
            minimum: -1;
            maximum: 1;
            value <=> root.brightness;
            changed(value) => { root.brightness-changed(value); }
            released(value) => { root.brightness-released(value); }
        }
        Text {
            width: 36px;
            text: root.label;
            color: Theme.text;
            font-size: Theme.font-body;
            horizontal-alignment: right;
            vertical-alignment: center;
        }
        Button {
            text: "Reset";
            small: true;
            clicked => { root.reset(); }
        }
    }
}
```

`main.ts`:

```ts
import type { Plugin } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  let brightness = 0; // the model: −1–1, 0 = unchanged

  // A filter keeps one request in flight and sends only the newest value.
  const filter = plugin.video.filter("brightness");
  const apply = () =>
    filter.set([
      { kind: "eq", brightness, contrast: 1, saturation: 1, gamma: 1 },
    ]);

  const window = plugin.windows.create("ui/brightness.slint");
  // Derived from the model: sent only when it changes.
  window.bind(() => ({ brightness, label: brightness.toFixed(2) }));

  window.on("brightnessChanged", (value: number) => {
    brightness = Math.min(1, Math.max(-1, value)); // record the newest value…
    apply(); // …and hand it on; no await
  });
  window.on("brightnessReleased", () => {
    void plugin.osd.show(`Brightness ${brightness.toFixed(2)}`); // once per drag
  });
  window.on("reset", () => {
    brightness = 0; // the bound value moves the slider back
    apply();
  });

  plugin.commands.add({
    id: "brightness",
    path: ["@video", "Brightness…"],
    run: () => window.show(),
  });
}
```

## Why this stays smooth

1. **The callback does not wait.** `brightnessChanged` updates a variable and calls `filter.set()`, which returns at once. The SDK runs the next callback as soon as it arrives.
2. **The expensive part keeps only the newest value.** `filter.set()` has _latest-value_ semantics: while one request is in flight, newer values replace each other and only the last one is sent. A fast drag costs a request per round trip to the player, not one per pointer move, and the video ends exactly where the slider stopped.
3. **The slider's value is bound, not set.** `bind` sends `brightness` only when it differs from what was sent last, and the player skips a write that equals what the slider already shows. So the plugin never fights the user's pointer, yet Reset (which changes the model) moves the thumb.
4. **Work that should happen once happens on release.** The on-screen message (and anything like saving or logging) waits for `brightnessReleased`, which fires once per drag.

The Slint side needs two things: an `in-out` property and a two-way binding (`value <=> root.brightness`). With a one-way binding (`value: root.brightness`) Slint breaks the binding the first time the user drags, and Reset stops moving the thumb.

## Which calls keep only the newest value

| Latest value wins (safe on every move)                                                                                 | One request per call (do not call on every move)                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| {@link "@vestra-player/sdk"!VideoFilter VideoFilter}`.set`, {@link "@vestra-player/sdk"!AudioFilter AudioFilter}`.set` | {@link "@vestra-player/sdk"!Player.seek player.seek}: use {@link "@vestra-player/sdk"!Player.scrub player.scrub()} and `Scrub.seek` for a seek slider |
| {@link "@vestra-player/sdk"!Player.setOutput player.setOutput} (volume, mute)                                          | `player.setRate` and other player controls                                                                                                            |
| `Scrub.seek` (about one seek per display frame)                                                                        | {@link "@vestra-player/sdk"!Osd.show osd.show}: show a message on release                                                                             |
| View properties (`bind`, `set`), {@link "@vestra-player/sdk"!OsdPanel.set OsdPanel.set}                                | `JsonStore.save` is debounced (300 ms), so it is fine; anything you write yourself is not                                                             |

## When the slow part is your own code

If a move triggers your own asynchronous work (rendering a preview with `plugin.tools.run`, a network request), do not `await` it per callback: the SDK starts every callback without waiting for the previous one, so slow runs overlap and can finish out of order, leaving an _older_ result on screen. Give that work latest-value semantics yourself:

```ts
import type { Plugin } from "@vestra-player/sdk";

/** Run `work` for the newest value only: one run at a time; values that arrive meanwhile replace each other. */
export function latest<T>(work: (value: T) => Promise<void>) {
  let running = false;
  let next: { value: T } | undefined;
  return async (value: T) => {
    next = { value };
    if (running) return; // the running loop picks it up
    running = true;
    try {
      while (next) {
        const current = next.value;
        next = undefined;
        await work(current);
      }
    } finally {
      running = false;
    }
  };
}

declare function renderPreview(strength: number): Promise<string>; // your own slow work

export default async function activate(plugin: Plugin) {
  let preview = "";
  const window = plugin.windows.create("ui/preview.slint");
  window.bind(() => ({ preview }));
  const refresh = latest(async (strength: number) => {
    preview = await renderPreview(strength);
    plugin.update(); // changed after an await: send it now
  });
  window.on("strengthChanged", (strength: number) => refresh(strength));
}
```

`plugin.update()` matters here. The SDK re-evaluates bound properties after a callback returns and again when its promise settles; a value you change **after an `await`** inside a longer task is otherwise shown only when that task ends. Call `plugin.update()` whenever such a task has something new to show.

## See also

- [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md): set, bind and the update pass.
- The [blur example](../examples/blur.md) (a strength slider on a video filter).
- {@link "@vestra-player/sdk"!View | View}, {@link "@vestra-player/sdk"!Scope.update | Scope.update}, {@link "@vestra-player/sdk"!Player.scrub | Player.scrub}
