---
title: Three ways to write a plugin
description: The three plugin styles (bind, player.on with set, plugin.wire) on four scenarios side by side, what each one sends and when to choose which.
---

# Three ways to write a plugin

The SDK lets a plugin talk to the player at three levels, and the same plugin can be written at each of them. This page shows four everyday jobs written three times, says what happens on the way from the plugin to the screen in each style, and when each style is the better choice. It builds on [How a plugin runs](plugins.md), above all on [the update pass](plugins.md#the-update-pass).

Every code block comes from the example plugin [`examples/three-ways`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/three-ways): one file per style (`style-a.ts`, `style-b.ts`, `style-c.ts`), the same four scenarios in each, and tests that run all of them against the test host.

## The three styles

| | A: declare (`bind`) | B: subscribe and write (`player.on`, `set`) | C: direct messages (`plugin.wire`) |
| --- | --- | --- | --- |
| The plugin writes | what a view or command shows, as a function of state | a listener per event that writes values | requests and property writes by the player's names |
| Who decides when to send | the SDK's update passes | the plugin | the plugin |
| The SDK compares with what it sent | yes, and turns list changes into row patches | no: each `set` is sent whole | no |
| Layer | framework (L2) | primitives (L1) | protocol (L0) |
| Stability | semver | semver | changes with versions |

The layers are how the SDK itself is built. The **protocol** is the JSON messages of [the wire protocol](host-and-node.md#the-wire-protocol). The **primitives** are the members that do one thing each: a view's `set`, a command's registration, one event listener, `openStream`, storage, dialogs. The **framework** is what runs on top of them: the update passes, the comparison of what a binding returns with what was sent, and the SDK's copies of the player's state (`plugin.player.state` and the other state copies). The framework uses only the primitives, so a plugin that does not need it does not pay for it: a view joins the update passes on its first `bind()`, a command only when one of its state fields is a function.

Style A is the default and what the rest of the documentation teaches. The styles mix freely within one plugin and even within one view, with one rule: a property is either bound or set (styles A and B) or written directly (style C), never both. The SDK refuses the second track with `invalid`, so its record of what the player shows stays right.

## Speed display

The bottom panel shows the playback speed; **C** cycles it. The speed is part of the state the SDK copies from the player, so this is style A's home ground.

### Style A

{@includeCode ../../examples/three-ways/style-a.ts#speed}

The binding reads `plugin.player.state.rate`. The SDK records that read, and when a `source.state` event changes `rate` it runs this binding again and nothing else (a precise pass); while media plays, the events that change only `position` do not run it. The command's `enabled` is a function, so the command takes part in the passes too.

### Style B

{@includeCode ../../examples/three-ways/style-b.ts#speed}

{@link "@vestra-player/sdk"!Player.on | plugin.player.on} delivers each `source.state` event with its payload typed ({@link "@vestra-player/sdk"!EventPayloads | EventPayloads}; the names are in [Events](../reference/events.md)). Nothing compares for the plugin: the player sends `source.state` about ten times a second while media plays, so without the `shown` check the listener would send the same text ten times a second. `set` on a view that was never bound sends the value whole, with the value limits checked and one write in flight. The command has no function fields, so it is registered once and never evaluated again; `run` asks for the current speed instead of reading a copy.

### Style C

{@includeCode ../../examples/three-ways/style-c.ts#speed}

{@link "@vestra-player/sdk"!Wire.on | plugin.wire.on} delivers the same event untyped, and {@link "@vestra-player/sdk"!Wire.view | plugin.wire.view(bar).write} sends a property write as the protocol has it, with no value limits checked (the player refuses one over them). The command is registered from the player's own declaration (`declaration` in `shared.ts`). A write before the panel shows is refused with `unavailable`. The method names are in [Messages](../reference/messages.md); so is the warning that goes with them.

### What differs on the way

From the key press to the new text on screen. The rows every style shares (the key matched to the command, `run` called, the player applying the speed, the player setting the Slint property) are left out.

| Step | A | B | C |
| --- | --- | --- | --- |
| subscription to `source.state` | a state copy (`mirror: true`), plus a listener while a binding or function field reads the state | a listener, named by where it was added (`why`) | the same as B |
| the event arrives | the state copy updates and marks `rate` changed | the listener runs; no update pass follows it | the listener runs, data `unknown` |
| update pass | one, running the binding and the command's `enabled` | none | none |
| what goes to the player | `ui.setMount` only when the text changed | `ui.setMount` when the plugin calls `set` | `ui.setMount` when the plugin calls `write` |

With `events` in the manifest the SDK keeps its state copy in style B and C too (it subscribes at start, as before 1.7.0); it costs one subscription and no pass while nothing reads it.

### When to choose

A. The value is a function of state the SDK copies, so A is the least code and sends least. One thing to know: a function field that reads `plugin.player.state` subscribes for it, and a listener keeps the plugin running while idle. For a menu item that only follows playback, a `plugin.when` condition is cheaper still: the player evaluates it, and the plugin can be stopped ([Keep a command's state without keeping the plugin running](../how-to/command-state.md)).

## Per-frame push

A stand-in emulator (the plugin VestraNES runs a NES core the same way) produces a frame and a status line sixty times a second through {@link "@vestra-player/sdk"!Player.openStream | openStream}. The window shows the status line. The source of truth is the emulator, outside anything the SDK can see.

### Style A

{@includeCode ../../examples/three-ways/style-a.ts#frames}

{@includeCode ../../examples/three-ways/style-a.ts#frames-stream}

The status line lives in {@link "@vestra-player/sdk"!Scope.state | plugin.state}, so writing it marks the binding that reads it, and each frame runs one pass for that binding: sixty passes a second, each evaluating one function. It works and stays correct, but the pass is pure overhead here: the plugin already knows the value changed.

### Style B

{@includeCode ../../examples/three-ways/style-b.ts#frames}

{@includeCode ../../examples/three-ways/style-b.ts#frames-stream}

The frame callback writes the line itself. The writer keeps one write in flight per view, and a newer value replaces one still waiting, so a slow player never queues stale lines: at most one write per round trip leaves the plugin, however fast the frames come. The check mark is a value set when the stream starts and stops.

### Style C

{@includeCode ../../examples/three-ways/style-c.ts#frames}

{@includeCode ../../examples/three-ways/style-c.ts#frames-stream}

The same, one level down: one write in flight per property, the newest waiting, no value limits checked. Direct writes need a window that shows, hence `show()` before the stream starts and the refused writes dropped.

### What differs on the way

| Step, per frame | A | B | C |
| --- | --- | --- | --- |
| plugin code | `st.status = …` | `screen.set({ status })` | `direct.write("status", { value })` |
| update pass | one, evaluating the binding | none | none |
| writer | compares with the last value sent, one write in flight | limits, one write in flight per view, newest wins | one write in flight per property, newest wins |

### When to choose

B. The plugin pushes exactly when it knows something changed, and the writer's coalescing does the rest. A costs a pass per frame for nothing; C saves only the value-limit check.

## Long list with row patches

A sidebar list of 20,000 entries, keyed by `id`; a double click marks one as played.

### Style A

{@includeCode ../../examples/three-ways/style-a.ts#list}

The handler changes one row; the update pass after it runs the binding, compares the list with the one sent, and sends the difference as a row patch: one `set` operation of one row. Rows with a `key` or `id` field are matched by it, so an insert or a move also becomes a small patch instead of a rewrite of everything after it. The comparison itself takes about a millisecond for 20,000 keyed rows on a desktop machine; the plugin still encodes the whole list in each pass that runs the binding.

### Style B

{@includeCode ../../examples/three-ways/style-b.ts#list}

`set` sends the whole list every time: about 1 MB for these rows, split into parts of at most 512 KB that the player puts together. Correct and simple, and fine for a list that changes rarely or is short; wasteful for one row in 20,000.

### Style C

{@includeCode ../../examples/three-ways/style-c.ts#list}

The plugin writes the list whole once and then sends its own row operations ({@link "@vestra-player/sdk"!WireView.writeRows | writeRows}, player 0.6.0): one `set` of one row, like A's patch, without encoding or comparing anything. The plugin owns the bookkeeping: the operations apply on what the player shows, and a mismatch is refused with `stale`, after which the plugin writes the whole value again.

### What differs on the way

| Step, per change | A | B | C |
| --- | --- | --- | --- |
| plugin code | changes `rows` in the handler | changes `rows`, calls `set` | changes `rows`, calls `writeRows` |
| SDK work | a pass: encode 20,000 rows, compare, plan the patch | encode 20,000 rows, split into parts | number the operations |
| what goes to the player | one patch, one operation | the whole list, two requests | one patch, one operation |

### When to choose

A for almost every list: it gets the patches without the bookkeeping. C when the plugin already knows its changes as operations (a log that only grows, a queue fed by a socket) and the list is long enough for the encoding to matter. B for short lists.

## Plugin-own state

Playback ▸ Next Keyframe is enabled once an asynchronous check (`player.stats()`, asked once per source) says the source has video. The answer arrives after any handler has returned, so no pass follows it by itself. The built-in Playback plugin has this exact command.

### Style A with plugin.state

{@includeCode ../../examples/three-ways/style-a.ts#keyframes}

The answer is written to a field of {@link "@vestra-player/sdk"!Scope.state | plugin.state}. The command's `enabled` read that field, so the write schedules one pass that runs exactly that function, and the SDK sends `commands.update` if the result changed. Tracking is one level deep: a field holding an object is compared by identity, so the code replaces the object instead of changing it.

### Style A before 1.7.0: a manual update()

{@includeCode ../../examples/three-ways/style-a.ts#keyframes-manual}

The same command with the answer in a plain variable. Nothing tells the SDK that it changed, so the plugin calls {@link "@vestra-player/sdk"!Scope.update | plugin.update()}: a full pass over every binding and every command function of the plugin, to change one. Without the call the item would turn on only at the next full pass (about a second later while media plays, or at the next handler). This still works; `plugin.state` removes the call and the full pass.

### Style B

{@includeCode ../../examples/three-ways/style-b.ts#keyframes}

The command's state is a value, and the plugin sets it when it knows: unknown (`false`) on each new source, the answer when it arrives. {@link "@vestra-player/sdk"!Command.set | set} evaluates and sends only this command. The listener reads the source from the event's payload, where it is `stamp.generation`, the player's name for `sourceId`.

### Style C

{@includeCode ../../examples/three-ways/style-c.ts#keyframes}

The same with the raw event, a request by name (`playback.stats`) and {@link "@vestra-player/sdk"!WireCommand.update | update}, which sends one `commands.update` with the next revision.

### What differs on the way

| Step, when the answer arrives | A, `plugin.state` | A, `update()` | B | C |
| --- | --- | --- | --- | --- |
| plugin code | `st.video = …` | `video = …; plugin.update()` | `next.set({ enabled })` | `next.update({ enabled })` |
| update pass | one, running the readers of `st.video` | one full pass: every binding and command function | none (this command only) | none |
| what goes to the player | `commands.update` if `enabled` changed | `commands.update` for each command whose state changed | `commands.update` if `enabled` changed | `commands.update` |

### When to choose

A with `plugin.state` when the state feeds several bindings or commands: each write runs exactly its readers. B when one value feeds one command or view and the plugin knows the moment it changes. Keep `plugin.update()` for state the SDK cannot see and the plugin cannot move into `plugin.state` (a value inside a library object, for instance).

## Choosing a style

A for anything that is a function of state the SDK can see: the player, the window, the timeline, `plugin.state`. Least code and least traffic, with precise passes. B when the source of truth is outside the SDK (a timer, a socket, a frame counter, an emulator) and the plugin wants to push exactly when it knows something changed, or when it wants an event's raw payload. C only to try a player method the SDK does not wrap yet, or to send row operations the plugin already has; every member of `plugin.wire` says so.

What each style needs from the documentation:

| You need | A | B | C |
| --- | --- | --- | --- |
| which state exists | the state types in the API reference, `plugin.state` | [Events](../reference/events.md): names and payloads | [Events](../reference/events.md) and [Messages](../reference/messages.md) |
| when the player is told | [the update pass](plugins.md#the-update-pass) | when you call `set`; one write in flight, [limits](../reference/limits.md) | when you call `write` or `request`; nothing in between for `request` |
| staying stoppable while idle | automatic, `plugin.when` for menu items | automatic: listeners name their call site | `plugin.wire.on` names it; a raw `events.subscribe` of a `HostEvent` is refused (use `plugin.wire.on`), of another event it must say `why` or `mirror: true`, or it is refused |
| capabilities | each member's capability | the same | the Capability column of [Messages](../reference/messages.md); `vestra-plugin check` reads literal method names |
| errors | [error codes](../reference/errors.md) | the same | the same, plus whatever the player answers |
| stability | semver | semver | changes with versions |
| tests | `TestHost` as usual | the same | the same; `host.sent(method)` shows what was written |

## In the reference

{@link "@vestra-player/sdk"!View.bind | View.bind}, {@link "@vestra-player/sdk"!View.set | View.set}, {@link "@vestra-player/sdk"!Scope.state | Scope.state}, {@link "@vestra-player/sdk"!Scope.update | Scope.update}, {@link "@vestra-player/sdk"!Player.on | Player.on}, {@link "@vestra-player/sdk"!Command.set | Command.set} and {@link "@vestra-player/sdk"!Wire | Wire} with {@link "@vestra-player/sdk"!WireView | WireView} and {@link "@vestra-player/sdk"!WireCommands | WireCommands}. The event and method names are in [Events](../reference/events.md) and [Messages](../reference/messages.md); the layers and their stability promise in [How the player runs and talks to plugins](host-and-node.md#layers-and-stability). The examples [Signal generator](../examples/signal-generator.md) and [Panel menu](../examples/panel-menu.md) also come in styles B and C.
