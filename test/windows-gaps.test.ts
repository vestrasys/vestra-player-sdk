// Windows gaps (render round): openStream over loopback TCP with a token.
import assert from "node:assert/strict";
import { createServer } from "node:net";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import { connectTo } from "../src/producer.ts";

const capabilities = [
  "playback.read",
  "playback.control",
  "events",
  "producer.av",
];

test("openStream works over loopback TCP: the token goes first", async () => {
  const host = new TestHost();
  host.producerTransport = "tcp";
  const { plugin, stop } = await startPlugin(() => {}, { capabilities, host });
  let frames = 0;
  const stream = await plugin.player.openStream({
    width: 2,
    height: 2,
    frame: () => {
      frames++;
      return { video: new Uint8Array(16), audio: new Float32Array(1600) };
    },
  });
  assert.equal(host.source.kind, "producer");
  const producer = [...host.producers.values()][0]!;
  assert.equal(producer.admitted, true, "the token was accepted");
  assert.ok(producer.receivedFrames >= 2048, "audio preroll arrived");
  assert.ok(producer.videoFrames > 0);
  await host.settle(30);
  assert.ok(frames > 3);
  await stream.stop();
  await stop();
});

test("connectTo: tcp:// addresses are loopback TCP, anything else a socket path", async () => {
  const server = createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  const socket = connectTo({ socket: `tcp://127.0.0.1:${port}` });
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  assert.equal(socket.remotePort, port);
  socket.destroy();
  server.close();
  // Not loopback: treated as a path (and so fails to connect), never dialled.
  const other = connectTo({ socket: "tcp://192.0.2.1:9" });
  const error = await new Promise<NodeJS.ErrnoException>((resolve) =>
    other.once("error", resolve),
  );
  assert.equal(other.remotePort, undefined);
  assert.ok(error.code);
});
