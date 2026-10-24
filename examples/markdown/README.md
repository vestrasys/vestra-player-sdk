# Markdown

**Examples → Markdown example…** opens a window that shows `sample.md` with the player's `MarkdownView` component: headings, lists, code, quotes, a table and an image from the package. The manifest also has the display fields the plugin manager shows (`name`, `author`, `punchline`, `description`, `tags`, `icon`, `license`).

![Markdown running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.window` | `ui.markdown`, `MarkdownView` from `@vestra/markdown.slint`, `Window.set`; package assets in `package.json` (`"vestra": { "assets": [...] }`) |

## Run it

```sh
cd examples/markdown
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.markdown-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/markdown>` to run `main.ts` directly, no build needed.

Walkthrough: [Markdown](https://vestrasys.github.io/vestra-player-sdk/documents/Example__Markdown.html).
