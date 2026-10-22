// The whole plugin against the SDK's TestHost: menu, window, stream, filter, stop.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin } from "@vestra-player/sdk/testing";
import type { StreamStartError } from "@vestra-player/sdk";
import { HEIGHT, WIDTH, positionOf } from "../controls.ts";
import activate, { startFailure } from "../main.ts";
import { pixel, rms, start, until } from "./harness.ts";

// #region start-test
test("Open ▸ Signal Generator… shows the window and starts a 640×360 stream", async () => {
  const { host, stop, frames, window, props } = await start();
  try {
    assert.deepEqual(host.command("open").declaration.path, [
      "@open",
      "Signal Generator…",
    ]);
    await host.command("open").run();
    assert.equal(window().visible, true);
    // run() returns when the host is idle; the stream start-up polls, so wait for it.
    await until(
      () => String(props()["status"]).startsWith("Running · 640×360 · 30 fps"),
      "running",
    );
    assert.equal(props()["running"], true);
    assert.equal(host.source.kind, "producer");

    const producer = host.producers.get(1)!;
    await until(() => producer.videoFrames >= 10, "ten frames");
    assert.equal(frames.last!.video.length, WIDTH * HEIGHT * 4);
    assert.equal(frames.last!.audio.length, 2 * 1600);
    // A/V: the player received exactly 1600 sample frames per video frame.
    await until(
      () => producer.receivedFrames === producer.videoFrames * 1600,
      "whole frames",
    );
  } finally {
    await stop();
  }
});
// #endregion start-test

// #region controls-test
test("window controls reach the generator on the next frame", async () => {
  const { host, stop, frames, window, props } = await start();
  try {
    await host.command("open").run();
    await until(() => props()["running"] === true, "running");
    /** Wait for two more frames: the first one after a change glides to it. */
    const settled = async () => {
      const seen = frames.count;
      await until(() => frames.count >= seen + 2, "two more frames");
    };

    window().emit("levelMoved", -20);
    await settled();
    assert.ok(
      Math.abs(rms(frames.last!.audio, 0) - 0.1 * Math.SQRT1_2) < 1e-3,
      "−20 dB sine",
    );
    assert.equal(props()["level-text"], "-20 dB");

    window().emit("balanceMoved", -1);
    await settled();
    assert.equal(
      rms(frames.last!.audio, 1),
      0,
      "balance hard left: right is silent",
    );
    assert.equal(props()["balance-text"], "L 100 %");

    window().emit("muteToggled", true);
    await settled();
    assert.equal(rms(frames.last!.audio, 0), 0, "muted");

    window().emit("frequencyMoved", positionOf(440));
    await settled();
    assert.equal(props()["frequency-text"], "440 Hz");

    window().emit("patternChosen", 0); // colour bars
    await settled();
    assert.deepEqual(
      pixel(frames.last!.video, WIDTH, 20, 100),
      [191, 191, 191, 255],
    );
    window().emit("patternChosen", 2); // oscilloscope
    await settled();
    assert.deepEqual(pixel(frames.last!.video, WIDTH, 2, 2), [6, 14, 8, 255]);
  } finally {
    await stop();
  }
});
// #endregion controls-test

// #region filter-test
test("the player filter is not applied to the stream, then applies to decoded media", async () => {
  // The player runs plugin audio chains only on media it decodes; a generated
  // stream's PCM goes straight to the device, so the chain fails with
  // `unsupported` (the TestHost answers like the player).
  const { host, stop, window, props } = await start();
  try {
    await host.command("open").run();
    await until(() => props()["running"] === true, "running");
    window().emit("filterChosen", 2); // swap left / right
    await until(
      () =>
        String(props()["filter-status"]).startsWith(
          "Not applied to this stream",
        ),
      "unsupported",
    );

    host.openElsewhere("/media/song.flac"); // the user plays a file
    await until(
      () => props()["filter-status"] === "Applied by the player",
      "applied",
    );
    assert.deepEqual(host.processing.resources.get("audio:tone")?.nodes, [
      { kind: "channels", mode: "swap" },
    ]);

    window().emit("filterChosen", 3);
    await until(
      () =>
        JSON.stringify(host.processing.resources.get("audio:tone")?.nodes) ===
        JSON.stringify([
          { kind: "treble", frequency: 3000, slope: 0.5, gainDb: 6 },
        ]),
      "treble",
    );

    window().emit("filterChosen", 0);
    await until(
      () => !host.processing.resources.has("audio:tone"),
      "withdrawn",
    );
    assert.equal(props()["filter-status"], "Off");
  } finally {
    await stop();
  }
});
// #endregion filter-test

// #region stop-test
test("Stop closes the source before the frame connection, then releases the producer", async () => {
  const { host, stop, window, props } = await start();
  try {
    await host.command("open").run();
    await until(() => props()["running"] === true, "running");
    window().emit("stop");
    const producer = host.producers.get(1)!;
    await until(() => producer.released, "released");
    assert.equal(
      producer.droppedWhileSelected,
      false,
      "never cut off while it was the source",
    );
    const last = host.sent("source.submit").at(-1)!["intent"] as {
      kind: string;
    };
    assert.equal(last.kind, "close");
    assert.equal(host.source.phase, "empty");
    assert.equal(props()["running"], false);
    assert.equal(props()["status"], "Stopped");
    assert.equal(props()["problem"], "");
  } finally {
    await stop();
  }
});

test("Stop while starting: the stream is never selected", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { host, stop, window, props } = await start(
    async (method, _params, next) => {
      if (method === "producer.prepare") await gate; // hold the start-up here
      return next();
    },
  );
  try {
    void host.command("open").run();
    await until(() => props()["starting"] === true, "starting");
    window().emit("stop");
    release();
    await until(() => host.producers.get(1)?.released === true, "released");
    await host.settle();
    assert.equal(
      host.sent("source.submit").length,
      0,
      "the stream was never selected",
    );
    assert.equal(props()["running"], false);
    assert.equal(props()["starting"], false);
    assert.equal(props()["problem"], "", "a cancelled start is not an error");
  } finally {
    await stop();
  }
});

test("deactivating the plugin stops the stream in the same order", async () => {
  const { host, stop, props } = await start();
  await host.command("open").run();
  await until(() => props()["running"] === true, "running");
  const producer = host.producers.get(1)!;
  await stop(); // what the player does when the plugin is disabled or quits
  assert.equal(producer.released, true);
  assert.equal(producer.droppedWhileSelected, false);
});
// #endregion stop-test

// #region errors-test
test("start-up failures and replacement are shown in the window", async () => {
  let health = "deviceLost";
  const { host, stop, window, props } = await start(
    async (method, _params, next) => {
      const result = (await next()) as Record<string, unknown>;
      return method === "producer.state" ? { ...result, health } : result;
    },
  );
  try {
    await host.command("open").run();
    await until(
      () => props()["problem"] === "The audio output device is not ready.",
      "device error",
    );
    assert.equal(props()["running"], false);
    assert.equal(
      host.producers.get(1)!.released,
      true,
      "a failed start cleans up",
    );

    health = "ok";
    window().emit("start");
    await until(() => props()["running"] === true, "running");
    host.openElsewhere("/media/movie.mp4"); // the user opened something else
    await until(() => props()["running"] === false, "replaced");
    assert.equal(props()["problem"], "Another source replaced the stream.");
  } finally {
    await stop();
  }
});

test("start-up timeouts name the stage that ran out of time", () => {
  const timeout = (stage: StreamStartError["stage"]) =>
    Object.assign(new Error("timed out"), { code: "timeout", stage });
  assert.match(startFailure(timeout("prefill")), /prefill/);
  assert.match(startFailure(timeout("activation")), /activation/);
});
// #endregion errors-test

test("settings are saved and restored", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "signal-generator-"));
  const directory = new URL("..", import.meta.url);
  try {
    const first = await startPlugin(activate, { directory, dataDirectory });
    await first.host.command("open").run();
    first.host.window("signal-generator").emit("waveformChosen", 1);
    first.host.window("signal-generator").emit("levelMoved", -30);
    await first.host.settle();
    await first.stop(); // stopping flushes the pending save

    const again = await startPlugin(activate, { directory, dataDirectory });
    await again.host.command("open").run();
    const props = again.host.window("signal-generator").props;
    assert.equal(props["waveform"], 1);
    assert.equal(props["level"], -30);
    await again.stop();
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});
