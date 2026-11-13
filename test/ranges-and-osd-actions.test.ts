// SDK 1.6.9 (player 0.7.6): timeline ranges (`TimelineLayer.setRanges`,
// `Timeline.ranges`) and OSD messages with action buttons
// (`Osd.show` options), with their TestHost support.
import assert from "node:assert/strict";
import test from "node:test";
import {
  OSD_LIMITS,
  TestHost,
  TIMELINE_LIMITS,
} from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";

test("timeline ranges: their own list of the layer, merged, cleared by a new source and dispose", async () => {
  const host = new TestHost();
  host.setTimelineRanges("other.plugin", [
    { start: 0, end: 30, style: "region", title: "Intro" },
  ]);
  let seen: readonly { start: number }[] = [];
  const errors: PluginError[] = [];
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      seen = p.timeline.ranges;
      p.onError((error) => errors.push(error));
    },
    {
      capabilities: ["playback.read", "events", "timeline.marks"],
      host,
    },
  );
  // Read before activation, with the marks.
  assert.deepEqual(
    seen.map((r) => r.start),
    [0],
  );
  // What a listener reads: the copy took each event first.
  const heard: [number, number][] = [];
  plugin.player.on("timeline.changed", (lists) => {
    assert.equal(plugin.timeline.marks.length, lists.marks.length);
    heard.push([plugin.timeline.marks.length, plugin.timeline.ranges.length]);
  });
  host.openElsewhere("/a.mkv");
  host.setSource({ duration: 60 });
  await host.settle();
  assert.deepEqual(plugin.timeline.ranges, [], "a new source clears them");
  const layer = plugin.timeline.layer();
  layer.set([{ time: 5, kind: "marker" }]);
  layer.setRanges([{ start: 40, end: 52.5, style: "selection" }]);
  layer.setRanges([
    { start: 40, end: 50, style: "selection", title: "Clip" },
    { start: 10, end: 20, style: "region" },
  ]);
  await host.settle();
  assert.deepEqual(plugin.timeline.ranges, [
    { start: 10, end: 20, style: "region", title: null, plugin: "test.plugin" },
    {
      start: 40,
      end: 50,
      style: "selection",
      title: "Clip",
      plugin: "test.plugin",
    },
  ]);
  // Marks and ranges are replaced on their own.
  assert.equal(plugin.timeline.marks.length, 1);
  assert.deepEqual(heard.at(-1), [1, 2]);
  layer.setRanges([{ start: 1, end: 2, style: "region" }]);
  await host.settle();
  assert.deepEqual(heard.at(-1), [1, 1], "the listener reads the new ranges");
  assert.equal(plugin.timeline.marks.length, 1);
  layer.set([]);
  await host.settle();
  assert.equal(plugin.timeline.ranges.length, 1, "set([]) keeps the ranges");
  // As the player: up to 1e-6 s past the end is rounding, not an error.
  layer.setRanges([{ start: 59, end: 60 + 5e-7, style: "selection" }]);
  await host.settle();
  assert.equal(errors.length, 0);
  assert.equal(host.timeline.ranges[0]?.end, 60 + 5e-7);
  // Refusals go to onError; a stale ifCurrent is dropped silently.
  const bad = [
    { start: 5, end: 5, style: "region" as const },
    { start: 1, end: 61, style: "region" as const },
    { start: -1, end: 2, style: "region" as const },
    { start: 1, end: 2, style: "loop" as "region" },
  ];
  for (const range of bad) layer.setRanges([range]);
  layer.setRanges(
    Array.from({ length: TIMELINE_LIMITS.ranges + 1 }, (_, i) => ({
      start: i / 10,
      end: i / 10 + 0.05,
      style: "region" as const,
    })),
  );
  await host.settle();
  assert.ok(errors.length >= 1);
  assert.ok(errors.every((error) => error.code === "invalid"));
  const before = plugin.player.state;
  host.openElsewhere("/b.mkv");
  host.setSource({ duration: 60 });
  await host.settle();
  errors.length = 0;
  layer.setRanges([{ start: 1, end: 2, style: "region" }], {
    ifCurrent: before,
  });
  await host.settle();
  assert.equal(host.timeline.rangeLayers.get("test.plugin"), undefined);
  assert.equal(errors.length, 0);
  layer.setRanges([{ start: 1, end: 2, style: "region" }]);
  await host.settle();
  assert.equal(host.timeline.ranges.length, 1);
  await layer.dispose();
  await host.settle();
  assert.deepEqual(plugin.timeline.ranges, [], "dispose removes the ranges");
  assert.deepEqual(host.sent("timeline.setRanges").at(-1)?.ranges, []);
  await stop();
});

test("a layer that never sent ranges does not send setRanges", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: ["timeline.marks"],
  });
  const layer = plugin.timeline.layer();
  layer.set([{ time: 1, kind: "marker" }]);
  await host.settle();
  await layer.dispose();
  await host.settle();
  assert.equal(host.sent("timeline.setRanges").length, 0);
  await stop();
});

test("osd.show actions: up to two of the plugin's commands; a press runs one", async () => {
  let saved = "";
  const revealed: string[] = [];
  const { plugin, host, stop } = await startPlugin(
    (p: Plugin) => {
      p.commands.add({
        id: "reveal",
        title: "Show Last Saved File in Folder",
        run: () => void revealed.push(saved),
      });
      p.commands.add({
        id: "copy",
        title: "Copy Last Saved File",
        enabled: () => false,
        run: () => assert.fail("disabled"),
      });
    },
    { capabilities: ["ui.osd", "commands"] },
  );
  await host.settle();
  saved = "C:/clips/a.mp4";
  await plugin.osd.show("Saved {}", ["a.mp4"], {
    actions: [
      { title: "Show in Folder", command: "reveal" },
      { title: "Copy", command: "copy" },
    ],
  });
  assert.equal(host.osd.at(-1), "Saved a.mp4");
  assert.deepEqual(host.osdActions.at(-1), [
    { title: "Show in Folder", command: "reveal" },
    { title: "Copy", command: "copy" },
  ]);
  assert.deepEqual(host.sent("osd.show").at(-1)?.actions, [
    { title: "Show in Folder", command: "reveal" },
    { title: "Copy", command: "copy" },
  ]);
  await host.pressOsdAction(0);
  assert.deepEqual(revealed, ["C:/clips/a.mp4"]);
  // A disabled command does nothing, as in the player.
  await host.pressOsdAction(1);
  await assert.rejects(host.pressOsdAction(2), /no button 2/);
  // A message without options sends no actions and has none.
  await plugin.osd.show("Plain");
  assert.equal("actions" in (host.sent("osd.show").at(-1) ?? {}), false);
  assert.deepEqual(host.osdActions.at(-1), []);
  await assert.rejects(host.pressOsdAction(0));
  // A Text title, and `null` args before the options.
  await plugin.osd.show(plugin.i18n.text("Saved"), null, {
    actions: [{ title: plugin.i18n.text("Show in Folder"), command: "reveal" }],
  });
  assert.equal(host.osdActions.at(-1)?.[0]?.title, "Show in Folder");
  await stop();
});

test("osd.show actions: refusals", async () => {
  const { plugin, host, stop } = await startPlugin(
    (p: Plugin) => {
      p.commands.add({ id: "reveal", title: "Reveal", run() {} });
    },
    { capabilities: ["ui.osd", "commands"] },
  );
  await host.settle();
  const action = { title: "Show", command: "reveal" };
  const refusals: [unknown, RegExp][] = [
    [{ actions: [action, action, action] }, /at most 2/],
    [{ actions: [{ title: "Show" }] }, /command id/],
    [{ actions: [{ title: "Show", command: "nope" }] }, /not a command/],
    [{ actions: [{ title: " ", command: "reveal" }] }, /1\.\.=40/],
    [
      {
        actions: [
          { title: "x".repeat(OSD_LIMITS.actionChars + 1), command: "reveal" },
        ],
      },
      /1\.\.=40/,
    ],
    [{ actions: [{ title: 5, command: "reveal" }] }, /title/],
    [{ actions: "reveal" }, /at most 2/],
  ];
  for (const [options, message] of refusals)
    await assert.rejects(
      plugin.osd.show("Saved", null, options as never),
      (error: PluginError) =>
        error.code === "invalid" && message.test(error.message),
      JSON.stringify(options),
    );
  assert.equal(
    host.osd.length,
    0,
    "a refused message shows nothing, its text neither",
  );
  // The title limit counts characters, not bytes.
  await plugin.osd.show("Saved", null, {
    actions: [
      { title: "字".repeat(OSD_LIMITS.actionChars), command: "reveal" },
    ],
  });
  assert.equal(host.osd.length, 1);
  await stop();
});
