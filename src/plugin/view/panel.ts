/** Docked panels (`plugin.panels`): one Slint component per position. */
import { Latest } from "../latest.ts";
import { failure, quiet } from "../errors.ts";
import { dropsOf } from "../drops.ts";
import type { PropertyWrite } from "../../wire.ts";
import type { ScopeImpl } from "../scope.ts";
import type { Command, Panel, PanelState, Panels } from "../types.ts";
import { exported, ViewBase } from "./base.ts";
import { backdrop, layoutOf, slot } from "./layout.ts";
import type { Layout } from "./layout.ts";

type Locks = { focused: boolean; dragging: boolean; popupOpen: boolean };

/** Where a panel mounts (`Panels.mount`). */
type MountSlot = "bottom" | "sidebar" | "adjust" | "backdrop";

class PanelHandle extends ViewBase implements Panel {
  readonly ready: Promise<void>;
  readonly #slot: MountSlot;
  #mounted = false;
  readonly #locks = { focused: false, dragging: false, popupOpen: false };
  readonly #interaction: Latest<Locks>;
  constructor(
    scope: ScopeImpl,
    slot: MountSlot,
    file: string,
    options: { component?: string; global?: string; title?: string },
  ) {
    // One panel per slot.
    if (scope.runtime.views.has(`panel:${slot}`))
      throw new Error(`this plugin already has a panel in the ${slot}`);
    super(scope);
    this.#slot = slot;
    const runtime = scope.runtime;
    runtime.views.set(`panel:${slot}`, (callback, args) =>
      this.dispatch(callback, args),
    );
    this.#interaction = new Latest((locks) =>
      runtime.host.ui.interaction(locks, this.#named()),
    );
    const component =
      options.component ?? exported(runtime.directory, file, "component");
    const global =
      options.global ?? exported(runtime.directory, file, "global");
    scope.add(this);
    this.ready = runtime
      .starting(
        (async () => {
          // Let handlers and bindings declared right after mount() join in.
          await Promise.resolve();
          const properties = this.wired(this.snapshot());
          await runtime.host.ui.mount({
            slot,
            file,
            component,
            global,
            ...(options.title === undefined ? {} : { title: options.title }),
            properties,
          });
          this.#mounted = true;
          this.shown(properties);
          this.flush();
          // The position's state changed: refresh it if this plugin reads it.
          await layoutOf(runtime).refresh();
        })(),
        (error) => scope.report(error),
      )
      .then(() => {});
    quiet(this.ready);
  }
  protected live() {
    return this.#mounted && !this.closed;
  }
  /**
   * The slot to name in a request about this panel: only while the plugin
   * has panels in more than one slot (the player then needs it); a plugin
   * with one panel sends what it always sent.
   */
  #named(): MountSlot | undefined {
    const panels = [...this.scope.runtime.views.keys()].filter((key) =>
      key.startsWith("panel:"),
    );
    return panels.length > 1 ? this.#slot : undefined;
  }
  protected write(property: string, write: PropertyWrite) {
    return this.scope.runtime.host.ui.setMount(property, write, this.#named());
  }
  get state(): PanelState | null {
    const service = layoutOf(this.scope.runtime);
    service.start();
    return this.live()
      ? panelState(service.state, this.#slot, this.scope.runtime.manifest.id)
      : null;
  }
  onChange(listener: (state: PanelState | null) => void) {
    const scope = this.scope;
    let last = JSON.stringify(this.state);
    const watch = layoutOf(scope.runtime).watch(() => {
      const state = this.state;
      const next = JSON.stringify(state);
      if (next === last) return;
      last = next;
      scope.run(listener, state);
    });
    return scope.add({
      dispose: async () => {
        scope.forget(watch);
        await watch.dispose();
      },
    });
  }
  async show() {
    await this.ready;
    if (this.#slot === "backdrop")
      throw failure("invalid", "the player shows the backdrop by itself");
    await layoutOf(this.scope.runtime).set(this.#slot, {
      active: this.scope.runtime.manifest.id,
      visible: true,
    });
  }
  async toggle() {
    await this.ready;
    if (this.#slot === "backdrop")
      throw failure("invalid", "the player shows the backdrop by itself");
    await layoutOf(this.scope.runtime).read();
    const state = this.state;
    // A switch, the same in every mode (user ruling 2026-11-08): off when
    // on and current, else on at this tab. `reveal: false`: in fullscreen
    // nothing pops out, the right edge reveals it.
    if (state?.preferred && state.active)
      await layoutOf(this.scope.runtime).set(this.#slot, { visible: false });
    else
      await layoutOf(this.scope.runtime).set(this.#slot, {
        active: this.scope.runtime.manifest.id,
        visible: true,
        reveal: false,
      });
  }
  async showMenu(items: (Command | null)[], at: { x: number; y: number }) {
    await this.ready;
    await this.scope.runtime.host.ui.menu(
      items.map((item) => item?.id ?? null),
      at.x,
      at.y,
      this.#named(),
    );
  }
  onDrop(listener: Parameters<Panel["onDrop"]>[0]) {
    const watch = dropsOf(this.scope.runtime).listen(this.scope, (event) =>
      this.scope.run(listener, event),
    );
    return this.scope.add({ dispose: () => watch.dispose() });
  }
  setInteraction(locks: Partial<Locks>) {
    Object.assign(this.#locks, locks);
    this.#interaction
      .push({ ...this.#locks })
      .catch((error) => this.scope.report(error));
  }
  async dispose() {
    if (this.closed) return;
    this.scope.forget(this);
    this.#interaction.stop();
    if (this.#mounted)
      await this.scope.runtime.host.ui.unmount(this.#named()).catch(() => {});
    this.#mounted = false;
    await this.release();
    this.scope.runtime.views.delete(`panel:${this.#slot}`);
    // Listeners of `onChange` hear `null`.
    this.scope.runtime.invalidate();
    await layoutOf(this.scope.runtime).refresh();
  }
}

/** One panel's view of its position (`Panel.state`). */
function panelState(
  layout: Layout,
  slot: MountSlot,
  plugin: string,
): PanelState | null {
  if (slot === "backdrop")
    return (
      layout.backdrop && {
        active: true,
        preferred: true,
        effective: layout.backdrop.effective,
        reason: null,
        detached: false,
      }
    );
  const state = layout[slot];
  if (!state) return null;
  // Players without tabs (no `panels`): the position holds this panel only.
  const panels = layout.tabs[slot];
  const own = panels?.find((panel) => panel.plugin === plugin);
  if (panels && !own) return null;
  const active = own?.active ?? true;
  return {
    active,
    preferred: state.preferred,
    effective: state.effective && active,
    reason: active ? state.reason : "otherTab",
    detached: state.detached,
  };
}

export const panels = (scope: ScopeImpl): Panels => ({
  mount: (position, file, options = {}) =>
    new PanelHandle(scope, position, file, options),
  bottom: slot(scope, "bottom"),
  sidebar: slot(scope, "sidebar"),
  adjust: slot(scope, "adjust"),
  backdrop: backdrop(scope),
});
