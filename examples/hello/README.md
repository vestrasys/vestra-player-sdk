# Hello

The [Quick start](https://github.com/vestrasys/vestra-player-sdk#quick-start), runnable: one menu command, **Tools → Hello**, that shows an on-screen message.

![Hello running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.osd` | `commands.add`, `osd.show`; tests with `startPlugin` |

## Run it

```sh
cd examples/hello
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.hello-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/hello>` to run `main.ts` directly, no build needed.

Walkthrough: [Hello](https://vestrasys.github.io/vestra-player-sdk/documents/Hello.html).
