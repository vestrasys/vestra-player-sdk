/**
 * The plugin's side of the player's request backstop (L0): at most
 * `REQUEST_LIMITS.inFlight` requests, and `REQUEST_LIMITS.inFlightBytes` of
 * them, sent and not yet answered; the rest wait here in the order they were
 * made and go out as answers come in. Nothing fails and nothing is
 * reordered: a request that waits is only late. The player answers
 * `limit` to a request past 320 unanswered lines or 4 MiB of them per plugin
 * (its backstop; it does not stop the plugin), which a plugin on the SDK so
 * never reaches: only a client that bypasses the SDK meets it.
 *
 * One queue per plugin, made by its `Connection` over the runner's
 * transport: in the shared runner every member has its own `boot`, its own
 * `createPlugin` and so its own queue, so one member's flood never delays
 * another's. `TestHost` is the transport of a plugin under test, behind the
 * same queue: tests see the same waiting.
 */
import { HostError } from "./wire.ts";
import type { Json, Transport } from "./wire.ts";
import { MESSAGE_LIMIT } from "./protocol.ts";
import { abortError } from "./plugin/errors.ts";

/**
 * How much of the plugin's traffic the SDK keeps in flight, documented in
 * the limits reference. Exported from `./runtime` only, for the player's
 * agreement test: a plugin never meets these figures as an error, only as
 * a delay.
 *
 * @internal
 */
export const REQUEST_LIMITS = Object.freeze({
  /**
   * Requests one plugin has sent the player and not yet had answered; the
   * next waits in the plugin's queue until an answer comes, under the
   * player's backstop of 320 lines (256).
   */
  inFlight: 256,
  /**
   * UTF-8 bytes of those requests' lines together; the next waits unless
   * nothing is in flight. One `MESSAGE_LIMIT` line more stays under the
   * player's backstop of 4 MiB, for the replies that never wait (3 MiB).
   */
  inFlightBytes: 3 * 1024 * 1024,
} as const);

/**
 * Requests that answer the player's own calls (a resolution, a producer's
 * control): sent at once, never behind the queue. The player may hold one
 * of the plugin's requests until such an answer comes (an open waits for
 * the plugin's resolver), so waiting behind it could never end.
 * `palette.lead.done` is not one: the player waits for nothing on it, and
 * unqueued it could pass a waiting `commands.run` of the same ticket. They count while in flight; their number is the player's, so
 * the backstop's margin over `inFlight` covers them.
 */
export const UNQUEUED_METHODS: ReadonlySet<string> = new Set([
  "sourceResolvers.respond",
  "producer.ack",
  "producer.ackInput",
]);

/** A request's options on the plugin's side; nothing of them is sent. */
export interface RequestOptions {
  /**
   * Aborting it while the request still waits takes the request out of the
   * queue, unsent, and rejects it with `aborted` (`AbortError`). Once sent,
   * it runs to its answer, as before.
   */
  signal?: AbortSignal;
}

interface Waiting {
  method: string;
  params: Json | undefined;
  bytes: number;
  resolve(value: unknown): void;
  reject(error: unknown): void;
  signal: AbortSignal | undefined;
  abort: (() => void) | undefined;
}

/**
 * What the player counts of a line beyond the SDK's estimate: the id's
 * digits past one and the shared runner's `"g":<n>,` envelope (about 10–20
 * bytes), rounded up. With it, `inFlightBytes` plus one unqueued line of
 * `MESSAGE_LIMIT` stays under the player's 4 MiB.
 */
const LINE_MARGIN = 32;

/**
 * UTF-8 bytes of the request's line as the runner writes it, with a
 * one-digit id and the newline (without {@link LINE_MARGIN});
 * `undefined` when it cannot be written (the transport says why).
 */
function lineBytes(
  method: string,
  params: Json | undefined,
): number | undefined {
  try {
    return (
      Buffer.byteLength(
        JSON.stringify({ id: 0, method, params: params ?? {} }),
      ) + 1
    );
  } catch {
    return undefined;
  }
}

/** The transport behind a per-plugin limit of requests in flight. */
export class RequestQueue {
  readonly #transport: Transport;
  readonly #limit: number;
  readonly #byteLimit: number;
  #inFlight = 0;
  #bytes = 0;
  /** Waiting requests in order; `#head` is the first still in it. */
  #waiting: (Waiting | undefined)[] = [];
  #head = 0;
  #count = 0;
  /** Set by `close`: later requests go to the transport as they come. */
  #closed = false;
  /** The most in flight at once (the SDK's own tests). */
  peak = 0;
  constructor(
    transport: Transport,
    limits: { inFlight: number; inFlightBytes: number } = REQUEST_LIMITS,
  ) {
    this.#transport = transport;
    this.#limit = limits.inFlight;
    this.#byteLimit = limits.inFlightBytes;
  }
  /** Requests sent and not yet answered, and their bytes. */
  get inFlight() {
    return { requests: this.#inFlight, bytes: this.#bytes };
  }
  /** Requests waiting to be sent. */
  get waiting() {
    return this.#count;
  }
  request<T>(
    method: string,
    params?: Json,
    options?: RequestOptions,
  ): Promise<T> {
    const signal = options?.signal;
    if (this.#closed) return this.#transport.request<T>(method, params);
    if (signal?.aborted) return Promise.reject(abortError());
    const line = lineBytes(method, params);
    // Not writable, or longer than a line: the transport refuses it
    // without writing it, at once as before.
    if (line === undefined || line > MESSAGE_LIMIT)
      return this.#transport.request<T>(method, params);
    const bytes = line + LINE_MARGIN;
    if (UNQUEUED_METHODS.has(method) || (!this.#count && this.#fits(bytes)))
      return this.#send<T>(method, params, bytes);
    return new Promise<T>((resolve, reject) => {
      const entry: Waiting = {
        method,
        params,
        bytes,
        resolve: resolve as (value: unknown) => void,
        reject,
        signal,
        abort: undefined,
      };
      const index = this.#waiting.length;
      if (signal) {
        entry.abort = () => {
          if (this.#waiting[index] !== entry) return;
          this.#waiting[index] = undefined;
          this.#count--;
          reject(abortError());
        };
        signal.addEventListener("abort", entry.abort, { once: true });
      }
      this.#waiting.push(entry);
      this.#count++;
    });
  }
  /**
   * The plugin stops: every waiting request rejects with `error` (the one
   * the runner gives the requests in flight), and later ones go to the
   * transport as they come, which refuses them while stopping.
   */
  close(error: Error = new HostError("disabled", "plugin stopped")) {
    if (this.#closed) return;
    this.#closed = true;
    const waiting = this.#waiting.slice(this.#head);
    this.#waiting = [];
    this.#head = 0;
    this.#count = 0;
    for (const entry of waiting) {
      if (!entry) continue;
      entry.signal?.removeEventListener("abort", entry.abort!);
      entry.reject(error);
    }
  }
  #fits(bytes: number) {
    return (
      this.#inFlight < this.#limit &&
      (this.#inFlight === 0 || this.#bytes + bytes <= this.#byteLimit)
    );
  }
  #send<T>(
    method: string,
    params: Json | undefined,
    bytes: number,
  ): Promise<T> {
    let reply: Promise<T>;
    try {
      reply = this.#transport.request<T>(method, params);
    } catch (error) {
      // Thrown, not rejected: nothing went out.
      return Promise.reject(error);
    }
    this.#inFlight++;
    this.#bytes += bytes;
    if (this.#inFlight > this.peak) this.peak = this.#inFlight;
    // Registered before the caller's own reaction, so the next request goes
    // out before the caller's code runs on (no extra tick for it).
    const done = () => {
      this.#inFlight--;
      this.#bytes -= bytes;
      this.#pump();
    };
    reply.then(done, done);
    return reply;
  }
  #pump() {
    while (this.#count && !this.#closed) {
      let entry = this.#waiting[this.#head];
      while (!entry) entry = this.#waiting[++this.#head];
      if (!this.#fits(entry.bytes)) return;
      this.#waiting[this.#head++] = undefined;
      this.#count--;
      if (entry.abort) entry.signal!.removeEventListener("abort", entry.abort);
      entry.resolve(this.#send(entry.method, entry.params, entry.bytes));
    }
    // Drained: start the array again rather than let it grow.
    if (!this.#count) {
      this.#waiting = [];
      this.#head = 0;
    }
  }
}
