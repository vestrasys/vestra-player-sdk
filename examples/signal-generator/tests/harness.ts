// Shared set-up: the real plugin against the SDK's in-memory TestHost.
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import type { Json, Plugin, StreamFrame } from "@vestra-player/sdk";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url); // reads ../manifest.json

/** What the plugin handed to the SDK: the frame count and the latest frame. */
export interface Frames {
  count: number;
  /**
   * The latest frame. The generator reuses its buffers, so this always shows
   * the newest picture and audio; read it synchronously.
   */
  last: StreamFrame | null;
}

// #region spy
/**
 * Start the plugin with a spy between it and `openStream`: every frame the
 * SDK pulls passes through `frames`. `intercept` may delay or rewrite host
 * requests (behind `next()` the TestHost answers as usual).
 */
/**
 * A test host for streams. Windows has no Unix socket files, so the frame
 * connection there is loopback TCP with a token, as in the player.
 */
export function streamHost() {
  const host = new TestHost();
  if (process.platform === "win32") host.producerTransport = "tcp";
  return host;
}

export async function start(
  intercept?: (
    method: string,
    params: Json,
    next: () => Promise<unknown>,
  ) => Promise<unknown>,
) {
  const host = streamHost();
  if (intercept) {
    const request = host.request.bind(host);
    host.request = <T>(method: string, params: Json = {}) =>
      intercept(method, params, () => request(method, params)) as Promise<T>;
  }
  const frames: Frames = { count: 0, last: null };
  const spied = (plugin: Plugin) => {
    const open = plugin.player.openStream.bind(plugin.player);
    plugin.player.openStream = (options) =>
      open({
        ...options,
        frame: () => {
          const frame = options.frame();
          frames.count++;
          frames.last = frame;
          return frame;
        },
      });
    return activate(plugin);
  };
  const started = await startPlugin(spied, { directory, host });
  return {
    ...started,
    frames,
    /** The control window (throws before its first show()). */
    window: () => host.window("signal-generator"),
    /** The window's properties by Slint name, `{}` before its first show(). */
    props: () => host.windows.get("signal-generator")?.props ?? {},
  };
}
// #endregion spy

/** Poll until `predicate()` holds: stream pacing runs on timers, not on settle(). */
export async function until(predicate: () => boolean, what: string) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Root mean square of one channel (0 = left, 1 = right) of interleaved stereo. */
export function rms(audio: Float32Array, channel: number) {
  let sum = 0;
  for (let i = channel; i < audio.length; i += 2) sum += audio[i]! * audio[i]!;
  return Math.sqrt(sum / (audio.length / 2));
}

/** The RGBA bytes of one pixel. */
export function pixel(video: Uint8Array, width: number, x: number, y: number) {
  const i = (y * width + x) * 4;
  return [...video.subarray(i, i + 4)];
}
