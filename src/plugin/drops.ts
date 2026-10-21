/** File drops (`plugin.drops`, `Panel.onDrop`; capability `ui.drop`). */
import { failure } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Disposable, DropModifiers, Drops } from "./types.ts";

type Modifiers = { alt?: unknown; shift?: unknown; cmd?: unknown } | undefined;
const modifiers = (raw: Modifiers): DropModifiers =>
  Object.freeze({
    alt: raw?.alt === true,
    shift: raw?.shift === true,
    cmd: raw?.cmd === true,
  });

type PanelDrop = {
  paths: string[];
  at: { x: number; y: number };
  modifiers: DropModifiers;
};

/**
 * One per plugin: provider handlers by id (the player names the provider
 * in `drops.drop`) and the panel's `onDrop` listeners (`drops.panel`).
 */
class DropService {
  readonly #runtime: Runtime;
  readonly handlers = new Map<
    string,
    (paths: string[], modifiers: DropModifiers) => void
  >();
  readonly #panel = new Set<(drop: PanelDrop) => void>();
  #next = 0;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
    runtime.raw("drops.drop", (data) => {
      const drop = data as {
        id?: string;
        paths?: string[];
        modifiers?: Modifiers;
      };
      if (!Array.isArray(drop?.paths)) return;
      this.handlers.get(String(drop.id))?.(
        drop.paths.map(String),
        modifiers(drop.modifiers),
      );
    });
    runtime.raw("drops.panel", (data) => {
      const drop = data as {
        paths?: string[];
        at?: { x?: number; y?: number };
        modifiers?: Modifiers;
      };
      if (!Array.isArray(drop?.paths)) return;
      const event = Object.freeze({
        paths: drop.paths.map(String),
        at: Object.freeze({
          x: Number(drop.at?.x ?? 0),
          y: Number(drop.at?.y ?? 0),
        }),
        modifiers: modifiers(drop.modifiers),
      });
      for (const listener of [...this.#panel]) listener(event);
    });
  }
  id() {
    return `d${++this.#next}`;
  }
  /** The first listener asks the player for panel drops; the last stops them. */
  listen(scope: ScopeImpl, listener: (drop: PanelDrop) => void): Disposable {
    this.#panel.add(listener);
    if (this.#panel.size === 1)
      this.#runtime.starting(this.#runtime.host.drops.listen(true), (error) =>
        scope.report(error),
      );
    return {
      dispose: async () => {
        if (!this.#panel.delete(listener) || this.#panel.size) return;
        await this.#runtime.host.drops.listen(false).catch(() => {});
      },
    };
  }
}

export const dropsOf = (runtime: Runtime) =>
  runtime.service("drops", () => new DropService(runtime));

const EXTENSION = /^[a-z0-9]{1,16}$/;

export const drops = (scope: ScopeImpl): Drops => ({
  provide(handler) {
    const extensions = handler?.extensions;
    if (
      !Array.isArray(extensions) ||
      !extensions.length ||
      extensions.length > 64 ||
      !extensions.every((e) => typeof e === "string" && EXTENSION.test(e))
    )
      throw failure(
        "invalid",
        "extensions: 1–64 lower-case names without the dot",
      );
    if (typeof handler.drop !== "function")
      throw failure("invalid", "drop must be a function");
    const service = dropsOf(scope.runtime);
    const id = service.id();
    service.handlers.set(id, (paths, modifiers) =>
      scope.run(() => handler.drop({ paths, modifiers })),
    );
    const host = scope.runtime.host.drops;
    const registered = scope.runtime.starting(
      host.provide(id, [...extensions]),
      (error) => scope.report(error),
    );
    return scope.onDispose(async () => {
      service.handlers.delete(id);
      await registered.catch(() => {});
      await host.withdraw(id).catch(() => {});
    });
  },
});
