/**
 * The single-flight write queue (L1, refactor plan §2.2): a view's
 * property writes, a command's state, an OSD panel. It knows nothing of
 * update passes (it lived in `runtime.ts`, beside the pass scheduler).
 */

/** One value in flight, only the newest waiting. Each push learns its fate. */
export class Latest<T> {
  #queued: { value: T; settle: (ok: boolean, error?: unknown) => void }[] = [];
  #running = false;
  #stopped = false;
  readonly #send: (value: T) => Promise<void>;
  constructor(send: (value: T) => Promise<void>) {
    this.#send = send;
  }
  push(value: T): Promise<boolean> {
    if (this.#stopped) return Promise.resolve(false);
    return new Promise((resolve, reject) => {
      for (const older of this.#queued.splice(0)) older.settle(false);
      this.#queued.push({
        value,
        settle: (ok, error) =>
          error === undefined ? resolve(ok) : reject(error),
      });
      if (!this.#running) void this.#drain();
    });
  }
  stop() {
    this.#stopped = true;
    for (const older of this.#queued.splice(0)) older.settle(false);
  }
  async #drain() {
    this.#running = true;
    try {
      let next;
      while ((next = this.#queued.shift()) && !this.#stopped) {
        try {
          await this.#send(next.value);
          next.settle(true);
        } catch (error) {
          next.settle(false, error);
        }
      }
    } finally {
      this.#running = false;
    }
  }
}
