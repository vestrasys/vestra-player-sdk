import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../../sdk/plugin/testing.ts";
import type { Plugin, PluginError } from "../../sdk/plugin/index.ts";

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
  const directory = packageDir(["ui.mount", "ui.drop"]);
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
  const host = new TestHost();
  host.appearance = "potplayer";
  let seen = "";
  const { plugin, stop } = await startPlugin(
    (p: Plugin) => {
      seen = p.appearance.theme;
    },
    { capabilities: ["events", "ui.theme"], host },
  );
  assert.equal(seen, "potplayer");
  const changes: string[] = [];
  plugin.appearance.onChange((theme) => changes.push(theme));
  await host.settle();
  await plugin.appearance.set("vestra");
  assert.equal(host.appearance, "vestra");
  host.setAppearance("potplayer");
  await host.settle();
  assert.equal(plugin.appearance.theme, "potplayer");
  assert.deepEqual(changes, ["vestra", "potplayer"]);
  await assert.rejects(plugin.appearance.set("dark" as never), /vestra/);
  await stop();
});

test("settings: pages register with bound properties, callbacks, show", async () => {
  const directory = packageDir(["ui.settings"]);
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
  page.emit("pick", "potplayer");
  await host.settle();
  assert.deepEqual(picked, ["potplayer"]);
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
