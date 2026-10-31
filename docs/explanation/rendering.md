---
title: GPU and software rendering
description: How the player chooses between drawing the video on the GPU and in software, what the rendering state reports, and how a changed choice takes effect.
---

# GPU and software rendering

The player draws the video either on the GPU or in software. Which one it uses is decided when it starts, from the user's saved choice, the system and what happened at earlier starts; the running player keeps its renderer. The choice is the player's, like a browser's hardware acceleration switch: a plugin can show it and change it ({@link "@vestra-player/sdk"!Rendering | plugin.rendering}), but it stores nothing itself. How the two render paths work inside the player is in [The player's Rust core](architecture.md); where each system renders is in [Reference: platforms](../reference/platforms.md).

## What the state reports

- **`state()` describes now and the next start.** `mode` and `reason` are the renderer drawing now and why; `preference` is the saved choice (`"auto"`, `"gpu"` or `"software"`); `nextMode` and `nextReason` are what the next start will use as far as the player knows, after the environment, the driver denylist and an earlier GPU crash. The item is checked by `nextMode`, so with `"auto"` on a system where the GPU is the default it shows checked.
- **`gpu.available` decides whether the item can be used.** Where this player has no GPU renderer (`no-gpu-backend`), without a user interface (`headless`), for a graphics driver on the player's denylist (`denylist`) or after a GPU crash at an earlier start (`previous-crash`), it is `false` and `gpu.reason.message` explains why; the item shows that as its disabled reason. `"software"` and `"auto"` are always accepted, so a user can always leave the GPU.
- **`restartPending`** is true while the next start's mode differs from the mode this run started with. When the user changes the choice back, it turns false again and the "(Restart to Apply)" title and the restart item go away.
- **`restartPlayer()`** resolves once the player has accepted. The player then quits normally, which stops every plugin, yours included, and starts again with the same plugins; a local file continues at its position, paused or playing as it was (a stream is not reopened). It rejects with `busy` while a restart is under way and with `failed` when the new process could not start (the player keeps running).

The restart is only a shortcut. A user who ignores it gets the new renderer the next time they start the player.

## What depends on the renderer

Render options work only while the video is drawn on the GPU: under software rendering every `set` fails with `unsupported`. The GPU's video upscaler reports in its state why it cannot work, the renderer among the reasons ([Video and audio processing](processing.md)). {@link "@vestra-player/sdk"!SystemInfo.rendering | SystemInfo.rendering} tells a plugin which renderer draws now without reading the whole state.

## In the reference

The members are in the API reference, from {@link "@vestra-player/sdk"!Rendering | Rendering} and {@link "@vestra-player/sdk"!RenderingState | RenderingState} on, with every reason code at {@link "@vestra-player/sdk"!RenderingReasonCode | RenderingReasonCode}. Offering the switch in a plugin is [Offer a GPU rendering switch](../how-to/gpu-rendering.md).
