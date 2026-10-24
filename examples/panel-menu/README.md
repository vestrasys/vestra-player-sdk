# Panel menu

A list in the player's sidebar with its own right-click menu. It takes the sidebar, so do not load it together with a playlist plugin.

![Panel menu running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.mount` | `panels.mount`, `Panel.bind` / `on`, `Panel.showMenu`, commands without a menu path |

## Run it

```sh
cd examples/panel-menu
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.panel-menu-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/panel-menu>` to run `main.ts` directly, no build needed.

Walkthrough: [Panel menu](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Panel_menu.html).
