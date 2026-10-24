# Counter (i18n)

A plugin in the player's language: **Tools → Counter…** opens a window with one button that counts clicks. Every text is English in the source; `locales/zh-Hans.po` translates it into Simplified Chinese, and the player shows the translation when its interface language is Simplified Chinese.

![Counter running in Vestra Player](screenshot.png)

| Capabilities | API |
| --- | --- |
| `commands`, `ui.window`, `ui.osd` | `commands.add`, `windows.create`, `osd.show(template, args)`; Slint `@tr`; `vestra-plugin i18n extract` and `check`; tests with `startPlugin({ locale })` |

## Run it

```sh
cd examples/i18n
npm install
npm run check && npm test   # type check, then the tests in English and in Chinese
npm run i18n                # find the texts again (locales/messages.pot), merge them into zh-Hans.po, check
npm run pack                # build dist/ (with dist/locales/zh-Hans.json) and pack examples.i18n-0.1.0.vxp
```

In the player (0.4.3 or later): start it with `--plugin <path to examples/i18n>`, then choose **Settings → Language → 简体中文** and restart the player.

Walkthrough: [Counter (i18n)](https://vestrasys.github.io/vestra-player-sdk/documents/Counter__i18n_.html).
