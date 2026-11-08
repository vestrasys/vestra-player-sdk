---
title: Commands, menus and bindings
description: Built-in menu ids, submenu keys in use, every built-in command with its default keys, the binding syntax and input names, the core actions and the keys the system takes first.
---

# Commands, menus and bindings

The names to look up while declaring a command with {@link "@vestra-player/sdk"!Commands.add | plugin.commands.add}. Where a command should go is in [Design rules](../guides/design-rules.md).

## Menu paths

A command's `path` is a list of 1 to 8 segments in English source text, the last one the item itself: `["@video", "Snapshot", "Copy Snapshot"]`. This documentation writes a path with `▸`: **Video ▸ Snapshot ▸ Copy Snapshot**. The `▸` is notation only; a segment never contains it.

- Paths merge by these English texts (their **keys**), whatever the interface language, so commands whose paths start with the same keys share a submenu.
- The first segment may name a built-in menu by id (`@video`) or by key (`Video`). Only the first segment is read as an id; an unknown id (`@view`) or an id with nothing after it fails with `invalid`.
- A segment that contains data is a {@link "@vestra-player/sdk"!Text | Text}; it merges by its English rendering.

## Built-in menus

<!-- generated:menu-ids -->

| First segment | Or its key |
| --- | --- |
| `@open` | `Open` |
| `@playback` | `Playback` |
| `@subtitles` | `Subtitles` |
| `@video` | `Video` |
| `@audio` | `Audio` |
| `@screen` | `Screen` |
| `@settings` | `Settings` |
| `@reset` | `Reset` |

<!-- /generated -->

Each built-in menu shows only while a plugin has a command in it, at its fixed order (Playback 200, Subtitles 300, Video 400, Audio 500 and Screen 710 among the domain items, Settings 830 and Reset 840 in the settings group); the fixed orders are on {@link "@vestra-player/sdk"!CommandOptions.order | CommandOptions.order}. The player's own controls are in the Picture, Audio, Subtitles and Playback panels and in the command palette.

## The top level

The top level as the player ships it (shortcuts in the Windows notation; the menu shows each system's own):

```text
Open File…                    Ctrl+O, F3    group open
Open ▸
Close                         F4
────────────────────────────────────────
Play/Pause                    Space         group domain
Audio Track ▸
Subtitle Track ▸
Snapshot ▸
────────────────────────────────────────
Adjustments and Effects  ✓                  group windows
Sidebar  ✓
Chapter and Bookmark List…    H
────────────────────────────────────────
Toggle Fullscreen             Escape        group screen
────────────────────────────────────────
Vestra Player AI…                           group windows
Plugin Store…
────────────────────────────────────────
Command Palette…              Ctrl+Shift+P  group settings-main
Options…                      F5
About Vestra Player…          F1
────────────────────────────────────────
Quit                          Cmd+Q         group exit
```

The groups of the top level and their `order` ranges ([Design rules](../guides/design-rules.md) says which to use):

| Group                  | `order`          | For                                                                                                                                                                 |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `open`                 | 100–199          | Opening and closing sources                                                                                                                                         |
| `domain` (the default) | 200–699          | Play/Pause (201), the Audio Track, Subtitle Track and Snapshot submenus, the built-in domain menus while a plugin fills them, and a new domain of your own          |
| `windows`              | 790–809, 820–828 | Items that show a window or a panel (a check mark when it toggles one): Adjustments and Effects (791), Sidebar (800) and the chapter list, then Vestra Player AI… (820) and Plugin Store… (822) |
| `screen`               | 810–819          | Toggle Fullscreen (810), alone between two separators; a plugin's window size and placement items go into Screen ▸ (`@screen`, 710)                                 |
| `settings-main`        | 829–899          | Command Palette… (829), Options… (830), About Vestra Player… (880), and Settings ▸ and Reset ▸ while a plugin fills them                                            |
| `exit`                 | 900–999          | Quit                                                                                                                                                                |

## The Reset menu

**Reset ▸** (`@reset`) sits at order 840, directly below Settings and in its separator group, and is shown only once a command is in it. Inside it, items use the order range and a group of their domain: Playback 200–299 `reset-playback`, Subtitles 300–399 `reset-subtitles`, Video 400–499 `reset-video`, Audio 500–599 `reset-audio`, Screen 700–799 `reset-screen`, anything else 800–899 in a group of its own.

## Submenu keys in use

The submenus that exist already, by key path. Write the same keys to add a command to one of them; a near-synonym makes a second submenu.

<!-- generated:menu-keys -->

| Key path | Declared by |
| --- | --- |
| Playback ▸ Speed | the player |
| Playback ▸ Seek | the player |
| Open ▸ Recently Played | `vestra.history` |
| Audio Track | `vestra.audio` |
| Subtitle Track | `vestra.subtitles` |
| Snapshot | `vestra.capture` |

<!-- /generated -->

## Built-in commands

Every command the player (`host`) and its built-in plugins register when the player starts with nothing open, in menu order; commands outside the main menu come last. The **Command** column is `<owner>/<id>`, the key under which the user's own bindings are stored. The same list is {@link "@vestra-player/sdk/testing"!BUILTIN_COMMANDS | BUILTIN_COMMANDS}.

<!-- generated:builtin-commands -->

| Menu item | Default bindings | Command |
| --- | --- | --- |
| Open File… | `Ctrl+O`, `F3` | `vestra.playback/open` |
| Open ▸ Open URL… | `Ctrl+U` | `vestra.playback/open-url` |
| Open ▸ Open Folder… | `F2` | `vestra.playlist/playlist.open-folder` |
| Open ▸ Open Subtitle… | `Alt+O` | `vestra.subtitles/load` |
| Open ▸ Add Secondary Subtitle… |  | `vestra.subtitles/load-secondary` |
| Open ▸ Load External Audio… |  | `vestra.audio/audio.load` |
| Open ▸ Search and Download Subtitles… |  | `vestra.subtitle-online/search` |
| Open ▸ Recently Played ▸ (No Entries) |  | `vestra.history/recent.empty` |
| Open ▸ Recently Played ▸ Remove Invalid Entries |  | `vestra.history/recent.prune` |
| Open ▸ Recently Played ▸ Clear Entries |  | `vestra.history/recent.clear` |
| Open ▸ Recently Played ▸ Record Playback History |  | `vestra.history/recent.enabled` |
| Close | `F4` | `host/stop` |
| Play/Pause | `Space`, `Mouse:LeftClick` | `host/play-pause` |
| Audio Track ▸ No Audio Tracks |  | `vestra.audio/audio.track.none` |
| Subtitle Track ▸ Off |  | `vestra.subtitles/track-off` |
| Snapshot ▸ Save Current Frame | `Ctrl+E` | `vestra.capture/capture.save` |
| Snapshot ▸ Copy Current Frame | `Ctrl+C` | `vestra.capture/capture.copy` |
| Snapshot ▸ Burst… | `Ctrl+G` | `vestra.capture/capture.burst` |
| Snapshot ▸ Export Clip… |  | `vestra.capture/capture.clip` |
| Snapshot ▸ Capture… | `Alt+S` | `vestra.capture/capture.panel` |
| Adjustments and Effects |  | `host/adjust` |
| Sidebar |  | `host/sidebar` |
| Chapter and Bookmark List… | `H` | `vestra.marks/marks.list` |
| Toggle Fullscreen | `Escape` | `host/fullscreen` |
| Vestra Player AI… |  | `vestra.workshop/workshop.open` |
| Plugin Store… |  | `vestra.store/open` |
| Command Palette… | `Ctrl+Shift+P` | `host/palette` |
| Options… | `F5` | `vestra.preferences/options` |
| About Vestra Player… | `F1` | `vestra.info/info.about` |
| Quit | `Cmd+Q` | `host/quit` |
| Previous (not in the menu) | `PageUp`, `Mouse:X2` | `host/previous` |
| Next (not in the menu) | `PageDown`, `Mouse:X1` | `host/next` |
| Enter Fullscreen (not in the menu) |  | `host/enter-fullscreen` |
| Leave Fullscreen (not in the menu) |  | `host/exit-fullscreen` |
| Volume + (not in the menu) | `ArrowUp`, `Mouse:WheelUp` | `host/volume-up` |
| Volume − (not in the menu) | `ArrowDown`, `Mouse:WheelDown` | `host/volume-down` |
| Mute (not in the menu) | `M` | `host/mute` |
| Previous Frame (not in the menu) | `D` | `host/frame-back` |
| Next Frame (not in the menu) | `F` | `host/frame-forward` |
| Back 5 s (not in the menu) | `ArrowLeft` | `host/seek-backward` |
| Forward 5 s (not in the menu) | `ArrowRight` | `host/seek-forward` |
| Normal (not in the menu) | `Z` | `host/rate-normal` |
| Slower 0.1 (not in the menu) | `X` | `host/rate-down` |
| Faster 0.1 (not in the menu) | `C` | `host/rate-up` |
| Picture… (not in the menu) | `Alt+1` | `vestra.video/video.picture` |
| Audio… (not in the menu) | `Alt+2` | `vestra.audio/audio.workbench` |
| Subtitles… (not in the menu) | `Alt+3` | `vestra.subtitles/tune` |
| Playback… (not in the menu) | `Alt+4` | `vestra.playback/panel` |
| Playlist (not in the menu) | `F6` | `vestra.playlist/playlist.visibility` |
| Reopen Current/Last File (not in the menu) | `Ctrl+Y` | `vestra.playback/reopen` |
| File Name (not in the menu) |  | `vestra.playback/copy-name` |
| Folder Path (not in the menu) |  | `vestra.playback/copy-folder` |
| Full Path (not in the menu) |  | `vestra.playback/copy-path` |
| Disable Screen Saver While Playing (not in the menu) |  | `vestra.playback/prevent-sleep` |
| Show Time on Seek Bar Hover (not in the menu) |  | `vestra.playback/hover-time` |
| Show Thumbnail on Seek Bar Hover (not in the menu) |  | `vestra.playback/hover-thumbnail` |
| Set Start Point (not in the menu) | `[` | `vestra.playback/ab.set-a` |
| Clear Start Point (not in the menu) | `{` | `vestra.playback/ab.clear-a` |
| Start Point Back 0.1 s (not in the menu) | `Ctrl+[` | `vestra.playback/ab.a-back` |
| Start Point Forward 0.1 s (not in the menu) | `Alt+[` | `vestra.playback/ab.a-forward` |
| Set End Point (not in the menu) | `]` | `vestra.playback/ab.set-b` |
| Clear End Point (not in the menu) | `}` | `vestra.playback/ab.clear-b` |
| End Point Back 0.1 s (not in the menu) | `Ctrl+]` | `vestra.playback/ab.b-back` |
| End Point Forward 0.1 s (not in the menu) | `Alt+]` | `vestra.playback/ab.b-forward` |
| Move Range Back 0.1 s (not in the menu) | `Ctrl+Alt+[` | `vestra.playback/ab.back` |
| Move Range Forward 0.1 s (not in the menu) | `Ctrl+Alt+]` | `vestra.playback/ab.forward` |
| Loop Current Chapter or Bookmark Range (not in the menu) | `Alt+\` | `vestra.playback/ab.segment` |
| A-B Loop On/Off (not in the menu) | `\` | `vestra.playback/ab.toggle` |
| Endless (not in the menu) |  | `vestra.playback/ab.count.endless` |
| Once (not in the menu) |  | `vestra.playback/ab.count.1` |
| 2 Times (not in the menu) |  | `vestra.playback/ab.count.2` |
| 3 Times (not in the menu) |  | `vestra.playback/ab.count.3` |
| 5 Times (not in the menu) |  | `vestra.playback/ab.count.5` |
| 10 Times (not in the menu) |  | `vestra.playback/ab.count.10` |
| Hide Pointer While Playing (not in the menu) |  | `vestra.window/hide-cursor` |
| Picture-in-Picture (not in the menu) |  | `vestra.window/pip` |
| Mini Size (not in the menu) | ``` | `vestra.window/mini` |
| 0.5× (not in the menu) | `1` | `vestra.window/size.0.5` |
| 1× (not in the menu) | `2` | `vestra.window/size.1` |
| 1.5× (not in the menu) | `3` | `vestra.window/size.1.5` |
| 2× (not in the menu) | `4` | `vestra.window/size.2` |
| Fit to Video Aspect Ratio (not in the menu) | `8` | `vestra.window/fit` |
| Don't Resize (not in the menu) |  | `vestra.window/auto.off` |
| 0.5× (not in the menu) |  | `vestra.window/auto.0.5` |
| 1× (not in the menu) |  | `vestra.window/auto.1` |
| 1.5× (not in the menu) |  | `vestra.window/auto.1.5` |
| 2× (not in the menu) |  | `vestra.window/auto.2` |
| Fit to Video Aspect Ratio (not in the menu) |  | `vestra.window/auto.fit` |
| Only Once (not in the menu) |  | `vestra.window/auto.once` |
| Cycle Mode (not in the menu) | `Ctrl+T` | `vestra.window/top.cycle` |
| Never (not in the menu) |  | `vestra.window/top.never` |
| Always (not in the menu) |  | `vestra.window/top.always` |
| While Playing (not in the menu) |  | `vestra.window/top.playing` |
| While Playing in Fullscreen (not in the menu) |  | `vestra.window/top.fullscreen` |
| Add Files… (not in the menu) |  | `vestra.playlist/playlist.add` |
| Add Link… (not in the menu) |  | `vestra.playlist/playlist.link` |
| Add Folder… (not in the menu) |  | `vestra.playlist/playlist.add-folder` |
| Off (not in the menu) |  | `vestra.playlist/playlist.repeat-none` |
| All (not in the menu) |  | `vestra.playlist/playlist.repeat-all` |
| One (not in the menu) |  | `vestra.playlist/playlist.repeat-one` |
| Shuffle (not in the menu) |  | `vestra.playlist/playlist.shuffle` |
| Open List File… (not in the menu) |  | `vestra.playlist/playlist.open-list` |
| Save List… (not in the menu) |  | `vestra.playlist/playlist.save-list` |
| Open Only That File (not in the menu) |  | `vestra.playlist/playlist.open-mode-only` |
| Add Similar Files (not in the menu) |  | `vestra.playlist/playlist.open-mode-similar` |
| Add All Files in the Folder (not in the menu) |  | `vestra.playlist/playlist.open-mode-folder` |
| Fast Advance to Next (not in the menu) |  | `vestra.playlist/playlist.fast-advance` |
| Remember List (not in the menu) |  | `vestra.playlist/playlist.remember` |
| Confirm Before Removing All (not in the menu) |  | `vestra.playlist/playlist.confirm-clear` |
| Don't Resume (not in the menu) |  | `vestra.history/resume.off` |
| Resume Automatically (not in the menu) |  | `vestra.history/resume.auto` |
| Ask Every Time (not in the menu) |  | `vestra.history/resume.ask` |
| Also Remember Audio Files (not in the menu) |  | `vestra.history/resume.audio` |
| Clear All Saved Positions (not in the menu) |  | `vestra.history/resume.clear` |
| Add Bookmark (not in the menu) | `P` | `vestra.marks/marks.add` |
| Previous Bookmark or Chapter (not in the menu) | `Shift+PageUp` | `vestra.marks/marks.previous` |
| Next Bookmark or Chapter (not in the menu) | `Shift+PageDown` | `vestra.marks/marks.next` |
| Previous Chapter (not in the menu) | `Ctrl+PageUp` | `vestra.marks/marks.previous-chapter` |
| Next Chapter (not in the menu) | `Ctrl+PageDown` | `vestra.marks/marks.next-chapter` |
| Show Marks on Seek Bar (not in the menu) |  | `vestra.marks/marks.seekbar` |
| Online Subtitle Settings… (not in the menu) |  | `vestra.subtitle-online/settings` |
| Show Album Cover for Audio Only (not in the menu) |  | `vestra.visualizer/audio-cover` |
| Show Logo When Idle (not in the menu) |  | `vestra.visualizer/idle-logo` |
| Choose Logo Image… (not in the menu) |  | `vestra.visualizer/choose-logo` |
| Idle Logo (not in the menu) |  | `vestra.visualizer/reset-logo` |
| Keyboard Shortcuts… (not in the menu) |  | `vestra.hotkeys/keys` |
| Mouse… (not in the menu) |  | `vestra.hotkeys/mouse` |
| Ignore Default Shortcuts (not in the menu) |  | `vestra.hotkeys/ignore-defaults` |
| Vestra Dark (not in the menu) |  | `vestra.preferences/theme.vestra` |
| Vestra Light (not in the menu) |  | `vestra.preferences/theme.vestra-light` |
| Follow System (not in the menu) |  | `vestra.preferences/language.system` |
| English (not in the menu) |  | `vestra.preferences/language.en` |
| 简体中文 (not in the menu) |  | `vestra.preferences/language.zh-Hans` |
| 日本語 (not in the menu) |  | `vestra.preferences/language.ja` |
| 한국어 (not in the menu) |  | `vestra.preferences/language.ko` |
| Deutsch (not in the menu) |  | `vestra.preferences/language.de` |
| Français (not in the menu) |  | `vestra.preferences/language.fr` |
| Español (not in the menu) |  | `vestra.preferences/language.es` |
| Playback Info (not in the menu) | `Tab` | `vestra.info/info.toggle` |
| Playback Properties… (not in the menu) | `Ctrl+F1` | `vestra.info/info.properties` |
| Check for Updates… (not in the menu) |  | `vestra.info/info.update` |
| Cycle Tracks (not in the menu) | `Alt+A` | `vestra.audio/audio.track.cycle` |
| Stereo (not in the menu) |  | `vestra.audio/audio.channels.stereo` |
| Left Channel (not in the menu) |  | `vestra.audio/audio.channels.left` |
| Right Channel (not in the menu) |  | `vestra.audio/audio.channels.right` |
| Mono Mix (not in the menu) |  | `vestra.audio/audio.channels.mono` |
| Swap Left and Right (not in the menu) |  | `vestra.audio/audio.channels.swap` |
| Equalizer (not in the menu) | `Shift+E` | `vestra.audio/audio.equalizer` |
| Flat (not in the menu) |  | `vestra.audio/audio.preset.0` |
| Voice (not in the menu) |  | `vestra.audio/audio.preset.1` |
| Music (not in the menu) |  | `vestra.audio/audio.preset.2` |
| Cinema (not in the menu) |  | `vestra.audio/audio.preset.3` |
| 50 ms Earlier (not in the menu) | `>` | `vestra.audio/audio.sync.earlier` |
| 50 ms Later (not in the menu) | `<` | `vestra.audio/audio.sync.later` |
| Reset (not in the menu) | `?` | `vestra.audio/audio.sync.reset` |
| Don't Keep (not in the menu) |  | `vestra.audio/audio.sync.keep.none` |
| Keep for This Run (not in the menu) |  | `vestra.audio/audio.sync.keep.session` |
| Always Keep (not in the menu) |  | `vestra.audio/audio.sync.keep.always` |
| Normalize (not in the menu) | `Shift+N` | `vestra.audio/audio.normalize` |
| Crystalizer (not in the menu) | `Shift+C` | `vestra.audio/audio.clarity` |
| Reset (not in the menu) |  | `vestra.audio/audio.reset` |
| Export Clip Range (not in the menu) | `Ctrl+Shift+E` | `vestra.capture/capture.clipExport` |
| Save Current Frame As… (not in the menu) |  | `vestra.capture/capture.saveAs` |
| Save Rendered Frame (not in the menu) | `Ctrl+Alt+E` | `vestra.capture/capture.saveScreen` |
| Save Rendered Frame As… (not in the menu) |  | `vestra.capture/capture.saveScreenAs` |
| Copy Rendered Frame (not in the menu) | `Ctrl+Alt+C` | `vestra.capture/capture.copyScreen` |
| Save Video Frame Only (not in the menu) |  | `vestra.capture/capture.saveVideo` |
| Copy Video Frame Only (not in the menu) |  | `vestra.capture/capture.copyVideo` |
| Export Tasks… (not in the menu) |  | `vestra.capture/capture.tasks` |
| Capture as PNG (not in the menu) |  | `vestra.capture/capture.format.png` |
| Capture as JPEG (not in the menu) |  | `vestra.capture/capture.format.jpeg` |
| Capture as BMP (not in the menu) |  | `vestra.capture/capture.format.bmp` |
| Include Subtitles in Rendered Frame (not in the menu) |  | `vestra.capture/capture.screenSubtitles` |
| Snapshot Settings… (not in the menu) |  | `vestra.capture/capture.settings` |
| Snapshot Folder… (not in the menu) |  | `vestra.capture/capture.folder` |
| Open Snapshot Folder (not in the menu) |  | `vestra.capture/capture.openFolder` |
| Show Last Capture in Folder (not in the menu) |  | `vestra.capture/capture.revealLast` |
| Copy Last Snapshot (not in the menu) |  | `vestra.capture/capture.copyLast` |
| Set Clip Start (not in the menu) |  | `vestra.capture/capture.clipStart` |
| Set Clip End (not in the menu) |  | `vestra.capture/capture.clipEnd` |
| Export Last 30 Seconds (not in the menu) | `Ctrl+Shift+R` | `vestra.capture/capture.last30` |
| Brief Info (not in the menu) | `Shift+Tab` | `vestra.info/info.brief` |
| Previous Keyframe (not in the menu) | `Ctrl+Shift+ArrowLeft` | `vestra.playback/keyframe-back` |
| Next Keyframe (not in the menu) | `Ctrl+Shift+ArrowRight` | `vestra.playback/keyframe-forward` |
| Jump to Time… (not in the menu) | `G` | `vestra.playback/jump` |
| Jump to Start (not in the menu) | `Backspace` | `vestra.playback/jump-start` |
| Seek Steps… (not in the menu) |  | `vestra.playback/time-jump` |
| 0.5× (not in the menu) |  | `vestra.playback/rate-05` |
| 1.5× (not in the menu) |  | `vestra.playback/rate-15` |
| 2× (not in the menu) |  | `vestra.playback/rate-20` |
| Custom… (not in the menu) |  | `vestra.playback/rate-custom` |
| Back 30 s (not in the menu) | `Ctrl+ArrowLeft` | `vestra.playback/backward-2` |
| Forward 30 s (not in the menu) | `Ctrl+ArrowRight` | `vestra.playback/forward-2` |
| Back 60 s (not in the menu) | `Shift+ArrowLeft` | `vestra.playback/backward-3` |
| Forward 60 s (not in the menu) | `Shift+ArrowRight` | `vestra.playback/forward-3` |
| Back 300 s (not in the menu) | `Ctrl+Alt+ArrowLeft` | `vestra.playback/backward-4` |
| Forward 300 s (not in the menu) | `Ctrl+Alt+ArrowRight` | `vestra.playback/forward-4` |
| Play (not in the menu) | `Enter` (panel focus) | `vestra.playlist/playlist.play` |
| Add Files… (not in the menu) |  | `vestra.playlist/playlist.list-add` |
| Add Folder… (not in the menu) |  | `vestra.playlist/playlist.list-add-folder` |
| Add Link… (not in the menu) |  | `vestra.playlist/playlist.list-link` |
| Remove Selected (not in the menu) | `Delete` (panel focus) | `vestra.playlist/playlist.remove` |
| Remove Unselected (not in the menu) | `Ctrl+Delete` (panel focus) | `vestra.playlist/playlist.remove-unselected` |
| Remove Invalid Items (not in the menu) |  | `vestra.playlist/playlist.remove-invalid` |
| Remove All (not in the menu) | `Alt+Delete` (panel focus) | `vestra.playlist/playlist.clear` |
| Show in Finder (not in the menu) | `Ctrl+F` (panel focus) | `vestra.playlist/playlist.reveal` |
| Move to Top (not in the menu) |  | `vestra.playlist/playlist.move-top` |
| Move Up (not in the menu) | `Ctrl+ArrowUp` (panel focus) | `vestra.playlist/playlist.move-up` |
| Move Down (not in the menu) | `Ctrl+ArrowDown` (panel focus) | `vestra.playlist/playlist.move-down` |
| Move to Bottom (not in the menu) | `Ctrl+End` (panel focus) | `vestra.playlist/playlist.move-bottom` |
| Ascending (not in the menu) | `Ctrl+1` (panel focus) | `vestra.playlist/playlist.sort-ascending` |
| Descending (not in the menu) | `Ctrl+2` (panel focus) | `vestra.playlist/playlist.sort-descending` |
| By Title (not in the menu) | `Ctrl+3` (panel focus) | `vestra.playlist/playlist.sort-title` |
| By File Name (not in the menu) | `Ctrl+4` (panel focus) | `vestra.playlist/playlist.sort-filename` |
| By Extension (not in the menu) | `Ctrl+5` (panel focus) | `vestra.playlist/playlist.sort-extension` |
| By Size (not in the menu) | `Ctrl+6` (panel focus) | `vestra.playlist/playlist.sort-size` |
| By Duration (not in the menu) | `Ctrl+7` (panel focus) | `vestra.playlist/playlist.sort-duration` |
| By Date (not in the menu) | `Ctrl+8` (panel focus) | `vestra.playlist/playlist.sort-date` |
| Random Order (not in the menu) | `Ctrl+9` (panel focus) | `vestra.playlist/playlist.sort-shuffle` |
| By Folder (not in the menu) | `Ctrl+0` (panel focus) | `vestra.playlist/playlist.sort-folder` |
| Sort by Path (not in the menu) |  | `vestra.playlist/playlist.sort-path` |
| Reverse Current Order (not in the menu) |  | `vestra.playlist/playlist.sort-reverse` |
| Select All (not in the menu) | `Ctrl+A` (panel focus) | `vestra.playlist/playlist.select-all` |
| Search (not in the menu) | `Ctrl+S` (panel focus) | `vestra.playlist/playlist.search` |
| Open List File… (not in the menu) |  | `vestra.playlist/playlist.list-open-list` |
| Save List… (not in the menu) |  | `vestra.playlist/playlist.list-save-list` |
| Close List (not in the menu) |  | `vestra.playlist/playlist.close` |
| Playlist Settings… (not in the menu) |  | `vestra.playlist/playlist.settings` |
| Show Subtitles (not in the menu) | `Alt+H` | `vestra.subtitles/show` |
| Off (not in the menu) |  | `vestra.subtitles/second-off` |
| Top (not in the menu) |  | `vestra.subtitles/second-position-top` |
| Above Main Subtitle (not in the menu) |  | `vestra.subtitles/second-position-aboveMain` |
| Cycle (not in the menu) | `Alt+L` | `vestra.subtitles/track-cycle` |
| Size + (not in the menu) | `Alt+PageUp` | `vestra.subtitles/size-up` |
| Size − (not in the menu) | `Alt+PageDown` | `vestra.subtitles/size-down` |
| Move Up (not in the menu) |  | `vestra.subtitles/move-up` |
| Move Down (not in the menu) |  | `vestra.subtitles/move-down` |
| Subtitle Position (not in the menu) | `Alt+Home` | `vestra.subtitles/move-reset` |
| Bold (not in the menu) | `Alt+B` | `vestra.subtitles/bold` |
| Shadow (not in the menu) |  | `vestra.subtitles/shadow` |
| Opaque Box (not in the menu) |  | `vestra.subtitles/box` |
| Original ASS/SSA Styles (not in the menu) |  | `vestra.subtitles/ass-original` |
| Previous Dialogue (not in the menu) | `Home` | `vestra.subtitles/dialogue-previous` |
| Next Dialogue (not in the menu) | `End` | `vestra.subtitles/dialogue-next` |
| Current Subtitle Start (not in the menu) | `Ctrl+Home` | `vestra.subtitles/dialogue-current` |
| Subtitle Sync (not in the menu) | `/` | `vestra.subtitles/sync-reset` |
| Adjust Sync… (not in the menu) |  | `vestra.subtitles/sync-input` |
| Reload Subtitles (not in the menu) | `Ctrl+Alt+Y` | `vestra.subtitles/reload` |
| Refresh Subtitle Tracks (not in the menu) |  | `vestra.subtitles/refresh` |
| Remove External Subtitle (not in the menu) |  | `vestra.subtitles/remove` |
| Subtitle Settings… (not in the menu) |  | `vestra.subtitles/settings` |
| Earlier 0.5 s (not in the menu) | `.` | `vestra.subtitles/sync-earlier` |
| Later 0.5 s (not in the menu) | `,` | `vestra.subtitles/sync-later` |
| Use Shaders (not in the menu) | `Shift+P` | `vestra.video/video.shader.use` |
| Shader List… (not in the menu) |  | `vestra.video/video.shader.list` |
| Open Shader Folder (not in the menu) |  | `vestra.video/video.shader.folder` |
| Reload Shaders (not in the menu) |  | `vestra.video/video.shader.reload` |
| Auto (not in the menu) |  | `vestra.video/video.hdr.auto` |
| Off (not in the menu) |  | `vestra.video/video.hdr.off` |
| BT.2390 (not in the menu) |  | `vestra.video/video.hdr.bt.2390` |
| Hable (not in the menu) |  | `vestra.video/video.hdr.hable` |
| Mobius (not in the menu) |  | `vestra.video/video.hdr.mobius` |
| Reinhard (not in the menu) |  | `vestra.video/video.hdr.reinhard` |
| Clip (not in the menu) |  | `vestra.video/video.hdr.clip` |
| Dynamic Peak Detection (not in the menu) |  | `vestra.video/video.hdr.peak` |
| HDR Settings… (not in the menu) |  | `vestra.video/video.hdr.settings` |
| Cycle (not in the menu) | `Ctrl+I` | `vestra.video/video.deinterlace.cycle` |
| Auto (not in the menu) |  | `vestra.video/video.deinterlace.auto` |
| Always (not in the menu) |  | `vestra.video/video.deinterlace.on` |
| Never (not in the menu) |  | `vestra.video/video.deinterlace.off` |
| By Frame (not in the menu) |  | `vestra.video/video.deinterlace.output.frame` |
| By Field (Double Rate) (not in the menu) |  | `vestra.video/video.deinterlace.output.field` |
| Keep Aspect Ratio (not in the menu) |  | `vestra.video/video.fit.keep` |
| Ignore Aspect Ratio (not in the menu) |  | `vestra.video/video.fit.stretch` |
| Fill Window (Crop Excess) (not in the menu) |  | `vestra.video/video.fit.fill` |
| Cycle Aspect Ratio (not in the menu) | `Shift+F6` | `vestra.video/video.aspect.cycle` |
| Default (Source) (not in the menu) |  | `vestra.video/video.aspect.default` |
| 4:3 (not in the menu) |  | `vestra.video/video.aspect.0` |
| 16:9 (not in the menu) |  | `vestra.video/video.aspect.1` |
| 16:10 (not in the menu) |  | `vestra.video/video.aspect.2` |
| 1.85:1 (not in the menu) |  | `vestra.video/video.aspect.3` |
| 2.35:1 (not in the menu) |  | `vestra.video/video.aspect.4` |
| Custom (x:y) (not in the menu) |  | `vestra.video/video.aspect.custom` |
| Custom Aspect Ratio… (not in the menu) |  | `vestra.video/video.aspect.edit` |
| None (not in the menu) |  | `vestra.video/video.reframe.none` |
| Stretch to 4:3 (not in the menu) |  | `vestra.video/video.reframe.pad.0` |
| Stretch to 16:9 (not in the menu) |  | `vestra.video/video.reframe.pad.1` |
| Stretch to 16:10 (not in the menu) |  | `vestra.video/video.reframe.pad.2` |
| Stretch to 1.85:1 (not in the menu) |  | `vestra.video/video.reframe.pad.3` |
| Stretch to 2.35:1 (not in the menu) |  | `vestra.video/video.reframe.pad.4` |
| Crop to 4:3 (not in the menu) |  | `vestra.video/video.reframe.crop.0` |
| Crop to 16:9 (not in the menu) |  | `vestra.video/video.reframe.crop.1` |
| Crop to 16:10 (not in the menu) |  | `vestra.video/video.reframe.crop.2` |
| Crop to 1.85:1 (not in the menu) |  | `vestra.video/video.reframe.crop.3` |
| Crop to 2.35:1 (not in the menu) |  | `vestra.video/video.reframe.crop.4` |
| Move Left (not in the menu) |  | `vestra.video/video.reframe.left` |
| Move Right (not in the menu) |  | `vestra.video/video.reframe.right` |
| Move Up (not in the menu) |  | `vestra.video/video.reframe.up` |
| Move Down (not in the menu) |  | `vestra.video/video.reframe.down` |
| Crop Position (not in the menu) |  | `vestra.video/video.reframe.reset` |
| Zoom In (not in the menu) | `Alt+Plus`, `Numpad9` | `vestra.video/video.frame.zoom-in` |
| Zoom Out (not in the menu) | `Alt+-`, `Numpad1` | `vestra.video/video.frame.zoom-out` |
| Pan → (not in the menu) | `Alt+ArrowRight`, `Ctrl+Numpad6` | `vestra.video/video.frame.right` |
| Pan ← (not in the menu) | `Alt+ArrowLeft`, `Ctrl+Numpad4` | `vestra.video/video.frame.left` |
| Pan ↑ (not in the menu) | `Alt+ArrowUp`, `Ctrl+Numpad8` | `vestra.video/video.frame.up` |
| Pan ↓ (not in the menu) | `Alt+ArrowDown`, `Ctrl+Numpad2` | `vestra.video/video.frame.down` |
| Center Frame (not in the menu) | `Ctrl+Numpad5` | `vestra.video/video.frame.centre` |
| Framing (not in the menu) | `Alt+Backspace`, `Numpad5` | `vestra.video/video.frame.reset` |
| Flip Vertically (not in the menu) | `Ctrl+P` | `vestra.video/video.flip.vertical` |
| Flip Horizontally (not in the menu) | `Ctrl+Z` | `vestra.video/video.flip.horizontal` |
| Gaussian Blur (not in the menu) | `Ctrl+B` | `vestra.video/video.gaussian` |
| Sharpen (not in the menu) | `Ctrl+R` | `vestra.video/video.sharpen` |
| Edge Sharpen (not in the menu) |  | `vestra.video/video.edge` |
| Deblock (not in the menu) | `Ctrl+H` | `vestra.video/video.deblock` |
| Deband (not in the menu) |  | `vestra.video/video.deband` |
| 3D Denoise (not in the menu) | `Ctrl+N` | `vestra.video/video.denoise.d3` |
| Gradual Denoise (not in the menu) |  | `vestra.video/video.denoise.gradual` |
| Temporal Denoise (not in the menu) | `Ctrl+M` | `vestra.video/video.denoise.temporal` |
| Frame Doubling (not in the menu) |  | `vestra.video/video.frame-blend` |
| Motion Interpolation (not in the menu) |  | `vestra.video/video.interpolation` |
| Cycle (not in the menu) | `Alt+K` | `vestra.video/video.rotate.cycle` |
| No Rotation (not in the menu) |  | `vestra.video/video.rotate.0` |
| 90° (not in the menu) |  | `vestra.video/video.rotate.90` |
| 180° (not in the menu) |  | `vestra.video/video.rotate.180` |
| 270° (not in the menu) |  | `vestra.video/video.rotate.270` |
| Picture (not in the menu) | `Q` | `vestra.video/video.reset` |
| Picture Panel (not in the menu) |  | `vestra.video/video.resetPanel` |
| Brightness -1% (not in the menu) | `W` | `vestra.video/video.brightness.down` |
| Brightness +1% (not in the menu) | `E` | `vestra.video/video.brightness.up` |
| Contrast -1% (not in the menu) | `R` | `vestra.video/video.contrast.down` |
| Contrast +1% (not in the menu) | `T` | `vestra.video/video.contrast.up` |
| Saturation -1% (not in the menu) | `Y` | `vestra.video/video.saturation.down` |
| Saturation +1% (not in the menu) | `U` | `vestra.video/video.saturation.up` |
| Hue -1% (not in the menu) | `I` | `vestra.video/video.hue.down` |
| Hue +1% (not in the menu) | `O` | `vestra.video/video.hue.up` |
| GPU Rendering (Experimental) (not in the menu) |  | `vestra.video/video.gpu-rendering` |
| AI Upscaling (not in the menu) |  | `vestra.video/video.upscaling` |

<!-- /generated -->

## Bottom-bar buttons

`button: { icon, order }` on {@link "@vestra-player/sdk"!Commands.add | commands.add} gives a command a button in the bottom bar's strip, which the player draws; the fields and how it looks are at {@link "@vestra-player/sdk"!CommandButton | CommandButton}.

- `icon`: a name of the player's icon set ([Theme: Icons](theme.md#icons)) or an image from {@link "@vestra-player/sdk"!Ui.image | plugin.ui.image}; `order`: 0–999, left to right; a menu `path` is required.
- Lower `order` stays in the strip longest; buttons that do not fit, and those past eight, are in the strip's » menu. One button per plugin ([Limits](limits.md#bottom-bar-buttons)).
- A click runs the command as its menu item does; disposing the command or stopping the plugin removes the button.

## Binding syntax

```text
binding  = { modifier "+" } input      modifiers in the order Ctrl, Alt, Shift, Cmd, each at most once
input    = key name | one printable symbol | mouse input
```

- A letter is its key name in capitals, whatever the case typed: `Shift+E`.
- A symbol is written as typed and never with `Shift`: `">"`, not `"Shift+."`; `"!"`, not `"Shift+1"`. The `+` key is always `Plus`, also with modifiers (`Alt+Plus`).
- `"5"` is the main keyboard's 5 only, `"Numpad5"` the keypad's only; `"Enter"` is not the keypad's Enter (`"NumpadEnter"`). The menu shows keypad names as `Num5`, `Num+`, `NumEnter`.
- `Delete` is the forward-delete key ⌦ (fn+⌫ on a Mac laptop), `Backspace` is ⌫.
- On macOS `Ctrl` also matches ⌘ and `Cmd` only ⌘; on Windows `Cmd` is the Windows logo key. Write `Ctrl+…` for a binding that works on both.
- Mouse inputs apply over the video area only. The right button is not bindable (it opens the context menu).
- Anything else fails with code `invalid` when the command is added.

A menu item shows the first of its keyboard bindings that is in effect.

## Binding names

<!-- generated:binding-names -->

| Field of `BINDING_INPUTS` | Names | Notes |
| --- | --- | --- |
| `modifiers` | `Ctrl`, `Alt`, `Shift`, `Cmd` | Modifiers, in the order a binding writes them. `Cmd` is ⌘ on macOS and the Windows logo key on Windows; on macOS `Ctrl` also matches ⌘. |
| `letters` | `A`–`Z` | Letter keys, by key name whatever the case: `A` to `Z`. |
| `digits` | `0`–`9` | Digit keys of the main keyboard: `0` to `9`. |
| `functionKeys` | `F1`–`F24` | Function keys: `F1` to `F24`. |
| `named` | `Space`, `Enter`, `Tab`, `Escape`, `Backspace`, `Delete`, `Insert`, `Home`, `End`, `PageUp`, `PageDown`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `ArrowDown`, `Plus`, `Numpad0`, `Numpad1`, `Numpad2`, `Numpad3`, `Numpad4`, `Numpad5`, `Numpad6`, `Numpad7`, `Numpad8`, `Numpad9`, `NumpadPlus`, `NumpadMinus`, `NumpadMultiply`, `NumpadDivide`, `NumpadEnter`, `NumpadDecimal` | Other named keys, matched by the physical key. `Plus` is the `+` key however it is typed; the `Numpad…` names are the numeric keypad only, never the main keyboard. |
| `mouse` | `Mouse:LeftClick`, `Mouse:LeftDoubleClick`, `Mouse:LeftDoubleClick:LeftHalf`, `Mouse:LeftDoubleClick:RightHalf`, `Mouse:MiddleClick`, `Mouse:X1`, `Mouse:X2`, `Mouse:WheelUp`, `Mouse:WheelDown`, `Mouse:WheelLeft`, `Mouse:WheelRight` | Mouse inputs on the video area; the side buttons `Mouse:X1` (back) and `Mouse:X2` (forward) anywhere in the main window or the floating sidebar window, except while a menu is open. `:LeftHalf` and `:RightHalf` tell the halves of the video apart for a double click. |

<!-- /generated -->

## Core actions

The player's own playback commands, which {@link "@vestra-player/sdk"!Host.run | plugin.host.run} runs by id (capability `commands`). Their bindings are stored as `host/<action>`; what each one does is on {@link "@vestra-player/sdk"!HostAction | HostAction}.

<!-- generated:core-actions -->

| Action | Menu item | Default bindings |
| --- | --- | --- |
| `stop` | Close | `F4` |
| `play-pause` | Play/Pause | `Space`, `Mouse:LeftClick` |
| `fullscreen` | Toggle Fullscreen | `Escape` |
| `previous` |  | `PageUp`, `Mouse:X2` |
| `next` |  | `PageDown`, `Mouse:X1` |
| `volume-up` |  | `ArrowUp`, `Mouse:WheelUp` |
| `volume-down` |  | `ArrowDown`, `Mouse:WheelDown` |
| `mute` |  | `M` |
| `frame-back` |  | `D` |
| `frame-forward` |  | `F` |
| `seek-backward` |  | `ArrowLeft` |
| `seek-forward` |  | `ArrowRight` |
| `rate-normal` |  | `Z` |
| `rate-down` |  | `X` |
| `rate-up` |  | `C` |

<!-- /generated -->

The player also owns **Toggle Fullscreen** (`host/fullscreen`, `Escape`), **Enter Fullscreen** (`host/enter-fullscreen`: no default key, enabled only when windowed), **Leave Fullscreen** (`host/exit-fullscreen`: no default key, enabled only in fullscreen), **Quit** (`host/quit`), **Sidebar** (`host/sidebar`: the bottom bar's sidebar button, order 800, group `windows`), **Adjustments and Effects** (`host/adjust`: the bottom bar's sliders button, order 791, group `windows`) and **Command Palette** (`host/palette`, `Ctrl+Shift+P`, outside the menu); their keys are in [Built-in commands](#built-in-commands).

## Keys the system takes first

These keys may never reach a binding, because the system or the player takes them first; do not use them as defaults. This table is the one list of them; other pages link here.

| Keys | Taken by |
| --- | --- |
| ⌃F1–⌃F8 (macOS) | The system's keyboard navigation (⌃F1 turns keyboard access on and off). A `Ctrl+F1` binding still fires with ⌘F1. |
| ⌃← ⌃→ ⌃↑ ⌃↓ (macOS) | Spaces, Mission Control and application windows. The ⌘ versions of a `Ctrl+arrow` binding work. |
| ⌘H, ⌘M (macOS) | The system: hide and minimize the application. A `Ctrl+H` or `Ctrl+M` binding then fires only with ⌃. |
| ⌘Tab, ⌘Space (macOS) | The application switcher and Spotlight. |
| F11, and F1–F12 on Apple keyboards (macOS) | F11 shows the desktop; on Apple keyboards the function keys are media keys unless fn is held. |
| Ctrl+Alt+arrow keys (Windows) | Some graphics drivers, to rotate the screen. |
| Most `Cmd+…` combinations (Windows) | The system, for the Windows logo key. `Cmd+Q` (**Quit**) does nothing there; the window's close button and Alt+F4 quit. |
| **Standard close keys**: ⌘W (macOS); Ctrl+W, Ctrl+F4 (Windows) | The player, in a tool window, the floating sidebar and the Options window: they close that window exactly like the title-bar button (a tool window's `onClose` runs), even while a text field has focus, so neither Slint handlers nor bindings see them. In the main window they do nothing, so a binding for them fires there as usual. |
| Right button, left drag on the video | The player: the context menu; moving the window in window mode. |

The defaults of the built-in commands are taken as well: a plugin default on the same input in the same scope loses to the player's own command and to plugins loaded earlier.
