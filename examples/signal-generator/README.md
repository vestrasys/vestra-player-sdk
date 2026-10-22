# Signal Generator

A Vestra Player plugin that generates its own video and audio and plays them in the player like any other source.

![Signal Generator: colour bars with the timecode overlay, and the control window](screenshot.png)

- **Picture**: SMPTE-style colour bars, a moving grid, or an oscilloscope of the plugin's own audio, with a timecode and frame counter drawn by a built-in 5×7 bitmap font.
- **Tone**: sine, square, saw or noise; 20 Hz – 5 kHz (or a 10 s sweep), level in dBFS, mute, balance. Every change applies live, without clicks.
- **Player filter**: an audio chain (mono, swap left/right, treble boost) that the player applies to the media it decodes. It shows where plugin-side generation ends and player-side processing begins.

Open it from **Open ▸ Signal Generator…**.

## What it shows

| API | Used for |
| --- | --- |
| `player.openStream` | The generated 640×360, 30 fps source with 48 kHz stereo audio |
| `Stream.onStop`, `Stream.stop`, `StreamStartError` | Stop button, replacement by another source, start-up errors |
| `audio.filter` | The player-side audio chain and its status |
| `windows.create`, `bind`, `on` | The control window |
| `commands.add` | The menu entry |
| `storage.json` | Remembering the controls |
| `update` | Showing "Starting…" while a handler is still running |

The step-by-step walkthrough is in [docs/examples/signal-generator.md](../../docs/examples/signal-generator.md).

## Files

```text
manifest.json    id, display fields, capabilities (producer.av …)
main.ts          activate(): menu, window, stream life cycle, filter
controls.ts      the settings, their ranges and defaults
generator.ts     frame(): the frame clock and the per-frame work
audio.ts         the phase-accumulator oscillator
video.ts         test patterns, oscilloscope and overlay
font.ts          the 5×7 bitmap font
filter.ts        the player-side audio chain
ui/controls.slint  the control window
tests/           node:test suites against the SDK's TestHost
```

## Run it

```sh
npm install
npm run check   # manifest and strict type check
npm test        # unit tests and TestHost tests
npm run pack    # examples.signal-generator-1.0.0.vxp
```

During development, start the player with `--plugin <path to this directory>`; no build is needed.
