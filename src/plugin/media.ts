/** Snapshots and offline export jobs. Operation ids and recovery stay here. */
import type {
  MediaJob,
  ProcessedCapture,
  RawCapture,
  Snapshot as Frozen,
} from "../media.ts";
import { failure, sleep, uncertain } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  CaptureOptions,
  ExportJob,
  ExportOptions,
  JobState,
  MediaCapture,
  Snapshot,
} from "./types.ts";

const TERMINAL = ["completed", "failed", "cancelled"];

/** One counter for snapshot and job operations, as the host's book expects. */
class MediaService {
  readonly runtime: Runtime;
  #operation = 0;
  constructor(runtime: Runtime) {
    this.runtime = runtime;
  }
  /**
   * Run a mutation. A host reply is definite; after a lost reply the same id
   * is queried until it has an outcome (the ordered pipe means "unknown" is a
   * refusal before admission).
   */
  async mutate<T>(send: (operationId: number) => Promise<T>): Promise<T> {
    const id = ++this.#operation;
    try {
      return await send(id);
    } catch (error) {
      if (!uncertain(error)) throw error;
    }
    for (;;) {
      const result = await this.runtime.host.jobs
        .operation(id)
        .catch((error) => {
          if (!uncertain(error)) throw error;
          return null;
        });
      if (result?.status === "completed") return result.result as T;
      if (result?.status === "failed")
        throw failure(result.error.code, result.error.message);
      if (result?.status === "unknown")
        throw failure("rejected", "media operation was not accepted");
      if (result?.status === "unknownExpired")
        throw failure("expired", "media operation outcome expired");
      await sleep(250);
    }
  }
}

const serviceOf = (runtime: Runtime) =>
  runtime.service("media", () => new MediaService(runtime));

class JobHandle implements ExportJob {
  readonly #scope: ScopeImpl;
  readonly #service: MediaService;
  readonly #id: number;
  #state: JobState;
  readonly #listeners = new Set<(state: JobState) => void>();
  readonly done: Promise<JobState>;
  #disposed = false;
  constructor(scope: ScopeImpl, service: MediaService, id: number) {
    this.#scope = scope;
    this.#service = service;
    this.#id = id;
    this.#state = {
      status: "queued",
      publicationStarted: false,
      facts: null,
      outcome: null,
    };
    scope.add(this);
    this.done = this.#poll();
    this.done.catch(() => {});
  }
  get state() {
    return this.#state;
  }
  onChange(listener: (state: JobState) => void) {
    this.#listeners.add(listener);
    return this.#scope.onDispose(() => {
      this.#listeners.delete(listener);
    });
  }
  #accept(job: MediaJob) {
    const { jobId: _, ...state } = job;
    if (JSON.stringify(state) === JSON.stringify(this.#state)) return;
    this.#state = state;
    for (const listener of this.#listeners) this.#scope.run(listener, state);
    this.#scope.update();
  }
  async refresh() {
    this.#accept(await this.#service.runtime.host.jobs.state(this.#id));
    return this.#state;
  }
  async #poll(): Promise<JobState> {
    while (!this.#disposed) {
      try {
        await this.refresh();
      } catch (error) {
        if (!uncertain(error)) throw error;
      }
      if (TERMINAL.includes(this.#state.status)) return this.#state;
      await sleep(350);
    }
    throw failure("disposed", "export job handle disposed");
  }
  async cancel() {
    const result = await this.#service.mutate((operationId) =>
      this.#service.runtime.host.jobs.cancel(this.#id, operationId),
    );
    return result.cancel;
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    if (!TERMINAL.includes(this.#state.status))
      await this.cancel().catch(() => {});
  }
}

class SnapshotHandle implements Snapshot {
  readonly #scope: ScopeImpl;
  readonly #service: MediaService;
  readonly #frozen: Frozen;
  #released = false;
  constructor(scope: ScopeImpl, service: MediaService, frozen: Frozen) {
    this.#scope = scope;
    this.#service = service;
    this.#frozen = frozen;
    scope.add(this);
  }
  get kind() {
    return this.#frozen.kind;
  }
  get time() {
    return this.#frozen.time;
  }
  get source() {
    return this.#frozen.source;
  }
  get duration() {
    return this.#frozen.duration;
  }
  get audioTrack() {
    return this.#frozen.audio?.trackId ?? null;
  }
  get presentation() {
    return this.#frozen.kind === "processed" ? this.#frozen.presentation : null;
  }
  get processingRevision() {
    return this.#frozen.kind === "processed"
      ? this.#frozen.processing.revision
      : null;
  }
  async export(options: ExportOptions) {
    if (this.#released) throw failure("released", "snapshot already released");
    const processed = this.#frozen.kind === "processed";
    const snapshotId = this.#frozen.snapshotId;
    const mode = processed ? "processed" : "raw";
    const frame = (sampleTime: number | undefined) =>
      sampleTime === undefined ? {} : { sampleTime };
    let job: { kind: string } & Record<string, unknown>;
    switch (options.format) {
      case "mp4":
        job = { kind: `${mode}Mp4`, end: options.end };
        break;
      case "jpeg": {
        const quality = options.quality;
        if (
          quality !== undefined &&
          !(Number.isInteger(quality) && quality >= 1 && quality <= 100)
        )
          throw failure("invalid", "quality must be an integer 1–100");
        job = {
          kind: `${mode}Jpeg`,
          ...frame(options.sampleTime),
          ...(quality === undefined ? {} : { quality }),
        };
        break;
      }
      case "png":
      case "bmp":
        job = {
          kind: `${mode}${options.format === "png" ? "Png" : "Bmp"}`,
          ...frame(options.sampleTime),
        };
        break;
      default:
        throw failure(
          "invalid",
          `unknown export format ${String((options as { format: unknown }).format)}`,
        );
    }
    const result = await this.#service.mutate((operationId) =>
      this.#service.runtime.host.jobs.start({
        operationId,
        snapshotId,
        destination: options.destination,
        ...job,
      } as Parameters<Runtime["host"]["jobs"]["start"]>[0]),
    );
    return new JobHandle(this.#scope, this.#service, result.jobId);
  }
  async dispose() {
    if (this.#released) return;
    this.#released = true;
    this.#scope.forget(this);
    const snapshotId = this.#frozen.snapshotId;
    await this.#service
      .mutate((operationId) =>
        this.#service.runtime.host.snapshot.release(snapshotId, operationId),
      )
      .catch(() => {});
  }
}

export function mediaCapture(scope: ScopeImpl): MediaCapture {
  return {
    async capture(options: CaptureOptions = {}) {
      const runtime = scope.runtime;
      const service = serviceOf(runtime);
      const player = playerOf(runtime);
      const at = options.ifCurrent ?? player.state;
      const { expected } = player.expected(at) as {
        expected?: RawCapture["expected"];
      };
      if (!expected) throw failure("noSource", "no source to capture");
      const audio =
        options.audio === undefined || options.audio === "none"
          ? ({ kind: "none" } as const)
          : options.audio === "selected"
            ? ({ kind: "selected" } as const)
            : ({ kind: "track", trackId: options.audio } as const);
      const time = options.at === undefined ? {} : { time: options.at };
      let request: RawCapture | ProcessedCapture;
      if (options.processed) {
        // Freeze exactly the processing/subtitle configuration of this source.
        const withSubtitles = options.subtitles !== false;
        const [processing, subtitle] = await Promise.all([
          runtime.host.processing.state(),
          withSubtitles
            ? runtime.host.subtitles.state()
            : Promise.resolve(null),
        ]);
        if (
          processing.source.generation !== expected.generation ||
          (subtitle && subtitle.source.generation !== expected.generation)
        )
          throw failure(
            "stale",
            "processing or subtitle state belongs to another source",
          );
        request = {
          operationId: 0,
          expected,
          ...time,
          mode: "processed",
          audio,
          expectedProcessingRevision: processing.configurationRevision,
          ...(subtitle
            ? {
                includeSubtitles: true as const,
                expectedSubtitle: {
                  selection: subtitle.selection.stamp,
                  presentationRevision: subtitle.presentation.revision,
                },
              }
            : { includeSubtitles: false as const }),
        };
      } else
        request = { operationId: 0, expected, ...time, mode: "raw", audio };
      const captured = await service.mutate(async (operationId) => {
        const result = await runtime.host.snapshot.capture({
          ...request,
          operationId,
        } as RawCapture);
        return result as Frozen | { snapshotId: number };
      });
      // A recovered outcome carries only the id; read the full description.
      const frozen =
        "kind" in captured
          ? captured
          : await runtime.host.snapshot.state(captured.snapshotId);
      return new SnapshotHandle(scope, service, frozen);
    },
  };
}
