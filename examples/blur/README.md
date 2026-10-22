# Blur

A live Gaussian blur over the video that is playing. This is the SDK's flagship example: one small plugin that uses most of what a real one needs.

![The Blur window over a playing video](screenshot.png)

## What it shows

| Feature | API |
| --- | --- |
| Video ▸ Blur, a checkable menu item with the shortcut Ctrl+Shift+B (⌘⇧B on macOS) | `plugin.commands.add` with `checked` and `bindings` |
| A "Blur" tool window: on/off switch, strength slider with live preview, presets, Reset | `plugin.windows.create`, `bind`, `on`, `set` |
| The blur itself, re-applied for every video | `plugin.video.filter` with a `gblur` node |
| The filter's status in the window: waiting, applying, applied, failed (with Retry) | `VideoFilter.status`, `onStatus`, `retry` |
| A page in Options ▸ Video | `plugin.settings.page` |
| Settings remembered across restarts | `plugin.storage.json` |
| On-screen messages | `plugin.osd.show` |
| Tests without a player | `@vestra-player/sdk/testing` |

Step-by-step walkthrough: [docs/examples/blur.md](../../docs/examples/blur.md).

## Files

```text
manifest.json      id, capabilities, store listing
main.ts            activate(): storage, filter, commands, window, settings page
model.ts           settings type, presets, the filter chain, the status line
ui/window.slint    the Blur tool window
ui/settings.slint  the Options ▸ Video ▸ Blur page
tests/             node:test tests against the SDK's TestHost
```

## Build and run

From this directory (the SDK must be built once: `npm ci` at the repository root):

```sh
npm install
npm test               # vestra-plugin test
npx vestra-plugin build
```

Then start the player with the built plugin:

```sh
# macOS
"/Applications/Vestra Player.app/Contents/MacOS/vestra-host" --plugin "$PWD/dist"
# Windows (per-user install; "C:\Program Files\Vestra Player" for all users)
"%LOCALAPPDATA%\Programs\Vestra Player\vestra-host.exe" --plugin "%CD%\dist"
```

During development you can skip the build and pass this directory itself (`--plugin "$PWD"`): the player runs `main.ts` directly. Open a video, then choose Video ▸ Blur or press Ctrl+Shift+B.

`npm run pack` writes `examples.blur-1.0.0.vxp`, the file users install.
