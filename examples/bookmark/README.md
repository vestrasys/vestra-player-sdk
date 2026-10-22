# Bookmark

A small, complete plugin: **Playback → Bookmark…** opens a tool window that remembers the current position and jumps back to it.

![Bookmark running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.window`, `playback.read`, `events`, `playback.control` | `windows.create`, `Window.bind` / `on`, `player.state`, `player.seek` |

## Run it

```sh
cd examples/bookmark
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.bookmark-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/bookmark>` to run `main.ts` directly, no build needed.

More examples: [Examples](https://vestrasys.github.io/vestra-player-sdk/documents/Examples.html).
