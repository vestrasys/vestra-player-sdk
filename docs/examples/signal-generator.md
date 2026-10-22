---
title: "Example: Signal generator"
---

# Example: Signal generator

This walkthrough builds a plugin that **generates its own video and audio** and plays them in Vestra Player like any other source: test patterns, an oscilloscope that draws the plugin's own waveform, a timecode overlay and a test tone you can change while it plays. Along the way it covers how {@link "@vestra-player/sdk"!Player.openStream | Player.openStream} pulls frames from a plugin, how audio and video stay in sync, how to write per-frame code that does not stutter, and where the player's own audio processing fits in.

The complete, tested source is in [`examples/signal-generator`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/signal-generator). Every code block on this page is taken from those files, so it always matches the code that CI checks and tests.

![The signal generator: colour bars with the timecode overlay, and its control window](../../examples/signal-generator/screenshot.png)

## What you'll build

- A menu command, **Open ▸ Signal Generator…**, that shows a control window and starts a generated 640×360, 30 fps source with 48 kHz stereo sound.
- Three pictures: SMPTE-style colour bars, a moving grid, and an oscilloscope of the audio in the current frame. A timecode and a frame counter are drawn on top with a 5×7 bitmap font that is part of the plugin.
- A tone: sine, square, saw or noise, 20 Hz – 5 kHz or a sweep, level in dBFS, mute and balance. Every change applies while it plays, without clicks.
- A player-side audio filter (mono, swap left/right, treble boost), to compare what the plugin computes itself with what the player does to the sound.
- A Stop button, and clear messages for every way the stream can fail or end.
- Tests for all of it on the SDK's test host, with no player and no audio device.

You should know the basics from [Getting started](../tutorials/getting-started.md): the manifest, `activate`, commands and windows.

## Concepts

### Generated sources and files

Usually the player plays a file or a URL: it reads the container, decodes the streams and keeps the picture and the sound in step. A **generated source** has no file. The plugin calls `openStream` with a frame size and a `frame()` function, and the player plays whatever `frame()` returns: an emulator's screen, a visualisation, a test signal. To the user it is a source like any other: it replaces what was playing, the play/pause button works, and opening a file replaces it in turn. `player.state.kind` is `"stream"` while it plays.

A generated source has no duration, no chapters and no A-B loop.

### The pull model: the player asks for frames

The plugin does not push frames on its own timer. The SDK calls `frame()` when the player needs more:

- `frame()` is **never called concurrently**. The next call starts only after the previous frame has been handed over.
- It is **not called while paused**. Pausing stops the clock; resuming continues from the same frame.
- It is paced by the **audio clock**. The SDK keeps a small amount of audio queued ahead of the sound card (currently about 50 ms) and calls `frame()` whenever the queue runs low. Before the stream is shown, the SDK calls `frame()` a few times to fill the first buffers (the *prefill*).
- It is **synchronous**. It cannot `await`. Everything it needs must already be in memory.

So `frame()` behaves like an audio callback: if it is slow, or a garbage-collection pause stops the process for longer than the queued audio lasts, the sound drops out. This is why the per-frame code below allocates nothing.

### A/V sync: samples per frame

A stream's timeline *is* its audio. The player plays the samples at 48 000 per second and shows each picture when the audio reaches the first sample that came with it. A frame with 1600 samples therefore stays on screen for 1600 / 48 000 s = 1/30 s: **the number of samples per frame sets the frame rate**. There is no separate frame-rate setting.

| Frame rate | Samples per frame (48 000 / fps) |
| --- | --- |
| 24 | 2000 |
| 25 | 1920 |
| 30 | 1600 |
| 60 | 800 |
| 29.97 (30000/1001) | 1601.6: alternate 1601 and 1602 |

When the division is not exact, rounding every frame the same way would drift: 1601 samples per frame runs 0.6 samples short every frame, about 1.3 seconds per hour. Instead the generator computes where each frame *starts* on the exact timeline and rounds that, so the error never exceeds one sample (see [Step 4](#step-4-the-frame-clock)).

### Generating in the plugin, processing in the player

Everything the plugin computes (the waveform, its level, the balance) is part of the signal it hands over. The player can also process sound: {@link "@vestra-player/sdk"!Scope.audio | plugin.audio.filter()} declares a chain of audio nodes (volume, equalizer, treble, loudness normalisation, channel routing) that the player runs in its own audio pipeline. The plugin only says *which* nodes it wants; the player does the work, and re-applies the chain to every new source.

That pipeline is the one that decodes media. A generated stream's audio goes from `frame()` to the sound card without passing through it, so **player filters do not change a generated stream**: while one plays, the filter's status is `failed` with the code `unsupported`, and the SDK keeps the chain and applies it again by itself once the player plays a file. The example shows this on purpose: its filter status says "Not applied to this stream" while the tone plays, and the filter is audible as soon as you open a song. (Players before 0.3.0 left the status at "waiting" instead.)

## Step 1: The manifest

{@includeCode ../../examples/signal-generator/manifest.json}

Each capability opens a part of the API:

| Capability | Why the example needs it |
| --- | --- |
| `commands` | The menu command. |
| `ui.window` | The control window. |
| `producer.av` | `player.openStream`: producing the frames. |
| `playback.control` | Making the stream the player's source, and closing it on Stop. Selecting a source is a playback control like opening a file, so `openStream` needs it as well as `producer.av`. |
| `playback.read` | Reading the player state, needed by `audio.filter` and by `Stream.stop()` to check that the stream is still the current source before closing it. |
| `events` | Live player state: the window notices when another source replaces the stream, and the filter notices new sources. |
| `processing.audio` | `plugin.audio.filter()`. |

The display fields (`name`, `author`, `punchline`, `description`, `tags`, `sourceUrl`, `license`) are what the plugin manager and the store show. `minPlayerVersion` is 0.3.0 because the menu command uses a menu id (`@open`, Step 10) and the window uses `Theme.danger`, both new in player 0.3.0.

## Step 2: The settings

`controls.ts` holds plain data and no SDK types. First the stream format:

{@includeCode ../../examples/signal-generator/controls.ts#format}

- `FPS` is a fraction so that rates like 29.97 (30000/1001) are exact.
- `SAMPLE_RATE` is fixed: a stream is always 48 kHz, stereo, 32-bit float.

Then everything the user can change:

{@includeCode ../../examples/signal-generator/controls.ts#controls}

- The `as const` arrays give both the allowed values and their order in the window's combo boxes: the window sends an index, the plugin looks it up.
- `Controls` is one mutable object for the whole plugin. The window writes it; `frame()` reads it. Because `frame()` never runs at the same time as a window callback (both run on the plugin's single JavaScript thread), there is nothing to lock: a change simply applies from the next frame on.

The frequency slider is logarithmic:

{@includeCode ../../examples/signal-generator/controls.ts#slider}

`frequencyAt(0)` is 20 Hz, `frequencyAt(1)` is 5 kHz and `frequencyAt(0.5)` is their geometric mean, 316 Hz. On a linear slider everything below 500 Hz would be squeezed into the first tenth.

## Step 3: The oscillator

`audio.ts` turns the controls into samples.

{@includeCode ../../examples/signal-generator/audio.ts#oscillator}

### The phase accumulator

The obvious way to compute a sine is `Math.sin(2 * Math.PI * frequency * t)`, with `t` the time in seconds. It breaks as soon as the frequency changes: at `t` = 10 s, going from 440 Hz to 441 Hz moves the argument by 2π × 1 × 10, ten whole cycles, and in general to a different point of the wave. The output jumps from one value to another between two samples, and a jump in a waveform is heard as a **click**.

The oscillator instead keeps a **phase**, its position inside the current cycle, from 0 (inclusive) to 1 (exclusive):

- Every sample, `phase += hz / SAMPLE_RATE`. At 1 kHz that is 1000 / 48 000 ≈ 0.0208 cycles per sample, so a cycle takes exactly 48 samples.
- When the phase reaches 1 it wraps to 0 (`phase -= 1`), so it never grows and never loses precision, however long the stream runs.
- The sample is a function of the phase only: `sin(2π · phase)` for the sine, `phase < 0.5 ? 1 : -1` for the square, `2 · phase − 1` for the saw.

Changing the frequency only changes the step size. The wave continues from where it is, smoothly, so frequency changes and the sweep are **phase-continuous**. `#phase` survives between calls, so consecutive frames join seamlessly too.

### Line by line

- **The target gains.** Level (`gainOf` converts dBFS to an amplitude: −20 dB = 0.1), mute and balance are combined into one gain per channel. Balance attenuates the other side: at −0.5 the right channel is at half amplitude and the left is untouched; at −1 the right is silent.
- **The ramp.** A level jump between two samples clicks just like a phase jump, and a slider that moves in steps makes a rough "zipper" noise. So the gains glide from their previous value to the new target over the whole buffer (`leftStep`, `rightStep`): 1600 samples, 33 ms. At the end `#left` and `#right` are set to the exact targets, so tiny rounding errors cannot build up.
- **Interleaving.** A stereo buffer alternates channels: `out[2 * i]` is the left sample of sample frame `i`, `out[2 * i + 1]` the right one.
- **The sweep.** Instead of adding to the frequency, every sample multiplies it by `SWEEP_STEP`, the 480 000th root of 250 (5000 / 20 over 10 seconds). Equal ratios are equal musical intervals, so the sweep spends as long on each octave. When it passes 5 kHz it starts again at 20 Hz; thanks to the phase accumulator even that jump in pitch does not click.
- **Noise.** `xorshift32` is a tiny pseudo-random generator: three shifts and XORs on a 32-bit state. It is deterministic (tests can rely on it) and allocates nothing.
- **The range.** Every value stays within −1…1. The SDK checks every sample and stops the stream with an error if one is outside that range or is not a number, so a generator must never overshoot, for example by adding signals without scaling them.

Changing the *waveform* is the one change that can still click: the phase continues, but a sine and a square have different values at the same phase. A short cross-fade would hide it; for a test-signal generator the hard switch is acceptable (and audible on purpose).

The square and the saw are "naive": their instant jumps contain harmonics above half the sample rate, which fold back as faint inharmonic tones (aliasing), most audible at high frequencies. Band-limited versions are an exercise at the end.

## Step 4: The frame clock

{@includeCode ../../examples/signal-generator/generator.ts#clock}

- `#start(n)` is the first sample of frame `n` on the exact timeline, rounded down: `n × 48 000 × den / num`. At 30 fps that is `n × 1600`.
- `next()` returns the distance to the next start. At 29.97 fps, frame 0 starts at sample 0, frame 1 at ⌊1601.6⌋ = 1601, frame 2 at ⌊3203.2⌋ = 3203, frame 3 at 4804, frame 4 at 6406: the lengths are 1601, 1602, 1601, 1602 and the sum always stays within one sample of the exact time.
- Computing each start from the frame number, instead of adding up rounded lengths, is what makes the error unable to accumulate. The numbers stay exact in a JavaScript `number` for far longer than any stream runs.
- `min` and `max` are the two possible lengths (both 1600 at 30 fps); the generator uses them to size its buffers once.

## Step 5: The picture

### Pixels

A stream frame is `width × height × 4` bytes: red, green, blue and alpha for each pixel, row by row from the top-left corner. Pixel (x, y) starts at byte `(y × width + x) × 4`.

{@includeCode ../../examples/signal-generator/video.ts#pixels}

Writing four bytes per pixel means four stores and four bounds checks. The renderer also views the same memory as a `Uint32Array`, one element per pixel, and writes a whole pixel at once. On a little-endian processor (x86-64 and ARM64, so every macOS and Windows machine the player supports) the first byte in memory is the lowest byte of the number, so the bytes R, G, B, A are the number `0xAABBGGRR`. `rgb()` builds that number; `>>> 0` turns JavaScript's signed 32-bit result back into an unsigned one. The module refuses to load on a big-endian machine rather than show wrong colours.

### Colour bars, drawn once

{@includeCode ../../examples/signal-generator/video.ts#bars}

The bars are the classic layout: seven 75 % bars, a narrow strip of reversed blue bars, and a bottom row with −I, 100 % white, +Q, black and a PLUGE (three narrow patches just below, at and just above black, for setting a display's brightness). The values are 8-bit approximations, good for checking that colours, levels and the left/right order survive the trip to the screen, not for calibration.

They never change, so the constructor draws them once into `#bars`. Each frame then copies them:

{@includeCode ../../examples/signal-generator/video.ts#draw}

`this.data.set(this.#bars)` is a single memory copy, the cheapest way to fill a frame. Whatever can be computed once should be.

### The moving grid

{@includeCode ../../examples/signal-generator/video.ts#grid}

Everything depends on the frame number only, so the picture moves at exactly the frame rate: a colour ramp scrolls 4 px per frame, the grid drifts, and a yellow bar crosses the frame every 60 frames (2 s). A dropped or repeated frame shows as a jump in the bar, which makes this the pattern for spotting stutter.

### The oscilloscope

{@includeCode ../../examples/signal-generator/video.ts#scope}

The scope draws `audio`, the buffer the oscillator has just filled for this very frame, so what you see is exactly what you hear.

- **Trigger.** A real oscilloscope waits for the signal to cross a level before it starts drawing, so a steady wave stands still. Here the trace starts at the first rising zero crossing of the mid signal (left + right) in the first half of the frame, and shows half a frame of audio (800 samples, 16.7 ms). Without the trigger the wave would jump sideways every frame, because 1600 samples is rarely a whole number of cycles.
- **Columns.** The 640 columns each cover about 1.25 samples. For each column the trace draws a vertical line from the lowest to the highest sample in it, including the first sample of the next column. That connects neighbouring points without drawing diagonal lines, and a 5 kHz tone (fewer than 10 samples per cycle) shows as a solid band instead of scattered dots.
- **Two traces.** Left (green) in the top half, right (amber) in the bottom half. Move the balance slider and watch one trace shrink: the balance is part of the signal the plugin generates.

### The bitmap font

The overlay needs text, but a plugin has no text renderer for pixels. Seven numbers per character are enough for a 5×7 font:

{@includeCode ../../examples/signal-generator/font.ts#glyphs}

The `GLYPHS` table is easy to read and edit; `FONT` is the same data indexed by character code, built once when the module loads, so drawing looks glyphs up with `charCodeAt` and never creates strings.

{@includeCode ../../examples/signal-generator/font.ts#draw}

- `drawChar` tests the five bits of each row (`0x10 >> column` is the mask for column 0 at the left … 4 at the right) and fills a `scale × scale` block for each set bit, using `Uint32Array.fill` for each row of the block. Pixels outside the frame are clipped.
- `drawText` takes string literals only, which already exist in memory, and returns the x position after the text so that calls can be chained.
- `drawNumber` draws digits right to left with `% 10` and `/ 10`. Turning a number into a string (`String(n)`, a template literal, `padStart`) would allocate a new string on every frame.

### The overlay

{@includeCode ../../examples/signal-generator/video.ts#overlay}

- `#shade` halves R, G and B of the boxes behind the text with one shift and one mask per pixel (`>>> 1` then `& 0x7f7f7f7f` drops the bit that moved into the neighbouring byte), so the text is readable over any pattern.
- The top line shows the waveform, "SWEEP" when sweeping, the frequency the oscillator is producing right now, and the level or "MUTE".
- The bottom line is a non-drop-frame timecode `HH:MM:SS:FF` and the frame counter. Both are computed from the frame number, so they stop when you pause and continue when you resume.

## Step 6: `frame()`

{@includeCode ../../examples/signal-generator/generator.ts#generator}

- **One allocation, up front.** The constructor allocates the audio buffer for the longest possible frame and two views of it, one for each frame length. `subarray` creates a view object, so the views are created once here rather than per frame.
- **The same objects every time.** `frame()` returns `#out`, whose `video` is the renderer's pixel buffer and whose `audio` is one of the two views. Reusing buffers is safe because the SDK does not call `frame()` again before it has handed the previous frame over to the player (it copies the data for the connection).
- **Audio first.** The oscillator fills `audio` before the renderer runs, so the oscilloscope can draw the samples of this very frame.
- **The frame number** is read before `next()` advances the clock: frame 0 shows timecode 00:00:00:00.

On a recent Apple Silicon Mac, `frame()` takes about 0.1 ms with the bars, 0.2 ms with the oscilloscope and 0.6 ms with the moving grid: a small share of the 33 ms a frame lasts. Running 20 000 frames triggers no garbage collection worth mentioning.

## Step 7: Opening the stream

The plugin's state lives at the top of `activate`:

{@includeCode ../../examples/signal-generator/main.ts#state}

`plugin.storage.json` loads `controls.json` from the plugin's data directory, or uses `DEFAULTS` when the file is missing or fails `isControls` (for example after a later version changed the format). The plugin works on a copy and saves after every change.

Starting is the heart of the example:

{@includeCode ../../examples/signal-generator/main.ts#start}

Line by line:

- `if (stream || starting) return;` A second Start (or the menu command while running) does nothing.
- `starting = new AbortController()` remembers that a start is in progress; its `signal` is given to `openStream` so that Stop can cancel it.
- `plugin.update()` sends "Starting…" to the window right away. The SDK re-evaluates the window's bound properties after each callback *returns*, and this callback is still waiting for `openStream`; without `update()` the window would show "Starting…" only when it is already over.
- `new SignalGenerator(controls)`: each run gets a fresh clock (the timecode starts at zero) but shares the one `controls` object with the window.
- `openStream({ width, height, frame, signal })` resolves once the stream plays. Before that, the SDK has prepared the connection to the player, called `frame()` until the first buffers were full (prefill), and asked the player to make the stream its source (activation).
- `if (attempt.signal.aborted)`: Stop was pressed just as `openStream` resolved. The stream is already playing, so stop it and leave.
- `opened.onStop(...)` is called when the stream ends **without** this plugin stopping it: `error` is `null` when another source replaced it (the user opened a file), or a {@link "@vestra-player/sdk"!PluginError | PluginError} when the stream failed, for example because `frame()` threw (or returned a frame that breaks a limit: code `invalid`). It is never called for the plugin's own `stop()`. The check `stream !== opened` ignores the end of a stream that `stop()` has already forgotten.
- `catch`: a cancelled start rejects with an `AbortError`, which is not a failure worth showing. Anything else is a start-up failure:

{@includeCode ../../examples/signal-generator/main.ts#errors}

Branch on `code`, never on the message. A `timeout` is a {@link "@vestra-player/sdk"!StreamStartError | StreamStartError} whose `stage` says which step ran out of its 10 seconds: `prefill` (the first buffers were not ready, usually because `frame()` is far too slow or throws) or `activation` (the player did not switch to the stream). `device` means the audio output is not ready, `stream` that the player refused the stream.

## Step 8: The control window

The window declares a property for each value and a callback for each action:

{@includeCode ../../examples/signal-generator/ui/controls.slint:22-56}

- The values the user edits (`pattern`, `frequency`, `level`, …) are `in-out`: the plugin writes them, and the controls write them too.
- The texts and states the plugin computes (`level-text`, `filter-status`, `running`, …) are `in`: the window only shows them.
- The callbacks carry the new value to the plugin. Names are kebab-case in Slint and may be written in camelCase in TypeScript (`level-moved` is `levelMoved`).

A control connects to its property with a two-way binding and reports changes through its callback:

{@includeCode ../../examples/signal-generator/ui/controls.slint:102-113}

`value <=> root.level` keeps the slider and the property in step in both directions: a drag moves the property, and a value the plugin writes moves the slider. `changed(db)` tells the plugin.

On the plugin side, one `bind()` keeps every property equal to the model:

{@includeCode ../../examples/signal-generator/main.ts#bind}

The SDK re-evaluates this function after every callback, every player state change and every filter status change, and sends only the values that changed. The window therefore never needs to be "refreshed" by hand: the plugin changes its variables, and the window follows.

The callbacks update the model:

{@includeCode ../../examples/signal-generator/main.ts#callbacks}

- `change()` updates the shared `controls` object **in place**. The generator holds the same object, so the next `frame()` uses the new values; there is no message to send and nothing to restart. `store.save()` writes the file 300 ms after the last change, so a slider drag does not write the file dozens of times.
- Values from the window are checked: `bounded()` clamps a number into its range and keeps the old value for `NaN`; an unknown index keeps the old choice.
- The balance snaps to the centre within ±3 %, so the user can find "centre" with the mouse.

How fast is "live"? A change reaches the next `frame()` call. The audio of the frames already queued (about 50 ms) still plays with the old values, and the sound card adds its own latency, so a change is heard roughly 50–100 ms after the slider moves. Then the gain ramp spreads it over one more frame.

## Step 9: The audio filter

The filter is created and given its first value at activation:

{@includeCode ../../examples/signal-generator/main.ts#filter}

Its chain comes from the window's choice:

{@includeCode ../../examples/signal-generator/filter.ts#nodes}

- Every node is from the player's fixed list ({@link "@vestra-player/sdk"!AudioNode | AudioNode}); values outside their ranges fail with `invalid`. There is no low-pass node; `treble` is a high-shelf boost with a fixed 3 kHz corner and slope, and only `gainDb` (0–6 dB) can change.
- `set()` keeps only the newest value and sends one request at a time, so it can be called on every change.
- `[]` removes this plugin's chain; other plugins' chains are not affected.

The status line tells the user what the player did with it:

{@includeCode ../../examples/signal-generator/filter.ts#status}

To hear the difference between the two sides, choose **Swap left / right** while the tone plays with the balance at full left. The tone stays on the left: swapping is the player's job, and the player does not route a generated stream through its filters, so the status reads "Not applied to this stream: the player filters media it decodes". Now open any stereo music file: the SDK applies the kept chain to the new source, the status changes to "Applied by the player", and the channels are swapped. Moving the balance slider, on the other hand, changes the tone immediately and shows on the oscilloscope: the balance is computed in the plugin.

## Step 10: Stopping and cleaning up

{@includeCode ../../examples/signal-generator/main.ts#stop}

The order matters:

1. **Abort a start in progress.** If `openStream` is still preparing, aborting it guarantees that the stream will never become the player's source after the user pressed Stop. (`start()` handles the case where it had just finished.)
2. **Forget the stream before stopping it**, so that its `onStop` listener knows the end was intended and shows no error.
3. **`stream.stop()`** closes the source if it is still the player's source, then the frame connection, then releases the producer. In that order, the player sees an ordinary "closed" source. If the connection went away first while the stream was still selected, the player would report a playback failure ("producer transport closed").

If another source already replaced the stream, `stop()` leaves that source alone: a plugin only ever closes its own source.

You do not need any of this when the plugin is disabled or the player quits. The stream belongs to the plugin's scope, and disposing the scope calls `stop()` the same way; a start still in progress is cancelled too. The window closes and the filter chain is withdrawn as well.

Finally the menu command, which shows the window and starts the stream:

{@includeCode ../../examples/signal-generator/main.ts#command}

`path: ["@open", "Signal Generator…"]` puts it into the player's own Open menu. Menu paths are matched by their exact titles, and the player's menus are titled in its language (打开 today), so `["Open", …]` would add a second top-level menu; a first segment starting with `@` names a built-in menu whatever its title.

`plugin.onError` collects errors thrown by callbacks and failed property writes, and shows them in the window instead of leaving them only in the plugin log.

## Step 11: Tests

The tests run with `npm test`, without a player or an audio device. The pure modules are tested directly. The oscillator, for example, must produce a 1 kHz sine with 1000 rising zero crossings per second and an RMS of 1/√2:

{@includeCode ../../examples/signal-generator/tests/audio.test.ts#waveform}

The click test feeds frequency and level changes through the oscillator and checks that no step between two samples is larger than the steepest slope of a clean 2 kHz sine:

{@includeCode ../../examples/signal-generator/tests/audio.test.ts#continuity}

The frame clock is checked for exact and fractional rates:

{@includeCode ../../examples/signal-generator/tests/generator.test.ts#clock}

The plugin as a whole runs against {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, the SDK's in-memory player. It speaks the real protocol, including the frame connection, so the SDK's prefill, activation and stop sequence run unchanged. To see the frames, the harness wraps `plugin.player.openStream` before `activate` runs and passes every frame through a spy:

{@includeCode ../../examples/signal-generator/tests/harness.ts#spy}

Then a test can drive the menu and the window and check what reached the player:

{@includeCode ../../examples/signal-generator/tests/plugin.test.ts#start-test}

- `host.producers.get(1)` is the player end of the stream: `videoFrames` and `receivedFrames` (audio sample frames) count what arrived. Exactly 1600 sample frames per video frame is the A/V contract.
- Streams are paced by timers, so the tests poll with `until()` instead of relying on `host.settle()` alone.

Controls must reach the generator. After a change the test waits two frames (the first one glides to the new value) and measures the audio and the picture:

{@includeCode ../../examples/signal-generator/tests/plugin.test.ts#controls-test}

The filter test checks that the chain is refused during the stream (the test host answers `unsupported`, like the player), applied to a file, and removed with **Off**:

{@includeCode ../../examples/signal-generator/tests/plugin.test.ts#filter-test}

The stop tests check the order from Step 10. `droppedWhileSelected` would be `true` if the frame connection had closed while the stream was still the player's source:

{@includeCode ../../examples/signal-generator/tests/plugin.test.ts#stop-test}

Failures go through the same path as in the player. Here the host reports that the audio device is lost, then another source replaces the stream:

{@includeCode ../../examples/signal-generator/tests/plugin.test.ts#errors-test}

## Build and run

```sh
cd examples/signal-generator
npm install
npm run check   # manifest rules and a strict type check
npm test        # all tests
npm run pack    # examples.signal-generator-1.0.0.vxp
```

To try it in the player without building, start the player with `--plugin <path to examples/signal-generator>` and choose **Open ▸ Signal Generator…** from the menu. Then:

- The colour bars appear with the timecode running at the bottom, and a 1 kHz tone plays at −18 dBFS.
- Choose **Oscilloscope** and move the frequency slider: the trace stands still while the pitch changes smoothly.
- Turn on **Sweep**: the frequency on screen climbs from 20 Hz to 5 kHz in 10 seconds.
- Pause the player: the timecode and the sound stop together; resume and both continue.
- Press **Stop**: the player returns to its empty state without an error.

The packed `.vxp` is the file users install.

## Performance notes

- **Budget.** At 30 fps a frame lasts 33 ms, but the SDK keeps only about 50 ms of audio queued, so a single `frame()` call that takes longer than that, or a long garbage-collection pause, is heard as a dropout. Keep `frame()` well under 10 ms.
- **Allocate nothing per frame.** No `new`, no array or object literals, no closures, no string building (template literals, `toFixed`, `padStart`), no `subarray` or `slice` in `frame()` and the code it calls. Allocate buffers once and overwrite them. Small allocations are cheap one by one, but 30 frames a second of them eventually make the garbage collector pause.
- **Do the work once.** Static content (the colour bars, the font table, lookup tables) is computed once and copied per frame.
- **Write pixels as 32-bit words**, and fill runs with `fill()` or copy blocks with `set()`, which are native memory operations.
- **Mind the frame size.** The SDK copies every frame once to send it to the player: 640×360 is 0.9 MB per frame, 27 MB/s at 30 fps. A frame can be at most 4 MiB, so the largest 16:9 size is about 1280×720 (3.5 MiB); 1920×1080 (8.3 MB) is refused. The player scales the picture to the window, so a test pattern rarely needs more than 640×360. Because of that copy, `frame()` may return the same buffers every time.
- **Keep samples within ±1.** Every sample must be a finite number between −1 and 1; a `NaN` or an overflowing mix ends the stream with `invalid`. Clamp after mixing.
- **Measure.** Time `frame()` in a loop outside the player (`performance.now()` around a few thousand calls) and run it with `node --trace-gc` to see whether it causes collections.

## Exercises

1. **29.97 fps.** Set `FPS` to `{ num: 30000, den: 1001 }`. The frame clock already alternates 1601 and 1602 samples. The timecode is non-drop-frame and slowly runs ahead of the clock on the wall; implement drop-frame timecode (skip frame numbers 00 and 01 at the start of every minute except every tenth).
2. **An A/V sync test.** Once per second, make the picture flash white for one frame and play a 10 ms beep starting at the first sample of that same frame. Watching the flash and listening for the beep shows the player's audio/video offset, and how a non-zero `delayMs` on an audio filter shifts the sound of a file.
3. **Band-limited waveforms.** Replace the naive square and saw with PolyBLEP versions, and compare the 5 kHz square on a spectrum analyser.
4. **Pink noise.** Filter the white noise with the Paul Kellet or Voss–McCartney algorithm, keeping the filter state in the oscillator.
5. **A Lissajous scope.** Add a fourth pattern that plots left against right (X–Y). A sine panned by the balance becomes a tilted line; swap channels in your own code to see it rotate.
6. **A shortcut.** Add a `Ctrl+Alt+M` command that toggles mute, with `checked: () => controls.mute`, so the menu shows the state.

## See also

- {@link "@vestra-player/sdk"!Player.openStream | Player.openStream}, {@link "@vestra-player/sdk"!StreamOptions | StreamOptions}, {@link "@vestra-player/sdk"!StreamFrame | StreamFrame}, {@link "@vestra-player/sdk"!Stream | Stream}
- {@link "@vestra-player/sdk"!AudioFilter | AudioFilter}, {@link "@vestra-player/sdk"!AudioNode | AudioNode}, {@link "@vestra-player/sdk"!FilterStatus | FilterStatus}
- {@link "@vestra-player/sdk"!View | View} (`bind`, `on`, `set`), {@link "@vestra-player/sdk"!Storage | Storage}
- {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, {@link "@vestra-player/sdk/testing"!FakeProducer | FakeProducer}
