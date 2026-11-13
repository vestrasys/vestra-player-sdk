import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin, PluginError, ThemeId } from "../src/plugin/index.ts";
import { playerOf } from "../src/plugin/player.ts";
import { Runtime } from "../src/plugin/runtime.ts";

function packageDir(capabilities: string[]) {
  const directory = mkdtempSync(join(tmpdir(), "r3b-"));
  writeFileSync(
    join(directory, "art.slint"),
    "export global Art { in property <string> caption; callback pick(string); }\nexport component Page inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.r3b", capabilities }),
  );
  return directory;
}

test("drops: providers by extension, folders, panel onDrop first", async () => {
  const directory = packageDir([]);
  const media: { paths: string[]; alt: boolean }[] = [];
  const panel: { paths: string[]; y: number }[] = [];
  let listener: { dispose(): Promise<void> } | undefined;
  const { host, stop } = await startPlugin(
    (p: Plugin) => {
      p.drops.provide({
        extensions: ["mkv", "folder"],
        drop: (e) => media.push({ paths: e.paths, alt: e.modifiers.alt }),
      });
      p.drops.provide({ extensions: ["mkv", "srt"], drop: () => {} });
      const art = p.panels.mount("sidebar", "art.slint");
      listener = art.onDrop((e) => panel.push({ paths: e.paths, y: e.at.y }));
    },
    { directory },
  );
  assert.equal(host.dropProviders.length, 2);
  await host.drop(["/m/a.MKV", directory, "/m/b.txt", "/m/c.mkv"], {
    modifiers: { alt: true },
  });
  assert.deepEqual(media, [
    { paths: ["/m/a.MKV", directory, "/m/c.mkv"], alt: true },
  ]);
  await host.drop(["/m/d.mkv"], { target: "panel", at: { x: 5, y: 40 } });
  assert.deepEqual(panel, [{ paths: ["/m/d.mkv"], y: 40 }]);
  await listener!.dispose();
  await host.settle();
  assert.equal(host.panelDrops, false);
  await host.drop(["/m/e.mkv"], { target: "panel" });
  assert.equal(media.length, 2, "without a listener: to the providers");
  await stop();
});

test("appearance: read before activation, set, follows other plugins", async () => {
  // A palette this SDK does not list (a newer or an older player's).
  const other = "light" as ThemeId;
  const host = new TestHost();
  host.appearance = other;
  let seen = "";
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      seen = p.appearance.theme;
    },
    { capabilities: ["player"], host },
  );
  assert.equal(seen, other);
  // What a listener reads: the SDK's copy took the event first.
  const changes: string[] = [];
  plugin.player.on("appearance.changed", () =>
    changes.push(plugin.appearance.theme),
  );
  await host.settle();
  await plugin.appearance.set("vestra");
  assert.equal(host.appearance, "vestra");
  host.setAppearance(other);
  await host.settle();
  // Changes to a palette the SDK does not list are not followed.
  assert.equal(plugin.appearance.theme, "vestra");
  // The echo of its own set, then the unknown palette's event.
  assert.deepEqual(changes, ["vestra", "vestra"]);
  await assert.rejects(
    plugin.appearance.set("dark" as never),
    /invalid|vestra/,
  );
  // The test host answers like the player: an unknown id selects vestra.
  host.appearance = other;
  await host.request("appearance.set", { theme: "dark" } as never);
  assert.equal(host.appearance, "vestra");
  // The light palette (SDK 1.5): set, and followed when another plugin picks it.
  await plugin.appearance.set("vestra-light");
  assert.equal(host.appearance, "vestra-light");
  assert.equal(plugin.appearance.theme, "vestra-light");
  host.setAppearance("vestra");
  await host.settle();
  host.setAppearance("vestra-light");
  await host.settle();
  assert.equal(plugin.appearance.theme, "vestra-light");
  // Every event is heard (the listener reads the copy, already current):
  // the two above, the request that selected vestra, the own set's echo,
  // then the other plugin's two picks.
  assert.deepEqual(changes, [
    "vestra",
    "vestra",
    "vestra",
    "vestra-light",
    "vestra",
    "vestra-light",
  ]);
  await stop();
});

test("settings: pages register with bound properties, callbacks, show", async () => {
  const directory = packageDir([]);
  const picked: string[] = [];
  let caption = "A";
  const { host, plugin, stop } = await startPlugin(
    (p: Plugin) => {
      const page = p.settings.page("art.slint", {
        id: "look",
        category: "appearance",
        title: "外观",
        order: 10,
      });
      page.bind(() => ({ caption }));
      page.on("pick", (theme: string) => picked.push(theme));
    },
    { directory },
  );
  const page = host.settingsPage("look");
  assert.deepEqual(
    [page.category, page.title, page.order, page.component, page.global],
    ["appearance", "外观", 10, "Page", "Art"],
  );
  assert.equal(page.props.caption, "A");
  page.emit("pick", "vestra");
  await host.settle();
  assert.deepEqual(picked, ["vestra"]);
  caption = "B";
  plugin.update();
  await host.settle();
  assert.equal(host.settingsPage("look").props.caption, "B");
  await plugin.settings.show("look");
  await plugin.settings.show();
  assert.deepEqual(host.settings.shows, ["look", null]);
  assert.equal(host.settings.current, "look");
  await assert.rejects(
    plugin.settings.show("other"),
    (e: PluginError) => e.code === "invalid",
  );
  assert.throws(
    () =>
      plugin.settings.page("art.slint", {
        id: "look",
        category: "appearance",
        title: "x",
      }),
    /already exists/,
  );
  assert.throws(
    () =>
      plugin.settings.page("art.slint", {
        id: "x",
        category: "colours" as never,
        title: "x",
      }),
    /category/,
  );
  await stop();
  assert.equal(host.settings.pages.size, 0, "disposed with the plugin");
});

test("appearance: player.on reads the event's theme and language from the copy", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["player"],
    host,
  });
  // No read of plugin.appearance before: player.on starts the copy.
  const read: [string, string, string, string | undefined][] = [];
  plugin.player.on("appearance.changed", (data) =>
    read.push([
      data.theme,
      plugin.appearance.theme,
      plugin.appearance.language,
      data.language,
    ]),
  );
  await host.settle();
  host.setAppearance("vestra-light");
  await host.settle();
  host.setLanguage("fr");
  await host.settle();
  // An older player's event, without a language.
  host.emit("appearance.changed", { theme: "vestra" });
  await host.settle();
  assert.deepEqual(read, [
    ["vestra-light", "vestra-light", "system", undefined],
    ["vestra-light", "vestra-light", "fr", "fr"],
    ["vestra", "vestra", "fr", undefined],
  ]);
  await stop();
});

test("a state copy started after a plugin listener still hears each event first", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["player"],
    host,
  });
  // A raw listener first; the copy starts later, with the first read.
  const read: string[] = [];
  plugin.wire.on("appearance.changed", () =>
    read.push(plugin.appearance.theme),
  );
  assert.equal(plugin.appearance.theme, "vestra");
  await host.settle();
  host.setAppearance("vestra-light");
  await host.settle();
  host.setAppearance("vestra");
  await host.settle();
  assert.deepEqual(read, ["vestra-light", "vestra"]);
  await stop();
});

test("source.state: a listener added before the player's copy starts reads the event's state", async () => {
  // The startup always starts the copy first; a runtime built by hand
  // can add the listener before it, the order the dispatch must undo.
  const host = new TestHost();
  const runtime = new Runtime(
    host,
    { id: "test.order", capabilities: [] },
    tmpdir(),
  );
  const rates: number[] = [];
  const listener = runtime.on("source.state", (data) =>
    rates.push(playerOf(runtime).state.rate, (data as { rate: number }).rate),
  );
  void playerOf(runtime).start(false);
  await host.settle();
  host.setSource({ rate: 1.5 });
  await host.settle();
  host.setSource({ rate: 2 });
  await host.settle();
  // Each time the copy (first number) already has the event's rate.
  assert.deepEqual(rates, [1.5, 1.5, 2, 2]);
  await listener.dispose();
  runtime.stop();
  host.close();
});

test("a state copy that throws stops neither the other copies nor the plugin's listeners; onError hears it", async () => {
  const host = new TestHost();
  const { plugin, stop } = await startPlugin(() => {}, {
    capabilities: ["player"],
    host,
  });
  const errors: PluginError[] = [];
  plugin.onError((error) => errors.push(error));
  const runtime = (plugin as unknown as { runtime: Runtime }).runtime;
  // A broken copy, added before the real one and the listener.
  runtime.on(
    "appearance.changed",
    () => {
      throw new Error("broken copy");
    },
    true,
  );
  const read: string[] = [];
  plugin.player.on("appearance.changed", () =>
    read.push(plugin.appearance.theme),
  );
  await host.settle();
  host.setAppearance("vestra-light");
  await host.settle();
  // The real copy took the event after the broken one, then the listener ran.
  assert.deepEqual(read, ["vestra-light"]);
  assert.equal(errors.length, 1);
  assert.match(errors[0]!.message, /broken copy/);
  await stop();
});
