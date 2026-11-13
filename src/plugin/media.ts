/** Snapshots and offline export jobs. Operation ids and recovery stay here. */
import type {
  MediaJob,
  ProcessedCapture,
  RawCapture,
  Snapshot as Frozen,
} from "../media.ts";
import { failure, sleep, uncertain } from "./errors.ts";
import type { Runtime } from "./runtime.ts";
import { playerOf } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  CaptureOptions,
  Conditional,
  ExportEncoding,
  ExportJob,
  ExportOptions,
  JobState,
  ExportPart,
  PartsExportOptions,
  MediaCapture,
  MediaSources,
  Snapshot,
} from "./types.ts";

const TERMINAL = ["completed", "failed", "cancelled"];

/** The player's sets for each {@link ExportEncoding} field. */
const ENCODING: Record<keyof ExportEncoding, readonly unknown[]> = {
  crf: Array.from({ length: 17 }, (_, i) => i + 14),
  speed: ["faster", "balanced", "smaller"],
  maxHeight: [1080, 720, 480],
  fps: [60, 30],
  audioBitrate: [128, 192, 256],
  threads: ["single", "auto"],
  videoBitrate: ["source"],
};

/** Refuse what the player would refuse, with the field named. */
function checkEncoding(encoding: ExportEncoding): ExportEncoding {
  if (typeof encoding !== "object" || encoding === null)
    throw failure("invalid", "encoding must be an object");
  for (const [key, value] of Object.entries(encoding)) {
    const allowed = ENCODING[key as keyof ExportEncoding];
    if (!allowed) throw failure("invalid", `unknown encoding option ${key}`);
    if (value !== undefined && !allowed.includes(value))
      throw failure(
        "invalid",
        `encoding.${key} must be one of ${allowed.join(", ")}`,
      );
  }
  if (encoding.crf !== undefined && encoding.videoBitrate !== undefined)
    throw failure("invalid", "encoding takes crf or videoBitrate, not both");
  return Object.fromEntries(
    Object.entries(encoding).filter(([, value]) => value !== undefined),
  ) as ExportEncoding;
}

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

/** A live snapshot's id, for `exportCheck({ snapshot })`. */
const snapshotIds = new WeakMap<Snapshot, () => number>();

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
    snapshotIds.set(this, () => {
      if (this.#released)
        throw failure("released", "snapshot already released");
      return this.#frozen.snapshotId;
    });
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
        job = {
          kind: `${mode}Mp4`,
          end: options.end,
          ...(options.encoding === undefined
            ? {}
            : { encoding: checkEncoding(options.encoding) }),
        };
        break;
      case "copy": {
        if (processed)
          throw failure(
            "invalid",
            "a stream copy needs a raw snapshot: effects need a re-encode",
          );
        const container = options.container;
        if (
          container !== undefined &&
          !["auto", "mp4", "mkv"].includes(container)
        )
          throw failure("invalid", "container must be auto, mp4 or mkv");
        job = {
          kind: "rawCopy",
          end: options.end,
          ...(container === undefined ? {} : { container }),
        };
        break;
      }
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
      // The source now: a capture needs one, even from a plugin that never
      // read the state (its copy then starts following the player).
      const at = options.ifCurrent ?? (await player.current());
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
    sources: mediaSources(scope),
    async export(options: PartsExportOptions) {
      const runtime = scope.runtime;
      const service = serviceOf(runtime);
      if (typeof options !== "object" || options === null)
        throw failure("invalid", "export options must be an object");
      const parts = checkParts(options.parts);
      let mode: Record<string, unknown>;
      if (options.format === "copy") {
        const container = options.container;
        if (
          container !== undefined &&
          !["auto", "mp4", "mkv"].includes(container)
        )
          throw failure("invalid", "container must be auto, mp4 or mkv");
        if ((options as { encoding?: unknown }).encoding !== undefined)
          throw failure("invalid", "a copy takes no encoding");
        mode = {
          kind: "rawCopy",
          ...(container === undefined ? {} : { container }),
        };
      } else if (options.format === "mp4") {
        if ((options as { container?: unknown }).container !== undefined)
          throw failure("invalid", "a re-encode takes no container");
        mode = {
          kind: "rawMp4",
          ...(options.encoding === undefined
            ? {}
            : { encoding: checkEncoding(options.encoding) }),
        };
      } else
        throw failure(
          "invalid",
          `an export of parts is format copy or mp4, not ${String((options as { format: unknown }).format)}`,
        );
      const result = await service.mutate((operationId) =>
        runtime.host.jobs.startParts({
          operationId,
          parts,
          destination: options.destination,
          ...mode,
        } as Parameters<Runtime["host"]["jobs"]["startParts"]>[0]),
      );
      return new JobHandle(scope, service, result.jobId);
    },
    async exportCheck(
      input: ExportPart[] | { snapshot: Snapshot; end: number },
      options?: { encoding?: ExportEncoding },
    ) {
      const encoding =
        options?.encoding === undefined
          ? undefined
          : checkEncoding(options.encoding);
      if (!Array.isArray(input)) {
        // A snapshot's clip: needs no media.sources.
        const id = input?.snapshot
          ? snapshotIds.get(input.snapshot)
          : undefined;
        if (!id)
          throw failure(
            "invalid",
            "exportCheck takes parts or { snapshot, end }",
          );
        if (!Number.isFinite(input.end))
          throw failure("invalid", "end must be seconds");
        return scope.runtime.host.jobs.checkSnapshot(id(), input.end, encoding);
      }
      // As the player: parts carry their own ends; `end` is a snapshot's.
      if ((options as { end?: unknown } | undefined)?.end !== undefined)
        throw failure(
          "invalid",
          "end belongs to a snapshot's check; parts carry their own end",
        );
      return scope.runtime.host.jobs.check(checkParts(input), encoding);
    },
  };
}

/**
 * The player's bounds of remembered files and exports of their parts,
 * documented in the limits reference. Exported from `./runtime` only, for
 * the player's agreement test; TestHost and the SDK's own checks read
 * these figures. The bound on references is a resource limit; tokens are
 * an API convenience, not a security boundary.
 *
 * @internal
 */
export const MEDIA_SOURCE_LIMITS = Object.freeze({
  /** References one plugin may hold; one more fails with `limit` (500). */
  references: 500,
  /** Parts of one export or check, at least 1; more fail with `invalid` (100). */
  parts: 100,
  /** Seconds of a part's end in its file (24 hours). */
  partEnd: 86400,
  /** Seconds of all parts of one export together, as one clip (24 hours). */
  totalSeconds: 86400,
  /**
   * `remember`, `get`, `list` and checks one plugin may have the
   * player working on at the same time; one more fails with `busy` (4).
   */
  requests: 4,
  /** Seconds between two `locate` dialogs of one plugin; sooner fails with `busy` (2). */
  locateInterval: 2,
} as const);

/** Refuse what the player would refuse of an export's parts, naming the part. */
function checkParts(parts: ExportPart[]): ExportPart[] {
  if (
    !Array.isArray(parts) ||
    parts.length === 0 ||
    parts.length > MEDIA_SOURCE_LIMITS.parts
  )
    throw failure(
      "invalid",
      `an export takes 1 to ${MEDIA_SOURCE_LIMITS.parts} parts`,
    );
  const checked = parts.map((part, index) => {
    const { source, start, end } = part ?? {};
    if (typeof source !== "string" || source === "")
      throw failure("invalid", `part ${index}: source must be a token`);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start < 0 ||
      end > MEDIA_SOURCE_LIMITS.partEnd ||
      end <= start
    )
      throw failure(
        "invalid",
        `part ${index}: start and end must be seconds with 0 <= start < end <= ${MEDIA_SOURCE_LIMITS.partEnd}`,
      );
    return { source, start, end };
  });
  const total = checked.reduce((sum, part) => sum + part.end - part.start, 0);
  if (total > MEDIA_SOURCE_LIMITS.totalSeconds)
    throw failure(
      "invalid",
      `the parts are ${total} s long; an export takes at most ${MEDIA_SOURCE_LIMITS.totalSeconds} s`,
    );
  return checked;
}

function mediaSources(scope: ScopeImpl): MediaSources {
  const host = () => scope.runtime.host.mediaSources;
  const token = (value: string) => {
    if (typeof value !== "string" || value === "")
      throw failure("invalid", "token must be a non-empty string");
    return value;
  };
  return {
    async remember(options?: Conditional) {
      // Conditional like a capture: the token is for the file in `ifCurrent`.
      const expected =
        options?.ifCurrent === undefined
          ? undefined
          : (
              playerOf(scope.runtime).expected(options.ifCurrent) as {
                expected?: RawCapture["expected"];
              }
            ).expected;
      return host().remember(expected);
    },
    get: async (value: string) => host().get(token(value)),
    locate: async (value: string) => host().locate(token(value)),
    forget: async (value: string) => host().forget(token(value)),
    list: async () => host().list(),
    async open(value: string, options: { start?: number } = {}) {
      const start = options?.start;
      if (start !== undefined && !(Number.isFinite(start) && start >= 0))
        throw failure("invalid", "start must be seconds from 0");
      const checked = token(value);
      // An ordinary open, followed like player.open's (the player opens the
      // path the token stands for; the plugin never sees it).
      await playerOf(scope.runtime).submit(
        { kind: "open", source: "", startPaused: false },
        {
          send: (operationId) =>
            host().open({
              token: checked,
              operationId,
              ...(start === undefined ? {} : { start }),
            }),
        },
      );
    },
  };
}
