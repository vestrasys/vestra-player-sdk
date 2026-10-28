---
title: Offer a GPU rendering switch
description: Show the player's GPU or software rendering choice as a menu item, save the user's choice and offer a restart to apply it.
---

# Offer a GPU rendering switch

**Goal:** a settings menu item "GPU Rendering (Experimental)" that shows whether the player will draw on the GPU, is greyed out with the player's reason where the GPU cannot be chosen, saves the user's choice, says "(Restart to Apply)" while the choice waits for a restart, and offers that restart.

The player keeps the choice itself, like a browser's hardware acceleration switch: {@link "@vestra-player/sdk"!Rendering.setPreference | setPreference} saves it in the player's settings at once, the running player keeps its renderer, and the next start uses the choice **whether or not the user restarts now**. Your plugin stores nothing. Reading the state needs no capability; saving a choice and restarting need `rendering.manage`, which needs player 0.5.13.

## The complete example

`manifest.json`:

```json
{
  "id": "examples.gpu-switch",
  "version": "1.0.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "minPlayerVersion": "0.5.13",
  "capabilities": ["commands", "rendering.manage"]
}
```

`main.ts`:

```ts
import type { Plugin, PluginError, RenderingState, Scope } from "@vestra-player/sdk";

const TITLE = "GPU Rendering (Experimental)";

export default async function activate(plugin: Plugin) {
  let state: RenderingState = await plugin.rendering.state();
  let menu: Scope | null = null;
  let shownPending: boolean | null = null;

  // A command's title cannot change in place, so the items live in a child
  // scope that is rebuilt when `restartPending` flips.
  async function build() {
    if (state.restartPending === shownPending) return;
    shownPending = state.restartPending;
    await menu?.dispose();
    menu = plugin.scope();
    menu.commands.add({
      id: "gpu-rendering",
      path: ["@settings", state.restartPending ? `${TITLE} (Restart to Apply)` : TITLE],
      // Checked when the next start draws on the GPU (also for "auto").
      checked: () => state.nextMode === "gpu",
      // Greyed out with the player's reason where "gpu" cannot be chosen.
      enabled: () => state.gpu.available,
      reason: () => state.gpu.reason?.message ?? null,
      run: async () => {
        const choice = state.nextMode === "gpu" ? "software" : "gpu";
        try {
          state = await plugin.rendering.setPreference(choice);
        } catch (error) {
          // `unavailable`: the GPU was ruled out after the state was read.
          state = await plugin.rendering.state(); // the item now says why
          if ((error as PluginError).code !== "unavailable") throw error; // `failed`: not saved
        } finally {
          await build();
        }
      },
    });
    if (state.restartPending)
      menu.commands.add({
        id: "restart",
        path: ["@settings", "Restart Player to Apply"],
        run: async () => {
          // Resolves once the player accepted; it then quits and starts again.
          await plugin.rendering.restartPlayer();
        },
      });
  }

  await build();
}
```

## How it works

- **`state()` describes now and the next start.** `mode` and `reason` are the renderer drawing now and why; `preference` is the saved choice (`"auto"`, `"gpu"` or `"software"`); `nextMode` and `nextReason` are what the next start will use as far as the player knows, after the environment, the driver denylist and an earlier GPU crash. The item is checked by `nextMode`, so with `"auto"` on a system where the GPU is the default it shows checked.
- **`gpu.available` decides whether the item can be used.** Where this player has no GPU renderer (`no-gpu-backend`, Windows today), without a user interface (`headless`), for a graphics driver on the player's denylist (`denylist`) or after a GPU crash at an earlier start (`previous-crash`), it is `false` and `gpu.reason.message` explains why; the item shows that as its disabled reason. `"software"` and `"auto"` are always accepted, so a user can always leave the GPU.
- **`restartPending`** is true while the next start's mode differs from the mode this run started with. When the user changes the choice back, it turns false again and the "(Restart to Apply)" title and the restart item go away.
- **`restartPlayer()`** resolves once the player has accepted. The player then quits normally, which stops every plugin, yours included, and starts again with the same plugins; a local file continues at its position, paused or playing as it was (a stream is not reopened). It rejects with `busy` while a restart is under way and with `failed` when the new process could not start (the player keeps running).

The restart is only a shortcut. A user who ignores it gets the new renderer the next time they start the player.

## Older players

A player before 0.5.13 does not load a plugin that declares `rendering.manage`, so the manifest above sets `minPlayerVersion`. A plugin that only reads the state, without the capability, gets `unsupported` from `state()` on an older player:

```ts
const state = await plugin.rendering.state().catch((error: PluginError) => {
  if (error.code === "unsupported") return null; // a player before 0.5.13
  throw error;
});
```

To know only whether render options work now, read {@link "@vestra-player/sdk"!SystemInfo.rendering | rendering} from `plugin.app.system()` instead; `renderingReason` there is the same reason as `state().reason`.

## Test it

{@link "@vestra-player/sdk/testing"!TestHost.rendering | TestHost.rendering} models the player: preset `gpu`, `reason` and `startedWith` before the plugin starts (`videoRender.gpu` is the mode drawing now), then drive the item and check the saved choice.

```ts
import assert from "node:assert/strict";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const host = new TestHost(); // a GPU player, "auto", started on the GPU
const { stop } = await startPlugin(activate, {
  directory: new URL("..", import.meta.url),
  host,
});
await host.command("gpu-rendering").run(); // unchecks: saves "software"
assert.equal(host.rendering.preference, "software");
await host.command("restart").run(); // offered while the restart is pending
assert.equal(host.rendering.restarts, 1);
await stop();
```

Set `host.rendering.gpu = { available: false, reason: { code: "denylist", message: "…" } }` to see the item greyed out, and refuse a call with `host.handle("rendering.restart", () => { throw new HostError("failed", "…"); })`.

## See also

- {@link "@vestra-player/sdk"!Rendering | Rendering} and {@link "@vestra-player/sdk"!RenderingState | RenderingState} in the reference, with every reason code at {@link "@vestra-player/sdk"!RenderingReasonCode | RenderingReasonCode}.
- [Platforms](../reference/platforms.md) for where the player renders on the GPU.
- [Menus](../guidelines/menus.md) for where settings items go.
