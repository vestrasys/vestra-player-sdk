/** On-screen display: a transient line and a persistent information block. */
import { Latest } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { Osd, OsdPanel } from "./types.ts";

class PanelHandle implements OsdPanel {
  readonly #scope: ScopeImpl;
  readonly #pump: Latest<string | null>;
  #last: string | null = null;
  #disposed = false;
  constructor(scope: ScopeImpl) {
    if (scope.runtime.services.has("osd.panel"))
      throw new Error("a plugin can have only one osd panel");
    scope.runtime.services.set("osd.panel", this);
    this.#scope = scope;
    this.#pump = new Latest((text) => scope.runtime.host.osd.panel(text));
    scope.add(this);
  }
  set(text: string | null) {
    if (this.#disposed || text === this.#last) return;
    this.#last = text;
    this.#pump.push(text).catch((error) => this.#scope.report(error));
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    this.#scope.runtime.services.delete("osd.panel");
    if (this.#last !== null) await this.#pump.push(null).catch(() => {});
    this.#pump.stop();
  }
}

export const osd = (scope: ScopeImpl): Osd => ({
  show: (text) => scope.runtime.host.osd.show(text),
  panel: () => new PanelHandle(scope),
});
