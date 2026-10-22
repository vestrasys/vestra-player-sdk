import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin, Scope } from "@vestra-player/sdk";

/**
 * Demonstrates the core user interface API:
 * menu path/order/group/radio, bindings with repeat, a command outside the
 * menu, the on-screen display, next/previous, the shared sidebar state with
 * detach/attach, and a tool window built from the theme and widgets.
 */
export default async function activate(plugin: Plugin) {
  const { player, osd } = plugin;
  const sidebar = plugin.panels.sidebar;
  const menu = (title: string) => ["Examples", title];
  const say = (text: string) => osd.show(text);

  // plugin.dataDirectory: remembered across restarts; written atomically.
  const settings = join(plugin.dataDirectory, "settings.json");
  const load = () => {
    try {
      return (
        (JSON.parse(readFileSync(settings, "utf8")) as { speed?: number })
          .speed ?? 1
      );
    } catch {
      return 1;
    }
  };
  const save = (value: number) => {
    writeFileSync(`${settings}.tmp`, JSON.stringify({ speed: value }));
    renameSync(`${settings}.tmp`, settings);
  };

  // A menu item whose title changes: dispose it (removed from the menu) and add it again.
  let last: Scope = plugin.scope();
  const remember = async (value: number) => {
    await last.dispose();
    last = plugin.scope();
    last.commands.add({
      id: "last",
      path: menu(`Last speed: ${value}×`),
      order: 859,
      group: "examples",
      enabled: false,
      run() {},
    });
  };

  // Menu: one top-level submenu in its own separator group, radio items.
  let speed = load();
  void remember(speed);
  for (const [index, rate] of [0.5, 1, 2].entries())
    plugin.commands.add({
      id: `rate-${rate}`,
      path: ["Examples", "Speed", `${rate}×`],
      order: 850 + index,
      group: "examples",
      radio: true,
      checked: () => speed === rate,
      enabled: () => player.state.can.rate,
      run: async () => {
        await player.setRate(rate);
        speed = rate;
        save(rate);
        await remember(rate);
        await say(`Speed: ${rate}×`);
      },
    });

  // Bindings: a held key repeats; a command with no menu entry.
  plugin.commands.add({
    id: "volume-up",
    path: menu("Volume +5"),
    order: 860,
    group: "examples",
    bindings: ["Ctrl+Alt+ArrowUp"],
    repeat: true,
    run: async () => {
      const volume = Math.min(200, player.state.volume + 5);
      await player.setOutput({ volume });
      await say(`Volume: ${volume}%`);
    },
  });
  plugin.commands.add({
    id: "where",
    title: "Show the position",
    bindings: ["Ctrl+Alt+W"],
    run: () => say(`Position: ${Math.round(player.state.position ?? 0)} s`),
  });

  // Next / previous through whichever plugin provides the sequence.
  for (const [id, title, key, step] of [
    ["next", "Next", "Ctrl+Alt+N", () => player.next()],
    ["previous", "Previous", "Ctrl+Alt+P", () => player.previous()],
  ] as const)
    plugin.commands.add({
      id,
      path: menu(title),
      order: id === "next" ? 861 : 862,
      group: "examples",
      bindings: [key],
      enabled: () => player.state.can[id],
      run: step,
    });

  // #region sidebar
  // The sidebar, whoever mounted it: show/hide and float/attach.
  plugin.commands.add({
    id: "sidebar",
    path: menu("Show sidebar"),
    order: 863,
    group: "examples",
    checked: () => sidebar.state?.preferred ?? false,
    enabled: () => sidebar.state !== null,
    run: () => sidebar.toggle(),
  });
  plugin.commands.add({
    id: "detach",
    path: menu("Detach sidebar"),
    order: 864,
    group: "examples",
    bindings: ["Ctrl+Alt+D"],
    checked: () => sidebar.state?.detached ?? false,
    enabled: () => sidebar.state !== null,
    run: () => sidebar.setDetached(!sidebar.state?.detached),
  });
  // #endregion sidebar

  // A tool window drawn with @vestra/theme.slint and @vestra/widgets.slint.
  const window = plugin.windows.create("ui/theme.slint");
  let level = 0.5;
  window.bind(() => ({ level, label: `Level ${Math.round(level * 100)}` }));
  window.on("levelChanged", (value: number) => (level = value));
  window.on("reset", () => (level = 0.5));
  plugin.commands.add({
    id: "theme",
    path: menu("Theme widgets…"),
    order: 865,
    group: "examples",
    run: () => window.show(),
  });
}
