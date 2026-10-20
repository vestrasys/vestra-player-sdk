/**
 * Shared services: the clipboard and sleep prevention go to the host; external
 * tools, settings files and the Finder run in this plugin's own process.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { chmod, mkdir, rename, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { failure } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import { systemServices } from "./local.ts";
import { playerOf } from "./player.ts";
import type {
  Clipboard,
  Host,
  JsonStore,
  Power,
  Storage,
  System,
  Tools,
} from "./types.ts";

const MAX_OUTPUT = 16 * 1024 * 1024;

export const clipboard = (scope: ScopeImpl): Clipboard => ({
  readText: () => scope.runtime.host.clipboard.readText(),
  writeText: (text) => scope.runtime.host.clipboard.writeText(text),
  writeImage: (path) => scope.runtime.host.clipboard.writeImage(path),
});

const ACTIONS = new Set<string>([
  "play-pause",
  "stop",
  "previous",
  "next",
  "frame-back",
  "frame-forward",
  "seek-backward",
  "seek-forward",
  "rate-down",
  "rate-up",
  "rate-normal",
  "volume-up",
  "volume-down",
  "mute",
]);

export const host = (scope: ScopeImpl): Host => ({
  async run(action) {
    if (!ACTIONS.has(action))
      throw failure("invalid", `unknown host action ${String(action)}`);
    await scope.runtime.host.host.run(action);
    // Like the player's own controls: `player.state` shows the result.
    if (scope.runtime.can("playback.read"))
      await playerOf(scope.runtime)
        .refresh()
        .catch(() => {});
  },
});

export const power = (scope: ScopeImpl): Power => ({
  preventSleep: (mode) => scope.runtime.host.power.preventSleep(mode),
});

export function tools(scope: ScopeImpl): Tools {
  const local = () => scope.runtime.local ?? systemServices;
  // Where each tool is, looked up once per plugin; a miss is looked up again
  // next time (the user may install it meanwhile).
  const located = () =>
    scope.runtime.service("tools.located", () => new Map<string, string>());
  const locate = async (tool: "ffmpeg" | "ffprobe") => {
    const cache = located();
    const known = cache.get(tool);
    if (known) return known;
    const found = await local().locate(tool);
    if (found) cache.set(tool, found);
    return found;
  };
  return {
    async run(tool, args, options) {
      if (tool !== "ffmpeg" && tool !== "ffprobe")
        throw failure("invalid", `unknown tool ${String(tool)}`);
      if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string"))
        throw failure("invalid", "args must be strings");
      const timeoutMs = options?.timeoutMs;
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
        throw failure("invalid", "timeoutMs must be a positive number");
      const maxOutput = options.maxOutput ?? MAX_OUTPUT;
      if (!Number.isFinite(maxOutput) || maxOutput <= 0)
        throw failure("invalid", "maxOutput must be a positive number");
      const path = await locate(tool);
      if (!path) throw failure("unavailable", `${tool} was not found`);
      // Disposing the scope ends the process like the caller's signal does.
      const controller = new AbortController();
      const forward = () => controller.abort();
      options.signal?.addEventListener("abort", forward, { once: true });
      if (options.signal?.aborted) controller.abort();
      const release = scope.onDispose(() => controller.abort());
      try {
        return await local().run(path, [...args], {
          timeoutMs,
          maxOutput,
          signal: controller.signal,
        });
      } finally {
        options.signal?.removeEventListener("abort", forward);
        await release.dispose();
      }
    },
    async available(tool) {
      return (await locate(tool)) !== null;
    },
  };
}

const NAME = /^[a-z0-9-]{1,64}$/;

class Store<T> implements JsonStore<T> {
  readonly #scope: ScopeImpl;
  readonly #path: string;
  readonly #debounce: number;
  #value: T;
  #dirty = false;
  #timer: NodeJS.Timeout | undefined;
  #writing: Promise<void> = Promise.resolve();
  #disposed = false;
  constructor(
    scope: ScopeImpl,
    directory: string,
    name: string,
    options: {
      defaults: T;
      validate?: (value: unknown) => value is T;
      debounceMs?: number;
    },
  ) {
    this.#scope = scope;
    this.#path = join(directory, `${name}.json`);
    this.#debounce = options.debounceMs ?? 300;
    this.#value = options.defaults;
    if (existsSync(this.#path)) {
      let loaded: unknown;
      let good = false;
      try {
        loaded = JSON.parse(readFileSync(this.#path, "utf8"));
        good = options.validate ? options.validate(loaded) : true;
      } catch {
        good = false;
      }
      if (good) this.#value = loaded as T;
      else {
        // Keep the broken file for the user; start from the defaults.
        try {
          renameSync(this.#path, `${this.#path}.bad-${Date.now()}`);
        } catch (error) {
          console.error(`[${scope.id}] storage ${name}:`, error);
        }
      }
    }
    scope.add(this);
  }
  get value() {
    return this.#value;
  }
  save(next: T) {
    if (this.#disposed) return;
    this.#value = next;
    this.#dirty = true;
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => {
      this.flush().catch((error) => this.#scope.report(error));
    }, this.#debounce);
  }
  flush(): Promise<void> {
    clearTimeout(this.#timer);
    this.#timer = undefined;
    if (!this.#dirty) return this.#writing;
    this.#dirty = false;
    const text = `${JSON.stringify(this.#value, null, 2)}\n`;
    // One write at a time, in order; the newest value is written last.
    this.#writing = this.#writing
      .catch(() => {})
      .then(async () => {
        const temporary = `${this.#path}.tmp-${process.pid}`;
        await mkdir(join(this.#path, ".."), { recursive: true });
        // Owner-only: settings can hold private paths and history.
        await writeFile(temporary, text, { mode: 0o600 });
        await chmod(temporary, 0o600);
        await rename(temporary, this.#path);
      });
    return this.#writing;
  }
  async dispose() {
    if (this.#disposed) return;
    await this.flush();
    this.#disposed = true;
    this.#scope.forget(this);
  }
}

export const storage = (scope: ScopeImpl): Storage => ({
  json(name, options) {
    if (typeof name !== "string" || !NAME.test(name))
      throw failure("invalid", "storage names are 1–64 of a-z, 0-9 and -");
    if (
      options.debounceMs !== undefined &&
      (!Number.isFinite(options.debounceMs) || options.debounceMs < 0)
    )
      throw failure("invalid", "debounceMs must be a non-negative number");
    return new Store(scope, scope.dataDirectory, name, options);
  },
});

export function system(scope: ScopeImpl): System {
  const exists = async (path: string) => {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  };
  const valid = (path: unknown): path is string =>
    typeof path === "string" && path.length > 0;
  return {
    async reveal(paths) {
      const list = typeof paths === "string" ? [paths] : paths;
      if (
        !Array.isArray(list) ||
        !list.length ||
        list.length > 256 ||
        !list.every(valid)
      )
        throw failure("invalid", "reveal takes 1–256 non-empty paths");
      // Absolute, so no path can read as an option of `open`.
      const present: string[] = [];
      for (const path of list.map((each) => resolve(each)))
        if ((await exists(path)) && !present.includes(path)) present.push(path);
      if (!present.length)
        throw failure("missing", `${list.join(", ")} does not exist`);
      await (scope.runtime.local ?? systemServices).open(present, true);
    },
    async openUrl(url) {
      let parsed: URL;
      try {
        if (typeof url !== "string" || url.length > 8192) throw new Error();
        parsed = new URL(url);
      } catch {
        throw failure("invalid", "url must be a well-formed http(s) address");
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
        throw failure("invalid", "only http and https addresses open");
      // The normalized form starts with the scheme, never with `-`.
      await (scope.runtime.local ?? systemServices).openUrl(parsed.href);
    },
    async openPath(path) {
      if (!valid(path))
        throw failure("invalid", "path must be a non-empty string");
      if (!(await exists(path)))
        throw failure("missing", `${path} does not exist`);
      await (scope.runtime.local ?? systemServices).open(
        [resolve(path)],
        false,
      );
    },
  };
}
