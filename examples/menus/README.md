# Menus

An **Examples** menu with the speeds 0.5×, 1×, 1.5× and 2× as radio items, and below a separator a **Speed: 1×** item whose title changes when you pick a speed.

![Menus running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `playback.read`, `events`, `playback.control` | `commands.add` (`radio`, `checked`, `group`, `order`, `enabled`), `scope()`, `player.setRate` |

## Run it

```sh
cd examples/menus
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.menus-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/menus>` to run `main.ts` directly, no build needed.

Walkthrough: [Menus](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Menus.html).
