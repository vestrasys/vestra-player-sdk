---
title: Learn what happens in the player without staying up
description: Learn of an opened file, a fullscreen flip, a time or a position from events and triggers so an idle plugin can stop, and follow the state with a stream only while it shows.
---

# Learn what happens in the player without staying up

**Goal:** your plugin learns that a file opened, that playback went fullscreen, that a time came or that the position reached a range, and acts on it, while the player is free to stop the plugin whenever it is idle and start it again for the moment it is needed. Something that shows the state continuously follows it only while it is shown.

The player stops a plugin that holds nothing after a while without use (standby) and starts it again when one of its entry points is used ([How a plugin works](how-plugins-work.md#what-keeps-a-plugin-running)). Events and triggers are entry points too: the player keeps what the plugin asked for and wakes it when it comes. A listener of a frequent state (a stream) is not: the plugin must run to hear it.

## Steps

### Choose how to learn the state

| Way | Answers | Keeps the plugin running | Use for |
| --- | --- | --- | --- |
| Read once: `await player.read()` at start, `await player.refresh()` later | What is the state now | no | A value a handler needs at the moment it runs |
| An event: `player.on("source.ready", fn)` | What just happened, once, with its data | no: the player wakes the plugin for it | A file opened, became ready, ended; the video's size, the audio tracks, the subtitles, the window, the layout, the audio devices changed; the player started |
| A trigger: `plugin.trigger().firesOn(condition)` | When does the state become like this, and when does it stop | no: the player evaluates it and wakes the plugin at each flip | Playing in fullscreen; a time of day; the position inside a range |
| A `when` condition on a command's `enabled` or `checked` | Is the state like this now | no: the player evaluates it, also in standby | Menu items that follow playback ([Command state](command-state.md)) |
| A stream: `player.stream(fn)` | Every change, about ten a second while playing | yes, while it is open | A window or panel that shows the position, the speed or the volume |

Start from the top of the table; take the stream only for a display, and only while it shows.

### Hear an event

```ts
plugin.player.on("source.ready", async ({ state }) => {
  if (state.duration !== null && state.duration > 3600)
    await plugin.osd.show("A long one: {} min", [Math.round(state.duration / 60)]);
});
```

Each event is sent once per change, never as a stream: `window.changed` once when a resize ends, `audio.tracks.changed` once when the list changes. Where the SDK keeps a copy of the state the event carries (`plugin.window.state`, `plugin.subtitles.state`, the panel layout, `plugin.player.state.audioTracks` and `audioOutput`), the copy holds the new value when the listener runs. Every event and its data are in [Events](../reference/events.md).

### Hand the player a condition

A trigger is a condition the player keeps and evaluates, with the functions to run when it turns true (`enter`) and false (`leave`). Declare triggers in the synchronous part of `activate`, before its first `await`: when the player wakes the plugin for a flip, `activate` runs again and the notification goes to the trigger declared at the same place.

```ts
import type { Plugin } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  const { when, window } = plugin;
  plugin
    .trigger()
    .firesOn(when.playing.and(when.fullscreen))
    .enter(() => window.setAlwaysOnTop(true))
    .leave(() => window.setAlwaysOnTop(false));
}
```

The player starts the plugin when playback goes fullscreen, the plugin sets the window on top, and after its idle time it is stopped again; the on-top setting stays in the player. The next flip (a pause, leaving fullscreen) starts it once more for `leave`. Handing over the same condition again at every start changes nothing, and a condition already true when it is handed over is entered at once, so nothing is lost between reading the state and asking.

### Give a condition later, and name it

A condition the plugin learns only later (the user picked a time, a scan found something) is handed over from a handler. Give such a trigger a name, so that its condition survives an update of the plugin; an unnamed trigger is known by its place among the unnamed ones, which an update may change, so its condition is cleared then.

```ts
import type { Plugin } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  const { when, player, commands } = plugin;
  const alarm = plugin.trigger("sleep").enter(async () => {
    alarm.off(); // one shot: no condition until the next click
    await player.setPaused(true);
  });
  commands.add({
    id: "in45",
    path: ["Tools", "Sleep in 45 Minutes"],
    run: () => alarm.firesOn(when.time({ min: Date.now() + 45 * 60_000 })),
  });
}
```

No timer runs in the plugin: the player compares the clock with the bound and starts the plugin at 45 minutes. A condition stays through standby, a crash and a restart of the player; one that is true when the player starts fires then, so when a late firing is unwanted, bound the time on both sides (`{ min: due, max: due + 60_000 }`) or keep `due` in the plugin's storage and return early.

### Act at positions

`when.position.in(ranges, { lead })` is true while the position is in one of the ranges, or less than `lead` media seconds before one; `enter` gets the matched range. The list belongs to the file that is open when the player receives it, and stops matching when another file opens.

```ts
declare function scan(state: PlayerState): Promise<{ start: number; end: number }[]>;
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
// ---cut---
const { player, when } = plugin;
const silence = plugin.trigger().enter(async ({ range }) => {
  if (!range) return;
  const now = await player.refresh(); // the plugin may have just been started
  await sleep((((range.start - (now.position ?? 0)) / now.rate) * 1000));
  await player.seek(range.end ?? range.start, { ifCurrent: now }).catch(() => {}); // stale: the user acted
});
player.on("source.ready", async ({ state }) => {
  const spans = await scan(state); // seconds: the plugin's own analysis
  if (!player.isCurrent(state)) return; // another file opened meanwhile
  silence.firesOn(when.playing.and(when.position.in(spans, { lead: 2 })));
});
```

The lead covers the time the player needs to start the plugin; `ifCurrent` makes the seek do nothing when the user paused, sought or changed the speed meanwhile, so a late wake misses a skip but never makes a wrong one. To draw the same ranges on the seek bar, give them to a timeline layer too (`plugin.timeline.layer().setRanges`); the player keeps the layer through standby.

### Follow the state while something shows it

The position, the pause, the speed and the volume have no event. A command's `enabled` and `checked` follow them with `when` (`when.paused`, `when.rate({ min, max })`, `when.volume(…)`, `when.muted`); a trigger flips on them; a handler reads them once with `refresh()`. Something that shows them continuously opens a stream when it appears and stops it when it goes:

```ts
import type { Plugin, StateStream } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  const { player, commands } = plugin;
  const view = plugin.windows.create("ui/left.slint");
  let feed: StateStream | undefined;
  view.onClose(() => feed?.stop()); // closed: nothing keeps the plugin running
  commands.add({
    id: "left",
    path: ["Tools", "Time Left"],
    run: async () => {
      await view.show();
      feed?.stop(); // one stream per window, also when shown again
      feed = player.stream((s) =>
        view.set({ text: `${Math.round((s.duration ?? 0) - (s.position ?? 0))} s` }),
      );
    },
  });
}
```

`fn` gets the state at once and then every change; before each call `player.state` is updated and after it an update pass runs, so bindings that read `player.state` follow while the stream is open. For a panel, open the stream when `panel.state.effective` turns true and stop it when it turns false; a tab hears that from `layout.changed`, which keeps no plugin running ([Example: Adjust panel](../examples/adjust-panel.md)).

Never open a stream in `activate`: the player judges what keeps a plugin running when it becomes ready, and a stream open then keeps it running for the whole run, also after it stops.

### Test it

{@link "@vestra-player/sdk/testing"!TestHost | TestHost} keeps and evaluates trigger conditions as the player does, with a clock of its own:

```ts
import assert from "node:assert/strict";
declare const host: TestHost;
// ---cut---
await host.settle(); // after activate: its listeners and triggers are in place
assert.deepEqual(host.keepsRunning, []); // nothing stops the player parking it
host.setSource({ phase: "ready", duration: 60, position: 0 });
await host.advance(8_000); // 8 s of clock and of playback: enter and leave run on the way
await host.park(); // standby; the conditions and wake events stay
assert.equal(host.triggers.length, 1);
```

Call `host.settle()` after the plugin adds a listener or a trigger and before the action it should hear: the subscription is a request like any other. `host.upgrade()` replaces the plugin with a new version and clears the unnamed conditions ([Reference: test host](../reference/testing.md)).

## See also

- [How a plugin works](how-plugins-work.md#what-keeps-a-plugin-running): what stays while a plugin is stopped, and what keeps it running.
- [Keep a command's state without keeping the plugin running](command-state.md): the `when` language.
- [Events](../reference/events.md), [Limits](../reference/limits.md): every event and the trigger limits.
- {@link "@vestra-player/sdk"!Plugin.trigger | Plugin.trigger}, {@link "@vestra-player/sdk"!Trigger | Trigger}, {@link "@vestra-player/sdk"!Player.on | Player.on} and {@link "@vestra-player/sdk"!Player.stream | Player.stream} in the API reference.
