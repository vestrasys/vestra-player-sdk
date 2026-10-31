---
title: Test, check, pack and publish
description: "Tutorial 4 of 4: test the plugin without the player, run the checks, pack it into a .vxp and send it to the plugin store."
---

# Test, check, pack and publish

In this tutorial the plugin from the earlier tutorials gets a test that runs without the player, passes the checks, becomes a `.vxp` package users can install, and is submitted to the plugin store.

## Before you start

Finish [Add settings and translations](settings-and-translations.md). What the test host simulates is in [Reference: test host](../reference/testing.md); the command line tool is in [Reference: command line](../reference/cli.md).

## 1. Write a test

Create `tests/main.test.ts`. `startPlugin` runs the plugin against an in-memory player that reads your `manifest.json`:

```ts
// tests/main.test.ts
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

test("shows the position", async () => {
  const { host, stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url), // reads manifest.json
  });
  host.setSource({ phase: "ready", position: 12, duration: 60 });
  await host.settle();
  await host.command("where").run();
  assert.deepEqual(host.osd, ["12.0 s of 60.0 s"]);
  await stop();
});
```

`setSource` decides what the player is playing, `settle` waits until the plugin has caught up, `command("where").run()` chooses the menu item, and `host.osd` holds every message shown.

## 2. Run the tests and the checks

```sh
npm test         # vestra-plugin test: node --test tests/*.test.{ts,mjs}
npm run check    # the manifest, then a strict type check of the plugin and its tests
npx vestra-plugin i18n check
```

Fix whatever they report before you go on.

## 3. Build and pack

Give the plugin the fields the store shows (`name`, `author`, `punchline`, `description`, `tags`, `license`, `sourceUrl`; [Manifest](../reference/manifest.md)) and write a `README.md` and a `CHANGELOG.md`. Then pack it:

```sh
npm run pack     # vestra-plugin pack: build dist/, then me.hello-0.1.0.vxp
```

`build` writes `dist/`: the code with types stripped, the Slint and data files, the compiled translations and `dist/manifest.json` with the version. `pack` packs `dist/` into `<id>-<version>.vxp`. Install the `.vxp` in the player to try what users will get.

## 4. Publish

Push the plugin to a public GitHub repository owned by the user or organization your id starts with, then register it in the plugin repository with a pull request. The registration file, the checks on the pull request and what happens after the merge are in [Publish a plugin](../how-to/publish.md).

## Next

- [How-to guides](../how-to/index.md): one task each, from controlling playback to remembering a window's state.
- [Test a plugin](../how-to/testing.md): simulating sources, injecting failures, testing a restart.
- [Plugin rules](../guidelines/plugins.md): what every plugin must follow to be accepted.
