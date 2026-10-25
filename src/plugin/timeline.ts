/** Seek-bar marks (`plugin.timeline`): one layer per plugin, merged by the player. */
import { failure, Latest, quiet } from "./runtime.ts";
import type { TextJson } from "../i18n.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { WireMark } from "../wire.ts";
import type { Timeline, TimelineLayer, TimelineMark } from "./types.ts";

const view = (marks: WireMark[]): readonly TimelineMark[] =>
  Object.freeze(
    marks.map((mark) =>
      Object.freeze({
        time: mark.time,
        kind: mark.kind,
        title: mark.title ?? null,
        plugin: mark.plugin,
      }),
    ),
  );

/**
 * One per plugin: read before activation (with `playback.read`), then kept
 * current from `timeline.changed` (with `events`) once the plugin uses it.
 */
export class TimelineService {
  readonly #runtime: Runtime;
  marks: readonly TimelineMark[] = Object.freeze([]);
  readonly #listeners = new Set<(marks: readonly TimelineMark[]) => void>();
  #started = false;
  layer = false;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
  }
  async init() {
    if (this.#runtime.can("playback.read")) await this.read();
  }
  start() {
    if (this.#started) return;
    this.#started = true;
    this.#runtime.on("timeline.changed", (data) => {
      const marks = (data as { marks?: WireMark[] } | null)?.marks;
      if (Array.isArray(marks)) this.accept(marks);
      else void this.read();
    });
  }
  accept(marks: WireMark[]) {
    const next = view(marks);
    if (JSON.stringify(next) === JSON.stringify(this.marks)) return;
    this.marks = next;
    for (const listener of [...this.#listeners]) listener(next);
    this.#runtime.invalidate();
  }
  async read() {
    const result = await this.#runtime.host.timeline.marks().catch(() => null);
    if (result) this.accept(result.marks);
  }
  watch(listener: (marks: readonly TimelineMark[]) => void) {
    this.#listeners.add(listener);
    return { dispose: async () => void this.#listeners.delete(listener) };
  }
}

export const timelineOf = (runtime: Runtime) =>
  runtime.service("timeline", () => new TimelineService(runtime));

export function timeline(scope: ScopeImpl): Timeline {
  const service = () => timelineOf(scope.runtime);
  return {
    get marks() {
      service().start();
      return service().marks;
    },
    onChange(listener) {
      service().start();
      const watch = service().watch((marks) => scope.run(listener, marks));
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
    layer() {
      if (service().layer)
        throw new Error("a plugin has one timeline layer; reuse it");
      if (!scope.runtime.can("timeline.marks"))
        throw failure(
          "capability",
          "timeline.marks must be declared in manifest",
        );
      service().layer = true;
      return new Layer(scope);
    },
  };
}

type Write = {
  marks: { time: number; kind: string; title?: string | TextJson }[];
  sourceId?: number;
};

class Layer implements TimelineLayer {
  readonly #scope: ScopeImpl;
  readonly #latest: Latest<Write>;
  #disposed = false;
  constructor(scope: ScopeImpl) {
    this.#scope = scope;
    this.#latest = new Latest(async (write) => {
      await scope.runtime.host.timeline.set(write.marks, write.sourceId);
    });
    scope.add(this);
  }
  set: TimelineLayer["set"] = (marks, options = {}) => {
    if (this.#disposed) return;
    if (!Array.isArray(marks)) {
      this.#scope.report(failure("invalid", "marks must be a list"));
      return;
    }
    const write: Write = {
      marks: marks.map((mark) => ({
        time: mark?.time,
        kind: mark?.kind,
        ...(mark?.title === undefined
          ? {}
          : { title: mark.title as string | TextJson }),
      })),
    };
    if (options.ifCurrent) write.sourceId = options.ifCurrent.sourceId;
    quiet(this.#latest.push(write).catch((error) => this.#scope.report(error)));
  };
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    this.#latest.stop();
    timelineOf(this.#scope.runtime).layer = false;
    await this.#scope.runtime.host.timeline.set([]).catch(() => {});
  }
}
