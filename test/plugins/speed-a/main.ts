// The speed display of the refactor plan (doc/specs/sdk-refactor.md §3.1
// in the player repository) in style A: the panel and the command state
// are functions of the player's state; the SDK decides when to send.
import type { Plugin } from "../../../src/plugin/types.ts";

const RATES = [0.5, 1, 1.5, 2];
const nextRate = (rate: number) =>
  RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;

export default function activate(plugin: Plugin) {
  const bar = plugin.panels.mount("bottom", "ui/bar.slint");
  bar.bind(() => ({ rate: `${plugin.player.state.rate.toFixed(2)}×` }));
  plugin.commands.add({
    id: "rate.cycle",
    path: ["Playback", "Cycle Speed"],
    bindings: ["C"],
    enabled: () => plugin.player.state.can.rate,
    run: () => plugin.player.setRate(nextRate(plugin.player.state.rate)),
  });
}
