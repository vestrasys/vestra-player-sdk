/**
 * The view binder (L2, the framework; doc/specs/sdk-refactor.md §2.2 in the
 * player repository): `View.bind` functions, run in the update passes with
 * read tracking (`Runtime.part`), their values handed to the view's writer.
 */
import type { ScopeImpl } from "../scope.ts";
import type { PropValue, Props } from "../types.ts";
import { encode } from "./writer.ts";
import type { ViewWriter } from "./writer.ts";

/** One view's bindings, evaluated into its {@link ViewWriter}. */
export class ViewBinder {
  readonly #scope: ScopeImpl;
  readonly #writer: ViewWriter;
  /** The view was released: nothing is evaluated any more. */
  readonly #closed: () => boolean;
  /** Each binding, with where the plugin added it (for the player's log). */
  readonly #binders = new Map<
    () => Props,
    { site: () => string | undefined; token: object }
  >();
  constructor(scope: ScopeImpl, writer: ViewWriter, closed: () => boolean) {
    this.#scope = scope;
    this.#writer = writer;
    this.#closed = closed;
  }
  bind(props: () => Props) {
    // `token` names this binding of this view in the runtime's read
    // tracking: the same function bound to two views is two parts.
    this.#binders.set(props, {
      site: this.#scope.runtime.callSite(),
      token: {},
    });
    this.#scope.update();
    return this.#scope.onDispose(() => {
      this.#binders.delete(props);
    });
  }
  /**
   * Current desired properties (bound values win over earlier `set`). A
   * precise pass (`Runtime.part`) skips a bind function that read none of
   * the changed state: its last values stay.
   */
  snapshot(): Record<string, PropValue> {
    const runtime = this.#scope.runtime;
    for (const [binder, { site, token }] of this.#binders) {
      try {
        // Encoded inside the part: what encoding reads counts as the
        // function's (a state object it returned).
        const result = runtime.part(token, () =>
          encode(runtime.reader("a view's bind", site, binder)),
        );
        if (!result) continue;
        for (const [key, value] of Object.entries(result.value))
          try {
            this.#writer.assign(key, value);
          } catch (error) {
            // A property written directly (`plugin.wire.view`): reported
            // once, the binding's other values still count.
            this.#scope.report(error);
          }
      } catch (error) {
        this.#scope.report(error);
      }
    }
    return this.#writer.values();
  }
  /** One update pass: the bindings' values, then whatever changed is sent. */
  evaluate() {
    if (this.#closed()) return;
    this.snapshot();
    this.#writer.flush();
  }
}
