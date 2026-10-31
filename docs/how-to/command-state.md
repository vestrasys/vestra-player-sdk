---
title: Keep a command's state without keeping the plugin running
description: Give menu items that follow playback a plugin.when condition, so the player can stop the plugin while it is idle and the items stay current.
---

# Keep a command's state without keeping the plugin running

**Goal:** a "Save Snapshot" item that is greyed out unless there is a frame to capture, and a pair of palette items with a check mark on the palette in use, all following the player while your plugin is stopped because nothing used it; plus a test that fails if something keeps the plugin running.

A function such as `enabled: () => plugin.player.state.phase === "ready"` is evaluated by the SDK, inside your plugin, so the plugin must run to keep it current. A condition from {@link "@vestra-player/sdk"!When | plugin.when} is evaluated by the player itself. Why this matters for idle plugins is in [Conditions the player evaluates](../explanation/commands.md#conditions-the-player-evaluates).

## Steps

### Require player 0.5.21

`plugin.when` exists from player 0.5.21 (SDK 1.5.40); older players build the `plugin` object without it. Set `"minPlayerVersion": "0.5.21"` in the manifest. Conditions need no capability of their own; the command they are given to needs `commands`.

### Find what keeps the plugin running

Start the plugin in a test and read {@link "@vestra-player/sdk/testing"!TestHost.keepsRunning | host.keepsRunning}. Each line names the event, what listens to it and where the plugin added it:

```ts
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const { host, stop } = await startPlugin(activate, {
  directory: new URL("..", import.meta.url),
});
console.log(host.keepsRunning);
// [ 'listens to source.state: command "Save Snapshot…" enabled is a function
//    that reads plugin.player.state (main.ts:12) — use plugin.when' ]
await stop();
```

A function that reads the player's state subscribes to its events, so this reason appears only when the manifest declares `events`. The player's log says the same when it keeps an installed plugin running, and at the start of a development load (`--plugin`).

### Replace the function with a condition

Write the same test as a condition. `when.can("snapshot")` is the player's own `PlayerState.can.snapshot`, `when.phase("ready", "ended")` the source's phase, and `when.stream` a generated stream:

```ts
declare function saveSnapshot(): Promise<void>;
// ---cut---
const { when } = plugin;
plugin.commands.add({
  id: "save",
  path: ["@video", "Save Snapshot…"],
  enabled: when.can("snapshot").and(when.phase("ready", "ended"), when.stream.not()),
  reason: "No frame to capture", // shown only while disabled
  run: saveSnapshot,
});
```

`and`, `or` and `not()` return new conditions and leave the original as it is. With an `enabled` condition the player shows `reason` only while the item is disabled, so a fixed text is enough; a `reason` function that reads the player's state would keep the plugin running again.

### Use checked conditions for radio items

`checked` takes a condition too. A radio group over the palettes needs no `appearance.onChange`:

```ts
const { when } = plugin;
for (const [id, title] of [["vestra", "Dark"], ["vestra-light", "Light"]] as const)
  plugin.commands.add({
    id: `theme.${id}`,
    path: ["Settings", "Appearance", title],
    radio: true,
    checked: when.theme(id),
    run: () => plugin.appearance.set(id),
  });
```

### Keep the plugin's own state as values

The vocabulary names only the player's state. For the plugin's own state (a setting, a mode), set a plain value with {@link "@vestra-player/sdk"!Command.set | Command.set} when it changes: a value is sent once and nothing listens. The player keeps the last value while the plugin is stopped; keep the state itself in `plugin.storage.session` (or `plugin.storage.json` for a setting) so `activate` starts from it again.

```ts
let skip = (await plugin.storage.session.get<boolean>("skip-intros")) === true;
const toggle = plugin.commands.add({
  id: "skip-intros",
  path: ["@playback", "Skip Intros"],
  checked: skip, // a value: nothing listens
  run: async () => {
    skip = !skip;
    toggle.set({ checked: skip });
    await plugin.storage.session.set("skip-intros", skip);
  },
});
```

A function that reads only the plugin's own variables (`checked: () => skip`) also listens to nothing; only functions that read `plugin.player.state`, `plugin.window.state` or another state the SDK mirrors from the player do.

### Test it

{@link "@vestra-player/sdk/testing"!TestHost | TestHost} evaluates conditions as the player does: `host.command(id).state` follows `setSource`, `setMainWindow` and `setAppearance` without the plugin sending anything. Assert that `keepsRunning` is empty, as in the complete example.

## Complete example

`main.ts`:

```ts
import type { Plugin } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  const { when } = plugin;

  plugin.commands.add({
    id: "save",
    path: ["@video", "Save Snapshot…"],
    // Evaluated by the player, also while this plugin is stopped.
    enabled: when.can("snapshot").and(when.phase("ready", "ended"), when.stream.not()),
    reason: "No frame to capture",
    run: async () => {
      const seen = plugin.player.state; // read in a handler: keeps nothing running
      const destination = await plugin.dialogs.saveFile({ fileName: "frame.png" });
      if (!destination) return;
      const snapshot = await plugin.media.capture({ ifCurrent: seen });
      try {
        await (await snapshot.export({ format: "png", destination })).done;
      } finally {
        await snapshot.dispose();
      }
    },
  });

  for (const [id, title] of [["vestra", "Dark"], ["vestra-light", "Light"]] as const)
    plugin.commands.add({
      id: `theme.${id}`,
      path: ["Settings", "Appearance", title],
      radio: true,
      checked: when.theme(id),
      run: () => plugin.appearance.set(id),
    });
}
```

`manifest.json` declares `"minPlayerVersion": "0.5.21"` and the capabilities `commands`, `playback.read`, `media.read`, `media.control`, `ui.dialog` and `ui.theme`.

`tests/main.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("the menu follows the player and nothing keeps the plugin running", async () => {
  const { host, stop } = await startPlugin(activate, {
    capabilities: ["commands", "playback.read", "media.read", "media.control", "ui.dialog", "ui.theme"],
  });
  try {
    assert.deepEqual(host.keepsRunning, []);
    assert.equal(host.command("save").state.enabled, false);
    host.setSource({ phase: "ready" });
    assert.equal(host.command("save").state.enabled, true);
    host.setAppearance("vestra-light");
    assert.equal(host.command("theme.vestra-light").state.checked, true);
  } finally {
    await stop();
  }
});
```

## See also

- {@link "@vestra-player/sdk"!When | When} and {@link "@vestra-player/sdk"!Condition | Condition} in the API reference: the whole vocabulary.
- [Conditions the player evaluates](../explanation/commands.md#conditions-the-player-evaluates) and [Idle plugins are stopped](../explanation/plugins.md#idle-plugins-are-stopped).
- [Test a plugin](testing.md) for `TestHost`.
