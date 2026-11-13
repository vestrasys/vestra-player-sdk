import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { Plugin } from "../src/plugin/index.ts";

/** A package with one panel file and these capabilities. */
function packageWith(capabilities: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "events-"));
  writeFileSync(
    join(directory, "panel.slint"),
    "export global Bridge { in property <float> position; }\nexport component Panel inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.events", capabilities }),
  );
  return directory;
}

/** Collect console.warn while `run` runs. */
async function warnings(run: () => Promise<void>) {
  const seen: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void seen.push(args.join(" "));
  try {
    await run();
  } finally {
    console.warn = original;
  }
  return seen;
}

for (const events of [false, true]) {
  test(`changes made elsewhere reach a plugin only after subscribe() (subscribe=${events})`, async () => {
    const host = new TestHost();
    host.openElsewhere("/movie.mp4");
    host.setSource({ duration: 600, position: 10 });
    const changes: number[] = [];
    let binds = 0;
    const seen = await warnings(async () => {
      const capabilities = ["playback.read", "ui.mount"];
      if (events) capabilities.push("events");
      const { plugin, stop } = await startPlugin(
        (plugin: Plugin) => {
          plugin.player.onChange((state) => changes.push(state.position ?? -1));
          plugin.panels
            .mount("bottom", "panel.slint")
            .bind(
              () => (binds++, { position: plugin.player.state.position ?? 0 }),
            );
        },
        { host, directory: packageWith(capabilities) },
      );
      await host.settle();
      const before = { position: plugin.player.state.position, binds };
      // The user seeks (a change made elsewhere).
      host.setSource({ position: 99 });
      await host.settle();
      if (events) {
        assert.equal(plugin.player.state.position, 99);
        assert.ok(changes.includes(99), "onChange heard it");
        assert.ok(binds > before.binds, "bind ran again");
        assert.equal(host.mounted().props.position, 99);
      } else {
        // As in the player: nothing arrives, the state stays as it was.
        assert.equal(plugin.player.state.position, before.position);
        assert.deepEqual(changes, []);
        assert.equal(binds, before.binds, "bind did not run again");
        assert.notEqual(host.mounted().props.position, 99);
      }
      await stop();
    });
    const warned = seen.filter((line) =>
      line.includes("before plugin.player.subscribe()"),
    );
    // A development warning, once per plugin, only without `events`.
    assert.equal(warned.length, events ? 0 : 1, seen.join("\n"));
  });
}
