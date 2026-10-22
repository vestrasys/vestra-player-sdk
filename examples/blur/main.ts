/**
 * Blur: a live Gaussian blur over the video that is playing.
 *
 * Video ▸ Blur (Ctrl+Shift+B) turns it on and off, Video ▸ Blur Controls…
 * opens a window with a strength slider, presets, Reset and the filter's
 * status, and Options ▸ Video ▸ Blur holds two preferences. Walkthrough:
 * docs/examples/blur.md.
 */
import type { Plugin } from "@vestra-player/sdk";
import {
  DEFAULTS,
  PRESETS,
  PRESET_LABELS,
  chain,
  clampSigma,
  formatSigma,
  isBlurSettings,
  presetIndex,
  statusLine,
  type BlurSettings,
} from "./model.ts";

// #region activate
export default async function activate(plugin: Plugin) {
  // #endregion activate
  // #region store
  const store = plugin.storage.json<BlurSettings>("blur", {
    defaults: DEFAULTS,
    validate: isBlurSettings,
  });
  /** Change some settings; `save` writes blur.json 300 ms after the last change. */
  const change = (patch: Partial<BlurSettings>) =>
    store.save({ ...store.value, ...patch });

  // Strength is always remembered; "on" only when the user asked for it.
  if (store.value.enabled && !store.value.restoreOnStart)
    change({ enabled: false });
  // #endregion store

  // #region osd
  /** A one-line on-screen message, unless the user turned them off. */
  const say = (text: string) => {
    if (store.value.messages) void plugin.osd.show(text);
  };
  // #endregion osd

  // #region filter
  const blur = plugin.video.filter("blur");
  /** Send the chain for the current settings; the SDK keeps only the newest. */
  const apply = () => blur.set(chain(store.value));
  apply();

  blur.onStatus((status) => {
    if (status.state === "failed") say(`Blur failed: ${status.error.message}`);
  });
  // #endregion filter

  // #region toggle
  const setEnabled = (on: boolean) => {
    change({ enabled: on });
    apply();
    say(
      on ? `Blur on (strength ${formatSigma(store.value.sigma)})` : "Blur off",
    );
  };
  // #endregion toggle

  // #region commands
  plugin.commands.add({
    id: "toggle",
    path: ["Video", "Blur"],
    order: 400,
    bindings: ["Ctrl+Shift+B"],
    checked: () => store.value.enabled,
    run: () => setEnabled(!store.value.enabled),
  });
  plugin.commands.add({
    id: "controls",
    path: ["Video", "Blur Controls…"],
    order: 401,
    run: () => controls.show(),
  });
  // #endregion commands

  // #region window-bind
  const controls = plugin.windows.create("ui/window.slint");
  controls.bind(() => ({
    enabled: store.value.enabled,
    strength: store.value.sigma,
    presets: PRESET_LABELS,
    presetIndex: presetIndex(store.value.sigma),
    ...statusLine(store.value.enabled, blur.status),
  }));
  // #endregion window-bind

  // #region window-callbacks
  controls.on("enabledToggled", (on: boolean) => setEnabled(on));

  // Fired on every mouse move while dragging: live preview.
  controls.on("strengthChanged", (value: number) => {
    change({ sigma: clampSigma(value) });
    apply();
  });
  // Fired once when the mouse button is released.
  controls.on("strengthReleased", () =>
    say(`Blur strength ${formatSigma(store.value.sigma)}`),
  );

  controls.on("presetChosen", (index: number) => {
    const preset = PRESETS[index];
    if (!preset) {
      // "Custom" is not a strength: put the drop-down back where it was.
      controls.set({ presetIndex: presetIndex(store.value.sigma) });
      return;
    }
    change({ sigma: preset.sigma });
    apply();
    say(`Blur: ${preset.label.toLowerCase()}`);
  });

  controls.on("reset", () => {
    change({ sigma: DEFAULTS.sigma });
    apply();
    say(`Blur strength reset to ${formatSigma(DEFAULTS.sigma)}`);
  });

  controls.on("retry", () => blur.retry());
  controls.on("openOptions", () => plugin.settings.show("blur"));
  // #endregion window-callbacks

  // #region settings-page
  const page = plugin.settings.page("ui/settings.slint", {
    id: "blur",
    category: "video",
    title: "Blur",
  });
  page.bind(() => ({
    restoreOnStart: store.value.restoreOnStart,
    messages: store.value.messages,
  }));
  page.on("restoreToggled", (on: boolean) => change({ restoreOnStart: on }));
  page.on("messagesToggled", (on: boolean) => change({ messages: on }));
  // #endregion settings-page
}
