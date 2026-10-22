# Markdown

**Examples → Markdown example…** opens a window that shows `sample.md` with the core `MarkdownView` component: headings, lists, code, quotes, tables, a local and a remote image, and links (web links open in the browser). The manifest also shows the display fields (`name`, `author`, `punchline`, `description`, `tags`, `icon`, `license`) and `minPlayerVersion`.

![Markdown running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.window`, `ui.osd` | `ui.markdown`, `@vestra/markdown.slint`, `system.openUrl`; package assets in `package.json` (`"vestra": { "assets": [...] }`) |

## Run it

```sh
cd examples/markdown
npm install
npm run check && npm test   # type check, then the tests against the in-memory test host
npm run pack                # build dist/ and pack examples.markdown-0.1.0.vxp
```

In the player: start it with `--plugin <path to examples/markdown>` to run `main.ts` directly, no build needed.

More examples: [Examples](https://vestrasys.github.io/vestra-player-sdk/documents/Examples.html).
