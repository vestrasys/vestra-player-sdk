/**
 * Plugin-generated audio/video (host "producer"). The SDK owns preroll,
 * activation, pause/epoch acknowledgements, input acknowledgements and pacing;
 * the plugin only renders frames.
 */
import { failure, sleep, toError } from "./runtime.ts";
import { abortError } from "./player.ts";
import type { PlayerService } from "./player.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  PluginError,
  Stream,
  StreamOptions,
  StreamStartError,
} from "./types.ts";

type Socket = Awaited<
  ReturnType<PlayerService["runtime"]["host"]["producer"]["connect"]>
>;

/** Frames of audio buffered ahead of the device before rendering pauses. */
const AHEAD = 2400;
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
      if (
        !control &&
        state.acknowledged &&
        state.epoch === this.#epoch &&
        !paused &&
        this.#sample - state.consumedFrames < AHEAD
      )
        await this.#render();
      if (this.#running)
        this.#timer = setTimeout(() => {
          this.#pumping = this.#pump();
        }, 5);
    } catch (error) {
      void this.#end(toError(error));
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

export async function openStream(
  scope: ScopeImpl,
  service: PlayerService,
  options: StreamOptions,
): Promise<Stream> {
  const host = service.runtime.host;
  const check = () => {
    if (options.signal?.aborted || scope.disposed) throw abortError();
  };
  let prepared: number | undefined;
  let socket: Socket | undefined;
  let generation: number | undefined;
  /** The request selecting the stream, once sent. */
  let opened: Promise<void> | undefined;
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
  try {
    check();
    const spec = await host.producer.prepare({
      width: options.width,
      height: options.height,
    });
    prepared = spec.producerId;
    check();
    socket = await host.producer.connect(spec);
    check();
    let epoch = spec.epoch;
    let sample = 0;
    let sequence = 0;
    const clock: Clock = {
      get sample() {
        return sample;
      },
      advance: (n) => (sample += n),
      nextSequence: () => sequence++,
    };
    // A prepared producer is paused at sample zero. Supply a frame at zero and
    // enough contiguous PCM before asking the host to select it.
    while (sample < PREROLL) {
      check();
      await writeFrame(socket, frame(), clock, epoch);
    }
    for (const deadline = Date.now() + 10_000; ; await sleep(10)) {
      check();
      const state = await host.producer.state(prepared);
      if (state.error) throw failure("stream", state.error);
      if (state.epoch !== epoch)
        throw failure("stream", "producer epoch changed before activation");
      if (!["ok", "recoverableXrun", "deviceChanged"].includes(state.health))
        throw failure("device", `audio device is not ready: ${state.health}`);
      if (state.acknowledged && state.receivedFrames >= 1024 && state.hasVideo)
        break;
      if (Date.now() >= deadline)
        throw timeout("prefill", "timed out preparing the first buffers");
    }
    let accepted = false;
    opened = service
      .submit(
        { kind: "openProvider", producerId: prepared, startPaused: false },
        { accepted: (ticket) => (generation = ticket.stamp.generation) },
      )
      .then((ticket) => {
        generation = ticket.stamp.generation;
        accepted = true;
      });
    let failed: unknown;
    opened.catch((error) => (failed = error));
    // Activation needs this side to acknowledge the host's start control.
    for (const deadline = Date.now() + 10_000; ; await sleep(10)) {
      check();
      if (failed) throw failed;
      const state = await host.producer.state(prepared);
      if (state.error) throw failure("stream", state.error);
      if (state.pendingControl) {
        epoch = state.pendingControl.epoch;
        sample = state.pendingControl.baseSample;
        sequence = 0;
        await host.producer.ack(state.pendingControl);
      }
      if (
        accepted &&
        state.active &&
        !state.pendingControl &&
        state.acknowledged &&
        state.epoch === epoch
      )
        break;
      if (Date.now() >= deadline)
        throw timeout("activation", "timed out waiting for stream activation");
    }
    const handle = new StreamHandle(scope, service, {
      producer: prepared,
      socket,
      generation: generation!,
      frame,
      epoch,
      sample,
      sequence,
    });
    prepared = undefined;
    socket = undefined;
    return handle;
  } catch (error) {
    // An abort can arrive before the host answered the selecting request: wait
    // for that answer so a source selected afterwards is still closed.
    if (opened && prepared !== undefined) await opened.catch(() => {});
    // A cancelled open may already have selected this producer: close only
    // that source, before its frame connection (as in `stop`).
    if (generation !== undefined && prepared !== undefined)
      await service.closeIfCurrent(generation).catch(() => {});
    socket?.close();
    if (prepared !== undefined)
      await host.producer.release(prepared).catch(() => {});
    throw error;
  }
}
