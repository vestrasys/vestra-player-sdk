/** Scopes own handles. Disposal runs newest first and never throws. */
import { failure, toError } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import type { Disposable, Plugin, PluginError, Scope } from "./types.ts";
import { commands } from "./commands.ts";
import { dialogs, panels, windows } from "./ui.ts";
import { player } from "./player.ts";
import { audioFilters, videoFilters } from "./filters.ts";
import { subtitles } from "./subtitles.ts";
import { mediaCapture } from "./media.ts";
import { resolvers } from "./resolvers.ts";
import { packages } from "./packages.ts";
import { osd } from "./osd.ts";
import { clipboard, host, power, storage, system, tools } from "./services.ts";

export class ScopeImpl implements Plugin {
  readonly runtime: Runtime;
  readonly #parent: ScopeImpl | undefined;
  #items: Disposable[] = [];
  #errors = new Set<(error: PluginError) => void>();
  #disposed = false;
  constructor(runtime: Runtime, parent?: ScopeImpl) {
    this.runtime = runtime;
    this.#parent = parent;
  }
  get id() {
    return this.runtime.manifest.id;
  }
  get dataDirectory(): string {
    const directory = this.runtime.dataDirectory;
    if (!directory)
      throw failure("unavailable", "the player provided no data directory");
    return directory;
  }
  get disposed(): boolean {
    return this.#disposed || (this.#parent?.disposed ?? false);
  }
  readonly commands = commands(this);
  readonly windows = windows(this);
  readonly panels = panels(this);
  readonly dialogs = dialogs(this);
  readonly player = player(this);
  readonly video = videoFilters(this);
  readonly audio = audioFilters(this);
  readonly subtitles = subtitles(this);
  readonly media = mediaCapture(this);
  readonly resolvers = resolvers(this);
  readonly packages = packages(this);
  readonly osd = osd(this);
  readonly host = host(this);
  readonly clipboard = clipboard(this);
  readonly power = power(this);
  readonly tools = tools(this);
  readonly storage = storage(this);
  readonly system = system(this);
  scope(): Scope {
    return this.add(new ScopeImpl(this.runtime, this));
  }
  add<T extends Disposable>(item: T): T {
    if (this.#disposed) void item.dispose().catch(() => {});
    else this.#items.push(item);
    return item;
  }
  /** Handles call this when disposed directly, so the scope forgets them. */
  forget(item: Disposable) {
    this.#items = this.#items.filter((each) => each !== item);
  }
  onDispose(cleanup: () => void | Promise<void>): Disposable {
    let done = false;
    const item: Disposable = {
      dispose: async () => {
        if (done) return;
        done = true;
        this.forget(item);
        await cleanup();
      },
    };
    return this.add(item);
  }
  onError(listener: (error: PluginError) => void): Disposable {
    this.#errors.add(listener);
    return this.onDispose(() => {
      this.#errors.delete(listener);
    });
  }
  report(error: unknown) {
    const coded = toError(error);
    if (this.#errors.size)
      for (const listener of this.#errors) {
        try {
          listener(coded);
        } catch (nested) {
          console.error(`[${this.id}]`, nested);
        }
      }
    else if (this.#parent) this.#parent.report(coded);
    else console.error(`[${this.id}]`, coded);
  }
  /** Invoke plugin code on its behalf: report failures, then refresh bindings. */
  run(handler: (...args: never[]) => unknown, ...args: unknown[]) {
    if (this.disposed) return;
    try {
      const result = (handler as (...args: unknown[]) => unknown)(...args);
      if (result instanceof Promise)
        result
          .catch((error) => this.report(error))
          .finally(() => this.update());
    } catch (error) {
      this.report(error);
    }
    this.update();
  }
  update() {
    this.runtime.invalidate();
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#parent?.forget(this);
    for (const item of this.#items.splice(0).reverse()) {
      try {
        await item.dispose();
      } catch (error) {
        console.error(`[${this.id}] dispose failed:`, error);
      }
    }
    this.#errors.clear();
  }
}
