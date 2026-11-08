/**
 * `ViewBase`: what windows, panels and settings pages share — callbacks, and
 * a {@link ViewWriter} (L1) with a {@link ViewBinder} (L2) over it. A view
 * joins the update passes on its first `bind()` (SDK 1.7.0,
 * doc/specs/sdk-refactor.md §4 Step 2 in the player repository); until
 * then `set()` goes straight to the writer, which sends whole values and
 * keeps no row-patch bases for it.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Json, PropertyWrite } from "../../wire.ts";
import { failure } from "../errors.ts";
import { PATCH_FEATURE } from "../patch.ts";
import type { ScopeImpl } from "../scope.ts";
import type { BindingHandle } from "../passes.ts";
import type { PropValue, Props, View } from "../types.ts";
import { ViewBinder } from "./binder.ts";
import { DIRECT, kebab, ViewWriter } from "./writer.ts";
import type { DirectWrites } from "./writer.ts";

/** Property and callback plumbing shared by windows, panels and settings pages. */
export abstract class ViewBase implements View {
  protected readonly scope: ScopeImpl;
  protected readonly handlers = new Map<string, (...args: Json[]) => unknown>();
  readonly #writer: ViewWriter;
  readonly #binder: ViewBinder;
  /** Its place in the update passes, from the first `bind()` on. */
  #binding: BindingHandle | undefined;
  /** Its place in the order of evaluation, kept from when it was made. */
  readonly #slot: number;
  protected closed = false;
  constructor(scope: ScopeImpl) {
    this.scope = scope;
    this.#writer = new ViewWriter({
      live: () => this.live(),
      write: (property, write) => this.write(property, write),
      report: (error) => this.scope.report(error),
      patches: () => this.scope.runtime.features.has(PATCH_FEATURE),
    });
    this.#binder = new ViewBinder(scope, this.#writer, () => this.closed);
    this.#slot = scope.runtime.passes.slot();
  }
  protected abstract live(): boolean;
  protected abstract write(
    property: string,
    write: PropertyWrite,
  ): Promise<void>;
  /** {@link ViewWriter.wired}: initial properties in wire form. */
  protected wired(
    values: Record<string, PropValue>,
    refuse = false,
  ): Record<string, Json> {
    return this.#writer.wired(values, refuse);
  }
  on<A extends Json[]>(callback: string, handler: (...args: A) => unknown) {
    const name = kebab(callback);
    this.handlers.set(name, handler as (...args: Json[]) => unknown);
    return this.scope.onDispose(() => {
      if (this.handlers.get(name) === handler) this.handlers.delete(name);
    });
  }
  set(props: Props) {
    this.#writer.set(props);
  }
  bind(props: () => Props) {
    if (!this.#binding && !this.closed) {
      // The first bind: the view takes part in the update passes, and its
      // writer compares and patches from now on.
      this.#writer.track();
      this.#binding = this.scope.runtime.bind(
        () => this.evaluate(),
        this.#slot,
      );
    }
    return this.#binder.bind(props);
  }
  /**
   * `plugin.wire.view(v)` (SDK 1.7.0): the writer's direct writes, for a
   * scope of the plugin that made this view.
   */
  [DIRECT](scope: ScopeImpl): DirectWrites {
    if (scope.runtime !== this.scope.runtime)
      throw failure(
        "invalid",
        "view takes a window, panel or settings page of this plugin",
      );
    return {
      write: (property, write) => this.#writer.direct(property, write),
      writeRows: (property, ops) => this.#writer.directRows(property, ops),
    };
  }
  /** {@link ViewBinder.snapshot}: current desired properties. */
  protected snapshot(): Record<string, PropValue> {
    return this.#binder.snapshot();
  }
  protected evaluate() {
    this.#binder.evaluate();
  }
  /** The host already shows these values (e.g. sent as initial properties). */
  protected shown(values: Record<string, Json>) {
    this.#writer.shown(values);
  }
  /** {@link ViewWriter.flush}: send what changed. */
  protected flush() {
    this.#writer.flush();
  }
  protected dispatch(callback: string, args: Json[]) {
    if (this.closed) return;
    const handler = this.handlers.get(callback);
    if (handler) this.scope.run(handler, ...args);
    else this.scope.update();
  }
  protected async release() {
    this.closed = true;
    this.#writer.stop();
    await this.#binding?.dispose();
  }
}

/** Find `export component X` / `export global Y` so most mounts need no names. */
export function exported(directory: string, file: string, kind: string) {
  const text = readFileSync(resolve(directory, file), "utf8");
  const names = [
    ...text.matchAll(new RegExp(`export\\s+${kind}\\s+([\\w-]+)`, "g")),
  ].map((m) => m[1]!);
  if (names.length !== 1)
    throw new Error(
      `${file}: name the ${kind} to mount (found ${names.length})`,
    );
  return names[0]!;
}
