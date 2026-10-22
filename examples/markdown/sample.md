# Markdown example

This shows the **core Markdown component**: *italic*, ~~strikethrough~~, `inline code` and [the plugin SDK repository](https://github.com/vestrasys/vestra-player-sdk). [The "Tables" section of this page](#tables) only shows an on-screen message.

## Lists

- A bulleted list
- A second item, with **bold** text
  1. A nested numbered list
  2. Its second item
- [x] A finished task
- [ ] An open task

## Code blocks

```ts
const doc = await plugin.ui.markdown(text, { base });
window.set({ doc });
```

> A quote: the player parses and draws the Markdown; the plugin only passes the text.
>
> > A nested quote

## Tables

| Element | Supported |
| --- | --- |
| Headings, paragraphs, lists | Yes |
| Code blocks, quotes, tables | Yes |
| Inline HTML | No (not shown) |

---

## Images

A local image (`assets/icon.png` in the package, resolved against the document's directory):

![Icon](assets/icon.png)

A remote image (the vestrasys organization avatar, redirected by GitHub; the SDK downloads it to the data directory first):

![Vestra](https://github.com/vestrasys.png?size=128)

Unsupported formats show their alternative text: ![SVG badge](https://img.shields.io/badge/demo-svg-blue.svg)

<div>This inline HTML is not shown.</div>
