/**
 * Source control. Stamps, cycles, event sequences and operation ids stay in
 * here; plugins see immutable states, conditional calls and media handles.
 */
import { HostError } from "../wire.ts";
import type {
  SourceAudioTrack,
  SourceIntent,
  SourceOperation,
  SourceStamp,
  SourceState,
  SourceTicket,
} from "../source.ts";
import { Latest } from "./latest.ts";
import { abortError, failure, quiet, sleep, uncertain } from "./errors.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import { openStream, resolvedStream } from "./stream.ts";
import type { StreamSource } from "./stream.ts";
import {
  FACT_EVENTS,
  SOURCE_EVENTS,
  checkOn,
  playerOn,
} from "./player/events.ts";
import { validStep } from "./player/rules.ts";
import type {
  AudioTrack,
  Conditional,
  Disposable,
  FactEvent,
  HostEvent,
  Media,
  Player,
  PlayerState,
  PluginError,
  Scrub,
  SequenceProvider,
  SourceEvent,
} from "./types.ts";

const raws = new WeakMap<PlayerState, SourceState>();

const empty: SourceState = {
  kind: "media",
  container: null,
  audioTracks: null,
  stamp: { generation: 0, intentVersion: 0 },
  cycle: 0,
  eventSequence: -1,
  phase: "empty",
  source: null,
  loadingOwner: null,
  terminalReason: null,
  paused: false,
  position: null,
  duration: null,
  capabilities: {
    pause: false,
    seek: false,
    rate: false,
    restart: false,
    close: false,
    snapshotSource: false,
  },
  output: { volume: 100, muted: false },
  rate: 1,
};

const audioTrack = (track: SourceAudioTrack): AudioTrack =>
  Object.freeze({
    id: track.trackId,
    selected: track.selected,
    external: track.external,
    exportable: !track.external && track.streamIndex !== null,
    codec: track.codec,
    title: track.title,
    language: track.language,
    streamIndex: track.streamIndex ?? null,
  });

/**
 * The key of `plugin.player.state` in the runtime's field tracking
 * (`Runtime.depends`). Its fields are the state's own, plus `stamp` for
 * what `isCurrent` and `Media.current` compare.
 */
export const PLAYER = "player";

/** `util.inspect` shows a state's values, not its getters. */
const INSPECT = Symbol.for("nodejs.util.inspect.custom");

/** The values of a state, before they are wrapped in getters. */
type Values = Record<string, unknown>;
const values = new WeakMap<PlayerState, Values>();

/**
 * The state a plugin sees: each field a getter over the same values, so the
 * SDK learns which fields a binding or listener read (`Runtime.depends`).
 * It behaves like the plain frozen object it was: same keys in the same
 * order, enumerable, JSON, spread, `structuredClone` and `util.inspect`
 * give the values.
 */
function tracked(runtime: Runtime | undefined, data: Values): PlayerState {
  const state = {} as Record<string, unknown>;
  for (const key of Object.keys(data)) {
    const value = data[key];
    Object.defineProperty(state, key, {
      enumerable: true,
      get: () => {
        runtime?.depends(PLAYER, key);
        return value;
      },
    });
  }
  Object.defineProperty(state, INSPECT, { value: () => data });
  const frozen = Object.freeze(state) as unknown as PlayerState;
  values.set(frozen, data);
  return frozen;
}

/** The fields of `next` that differ from `last` (`stamp` included). */
function changes(
  last: PlayerState,
  lastRaw: SourceState,
  next: PlayerState,
  nextRaw: SourceState,
): string[] {
  const a = values.get(last)!;
  const b = values.get(next)!;
  const changed: string[] = [];
  for (const key of Object.keys(b)) {
    const x = a[key];
    const y = b[key];
    if (x === y) continue;
    if (
      x === null ||
      y === null ||
      typeof x !== "object" ||
      typeof y !== "object" ||
      JSON.stringify(x) !== JSON.stringify(y)
    )
      changed.push(key);
  }
  if (!sameStamp(lastRaw.stamp, nextRaw.stamp)) changed.push("stamp");
  return changed;
}

function view(raw: SourceState, runtime?: Runtime): PlayerState {
  const reason = raw.terminalReason;
  const data: PlayerState = Object.freeze({
    sourceId: raw.stamp.generation,
    kind: raw.kind === "producer" ? "stream" : "media",
    phase: raw.phase,
    source: raw.source,
    paused: raw.paused,
    position: raw.position,
    duration: raw.duration,
    rate: raw.rate,
    volume: raw.output.volume,
    muted: raw.output.muted,
    endReason: typeof reason === "string" ? reason : null,
    error:
      reason && typeof reason === "object"
        ? reason.failed
        : raw.phase === "error"
          ? "无法打开此媒体"
          : null,
    can: Object.freeze({
      pause: raw.capabilities.pause,
      seek: raw.capabilities.seek,
      rate: raw.capabilities.rate,
      restart: raw.capabilities.restart,
      close: raw.capabilities.close,
      snapshot: raw.capabilities.snapshotSource,
      next: raw.sequence?.next ?? false,
      previous: raw.sequence?.previous ?? false,
    }),
    audioTracks: raw.audioTracks?.map(audioTrack) ?? null,
    loop: raw.loop
      ? Object.freeze({ a: raw.loop.a, b: raw.loop.b, count: raw.loop.count })
      : null,
    audioOutput: Object.freeze({
      requested: raw.audioOutput?.requested ?? null,
      active: raw.audioOutput?.active ?? null,
    }),
  });
  const state = tracked(runtime, data as unknown as Values);
  raws.set(state, raw);
  return state;
}

/** `stats().video.decoding` from `hwdec` for players that do not send it. */
function decoding(hwdec: string | null | undefined) {
  if (hwdec === null || hwdec === undefined || hwdec === "") return null;
  return hwdec === "no" ? ("software" as const) : ("hardware" as const);
}

export const rawOf = (state: PlayerState) => raws.get(state);
export const sameStamp = (a: SourceStamp, b: SourceStamp) =>
  a.generation === b.generation && a.intentVersion === b.intentVersion;

function sourceFailure(
  error: Extract<SourceOperation, { status: "failed" }>["error"],
): PluginError {
  return typeof error === "string"
    ? failure(error)
    : failure("backend", error.backend);
}

/**
 * One per plugin: the state store and the operation book client.
 *
 * The state copy (a mirror of `source.state`) is started by the first use
 * of the state (a read of `plugin.player.state`, `isCurrent`, a media
 * handle, a scrub, a stream, a filter, a shader or view request, a
 * capture). It follows the player's events only while something holds
 * `source.state` (a stream, a `player.on` listener of it, a media
 * handle's `ready` or `onEnd`, a scrub; `Connection.hold`); otherwise it
 * is the newest snapshot the plugin has: its start-up read, its own calls
 * and the state a source event carries.
 */
export class PlayerService implements StreamSource {
  readonly runtime: Runtime;
  raw: SourceState = empty;
  state: PlayerState;
  readonly #watchers = new Set<(raw: SourceState) => void>();
  #operation = 0;
  /** The mirror registered (`start`). */
  #started = false;
  /** `read()`'s one read, once asked for. */
  #read: Promise<void> | undefined;
  /** The read that calls acting on the current state wait for (`fresh`). */
  #fresh: Promise<void> | undefined;
  /** The sends waiting for that read, in the order they were made (`inTurn`). */
  readonly #waiting: (() => void)[] = [];
  readonly output: Latest<{ volume?: number; muted?: boolean }>;
  constructor(runtime: Runtime) {
    this.runtime = runtime;
    this.state = view(empty, runtime);
    // An action outside this file that changed the source (`plugin.host.run`)
    // asks for the state again through the connection.
    runtime.rereads.set("source.state", () => this.refresh());
    this.output = new Latest(async ({ volume, muted }) => {
      if (volume !== undefined)
        await runtime.host.playback.set("volume", volume);
      if (muted !== undefined) await runtime.host.playback.set("muted", muted);
      await this.refresh().catch(() => {});
    });
  }
  /**
   * `plugin.player.read()`: read the source state and the timeline now, and
   * from now on read the state again after the plugin's own actions
   * (`Connection.reads`). Idempotent: one read, however often it is called;
   * a read that failed is tried again by the next call.
   */
  read(): Promise<void> {
    return (this.#read ??= (async () => {
      this.runtime.reads = true;
      try {
        await Promise.all([
          this.refresh(),
          this.runtime.reread("timeline.changed"),
        ]);
      } catch (error) {
        this.#read = undefined;
        throw error;
      }
    })());
  }
  /**
   * Register the SDK's copy of the state (a mirror of `source.state`; a
   * plugin listens through `watch`, `follow` and `player.on`). It hears
   * the events while something holds the event (`Connection.hold`), which
   * also reads the state once more after `read()` when the subscription
   * starts. Resolves at once.
   */
  start(): Promise<void> {
    if (this.#started) return Promise.resolve();
    this.#started = true;
    this.runtime.on(
      "source.state",
      (data) => this.accept(data as SourceState),
      "held",
      true,
    );
    return Promise.resolve();
  }
  /**
   * The state as the player has it now, for a call that acts on the
   * current state (a capture): the copy as it is while it follows the
   * player's events, else read first ({@link fresh}).
   */
  async current(): Promise<PlayerState> {
    await this.start();
    const fresh = this.fresh();
    if (fresh) await fresh;
    return this.state;
  }
  /**
   * Wait until the copy is the player's current state, for a call that
   * acts on it (a control, a step, a capture, a scrub). While something
   * holds `source.state` the copy follows the player's events: nothing to
   * wait for. Otherwise it is the newest snapshot the plugin has, which an
   * admitted intent since (a pause, a seek, a new file, by anyone) made
   * stale: it is read first. Calls in a burst share one read ({@link inTurn}
   * keeps their order). A read that fails leaves the copy as it was; the
   * call goes on with it.
   */
  fresh(): Promise<void> | undefined {
    if (this.#fresh) return this.#fresh;
    // Note: `following` stays true when the subscription failed (its
    // `off` is then a rejected promise); the copy is then sent as it is.
    if (this.runtime.following("source.state")) return undefined;
    const fresh = this.refresh().then(
      () => {},
      () => {},
    );
    // Once read: cleared, then the waiting sends go out in one go, in the
    // order they were made; a call after them starts a read of its own.
    this.#fresh = fresh.then(() => {
      this.#fresh = undefined;
      for (const send of this.#waiting.splice(0)) send();
    });
    return this.#fresh;
  }
  /** Drop anything older than what was already delivered. */
  accept(raw: SourceState) {
    if (raw.eventSequence < this.raw.eventSequence) return;
    if (JSON.stringify(raw) === JSON.stringify(this.raw)) return;
    const last = this.state;
    const lastRaw = this.raw;
    this.raw = raw;
    this.state = view(raw, this.runtime);
    const changed = changes(last, lastRaw, this.state, raw);
    for (const watcher of [...this.#watchers]) watcher(raw);
    // A precise pass: only the bindings that read a changed field.
    this.runtime.changed(PLAYER, changed);
  }
  /**
   * A source event's data (`source.opening`, `source.ready`,
   * `source.ended`) as the listener gets it: `state` as a
   * {@link PlayerState}. The state of an opening or a ready is the
   * player's newest, so `plugin.player.state` takes it first (when it is
   * newer than what the plugin has): `isCurrent(state)` and `ifCurrent`
   * then hold after a wake too, without a read. An ended source's state
   * is not the player's current one and is not taken.
   */
  sourceEvent(event: string, data: unknown): unknown {
    const message = data as { state: SourceState };
    if (event !== "source.ended") this.accept(message.state);
    return { ...message, state: view(message.state) };
  }
  /**
   * `watcher` hears each accepted state while the handle lives; it holds
   * `source.state` (`Connection.hold`). `always`: the state is read once
   * more when the subscription starts, also without `read()`.
   */
  /**
   * A fact event's fields of the state: taken into the copy
   * when `belongs` holds for it, as `accept` takes a state (a precise
   * pass for the fields that changed); its event sequence is kept, so the
   * next `source.state` is accepted as before.
   */
  patch(belongs: (raw: SourceState) => boolean, fields: Partial<SourceState>) {
    if (!belongs(this.raw)) return;
    const raw = { ...this.raw, ...fields } as SourceState;
    if (JSON.stringify(raw) === JSON.stringify(this.raw)) return;
    const last = this.state;
    const lastRaw = this.raw;
    this.raw = raw;
    this.state = view(raw, this.runtime);
    const changed = changes(last, lastRaw, this.state, raw);
    for (const watcher of [...this.#watchers]) watcher(raw);
    this.runtime.changed(PLAYER, changed);
  }
  watch(watcher: (raw: SourceState) => void, always = false): Disposable {
    void this.start();
    this.#watchers.add(watcher);
    const held = this.runtime.hold("source.state", undefined, always);
    return {
      dispose: async () => {
        this.#watchers.delete(watcher);
        await held.dispose();
      },
    };
  }
  /**
   * `watch` for the SDK's own handles that send their values again when the
   * source changes (the video view, a shader channel, a processing node):
   * the copy hears `source.state` while the handle lives, but the plugin is
   * not counted as listening to it (`Connection.track`). The handle's own
   * resource is what keeps the plugin running.
   */
  track(watcher: (raw: SourceState) => void): Disposable {
    void this.start();
    this.#watchers.add(watcher);
    const tracked = this.runtime.track("source.state");
    return {
      dispose: async () => {
        this.#watchers.delete(watcher);
        await tracked.dispose();
      },
    };
  }
  /**
   * `watch`, for `plugin.player.stream`: the copy hears `source.state` while
   * the watcher is open, and the plugin counts as listening to it
   * (`Connection.follow`; the stream reads the state itself).
   */
  follow(watcher: (raw: SourceState) => void, why: () => string): Disposable {
    void this.start();
    this.#watchers.add(watcher);
    const followed = this.runtime.follow("source.state", why);
    return {
      dispose: async () => {
        this.#watchers.delete(watcher);
        await followed.dispose();
      },
    };
  }
  async refresh() {
    this.accept(await this.runtime.host.source.state());
    return this.state;
  }
  /**
   * Submit an intent and wait for its definite outcome. A reply from the host
   * is final. Only a lost reply makes the outcome uncertain; then the same
   * operation id is queried (the pipe is ordered, so the host has already
   * admitted or rejected it). "pending" means accepted and still running.
   */
  async submit(
    intent: SourceIntent,
    options: {
      signal?: AbortSignal;
      accepted?: (ticket: SourceTicket) => void;
      /**
       * Send the submit another way under this service's operation id
       * (`media.sources.open`, which the player turns into this intent's
       * `source.submit`); followed with `source.operation` as any submit.
       */
      send?: (operationId: number) => Promise<SourceOperation>;
    } = {},
  ): Promise<SourceTicket> {
    const id = ++this.#operation;
    let result: SourceOperation;
    try {
      result = await (options.send
        ? options.send(id)
        : this.runtime.host.source.submit(intent, id, options.signal));
    } catch (error) {
      if (!uncertain(error)) throw error;
      result = await this.#query(id);
    }
    let accepted: SourceTicket | undefined;
    for (
      let delay = 40;
      result.status === "pending";
      delay = Math.min(delay * 2, 500)
    ) {
      accepted = result.ticket;
      options.accepted?.(result.ticket);
      if (options.signal?.aborted) throw abortError();
      await sleep(delay);
      result = await this.#query(id);
    }
    await this.refresh().catch(() => {});
    if (result.status === "failed") {
      // Accepted, then cancelled because another source took over (e.g. while
      // a URL was still resolving): the same "replaced" as media.ready().
      if (accepted && this.raw.stamp.generation !== accepted.stamp.generation)
        throw failure("replaced", "另一个来源已替换此媒体");
      throw sourceFailure(result.error);
    }
    return result.ticket;
  }
  async #query(id: number): Promise<SourceOperation> {
    for (;;) {
      try {
        return await this.runtime.host.source.operation(id);
      } catch (error) {
        if (!uncertain(error))
          throw failure("unknown", (error as Error).message);
        await sleep(100);
      }
    }
  }
  expected(state: PlayerState | undefined): { expected?: SourceStamp } {
    const raw = raws.get(state ?? this.state);
    return raw && raw.eventSequence >= 0 ? { expected: raw.stamp } : {};
  }
  /**
   * Send a call in its turn among the plugin's calls on the source: at
   * once (in the same tick) when no read is on its way, else right after
   * that read, with the calls that waited for it in the order they were
   * made. `read`: the call acts on the current state, so a read starts
   * first when the copy does not follow the player ({@link fresh}).
   */
  inTurn<T>(send: () => Promise<T>, read = false): Promise<T> {
    if (!(read ? this.fresh() : this.#fresh)) return send();
    return new Promise<T>((resolve, reject) => {
      this.#waiting.push(() => {
        try {
          resolve(send());
        } catch (error) {
          reject(error as Error);
        }
      });
    });
  }
  /**
   * `send` with the stamp a call sends, in its turn ({@link inTurn}):
   * `ifCurrent`'s when given (as it is), else the current state's, read
   * first when the copy does not follow the player.
   */
  withStamp<T>(
    ifCurrent: PlayerState | undefined,
    send: (stamp: { expected?: SourceStamp }) => Promise<T>,
  ): Promise<T> {
    return this.inTurn(() => send(this.expected(ifCurrent)), !ifCurrent);
  }
  async control(intent: SourceIntent, options?: Conditional) {
    await this.withStamp(options?.ifCurrent, (stamp) =>
      this.submit({ ...intent, ...stamp } as SourceIntent),
    );
  }
  /** Close only if `generation` is still the player's source. */
  async closeIfCurrent(generation: number) {
    const raw = this.runtime.reads
      ? (await this.refresh(), this.raw)
      : this.raw;
    if (raw.stamp.generation !== generation || raw.phase === "empty") return;
    try {
      await this.submit({ kind: "close", expected: raw.stamp });
    } catch (error) {
      // Someone else replaced or closed it first; it is no longer ours to close.
      const code = (error as PluginError).code;
      if (!["stale", "noSource", "invalid"].includes(code)) throw error;
    }
  }
}

class MediaHandle implements Media {
  readonly #scope: ScopeImpl;
  readonly #service: PlayerService;
  readonly #ticket: SourceTicket;
  constructor(scope: ScopeImpl, service: PlayerService, ticket: SourceTicket) {
    this.#scope = scope;
    this.#service = service;
    this.#ticket = ticket;
  }
  get current() {
    void this.#service.start();
    this.#service.runtime.depends(PLAYER, "stamp");
    return this.#service.raw.stamp.generation === this.#ticket.stamp.generation;
  }
  ready(options: { signal?: AbortSignal } = {}) {
    const service = this.#service;
    return new Promise<void>((resolve, reject) => {
      const finish = (error?: PluginError) => {
        watch.dispose();
        options.signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const check = () => {
        const raw = service.raw;
        if (!this.current)
          finish(failure("replaced", "另一个来源已替换此媒体"));
        else if (raw.phase === "ready") finish();
        else if (raw.phase === "error")
          finish(failure("failed", service.state.error ?? "媒体加载失败"));
        else if (raw.phase === "ended" || raw.phase === "empty")
          finish(failure("ended", "媒体已结束"));
      };
      const abort = () => {
        finish(abortError());
        void this.close().catch((error) => this.#scope.report(error));
      };
      // The watch holds `source.state`: the copy follows the player's
      // events until it ends. A change before its subscription is in sent
      // no event, so the state is read once more then (`always`).
      const watch = service.watch(check, true);
      if (options.signal?.aborted) return abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      check();
    });
  }
  onEnd(listener: (state: PlayerState) => void): Disposable {
    let ended: number | null = null;
    const watch = this.#service.watch((raw) => {
      if (
        this.current &&
        raw.phase === "ended" &&
        raw.terminalReason === "natural" &&
        raw.cycle !== ended
      ) {
        ended = raw.cycle;
        this.#scope.run(listener, this.#service.state);
      }
    });
    return this.#scope.add({
      dispose: async () => {
        this.#scope.forget(watch);
        await watch.dispose();
      },
    });
  }
  close() {
    return this.#service.closeIfCurrent(this.#ticket.stamp.generation);
  }
}

/** SeekFence: the gesture may advance only through its own receipts. */
class ScrubHandle implements Scrub {
  #active = true;
  #allowed: SourceStamp;
  #pending: SourceStamp | null = null;
  readonly #watch: Disposable;
  readonly #queue: Latest<{ seconds: number; keyframes: boolean }>;
  readonly #service: PlayerService;
  constructor(service: PlayerService) {
    this.#service = service;
    // A scrub follows the source. When the copy did not follow it yet (the
    // mirror starts now, or nothing held `source.state`), the gesture
    // starts from the state read now, not from the plugin's old copy.
    void service.start();
    const fresh = service.fresh();
    let ready = !fresh;
    this.#allowed = { ...service.raw.stamp };
    if (fresh)
      void fresh.then(() => {
        ready = true;
        if (this.#active && !this.#pending)
          this.#allowed = { ...service.raw.stamp };
      });
    this.#watch = service.watch((raw) => {
      if (!ready) return;
      if (
        !sameStamp(raw.stamp, this.#allowed) &&
        !(this.#pending && sameStamp(raw.stamp, this.#pending))
      )
        this.end();
    });
    this.#queue = new Latest(async ({ seconds, keyframes }) => {
      if (fresh) await fresh;
      if (!this.#active) throw superseded;
      const started = Date.now();
      const expected = { ...this.#allowed };
      this.#pending = {
        ...expected,
        intentVersion: expected.intentVersion + 1,
      };
      try {
        // `keyframes` goes on the wire only when set, so players before
        // 0.5.3 (which ignore the field) see the same intent as before.
        const ticket = await service.submit({
          kind: "control",
          control: {
            kind: "seek",
            seconds,
            ...(keyframes ? { keyframes } : {}),
          },
          expected,
        });
        if (!this.#active) throw superseded;
        if (!sameStamp(ticket.stamp, this.#pending)) {
          this.end();
          throw superseded;
        }
        this.#allowed = { ...ticket.stamp };
        this.#pending = null;
      } catch (error) {
        if (error !== superseded) this.end();
        throw error;
      }
      // About one seek per display frame keeps the backend responsive.
      const wait = 34 - (Date.now() - started);
      if (wait > 0) await sleep(wait);
    });
  }
  get active() {
    return this.#active;
  }
  seek(seconds: number, options: { keyframes?: boolean } = {}) {
    if (!this.#active) return Promise.resolve(false);
    return this.#queue
      .push({ seconds, keyframes: options.keyframes === true })
      .catch((error) => (error === superseded ? false : Promise.reject(error)));
  }
  end() {
    if (!this.#active) return;
    this.#active = false;
    this.#queue.stop();
    void this.#watch.dispose();
    // `active` changed, maybe outside plugin code (a new source, a failed
    // seek): bindings that read it see it in a full pass.
    this.#service.runtime.invalidate();
  }
}
const superseded = new HostError("superseded", "gesture ended");

const value = (item: boolean | (() => boolean)) =>
  typeof item === "function" ? item() : item;

/** The host routes `sequence.step` to exactly one provider per player. */
function provideSequence(
  scope: ScopeImpl,
  provider: SequenceProvider,
): Disposable {
  const runtime = scope.runtime;
  if (runtime.services.has("sequence.provider"))
    throw new Error("this plugin already provides the sequence");
  let disposed = false;
  let last = "";
  const pump = new Latest(
    (flags: { canNext: boolean; canPrevious: boolean } | null) =>
      runtime.host.sequence.set(flags),
  );
  const flags = () => ({
    canNext: value(provider.canNext),
    canPrevious: value(provider.canPrevious),
  });
  const first = flags();
  last = JSON.stringify(first);
  quiet(runtime.starting(pump.push(first), (error) => scope.report(error)));
  const steps = runtime.raw("sequence.step", (data) => {
    if (disposed) return;
    const { direction } = data as { direction: "next" | "previous" };
    scope.run(direction === "next" ? provider.next : provider.previous);
  });
  const binding = runtime.bind(() => {
    if (disposed) return;
    const next = flags();
    const encoded = JSON.stringify(next);
    if (encoded === last) return;
    last = encoded;
    pump.push(next).catch((error) => scope.report(error));
  });
  const handle: Disposable = {
    dispose: async () => {
      if (disposed) return;
      disposed = true;
      scope.forget(handle);
      runtime.services.delete("sequence.provider");
      await steps.dispose();
      await binding.dispose();
      await pump.push(null).catch(() => {});
      pump.stop();
    },
  };
  runtime.services.set("sequence.provider", handle);
  return scope.add(handle);
}

/**
 * `audio.tracks.changed`'s data as the listener gets it (`ScopeImpl.fact`,
 * SDK 1.11.0): the tracks as {@link PlayerState.audioTracks} lists them.
 * The copy takes them first, when they are of its source.
 */
export function audioTracksChanged(runtime: Runtime, data: unknown) {
  const { sourceId, audioTracks } = data as {
    sourceId: number;
    audioTracks: SourceAudioTrack[];
  };
  playerOf(runtime).patch((raw) => raw.stamp.generation === sourceId, {
    audioTracks,
  });
  return { sourceId, audioTracks: audioTracks.map(audioTrack) };
}

/**
 * `audio.devices.changed`'s data as the listener gets it:
 * as the player sent it; the copy takes `requested` and `active` into
 * {@link PlayerState.audioOutput} first.
 */
export function audioDevicesChanged(runtime: Runtime, data: unknown) {
  const { requested, active } = data as {
    requested: string | null;
    active: string | null;
  };
  playerOf(runtime).patch(() => true, { audioOutput: { requested, active } });
  return data;
}

export const playerOf = (runtime: Runtime) =>
  runtime.service("player", () => new PlayerService(runtime));

/**
 * The player's source as a stream needs it (`stream.ts`, L1): a stream
 * follows the source, so its state copy starts following the events.
 */
export function streamSource(runtime: Runtime): StreamSource {
  const service = playerOf(runtime);
  void service.start();
  return service;
}

/** A file resolver's stream (`resolvers.ts`), over {@link streamSource}. */
export const resolvedPlayerStream = (
  scope: ScopeImpl,
  stream: Parameters<typeof resolvedStream>[2],
  signal: AbortSignal,
) => resolvedStream(scope, streamSource(scope.runtime), stream, signal);

export function player(scope: ScopeImpl): Player {
  const service = () => playerOf(scope.runtime);
  return {
    get state() {
      void service().start();
      scope.runtime.reading("source.state");
      scope.runtime.depends(PLAYER);
      return service().state;
    },
    stream(listener) {
      if (typeof listener !== "function")
        throw failure("invalid", "stream takes a function");
      const copy = service();
      const site = scope.runtime.callSite();
      let open = true;
      let called = false;
      // `player.state` is updated first (`accept`), then the listener runs,
      // then an update pass (`run`).
      const call = () => {
        if (!open) return;
        called = true;
        scope.run(listener, copy.state);
      };
      const followed = copy.follow(call, () => {
        const at = site();
        return at ? `a stream opened at ${at}` : "a stream";
      });
      // The current state once: read now. An event that came first was
      // the current state already, and the read then changed nothing.
      void copy
        .refresh()
        .catch(() => {})
        .then(() => {
          if (!called) call();
        });
      const handle: Disposable = {
        dispose: async () => {
          if (!open) return;
          open = false;
          scope.forget(handle);
          await followed.dispose();
        },
      };
      scope.add(handle);
      return Object.freeze({
        stop: () => void handle.dispose(),
      });
    },
    refresh: () => service().refresh(),
    read: () => service().read(),
    on(
      event: HostEvent | SourceEvent | FactEvent,
      listener: (data: never) => void,
    ) {
      // Checked first; the copy then starts before the listener subscribes
      // (it hears each event first in any case).
      checkOn(event, listener);
      scope.followCopy(event);
      if (SOURCE_EVENTS.has(event))
        return playerOn(scope, event, listener as never, (data) =>
          service().sourceEvent(event, data),
        );
      if (FACT_EVENTS.has(event))
        return playerOn(scope, event, listener as never, (data) =>
          scope.fact(event, data),
        );
      return playerOn(scope, event as HostEvent, listener as never);
    },
    isCurrent(state) {
      void service().start();
      const raw = raws.get(state);
      scope.runtime.depends(PLAYER, "stamp");
      return !!raw && sameStamp(raw.stamp, service().raw.stamp);
    },
    async open(source, options = {}) {
      const { signal, start } = options;
      if (signal?.aborted) throw abortError();
      if (start !== undefined && !(Number.isFinite(start) && start >= 0))
        throw failure(
          "invalid",
          "start must be a finite number of seconds, 0 or more",
        );
      let ticket: SourceTicket | undefined;
      try {
        // In its turn: after a read on its way for earlier controls.
        ticket = await service().inTurn(() =>
          service().submit(
            {
              kind: "open",
              source,
              startPaused: options.paused ?? false,
              ...(start ? { start } : {}),
              ...(options.ifCurrent
                ? service().expected(options.ifCurrent)
                : {}),
            },
            { signal, accepted: (accepted) => (ticket = accepted) },
          ),
        );
      } catch (error) {
        // Cancelling a pending open (e.g. a URL still being resolved) closes it.
        if (signal?.aborted && ticket)
          await service()
            .closeIfCurrent(ticket.stamp.generation)
            .catch(() => {});
        throw error;
      }
      const media = new MediaHandle(scope, service(), ticket);
      if (signal?.aborted) {
        await media.close().catch(() => {});
        throw abortError();
      }
      return media;
    },
    openStream: (options) =>
      openStream(scope, streamSource(scope.runtime), options),
    setPaused: (paused, options) =>
      service().control(
        { kind: "control", control: { kind: "pause", paused } },
        options,
      ),
    seek: (seconds, options) =>
      service().control(
        { kind: "control", control: { kind: "seek", seconds } },
        options,
      ),
    setRate: (rate, options) =>
      service().control(
        { kind: "control", control: { kind: "rate", rate } },
        options,
      ),
    restart: (options) => service().control({ kind: "restart" }, options),
    close: (options) => service().control({ kind: "close" }, options),
    scrub: () => new ScrubHandle(service()),
    setOutput: (output) => service().output.push({ ...output }),
    provideSequence: (provider) => provideSequence(scope, provider),
    next: () => scope.runtime.host.sequence.step("next"),
    previous: () => scope.runtime.host.sequence.step("previous"),
    async stats() {
      const raw = await scope.runtime.host.playback.stats();
      const n = <T>(value: T | undefined) => value ?? null;
      return {
        backend: raw.backend,
        session: raw.session,
        framesShown: raw.framesShown,
        framesDropped: raw.framesDropped,
        presentedFps: n(raw.presentedFps),
        video: raw.video && {
          codec: raw.video.codec,
          width: raw.video.width,
          height: raw.video.height,
          fps: raw.video.fps,
          decoder: n(raw.video.decoder),
          pixelFormat: n(raw.video.pixelFormat),
          colorspace: n(raw.video.colorspace),
          displayWidth: n(raw.video.displayWidth),
          displayHeight: n(raw.video.displayHeight),
          displayFps: n(raw.video.displayFps),
          bitrate: n(raw.video.bitrate),
          hwdec: n(raw.video.hwdec),
          decoding: raw.video.decoding ?? decoding(raw.video.hwdec),
          transfer: n(raw.video.transfer),
        },
        audio: raw.audio && {
          codec: raw.audio.codec,
          sampleRate: raw.audio.sampleRate,
          channels: raw.audio.channels,
          decoder: n(raw.audio.decoder),
          format: n(raw.audio.format),
          channelLayout: n(raw.audio.channelLayout),
          bitrate: n(raw.audio.bitrate),
        },
        avSyncMs: n(raw.avSyncMs),
        cacheSeconds: n(raw.cacheSeconds),
      };
    },
    async addAudioTrack(path, options = {}) {
      const added = await service().withStamp(
        options.ifCurrent,
        ({ expected }) =>
          scope.runtime.host.audio.add(path, options.select ?? true, expected),
      );
      await service()
        .refresh()
        .catch(() => {});
      return audioTrack(added);
    },
    async step(unit, direction, options = {}) {
      if (unit !== "frame" && unit !== "keyframe")
        throw failure("invalid", "unit is frame or keyframe");
      if (direction !== "backward" && direction !== "forward")
        throw failure("invalid", "direction is backward or forward");
      await service().withStamp(options.ifCurrent, ({ expected }) =>
        scope.runtime.host.step.step(unit, direction, expected),
      );
      await service()
        .refresh()
        .catch(() => {});
    },
    async setStepSeek({ seconds, keyframes }) {
      if (!validStep(seconds))
        throw failure("invalid", "seconds must be 0.1–3600 in tenths");
      if (keyframes !== undefined && typeof keyframes !== "boolean")
        throw failure("invalid", "keyframes must be a boolean");
      await scope.runtime.host.step.setStepSeek(seconds, keyframes);
    },
    async audioDevices() {
      const devices = await scope.runtime.host.audioOutput.devices();
      return devices.map((d) => ({ id: d.id, name: d.name }));
    },
    async setAudioDevice(id) {
      if (id !== null && (typeof id !== "string" || !id || id.length > 512))
        throw failure("invalid", "id must be a device id or null");
      await scope.runtime.host.audioOutput.set(id);
      await service()
        .refresh()
        .catch(() => {});
    },
    async chapters() {
      const { sourceId, chapters } = await scope.runtime.host.marks.chapters();
      return {
        sourceId,
        chapters: chapters.map((c) => ({ title: c.title, start: c.start })),
      };
    },
    async setLoop(loop, options = {}) {
      if (loop !== null) {
        const { a, b, count } = loop ?? {};
        if (!Number.isFinite(a) || !Number.isFinite(b) || !(a >= 0 && a < b))
          throw failure("invalid", "loop needs finite 0 <= a < b");
        if (
          count !== undefined &&
          (!Number.isInteger(count) || count < 1 || count > 1_000_000)
        )
          throw failure("invalid", "count must be an integer 1–1000000");
      }
      await service().withStamp(options.ifCurrent, ({ expected }) =>
        scope.runtime.host.marks.setLoop(
          loop && {
            a: loop.a,
            b: loop.b,
            ...(loop.count === undefined ? {} : { count: loop.count }),
          },
          expected,
        ),
      );
      await service()
        .refresh()
        .catch(() => {});
    },
    async selectAudioTrack(id, options = {}) {
      await service().withStamp(options.ifCurrent, ({ expected }) =>
        scope.runtime.host.audio.select(id, expected),
      );
      return service().refresh();
    },
    async removeAudioTrack(id, options = {}) {
      if (!Number.isInteger(id))
        throw failure("invalid", "id requires an integer");
      await service().withStamp(options.ifCurrent, ({ expected }) =>
        scope.runtime.host.audio.remove(id, expected),
      );
      return service().refresh();
    },
    async seekSubtitle(direction, options = {}) {
      if (!["next", "previous", "current"].includes(direction))
        throw failure(
          "invalid",
          'direction is "next", "previous" or "current"',
        );
      await service().withStamp(options.ifCurrent, ({ expected }) =>
        scope.runtime.host.step.seekSubtitle(direction, expected),
      );
    },
  };
}
