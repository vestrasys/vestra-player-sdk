/** The main window (`plugin.window`) and the player's own facts (`plugin.app`). */
import { failure } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { WindowFacts } from "../wire.ts";
import type { MainWindow, WindowState } from "./types.ts";

const view = (facts: WindowFacts): WindowState =>
  Object.freeze({
    fullscreen: facts.fullscreen === true,
    videoArea: Object.freeze({
      width: Number(facts.videoArea?.width ?? 0),
      height: Number(facts.videoArea?.height ?? 0),
    }),
    pictureInPicture: Object.freeze({
      supported: facts.pictureInPicture?.supported === true,
      active: facts.pictureInPicture?.active === true,
    }),
  });

/**
 * One per plugin: read before activation, then kept current from
 * `window.state` events (with `events`) and after this plugin's own changes.
 */
export class WindowService {
  readonly #runtime: Runtime;
  state: WindowState = view({
    fullscreen: false,
    videoArea: { width: 0, height: 0 },
  });
  readonly #listeners = new Set<(state: WindowState) => void>();
  #reading = false;
  #again = false;
  #started = false;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
  }
  async init() {
    await this.read();
  }
  /**
   * Follow `window.state` events once the plugin uses `plugin.window` (the
   * shell sends one per layout change, so plugins that never look at the
   * window do not receive them).
   */
  start() {
    if (this.#started) return;
    this.#started = true;
    this.#runtime.on("window.state", (data) => {
      const facts = data as Partial<WindowFacts> | null;
      // The event carries the facts; anything else is read again.
      if (typeof facts?.fullscreen === "boolean" && facts.videoArea)
        this.accept(facts as WindowFacts);
      else void this.read();
    });
    void this.read();
  }
  /** The palette, as the `window.state` reply carried it (`plugin.appearance`). */
  appearance: "vestra" | "potplayer" | undefined;
  accept(facts: WindowFacts) {
    if (facts.appearance) this.appearance = facts.appearance;
    const next = view(facts);
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = next;
    for (const listener of [...this.#listeners]) listener(next);
    this.#runtime.invalidate();
  }
  async read() {
    if (this.#reading) {
      this.#again = true;
      return;
    }
    this.#reading = true;
    try {
      do {
        this.#again = false;
        const facts = await this.#runtime.host.window.state().catch(() => null);
        if (facts) this.accept(facts);
      } while (this.#again);
    } finally {
      this.#reading = false;
    }
  }
  watch(listener: (state: WindowState) => void) {
    this.#listeners.add(listener);
    return { dispose: async () => void this.#listeners.delete(listener) };
  }
}

export const windowOf = (runtime: Runtime) =>
  runtime.service("window", () => new WindowService(runtime));

export function mainWindow(scope: ScopeImpl): MainWindow {
  const service = () => windowOf(scope.runtime);
  const host = () => scope.runtime.host.window;
  return {
    get state() {
      service().start();
      return service().state;
    },
    onChange(listener) {
      service().start();
      const watch = service().watch((state) => scope.run(listener, state));
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
    async setVideoArea(size) {
      const { width, height } = size ?? {};
      if (
        ![width, height].every(
          (v) => Number.isFinite(v) && v >= 1 && v <= 16384,
        )
      )
        throw failure("invalid", "width and height must be 1–16384");
      const applied = await host().setVideoArea(width, height);
      await service().read();
      return {
        width: applied.width,
        height: applied.height,
        clamped: applied.clamped,
      };
    },
    async setAlwaysOnTop(onTop) {
      if (typeof onTop !== "boolean")
        throw failure("invalid", "onTop must be a boolean");
      await host().setAlwaysOnTop(onTop);
    },
    async setCursorAutoHide(mode) {
      if (mode !== "fullscreen" && mode !== "playing")
        throw failure("invalid", 'mode is "fullscreen" or "playing"');
      await host().setCursorAutoHide(mode);
    },
    async setPictureInPicture(on) {
      if (typeof on !== "boolean")
        throw failure("invalid", "on must be a boolean");
      await host().setPictureInPicture(on);
      await service().read();
    },
  };
}
