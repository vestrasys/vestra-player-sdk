/**
 * The shader channel `plugin.video.shaders(id)` (SDK 1.5.39, player
 * 0.5.20): this plugin's own mpv user shaders, joined by the player with
 * every other plugin's in a stable order. Unlike `video.render()` any
 * number of plugins hold one at a time; each handle sends its whole list
 * (last write wins) and the player answers `applied`, `waiting` (no ready
 * media), or a failure.
 */
import { isAbsolute } from "node:path";
import { failure, Latest, quiet } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  Disposable,
  FilterStatus,
  PluginError,
  VideoShaders,
} from "./types.ts";
import { VIDEO_PROCESSING_LIMITS } from "../processing.ts";

/** The handle id when `shaders()` is called without one. */
export const DEFAULT_SHADERS_ID = "shaders";

/** Why `paths` would be refused here (`null` when it may be sent). */
export function shaderListProblem(paths: unknown): string | null {
  if (!Array.isArray(paths) || paths.some((p) => typeof p !== "string"))
    return "shaders must be an array of paths";
  if (paths.length > VIDEO_PROCESSING_LIMITS.shaders)
    return `at most ${VIDEO_PROCESSING_LIMITS.shaders} shaders across all plugins`;
  const relative = (paths as string[]).find((path) => !isAbsolute(path));
  if (relative !== undefined)
    return `shader path must be absolute: ${relative}`;
  return null;
}

/** Why a handle id would be refused (`null` when valid). */
export function shaderIdProblem(id: unknown): string | null {
  return typeof id === "string" &&
    id.length > 0 &&
    Buffer.byteLength(id) <= VIDEO_PROCESSING_LIMITS.shaderIdBytes &&
    ![...id].some((c) => c.codePointAt(0)! < 0x20 || c === "\u007f")
    ? null
    : `shader handle id must be 1 to ${VIDEO_PROCESSING_LIMITS.shaderIdBytes} bytes without control characters`;
}

class ShaderHandle implements Disposable {
  readonly #scope: ScopeImpl;
  readonly #id: string;
  #desired: string[] = [];
  /** Something non-empty was sent: `dispose` withdraws it. */
  #sent = false;
  #status: FilterStatus = { state: "waiting" };
  #disposed = false;
  #source = "";
  readonly #listeners = new Set<(status: FilterStatus) => void>();
  readonly #latest: Latest<string[]>;
  readonly #watch;
  readonly #pushed: Disposable;
  constructor(scope: ScopeImpl, id: string) {
    this.#scope = scope;
    this.#id = id;
    this.#latest = new Latest(async (paths) => {
      if (paths.length > 0) this.#sent = true;
      const { state } = await scope.runtime.host.video.shadersSet(id, paths);
      if (this.#desired === paths) this.#report({ state });
    });
    // `waiting` becomes `applied` when media becomes ready: ask again.
    this.#watch = playerOf(scope.runtime).watch((raw) => {
      const source = `${raw.stamp.generation}:${raw.phase}`;
      if (source === this.#source) return;
      const first = this.#source === "";
      this.#source = source;
      if (!first && this.#status.state === "waiting" && this.#sent)
        this.#send();
    });
    this.#pushed = scope.runtime.raw("video.shaders.status", (data) => {
      const { id: target, error } = data as {
        id?: string;
        error?: { code?: string; message?: string };
      };
      if (this.#disposed || target !== this.#id || !error) return;
      this.#fail(failure(error.code ?? "failed", error.message));
    });
    scope.add(this);
  }
  get status() {
    return this.#status;
  }
  onStatus(listener: (status: FilterStatus) => void) {
    this.#listeners.add(listener);
    return this.#scope.onDispose(() => {
      this.#listeners.delete(listener);
    });
  }
  set(paths: readonly string[]) {
    if (this.#disposed) return;
    const problem = shaderListProblem(paths);
    if (problem) {
      // Refused at once; what the player holds stays.
      this.#fail(
        failure(problem.startsWith("at most") ? "limit" : "invalid", problem),
      );
      return;
    }
    this.#desired = [...paths];
    this.#send();
  }
  clear() {
    this.set([]);
  }
  #send() {
    const paths = this.#desired;
    this.#report({ state: "applying" });
    quiet(
      this.#latest.push(paths).catch((error: PluginError) => {
        if (this.#desired === paths && !this.#disposed) this.#fail(error);
      }),
    );
  }
  #fail(error: PluginError) {
    this.#report({ state: "failed", error });
    this.#scope.report(error);
  }
  #report(status: FilterStatus) {
    if (
      JSON.stringify(status) === JSON.stringify(this.#status) &&
      status.state !== "failed"
    )
      return;
    this.#status = status;
    for (const listener of this.#listeners) this.#scope.run(listener, status);
    this.#scope.update();
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    this.#latest.stop();
    await this.#watch.dispose();
    await this.#pushed.dispose();
    this.#scope.runtime.services.delete(`video.shaders:${this.#id}`);
    // Withdraw this handle's shaders; refused (and moot) once stopped: the
    // player removes a stopped plugin's shaders itself.
    if (this.#sent)
      await this.#scope.runtime.host.video
        .shadersSet(this.#id, [])
        .catch(() => {});
  }
}

export function videoShaders(scope: ScopeImpl, id?: string): VideoShaders {
  const runtime = scope.runtime;
  if (!runtime.can("processing.video"))
    throw failure(
      "capability",
      "processing.video must be declared in manifest",
    );
  const name = id ?? DEFAULT_SHADERS_ID;
  const problem = shaderIdProblem(name);
  if (problem) throw failure("invalid", problem);
  const service = `video.shaders:${name}`;
  if (runtime.services.has(service))
    throw new Error(`a shader handle "${name}" exists; reuse it`);
  runtime.services.set(service, true);
  const handle = new ShaderHandle(scope, name);
  return {
    set: (paths) => handle.set(paths),
    clear: () => handle.clear(),
    get status() {
      return handle.status;
    },
    onStatus: (listener) => handle.onStatus(listener),
    dispose: () => handle.dispose(),
  };
}
