---
title: Control playback
description: Open files, pause, seek and change speed from a plugin without fighting the user or other plugins over the player's one source.
---

# Control playback

**Goal:** your plugin opens files and controls playback (pause, seek, speed, next and previous), shows what is playing, and never acts on a file the user has already left.

The player has one source. The user, other plugins and yours all change it, so every control in `plugin.player` is **conditional**: it acts on the state your plugin last saw and fails with `stale` (doing nothing) when someone else changed the source in between. Most of this guide is about using that well.

## Steps

### Capabilities

```json
{
  "capabilities": ["commands", "playback.read", "playback.control", "events"]
}
```

`playback.read` reads the state, `playback.control` changes it, `events` keeps `player.state` current when the change comes from elsewhere (without it, the state only moves after your own calls and `refresh()`), and `commands` gives your actions menu items and keys.

### Read the state

`plugin.player.state` is a snapshot the SDK keeps current from the player's events. `onChange` runs after it changed; read the new snapshot there instead of asking the player.

```ts
const info = plugin.osd.panel();
plugin.player.onChange((state) => {
  // `position` and `duration` are seconds, null while unknown.
  if (state.phase !== "ready") return info.set(null);
  info.set("{} / {} s", [state.position?.toFixed(0) ?? "–", state.duration?.toFixed(0) ?? "–"]);
});
```

`state.can` says which controls the current source allows (`pause`, `seek`, `rate`, `restart`, `close`, `next`, `previous`). Bind menu items to it so they grey out by themselves:

```ts
plugin.commands.add({
  id: "pause",
  path: ["@playback", "Pause"],
  enabled: () => plugin.player.state.can.pause, // re-evaluated after every change
  checked: () => plugin.player.state.paused,
  run: () => plugin.player.setPaused(!plugin.player.state.paused),
});
```

### Control it, and handle `stale`

A control without options is conditional on `player.state` as it is when you call. `stale` means the source changed after that: another file, a close, or any pause, seek or speed change by the user or another plugin. Nothing happened, and usually that is the right outcome:

```ts
try {
  await plugin.player.seek(30);
} catch (error) {
  if ((error as PluginError).code !== "stale") throw error; // another file now
}
```

For work that takes time (a timer, a dialog, a network request), keep the snapshot from when it started and pass it as `ifCurrent`, so the call applies only to that source:

```ts
const seen = plugin.player.state;
const answer = await plugin.dialogs.confirm({ message: "Close this file?", confirm: "Close" }); // ui.dialog
if (answer.confirmed)
  await plugin.player.close({ ifCurrent: seen }).catch((error: PluginError) => {
    if (error.code !== "stale") throw error; // the user opened something else meanwhile
  });
```

`player.isCurrent(seen)` answers the same question without a call. Your own consecutive calls do not make each other stale: the SDK refreshes the state after each one.

Other codes: `invalid` for a value out of range (a negative seek, a speed outside 0.05–10) or a control while nothing is open, `unsupported` for something the source cannot do (a loop on a source that cannot seek).

### Open a file and follow it

`open` resolves once the player accepted the load (for an address a resolver plugin handles, once the resolver has answered) and returns a `Media` handle for that source. `ready()` waits until it plays; `onEnd` fires when it ends on its own.

```ts
const media = await plugin.player.open("/Movies/clip.mp4");
try {
  await media.ready({ signal: AbortSignal.timeout(10_000) }); // closes it on timeout
} catch (error) {
  await plugin.osd.show("Cannot play: {}", [(error as Error).message]);
}
media.onEnd((ended) =>
  // Play on only if nobody opened something else at the end.
  plugin.player.open("/Movies/next.mp4", { ifCurrent: ended }).catch(() => {}),
);
```

`ready()` rejects with `failed` (the file cannot be loaded), `replaced` (another source took over) or `ended`. Disposing your scope does not close the media: playback belongs to the user, so call `media.close()` when you mean it.

### Behave exactly like the player's own keys

For buttons in your own bar or window, prefer the player's core actions to calling the controls yourself. `plugin.host.run` (capability `commands`) runs them with the player's checks, accumulation of repeated presses and on-screen text:

```ts
declare const bar: Panel;
// ---cut---
bar.on("playPause", () => plugin.host.run("play-pause"));
bar.on("forward30", () => plugin.host.run("seek-forward", { seconds: 30 })); // adds up with →
```

`run` rejects with `unavailable` while the action is disabled, for example with nothing open.

### Next and previous

The player's Next and Previous items, keys and buttons ask the **sequence provider**, one plugin at a time, first come first served. The built-in playlist registers as provider when it starts and a built-in plugin cannot be disabled, so in practice another plugin's `provideSequence` is refused (`sequence-taken`); only a development load that replaces the playlist under its id gets it. Any plugin can ask the provider with `player.next()` and `player.previous()`:

```ts
declare const items: string[];
let index = 0;
// ---cut---
const playAt = async (at: number) => {
  index = at;
  await plugin.player.open(items[at]!);
};
plugin.player.provideSequence({
  next: () => playAt(index + 1),
  previous: () => playAt(index - 1),
  canNext: () => index + 1 < items.length, // shown as state.can.next
  canPrevious: () => index > 0,
});
```

A second provider is refused with `conflict` (`sequence-taken`). During activation that does not fail the plugin: it runs without Next and Previous and the player shows a warning; a refusal after activation goes to `onError`.

### Sliders, loops and the output

- A seek slider: start a `player.scrub()` gesture on press and `end()` it on release; see [Keep a slider responsive while dragging](slider.md).
- An A-B loop: `setLoop({ a, b, count })`; `null` stops it, a new source clears it.
- Volume and mute: `setOutput({ volume, muted })` (volume 0–200). The newest write wins; the promise resolves `false` when a newer one replaced it.
- Your own step size for ← and →: `setStepSeek({ seconds, keyframes })`, withdrawn when your plugin stops.

## Complete example

A plugin that shows the position on the OSD, offers a Pause item that greys out by itself, and a "Back to the Start" item that does nothing when the user changed the source meanwhile (`commands`, `ui.osd`, `playback.read`, `playback.control`, `events`):

```ts
import type { Plugin, PluginError } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  // A live line on the OSD while something plays.
  const info = plugin.osd.panel();
  plugin.player.onChange((state) => {
    if (state.phase !== "ready") return info.set(null);
    info.set("{} / {} s", [state.position?.toFixed(0) ?? "–", state.duration?.toFixed(0) ?? "–"]);
  });

  plugin.commands.add({
    id: "pause",
    path: ["@playback", "Pause"],
    enabled: () => plugin.player.state.can.pause, // re-evaluated after every change
    checked: () => plugin.player.state.paused,
    run: () => plugin.player.setPaused(!plugin.player.state.paused),
  });

  plugin.commands.add({
    id: "start",
    path: ["@playback", "Back to the Start"],
    enabled: () => plugin.player.state.can.seek,
    run: async () => {
      try {
        await plugin.player.seek(0);
      } catch (error) {
        if ((error as PluginError).code !== "stale") throw error; // another file now
      }
    },
  });
}
```

## See also

- [Playback state, controls and sources](../explanation/playback.md): phases, sources, resolvers and streams.
- The API reference: `Player`, `Media`, `Scrub`, `Conditional`, `Host`.
