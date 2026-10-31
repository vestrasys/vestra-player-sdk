---
title: Platforms
description: Every difference between macOS and Windows in one table; the API is the same on both.
---

# Platforms

A plugin uses the same API on macOS and Windows; the player does the system-specific part. This table lists everything that behaves differently. A call that a system cannot serve fails with `unsupported`, so a plugin handles that code instead of testing for the system ({@link "@vestra-player/sdk"!App.system | plugin.app.system()} tells the system when a plugin must know).

| Feature | macOS | Windows |
| --- | --- | --- |
| {@link "@vestra-player/sdk"!Clipboard | Clipboard} | Text; PNG and JPEG images as their original bytes. | Text; images are converted to a bitmap and PNG. |
| {@link "@vestra-player/sdk"!Power.preventSleep | Power.preventSleep} | `caffeinate`. | The thread execution state. |
| {@link "@vestra-player/sdk"!Dialogs.confirm | Dialogs.confirm} | An `NSAlert` sheet on the active player window (usually the tool window that asked), with the custom buttons and the checkbox. | A task dialog owned by the active player window, titled "Vestra Player", with the custom buttons; `destructive` shows a warning icon; a `checkbox` is asked as a second yes/no dialog after the user confirms. |
| {@link "@vestra-player/sdk"!MainWindow.setAlwaysOnTop | MainWindow.setAlwaysOnTop} | The floating window level. | Topmost window. |
| {@link "@vestra-player/sdk"!MainWindow.setVideoArea | MainWindow.setVideoArea} | The visible screen area, without the menu bar and the Dock. | The whole display. |
| {@link "@vestra-player/sdk"!MainWindow.setPictureInPicture | MainWindow.setPictureInPicture} | The system's picture-in-picture (macOS 14 or newer). | `unsupported`. |
| {@link "@vestra-player/sdk"!DropModifiers | DropModifiers} | The pointer and ⌥ ⇧ ⌘ (`cmd` is ⌘). | The pointer and Alt, Shift, Ctrl (`cmd` is Ctrl). |
| {@link "@vestra-player/sdk"!System | plugin.system} (open, reveal) | Opened by the system; revealing several files selects all of them in one Finder window. | Opened by the shell; one Explorer window per folder. |
| {@link "@vestra-player/sdk"!Secrets | plugin.secrets} | The login keychain. | The Credential Manager. |
| {@link "@vestra-player/sdk"!App.system | App.system()} | Version, build, model and displays; `rendering` is `"gpu"`, or `"software"` after a fallback (a window that cannot show GPU frames). | Version, build, model and displays; `rendering` is `"software"`. |
| Snapshots and exports ({@link "@vestra-player/sdk"!MediaCapture | MediaCapture}) | Available. | Available; needs FFmpeg 6.1 or newer. |
| Generated streams ({@link "@vestra-player/sdk"!Player.openStream | Player.openStream}) | A Unix socket. | Loopback TCP with a token. |
| Rendering | On the GPU (OpenGL), with hardware decoding. | In software, with hardware decoding copied back (`d3d11va-copy` and similar). |
| {@link "@vestra-player/sdk"!Rendering | plugin.rendering} (player 0.5.13) | `"gpu"` can be chosen unless the driver is ruled out (`denylist`, `previous-crash`). | `gpu.available` is `false` (`no-gpu-backend`); `setPreference("gpu")` fails with `unsupported`. |
| Render options ({@link "@vestra-player/sdk"!RenderOptions | RenderOptions}) | Available; `peakDetect` has no effect. | `unsupported` (software rendering). |
| {@link "@vestra-player/sdk"!VideoUpscaling | plugin.video.upscaling} (player 0.5.16) | `available` is `false` (`platform`); `set(true)` fails with `unsupported`. | NVIDIA RTX Video Super Resolution: an RTX GPU with driver 530 or newer, GPU rendering on that GPU, the video decoded on it (`d3d11va`); the user must also turn on Super Resolution in the NVIDIA app, which no program can read. |
| Bindings | `Ctrl` also matches ⌘; `Cmd` is ⌘. | `Cmd` is the Windows logo key; `Cmd+Q` does not quit. |
| Keys taken first, standard close keys | See [Keys the system takes first](commands.md#keys-the-system-takes-first). | See [Keys the system takes first](commands.md#keys-the-system-takes-first). |
| Interface font | The system font; CJK falls back per character to the system's fonts (PingFang, Hiragino). | The system font; CJK falls back per character to Windows' CJK fonts in the interface language's order, then the bundled Noto Sans CJK SC ([the chain](theme.md#sizes-and-fonts)). |
| `Theme.font-mono` | Menlo | Consolas |

Other systems have no released player; there, every feature in this table that needs the system fails with `unsupported` (always on top and `setVideoArea` with `unavailable`, `preventSleep` has no effect), and keys behave as on Windows.

When the player runs without a user interface (headless, as in some automated setups), opening windows, mounting panels, dialogs, the OSD and `settings.show` fail with `unavailable` on every system.
