// The speed display of the refactor plan (doc/specs/sdk-refactor.md §3.2
// in the player repository) in style B: a listener of one event pushes
// the text with `set`; the command has no state functions. No update pass
// runs and the SDK keeps no copy of the player's state.
import type { Plugin } from "../../../src/plugin/types.ts";

const RATES = [0.5, 1, 1.5, 2];
const nextRate = (rate: number) =>
  RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;

export default async function activate(plugin: Plugin) {
  plugin.player.subscribe(); // the player's events from now on
  await plugin.player.read(); // the player's state and timeline, read once
  const bar = plugin.panels.mount("bottom", "ui/bar.slint");
  plugin.player.on("source.state", (s) =>
    bar.set({ rate: `${s.rate.toFixed(2)}×` }),
  );
  plugin.commands.add({
    id: "rate.cycle",
    path: ["Playback", "Cycle Speed"],
    bindings: ["C"],
    run: async () => {
      const s = await plugin.player.refresh();
      await plugin.player.setRate(nextRate(s.rate));
    },
  });
}
