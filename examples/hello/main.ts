import type { Plugin } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  plugin.commands.add({
    id: "hello",
    path: ["Tools", "Hello"],
    run: () => plugin.osd.show("Hello"),
  });
}
