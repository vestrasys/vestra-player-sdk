/**
 * Finite binary AV candidate over a local socket: a Unix socket path, or
 * `tcp://127.0.0.1:<port>` plus a `token` the plugin sends first (Windows).
 * Trusted plugin data, not a security sandbox.
 */
import { createConnection } from "node:net";
import type { SourceStamp, SourceTicket } from "./source.ts";
import type { Transport } from "./wire.ts";
export interface PreparedProducer {
  producerId: number;
  /** A Unix socket path, or `tcp://127.0.0.1:<port>` (loopback, with `token`). */
  socket: string;
  /** Hex bytes to send before any packet (loopback TCP only). */
  token?: string;
  epoch: number;
  sampleRate: 48000;
  channels: 2;
  sampleFormat: "f32le";
  videoFormat: "rgba8";
  maxAudioFrames: 4800;
  audioCapacityFrames: 9600;
  videoCapacity: 8;
}
export type ProducerControl = {
  producerId: number;
  stamp: SourceStamp;
  cycle: number;
  epoch: number;
  baseSample: number;
  paused: boolean;
};
export type ProducerInputScope = {
  owner: number;
  producerId: number;
  ticket: SourceTicket;
  inputEpoch: number;
};
export type ProducerInputNotice = {
  scope: ProducerInputScope;
  sequence: number;
  pressed: string[];
  captured: boolean;
  reason:
    | "focusLost"
    | "windowHidden"
    | "menu"
    | "dialog"
    | "pause"
    | "sourceChanged"
    | "providerGone"
    | "disabled"
    | "reconfigured"
    | "transportFailure"
    | null;
};
export type ProducerInputState = {
  state: ProducerInputNotice;
  pending: ProducerInputNotice | null;
  keys: string[];
};
export interface ProducerState {
  input: ProducerInputState | null;
  pendingControl: ProducerControl | null;
  producerId: number;
  epoch: number;
  acknowledged: boolean;
  paused: boolean;
  consumedFrames: number;
  underrunFrames: number;
  deviceErrors: number;
  health:
    | "ok"
    | "recoverableXrun"
    | "deviceChanged"
    | "streamInvalidated"
    | "deviceUnavailable"
    | "otherError";
  xrunEvents: number;
  deviceChangeEvents: number;
  errorDetails: string[];
  errorOverflow: number;
  buffer: {
    device: string;
    supported: string;
    defaultConfig: string;
    requestedFrames: number;
    actualFrames: number;
    oneBufferMilliseconds: number;
  };
  receivedFrames: number;
  hasVideo: boolean;
  error: string | null;
  active: boolean;
}
export interface PacketTime {
  epoch: number;
  sampleTime: number;
  sequence: number;
}
function integer(
  n: number,
  name: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
) {
  if (!Number.isSafeInteger(n) || n < min || n > max)
    throw new TypeError(`${name} is outside its integer range`);
}
export function producerClient(transport: Transport) {
  return {
    /** Provider promises its core has frozen/resumed at a frame boundary; echo is not the audio callback ACK. */
    ack: (control: ProducerControl) =>
      transport.request<{ status: "acknowledged"; control: ProducerControl }>(
        "producer.ack",
        { control },
      ),
    /** Physical identifiers remain distinct; the provider maps them to its own controls. */
    declareInput: (producerId: number, keys: string[]) =>
      transport.request<ProducerInputState>("producer.declareInput", {
        producerId,
        keys,
      }),
    /** Apply the complete set at the core boundary before echoing this notice. */
    ackInput: (notice: ProducerInputNotice) =>
      transport.request<{ status: "acknowledged"; sequence: number }>(
        "producer.ackInput",
        { notice },
      ),
    prepare: (spec: { width: number; height: number }) =>
      transport.request<PreparedProducer>("producer.prepare", spec),
    state: (producerId: number) =>
      transport.request<ProducerState>("producer.state", { producerId }),
    release: (producerId: number) =>
      transport.request<void>("producer.release", { producerId }),
    async connect(prepared: PreparedProducer) {
      // Declaration dimensions stay with the caller; host validates exact payload
      // against its own accepted declaration before allocating a frame.
      const socket = connectTo(prepared);
      let failure: Error | undefined;
      socket.on("error", (error) => {
        failure = error;
      });
      await new Promise<void>((resolve, reject) => {
        socket.once("connect", resolve);
        socket.once("error", reject);
      });
      if (prepared.token !== undefined)
        socket.write(Buffer.from(prepared.token, "hex"));
      let closed = false;
      let inFlight = false;
      function writable() {
        if (closed || failure)
          throw failure ?? new Error("producer transport closed");
        if (inFlight)
          throw new Error("producer transport busy: await the previous packet");
      }
      /**
       * One packet in one buffer: the 32-byte header, then `bytes` of payload
       * that `fill` writes at offset 32. The payload is copied only there, so
       * the caller may reuse its own buffers once this returns.
       */
      function write(
        kind: 1 | 2,
        time: PacketTime,
        bytes: number,
        fill: (packet: Buffer) => void,
      ) {
        writable();
        integer(time.epoch, "epoch", 1);
        integer(time.sampleTime, "sampleTime");
        integer(time.sequence, "sequence", 0, 0xffffffff);
        if (closed || failure)
          return Promise.reject(
            failure ?? new Error("producer transport closed"),
          );
        const packet = Buffer.allocUnsafe(32 + bytes);
        packet.fill(0, 0, 32);
        packet.write("VAV1", 0, "ascii");
        packet[4] = kind;
        packet.writeBigUInt64LE(BigInt(time.epoch), 8);
        packet.writeBigUInt64LE(BigInt(time.sampleTime), 16);
        packet.writeUInt32LE(bytes, 24);
        packet.writeUInt32LE(time.sequence, 28);
        fill(packet);
        inFlight = true;
        return new Promise<void>((resolve, reject) => {
          socket.write(packet, (error) => {
            inFlight = false;
            if (error) reject(error);
            else resolve();
          });
        });
      }
      return {
        audio(time: PacketTime, samples: Float32Array) {
          writable();
          if (
            samples.length === 0 ||
            samples.length % 2 ||
            samples.length > 9600
          )
            throw new TypeError("audio must contain 1..4800 stereo frames");
          integer(time.sampleTime + samples.length / 2, "audio end sample");
          for (const value of samples)
            if (!Number.isFinite(value) || Math.abs(value) > 1)
              throw new TypeError("PCM sample is not finite normalized f32");
          return write(1, time, samples.length * 4, (packet) => {
            for (let i = 0; i < samples.length; i++)
              packet.writeFloatLE(samples[i]!, 32 + i * 4);
          });
        },
        video(time: PacketTime, rgba: Uint8Array) {
          writable();
          if (rgba.byteLength === 0 || rgba.byteLength > 4 * 1024 * 1024)
            throw new TypeError("RGBA frame exceeds the finite payload limit");
          return write(2, time, rgba.byteLength, (packet) =>
            packet.set(rgba, 32),
          );
        },
        close() {
          closed = true;
          socket.destroy();
        },
      };
    },
  };
}

/** The host's transport address: loopback TCP or a Unix socket path. */
export function connectTo(prepared: Pick<PreparedProducer, "socket">) {
  const tcp = /^tcp:\/\/127\.0\.0\.1:(\d{1,5})$/.exec(prepared.socket);
  return tcp
    ? createConnection({ host: "127.0.0.1", port: Number(tcp[1]) })
    : createConnection(prepared.socket);
}
