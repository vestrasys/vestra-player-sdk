import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
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

// Until 1.8.0 this needed the capability `events`; a plugin without it
// got a development warning and saw only its own calls. Events need no
// capability now: every plugin follows the player.
test("changes made elsewhere reach a plugin that declares nothing", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  host.setSource({ duration: 600, position: 10 });
  const changes: number[] = [];
  let binds = 0;
  const seen = await warnings(async () => {
    const { plugin, stop } = await startPlugin(
      (plugin: Plugin) => {
        plugin.player.onChange((state) => changes.push(state.position ?? -1));
        plugin.panels
          .mount("bottom", "panel.slint")
          .bind(
            () => (binds++, { position: plugin.player.state.position ?? 0 }),
          );
      },
      { host, directory: packageWith([]) },
    );
    await host.settle();
    const before = { binds };
    // The user seeks (a change made elsewhere).
    host.setSource({ position: 99 });
    await host.settle();
    assert.equal(plugin.player.state.position, 99);
    assert.ok(changes.includes(99), "onChange heard it");
    assert.ok(binds > before.binds, "bind ran again");
    assert.equal(host.mounted().props.position, 99);
    await stop();
  });
  assert.deepEqual(seen, [], "no warning");
});
