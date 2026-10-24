import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate, { FPS, HEIGHT, WIDTH, frame } from "../main.ts";

test("a frame is RGBA colour bars and 1601 or 1602 stereo samples", () => {
  const { video } = frame();
  assert.equal(video.length, WIDTH * HEIGHT * 4);
  assert.deepEqual([...video.subarray(0, 4)], [191, 191, 191, 255]); // grey
  const last = video.length - 4; // bottom right: blue
  assert.deepEqual([...video.subarray(last)], [0, 0, 191, 255]);

  // 300 frames are 10.01 s: the audio stays within one sample of that.
  let total = 0;
  for (let n = 0; n < 300; n++) {
    const samples = frame().audio.length / 2;
    assert.ok(samples === 1601 || samples === 1602);
    total += samples;
  }
  assert.ok(Math.abs(total - (300 * 48000) / FPS) <= 1);
});

test("the sine continues smoothly from one frame to the next", () => {
  // The largest step a 1 kHz sine at amplitude 0.25 takes between samples.
  const maxStep = 0.25 * 2 * Math.PI * (1000 / 48000);
  let previous = frame().audio.at(-2)!; // the last left sample
  for (let n = 0; n < 10; n++) {
    const { audio } = frame();
    for (let i = 0; i < audio.length; i += 2) {
      assert.ok(Math.abs(audio[i]! - previous) <= maxStep + 1e-6);
      assert.equal(audio[i + 1], audio[i], "left = right");
      previous = audio[i]!;
    }
  }
});

/** Poll until `predicate()` holds: a stream starts and stops on timers. */
async function until(predicate: () => boolean) {
  const deadline = Date.now() + 3000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("Open ▸ Signal generator starts the stream; choosing it again stops it", async () => {
  const host = new TestHost();
  // Windows has no Unix sockets: the frames travel over loopback TCP there.
  if (process.platform === "win32") host.producerTransport = "tcp";
  const { stop } = await startPlugin(activate, {
    directory: new URL("..", import.meta.url), // reads manifest.json
    host,
  });
  const command = () => host.command("signal-generator");
  try {
    const { declaration } = command();
    assert.deepEqual("path" in declaration && declaration.path, [
      "@open",
      "Signal generator",
    ]);

    await command().run();
    await until(() => command().state.checked === true);
    assert.equal(host.source.kind, "producer");

    await command().run();
    const producer = host.producers.get(1)!;
    await until(() => producer.released);
    assert.equal(producer.droppedWhileSelected, false, "source closed first");
    assert.equal(host.source.phase, "empty");
    assert.equal(command().state.checked, false);
  } finally {
    await stop();
  }
});
