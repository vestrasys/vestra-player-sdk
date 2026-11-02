/**
 * Source resolvers: page URLs to stream URLs, or local files to a stream
 * this plugin generates, for `player.open`.
 */
import { failure, quiet } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import { resolvedStream } from "./stream.ts";
import { windowOf } from "./window.ts";
import type {
  FileResolverOptions,
  Resolver,
  ResolverOptions,
  Resolvers,
} from "./types.ts";

const isFiles = (options: ResolverOptions): options is FileResolverOptions =>
  "extensions" in options;

const sameTypes = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((type, i) => type === b[i]);

/**
 * One per plugin: the list comes with the `window.state` read before
 * activation (`[]` from older players) and is read again when the plugin
 * first uses it; with `events`, `resolvers.fileTypes` keeps it current.
 */
class FileTypesService {
  readonly #runtime: Runtime;
  types: readonly string[];
  readonly #listeners = new Set<(types: string[]) => void>();
  /**
   * The list listeners last heard, not the one read at start: a plugin
   * woken from standby reads the new list from `window.state`, then gets
   * the `resolvers.fileTypes` the player held for it, and its listeners
   * still hear that change. The player sends the event only when the list
   * changed, so a first event is always news to the listeners.
   */
  #notified: readonly string[] | undefined;
  #started = false;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
    this.types = Object.freeze([...(windowOf(runtime).fileTypes ?? [])]);
  }
  start() {
    if (this.#started) return;
    this.#started = true;
    // A mirror: a plugin listens through `watch` and bindings.
    this.#runtime.on(
      "resolvers.fileTypes",
      (data) => {
        const types = (data as { fileTypes?: unknown } | null)?.fileTypes;
        if (Array.isArray(types) && types.every((t) => typeof t === "string"))
          this.changed(types);
      },
      "events",
      true,
    );
    // What changed between the start-up read and the subscription.
    const window = windowOf(this.#runtime);
    void window.read().then(() => {
      if (window.fileTypes)
        this.accept(window.fileTypes, this.#runtime.can("events"));
    });
  }
  /** From `resolvers.fileTypes`: listeners hear it unless they already did. */
  changed(types: string[]) {
    const changed = !sameTypes(types, this.types);
    if (changed) this.types = Object.freeze([...types]);
    if (!this.#notified || !sameTypes(types, this.#notified))
      this.#notify(types);
    if (changed) this.#runtime.invalidate();
  }
  /**
   * From a `window.state` read: only a change from the current list.
   * `notify`: false without `events`, whose listeners never fire.
   */
  accept(types: string[], notify = true) {
    if (sameTypes(types, this.types)) return;
    this.types = Object.freeze([...types]);
    if (notify) this.#notify(types);
    this.#runtime.invalidate();
  }
  #notify(types: string[]) {
    this.#notified = Object.freeze([...types]);
    for (const listener of [...this.#listeners]) listener([...types]);
  }
  watch(listener: (types: string[]) => void) {
    this.#listeners.add(listener);
    const held = this.#runtime.hold("resolvers.fileTypes");
    return {
      dispose: async () => {
        this.#listeners.delete(listener);
        await held.dispose();
      },
    };
  }
}

const fileTypesOf = (runtime: Runtime) =>
  runtime.service("fileTypes", () => new FileTypesService(runtime));

export const resolvers = (scope: ScopeImpl): Resolvers => ({
  get fileTypes() {
    const service = fileTypesOf(scope.runtime);
    service.start();
    scope.runtime.reading("resolvers.fileTypes");
    return service.types;
  },
  onFileTypesChange(listener) {
    const service = fileTypesOf(scope.runtime);
    service.start();
    const watch = service.watch((types) => scope.run(listener, types));
    return scope.add({
      dispose: async () => {
        scope.forget(watch);
        await watch.dispose();
      },
    });
  },
  add(options) {
    const runtime = scope.runtime;
    const registration = isFiles(options)
      ? runtime.host.sourceResolvers.register(
          { id: options.id, extensions: options.extensions },
          async ({ url, signal }) => {
            const stream = await options.resolve(url, signal);
            if (stream?.kind !== "stream")
              throw failure(
                "invalid",
                'a file resolver returns { kind: "stream", width, height, frame }',
              );
            return resolvedStream(scope, playerOf(runtime), stream, signal);
          },
        )
      : runtime.host.sourceResolvers.register(
          { id: options.id, schemes: options.schemes, hosts: options.hosts },
          ({ url, signal }) => options.resolve(url, signal),
        );
    let disposed = false;
    const handle: Resolver = {
      ready: quiet(
        runtime
          .starting(registration, (error) => scope.report(error))
          .then(() => {}),
      ),
      async dispose() {
        if (disposed) return;
        disposed = true;
        scope.forget(handle);
        const registered = await registration.catch(() => undefined);
        await registered?.dispose().catch(() => {});
      },
    };
    return scope.add(handle);
  },
});
