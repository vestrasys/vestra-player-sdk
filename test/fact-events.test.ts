// SDK 1.11.0: the second batch of events (`FactEvent`), each sent once per
// change by the player's rules, in the SDK's shape where it has one, and
// a wake event: a listener of one does not keep the plugin running, and a
// plugin in standby is woken to hear it.
import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type {
  FactEvent,
  FactEventPayloads,
  Plugin,
} from "../src/plugin/types.ts";
import { WAKE_EVENTS } from "../src/plugin/connection.ts";

const FACTS: FactEvent[] = [
  "video.reconfigured",
  "audio.reconfigured",
  "audio.tracks.changed",
  "subtitles.changed",
  "window.changed",
  "layout.changed",
  "audio.devices.changed",
  "app.started",
];

/** A plugin that listens to `event` alone; what it heard. */
async function listening<E extends FactEvent>(event: E, host: TestHost) {
  const heard: FactEventPayloads[E][] = [];
  let plugin!: Plugin;
  const started = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.player.on(event, (data) => heard.push(data));
    },
    { host },
  );
  await host.settle();
  return { ...started, plugin, heard };
}

/** Each fact, made to change in the test host. */
const CHANGES: Record<FactEvent, (host: TestHost, plugin: Plugin) => unknown> =
  {
    "video.reconfigured": (host) => host.openElsewhere("/a.mkv"),
    "audio.reconfigured": (host) => host.openElsewhere("/a.mkv"),
    "audio.tracks.changed": (host) => {
      host.openElsewhere("/a.mkv");
      host.setSource({
        audioTracks: [
          {
            trackId: 1,
            streamIndex: 1,
            selected: true,
            external: false,
            codec: "aac",
            title: "Main",
            language: "en",
          },
        ],
      });
    },
    "subtitles.changed": (host) => host.openElsewhere("/a.mkv"),
    "window.changed": (host) => host.setMainWindow({ fullscreen: true }),
    "layout.changed": (host) => host.mountOther("sidebar", "vestra.playlist"),
    "audio.devices.changed": async (host, plugin) => {
      host.audioDevices = [{ id: "wasapi/b", name: "Headset" }];
      // The host looks at the devices after a request (or an event).
      await plugin.player.audioDevices().catch(() => {});
    },
    "app.started": (host) =>
      host.emit("app.started", { version: "0.11.0", previous: "0.10.3" }),
  };

function withStats(host: TestHost) {
  host.stats = {
    ...host.stats,
    video: {
      codec: "h264",
      width: 3840,
      height: 2160,
      fps: 23.976,
      displayWidth: 1920,
      displayHeight: 1080,
      transfer: "pq",
    },
    audio: {
      codec: "aac",
      sampleRate: 48000,
      channels: 6,
      format: "floatp",
    },
  } as typeof host.stats;
  return host;
}

test("the fact events are wake events the SDK knows", () => {
  for (const event of FACTS) assert.ok(WAKE_EVENTS.includes(event), event);
});

for (const event of FACTS)
  test(`${event}: heard from the first listener, which keeps nothing running; it wakes a plugin in standby`, async () => {
    const host = withStats(new TestHost());
    const { plugin, heard, stop } = await listening(event, host);
    try {
      assert.ok(host.subscriptions.has(event));
      assert.deepEqual(host.keepsRunning, [], "a wake event keeps nothing");
      await CHANGES[event](host, plugin);
      await host.settle();
      assert.ok(heard.length >= 1, `${event} heard`);
      // In standby: the next change wakes it.
      const before = heard.length;
      await host.park();
      assert.equal(host.parked, true);
      if (event === "window.changed") host.setMainWindow({ fullscreen: false });
      else if (event === "layout.changed")
        host.mountOther("sidebar", "vestra.history");
      else if (event === "audio.devices.changed") {
        host.audioDevices = [];
        host.setMainWindow({ fullscreen: true }); // an event the host sends
      } else if (event === "app.started")
        host.emit("app.started", { version: "0.11.1", previous: "0.11.0" });
      else host.openElsewhere("/b.mkv");
      if (event === "audio.tracks.changed")
        host.setSource({
          audioTracks: [
            {
              trackId: 3,
              streamIndex: 1,
              selected: true,
              external: false,
              codec: "aac",
              title: null,
              language: null,
            },
          ],
        });
      await host.settle();
      assert.equal(host.parked, false, `${event} woke it`);
      assert.ok(heard.length > before, `${event} heard after the wake`);
    } finally {
      await stop();
    }
  });

test("the data: the SDK's shapes, and the copies take them first", async () => {
  const host = withStats(new TestHost());
  const seen: Record<string, unknown> = {};
  const { stop } = await startPlugin(
    (p: Plugin) => {
      for (const event of FACTS)
        p.player.on(event, (data: unknown) => {
          seen[event] = data;
          if (event === "window.changed")
            seen.windowCopy = p.window.state.fullscreen;
          if (event === "subtitles.changed")
            seen.subtitlesCopy = p.subtitles.state;
        });
    },
    { host },
  );
  try {
    await host.settle();
    host.openElsewhere("/a.mkv");
    host.setSource({
      audioTracks: [
        {
          trackId: 2,
          streamIndex: 1,
          selected: true,
          external: false,
          codec: "aac",
          title: "Main",
          language: "en",
        },
      ],
    });
    host.setMainWindow({ fullscreen: true });
    host.mountOther("sidebar", "vestra.playlist");
    await host.settle();
    // The plugin follows no stream: the source's id is the host's.
    const sourceId = host.source.stamp.generation;
    assert.deepEqual(seen["video.reconfigured"], {
      sourceId,
      width: 3840,
      height: 2160,
      displayWidth: 1920,
      displayHeight: 1080,
      fps: 23.976,
      rotation: 0,
      hdr: true,
    });
    assert.deepEqual(seen["audio.reconfigured"], {
      sourceId,
      sampleRate: 48000,
      channels: 6,
      format: "floatp",
    });
    // AudioTrack, as PlayerState.audioTracks lists them.
    const tracks = seen[
      "audio.tracks.changed"
    ] as FactEventPayloads["audio.tracks.changed"];
    assert.equal(tracks.sourceId, sourceId);
    assert.deepEqual(
      tracks.audioTracks.map((t) => [t.id, t.selected, t.exportable]),
      [[2, true, true]],
    );
    // SubtitlesState, the copy's own.
    const subtitles = seen[
      "subtitles.changed"
    ] as FactEventPayloads["subtitles.changed"];
    assert.equal(subtitles.state.sourceId, sourceId);
    assert.equal(seen.subtitlesCopy, subtitles.state, "usable as ifCurrent");
    // WindowState, taken into plugin.window.state first.
    const w = host.mainWindow;
    assert.deepEqual(seen["window.changed"], {
      fullscreen: true,
      maximized: false,
      videoArea: { ...w.videoArea },
      pictureInPicture: { ...w.pictureInPicture },
    });
    assert.equal(seen.windowCopy, true);
    // { slots }: each position with its panels.
    const layout = seen[
      "layout.changed"
    ] as FactEventPayloads["layout.changed"];
    assert.ok(layout.slots.sidebar, "the sidebar has a panel");
    assert.deepEqual(
      layout.slots.sidebar.panels.map((panel) => panel.plugin),
      ["vestra.playlist"],
    );
    assert.equal(typeof layout.slots.sidebar.effective, "boolean");
  } finally {
    await stop();
  }
});

test("audio.tracks.changed and audio.devices.changed are taken into player.state first (1.11.0-rc.2)", async () => {
  const host = new TestHost();
  host.audioDevices = [{ id: "wasapi/a", name: "Speakers" }];
  const seen: string[] = [];
  let runs = 0;
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      // The copy follows the source through its events, no stream.
      p.player.on("source.ready", () => {});
      p.player.on("audio.tracks.changed", ({ audioTracks }) =>
        seen.push(
          `tracks ${audioTracks.map((t) => t.id)} copy ${p.player.state.audioTracks?.map((t) => t.id)}`,
        ),
      );
      p.player.on("audio.devices.changed", ({ active }) =>
        seen.push(
          `active ${active} copy ${p.player.state.audioOutput?.active}`,
        ),
      );
      p.commands.add({
        id: "tracks",
        title: "Tracks",
        reason: () => (runs++, String(p.player.state.audioTracks?.length)),
        run: () => {},
      });
    },
    { host },
  );
  try {
    await host.settle();
    host.openElsewhere("/a.mkv");
    await host.settle();
    const before = runs;
    host.setSource({
      audioTracks: [
        {
          trackId: 4,
          streamIndex: 1,
          selected: true,
          external: false,
          codec: "aac",
          title: null,
          language: null,
        },
      ],
    });
    await host.settle();
    assert.ok(seen.includes("tracks 4 copy 4"), seen.join("\n"));
    assert.ok(runs > before, "a binding that reads the tracks ran again");
    assert.equal(host.command("tracks").state.reason, "1");
    // The device chosen: the copy's audioOutput follows the event.
    await plugin.player.setAudioDevice("wasapi/a");
    await host.settle();
    assert.equal(plugin.player.state.audioOutput?.active, "wasapi/a");
    host.audioDevices = [];
    host.setMainWindow({ fullscreen: true }); // the host looks again
    host.setSource({ audioOutput: { requested: "wasapi/a", active: null } });
    await host.settle();
    assert.ok(
      seen.some((line) => line === "active null copy null"),
      seen.join("\n"),
    );
    // Tracks of another source than the copy's are not taken.
    const copy = plugin.player.state.audioTracks;
    host.emit("audio.tracks.changed", { sourceId: 999, audioTracks: [] });
    await host.settle();
    assert.equal(plugin.player.state.audioTracks, copy);
  } finally {
    await stop();
  }
});
