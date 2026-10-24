/**
 * Blur: Video ▸ Blur… opens a window with one slider that blurs the video.
 * Walkthrough: docs/examples/blur.md.
 */
// #region activate
import type { Plugin, VideoNode } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  // #endregion activate
  // #region filter
  // This plugin's video filter chain; nothing is sent until set().
  const blur = plugin.video.filter("blur");
  let strength = 0; // the Gaussian sigma, 0–10; 0 means off

  function setStrength(value: number) {
    strength = Math.round(value * 10) / 10; // one decimal, like the label
    const chain: VideoNode[] =
      strength === 0 ? [] : [{ kind: "gblur", sigma: strength, steps: 3 }];
    blur.set(chain);
  }
  // #endregion filter

  // #region window
  const window = plugin.windows.create("ui/blur.slint");
  window.bind(() => ({
    strength,
    // Empty unless the player refused the blur.
    problem: blur.status.state === "failed" ? blur.status.error.message : "",
  }));
  window.on("strengthChanged", setStrength);
  // #endregion window

  // #region command
  plugin.commands.add({
    id: "blur",
    path: ["@video", "Blur…"], // the player's Video menu, in any language
    run: () => window.show(),
  });
  // #endregion command
}
