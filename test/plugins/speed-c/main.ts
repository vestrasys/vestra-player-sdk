// The speed display of the refactor plan (doc/specs/sdk-refactor.md §3.3
// in the player repository) in style C: the raw event through
// `plugin.wire.on`, the text written with `plugin.wire.view(bar).write`, the
// command registered bare with `plugin.wire.commands.register`. Its wire
// trace equals style B's (the subscription is a listener with its `why`
// in both; only style A's is a mirror).
import type { Plugin } from "../../../src/plugin/types.ts";

const RATES = [0.5, 1, 1.5, 2];
const nextRate = (rate: number) =>
  RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;

export default function activate(plugin: Plugin) {
  const bar = plugin.panels.mount("bottom", "ui/bar.slint");
  const view = plugin.wire.view(bar);
  plugin.wire.on("source.state", (data) => {
    const s = data as { rate: number };
    void view.write("rate", { value: `${s.rate.toFixed(2)}×` });
  });
  plugin.wire.commands.register({
    id: "rate.cycle",
    declaration: {
      title: "Cycle Speed",
      path: ["Playback", "Cycle Speed"],
      order: 0,
      group: "domain",
      radio: false,
      bindings: ["C"],
      focus: null,
      repeat: false,
    },
    run: async () => {
      const s = await plugin.player.refresh();
      await plugin.player.setRate(nextRate(s.rate));
    },
  });
}
