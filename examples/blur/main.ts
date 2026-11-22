/**
 * Blur: Video ▸ Blur… opens a window with one slider that blurs the video.
 * Walkthrough: docs/examples/blur.md.
 */
// #region activate
import type { Plugin, VideoFilter, VideoNode } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  // #endregion activate
  // #region filter
  // This plugin's video filter chain, made on first use: a chain follows the
  // player's source from the moment it is made, which keeps the plugin
  // running, so a plugin that never blurs never makes one. It belongs to a
  // scope made first, so at a stop it goes after the window that shows it.
  const effects = plugin.scope();
  let blur: VideoFilter | undefined;
  let strength = 0; // the Gaussian sigma, 0–10; 0 means off

  function setStrength(value: number) {
    strength = Math.round(value * 10) / 10; // one decimal, like the label
    const chain: VideoNode[] =
      strength === 0 ? [] : [{ kind: "gblur", sigma: strength, steps: 3 }];
    if (blur || chain.length)
      (blur ??= effects.video.filter("blur")).set(chain);
  }
  // #endregion filter

  // #region window
  const blurWindow = plugin.windows.create("ui/blur.slint");
  blurWindow.bind(() => ({
    strength,
    // Empty unless the player refused the blur.
    problem: blur?.status.state === "failed" ? blur.status.error.message : "",
  }));
  blurWindow.on("strengthChanged", setStrength);
  // #endregion window

  // #region command
  plugin.commands.add({
    id: "blur",
    path: ["@video", "Blur…"], // the player's Video menu, in any language
    run: () => blurWindow.show(),
  });
  // #endregion command
}
