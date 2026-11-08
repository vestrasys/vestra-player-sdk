/**
 * Shared machinery behind every scope: the connection to the player
 * (`connection.ts`, L1) with the update passes (`passes.ts`, L2) on top.
 * `Runtime` is the connection plus the pass methods, delegated, so every
 * caller keeps `runtime.host`, `runtime.on`, `runtime.bind` and the rest.
 */
import { Connection } from "./connection.ts";
import type { PluginManifest, RuntimeOptions } from "./connection.ts";
import { Passes } from "./passes.ts";
import type { Change, Deps, PassCounts } from "./passes.ts";
import type { Transport } from "../wire.ts";
import type { Disposable } from "./types.ts";

// Internal, kept where it was before 1.6.19: the player's host-agreement test
// reads WAKE_EVENTS from dist/plugin/runtime.js.
export { WAKE_EVENTS } from "./connection.ts";

/** Per-plugin services: the connection, and the update passes over it. */
export class Runtime extends Connection {
  /** The update pass scheduler. */
  readonly passes: Passes;
  /** Pass counters, read by the SDK's own tests and benchmark ({@link PassCounts}). */
  readonly counts: PassCounts;
  constructor(
    transport: Transport,
    manifest: PluginManifest,
    directory: string,
    dataDirectory?: string,
    app?: unknown,
    options: RuntimeOptions = {},
  ) {
    super(transport, manifest, directory, dataDirectory, app, options);
    this.passes = new Passes(this);
    this.counts = this.passes.counts;
  }
  /** {@link Passes.bind} */
  bind(evaluate: () => void): Disposable {
    return this.passes.bind(evaluate);
  }
  /** {@link Passes.reading} */
  reading(event: string) {
    this.passes.reading(event);
  }
  /** {@link Passes.depends} */
  depends(key: string, field?: string) {
    this.passes.depends(key, field);
  }
  /** {@link Passes.part} */
  part<T>(token: object, read: () => T): { value: T } | undefined {
    return this.passes.part(token, read);
  }
  /** {@link Passes.observe} */
  observe<T>(run: () => T): { value: T; deps: Deps } {
    return this.passes.observe(run);
  }
  /** {@link Passes.needsFull} */
  needsFull(deps: Deps, change: Change) {
    return this.passes.needsFull(deps, change);
  }
  /** {@link Passes.reader} */
  reader<T>(
    label: string,
    where: (() => string | undefined) | undefined,
    read: () => T,
    field = false,
  ): T {
    return this.passes.reader(label, where, read, field);
  }
  /** {@link Passes.invalidate} */
  invalidate() {
    this.passes.invalidate();
  }
  /** {@link Passes.changed} */
  changed(key: string, fields: Iterable<string>) {
    this.passes.changed(key, fields);
  }
  /** {@link Passes.stop} */
  stop() {
    this.passes.stop();
  }
}
