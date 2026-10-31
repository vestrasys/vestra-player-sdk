---
title: "Example: Markdown"
description: "Walkthrough of examples/markdown: a window that shows a Markdown document with MarkdownView."
---

# Example: Markdown

A window that shows a formatted Markdown document with the player's `MarkdownView` component. The plugin never parses Markdown: it passes the text to the player, which parses and draws it.

## What it demonstrates

`plugin.ui.markdown` and `MarkdownView` · images relative to the package · packing a non-code file.

[Add a window](../tutorials/add-a-window.md) teaches tool windows; the Markdown view is explained in [Windows, panels, settings pages, dialogs and the OSD](../explanation/ui.md#theme-and-widgets).

## What you'll build

![Markdown in Vestra Player](../../examples/markdown/screenshot.png)

**Examples ▸ Markdown example…** opens a window that shows `sample.md`: headings, lists, a code block, a quote, a table and an image from the package.

## Files

```text
examples/markdown/
  manifest.json              identity, capabilities and display fields
  main.ts                    the code
  ui/document.slint          the window
  sample.md                  the document it shows
  assets/icon.png            the plugin's icon, also the image in sample.md
  tests/markdown.test.ts     a test against the SDK's in-memory player
  package.json               the SDK as a dev dependency, the scripts, and assets
```

## The manifest

{@includeCode ../../examples/markdown/manifest.json}

- `commands` for the menu item, `ui.window` for the window. `plugin.ui.markdown` needs no capability.
- `minPlayerVersion: "0.2.0"`: `ui.markdown` is new in that version, and older players refuse the plugin with a clear message.
- `name` to `license` are display fields for the plugin manager. They do not affect how the plugin runs, and any plugin can have them; [Manifest](../reference/manifest.md#fields) lists their rules.

## The package file

{@includeCode ../../examples/markdown/package.json}

`vestra-plugin build` leaves Markdown files out of the package (except `README.md`, `CHANGELOG.md` and the manifest's `readme` and `changelog`; see [What build puts into dist/](../reference/cli.md#what-build-puts-into-dist)), so `sample.md` is listed under `"vestra": { "assets": [...] }`, which copies files into the package as they are. `assets/icon.png` needs no entry: the build copies images anyway.

## The window

{@includeCode ../../examples/markdown/ui/document.slint}

- `MarkdownView` and its block type `MarkdownBlock` come from `@vestra/markdown.slint`, supplied by the player at run time.
- The preferred and minimum sizes give the window its first size and keep it usable when shrunk.
- `doc` is the document, a `[MarkdownBlock]` property. The plugin never builds these blocks itself; it writes the value `plugin.ui.markdown` returns.
- `MarkdownView` fills the window and scrolls a long document.

## The code

### Imports

{@includeCode ../../examples/markdown/main.ts#imports}

`readFileSync` reads the document; `fileURLToPath` turns the module's address into a path.

### The window and the command

{@includeCode ../../examples/markdown/main.ts#document}

- `directory` is the folder `main.ts` (or, in a package, `main.js`) is in: the package directory, wherever it is installed.
- {@link "@vestra-player/sdk"!Windows.create | plugin.windows.create} makes the window handle; nothing opens yet.
- `run` does three things each time the item is chosen:
  1. It reads `sample.md` from the package. Reading it on every run means an edited file shows its changes the next time.
  2. {@link "@vestra-player/sdk"!Ui.markdown | plugin.ui.markdown} prepares the document. `base` is what relative images resolve against, so `assets/icon.png` in the text means the package's icon. Without `base`, the image shows its alternative text.
  3. {@link "@vestra-player/sdk"!View.set | window.set} writes the document, then `show()` opens the window. `set` rather than `bind`, because the document is a one-off value, not something computed from state. Set before `show()`, it is there when the window appears.

## The test

{@includeCode ../../examples/markdown/tests/markdown.test.ts}

{@link "@vestra-player/sdk/testing"!TestHost.markdown | host.markdown()} reads the document back from the window's property: its `text` and its `base`.

## Run it

```sh
npm ci                    # once, in the SDK repository root
cd examples/markdown
npm install
npm run check && npm test
npm run pack              # examples.markdown-0.1.0.vxp
```

Start the player with `--plugin <path to examples/markdown>` and choose **Examples ▸ Markdown example…**. Edit `sample.md` and choose it again to see the change.

## Try next

1. **Open links.** Add `callback open-link(string);` to the window, forward `link-clicked(url) => { root.open-link(url); }` from `MarkdownView`, and handle it with `window.on("openLink", (url: string) => plugin.system.openUrl(url))` before the first `show()`.
2. **Remote images.** Put `![Avatar](https://github.com/vestrasys.png?size=128)` in the document: `ui.markdown` downloads `https:` images first (pass `remoteImages: false` to turn that off).
3. **Copy code.** Set `code-copy: true` on `MarkdownView`: code blocks get a **Copy** button (labelled in the interface language) that reports `copy-code(code)`. Forward it as a callback and copy the text with {@link "@vestra-player/sdk"!Clipboard | plugin.clipboard}, which needs the `clipboard` capability.
4. **Show the plugin's own README** instead of `sample.md`; the build always packs the README.
