// SDK 1.12.0 additions: OSD duration, subtitle line seeks, a start time on
// open, removing an added audio track, the window title, maximize and
// minimize, and WebVTT through the SRT load path.
import assert from "node:assert/strict";
import test from "node:test";
import { OSD_LIMITS, TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { Plugin } from "../src/plugin/index.ts";
import { webvttToSrt } from "../src/plugin/subtitles.ts";

async function started(host = new TestHost()) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
      p.player.stream(() => {});
    },
    { host },
  );
  return { ...result, plugin };
}

const rejects = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });

test("osd.show takes durationMs, an integer of 500..30000 ms, sent only when given", async () => {
  const { host, plugin, stop } = await started();
  assert.equal(OSD_LIMITS.minDurationMs, 500);
  assert.equal(OSD_LIMITS.maxDurationMs, 30_000);
  await plugin.osd.show("Hello");
  await plugin.osd.show("Long", null, { durationMs: 6000 });
  assert.deepEqual(
    host.sent("osd.show").map((p) => p.durationMs ?? "default"),
    ["default", 6000],
  );
  for (const bad of [499, 30_001, 1.5, Number.NaN, "1000" as unknown as number])
    await rejects(plugin.osd.show("x", null, { durationMs: bad }), "invalid");
  assert.equal(host.sent("osd.show").length, 2, "refused before sending");
  // The test host refuses what the player refuses.
  await rejects(
    plugin.wire.request("osd.show", { text: "x", durationMs: 100 }),
    "invalid",
  );
  await stop();
});

test("seekSubtitle sends player.seekSubtitle, needs a selected subtitle and is conditional", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mkv");
  const { plugin, stop } = await started(host);
  await rejects(plugin.player.seekSubtitle("next"), "unavailable");
  host.subtitles.selection.target = { kind: "embedded", id: 1 };
  await plugin.player.seekSubtitle("next");
  await plugin.player.seekSubtitle("previous");
  await plugin.player.seekSubtitle("current");
  assert.deepEqual(
    host.sent("player.seekSubtitle").map((p) => p.direction),
    ["next", "next", "previous", "current"], // the refused one first
  );
  await rejects(plugin.player.seekSubtitle("last" as "next"), "invalid");
  const seen = plugin.player.state;
  await plugin.player.setPaused(true);
  await rejects(
    plugin.player.seekSubtitle("next", { ifCurrent: seen }),
    "stale",
  );
  host.openElsewhere("/next.mkv", "loading");
  await rejects(plugin.player.seekSubtitle("next"), "unavailable");
  await stop();
});

test("open takes start: sent with the open intent when above 0, checked first", async () => {
  const { host, plugin, stop } = await started();
  await plugin.player.open("/a.mp4", { start: 754.5 });
  await plugin.player.open("/b.mp4", { start: 0 });
  await plugin.player.open("/c.mp4");
  assert.deepEqual(
    host
      .sent("source.submit")
      .map((p) => (p.intent as { start?: number }).start ?? null),
    [754.5, null, null],
    "0 and omitted stay off the wire",
  );
  for (const bad of [-1, Number.POSITIVE_INFINITY, Number.NaN])
    await rejects(plugin.player.open("/d.mp4", { start: bad }), "invalid");
  assert.equal(host.sent("source.submit").length, 3);
  await stop();
});

test("removeAudioTrack removes an added track; tracks inside the file stay", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mkv");
  host.setSource({
    audioTracks: [
      {
        trackId: 1,
        streamIndex: 1,
        selected: true,
        external: false,
        codec: "aac",
        title: null,
        language: "en",
      },
    ],
  });
  const { plugin, stop } = await started(host);
  const added = await plugin.player.addAudioTrack("/dub.mp3");
  const state = await plugin.player.removeAudioTrack(added.id);
  assert.deepEqual(
    state.audioTracks!.map((t) => [t.id, t.selected]),
    [[1, true]],
    "the playing track went: the first one left plays",
  );
  await rejects(plugin.player.removeAudioTrack(1), "invalid"); // inside the file
  await rejects(plugin.player.removeAudioTrack(added.id), "invalid"); // gone
  // An external track the plugin did not add (loaded beside the video).
  host.setSource({
    audioTracks: [
      ...plugin.player.state.audioTracks!.map((t) => ({
        trackId: t.id,
        streamIndex: t.streamIndex ?? null,
        selected: t.selected,
        external: t.external,
        codec: t.codec,
        title: t.title,
        language: t.language,
      })),
      {
        trackId: 5,
        streamIndex: null,
        selected: false,
        external: true,
        codec: "aac",
        title: "movie.en.m4a",
        language: "en",
      },
    ],
  });
  await host.settle();
  await rejects(plugin.player.removeAudioTrack(5), "invalid");
  await rejects(plugin.player.removeAudioTrack(1.5), "invalid");
  const seen = plugin.player.state;
  await plugin.player.setPaused(true);
  await rejects(
    plugin.player.removeAudioTrack(1, { ifCurrent: seen }),
    "stale",
  );
  await stop();
});

test("window.setTitle: 1..200 characters or null for an open source; a close, a new source and the plugin's stop clear it", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  await rejects(plugin.window.setTitle("Nothing open"), "unavailable");
  await plugin.window.setTitle(null); // withdrawing is always fine
  await plugin.player.open("/movie.mp4");
  await plugin.window.setTitle("Episode 3");
  assert.equal(host.mainWindow.title, "Episode 3");
  await plugin.window.setTitle(null);
  assert.equal(host.mainWindow.title, null);
  for (const bad of ["", "  ", "x".repeat(201), 3 as unknown as string])
    await rejects(plugin.window.setTitle(bad), "invalid");
  await plugin.window.setTitle("字".repeat(200));
  await plugin.player.open("/next.mp4");
  assert.equal(host.mainWindow.title, null, "a new source clears it");
  await plugin.window.setTitle("Live");
  await plugin.player.close();
  assert.equal(host.mainWindow.title, null, "a close clears it");
  await plugin.player.open("/live.mp4");
  await plugin.window.setTitle("Live");
  await stop();
  assert.equal(host.mainWindow.title, null, "the stop clears it");
});

test("window.setMaximized and setMinimized: booleans; maximize is refused in fullscreen", async () => {
  const host = new TestHost();
  const { plugin, stop } = await started(host);
  await plugin.window.setMaximized(true);
  assert.equal(host.mainWindow.maximized, true);
  await plugin.window.setMaximized(false);
  assert.equal(host.mainWindow.maximized, false);
  await plugin.window.setMinimized(true);
  assert.equal(host.mainWindow.minimized, true);
  await plugin.window.setMinimized(false);
  assert.equal(host.mainWindow.minimized, false);
  await rejects(plugin.window.setMaximized(1 as unknown as boolean), "invalid");
  await rejects(
    plugin.window.setMinimized("yes" as unknown as boolean),
    "invalid",
  );
  host.setMainWindow({ fullscreen: true });
  await rejects(plugin.window.setMaximized(true), "unavailable");
  await plugin.window.setMinimized(true);
  assert.deepEqual(
    host.sent("window.setMaximized").map((p) => p.maximized),
    [true, false, true],
  );
  await stop();
});

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

test("WebVTT becomes SRT: settings, blocks and tags dropped, entities decoded, cues ordered", () => {
  const vtt = [
    "﻿WEBVTT - a title",
    "Kind: captions",
    "",
    "STYLE",
    "::cue { color: yellow }",
    "",
    "NOTE a comment",
    "with two lines",
    "",
    "intro",
    "00:01.500 --> 00:03.000 position:10% align:start",
    "<v Anna><b>Hi</b> &amp; welcome</v>",
    "<c.loud>&lt;loud&gt;</c> <00:02.000>now",
    "",
    "1:00:00.000 --> 1:00:01.250",
    "late",
    "",
    "00:00.000 --> 00:01.000",
    "first",
    "",
    "00:05.000 --> 00:04.000",
    "ends before it starts",
    "",
    "00:06.000 --> 00:07.000",
    "<i></i>",
    "",
  ].join("\r\n");
  assert.equal(
    text(webvttToSrt(new TextEncoder().encode(vtt))),
    [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "first",
      "",
      "2",
      "00:00:01,500 --> 00:00:03,000",
      "Hi & welcome",
      "<loud> now",
      "",
      "3",
      "01:00:00,000 --> 01:00:01,250",
      "late",
      "",
    ].join("\n"),
  );
});

test("WebVTT that is not WebVTT is refused with invalid", () => {
  const refused = (source: string | Uint8Array) =>
    assert.throws(
      () =>
        webvttToSrt(
          typeof source === "string"
            ? new TextEncoder().encode(source)
            : source,
        ),
      (error: { code?: string }) => error.code === "invalid",
    );
  refused("1\n00:00:00,000 --> 00:00:01,000\nHi\n");
  refused("WEBVTTX\n\n00:00.000 --> 00:01.000\nHi\n");
  refused("WEBVTT\n\n00:00.000 --> soon\nHi\n");
  refused("WEBVTT\n\n00:61.000 --> 00:62.000\nHi\n");
  refused("WEBVTT\n\nNOTE only a note\n");
  refused(new Uint8Array([0x57, 0x45, 0x42, 0x56, 0x54, 0x54, 0x0a, 0xff]));
  refused(new Uint8Array(2 * 1024 * 1024 + 1));
});

test("WebVTT: a malformed cue is left out, a cue may follow the header at once, entities cannot split a cue", () => {
  const srt = (source: string) =>
    text(webvttToSrt(new TextEncoder().encode(source)));
  assert.equal(
    srt(
      [
        "WEBVTT",
        "00:00.000 --> 00:01.000",
        "right after the header",
        "",
        "00:02.000 --> later",
        "bad timing: left out",
        "",
        "00:03.000 --> 00:04.000",
        "a&#10;b&#x0d;c &lt;i&gt;as written&lt;/i&gt; {\\an8}",
        "",
        "00:05.000 --> 00:06.000",
        "x".repeat(4097),
        "",
      ].join("\n"),
    ),
    [
      "1",
      "00:00:00,000 --> 00:00:01,000",
      "right after the header",
      "",
      "2",
      "00:00:03,000 --> 00:00:04,000",
      // The player shows SRT text literally: "<i>" and "{\an8}" included.
      "a b c <i>as written</i> {\\an8}",
      "",
    ].join("\n"),
  );
});

test("WebVTT tag removal is linear on lines of '<' without '>'", () => {
  const line = "<".repeat(4096);
  const cues = Array.from({ length: 200 }, (_, i) => {
    const at = String(i % 60).padStart(2, "0");
    return `00:${at}.000 --> 00:${at}.500\n${line}\n`;
  });
  const started = performance.now();
  const out = text(
    webvttToSrt(new TextEncoder().encode("WEBVTT\n\n" + cues.join("\n"))),
  );
  assert.ok(performance.now() - started < 1000, "well under a second");
  assert.ok(out.includes("<<<<"), "a lone '<' is text");
});

test("subtitles.load with format vtt uploads the SRT and commits it as SRT", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mkv");
  const { plugin, stop } = await started(host);
  const track = await plugin.subtitles.load(
    new TextEncoder().encode("WEBVTT\n\n00:01.000 --> 00:02.000\nHello\n"),
    { format: "vtt", title: "Web" },
  );
  assert.equal(plugin.subtitles.state!.selected!.id, track.id);
  assert.deepEqual(
    host.sent("subtitles.commit").map((p) => p.format ?? "srt"),
    ["srt"],
  );
  const begun = host.sent("subtitles.upload.begin").at(-1)!;
  assert.equal(
    begun.expectedBytes,
    new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\nHello\n")
      .length,
  );
  await rejects(
    plugin.subtitles.load(new TextEncoder().encode("not vtt"), {
      format: "vtt",
    }),
    "invalid",
  );
  await stop();
});
