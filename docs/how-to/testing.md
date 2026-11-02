---
title: Test a plugin
description: Test a plugin without the player, with the in-memory TestHost, by acting like the user, simulating sources, injecting failures and waiting for the plugin to settle.
---

# Test a plugin

**Goal:** tests that run with `npm test` on any machine, without the player, and check what a user would see: the menu items, the window's values, the on-screen messages and what happens when the player refuses a call.

The tests live in `tests/*.test.ts`, use `node:test` and run with `vestra-plugin test` (the `test` script). They run the plugin against `TestHost`, an in-memory player; what it simulates, every option and everything it records are in [Reference: test host](../reference/testing.md). Import `@vestra-player/sdk/testing` only in tests, never in the plugin itself.

## Steps

### Start the plugin

Call `startPlugin(activate, { directory })` with the plugin folder (from `tests/`, `new URL("..", import.meta.url)`). It reads `manifest.json`, so the declared capabilities apply, and resolves once activation is done. To find the plugin playing something at activation, prepare a host first and pass it as `host`.

### Act like the user

Run a command, press a key, fire a window's callback, or answer a dialog before the action that opens it:

```ts nocheck
await host.command("picture").run();         // choose the menu item
assert.equal(await host.press("Ctrl+B"), "ran"); // press its key
host.window("picture").emit("adjust", "gamma", 20); // move a control
host.dialogAnswers.push({ confirmed: true });   // answer the next confirm
```

Every way to act is in [Reference: test host](../reference/testing.md#acting-like-the-user), with what `press` resolves with.

### Simulate the player

Decide what the player is doing: `host.openElsewhere(path)` when the user or another plugin opens a source (the plugin's calls against the old one fail with `stale`), `host.setSource({ … })` when the state changes, preset data such as `host.stats` or `host.chapters` for what the player would return.

### Inject a failure

`host.handle(method, fn)` replaces the player's answer to one protocol method until `host.reset(method)`. Throw a `HostError` for a refusal, a plain `Error` for a lost reply:

```ts nocheck
host.handle("processing.replace", () => {
  throw new HostError("unsupported", "no video stream");
});
```

`host.calls` lists every request in order, which shows the method name an action uses.

### Wait, then assert

`await host.settle()` after every action that makes the plugin talk to the player; `host.settle(400)` also lets debounces and timers due by then fire. Then assert on what the host recorded: `host.window(id).props` (kebab-case names), `host.command(id).state`, `host.osd`, `host.source`.

`settle` does not wait for the once-a-second full update pass (SDK 1.5.45): after `host.setSource(...)` only the bindings that read a changed field of `plugin.player.state` run again. A value your plugin changed outside a handler (a timer, a promise continuation, a child process) without `plugin.update()` shows in the next full pass, at most about a second later; call `plugin.update()` in the plugin after such a change, or wait `await host.settle(1000)` in the test.

`settle` waits only for calls to the player. Work the plugin does on its own (reading or parsing a file, a child process, a network request) can finish later on a loaded machine; poll the value you assert on instead:

```ts nocheck
window.emit("load-file"); // the plugin reads and parses the file itself
for (let i = 0; i < 100 && window.props["status-text"] !== expected; i++)
  await host.settle(20);
assert.equal(window.props["status-text"], expected);
```

### Stop

`await stop()` disposes the plugin as the player does (scopes released, stores flushed) and removes the host's temporary files (a removal Windows refuses for a moment is retried, and never fails the test). `stop({ reason: "idle" })` gives the stop reason the player would send, and `disconnect()` stops the plugin as when the player is lost (`host-lost`, requests refused) (SDK 1.5.54). Each test creates its own host.

### Test a restart

Copy `host.dataDirectory` after the first run and pass it as `dataDirectory` to the second, to check what the plugin stored and restores ([Remember a window's state between runs](window-state.md) is a plugin that needs it). A restart within one player session (a reload, an upgrade, a crash) keeps {@link "@vestra-player/sdk"!SessionStorage | plugin.storage.session} too: pass the first run's `host.sessionStorage` as `sessionStorage`; leave it out to test a fresh player session.

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

## Complete example

The test of the [Bookmark example](../examples/bookmark.md): it prepares the source before the plugin starts, opens the window from its command, fires two Slint callbacks and checks the window and the playback position.

{@includeCode ../../examples/bookmark/tests/bookmark.test.ts}

A key that does nothing while no video is open, and a refused change that is shown and can be retried:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { HostError, startPlugin } from "@vestra-player/sdk/testing";
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

## See also

- [Reference: test host](../reference/testing.md): `startPlugin` options, every way to act and simulate, what the host records, every member.
- [Translate a plugin](i18n.md#tests): tests in another language.
- {@link "@vestra-player/sdk/testing" | @vestra-player/sdk/testing}: the API reference of `TestHost` and `startPlugin`.
