/**
 * Player-wide video settings with one owner at a time:
 *
 * - the display layer (`plugin.video.view()`): aspect override, fit, zoom
 *   and pan of the video area;
 * - the render options (`plugin.video.render()`): HDR tone mapping, user
 *   shaders and interpolation, applied by the GPU renderer.
 *
 * The first plugin to call one owns it; the owner's `dispose` (or the plugin
 * stopping) puts the defaults back.
 */
import { failure, Latest, quiet } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  Disposable,
  FilterStatus,
  PluginError,
  RenderOptions,
  RenderSettings,
  VideoView,
  ViewSettings,
} from "./types.ts";
import { isAbsolute } from "node:path";

export const VIEW_DEFAULTS: ViewSettings = Object.freeze({
  aspect: null,
  fit: "keep",
  zoom: 1,
  panX: 0,
  panY: 0,
});

const RANGES: Record<string, [number, number]> = {
  aspect: [0.25, 4],
  zoom: [0.25, 4],
  panX: [-1, 1],
  panY: [-1, 1],
};

const notObject = (values: unknown) =>
  typeof values !== "object" || values === null || Array.isArray(values);
const outside = (value: unknown, [min, max]: [number, number]) =>
  typeof value !== "number" ||
  !Number.isFinite(value) ||
  value < min ||
  value > max;

/** Why `values` would be refused (`null` when valid); the player's own rules. */
export function viewProblem(values: unknown): string | null {
  if (notObject(values)) return "view settings must be an object";
  for (const [key, value] of Object.entries(values as object)) {
    if (key === "fit") {
      if (!["keep", "stretch", "fill"].includes(value as string))
        return "fit must be keep, stretch or fill";
      continue;
    }
    if (key === "aspect" && value === null) continue;
    const range = RANGES[key];
    if (!range) return `unknown view field ${key}`;
    if (outside(value, range))
      return `${key} must be a number in ${range[0]}..${range[1]}`;
  }
  return null;
}

export const RENDER_DEFAULTS: RenderSettings = Object.freeze({
  toneMapping: "auto",
  targetPeak: 203,
  peakDetect: true,
  shaders: Object.freeze([]) as unknown as string[],
  interpolation: false,
});
export const TONE_MAPPINGS = [
  "auto",
  "off",
  "bt.2390",
  "hable",
  "mobius",
  "reinhard",
  "clip",
] as const;
export const MAX_SHADERS = 16;

/**
 * Why `values` would be refused (`null` when valid). The player also refuses
 * shader files that do not exist; that is checked there, not here.
 */
export function renderProblem(values: unknown): string | null {
  if (notObject(values)) return "render settings must be an object";
  for (const [key, value] of Object.entries(values as object)) {
    switch (key) {
      case "toneMapping":
        if (!TONE_MAPPINGS.includes(value as never))
          return `toneMapping must be one of ${TONE_MAPPINGS.join(", ")}`;
        break;
      case "targetPeak":
        if (outside(value, [100, 400]))
          return "targetPeak must be a number in 100..400";
        break;
      case "peakDetect":
      case "interpolation":
        if (typeof value !== "boolean") return `${key} must be a boolean`;
        break;
      case "shaders": {
        if (!Array.isArray(value) || value.some((p) => typeof p !== "string"))
          return "shaders must be an array of paths";
        if (value.length > MAX_SHADERS) return `at most ${MAX_SHADERS} shaders`;
        const relative = value.find((path: string) => !isAbsolute(path));
        if (relative !== undefined)
          return `shader path must be absolute: ${relative}`;
        break;
      }
      default:
        return `unknown render field ${key}`;
    }
  }
  return null;
}

interface Kind<T> {
  /** The runtime service marking "this plugin has one". */
  service: string;
  defaults: T;
  problem(values: unknown): string | null;
  send(scope: ScopeImpl, values: T): Promise<{ state: "applied" | "waiting" }>;
  release(scope: ScopeImpl): Promise<void>;
  /** A raw host event that sets the status (`failed` pushed later). */
  pushed?: string;
}

class OwnedSettings<T extends object> implements Disposable {
  readonly #scope: ScopeImpl;
  readonly #kind: Kind<T>;
  #desired: T;
  #status: FilterStatus = { state: "waiting" };
  #disposed = false;
  #source = "";
  readonly #listeners = new Set<(status: FilterStatus) => void>();
  readonly #latest: Latest<T>;
  readonly #watch;
  readonly #pushed: Disposable | undefined;
  constructor(scope: ScopeImpl, kind: Kind<T>) {
    this.#scope = scope;
    this.#kind = kind;
    this.#desired = { ...kind.defaults };
    this.#latest = new Latest(async (values) => {
      const { state } = await kind.send(scope, values);
      if (this.#desired === values) this.#report({ state });
    });
    // Taken now (the first plugin to call it owns it); a conflict shows in
    // `status`, and the next `set` tries again.
    this.#send();
    // Only a new source or phase matters: "waiting" becomes "applied".
    this.#watch = playerOf(scope.runtime).watch((raw) => {
      const source = `${raw.stamp.generation}:${raw.phase}`;
      if (source === this.#source) return;
      const first = this.#source === "";
      this.#source = source;
      if (!first && this.#status.state !== "failed") this.#send();
    });
    this.#pushed =
      kind.pushed === undefined
        ? undefined
        : scope.runtime.raw(kind.pushed, (data) => {
            const { error } = data as {
              error?: { code?: string; message?: string };
            };
            if (this.#disposed || !error) return;
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
  set(value: Partial<T>) {
    if (this.#disposed) return;
    const problem = this.#kind.problem(value);
    if (problem) {
      // Out of range: refused at once; what is applied stays.
      this.#fail(failure("invalid", problem));
      return;
    }
    this.#desired = { ...this.#desired, ...value };
    this.#send();
  }
  #send() {
    const values = this.#desired;
    this.#report({ state: "applying" });
    quiet(
      this.#latest.push(values).catch((error: PluginError) => {
        if (this.#desired === values && !this.#disposed) this.#fail(error);
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
    await this.#pushed?.dispose();
    this.#scope.runtime.services.delete(this.#kind.service);
    // Defaults back and the settings free; refused (and moot) once stopped.
    await this.#kind.release(this.#scope).catch(() => {});
  }
}

function owned<T extends object>(
  scope: ScopeImpl,
  kind: Kind<T>,
  what: string,
): OwnedSettings<T> {
  const runtime = scope.runtime;
  if (!runtime.can("processing.video"))
    throw failure(
      "capability",
      "processing.video must be declared in manifest",
    );
  if (runtime.services.has(kind.service))
    throw new Error(`a plugin has one ${what}; reuse it`);
  runtime.services.set(kind.service, true);
  return new OwnedSettings(scope, kind);
}

const VIEW: Kind<ViewSettings> = {
  service: "video.view",
  defaults: VIEW_DEFAULTS,
  problem: viewProblem,
  send: (scope, values) => scope.runtime.host.video.viewSet(values),
  release: (scope) => scope.runtime.host.video.viewRelease(),
};
const RENDER: Kind<RenderSettings> = {
  service: "video.render",
  defaults: RENDER_DEFAULTS,
  problem: renderProblem,
  send: (scope, values) =>
    scope.runtime.host.video.renderSet({
      ...values,
      shaders: [...values.shaders],
    }),
  release: (scope) => scope.runtime.host.video.renderRelease(),
  pushed: "video.render.status",
};

export function videoView(scope: ScopeImpl): VideoView {
  return owned(scope, VIEW, "display layer view");
}

export function videoRender(scope: ScopeImpl): RenderOptions {
  return owned(scope, RENDER, "render options handle");
}
