# Core UI

The core user interface API in one **Examples** submenu: radio items, ordering and groups, a key binding that repeats while held, a command without a menu entry, a menu item whose title changes, on-screen messages, next/previous, the shared sidebar (show, detach) and a tool window drawn with the `@vestra/` theme and widgets. The last speed is remembered in the plugin's data directory.

![Core UI running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.mount`, `ui.osd`, `ui.window`, `playback.read`, `playback.control`, `events` | `commands.add` (`radio`, `group`, `bindings`, `repeat`), `scope()`, `osd.show`, `panels.sidebar`, `@vestra/theme.slint`, `@vestra/widgets.slint` |

## Run it

```sh
cd examples/core-ui
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.core-ui-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/core-ui>` to run `main.ts` directly, no build needed.

More examples: [Examples](https://vestrasys.github.io/vestra-player-sdk/documents/Examples.html).
