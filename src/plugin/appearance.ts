/** The player's palette (`plugin.appearance`; `ui.theme` to change it). */
import { failure } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Appearance, ThemeId } from "./types.ts";
import { windowOf } from "./window.ts";

const THEMES: readonly ThemeId[] = ["vestra", "classic"];

/**
 * One per plugin: the value comes with the `window.state` read before
 * activation; with `events`, `appearance.changed` keeps it current once
 * the plugin uses it.
 */
class AppearanceService {
  readonly #runtime: Runtime;
  theme: ThemeId;
  readonly #listeners = new Set<(theme: ThemeId) => void>();
  #started = false;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
    this.theme = windowOf(runtime).appearance ?? "vestra";
  }
  start() {
    if (this.#started) return;
    this.#started = true;
    this.#runtime.on("appearance.changed", (data) => {
      const theme = (data as { theme?: ThemeId } | null)?.theme;
      if (theme && THEMES.includes(theme)) this.accept(theme);
    });
  }
  accept(theme: ThemeId) {
    if (theme === this.theme) return;
    this.theme = theme;
    for (const listener of [...this.#listeners]) listener(theme);
    this.#runtime.invalidate();
  }
  watch(listener: (theme: ThemeId) => void) {
    this.#listeners.add(listener);
    return { dispose: async () => void this.#listeners.delete(listener) };
  }
}

const appearanceOf = (runtime: Runtime) =>
  runtime.service("appearance", () => new AppearanceService(runtime));

export function appearance(scope: ScopeImpl): Appearance {
  const service = () => appearanceOf(scope.runtime);
  return {
    get theme() {
      service().start();
      return service().theme;
    },
    onChange(listener) {
      service().start();
      const watch = service().watch((theme) => scope.run(listener, theme));
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
    async set(theme) {
      if (!THEMES.includes(theme))
        throw failure("invalid", 'theme is "vestra" or "classic"');
      await scope.runtime.host.appearance.set(theme);
      service().accept(theme);
    },
  };
}
