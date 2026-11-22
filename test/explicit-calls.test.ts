// SDK 1.9.0: the explicit call `plugin.player.read()` stands for what the
// `playback.read` declaration made the SDK do at start-up: called first in
// `activate` it sends the same requests, apart from the start-up
// `window.state` read, which now comes first. SDK 1.11.0 removed
// `plugin.player.subscribe()` (and `Player.onChange`): an event reaches a
// plugin from its first listener, and a binding that reads a state shows
// the newest snapshot the plugin has.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin } from "../src/plugin/index.ts";

/** A package with one panel file. */
function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "explicit-"));
  writeFileSync(
    join(directory, "panel.slint"),
    "export global Bridge { in property <float> position; }\nexport component Panel inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.explicit" }),
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

/** A host with a file open at 10 s. */
function playing() {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  host.setSource({ duration: 600, position: 10 });
  return host;
}

/** Every request so far as `method` or `method(event, mirror|listener)`. */
const sent = (host: TestHost) =>
  host.calls.map(({ method, params }) => {
    const p = params as { event?: string; mirror?: boolean } | undefined;
    return method === "events.subscribe"
      ? `${method}(${p?.event}, ${p?.mirror ? "mirror" : "listener"})`
      : method;
  });

/** What each start sends, in order. */
const EXPECTED: Record<string, string[]> = {
  "read=false": ["window.state", "ui.mount"],
  "read=true": ["window.state", "source.state", "timeline.marks", "ui.mount"],
};

for (const read of [false, true])
  test(`read() sends what the declaration did, window.state first; a binding's read subscribes nothing (read=${read})`, async () => {
    const host = playing();
    let calls: string[] = [];
    const seen = await warnings(async () => {
      const { plugin, stop } = await startPlugin(
        async (plugin: Plugin) => {
          if (read) await plugin.player.read();
          plugin.panels
            .mount("bottom", "panel.slint")
            .bind(() => ({ position: plugin.player.state.position ?? 0 }));
        },
        { host, directory: packageWith() },
      );
      // A change made elsewhere: the bound value shows the newest snapshot
      // the plugin has, which nothing made follow the player.
      host.setSource({ position: 99 });
      await host.settle();
      assert.equal(plugin.player.state.position, read ? 10 : null);
      calls = sent(host);
      await stop();
    });
    assert.deepEqual(calls, EXPECTED[`read=${read}`]);
    assert.deepEqual(seen, [], "no warning");
  });

test("read() is idempotent; subscribe() and onChange() are gone like any unknown member", async () => {
  const host = playing();
  const { plugin, stop } = await startPlugin(
    async (plugin: Plugin) => {
      assert.equal(plugin.player.state.phase, "empty");
      const first = plugin.player.read();
      assert.equal(plugin.player.read(), first);
      await first;
      assert.equal(plugin.player.state.position, 10);
    },
    { host, directory: packageWith() },
  );
  await plugin.player.read();
  await host.settle();
  assert.deepEqual(sent(host), [
    "window.state",
    "source.state",
    "timeline.marks",
  ]);
  const player = plugin.player as unknown as Record<string, unknown>;
  assert.equal(player.subscribe, undefined);
  assert.equal(player.onChange, undefined);
  assert.throws(
    () => (player.subscribe as () => void)(),
    (error: unknown) => error instanceof TypeError,
  );
  await stop();
});

test("read() fetches the timeline's marks and ranges", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  host.setTimelineLayer("other.plugin", [
    { time: 5, kind: "chapter", title: "One" },
  ]);
  const { plugin, stop } = await startPlugin(
    async (plugin: Plugin) => {
      await plugin.player.read();
    },
    { host, directory: packageWith() },
  );
  assert.deepEqual(
    plugin.timeline.marks.map((mark) => mark.title),
    ["One"],
  );
  await stop();
});

test("a listener and a watcher hear their events from the first one, without a warning", async () => {
  const host = playing();
  const heard: number[] = [];
  const seen = await warnings(async () => {
    const { stop } = await startPlugin(
      (plugin: Plugin) => {
        plugin.player.on("source.state", (s) => heard.push(s.position ?? -1));
        plugin.window.onChange(() => {});
      },
      { host, directory: packageWith() },
    );
    host.setSource({ position: 20 });
    await host.settle();
    assert.deepEqual(heard, [20]);
    assert.deepEqual(
      host
        .sent("events.subscribe")
        .map((p) => p.event)
        .sort(),
      ["source.state", "window.state"],
    );
    await stop();
  });
  assert.deepEqual(seen, [], "no warning");
});

test("read() turns on the read after the plugin's own host.run; without it nothing is read", async () => {
  for (const read of [false, true]) {
    const host = playing();
    const { plugin, stop } = await startPlugin(
      async (plugin: Plugin) => {
        if (read) await plugin.player.read();
      },
      { host, directory: packageWith() },
    );
    const before = host.sent("source.state").length;
    await plugin.host.run("play-pause");
    assert.equal(host.sent("source.state").length - before, read ? 1 : 0);
    assert.equal(plugin.player.state.paused, read);
    await stop();
  }
});

test("command keys and the layout state start on first use, and nothing is refused early", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({
        id: "go",
        path: ["Tools", "Go"],
        bindings: ["Ctrl+G"],
        run() {},
      });
    },
    { host, directory: packageWith() },
  );
  assert.deepEqual(sent(host), ["window.state", "commands.register"]);
  // First use of the keys: subscribed, then asked once.
  assert.deepEqual(plugin.commands.keys("go"), []);
  await host.settle();
  assert.deepEqual(plugin.commands.keys("go"), ["⌘G"]);
  // First use of the layout state.
  assert.equal(plugin.panels.bottom.state, null);
  await host.settle();
  assert.deepEqual(sent(host).slice(2), [
    "events.subscribe(commands.keys, mirror)",
    "commands.keys",
    "layout.state",
  ]);
  // The SDK refuses nothing before a request.
  assert.doesNotThrow(() => plugin.timeline.layer());
  await stop();
});
