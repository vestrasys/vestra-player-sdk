# Examples

Complete Vestra Player plugins, each with a manifest, its source, Slint files, tests and a README. CI checks, tests and packs every one of them against the SDK in this repository. The [Examples](https://vestrasys.github.io/vestra-player-sdk/documents/Examples.html) page of the documentation lists them with their walkthroughs.

| Example                              | Shows                                                                                 |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| [hello](hello)                       | The README Quick start: one menu command and an on-screen message.                    |
| [blur](blur)                         | A tool window with one slider that blurs the playing video.                           |
| [signal-generator](signal-generator) | Generates its own video and audio: colour bars and a 1 kHz tone.                      |
| [bookmark](bookmark)                 | A tool window bound to the playback state: remember the position and jump back to it. |
| [panel-menu](panel-menu)             | A sidebar panel with its own right-click menu.                                        |
| [adjust-panel](adjust-panel)         | A speed slider in the adjust column, opened by its own key.                            |
| [menus](menus)                       | Radio menu items, separator groups and a menu item whose title changes.               |
| [theme-widgets](theme-widgets)       | A tool window drawn with the player's theme and widgets.                              |
| [markdown](markdown)                 | A window that shows a Markdown document.                                              |
| [i18n](i18n)                         | A plugin in the player's language: English source text, a Chinese translation.       |
| [three-ways](three-ways)             | Four scenarios in each of the three plugin styles: `bind()`, `player.on` + `set()`, `plugin.wire`. |

Run one (the SDK is linked from this repository, so build it first):

```sh
npm ci                      # in the repository root
cd examples/hello
npm install
npm run check && npm test && npm run pack
```

Each example has one main version in `main.ts`; `signal-generator` and `panel-menu` also have `main-b.ts` and `main-c.ts`, the same plugin in styles B and C (point the manifest's `entry` at one to run it), and `three-ways` has one file per style.

Each example is laid out the same way: `manifest.json` (id `examples.<name>`), `main.ts`, `ui/*.slint`, `tests/*.test.ts`, `package.json` (depends on `"@vestra-player/sdk": "file:../.."`), `README.md`. To start your own plugin from one, copy its folder and change the dependency to `"@vestra-player/sdk": "^1.7.0"` and the manifest `id`.
