/**
 * `ViewBase`: what windows, panels and settings pages share — callbacks, and
 * a {@link ViewWriter} (L1) with a {@link ViewBinder} (L2) over it. Every
 * view joins the update passes when made (doc/specs/sdk-refactor.md §1.2 in
 * the player repository; Step 2 moves that to the first `bind()`).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Json, PropertyWrite } from "../../wire.ts";
import { PATCH_FEATURE } from "../patch.ts";
import type { ScopeImpl } from "../scope.ts";
import type { Disposable, PropValue, Props, View } from "../types.ts";
import { ViewBinder } from "./binder.ts";
import { kebab, ViewWriter } from "./writer.ts";

/** Property and callback plumbing shared by windows, panels and settings pages. */
export abstract class ViewBase implements View {
  protected readonly scope: ScopeImpl;
  protected readonly handlers = new Map<string, (...args: Json[]) => unknown>();
  readonly #writer: ViewWriter;
  readonly #binder: ViewBinder;
  #binding: Disposable;
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
    this.#binding = scope.runtime.bind(() => this.evaluate());
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
    return this.#binder.bind(props);
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
    await this.#binding.dispose();
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
