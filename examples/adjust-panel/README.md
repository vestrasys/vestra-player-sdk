# Adjust panel

A speed slider in the player's adjust column, the column of controls for what is playing, between the video and the sidebar (player 0.7.6). Alt+5 opens the column at this tab and closes it again; the key shows under the tab.

| Capabilities | API |
| --- | --- |
| `commands`, `ui.mount`, `playback.read`, `playback.control`, `events` | `panels.mount("adjust")`, `Panel.toggle`, `CommandOptions.home`, `player.setRate` |

Why `"adjust"` and not `"sidebar"`: after the user closes the panel, they do not keep looking at it; it only changes what is playing. A list, chapters or search results would go in the sidebar. The manifest declares `minPlayerVersion` 0.7.6, since older players refuse the slot.

## Run it

```sh
cd examples/adjust-panel
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.adjust-panel-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/adjust-panel>` to run `main.ts` directly, no build needed. Open the column with Alt+5 or the bottom bar's Adjust button.

Walkthrough: [Adjust panel](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Adjust_panel.html).
