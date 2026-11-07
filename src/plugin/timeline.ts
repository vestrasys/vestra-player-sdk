/** Seek-bar marks (`plugin.timeline`): one layer per plugin, merged by the player. */
import { failure, Latest, quiet } from "./runtime.ts";
import type { TextJson } from "../i18n.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type { WireMark, WireRange, WireTimeline } from "../wire.ts";
import type {
  Timeline,
  TimelineLayer,
  TimelineMark,
  TimelineRange,
} from "./types.ts";

/**
 * The player's limits on one plugin's timeline layer
 * ({@link TimelineLayer}). A list over them fails with code `invalid`,
 * reported to `Scope.onError` (`set` and `setRanges` never throw). The
 * player's tests check that these agree with the player.
 *
 * @example Keep a long list of ranges inside the limit
 * The plugin publishes the first 100 of its ranges; the player refuses a
 * longer list whole.
 * ```ts
 * import type { Plugin } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * declare const segments: { start: number; end: number }[];
 * // ---cut---
 * import { TIMELINE_LIMITS } from "@vestra-player/sdk/testing";
 *
 * // A longer list would be refused whole.
 * plugin.timeline.layer().setRanges(
 *   segments
 *     .slice(0, TIMELINE_LIMITS.ranges)
 *     .map((s) => ({ ...s, style: "region" as const })),
 * );
 * ```
 *
 * @since 1.6.9
 *
 * @category Testing
 */
export const TIMELINE_LIMITS = Object.freeze({
  /** Marks in one layer (`TimelineLayer.set`) (1000). */
  marks: 1000,
  /** Ranges in one layer (`TimelineLayer.setRanges`; player 0.7.6) (100). */
  ranges: 100,
  /** Characters of a mark's or a range's title, as shown (100). */
  titleChars: 100,
} as const);

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

const viewRanges = (ranges: WireRange[]): readonly TimelineRange[] =>
  Object.freeze(
    ranges.map((range) =>
      Object.freeze({
        start: range.start,
        end: range.end,
        style: range.style,
        title: range.title ?? null,
        plugin: range.plugin,
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
  ranges: readonly TimelineRange[] = Object.freeze([]);
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
    // A mirror: a plugin listens through `watch` and bindings.
    this.#runtime.on(
      "timeline.changed",
      (data) => {
        const lists = data as WireTimeline | null;
        if (lists && Array.isArray(lists.marks)) this.accept(lists);
        else void this.read();
      },
      "events",
      true,
    );
  }
  accept(lists: WireTimeline) {
    const marks = view(lists.marks);
    // Players before 0.7.6 send no ranges.
    const ranges = viewRanges(Array.isArray(lists.ranges) ? lists.ranges : []);
    const marksChanged = JSON.stringify(marks) !== JSON.stringify(this.marks);
    const rangesChanged =
      JSON.stringify(ranges) !== JSON.stringify(this.ranges);
    if (!marksChanged && !rangesChanged) return;
    if (marksChanged) this.marks = marks;
    if (rangesChanged) this.ranges = ranges;
    // `onChange` follows the marks only, as before ranges existed.
    if (marksChanged)
      for (const listener of [...this.#listeners]) listener(marks);
    this.#runtime.invalidate();
  }
  async read() {
    const result = await this.#runtime.host.timeline.marks().catch(() => null);
    if (result) this.accept(result);
  }
  watch(listener: (marks: readonly TimelineMark[]) => void) {
    this.#listeners.add(listener);
    const held = this.#runtime.hold("timeline.changed");
    return {
      dispose: async () => {
        this.#listeners.delete(listener);
        await held.dispose();
      },
    };
  }
}

export const timelineOf = (runtime: Runtime) =>
  runtime.service("timeline", () => new TimelineService(runtime));

export function timeline(scope: ScopeImpl): Timeline {
  const service = () => timelineOf(scope.runtime);
  return {
    get marks() {
      service().start();
      scope.runtime.reading("timeline.changed");
      return service().marks;
    },
    get ranges() {
      service().start();
      scope.runtime.reading("timeline.changed");
      return service().ranges;
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

type RangesWrite = {
  ranges: {
    start: number;
    end: number;
    style: string;
    title?: string | TextJson;
  }[];
  sourceId?: number;
};

class Layer implements TimelineLayer {
  readonly #scope: ScopeImpl;
  readonly #latest: Latest<Write>;
  readonly #latestRanges: Latest<RangesWrite>;
  /** Ranges were sent: disposing clears them too. */
  #ranged = false;
  #disposed = false;
  constructor(scope: ScopeImpl) {
    this.#scope = scope;
    this.#latest = new Latest(async (write) => {
      await scope.runtime.host.timeline.set(write.marks, write.sourceId);
    });
    this.#latestRanges = new Latest(async (write) => {
      await scope.runtime.host.timeline.setRanges(write.ranges, write.sourceId);
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
  setRanges: TimelineLayer["setRanges"] = (ranges, options = {}) => {
    if (this.#disposed) return;
    if (!Array.isArray(ranges)) {
      this.#scope.report(failure("invalid", "ranges must be a list"));
      return;
    }
    const write: RangesWrite = {
      ranges: ranges.map((range) => ({
        start: range?.start,
        end: range?.end,
        style: range?.style,
        ...(range?.title === undefined
          ? {}
          : { title: range.title as string | TextJson }),
      })),
    };
    if (options.ifCurrent) write.sourceId = options.ifCurrent.sourceId;
    this.#ranged = true;
    quiet(
      this.#latestRanges
        .push(write)
        .catch((error) => this.#scope.report(error)),
    );
  };
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    this.#latest.stop();
    this.#latestRanges.stop();
    timelineOf(this.#scope.runtime).layer = false;
    await this.#scope.runtime.host.timeline.set([]).catch(() => {});
    // Only a layer that sent ranges: an older player refuses the method.
    if (this.#ranged)
      await this.#scope.runtime.host.timeline.setRanges([]).catch(() => {});
  }
}
