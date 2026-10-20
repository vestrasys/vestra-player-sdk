/**
 * Owned processing resources. Revisions, the generation CAS, operation-token
 * recovery and backend faults are handled here; plugins set a desired chain.
 */
import type { AudioNode, ProcessingChange, VideoNode } from "../processing.ts";
import { failure, sleep, uncertain } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { PlayerService } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  AudioFilter,
  FilterStatus,
  PluginError,
  VideoFilter,
} from "./types.ts";

type Stage = "video" | "audio";
type Desired = { nodes: (VideoNode | AudioNode)[]; offsetMs: number };
const nothing = JSON.stringify({ nodes: [], offsetMs: 0 });

class FilterHandle {
  readonly #scope: ScopeImpl;
  readonly #stage: Stage;
  readonly #id: string;
  #desired: Desired = { nodes: [], offsetMs: 0 };
  /** What the host holds for this resource; a resource never created holds nothing. */
  #applied = nothing;
  #revision = 0;
  #status: FilterStatus = { state: "waiting" };
  /** Set by a definite failure; cleared by `set`, `retry` or a new source. */
  #failed = false;
  #loop: Promise<void> | undefined;
  #again = false;
  /** Consecutive replies lost before the host admitted the change. */
  #lost = 0;
  #disposed = false;
  #source = "";
  readonly #listeners = new Set<(status: FilterStatus) => void>();
  readonly #watch;
  constructor(
    scope: ScopeImpl,
    stage: Stage,
    id: string,
    player: PlayerService,
  ) {
    this.#scope = scope;
    this.#stage = stage;
    this.#id = id;
    // Only phase/source changes matter, not the 10 Hz position updates.
    this.#watch = player.watch((raw) => {
      const source = `${raw.stamp.generation}:${raw.phase}`;
      if (source === this.#source) return;
      this.#source = source;
      this.#failed = false;
      this.#kick();
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
  setDesired(desired: Desired) {
    this.#desired = desired;
    this.#failed = false;
    this.#kick();
  }
  retry() {
    this.#failed = false;
    this.#kick();
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
  /** One replace in flight; changes meanwhile cause one more pass. */
  #kick() {
    if (this.#loop) {
      this.#again = true;
      return;
    }
    this.#loop = (async () => {
      try {
        do {
          this.#again = false;
          if (!this.#disposed && !this.#failed) await this.#apply();
        } while (this.#again && !this.#disposed);
      } finally {
        this.#loop = undefined;
      }
    })();
  }
  async #apply() {
    const host = this.#scope.runtime.host;
    const desired = this.#desired;
    const source = this.#source;
    const wanted = JSON.stringify(desired);
    try {
      const state = await host.processing.state();
      const fault = state.backendUncertain[this.#stage];
      // The host blocks a stage whose backend cleanup is uncertain.
      if (fault) throw failure("backend-uncertain", fault);
      if (state.source.phase !== "ready") {
        // Keep the value. Resources survive reloads (the host replays them on
        // the next ready source); anything not yet applied is sent then.
        this.#report({ state: "waiting" });
        return;
      }
      if (wanted === this.#applied) {
        this.#report({ state: "applied" });
        return;
      }
      const own = state[this.#stage].find((each) => this.#mine(each.resource));
      this.#revision = Math.max(this.#revision, own?.revision ?? 0) + 1;
      const change = {
        stage: this.#stage,
        resourceId: this.#id,
        revision: this.#revision,
        expectedGeneration: state.source.generation,
        nodes: desired.nodes,
        ...(this.#stage === "audio" ? { offsetMs: desired.offsetMs } : {}),
      } as ProcessingChange;
      this.#report({ state: "applying" });
      if (await this.#replace(change)) {
        this.#lost = 0;
        this.#applied = wanted;
        if (this.#desired === desired) this.#report({ state: "applied" });
      } else if (++this.#lost < 3) {
        // It definitely did not run; resend under a fresh revision.
        await sleep(100);
        this.#again = true;
      } else throw failure("unknown", "处理请求多次未送达宿主");
    } catch (error) {
      const coded = error as PluginError;
      // The source moved on between reading state and replacing: try again
      // against the new source (or wait for it to become ready).
      if (coded.code === "stale" || coded.code === "unavailable") {
        this.#report({ state: "waiting" });
        // "unavailable" can precede the load confirmation by a moment.
        if (coded.code === "unavailable")
          setTimeout(() => this.#kick(), 250).unref?.();
        return;
      }
      this.#lost = 0;
      // A failure of a value already replaced by `set()`, or of an attempt
      // against an earlier source, says nothing about the current value.
      if (this.#desired !== desired || this.#source !== source) {
        this.#again = true;
        return;
      }
      this.#failed = true;
      this.#report({ state: "failed", error: coded });
    }
  }
  /**
   * True when applied, false when it definitely did not execute. A host reply
   * is final; only a lost reply is resolved through the operation token.
   */
  async #replace(change: ProcessingChange): Promise<boolean> {
    const host = this.#scope.runtime.host;
    try {
      await host.processing.replace(change);
      return true;
    } catch (error) {
      if (!uncertain(error)) throw error;
    }
    const token = {
      stage: change.stage,
      resourceId: change.resourceId,
      revision: change.revision,
    };
    for (;;) {
      let result;
      try {
        result = await host.processing.operation(token);
      } catch (error) {
        if (!uncertain(error)) throw error;
        await sleep(100);
        continue;
      }
      if (result.status === "completed") return true;
      if (result.status === "failed")
        throw failure(result.error.code, result.error.message);
      // The pipe is ordered: "unknown" after the request means it was never
      // admitted, so it did not execute and a new revision is safe.
      if (result.status === "unknown") return false;
      if (result.status === "unknownExpired") {
        // History evicted; the resource itself tells whether it took effect.
        const state = await host.processing.state();
        return state[change.stage].some(
          (each) =>
            this.#mine(each.resource) && each.revision === change.revision,
        );
      }
      await sleep(100);
    }
  }
  #mine(resource: { manifestId: string; resourceId: string }) {
    return (
      resource.manifestId === this.#scope.runtime.manifest.id &&
      resource.resourceId === this.#id
    );
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    await this.#watch.dispose();
    await this.#loop;
    // Remove only this plugin's contribution. When the plugin stops, the host
    // revokes the owner's resources anyway and this request is refused.
    this.#desired = { nodes: [], offsetMs: 0 };
    if (this.#applied !== nothing) await this.#apply();
  }
}

export function videoFilters(scope: ScopeImpl) {
  return {
    filter(id: string): VideoFilter {
      const handle = new FilterHandle(scope, "video", id, playerService(scope));
      return wrap(handle, (nodes: VideoNode[]) =>
        handle.setDesired({ nodes, offsetMs: 0 }),
      );
    },
  };
}

export function audioFilters(scope: ScopeImpl) {
  return {
    filter(id: string): AudioFilter {
      const handle = new FilterHandle(scope, "audio", id, playerService(scope));
      return wrap(handle, (value: { nodes: AudioNode[]; delayMs?: number }) =>
        handle.setDesired({ nodes: value.nodes, offsetMs: value.delayMs ?? 0 }),
      );
    },
  };
}

const playerService = (scope: ScopeImpl) => playerOf(scope.runtime);

function wrap<T>(handle: FilterHandle, set: (value: T) => void) {
  return {
    set,
    get status() {
      return handle.status;
    },
    onStatus: (listener: (status: FilterStatus) => void) =>
      handle.onStatus(listener),
    retry: () => handle.retry(),
    dispose: () => handle.dispose(),
  };
}
