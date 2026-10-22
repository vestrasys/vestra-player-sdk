# Panel menu

A sidebar panel with its own right-click menu, keys that only work while the panel has focus, commands outside the main menu, and the next/previous sequence it provides to the player. It takes the sidebar, so do not load it together with a playlist plugin.

![Panel menu running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.mount`, `playback.read`, `events`, `playback.control` | `panels.mount`, `Panel.showMenu`, `focus: "panel"`, `player.provideSequence` |

## Run it

```sh
cd examples/panel-menu
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.panel-menu-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/panel-menu>` to run `main.ts` directly, no build needed.

More examples: [Examples](https://vestrasys.github.io/vestra-player-sdk/documents/Examples.html).
