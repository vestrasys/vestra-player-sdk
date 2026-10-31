---
title: Menu guidelines
description: Where a plugin's commands go in the player's right-click menu, how to title them, how to share a submenu and how to choose default key bindings.
---

# Menu guidelines

The player has one menu, opened with a right click on the video. There is no menu button in the window and no menu bar at the top of the screen, so every command a user may look for is in this menu or in a panel's right-click menu. It is merged from the commands of every plugin and the player's own; these rules keep the result one menu instead of a pile of plugins.

How paths merge, how `order` and `group` sort items and how a key finds its command are explained in [Commands, menus and key bindings](../explanation/commands.md). Menu ids, the shared menu keys, the binding syntax and the keys the system takes first are listed in [Commands](../reference/commands.md). The declaration itself is {@link "@vestra-player/sdk"!CommandOptions | CommandOptions}.

## Organize by what the user does

- **Put a command where its subject is, not under your plugin's name.** A video filter goes into Video, a subtitle tool into Subtitles, an open-something command into Open. A plugin that brings a domain of its own gets a submenu named after the domain, not after the plugin (Games for an emulator, not the emulator's name).
- **Before adding an item, look for an existing one.** Every command the player and its built-in plugins add, with its menu path and default key, is listed in [Built-in commands](../reference/commands.md#built-in-commands). Do not add a second entry for something the player already does, and do not scatter one feature over several menus.
- **Top level is for frequent, direct commands**: opening files, closing, fullscreen and the entries that show a window or panel. Everything else goes into a submenu of its domain.
- **No "File" or "View" menu.** Commands that open something go into Open ▸; commands that show a window or panel sit directly at the top level.

## The top level

The top level as the player ships it (shortcuts in the Windows notation; the menu shows each system's own):

```text
Open File…                    Ctrl+O, F3   group open
Open ▸
Close                         F4
Reopen Current/Last File      Ctrl+Y
Copy to Clipboard ▸
────────────────────────────────────────
Playback ▸                                 group domain
Subtitles ▸
Video ▸
Audio ▸
────────────────────────────────────────
Toggle Fullscreen             Enter        group screen
Screen ▸
────────────────────────────────────────
Playlist  ✓                   F6           group windows
Playback Info  ✓              Tab
Playback Properties…          Ctrl+F1
Vestra Player AI…
Plugin Store…
────────────────────────────────────────
Settings ▸
────────────────────────────────────────
About Vestra Player…          F1
────────────────────────────────────────
Quit                          Cmd+Q        group exit
```

A top-level item uses the group and the `order` range of its kind:

| Group                  | `order` | For                                                                              |
| ---------------------- | ------- | -------------------------------------------------------------------------------- |
| `open`                 | 100–199 | Opening and closing sources                                                      |
| `domain` (the default) | 200–699 | Domain submenus: Playback, Subtitles, Video, Audio, and a new domain of your own |
| `screen`               | 700–799 | Fullscreen and the window's size and placement                                   |
| `windows`              | 800–899 | Items that show a window or a panel (a check mark when it toggles one)           |
| `exit`                 | 900–999 | Quit                                                                             |

Keep a group's orders contiguous: `group` only draws a separator between neighbours of different groups, so an item whose order falls into another group's range splits that group in two.

## Inside a built-in menu

- **Name the menu by its id**: `["@video", "Blur"]`. The seven built-in menus (Open, Playback, Subtitles, Video, Audio, Screen, Settings) stay where they are whatever you put in them.
- **Without an `order`, your item goes to the end** of the menu, after the player's own items, which is usually right for a plugin. To sit next to a related player item, give an `order` near that item's; the player's items use 100 and up, in the order listed in [Built-in commands](../reference/commands.md#built-in-commands), and the ranges per menu are at {@link "@vestra-player/sdk"!CommandOptions.order | CommandOptions.order}.
- **Group related items** with a `group` of your own, so a separator sets them apart from the player's items.
- **Playback ▸ Speed and Playback ▸ Seek are the player's.** You can add to them; their titles stay the player's.

## Shared submenus

- **Write a shared submenu exactly as the menu keys list does.** Menus merge by the English words of the path: `["@playback", "Chapters and Bookmarks", …]` joins the existing submenu, `["@playback", "Bookmarks", …]` makes a second one. The keys are in [Commands](../reference/commands.md#submenu-keys-in-use).
- **A new submenu that other plugins should use is a new menu key**: ask the player's maintainers to register it instead of inventing it in one plugin, so it appears in the list.
- **A submenu's title is translated by the catalog of the plugin that declares its first command**; your own submenu therefore needs its words in your catalog.
- **Menu paths are written with `▸`** (U+25B8) in documentation and messages, never `▶`, which many systems draw as an emoji.

## Titles

- **Title Case**, short: "Save Current Frame", "Show Marks on Seek Bar". A menu is as wide as its longest title in the user's language; a CJK character counts about twice a Latin letter, and German or French titles are longer than English, so a long title widens the whole menu.
- **End with `…`** (one character, U+2026) when the item opens a window or asks something before acting ("Adjust Sync…", "Plugin Store…"); no `…` when it acts at once.
- **A toggle has a check mark** (`checked: true | false`, as "Show Subtitles"). **Mutually exclusive choices are radio items** (`radio: true`) in one group: speeds, loop modes, snapshot formats, palettes.
- **Do not put key names in a title.** The menu shows each item's binding on the right, in the system's notation.
- **Dynamic items are data.** Track names, device names, file names and bookmarks are shown as they are, not translated. Cap long dynamic lists well below the command limit ([Limits](../reference/limits.md#commands)): the player shows at most 50 chapters and ends the list with "More Chapters… (N in all)".
- **Keep unavailable items, disabled, with a reason** (`enabled: false` and `reason`) instead of removing them; remove an item only when it can never apply here (the player's Picture-in-Picture item exists only where the system supports it). An empty dynamic list shows one disabled item that says so ("No Audio Tracks").

## A panel's right-click menu

- **A panel's commands go into its own right-click menu** ({@link "@vestra-player/sdk"!Panel.showMenu | panel.showMenu}), not into the main menu: it looks the same and is made of the plugin's own commands. Commands that make sense only in the panel have no `path` there.
- **Keys that act on the panel's content** (Enter to play, Delete to remove) are bindings with `focus: "panel"`: they win over the global meaning of the same key while the panel has focus, and give it back when it loses focus. That is intended, not a conflict.
- The player's playlist is the model: its list menu, its Add and Sort buttons and its panel keys; its panel keys are at the end of [Built-in commands](../reference/commands.md#built-in-commands).

## Default bindings

A default binding is optional. Users rebind every command (Settings ▸ Keyboard Shortcuts…) and can turn all defaults off (Settings ▸ Ignore Default Shortcuts), so give one only to a command people repeat often.

- **Pick an unused key.** Check [Built-in commands](../reference/commands.md#built-in-commands), which lists every default binding of the player and its built-in plugins. Two commands with the same key are not an error, but only one of them runs (the user's choice, then the player's own commands, then the plugin loaded first), so a colliding default simply does nothing for the user.
- **Write `Ctrl`, not `Cmd`**, for a binding that works on both systems: on macOS `Ctrl+X` fires for both ⌃X and ⌘X.
- **Avoid the [keys the system takes first](../reference/commands.md#keys-the-system-takes-first)**, the standard close keys among them, as defaults.
- **The right mouse button opens the menu** and is not a binding input; the other video-area mouse inputs are.
- **A typed symbol is its own key**: `>` is not `Shift+.`, so `.` and `>` can do different things.
- **Remember that bindings belong to the main window.** They do not fire while a tool window or the Options window has focus ([Focus and keyboard](../explanation/ui.md)).
