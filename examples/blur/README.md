# Blur

A live Gaussian blur over the video that is playing. **Video ▸ Blur…** opens a small window with one slider: move it to blur the video, set it to 0 to turn the blur off.

![The Blur window over a playing video](screenshot.png)

| Capabilities                                                           | API                                                                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `commands`, `ui.window`, `processing.video`, `playback.read`, `events` | `commands.add` in the `@video` menu, `windows.create` with `bind` and `on`, `video.filter` with a `gblur` node; tests with `startPlugin` |

## Files

```text
manifest.json       id and capabilities
main.ts             the filter, the window and the menu command
ui/blur.slint       the window: one slider
tests/blur.test.ts  tests against the SDK's in-memory test host
```

## Run it

```sh
cd examples/blur
npm install
npm run check && npm test   # type check, then the tests
npm run pack                # build dist/ and pack examples.blur-1.0.0.vxp
```

In the player: start it with `--plugin <path to examples/blur>` to run `main.ts` directly, no build needed. Open a video, then choose **Video ▸ Blur…**.

Walkthrough: [Example: Blur](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Blur.html).
