/**
 * Shared services: the clipboard, sleep prevention, showing and opening files
 * and links, secrets, session storage, the rendering choice and the video
 * upscaler go to the host; external tools and settings files run in this
 * plugin's own process.
 */
import { existsSync, readFileSync, renameSync } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { failure } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import { systemServices } from "./local.ts";
import { playerOf, validStep } from "./player.ts";
import type {
  Clipboard,
  Host,
  JsonStore,
  Power,
  Rendering,
  RenderingState,
  Secrets,
  SessionStorage,
  Storage,
  System,
  Tools,
  UpscalingState,
  VideoUpscaling,
} from "./types.ts";
import type { Json } from "../wire.ts";

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
  "fullscreen",
]);

export const host = (scope: ScopeImpl): Host => ({
  async run(action: string, options?: { seconds: number }) {
    if (!ACTIONS.has(action))
      throw failure("invalid", `unknown host action ${String(action)}`);
    const seconds = options?.seconds;
    if (options !== undefined) {
      if (action !== "seek-backward" && action !== "seek-forward")
        throw failure(
          "invalid",
          `seconds applies only to seek-backward and seek-forward, not ${action}`,
        );
      if (!validStep(seconds))
        throw failure("invalid", "seconds must be 0.1–3600 in tenths");
    }
    await scope.runtime.host.host.run(action, seconds);
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

/** Writes so far in this process; numbers each write's temporary file. */
let written = 0;
/**
 * The pending writes of each file, whichever store they come from: the same
 * name opened twice must not write or rename into one file at once.
 */
const writes = new Map<string, Promise<void>>();

/** Write `text` to `path` atomically, owner-only (0600). */
async function writeAtomic(path: string, text: string) {
  // A name of its own per write, so no other write renames it away.
  const temporary = `${path}.tmp-${process.pid}-${++written}`;
  await mkdir(join(path, ".."), { recursive: true });
  try {
    // Settings can hold private paths and history. The mode is set through
    // the handle, before the file has its name.
    const file = await open(temporary, "w", 0o600);
    try {
      await file.chmod(0o600);
      await file.writeFile(text);
    } finally {
      await file.close();
    }
    await replace(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Rename over `to`. Windows refuses while another program (a virus scanner,
 * the search indexer) has `to` open for a moment: retry for up to 2 s there.
 */
async function replace(from: string, to: string) {
  for (let attempt = 0; ; attempt++)
    try {
      return await rename(from, to);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        process.platform !== "win32" ||
        !(code === "EPERM" || code === "EACCES" || code === "EBUSY") ||
        attempt >= 20
      )
        throw error;
      await new Promise((resolve) => setTimeout(resolve, 10 + attempt * 10));
    }
}

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
    // One write per file at a time, in order; the newest value is written
    // last. The queue is per file, not per store (see `writes`).
    const path = this.#path;
    const write = (writes.get(path) ?? Promise.resolve())
      .catch(() => {})
      .then(() => writeAtomic(path, text));
    const done = () => {
      if (writes.get(path) === write) writes.delete(path);
    };
    writes.set(path, write);
    write.then(done, done);
    this.#writing = write;
    return this.#writing;
  }
  async dispose() {
    if (this.#disposed) return;
    await this.flush();
    this.#disposed = true;
    this.#scope.forget(this);
  }
}

/**
 * The player's limits on {@link SessionStorage}. A key outside them fails
 * with code `invalid`; a `set` that would make the plugin's entries larger
 * than `bytes` fails with `limit` and changes nothing. A single `set` must
 * also fit in one message to the player
 * ({@link "@vestra-player/sdk/testing"!MESSAGE_LIMIT | MESSAGE_LIMIT}, 1 MiB
 * with the key and the request around the value). The player's tests check
 * that these agree with the player.
 *
 * @example Remember a position per URL without breaking the limits
 * The plugin keeps the last position of each URL for this player session
 * and skips a URL too long to be a key. Keys are counted in UTF-8 bytes, so
 * the length is measured with `Buffer.byteLength`, not `length`; a `set`
 * that would take the plugin's entries over 1 MiB rejects with `limit` and
 * changes nothing, so the plugin clears the old entries and goes on.
 * ```ts
 * import type { Plugin, PluginError } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * declare const url: string;
 * declare const position: number;
 * // ---cut---
 * import { SESSION_STORAGE_LIMITS } from "@vestra-player/sdk/testing";
 *
 * const session = plugin.storage.session;
 * if (Buffer.byteLength(url) <= SESSION_STORAGE_LIMITS.keyBytes) {
 *   try {
 *     await session.set(url, position);
 *   } catch (error) {
 *     if ((error as PluginError).code !== "limit") throw error;
 *     // Full: start over rather than lose the newest position.
 *     for (const key of await session.keys()) await session.delete(key);
 *     await session.set(url, position);
 *   }
 * }
 * ```
 *
 * @since 1.5.25
 *
 * @category Testing
 */
export const SESSION_STORAGE_LIMITS = Object.freeze({
  /** UTF-8 bytes of a key (1024, at least 1; no NUL character). */
  keyBytes: 1024,
  /**
   * Bytes one plugin may hold at the same time: for every key, its UTF-8
   * bytes, its value written as compact JSON (`JSON.stringify(value)`) and
   * `entryBytes`.
   */
  bytes: 1024 * 1024,
  /**
   * What each key costs on top of its text and value (128): the player's
   * own bookkeeping, so that many tiny entries stay within `bytes` of memory.
   */
  entryBytes: 128,
} as const);

/** A lone surrogate: the player's JSON parser refuses the whole message. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;

/** Whether a parsed JSON value has a string or a property name with a lone surrogate. */
function hasLoneSurrogate(value: Json): boolean {
  if (typeof value === "string") return LONE_SURROGATE.test(value);
  if (Array.isArray(value)) return value.some(hasLoneSurrogate);
  if (value && typeof value === "object")
    return Object.entries(value).some(
      ([key, item]) => LONE_SURROGATE.test(key) || hasLoneSurrogate(item),
    );
  return false;
}

function sessionStorage(scope: ScopeImpl): SessionStorage {
  const keyed = (key: unknown) => {
    if (
      typeof key !== "string" ||
      !key ||
      key.includes("\0") ||
      LONE_SURROGATE.test(key) ||
      Buffer.byteLength(key) > SESSION_STORAGE_LIMITS.keyBytes
    )
      throw failure(
        "invalid",
        `session storage keys are 1–${SESSION_STORAGE_LIMITS.keyBytes} bytes of well-formed text without NUL`,
      );
    return key;
  };
  const host = () => scope.runtime.host.storageSession;
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      const found = await host().get(keyed(key));
      return "value" in found ? (found.value as T) : undefined;
    },
    async set(key, value) {
      const name = keyed(key);
      let text: string | undefined;
      try {
        text = JSON.stringify(value);
      } catch {
        text = undefined; // a cycle or a BigInt
      }
      if (text === undefined)
        throw failure(
          "invalid",
          "session storage values must be JSON; delete() removes one",
        );
      // What the player stores, and what `get` will return.
      const json = JSON.parse(text) as Json;
      if (hasLoneSurrogate(json))
        throw failure(
          "invalid",
          "session storage values must be well-formed text: a string has a lone surrogate",
        );
      await host().set(name, json);
    },
    delete: async (key) => host().delete(keyed(key)),
    keys: async () => host().keys(),
  };
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
  session: sessionStorage(scope),
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
      // Absolute: the player resolves nothing against this process's cwd.
      const present: string[] = [];
      for (const path of list.map((each) => resolve(each)))
        if ((await exists(path)) && !present.includes(path)) present.push(path);
      if (!present.length)
        throw failure("missing", `${list.join(", ")} does not exist`);
      await scope.runtime.host.system.reveal(present);
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
      await scope.runtime.host.system.openUrl(parsed.href);
    },
    async openPath(path) {
      if (!valid(path))
        throw failure("invalid", "path must be a non-empty string");
      if (!(await exists(path)))
        throw failure("missing", `${path} does not exist`);
      await scope.runtime.host.system.openPath(resolve(path));
    },
  };
}

/**
 * The player's limits on {@link Secrets}. A name or value outside them
 * fails with code `invalid`; a new name beyond `names` fails with `limit`.
 * The player's tests check that these agree with the player.
 *
 * @example Store an API token only when it fits
 * The plugin keeps a token the user pasted, or tells them it is empty or
 * too long. Values are 1–1024 bytes counted in UTF-8, so the check uses
 * `Buffer.byteLength`; `secrets.set` would refuse other values with
 * `invalid`. The store itself can still refuse (`unsupported` without a
 * system store, `unavailable` when it cannot be reached, `failed` when the
 * user denies access): only
 * those codes get the "could not be saved" message, anything else (a
 * missing `secrets` capability) is a bug and is thrown on.
 * ```ts
 * import type { Plugin, PluginError } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * declare const token: string;
 * // ---cut---
 * import { SECRET_LIMITS } from "@vestra-player/sdk/testing";
 *
 * if (!token || Buffer.byteLength(token) > SECRET_LIMITS.valueBytes) {
 *   await plugin.osd.show("Paste a token of at most 1024 bytes.");
 * } else {
 *   try {
 *     await plugin.secrets.set("api-token", token);
 *   } catch (error) {
 *     const { code } = error as PluginError;
 *     if (!["unsupported", "unavailable", "failed"].includes(code)) throw error;
 *     // No keychain or access denied: ask again next time.
 *     await plugin.osd.show("The token could not be saved.");
 *   }
 * }
 * ```
 *
 * @since 1.5.14
 *
 * @category Testing
 */
export const SECRET_LIMITS = Object.freeze({
  /**
   * Characters of a name (64, at least 1), each one of `a-z`, `0-9`, `.`,
   * `_` and `-`.
   */
  nameChars: 64,
  /** UTF-8 bytes of a value (1024, at least 1; no NUL character). */
  valueBytes: 1024,
  /** Different names one plugin may have stored at the same time (256). */
  names: 256,
} as const);

const SECRET = new RegExp(`^[a-z0-9._-]{1,${SECRET_LIMITS.nameChars}}$`);

export const secrets = (scope: ScopeImpl): Secrets => {
  const named = (name: unknown) => {
    if (!scope.runtime.can("secrets"))
      throw failure("capability", "secrets must be declared in manifest");
    if (typeof name !== "string" || !SECRET.test(name))
      throw failure(
        "invalid",
        `secret names are 1–${SECRET_LIMITS.nameChars} of a-z, 0-9, ., _ and -`,
      );
    return name;
  };
  return {
    get: async (name) => scope.runtime.host.secrets.get(named(name)),
    async set(name, value) {
      if (
        typeof value !== "string" ||
        !value ||
        value.includes("\0") ||
        Buffer.byteLength(value) > SECRET_LIMITS.valueBytes
      )
        throw failure(
          "invalid",
          `secret values are 1–${SECRET_LIMITS.valueBytes} bytes of text; delete() removes one`,
        );
      await scope.runtime.host.secrets.set(named(name), value);
    },
    delete: async (name) => scope.runtime.host.secrets.delete(named(name)),
  };
};

const PREFERENCES = new Set<string>(["auto", "gpu", "software"]);

export const rendering = (scope: ScopeImpl): Rendering => {
  const manage = () => {
    if (!scope.runtime.can("rendering.manage"))
      throw failure(
        "capability",
        "rendering.manage must be declared in manifest",
      );
  };
  return {
    state: async () =>
      (await scope.runtime.host.rendering.state()) as RenderingState,
    async setPreference(preference) {
      manage();
      if (typeof preference !== "string" || !PREFERENCES.has(preference))
        throw failure(
          "invalid",
          'the rendering preference is "auto", "gpu" or "software"',
        );
      return (await scope.runtime.host.rendering.setPreference(
        preference,
      )) as RenderingState;
    },
    async restartPlayer() {
      manage();
      await scope.runtime.host.rendering.restart();
    },
  };
};

/**
 * `plugin.video.upscaling` (player 0.5.16): both requests need
 * `video.upscaling`; the player answers once its GPU check ran (the first
 * call starts it).
 */
export const videoUpscaling = (scope: ScopeImpl): VideoUpscaling => {
  const declared = () => {
    if (!scope.runtime.can("video.upscaling"))
      throw failure(
        "capability",
        "video.upscaling must be declared in manifest",
      );
  };
  return {
    async state() {
      declared();
      return (await scope.runtime.host.video.upscalingState()) as UpscalingState;
    },
    async set(enabled) {
      declared();
      if (typeof enabled !== "boolean")
        throw failure("invalid", "enabled must be true or false");
      return (await scope.runtime.host.video.upscalingSet(
        enabled,
      )) as UpscalingState;
    },
  };
};
