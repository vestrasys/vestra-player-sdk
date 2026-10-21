/**
 * The display layer (`plugin.video.view()`): aspect override, fit, zoom and
 * pan of the video area. One owner at a time; the owner's `dispose` (or the
 * plugin stopping) puts the defaults back.
 */
import { failure, Latest, quiet } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  FilterStatus,
  PluginError,
  VideoView,
  ViewSettings,
} from "./types.ts";

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

/** Why `values` would be refused (`null` when valid); the player's own rules. */
export function viewProblem(values: unknown): string | null {
  if (typeof values !== "object" || values === null || Array.isArray(values))
    return "view settings must be an object";
  for (const [key, value] of Object.entries(values)) {
    if (key === "fit") {
      if (!["keep", "stretch", "fill"].includes(value as string))
        return "fit must be keep, stretch or fill";
      continue;
    }
    if (key === "aspect" && value === null) continue;
    const range = RANGES[key];
    if (!range) return `unknown view field ${key}`;
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      value < range[0] ||
      value > range[1]
    )
      return `${key} must be a number in ${range[0]}..${range[1]}`;
  }
  return null;
}

class ViewHandle implements VideoView {
  readonly #scope: ScopeImpl;
  #desired: ViewSettings = { ...VIEW_DEFAULTS };
  #status: FilterStatus = { state: "waiting" };
  #disposed = false;
  #source = "";
  readonly #listeners = new Set<(status: FilterStatus) => void>();
  readonly #latest: Latest<ViewSettings>;
  readonly #watch;
  constructor(scope: ScopeImpl) {
    this.#scope = scope;
    this.#latest = new Latest(async (values) => {
      const { state } = await scope.runtime.host.video.viewSet(values);
      if (this.#desired === values) this.#report({ state });
    });
    // Taken now (the first plugin to call `view()` owns the layer); a
    // conflict shows in `status`, and the next `set` tries again.
    this.#send();
    // Only a new source or phase matters: "waiting" becomes "applied".
    this.#watch = playerOf(scope.runtime).watch((raw) => {
      const source = `${raw.stamp.generation}:${raw.phase}`;
      if (source === this.#source) return;
      const first = this.#source === "";
      this.#source = source;
      if (!first && this.#status.state !== "failed") this.#send();
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
  set(value: Partial<ViewSettings>) {
    if (this.#disposed) return;
    const problem = viewProblem(value);
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
    this.#scope.runtime.services.delete("video.view");
    // Defaults back and the layer free; refused (and moot) once stopped.
    await this.#scope.runtime.host.video.viewRelease().catch(() => {});
  }
}

export function videoView(scope: ScopeImpl): VideoView {
  const runtime = scope.runtime;
  if (!runtime.can("processing.video"))
    throw failure(
      "capability",
      "processing.video must be declared in manifest",
    );
  if (runtime.services.has("video.view"))
    throw new Error("a plugin has one display layer view; reuse it");
  runtime.services.set("video.view", true);
  return new ViewHandle(scope);
}
