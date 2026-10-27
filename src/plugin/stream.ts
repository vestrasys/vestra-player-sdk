/**
 * Plugin-generated audio/video (host "producer"). The SDK owns preroll,
 * activation, pause/epoch acknowledgements, input acknowledgements and pacing;
 * the plugin only renders frames.
 */
import { failure, sleep, toError } from "./runtime.ts";
import { abortError } from "./player.ts";
import type { PlayerService } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type { ResolvedProducer } from "../source-resolvers.ts";
import type {
  PluginError,
  ResolvedStream,
  Stream,
  StreamOptions,
  StreamStartError,
} from "./types.ts";

type Socket = Awaited<
  ReturnType<PlayerService["runtime"]["host"]["producer"]["connect"]>
>;

/**
 * Frames of audio buffered ahead of the device before rendering pauses
 * (50 ms). Each pump refills the whole lead, so it must outlast one pump
 * period: the pump itself (a `producer.state` round trip and the frames),
 * plus a Windows timer tick (15.6 ms) unless the pump rendered and already
 * took {@link PERIOD}. Measured with a
 * real-time clock, round trips up to about 30 ms never let the device run
 * dry; near 50 ms they do now and then. A larger lead would add latency
 * between input and picture.
 */
const AHEAD = 2400;
/**
 * At most this many frames per pump. A lead is a few frames (three of
 * 1/60 s); the cap only stops a plugin whose frames carry next to no audio
 * from rendering without pause.
 */
const BATCH = 16;
/**
 * Milliseconds from the start of one pump to the start of the next. A pump
 * that rendered frames and already took longer is followed at once: a timer
 * on top would add a whole Windows tick (15.6 ms; a timer there never fires
 * sooner) to every pump while playing, and the period must stay well inside
 * the lead. A pump that rendered nothing (paused, lead full, a control not
 * yet acknowledged) waits this long after it ends, so an idle stream polls
 * the player no more often than it always did.
 */
const PERIOD = 5;
/** Frames written before the host is asked to select the stream. */
const PREROLL = 2048;

class StreamHandle implements Stream {
  #running = true;
  #stopping: Promise<void> | undefined;
  readonly #listeners = new Set<(error: PluginError | null) => void>();
  readonly #scope: ScopeImpl;
  readonly #service: PlayerService;
  readonly #producer: number;
  readonly #socket: Socket;
  readonly #generation: number;
  readonly #frame: StreamOptions["frame"];
  #epoch: number;
  #sample: number;
  #sequence: number;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #immediate: ReturnType<typeof setImmediate> | undefined;
  #pumping: Promise<void> = Promise.resolve();
  constructor(
    scope: ScopeImpl,
    service: PlayerService,
    setup: {
      producer: number;
      socket: Socket;
      generation: number;
      frame: StreamOptions["frame"];
      epoch: number;
      sample: number;
      sequence: number;
    },
  ) {
    this.#scope = scope;
    this.#service = service;
    this.#producer = setup.producer;
    this.#socket = setup.socket;
    this.#generation = setup.generation;
    this.#frame = setup.frame;
    this.#epoch = setup.epoch;
    this.#sample = setup.sample;
    this.#sequence = setup.sequence;
    scope.add(this);
    this.#pumping = this.#pump();
  }
  get running() {
    return this.#running;
  }
  onStop(listener: (error: PluginError | null) => void) {
    this.#listeners.add(listener);
    return this.#scope.onDispose(() => {
      this.#listeners.delete(listener);
    });
  }
  async #pump() {
    const producer = this.#service.runtime.host.producer;
    const begun = performance.now();
    try {
      const state = await producer.state(this.#producer);
      if (!this.#running) return;
      if (!state.active || state.error) {
        void this.#end(state.error ? failure("stream", state.error) : null);
        return;
      }
      // Controls apply at a frame boundary: no frame renders concurrently.
      const control = state.pendingControl;
      if (control) {
        this.#epoch = control.epoch;
        this.#sample = control.baseSample;
        this.#sequence = 0;
        await producer.ack(control);
      }
      if (state.input?.pending) await producer.ackInput(state.input.pending);
      const paused = control ? control.paused : state.paused;
      let rendered = 0;
      // Refill the whole lead now, not one frame per pump: a pump period (a
      // round trip, and a timer tick after a short pump: 16–40 ms on Windows)
      // is longer than a 1/60 s frame. No control lands while this loop runs: the next one is
      // read by the next pump, at a frame boundary.
      if (
        !control &&
        state.acknowledged &&
        state.epoch === this.#epoch &&
        !paused
      )
        while (
          this.#running &&
          rendered < BATCH &&
          this.#sample - state.consumedFrames < AHEAD
        ) {
          const before = this.#sample;
          await this.#render();
          // A frame without audio does not move the clock: wait for the next
          // pump, after a full PERIOD (it does not count as rendered).
          if (this.#sample === before) break;
          rendered++;
        }
      if (!this.#running) return;
      const next = () => {
        this.#pumping = this.#pump();
      };
      const wait = rendered ? PERIOD - (performance.now() - begun) : PERIOD;
      if (wait > 0) this.#timer = setTimeout(next, wait);
      else this.#immediate = setImmediate(next);
    } catch (error) {
      const retired = await retirement(this.#service, this.#generation, error);
      void this.#end(retired === undefined ? toError(error) : retired);
    }
  }
  async #render() {
    const frame = this.#frame();
    await writeFrame(this.#socket, frame, this, this.#epoch);
  }
  /** Shared by preroll and the pump: audio sample time defines the AV timeline. */
  advance(samples: number) {
    this.#sample += samples;
  }
  get sample() {
    return this.#sample;
  }
  nextSequence() {
    return this.#sequence++;
  }
  async #end(error: PluginError | null) {
    if (!this.#running) return;
    await this.stop();
    for (const listener of this.#listeners) this.#scope.run(listener, error);
  }
  /**
   * Close the source first (if it is still ours), while the frame connection
   * is still up: a connection that drops under a selected source is a
   * playback failure to the player ("producer transport closed"). Then the
   * connection, then the producer.
   */
  stop() {
    this.#stopping ??= (async () => {
      this.#running = false;
      clearTimeout(this.#timer);
      clearImmediate(this.#immediate);
      await this.#pumping.catch(() => {});
      try {
        await this.#service.closeIfCurrent(this.#generation);
      } finally {
        this.#socket.close();
        await this.#service.runtime.host.producer
          .release(this.#producer)
          .catch(() => {});
      }
    })();
    return this.#stopping;
  }
  async dispose() {
    this.#scope.forget(this);
    await this.stop().catch(() => {});
  }
}

/**
 * The player retires a producer the moment another source replaces it or
 * the source closes, and after it failed, so its `producer.state` then
 * answers `unavailable` (and `producer.ack` `stale`). The player's state
 * says which: `null` (replaced or closed), the failure with the player's
 * words, or `undefined` when the error is not a retirement.
 */
async function retirement(
  service: PlayerService,
  generation: number,
  error: unknown,
): Promise<PluginError | null | undefined> {
  const code = (error as PluginError | undefined)?.code;
  if (code !== "unavailable" && code !== "stale") return undefined;
  const readable = service.runtime.can("playback.read");
  if (readable) await service.refresh().catch(() => {});
  const raw = service.raw;
  if (raw.stamp.generation !== generation || raw.phase === "empty") return null;
  if (raw.phase === "error")
    return failure("stream", service.state.error ?? "无法打开此媒体");
  // Without `playback.read` the state may be behind: no failure was seen.
  return readable ? undefined : null;
}

/** Start-up timeouts say which step ran out of time. */
function timeout(
  stage: StreamStartError["stage"],
  message: string,
): StreamStartError {
  return Object.assign(failure("timeout", message), { stage });
}

type Clock = {
  sample: number;
  advance(n: number): void;
  nextSequence(): number;
};

async function writeFrame(
  socket: Socket,
  frame: { video: Uint8Array; audio: Float32Array },
  clock: Clock,
  epoch: number,
) {
  try {
    await sendFrame(socket, frame, clock, epoch);
  } catch (error) {
    // The frame broke a limit (size, sample range): the plugin's mistake.
    if (error instanceof TypeError) throw failure("invalid", error.message);
    throw error;
  }
}

async function sendFrame(
  socket: Socket,
  frame: { video: Uint8Array; audio: Float32Array },
  clock: Clock,
  epoch: number,
) {
  await socket.video(
    { epoch, sampleTime: clock.sample, sequence: clock.nextSequence() },
    frame.video,
  );
  for (let offset = 0; offset < frame.audio.length; offset += 9600) {
    const samples = frame.audio.subarray(offset, offset + 9600);
    await socket.audio(
      { epoch, sampleTime: clock.sample, sequence: clock.nextSequence() },
      samples,
    );
    clock.advance(samples.length / 2);
  }
}

/** A producer prerolled at sample zero, not yet the player's source. */
type Prepared = {
  producer: number;
  socket: Socket;
  frame: StreamOptions["frame"];
  epoch: number;
  sample: number;
  sequence: number;
};

/**
 * Prepare a producer, connect and preroll it until the host could select it.
 * `check` throws to give up (an abort); the producer is then released.
 */
async function prepare(
  host: PlayerService["runtime"]["host"],
  options: Pick<StreamOptions, "width" | "height" | "frame">,
  check: () => void,
): Promise<Prepared> {
  const bytes = options.width * options.height * 4;
  /** The plugin's frame, checked against the declared size. */
  const frame = () => {
    const next = options.frame();
    if (next?.video?.byteLength !== bytes)
      throw failure(
        "invalid",
        `frame().video must be ${options.width}×${options.height}×4 = ${bytes} bytes of RGBA`,
      );
    return next;
  };
  let producer: number | undefined;
  let socket: Socket | undefined;
  try {
    check();
    const spec = await host.producer.prepare({
      width: options.width,
      height: options.height,
    });
    producer = spec.producerId;
    check();
    socket = await host.producer.connect(spec);
    check();
    const p: Prepared = {
      producer,
      socket,
      frame,
      epoch: spec.epoch,
      sample: 0,
      sequence: 0,
    };
    const clock = clockOf(p);
    // A prepared producer is paused at sample zero. Supply a frame at zero and
    // enough contiguous PCM before asking the host to select it.
    while (p.sample < PREROLL) {
      check();
      await writeFrame(socket, frame(), clock, p.epoch);
    }
    for (const deadline = Date.now() + 10_000; ; await sleep(10)) {
      check();
      const state = await host.producer.state(producer);
      if (state.error) throw failure("stream", state.error);
      if (state.epoch !== p.epoch)
        throw failure("stream", "producer epoch changed before activation");
      if (!["ok", "recoverableXrun", "deviceChanged"].includes(state.health))
        throw failure("device", `audio device is not ready: ${state.health}`);
      if (state.acknowledged && state.receivedFrames >= 1024 && state.hasVideo)
        return p;
      if (Date.now() >= deadline)
        throw timeout("prefill", "timed out preparing the first buffers");
    }
  } catch (error) {
    socket?.close();
    if (producer !== undefined)
      await host.producer.release(producer).catch(() => {});
    throw error;
  }
}

const clockOf = (p: Prepared): Clock => ({
  get sample() {
    return p.sample;
  },
  advance: (n) => (p.sample += n),
  nextSequence: () => p.sequence++,
});

/**
 * Wait until the host runs the selected producer: acknowledge its start
 * control. `selected` says whether the host has accepted the selection yet
 * (`"selected"`: it has, and a producer no longer active was replaced);
 * `check` throws to give up.
 */
async function activate(
  host: PlayerService["runtime"]["host"],
  p: Prepared,
  check: () => void,
  selected: (() => boolean) | "selected",
) {
  for (const deadline = Date.now() + 10_000; ; await sleep(10)) {
    check();
    const state = await host.producer.state(p.producer);
    if (state.error) throw failure("stream", state.error);
    if (selected === "selected" && !state.active) throw abortError();
    if (state.pendingControl) {
      p.epoch = state.pendingControl.epoch;
      p.sample = state.pendingControl.baseSample;
      p.sequence = 0;
      await host.producer.ack(state.pendingControl);
    }
    if (
      (selected === "selected" || selected()) &&
      state.active &&
      !state.pendingControl &&
      state.acknowledged &&
      state.epoch === p.epoch
    )
      return;
    if (Date.now() >= deadline)
      throw timeout("activation", "timed out waiting for stream activation");
  }
}

/** Give a prepared producer up: its source (if still ours), connection, producer. */
async function abandon(
  service: PlayerService,
  p: Prepared,
  generation: number | undefined,
) {
  // A cancelled open may already have selected this producer: close only
  // that source, before its frame connection (as in `stop`).
  if (generation !== undefined)
    await service.closeIfCurrent(generation).catch(() => {});
  p.socket.close();
  await service.runtime.host.producer.release(p.producer).catch(() => {});
}

const handleOf = (
  scope: ScopeImpl,
  service: PlayerService,
  p: Prepared,
  generation: number,
) =>
  new StreamHandle(scope, service, {
    producer: p.producer,
    socket: p.socket,
    generation,
    frame: p.frame,
    epoch: p.epoch,
    sample: p.sample,
    sequence: p.sequence,
  });

export async function openStream(
  scope: ScopeImpl,
  service: PlayerService,
  options: StreamOptions,
): Promise<Stream> {
  const host = service.runtime.host;
  const check = () => {
    if (options.signal?.aborted || scope.disposed) throw abortError();
  };
  const p = await prepare(host, options, check);
  let generation: number | undefined;
  /** The request selecting the stream. */
  let opened: Promise<void> | undefined;
  try {
    let accepted = false;
    let failed: unknown;
    opened = service
      .submit(
        { kind: "openProvider", producerId: p.producer, startPaused: false },
        { accepted: (ticket) => (generation = ticket.stamp.generation) },
      )
      .then((ticket) => {
        generation = ticket.stamp.generation;
        accepted = true;
      });
    opened.catch((error) => (failed = error));
    // Activation needs this side to acknowledge the host's start control.
    await activate(
      host,
      p,
      () => {
        check();
        if (failed) throw failed;
      },
      () => accepted,
    );
    return handleOf(scope, service, p, generation!);
  } catch (error) {
    // An abort can arrive before the host answered the selecting request: wait
    // for that answer so a source selected afterwards is still closed.
    await opened?.catch(() => {});
    // Read before closing: replaced during activation is not a failure.
    const retired =
      generation === undefined
        ? undefined
        : await retirement(service, generation, error);
    await abandon(service, p, generation);
    if (retired === null) throw failure("replaced", "另一个来源已替换此媒体");
    throw retired ?? error;
  }
}

/**
 * What the user reads when a file resolver's stream cannot start. The
 * player shows the answer as the open's failure, and the plugin never sees
 * these errors: they happen after `resolve` returned. The SDK's and the
 * player's own codes get the player's words; the detail goes to the log.
 * An error the plugin threw from `frame()` keeps its own words.
 */
const START_TEXT: Readonly<Record<string, string>> = {
  device: "音频输出设备不可用",
  timeout: "启动超时",
  busy: "播放器正忙，请稍后重试",
  stream: "无法启动播放",
  producer: "无法启动播放",
  unavailable: "无法启动播放",
  invalid: "无法启动播放",
};
function startFailure(scope: ScopeImpl, error: unknown): unknown {
  const code = (error as PluginError | undefined)?.code;
  const text = code === undefined ? undefined : START_TEXT[code];
  if (text === undefined) return error;
  console.error(
    `[${scope.id}] file resolver stream did not start:`,
    (error as Error).message,
  );
  return Object.assign(failure(code!, text), { cause: error });
}

/**
 * A file resolver's stream (`ResolvedStream`): prepared and prerolled while
 * the open waits, then handed to the host as the answer. Once the host
 * selected it, the start control is acknowledged and `started` gets the
 * running stream, synchronously, before any `onStop`. Cancelled before or
 * during activation (the open was replaced or closed, the plugin stopped),
 * the producer is released and `started` is never called.
 */
export async function resolvedStream(
  scope: ScopeImpl,
  service: PlayerService,
  stream: ResolvedStream,
  signal: AbortSignal,
): Promise<ResolvedProducer> {
  const host = service.runtime.host;
  const p = await prepare(host, stream, () => {
    if (signal.aborted || scope.disposed) throw abortError();
  }).catch((error: unknown) => {
    throw startFailure(scope, error);
  });
  return {
    kind: "stream",
    producerId: p.producer,
    abandoned: () => abandon(service, p, undefined),
    accepted: async ({ stamp }) => {
      try {
        await activate(
          host,
          p,
          () => {
            if (scope.disposed) throw abortError();
          },
          "selected",
        );
        // Replaced before it ran: the source is no longer this stream.
        if (service.raw.stamp.generation > stamp.generation) throw abortError();
      } catch (error) {
        // Replaced or closed before it ran is a cancellation, not a failure.
        const retired = await retirement(service, stamp.generation, error);
        await abandon(service, p, stamp.generation);
        const reported = retired === undefined ? error : retired;
        if (reported && (reported as PluginError).code !== "aborted")
          scope.report(reported);
        return;
      }
      const handle = handleOf(scope, service, p, stamp.generation);
      if (stream.started) scope.run(stream.started, handle);
    },
  };
}
