---
title: "Example: Markdown"
---

# Example: Markdown

This walkthrough builds **Markdown**, a plugin that shows a formatted document in a tool window with the player's `MarkdownView` component: headings, lists, code, quotes, tables, local and remote images, and links. The plugin never parses Markdown: it passes the text to the player, which parses and draws it. Along the way it covers how relative images are found, which files a package must carry, and the manifest fields the plugin store and plugin manager show.

The complete source is in [`examples/markdown/`](https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/markdown). Every code block on this page is pulled from those files, so what you read is exactly what is built and tested.

## What you'll build

![Markdown in Vestra Player](../../examples/markdown/screenshot.png)

- **Examples ▸ Markdown example…** opens a window titled **Markdown example** that shows `sample.md`, a document that uses every element the view supports.
- The plugin's icon, drawn from the package, appears as a local image; the vestrasys avatar is downloaded from GitHub as a remote one. An SVG badge, which the view cannot draw, shows its alternative text.
- A click on a web link opens it in the browser. A click on the in-page link `#tables` shows its address over the video.
- In the plugin manager, the plugin has a name, an author, a one-line summary, a description, tags, an icon and a licence.

## Prerequisites

- Node.js 26 or newer and npm.
- Vestra Player 0.2.0 or newer: {@link "@vestra-player/sdk"!Ui.markdown | plugin.ui.markdown} and the manifest's display fields are new in 0.2.0, and the manifest says so with `minPlayerVersion`.
- You have read [Getting started](../tutorials/getting-started.md), and ideally the [Bookmark](bookmark.md) walkthrough, which explains tool windows, `bind`, `on` and the test host.

## File layout

```text
examples/markdown/
  manifest.json              identity, capabilities and the display fields
  main.ts                    activate(): the window and the command
  ui/document.slint          the window: a MarkdownView
  sample.md                  the document it shows
  assets/icon.png            the plugin's icon, also an image in sample.md
  tests/markdown.test.ts     a test against the SDK's TestHost
  package.json               the SDK as a dev dependency, scripts, assets
  README.md
```

## Step 1: The manifest: capabilities and display fields

{@includeCode ../../examples/markdown/manifest.json}

The first five fields are the usual ones. The capabilities are three:

| Capability | Why Markdown needs it |
| --- | --- |
| `commands` | {@link "@vestra-player/sdk"!Commands.add | plugin.commands.add}: the menu item. |
| `ui.window` | {@link "@vestra-player/sdk"!Windows.create | plugin.windows.create}: the document window. |
| `ui.osd` | {@link "@vestra-player/sdk"!Osd.show | plugin.osd.show}: the message for in-page links. |

`plugin.ui.markdown` and {@link "@vestra-player/sdk"!System.openUrl | plugin.system.openUrl} need no capability.

The rest of the manifest is **display fields**. The player does not use them to run the plugin; the plugin store and the plugin manager show them:

| Field | Here | Rule |
| --- | --- | --- |
| `name` | Markdown example | 1–64 characters, one line. |
| `author` | Vestra Player | 1–64 characters, one line. |
| `punchline` | A one-line summary | 1–120 characters. |
| `description` | What the window shows | Plain text, 1–2000 characters; line breaks allowed. |
| `tags` | Example, Markdown | Up to 8, 1–24 characters each, unique ignoring case. |
| `icon` | `assets/icon.png` | A PNG or JPEG in the package, at most 512 KB and 1024 pixels per side (256×256 recommended). |
| `license` | Apache-2.0 | 1–64 characters, preferably an SPDX expression. |

`minPlayerVersion: "0.2.0"` makes older players refuse the plugin with a clear "requires Vestra Player ≥ 0.2.0" instead of loading it and failing on the first `ui.markdown` call. Set it whenever you use API that is newer than the first release; the reference marks such API with the player version it needs. The [Getting started](../tutorials/getting-started.md) tutorial lists every manifest field, including `readme`, `changelog` and `sourceUrl`.

## Step 2: Files the package must carry

`main.ts` reads `sample.md` when the window opens, so the file must be in the package. `vestra-plugin build` copies the plugin's files into `dist/` (TypeScript transpiled to JavaScript, everything else as it is), but it leaves out the tests, `node_modules`, files whose names start with `.`, and **Markdown files**, except `README.md`, `CHANGELOG.md` and the files the manifest's `readme` and `changelog` name. `sample.md` is therefore listed in `package.json`:

{@includeCode ../../examples/markdown/package.json}

`"vestra": { "assets": [...] }` copies files or whole directories into the package unchanged, whatever their type. `assets/icon.png` needs no entry: a PNG is copied anyway, and it is also the manifest's `icon`, which the build always includes. The same file is the local image in `sample.md`.

## Step 3: The window

{@includeCode ../../examples/markdown/ui/document.slint}

- Line 1: `MarkdownView` and its block type `MarkdownBlock` come from `@vestra/markdown.slint`, which the player supplies at run time, like `@vestra/theme.slint` on line 2.
- Lines 6–9: `preferred-width` and `preferred-height` give the initial size; the minimums keep the window usable when the user shrinks it.
- Line 10: `Theme.bg-panel` makes the background follow the player's palette.
- Line 11: the document is a `[MarkdownBlock]` property. The plugin never builds these blocks itself: it writes the value that `plugin.ui.markdown` returns, and the player turns it into blocks.
- Lines 13–16: the view fills the window; it has its own scroll bar for a document taller than the window. When the user clicks a link, it calls `link-clicked(url)`; the window passes that on to the plugin as `open-link`. Opening the link is the plugin's decision.

## Step 4: The plugin

The imports:

{@includeCode ../../examples/markdown/main.ts#imports}

And everything else:

{@includeCode ../../examples/markdown/main.ts#document}

**The package directory.** `import.meta.url` is the address of the running module: `main.ts` during development, `dist/main.js` in a built package. `new URL(".", import.meta.url)` is the directory it is in, and `fileURLToPath` turns that into a path. `directory` is therefore always the package directory, wherever the user installed it.

**The link callback.** It is bound with `on()` right after `create()`, before the first `show()`, as tool windows require.

- An `http:` or `https:` address goes to {@link "@vestra-player/sdk"!System.openUrl | plugin.system.openUrl}, which opens it in the default browser.
- Anything else, such as the sample's `#tables` link, is only shown with `osd.show`.
- The handler returns the promise of either call, so a failure (for example the browser not starting within 10 seconds) reaches {@link "@vestra-player/sdk"!Scope.onError | plugin.onError}.

**The command.** `path: ["Examples", "Markdown example…"]` creates a top-level **Examples** menu (the [Core UI](core-ui.md) example adds its items to the same one). `run` does three things each time it is chosen:

1. It reads `sample.md` from the package. Reading it on every run, not once at start, means an edited file shows its changes the next time the window opens.
2. {@link "@vestra-player/sdk"!Ui.markdown | plugin.ui.markdown} prepares the document. `base` is what relative links and images resolve against: here the package directory, so `assets/icon.png` in the text means the package's icon. Without `base`, relative images show their alternative text. The call also downloads the document's `https:` images and resolves once they are downloaded or have failed; a failed image never makes the call fail.
3. {@link "@vestra-player/sdk"!View.set | window.set} writes the document, then `show()` opens the window. `set` rather than `bind`, because the document is a one-off value made in this handler, not a function of the plugin's state. Written before `show()`, it becomes one of the window's initial properties, so the window never appears empty.

The value from `ui.markdown` is a {@link "@vestra-player/sdk"!MarkdownRef | MarkdownRef}: an opaque handle that can only be the **whole** value of a `[MarkdownBlock]` property, not part of a struct or an array. It belongs to the plugin's scope.

## Step 5: The document

`sample.md` is ordinary Markdown: CommonMark with GitHub's tables, task lists and strikethrough. Here is how each part comes out:

- **Inline formatting and links** (line 3): bold, italic, strikethrough, inline code and links. The second link, `#tables`, is an in-page address; the plugin's handler only shows it.
- **Lists** (lines 5–12): bullets, a nested numbered list and task list items.
- **Code and quotes** (lines 14–23): a fenced code block and a quote with a nested quote.
- **Tables** (lines 25–31) and a horizontal rule (line 33).
- **Images** (lines 35–45):
  - `![Icon](assets/icon.png)` is a local image, resolved against `base`. Local images must be PNG or JPEG files inside the plugin's package directory or its data directory, at most 16 MB and 4096×4096 pixels.
  - `![Vestra](https://github.com/vestrasys.png?size=128)` is a remote image. `ui.markdown` downloads it into the plugin's data directory first (`.vestra-cache/markdown/`); GitHub answers with a redirect to the actual PNG. Each image may be at most 4 MB and take at most 10 seconds, and a document may have up to 64; the cache keeps 32 MB and fetches an address again after 24 hours.
  - The SVG badge cannot be drawn (only PNG and JPEG are), so the view shows its alternative text, "SVG badge". The same happens to `http:` images and failed downloads.
- **HTML** (line 47) is not shown at all.

A document may be at most 256 KB; very long ones are cut off after 4000 blocks.

## Step 6: The test

{@includeCode ../../examples/markdown/tests/markdown.test.ts}

- After the command runs, `host.window("document").props.doc` is the property as the fake player received it. {@link "@vestra-player/sdk/testing"!TestHost.markdown | host.markdown()} reads the document back from it: its `text`, its `base` and its downloaded `images`.
- `doc.base` is the package directory, the same path the test computes from its own location.
- The test host never touches the network. Remote images are served from {@link "@vestra-player/sdk/testing"!TestHost.remoteImages | host.remoteImages}, a map from address to a local file; this test adds none, so every download fails and `images` is empty, exactly like an offline player that shows alternative text.
- `emit("openLink", …)` fires the window's callback. A web address ends up in `host.system.urls`; `#tables` ends up in `host.osd`.
- `try … finally` stops the plugin even when an assertion fails, so a failing test does not leave the plugin running.

Run it with `npm test`.

## Step 7: Build and run

In the SDK repository, build the SDK once (`npm ci` at the root), then in `examples/markdown`:

```sh
npm install
npm run check   # manifest rules and a strict type check, tests included
npm test
npm run pack    # builds dist/ and packs examples.markdown-0.1.0.vxp
```

`build` writes `dist/` with `main.js`, the `.slint` file, `sample.md` (from `assets`), `assets/icon.png` (the manifest's icon) and the README. Start the player with `--plugin <path to examples/markdown>` to run `main.ts` directly, or with `--plugin <path>/dist` to try the built package. Then:

1. Choose **Examples ▸ Markdown example…**: the window shows the sample, with the icon and, after a moment's download, the avatar.
2. Click **the plugin SDK repository**: it opens in the browser.
3. Click **The "Tables" section of this page**: "Link: #tables" appears over the video.
4. Edit `sample.md` and choose the menu item again: the window shows the change.
5. Open the plugin manager: the plugin is listed as **Markdown example**, with its icon, author, summary and tags.

## What to try next

1. **Show the plugin's own README.** Read `README.md` instead of `sample.md`. It needs no `assets` entry: `vestra-plugin build` always copies the README.
2. **A document from the web.** Fetch a Markdown file with `fetch()` and pass its URL as `base`, so its relative links and images resolve against the site. The {@link "@vestra-player/sdk"!Ui.markdown | Ui.markdown} reference has this as an example.
3. **No downloads.** Pass `remoteImages: false` in the options: remote images then show their alternative text and the call makes no network requests.
4. **A title from the document.** Add `in property <string> heading;` to the window with `title: root.heading;`, and `set` it to the text of the document's first `# ` line together with `doc`.
5. **Add the other display fields.** Add `sourceUrl` (an `https:` address of the code) and a `CHANGELOG.md`, and check how the plugin manager shows them.

## See also

- [Windows, panels, settings pages, dialogs and the OSD](../concepts/ui.md): tool windows, the theme and the `@vestra/` imports.
- {@link "@vestra-player/sdk"!Ui | Ui}, {@link "@vestra-player/sdk"!MarkdownOptions | MarkdownOptions}, {@link "@vestra-player/sdk"!MarkdownRef | MarkdownRef}
- {@link "@vestra-player/sdk"!Window | Window}, {@link "@vestra-player/sdk"!View | View}
- {@link "@vestra-player/sdk"!System | System}
- [Getting started](../tutorials/getting-started.md): every manifest field and the CLI.
- {@link "@vestra-player/sdk/testing"!TestHost | TestHost}
