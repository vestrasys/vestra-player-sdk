// Frame timing and the frame() contract: sizes, sample counts, reused buffers.
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULTS, HEIGHT, SAMPLE_RATE, WIDTH } from "../controls.ts";
import { FrameClock, SignalGenerator } from "../generator.ts";

// #region clock
test("30 fps: every frame carries exactly 48000 / 30 = 1600 samples", () => {
  const clock = new FrameClock({ num: 30, den: 1 });
  for (let i = 0; i < 90; i++) assert.equal(clock.next(), 1600);
});

test("29.97 fps: 1601 or 1602 samples per frame, and the total never drifts", () => {
  const clock = new FrameClock({ num: 30000, den: 1001 });
  let total = 0;
  for (let frame = 1; frame <= 30_000; frame++) {
    const samples = clock.next();
    assert.ok(samples === 1601 || samples === 1602);
    total += samples;
    // The exact end of this frame is frame × 1601.6 samples.
    assert.ok(Math.abs(total - (frame * SAMPLE_RATE * 1001) / 30000) < 1);
  }
});
// #endregion clock

test("frame(): RGBA of WIDTH × HEIGHT, 1600 stereo samples, the same buffers every time", () => {
  const generator = new SignalGenerator({ ...DEFAULTS });
  const first = generator.frame();
  const video = first.video;
  const audio = first.audio;
  assert.equal(video.length, WIDTH * HEIGHT * 4);
  assert.equal(audio.length, 2 * 1600);
  const second = generator.frame();
  assert.equal(second.video, video, "video buffer reused");
  assert.equal(second.audio, audio, "audio buffer reused");
  assert.equal(generator.frames, 2);
  for (let i = 3; i < video.length; i += 4) assert.equal(video[i], 255, "opaque");
});

test("every pattern renders without touching the audio limits", () => {
  for (const pattern of ["bars", "grid", "scope"] as const)
    for (const waveform of ["sine", "square", "saw", "noise"] as const) {
      const generator = new SignalGenerator({ ...DEFAULTS, pattern, waveform, levelDb: 0 });
      for (let i = 0; i < 5; i++) {
        const { audio } = generator.frame();
        // The SDK rejects samples outside −1…1 (or NaN) and ends the stream.
        assert.ok(audio.every((v) => Number.isFinite(v) && Math.abs(v) <= 1));
      }
    }
});
