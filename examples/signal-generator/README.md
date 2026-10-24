# Signal Generator

A plugin that generates its own video and audio: **Open ▸ Signal generator** plays colour bars with a 1 kHz sine tone, and choosing it again stops them.

![Colour bars from the signal generator](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `producer.av`, `playback.control`, `playback.read` | `player.openStream` with a `frame()` callback, `Stream.stop` and `onStop`, a checkable command in the `@open` menu; tests with `startPlugin` |

## Files

```text
manifest.json                   id and capabilities
main.ts                         the picture, the tone, frame(), start and stop, the command
tests/signal-generator.test.ts  tests of frame() and of the stream on the in-memory test host
```

## Run it

```sh
cd examples/signal-generator
npm install
npm run check && npm test   # type check, then the tests
npm run pack                # build dist/ and pack examples.signal-generator-1.0.0.vxp
```

In the player: start it with `--plugin <path to examples/signal-generator>` to run `main.ts` directly, no build needed. Choose **Open ▸ Signal generator**.

Walkthrough: [Example: Signal generator](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Signal_generator.html).
