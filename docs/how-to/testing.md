---
title: Test a plugin
description: Test a plugin without the player, with the in-memory TestHost, by acting like the user, simulating sources, injecting failures and waiting for the plugin to settle.
---

# Test a plugin

**Goal:** tests that run with `npm test` on any machine, without the player, and check what a user would see: the menu items, the window's values, the on-screen messages and what happens when the player refuses a call.

`@vestra-player/sdk/testing` runs the plugin against {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, a fake player in memory that speaks the real protocol, so the SDK's own logic (revisions, conditional commits, recovery after lost replies) runs as it does in the player. Only the player side is simplified: there is no decoding, no Slint rendering and no native window. A window is a record of its properties and callbacks, and a source is a set of facts the test chooses.

The tests live in `tests/*.test.ts` and use `node:test`; `vestra-plugin test` (the `test` script of [Getting started](../tutorials/getting-started.md#testing)) runs them. Import `@vestra-player/sdk/testing` only there, never in the plugin itself.

## The shape of a test

The test of the [Bookmark example](../examples/bookmark.md): it prepares the source before the plugin starts, opens the window from its command, fires two Slint callbacks and checks the window and the playback position.

{@includeCode ../../examples/bookmark/tests/bookmark.test.ts}

Every test follows the same five steps:

1. **Start** the plugin with {@link "@vestra-player/sdk/testing"!startPlugin | startPlugin}(activate, { directory }). It reads `manifest.json` in `directory` (from `tests/`, `new URL("..", import.meta.url)`), so the declared capabilities apply: a call that needs an undeclared one fails with `capability`, as in the player. It resolves once activation and every registration made during it are done, and rejects when the player would fail the activation (`activate` throws, or a registration made during it fails, for example with `limit`, `conflict` or `invalid`).
2. **Act** the way the user or another plugin would (below).
3. **Wait** with `await host.settle()`.
4. **Assert** on what the host recorded.
5. **Stop** with `await stop()`: the plugin is disposed as when the player stops it (scopes released, stores flushed) and the host's temporary files are removed. Each test creates its own host.

`startPlugin` also returns `plugin`, the object `activate` received, to call the API directly (`plugin.player.state`). Its options: `host` (a host you prepared before activation, as above), `dataDirectory` (an existing folder as `plugin.dataDirectory`, to test a restart), `sessionStorage` (the values of `plugin.storage.session` an earlier run left, to test a restart within one player session), `locale` (play another interface language, see [Translate a plugin](i18n.md#tests)), and `id` with `capabilities` to start without a `manifest.json`.

## Act like the user

| To simulate | Call |
| --- | --- |
| choosing a menu item | `await host.command(id).run()`; rejects like the player when the command is disabled or busy |
| pressing a key | `await host.press("Ctrl+B")`; `host.press("Delete", { panel: true })` while the plugin's panel has focus |
| a control in a window | `host.window(id).emit(callback, ...args)` (the id is the file name: `ui/picture.slint` is `picture`) |
| closing a window with its title-bar button | `host.window(id).userClose()` (runs the window's `onClose`, unlike the plugin's own `close()`) |
| a control in the mounted panel | `host.mounted().emit(callback, ...args)` |
| answering a dialog | before the action: `host.dialogAnswers.push(["/media/movie.mkv"])` for a file dialog, `null` for Cancel, `{ confirmed: true, checked: false }` for `dialogs.confirm` |
| another plugin calling `player.next()` | `await host.step("next")` |

`press` follows the player's binding table: the panel's bindings first when `panel` is true, then the global ones, the player's own commands before the plugin's. A disabled command lets the key go on to the next command bound to it (SDK 1.5.12, as player 0.4.3). `press` resolves with what the key did:

- `"ran"`: the first enabled command bound to the key ran;
- `"reason"`: only disabled commands hold the key, and the first one with a `reason` showed it on the OSD (it is in `host.osd`) and ate the key;
- `"passed"`: only disabled commands without a reason hold it; the key goes on to the focused control and nothing runs.

It rejects when nothing is bound to the key or the command it would run is busy. User overrides preset in `host.bindings.overlay` apply, and `host.conflicts` lists keys that several commands declare.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("the key does nothing while no video is open", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url),
  });
  assert.equal(await host.press("Ctrl+B"), "reason");
  assert.deepEqual(host.osd, ["Open a video first"]);

  host.openElsewhere("/movie.mp4");
  await host.settle();
  assert.equal(await host.press("Ctrl+B"), "ran");
  assert.deepEqual(host.conflicts, []);
  await stop();
});
```

## Simulate the player

The test decides what the player is doing:

- `host.openElsewhere(path, phase?)`: the user or another plugin opened a source (a new source id, then `phase`, `"ready"` by default). Calls the plugin made against the old state now fail with `stale`.
- `host.setSource({ phase, position, duration, paused, audioTracks, … })`: the state changed (the user paused, playback reached the end). Before `startPlugin`, it presets the source the plugin finds at activation.
- `host.setMainWindow({ fullscreen, videoArea })`, `host.setAppearance(theme)`, `host.setPackages(list)`: the main window, the colour scheme, the installed plugins changed.
- Preset data the player would return: `host.stats` (`player.stats()`), `host.chapters`, `host.clipboard.text`, `host.secrets`, `host.systemInfo`; `host.tools.handle("ffprobe", (args) => ({ stdout }))` makes a tool available and answers its runs.

## Inject failures

`host.handle(method, fn)` replaces the player's answer to one protocol method until `host.reset(method)`. The handler gets the request parameters and returns the reply, or throws:

- `throw new HostError(code, message)`: the player refuses; the plugin's call rejects with that `code` (one of the codes in the {@link "@vestra-player/sdk"!PluginError | PluginError} table).
- `throw new Error(…)`: the reply is lost, and the SDK runs its recovery path.

Method names are the protocol's (`"processing.replace"`, `"system.openPath"`, `"clipboard.writeText"`): `host.calls` lists every request in order, which shows the method an action uses, and `host.sent(method)` the parameters of one method's requests.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { HostError, startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("a refused change is shown and can be retried", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url),
  });
  host.openElsewhere("/movie.mp4");
  await host.command("picture").run();
  host.handle("processing.replace", () => {
    throw new HostError("unsupported", "no video stream");
  });
  host.window("picture").emit("adjust", "gamma", 20);
  await host.settle();
  assert.match(String(host.window("picture").props["status"]), /^Picture settings failed/);

  host.reset("processing.replace");
  host.window("picture").emit("retry");
  await host.settle();
  assert.equal(host.window("picture").props["status"], "Picture settings applied");
  await stop();
});
```

## Wait before asserting

`await host.settle(ms?)` waits until no request is in flight and the SDK's follow-up update passes ran; with `ms` it also waits that long, so that debounces and timers due by then fire (`host.settle(400)` is past `storage.json`'s 300 ms debounce). Call it after every action that makes the plugin talk to the player, before asserting. `command(id).run()` and `press` already wait.

`settle` waits only for calls to the player. Work the plugin does on its own (reading or parsing a file, a child process, a network request) can finish after `settle` returns on a loaded machine; poll the value you assert on instead:

```ts nocheck
window.emit("load-file"); // the plugin reads and parses the file itself
for (let i = 0; i < 100 && window.props["status-text"] !== expected; i++)
  await host.settle(20);
assert.equal(window.props["status-text"], expected);
```

## What to assert on

- **Windows and panels:** `host.window(id).props` and `.visible`, `host.mounted().props`. Property names are the Slint (kebab-case) names: `canMark` is `can-mark`.
- **Commands:** `host.command(id).state` (`enabled`, `checked`, `busy`, `reason`), `.declaration` (the English path and bindings as declared), `.display` (the menu as shown).
- **Messages:** `host.osd` (every message shown, oldest first), `host.osdPanel`, `host.confirms` and `host.confirmTexts` (confirmation dialogs), `host.fileDialogs`.
- **Playback and processing:** `host.source` (`position`, `paused`, `loop`, …), `host.processing`, `host.subtitles`, `host.jobs`, `host.exports`.
- **Anything else the plugin sent:** `host.sent(method)`; `host.system.opened`, `host.clipboard`, `host.tools.calls` for the system services.

The host checks what the player checks: the command limits, the property value limits and the menu ids are enforced with the player's numbers, and processing values are validated with the player's ranges (an out-of-range `filter.set` ends in `failed` with `invalid`). Export jobs advance one step on every state query (`queued`, `running`, `completed`).

## Test a restart

Copy `host.dataDirectory` after the first run and pass it as `dataDirectory` to the second, to check what the plugin stored and restores; the example is on {@link "@vestra-player/sdk/testing"!startPlugin | startPlugin}, and [Remember a window's state between runs](window-state.md) is a plugin that needs it.

A restart within one player session (a reload, an upgrade, a crash) keeps {@link "@vestra-player/sdk"!SessionStorage | plugin.storage.session} too. Pass the first run's `host.sessionStorage` as `sessionStorage` to the second run; leave it out to test a fresh player session, where those values are gone:

```ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("goes on with the queue after a restart", async () => {
  const first = await startPlugin(activate);
  await first.plugin.storage.session.set("queue", ["a.mkv", "b.mkv"]);
  const kept = first.host.sessionStorage;
  await first.stop();

  const second = await startPlugin(activate, { sessionStorage: kept });
  assert.deepEqual(await second.plugin.storage.session.get("queue"), [
    "a.mkv",
    "b.mkv",
  ]);
  await second.stop();
});
```

Every member of `TestHost` is in the {@link "@vestra-player/sdk/testing" | @vestra-player/sdk/testing} reference.
