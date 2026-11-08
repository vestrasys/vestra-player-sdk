# Three ways

One plugin written in the three styles of the SDK: four scenarios side by side, compared in [Three ways to write a plugin](https://vestrasys.github.io/vestra-player-sdk/documents/Three_ways_to_write_a_plugin.html).

| File         | Style                                                        |
| ------------ | ------------------------------------------------------------ |
| `style-a.ts` | A: `bind()` and function fields, `plugin.state` (the default) |
| `style-b.ts` | B: `plugin.player.on(event)` and `set()`                     |
| `style-c.ts` | C: `plugin.wire` (experimental, changes with versions)       |

The scenarios: a bottom panel with the playback speed (C cycles it), an emulator's status line in a window that changes on every frame (Open ▸ Demo emulator), a sidebar list of 20,000 entries where a double click marks one played, and Playback ▸ Next Keyframe, enabled once an asynchronous check says the source has video.

`main.ts` runs style A; change `entry` in `manifest.json` to `style-b.ts` or `style-c.ts` to run another. The tests run all three.

```sh
npm install
npm run check && npm test
```
