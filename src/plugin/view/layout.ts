/**
 * The player's panel positions (`layout.state` / `layout.set`): one
 * `LayoutService` per plugin, read by `plugin.panels.bottom` / `sidebar` /
 * `adjust` / `backdrop` and by each panel's `state`.
 */
import type { LayoutSlot } from "../../wire.ts";
import type { Runtime } from "../runtime.ts";
import type { ScopeImpl } from "../scope.ts";
import type {
  BackdropSlot,
  PanelSlot,
  SidebarSlot,
  SlotPanel,
  SlotState,
} from "../types.ts";

/** The positions `layout.state` reports and `layout.set` changes. */
export type LayoutName = "bottom" | "sidebar" | "adjust";

export type Layout = {
  bottom: SlotState | null;
  sidebar: SlotState | null;
  /** The adjust column. */
  adjust: SlotState | null;
  /** `PanelSlot.panels`. */
  tabs: {
    bottom: readonly SlotPanel[] | null;
    sidebar: readonly SlotPanel[] | null;
    adjust: readonly SlotPanel[] | null;
  };
  backdrop: { readonly effective: boolean } | null;
};

/**
 * Both positions, one per plugin: read with `layout.state` after every
 * `window.state` event (one read in flight; events during it cause one more)
 * and after this plugin's own changes. Started on first use.
 */
export class LayoutService {
  readonly #runtime: Runtime;
  state: Layout = {
    bottom: null,
    sidebar: null,
    adjust: null,
    tabs: { bottom: null, sidebar: null, adjust: null },
    backdrop: null,
  };
  readonly #listeners = new Set<(layout: Layout) => void>();
  #started = false;
  #reading = false;
  #again = false;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
  }
  /** Read again, but only once something in this plugin uses the state. */
  async refresh() {
    if (this.#started) await this.read();
  }
  start() {
    if (this.#started) return;
    this.#started = true;
    // A mirror: panels listen through `watch`.
    this.#runtime.on("window.state", () => void this.read(), "events", true);
    void this.read();
  }
  watch(listener: (layout: Layout) => void) {
    this.start();
    this.#listeners.add(listener);
    const held = this.#runtime.hold("window.state");
    return {
      dispose: async () => {
        this.#listeners.delete(listener);
        await held.dispose();
      },
    };
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
        // "pending" until the host confirmed the layout: keep the last value.
        const raw = await this.#runtime.host.layout.state().catch(() => null);
        if (!raw) continue;
        const view = (slot: LayoutSlot | null): SlotState | null =>
          slot && {
            preferred: slot.preferred,
            effective: slot.effective,
            reason: slot.reason,
            detached: slot.detached,
          };
        const tabs = (slot: LayoutSlot | null): readonly SlotPanel[] | null =>
          slot?.panels
            ? Object.freeze(
                slot.panels.map((panel) =>
                  Object.freeze({
                    plugin: panel.plugin,
                    title: panel.title,
                    active: panel.owner === slot.owner,
                  }),
                ),
              )
            : null;
        const adjust = raw.adjust ?? null;
        const next = {
          bottom: view(raw.bottom),
          sidebar: view(raw.sidebar),
          adjust: view(adjust),
          tabs: {
            bottom: tabs(raw.bottom),
            sidebar: tabs(raw.sidebar),
            adjust: tabs(adjust),
          },
          backdrop: raw.backdrop
            ? Object.freeze({ effective: raw.backdrop.effective === true })
            : null,
        };
        if (JSON.stringify(next) === JSON.stringify(this.state)) continue;
        this.state = next;
        for (const listener of [...this.#listeners]) listener(next);
        this.#runtime.invalidate();
      } while (this.#again);
    } finally {
      this.#reading = false;
    }
  }
  async set(
    slot: LayoutName,
    change: {
      visible?: boolean;
      detached?: boolean;
      active?: string;
      reveal?: boolean;
    },
  ) {
    this.start();
    await this.#runtime.host.layout.set({ slot, ...change });
    await this.read();
  }
}

export const layoutOf = (runtime: Runtime) =>
  runtime.service("layout", () => new LayoutService(runtime));

export function slot(scope: ScopeImpl, name: "bottom" | "adjust"): PanelSlot;
export function slot(scope: ScopeImpl, name: "sidebar"): SidebarSlot;
export function slot(scope: ScopeImpl, name: LayoutName): SidebarSlot {
  const service = () => layoutOf(scope.runtime);
  return {
    get state() {
      service().start();
      return service().state[name];
    },
    get panels() {
      service().start();
      return service().state.tabs[name];
    },
    onChange(listener) {
      const seen = (layout: Layout) =>
        JSON.stringify([layout[name], layout.tabs[name]]);
      let last = seen(service().state);
      const watch = service().watch((layout) => {
        const next = seen(layout);
        if (next === last) return;
        last = next;
        scope.run(listener, layout[name]);
      });
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
    setVisible: (visible) => service().set(name, { visible }),
    async toggle() {
      await service().read();
      const current = service().state[name];
      // A switch (see Panel.toggle): nothing pops out in fullscreen.
      await service().set(name, {
        visible: !(current?.preferred ?? true),
        reveal: false,
      });
    },
    setDetached: (detached) => service().set(name, { detached }),
    activate: (plugin) => service().set(name, { active: plugin }),
  };
}

export function backdrop(scope: ScopeImpl): BackdropSlot {
  const service = () => layoutOf(scope.runtime);
  return {
    get state() {
      service().start();
      return service().state.backdrop;
    },
    onChange(listener) {
      let last = JSON.stringify(service().state.backdrop);
      const watch = service().watch((layout) => {
        const next = JSON.stringify(layout.backdrop);
        if (next === last) return;
        last = next;
        scope.run(listener, layout.backdrop);
      });
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
  };
}
