---
title: Keep a slider responsive while dragging
description: Make a slider that drives a filter, the volume or a preview follow the pointer without lagging or queueing requests.
---

# Keep a slider responsive while dragging

**Goal:** a slider in your window drives something live (a video filter, the volume, a preview), the effect follows the pointer while the user drags, and nothing lags behind or queues up.

A slider reports every pointer movement, often more than 60 times a second. Each report is a callback in your plugin. The plugin stays responsive if every callback only **records the newest value and hands it to something that keeps only the newest value**. It stutters when every callback starts its own slow request and the requests queue up behind each other.

## Steps

### Bind the slider two-way to an `in-out` property

In the Slint file, declare the value `in-out` and bind the slider's value with `<=>`, and report moves and the release through two callbacks:

```slint
in-out property <float> brightness;
callback brightness-changed(float);  // every pointer move
callback brightness-released(float); // once, when the button is released
Slider {
    value <=> root.brightness;       // two-way: never `value: root.brightness`
    changed(value) => { root.brightness-changed(value); }
    released(value) => { root.brightness-released(value); }
}
```

### Record the newest value, without awaiting

In the `changed` callback, store the value in your model and return; do not `await` anything there. Do one-off work (the on-screen message, saving, logging) in the `released` callback instead, which fires once per drag.

### Hand it to a call that keeps only the newest value

Pass the value on with a call that has latest-value semantics, such as `filter.set()`, `player.setOutput()` or `Scrub.seek`. Do not call one-request-per-call methods (`player.seek`, `player.setRate`, `osd.show`) on every move: use `player.scrub()` for a seek slider.

### Bind the derived values instead of setting them

Send the slider's value and its label with `window.bind(() => …)`, not `set`, so an unchanged value is never written back under the user's pointer; a Reset that changes the model still moves the thumb.

### Give your own slow work latest-value behaviour

If a move triggers your own asynchronous work (a preview rendered with `plugin.tools.run`, a network request), run it through a helper that keeps one run at a time and only the newest value, and call `plugin.update()` when a result arrives after an `await`:

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


## Complete example

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
    void plugin.osd.show("Brightness {}", [brightness.toFixed(2)]); // once per drag
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

## How it works

A slider reports every pointer move, and the SDK runs each callback as soon as it arrives. The callback only records the value and returns, so callbacks never queue. `filter.set()` keeps one request in flight and replaces waiting values with newer ones, so a fast drag costs one request per round trip to the player, not one per move, and the video ends exactly where the slider stopped. `bind` sends a value only when it differs from the last one sent, and the player skips a write the slider already shows, so the plugin never fights the pointer. A one-way binding in Slint (`value: root.brightness`) is broken the first time the user drags, after which Reset no longer moves the thumb. Work you start yourself has no such semantics: overlapping runs can finish out of order and leave an older result on screen, and a value changed after an `await` shows only when the handler ends unless you call `plugin.update()` ([set, bind and the update pass](../explanation/ui.md#set-bind-and-the-update-pass)).

## See also

- Calls that keep only the newest value (safe on every move): {@link "@vestra-player/sdk"!VideoFilter | VideoFilter}`.set`, {@link "@vestra-player/sdk"!AudioFilter | AudioFilter}`.set`, {@link "@vestra-player/sdk"!Player.setOutput | Player.setOutput}, `Scrub.seek` (about one seek per display frame), view properties (`bind`, `set`), {@link "@vestra-player/sdk"!OsdPanel.set | OsdPanel.set}, and `JsonStore.save` (debounced, 300 ms). One request per call (not on every move): {@link "@vestra-player/sdk"!Player.seek | Player.seek} (use {@link "@vestra-player/sdk"!Player.scrub | Player.scrub}), `player.setRate` and the other player controls, {@link "@vestra-player/sdk"!Osd.show | Osd.show}.

- [Windows, panels, settings pages, dialogs and the OSD](../explanation/ui.md): set, bind and the update pass.
- The [blur example](../examples/blur.md) (a strength slider on a video filter).
- {@link "@vestra-player/sdk"!View | View}, {@link "@vestra-player/sdk"!Scope.update | Scope.update}, {@link "@vestra-player/sdk"!Player.scrub | Player.scrub}
