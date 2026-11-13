// SDK 1.9.0: the explicit calls `plugin.player.subscribe()` and
// `plugin.player.read()`. They stand for what the `events` and
// `playback.read` declarations made the SDK do at start-up: called first in
// `activate` they send the same requests, apart from the start-up
// `window.state` read, which now comes first.
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

/** What each combination of the calls sends, in order. */
const EXPECTED: Record<string, string[]> = {
  "subscribe=false read=false": ["window.state", "ui.mount"],
  "subscribe=false read=true": [
    "window.state",
    "source.state",
    "timeline.marks",
    "ui.mount",
  ],
  "subscribe=true read=false": [
    "window.state",
    "events.subscribe(source.state, mirror)",
    "ui.mount",
    "events.subscribe(source.state, listener)",
    "ui.setMount",
  ],
  "subscribe=true read=true": [
    "window.state",
    "events.subscribe(source.state, mirror)",
    "source.state",
    "timeline.marks",
    "ui.mount",
    "events.subscribe(source.state, listener)",
    "ui.setMount",
  ],
};

for (const events of [false, true])
  for (const read of [false, true])
    test(`the explicit calls send what the declarations did, window.state first (subscribe=${events}, read=${read})`, async () => {
      const host = playing();
      let calls: string[] = [];
      const seen = await warnings(async () => {
        const { plugin, stop } = await startPlugin(
          async (plugin: Plugin) => {
            if (events) plugin.player.subscribe();
            if (read) await plugin.player.read();
            plugin.panels
              .mount("bottom", "panel.slint")
              .bind(() => ({ position: plugin.player.state.position ?? 0 }));
          },
          { host, directory: packageWith() },
        );
        // A change made elsewhere: heard only after subscribe().
        host.setSource({ position: 99 });
        await host.settle();
        assert.equal(
          plugin.player.state.position,
          events ? 99 : read ? 10 : null,
        );
        calls = sent(host);
        await stop();
      });
      assert.deepEqual(calls, EXPECTED[`subscribe=${events} read=${read}`]);
      // The development warning, once, only without subscribe().
      assert.equal(
        seen.filter((line) => line.includes("before plugin.player.subscribe()"))
          .length,
        events ? 0 : 1,
        seen.join("\n"),
      );
    });

test("subscribe() and read() are idempotent", async () => {
  const host = playing();
  const { plugin, stop } = await startPlugin(
    async (plugin: Plugin) => {
      assert.equal(plugin.player.state.phase, "empty");
      assert.equal(plugin.player.subscribe(), undefined);
      plugin.player.subscribe();
      const first = plugin.player.read();
      assert.equal(plugin.player.read(), first);
      await first;
      assert.equal(plugin.player.state.position, 10);
    },
    { host, directory: packageWith() },
  );
  plugin.player.subscribe();
  await plugin.player.read();
  await host.settle();
  assert.deepEqual(sent(host), [
    "window.state",
    "events.subscribe(source.state, mirror)",
    "source.state",
    "timeline.marks",
  ]);
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

test("a listener added before subscribe() hears nothing, with one warning, and hears events from the call on", async () => {
  const host = playing();
  const heard: number[] = [];
  const changes: number[] = [];
  let started!: Plugin;
  const seen = await warnings(async () => {
    const { plugin, stop } = await startPlugin(
      (plugin: Plugin) => {
        started = plugin;
        plugin.player.on("source.state", (s) => heard.push(s.position ?? -1));
        plugin.window.onChange(() => {});
        plugin.player.onChange((s) => changes.push(s.position ?? -1));
      },
      { host, directory: packageWith() },
    );
    host.setSource({ position: 20 });
    await host.settle();
    assert.deepEqual(heard, []);
    assert.deepEqual(changes, []);
    assert.equal(
      host.sent("events.subscribe").length,
      0,
      "nothing was subscribed",
    );
    plugin.player.subscribe();
    await host.settle();
    host.setSource({ position: 30 });
    await host.settle();
    assert.deepEqual(heard, [30]);
    assert.deepEqual(changes, [30]);
    assert.deepEqual(
      host
        .sent("events.subscribe")
        .map((p) => p.event)
        .sort(),
      ["source.state", "window.state"],
    );
    await stop();
  });
  assert.ok(started);
  const warned = seen.filter((line) =>
    line.includes("before plugin.player.subscribe()"),
  );
  assert.equal(warned.length, 1, seen.join("\n"));
  assert.match(warned[0]!, /Call plugin\.player\.subscribe\(\) first/);
});

test("subscribe() after read() reads the state once more: a change between the two sent no event", async () => {
  const host = playing();
  const { plugin, stop } = await startPlugin(
    async (plugin: Plugin) => {
      await plugin.player.read();
      // The user seeks before the plugin subscribes.
      host.setSource({ position: 42 });
      plugin.player.subscribe();
    },
    { host, directory: packageWith() },
  );
  await host.settle();
  assert.equal(plugin.player.state.position, 42);
  assert.equal(host.sent("source.state").length, 2);
  await stop();
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
  // The SDK's own refusals (`capability`, before any request) are gone.
  assert.doesNotThrow(() => plugin.timeline.layer());
  await stop();
});
