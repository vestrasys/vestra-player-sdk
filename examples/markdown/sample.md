# Markdown example

This window shows the **core Markdown component**: *italic*, ~~strikethrough~~ and `inline code`.

## Lists

- A bulleted list
- A second item, with **bold** text
  1. A nested numbered list
  2. Its second item
- [x] A finished task
- [ ] An open task

## Code and quotes

```ts
const doc = await plugin.ui.markdown(text, { base });
window.set({ doc });
```

> The player parses and draws the Markdown; the plugin only passes the text.

## Tables

| Element | Supported |
| --- | --- |
| Headings, paragraphs, lists | Yes |
| Code blocks, quotes, tables | Yes |
| Inline HTML | No (not shown) |

## Images

A local image, `assets/icon.png` in the package, found through `base`:

![Icon](assets/icon.png)
