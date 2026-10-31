---
title: Add settings and translations
description: "Tutorial 3 of 4: add a settings page that the plugin remembers, and show the plugin in Simplified Chinese."
---

# Add settings and translations

In this tutorial the plugin from [Add a window](add-a-window.md) gets a page in the player's Options window, **Plugins ▸ Hello**, with one switch: whether **Where am I?** also shows the duration. The plugin remembers the choice, and then speaks Simplified Chinese as well as English.

## Before you start

Finish [Add a window](add-a-window.md). Why settings pages are built the way they are is explained in [Windows, panels, settings pages, dialogs and the OSD](../explanation/ui.md); where else a plugin can keep data is in [Store a plugin's data](../how-to/store-data.md).

## 1. Declare the capability

A settings page needs `ui.settings`. Add it to the `capabilities` in `manifest.json`, after `"playback.control"`:

```json
"ui.settings"
```

## 2. Write the settings page

Create `ui/settings.slint`. A settings page exports a global (the bridge the plugin talks to) and a component (the layout):

```slint
// ui/settings.slint
import { CheckBox } from "std-widgets.slint";
import { Theme } from "@vestra/theme.slint";

export global HelloSettings {
    in-out property <bool> show-duration;
    callback show-duration-toggled(bool);
}

export component HelloSettingsPage inherits Rectangle {
    VerticalLayout {
        padding: Theme.dialog-padding;
        alignment: start;
        CheckBox {
            text: @tr("Show the duration");
            checked <=> HelloSettings.show-duration;
            toggled => { HelloSettings.show-duration-toggled(self.checked); }
        }
    }
}
```

## 3. Store the setting and register the page

Add to the start of `activate` in `main.ts`:

```ts
type Settings = { showDuration: boolean };
const settings = plugin.storage.json<Settings>("settings", {
  defaults: { showDuration: true },
  validate: (v): v is Settings =>
    typeof (v as Settings)?.showDuration === "boolean",
});
const page = plugin.settings.page("ui/settings.slint", {
  id: "hello",
  category: "plugins",
  title: "Hello",
});
page.bind(() => ({ showDuration: settings.value.showDuration }));
page.on("showDurationToggled", (on: boolean) =>
  settings.save({ ...settings.value, showDuration: on }),
);
```

`storage.json` keeps the value in `settings.json` in the plugin's data directory, so it survives a restart of the player.

## 4. Use the setting, with translatable text

Replace the `where` command with this one. The message is now a template with arguments, which the player can translate, instead of a sentence built in TypeScript:

```ts
declare const settings: { value: { showDuration: boolean } };
// ---cut---
plugin.commands.add({
  id: "where",
  path: ["Tools", "Where am I?"],
  bindings: ["Ctrl+Alt+W"],
  enabled: () => plugin.player.state.phase === "ready",
  run: () => {
    const position = (plugin.player.state.position ?? 0).toFixed(1);
    const duration = (plugin.player.state.duration ?? 0).toFixed(1);
    return settings.value.showDuration
      ? plugin.osd.show("{} s of {} s", [position, duration])
      : plugin.osd.show("{} s", [position]);
  },
});
```

## 5. Mark the window's texts

In `ui/hello.slint`, wrap the texts the user sees in `@tr`:

```slint
title: @tr("Hello");
Button { text: @tr("Back 10 s"); enabled: root.can-seek; clicked => { root.jump(-10); } }
```

In `main.ts`, the window's fallback message is words, not data, so pass it as a text value:

```ts
declare const window: Window;
// ---cut---
window.bind(() => ({
  message: plugin.player.state.source ?? plugin.i18n.text("Nothing is playing"),
  canSeek: plugin.player.state.can.seek,
}));
```

## 6. Extract and translate

Collect every text and start the Simplified Chinese file:

```sh
npx vestra-plugin i18n extract --locale zh-Hans
```

Open `locales/zh-Hans.po` in any editor and fill in each `msgstr`, for example:

```po
msgid "Where am I?"
msgstr "我在哪里？"

msgid "{} s of {} s"
msgstr "{} 秒 / 共 {} 秒"
```

Keep every `{}` of the English. Then check that nothing is missing:

```sh
npx vestra-plugin i18n check
```

## 7. Try it

Start the player with `--plugin ./my-plugin`. Open the Options window, choose **Plugins ▸ Hello** in its tree, turn the switch off and use **Where am I?**: only the position shows. Start the player again: the switch is still off. Set **Settings ▸ Language** to 简体中文 and start the player again: the menu item, the window and the message are in Chinese.

## Next

- [Test, check, pack and publish](test-and-publish.md): the last tutorial tests the plugin and packs it for the store.
- [Translate a plugin](../how-to/i18n.md) and [Reference: translations](../reference/i18n.md): plurals, text values, review of machine translations.
