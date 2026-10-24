---
title: "Example: Signal generator"
---

# Example: Signal generator

This walkthrough builds a plugin that **generates its own video and audio** and plays them in Vestra Player like any other source: colour bars and a 1 kHz sine tone. It is about 110 lines of TypeScript in one file, with no window. Along the way it covers how {@link "@vestra-player/sdk"!Player.openStream | Player.openStream} pulls frames from a plugin, how a frame's pixels are laid out, how many audio samples go with each picture, how to keep a tone smooth across frames, and how to stop a stream.

The complete, tested source is in [`examples/signal-generator`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/signal-generator). Every code block on this page is taken from those files, so it always matches the code that CI checks and tests.

## What you'll build

![Colour bars from the signal generator](../../examples/signal-generator/screenshot.png)

- **Open ▸ Signal generator** in the player's own Open menu starts a generated source: seven colour bars at 640×360 and 29.97 frames per second, with a 1 kHz tone at −12 dBFS on both channels.
- The menu item has a check mark while the stream runs. Choosing it again stops the stream, and the player goes back to its empty state.

You should know the basics from [Hello](hello.md): the manifest, `activate` and commands.

## How a generated source works

Usually the player plays a file: it decodes the picture and the sound and keeps them in step. A **generated source** has no file. The plugin calls `openStream` with a frame size and a `frame()` function, and the player plays whatever `frame()` returns. To the user it is a source like any other: it replaces what was playing, play/pause works, and opening a file replaces it in turn.

The plugin does not push frames on a timer of its own. **The player pulls them:** the SDK calls `frame()` whenever the player needs more.

- `frame()` is never called twice at the same time, and not at all while the player is paused.
- It is paced by the **audio clock**. The SDK keeps a little audio queued ahead of the sound card (about 50 ms) and calls `frame()` when the queue runs low.
- It is **synchronous**: it cannot `await`, so everything it needs must already be in memory. If it is slow, the sound drops out.

Each call returns one picture and **the audio that plays while that picture is on screen**. The stream's timeline is its audio: the player plays the samples at 48 000 per second and shows each picture when the audio reaches it. A frame that carries 1600 samples therefore lasts 1600 / 48 000 s = 1/30 s. The number of samples per frame _is_ the frame rate; there is no separate setting.

## The files

```text
examples/signal-generator/
  manifest.json                   id and capabilities
  main.ts                         the picture, the tone, frame(), start and stop, the command
  tests/signal-generator.test.ts  tests of frame() and of the stream on the in-memory test host
  package.json                    the SDK as a dev dependency, and the npm scripts
```

## The manifest

{@includeCode ../../examples/signal-generator/manifest.json}

| Capability         | Why                                                                                                                                                                           |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`         | The menu command.                                                                                                                                                             |
| `producer.av`      | `player.openStream`: producing frames.                                                                                                                                        |
| `playback.control` | The stream becomes the player's source, like opening a file, and Stop closes it. `openStream` needs this as well as `producer.av`.                                            |
| `playback.read`    | When it stops, the stream reads the player's state to check that it is still the current source before closing it, so it never closes a file the user opened in the meantime. |

`minPlayerVersion` is 0.3.0 because the command's path uses the `@open` menu id, new in that version. The display fields (`name`, `punchline`, `description`, …) are what the plugin manager and the store show.

## main.ts, top to bottom

### The format

{@includeCode ../../examples/signal-generator/main.ts#format}

- 640×360 is plenty for a test picture: the player scales it to the window. A frame may be at most 4 MiB, so 1280×720 is the largest 16:9 size.
- `FPS` is 29.97, the NTSC rate, on purpose: 48 000 / 29.97 = 1601.6 samples is not a whole number, which is the interesting case (see [frame()](#frame)). At 25 or 30 fps the division is exact.
- A stream's audio is always 48 kHz, stereo, 32-bit float; the plugin cannot choose another rate.
- `LEVEL` is the tone's amplitude. Samples must stay within −1…1: a sample outside that range, or one that is not a number, ends the stream with the code `invalid`.

### The picture: RGBA bytes

{@includeCode ../../examples/signal-generator/main.ts#bars}

A frame's picture is a `Uint8Array` of exactly `width × height × 4` bytes: **red, green, blue and alpha for each pixel, row by row, starting at the top left**. So pixel (x, y) starts at byte `(y × width + x) × 4`:

- `x * 7 / WIDTH` picks the bar: the first 1/7 of every row is grey, the last 1/7 blue.
- The values are 75 % (191 of 255), as in the classic SMPTE test bars.
- Alpha 255 means opaque. The player shows the picture as it is.

The bars never change, so they are drawn once when the module loads.

### frame()

{@includeCode ../../examples/signal-generator/main.ts#frame}

This is the function the player calls for every frame. Three things happen in it.

**How many samples.** 48 000 / 29.97 = 1601.6. Rounding every frame down to 1601 would make the sound run 0.6 samples short per frame, about 1.3 seconds per hour, and the picture would drift away from it. Instead, `owed` accumulates the exact amount, the frame takes the whole samples, and the fraction is carried to the next frame:

| Frame | `owed` before | Samples | Carried |
| ----- | ------------- | ------- | ------- |
| 0     | 1601.6        | 1601    | 0.6     |
| 1     | 1602.2        | 1602    | 0.2     |
| 2     | 1601.8        | 1601    | 0.8     |
| 3     | 1602.4        | 1602    | 0.4     |

The frames alternate between 1601 and 1602 samples, and the total never differs from the exact time by more than one sample, however long the stream runs.

**The sine, phase-continuous.** The obvious formula, `sin(2π × frequency × t)`, needs the time `t`, and it makes every frame start the wave from scratch unless `t` is tracked exactly. Instead the code keeps a **phase**: the position inside the current cycle, from 0 up to (not including) 1.

- The sample is `LEVEL × sin(2π × phase)`.
- After each sample, the phase advances by `FREQUENCY / SAMPLE_RATE`: at 1 kHz that is 1/48 of a cycle, so a cycle takes 48 samples.
- At 1 the phase wraps back to 0, so the number never grows and never loses precision.

`phase` lives outside `frame()`, so each frame continues exactly where the previous one ended. That matters: a frame of 1601.6 samples holds 33.37 cycles, not a whole number, so a wave restarted at every frame would jump, and a jump in a waveform is heard as a click, 30 times a second. With the phase it is one smooth tone. The same trick keeps the tone smooth when the frequency changes (see [Try next](#try-next)).

**Interleaved stereo.** The audio is one `Float32Array` with the channels alternating: `audio[2 * i]` is the left sample of sample frame `i`, `audio[2 * i + 1]` the right one. Its length is twice the number of samples.

**Reusing the buffers.** `frame()` returns the same `video` array every time, and `audio` is a view into one buffer allocated up front, big enough for the longest frame (1602 stereo samples). That is safe: the SDK copies each frame before it calls `frame()` again. Allocating new arrays 30 times a second would work too, but it gives the garbage collector work, and a long collection pause is heard as a dropout.

### Starting and stopping

{@includeCode ../../examples/signal-generator/main.ts#start-stop}

- `openStream({ width, height, frame })` resolves once the stream plays. Before that, the SDK has set up a local connection to the player, called `frame()` a few times to fill the first buffers, and asked the player to make the stream its source. It rejects if that fails, for example with `device` when the audio output is not ready, or `timeout` after 10 seconds; the error then goes to the plugin log.
- `starting` covers the moment between the call and its result, so that choosing the command twice quickly does not start two streams.
- `onStop` is called when the stream ends **without** the plugin stopping it: the user opened a file, or the stream failed (its argument is then the error). The plugin just forgets the stream, and the menu's check mark goes away. It is not called for the plugin's own `stop()`.
- `stop()` forgets the stream first, then calls `stream.stop()`. That closes the source if it is still the player's source, then the frame connection, then the producer. In that order the player sees an ordinary "closed" source rather than a playback failure. If another source already replaced the stream, `stop()` leaves that source alone.

When the plugin is disabled or the player quits, the SDK stops the stream the same way: it belongs to `plugin`.

### The command

{@includeCode ../../examples/signal-generator/main.ts#command}

- `path: ["@open", "Signal generator"]` puts the item in the player's own **Open** menu. Menu paths are matched by their exact titles, and the player's menus are titled in its own language, so `["Open", …]` would add a second top-level menu. A first segment starting with `@` names a built-in menu whatever its title.
- `checked` is a function. The SDK calls it again after every handler and every `onStop`, and updates the check mark when the result changes.
- `run` starts the stream when there is none and stops it when there is one. It returns the promise so that a failure reaches the plugin log.

## The tests

{@includeCode ../../examples/signal-generator/tests/signal-generator.test.ts}

- The first two tests call `frame()` directly, with no player: the picture's size and colours, the 1601/1602 sample counts and their total, and that no step between two neighbouring samples is larger than a clean 1 kHz sine allows, across frame boundaries too.
- The third runs the plugin against `TestHost`, the SDK's in-memory player. It speaks the real protocol, including the frame connection, so the SDK's start-up and stop sequence run unchanged. `host.producers.get(1)` is the player's end of the stream: `released` says the plugin let go of it, and `droppedWhileSelected` would be `true` if the connection had closed while the stream was still the player's source.
- A stream runs on timers, so the test polls with `until()` instead of relying on `host.settle()`.

## Run it

In the SDK repository, build the SDK once (`npm ci` at the root), then:

```sh
cd examples/signal-generator
npm install
npm run check   # manifest rules and a strict type check
npm test
```

Start the player with `--plugin <path to examples/signal-generator>`: it runs `main.ts` directly, with no build step. Choose **Open ▸ Signal generator**: the bars appear and the tone plays. Pause and resume: picture and sound stop and continue together. Choose the command again: the player returns to its empty state. `npm run pack` builds `examples.signal-generator-1.0.0.vxp`, the file users install.

## Try next

1. **A frequency slider.** Add a tool window with one `Slider` (see [Blur](blur.md)) and make `FREQUENCY` a variable that its callback changes. The next `frame()` uses the new value; because the phase continues, the pitch glides without a click.
2. **Movement.** Draw a white bar whose position depends on a frame counter. A dropped or repeated frame then shows as a jump.
3. **Show why it stopped.** Add the `ui.osd` capability and call `plugin.osd.show(error.message)` in `onStop` when `error` is not `null`.

## See also

- {@link "@vestra-player/sdk"!Player.openStream | Player.openStream}, {@link "@vestra-player/sdk"!StreamOptions | StreamOptions}, {@link "@vestra-player/sdk"!StreamFrame | StreamFrame}, {@link "@vestra-player/sdk"!Stream | Stream}
- {@link "@vestra-player/sdk/testing"!TestHost | TestHost}, {@link "@vestra-player/sdk/testing"!FakeProducer | FakeProducer}
