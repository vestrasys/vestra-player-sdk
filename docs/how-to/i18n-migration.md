---
title: Migrate a plugin to English source text
description: The checklist for moving a plugin written in one language before SDK 1.5.9 to English source text with its old texts as the first translation.
---

# Migrate a plugin to English source text

For plugins written before SDK 1.5.9 whose texts are in one language (Chinese, for the plugins built into Vestra Player). After the migration every text is English in the source, and the old texts become the first translation. The behaviour stays the same: a user with the same language sees exactly the texts as before. Read [Translate a plugin](i18n.md) first; this page is the checklist.

Needs player 0.4.3 or later: set `"minPlayerVersion": "0.4.3"` in `manifest.json`.

## 1. Menus: English paths

Before:

```ts nocheck
plugin.commands.add({ id: "snapshot", path: ["视频", "截图", "保存当前画面…"], run: save });
```

After:

```ts nocheck
plugin.commands.add({ id: "snapshot", path: ["@video", "Snapshot", "Save Current Frame…"], run: save });
```

- The player's menus: `@open`, `@playback`, `@subtitles`, `@video`, `@audio`, `@screen`, `@settings` (or their keys `Open`, `Playback`, `Subtitles`, `Video`, `Audio`, `Screen`, `Settings`). Its own submenus `Playback ▸ Speed` and `Playback ▸ Seek` keep the player's words too. The old Chinese titles of these menus (视频, 播放 ▸ 速度 …) still work, so an unmigrated plugin lands in the same menus meanwhile.
- **Shared submenus merge by the English words.** When another plugin puts items into the same submenu, both must write it identically. [Submenu keys in use](../reference/commands.md#submenu-keys-in-use) lists the English keys the player and its built-in plugins use; reuse those, and ask before inventing a new shared one.
- Title case for menu items ("Save Current Frame…"), an ellipsis `…` when the item opens a window or asks something.
- Dynamic items (tracks, devices, presets) whose titles are data (a file name, a device name) stay data: they are not translated. Items whose titles come from a fixed list are text: put the list in an `as const` table so `extract` finds them:

  ```ts nocheck
  const RATES = [
    { id: "half", title: "0.5×" },
    { id: "double", title: "2×" },
  ] as const;
  ```

- `order`, `group`, `radio`, `bindings` do not change. Saved user key bindings are kept: they are stored by plugin and command id, not by path.

## 2. Slint: `@tr`

Before:

```slint
Button { text: "恢复默认"; }
Text { text: root.count + " 个文件"; }
```

After:

```slint
Button { text: @tr("Restore Defaults"); }
Text { text: @tr("{n} file" | "{n} files" % root.count); }
```

Wrap every literal a user reads (`text`, `title`, `placeholder-text`, `tip`, default values of properties shown as text). Do not concatenate in Slint either: `"[" + a + "]"` becomes `@tr("[{}]", a)`.

## 3. Sentences built in TypeScript

The plugin may no longer build a user-visible sentence in TypeScript. Three ways out, in this order of preference:

**Into the Slint file.** When a window shows it, let the window build it from data:

```ts nocheck
// Before: TypeScript composes the tooltip.
panel.bind(() => ({ tipBack: `后退 ${step} 秒 (${key})` }));
// After: TypeScript passes data; Slint has text: @tr("Back {} s ({})", root.step, root.key)
panel.bind(() => ({ step, key }));
```

**A template with arguments**, for the OSD and dialogs:

```ts nocheck
// Before
plugin.osd.show(`播放速度：${rate}x`);
plugin.dialogs.confirm({ message: `删除 ${n} 个书签？`, confirm: "删除" });
// After
plugin.osd.show("Speed: {}x", [rate]);
plugin.dialogs.confirm({ message: "Delete {} bookmarks?", confirm: "Delete", args: [n] });
```

Arguments are data and are not translated. When an argument would itself be a word from a fixed set (a palette name, "on"/"off"), write one whole template per value instead, so each is translated as a sentence:

```ts nocheck
// Before
plugin.osd.show(`配色：${theme === "vestra" ? "Vestra 深色" : "Vestra 浅色"}`);
// After: both branches are found by extract
plugin.osd.show(theme === "vestra" ? "Palette: Vestra Dark" : "Palette: Vestra Light");
```

**A text value** (SDK 1.5.11), when the words and the data cannot be separated into a Slint file or one template: a menu item with a number, a `[string]` model, a sentence made of translated parts, a list.

```ts nocheck
const { text, list } = plugin.i18n;
// Before: the old Chinese, or English that a Chinese user then saw
plugin.commands.add({ id, path: ["@audio", "Audio Track", `Track ${n} (${codec})`], run });
tune.bind(() => ({ trackLabels: ["关闭字幕", ...names] }));
plugin.osd.show("Download failed: {}", [english(reason)]);
plugin.osd.show("Removed missing shaders: {}", [missing.join("、")]);
// After
plugin.commands.add({ id, path: ["@audio", "Audio Track", text("Track {} ({})", [n, codec])], run });
tune.bind(() => ({ trackLabels: [text("Subtitles Off"), ...names] }));
plugin.osd.show("Download failed: {}", [text(REASONS[reason])]);
plugin.osd.show("Removed missing shaders: {}", [list(missing)]);
```

The table of where text values are accepted is in [Translate a plugin](i18n.md#text-that-mixes-words-and-data). A resolver's failure: `throw plugin.i18n.error("The ROM file was not found.")`. Text for the clipboard or a file: `plugin.i18n.resolve(value)`, never for the interface.

**Status texts as data.** A text that a window shows depending on state (`"正在载入…"`, `"没有音轨"`) becomes a state value (`loading: true`) that the Slint file turns into words.

Error messages that come from the player or the SDK (`error.message`) are not the plugin's text: showing them as they are is fine, but do not put them into a template of your own.

## 4. The manifest

`name`, `punchline`, `description` and `tags` are English; their translations go in the same `.po` files (`extract` collects them). The plugin manager and the store show them translated (`PluginInfo.display`).

## 5. Write `zh-Hans.po` from the old text

```sh
vestra-plugin i18n extract --locale zh-Hans   # locales/messages.pot and an empty locales/zh-Hans.po
```

Then fill every `msgstr` with the text the plugin showed before. That text **is** the translation; copy it exactly, including punctuation and spacing, so users see no change. Placeholders stay as in the English: `msgid "Speed: {}x"` → `msgstr "播放速度：{}x"`. A plural entry in Simplified Chinese needs only `msgstr[0]`. A `git diff` of the migration shows each old text next to its new English.

## 6. Check

```sh
vestra-plugin i18n extract    # again after every source change
vestra-plugin i18n check      # until it prints nothing but the coverage line
```

`check` finds what is left: Chinese text in TypeScript or Slint, Slint text without `@tr`, sentences composed in TypeScript, values it cannot read, translations whose placeholders differ.

## 7. Tests

- Assertions on declarations now see English: `command.declaration.path` is what the code declared.
- To check what a Chinese user sees, start with `locale: "zh-Hans"` and assert on `command.display`, `host.osd`, `host.confirmTexts`; the old expected strings usually stay as they were.
- `startPlugin` without `locale` plays English for the plugin's texts but keeps the player's own messages (core actions, refusals) in Chinese, as before 1.5.9. Pass `locale` to get the player's English.

```ts nocheck
const { host, stop } = await startPlugin(activate, { directory, locale: "zh-Hans" });
assert.deepEqual(host.command("snapshot").display.path, ["视频", "截图", "保存当前画面…"]);
```

## Before you hand it in

- [ ] No user-visible Chinese (or other non-English) text left in `.ts` and `.slint` files.
- [ ] Every Slint text in `@tr`; no sentence composed in TypeScript.
- [ ] `locales/messages.pot` up to date, `locales/zh-Hans.po` complete (`check`: `zh-Hans: N/N translated`).
- [ ] Shared submenus use the agreed English keys.
- [ ] No `i18n-ignore` left on text that only waited for text values (SDK 1.5.11): menu items with data, `[string]` models, nested reasons, lists.
- [ ] `minPlayerVersion` is `0.4.3`; `vestra-plugin check`, `build` and `test` pass.
