---
title: Windows, panels, settings pages, dialogs and the OSD
---

# Windows, panels, settings pages, dialogs and the OSD

A plugin can show its own user interface in five places. Three of them are drawn by the plugin's own Slint files: **tool windows**, **panels** and **settings pages**. Two are drawn by the player or the system from plain values: **dialogs** and the **on-screen display (OSD)**. This page explains what each one is, how to choose, how each one lives and dies, how Slint and TypeScript talk to each other, and what to watch out for.

It assumes you have written a first plugin ([Getting started](../tutorials/getting-started.md)). For every method's parameters and errors, follow the links into the API reference.

## The five surfaces

```text
┌─ main window ─────────────────────────────────────────┬─────────────┐
│ ① OSD message (top left, 2 s)                         │             │
│ ① OSD info blocks (one per plugin, under the message) │  ② sidebar  │
│                                                       │    panel    │
│            video area                                 │             │
│            ② backdrop panel while there is no video   │             │
├───────────────────────────────────────────────────────┤             │
│ ② bottom bar panel                                    │             │
└───────────────────────────────────────────────────────┴─────────────┘

  separate operating-system windows:
  ③ tool windows · ④ the Options window with the settings pages
  ② the sidebar panel when it is detached (floating) · ⑤ dialogs
```

**① On-screen display** ({@link "@vestra-player/sdk"!Osd | plugin.osd}, capability `ui.osd`). Text the player draws over the top-left of the video: a one-line message that disappears after 2 seconds ({@link "@vestra-player/sdk"!Osd.show | osd.show}), and one multi-line information block per plugin that stays until you clear it ({@link "@vestra-player/sdk"!Osd.panel | osd.panel}). It takes no input and needs no Slint.

**② Panels** ({@link "@vestra-player/sdk"!Panels | plugin.panels}, `ui.mount`). A Slint component the player places _inside its main window_: in the **bottom bar** under the video, in the **sidebar** on the right (which the user can detach into a floating window of its own), or as the **backdrop** drawn over the video area while there is no video picture. A panel is part of the player's layout: it moves, resizes, hides in fullscreen and auto-hides with the player's own controls. Each plugin mounts at most one panel.

**③ Tool windows** ({@link "@vestra-player/sdk"!Windows | plugin.windows}, `ui.window`). A separate, top-level operating-system window owned by the plugin: it has its own title bar, the user can move it, resize it (if the Slint file allows) and close it, and it is not modal: the main window keeps playing and keeps taking input while it is open. A plugin can have any number of them.

**④ Settings pages** ({@link "@vestra-player/sdk"!Settings | plugin.settings}, `ui.settings`). A page in the player's **Options** window, under one of nine fixed categories (General, Playback, Subtitles, Video, Audio, Input, Appearance, Plugins, Other). The player owns the window (its tree, its Close button, its size); the plugin provides the page's content. At most 8 pages per plugin.

**⑤ Dialogs** ({@link "@vestra-player/sdk"!Dialogs | plugin.dialogs}, `ui.dialog`). The system's own dialogs: a confirmation alert ({@link "@vestra-player/sdk"!Dialogs.confirm | confirm}) and the open-file, open-folder and save-file dialogs. The plugin passes text and gets an answer back; it does not draw anything. Only one dialog is open at a time, player-wide.

## Choosing a surface

| You want to…                                                                                  | Use                                                                        | Why not the others                                                                       |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Confirm that something happened ("Bookmark added", "Speed 1.5×")                              | OSD message                                                                | A window or dialog would interrupt; the message vanishes by itself.                      |
| Show a few live numbers while playing (bitrate, A/B loop points)                              | OSD info block                                                             | Needs no Slint and no focus; drawn over the video, also in fullscreen.                   |
| Content that belongs to the player and stays visible: a playlist, chapters, a custom seek bar | Panel (sidebar or bottom bar)                                              | It follows the main window's layout and fullscreen; a tool window would float elsewhere. |
| Cover art or an idle screen while nothing is playing                                          | Panel in the `backdrop` slot                                               | It replaces the black video area; one plugin at a time.                                  |
| A tool the user opens, uses and closes: picture adjustments, an inspector, an editor          | Tool window                                                                | It has its own title bar and size and does not take space from the video.                |
| Preferences that rarely change                                                                | Settings page                                                              | Users look for preferences in Options; the player keeps the window and its navigation.   |
| A yes/no question before something destructive                                                | {@link "@vestra-player/sdk"!Dialogs.confirm dialogs.confirm}               | Native look and keyboard handling (Enter, Escape); no Slint file.                        |
| A file or folder from the user                                                                | {@link "@vestra-player/sdk"!Dialogs.openFile dialogs.openFile} and friends | The system dialog is the only one users trust with paths.                                |

Two rules of thumb:

- **Prefer the smallest surface that works.** An OSD message before a dialog, a settings page before a tool window. Every window the user has to close is a cost.
- **Panels are shared space.** There is one sidebar, one bottom bar and one backdrop for all plugins. The sidebar holds several panels as tabs (the player draws the tab strip while there are two or more; showing, hiding and detaching apply to all of them). The bottom bar and the backdrop hold one: while one plugin's panel is there, another plugin's mount rejects with `conflict`, which does not fail its activation. Mount a panel only when the plugin's main purpose is to live there.

## Life cycles

Every surface is a **handle** owned by the {@link "@vestra-player/sdk"!Scope | Scope} that created it. Disposing the scope (or the plugin stopping) releases it: windows close, panels are unmounted, settings pages leave the Options window, the info block disappears. A plugin never has to clean up its interface by hand.

### Tool window

```text
 windows.create(file)       nothing on screen yet; bind callbacks and properties now
        │  view.on(), view.bind(), view.set()
        ▼
 ┌──────────────┐   show()   ┌──────────────┐   hide()   ┌──────────────┐
 │    closed    │──────────▶│   visible    │──────────▶│    hidden     │
 │ opened=false │           │ opened=true  │◀──────────│ opened=true  │
 └──────────────┘           └──────────────┘   show()   └──────────────┘
        ▲                       │       │
        │  close()              │       │  the user: title-bar close button,
        │  (no onClose)         │       │  ⌘W (macOS), Ctrl+W or Ctrl+F4 (Windows)
        └───────────────────────┘       │  → onClose listeners run
        ▲                               │
        └───────────────────────────────┘
 dispose(), the scope disposed, the plugin stopped: closed for good (no onClose)
```

- `create()` only makes a local handle. The first `show()` compiles the Slint file and opens the window with the properties you bound or set so far, so no default values flash.
- Callbacks are registered when the window opens: bind every callback name with {@link "@vestra-player/sdk"!View.on | on()} **before the first `show()`**. Binding a new name while the window is open throws.
- `close()` and a user close both destroy the window instance. The handle stays usable: the next `show()` opens a **fresh** instance with the current properties (whatever the user typed into fields that the plugin did not record is gone).
- Only a user close calls {@link "@vestra-player/sdk"!Window.onClose | onClose}. Stop timers and polling there.

### Panel

```text
 panels.mount(slot, file)
        │  on() / bind() in the same tick are part of the first values
        ▼  (next microtask)
 ui.mount ──▶ the player queues it and rebuilds its main window with the panel
        │                                                   │
        ▼ ready resolves                                    ▼ ready rejects
 mounted ── user / setVisible(false) / no space ──▶ hidden   (ui-prepare, conflict,
    │    ◀─ user / setVisible(true) / toggle() ───          busy, unavailable…)
    │
    ├─ sidebar only: setDetached(true) / the user ──▶ floating window
    │     closing the floating window = setVisible(false)
    │
 dispose() / plugin stops ──▶ unmounted; the main window is rebuilt without it
```

- **Mounting rebuilds the main window.** The player compiles its main window together with every mounted panel, so mounting or unmounting any panel (from any plugin) rebuilds it. The player restores each panel's bridge properties to the last values its plugin wrote, but anything kept only inside the Slint component (a scroll position, a `property` the plugin never writes, the text of a field the plugin does not mirror) starts over. The same happens when the sidebar is detached or attached: the floating window holds a new instance of the component.
- The position (`plugin.panels.bottom`, `.sidebar`) is separate from the panel: it has the user's preference (`preferred`), whether it is on screen now (`effective`) and why not (`reason`), and its tabs (`panels`). Any plugin with `ui.mount` can read and toggle it, so a "Show playlist" command can live in a different plugin than the playlist. The panel's own state ({@link "@vestra-player/sdk"!Panel.state | Panel.state}) adds whether its tab is the current one (`reason: "otherTab"` when not); {@link "@vestra-player/sdk"!Panel.toggle | Panel.toggle} brings a background tab forward instead of closing the sidebar.
- The player remembers the sidebar's visibility, width, detached state and floating window position across launches.

### Settings page

```text
 settings.page(file, { id, category, title })
        ▼  (next microtask)
 settings.register ──▶ the player compiles the page on its own ──▶ ready
                                                          (or ui-prepare, invalid…)
 the user opens Options, or settings.show(id)
        ▼
 the Options window is built from every registered page
        │  pages added or removed while it is open: rebuilt, properties restored
        ▼
 dispose() / plugin stops ──▶ page removed (the window shows a neighbouring page)
```

- The Options window belongs to the player. The page exists from `ready` on, whether or not the window is open; property writes while it is closed are kept and applied when it opens.
- The page is compiled alone at registration, so a broken page fails its own `ready` and not the whole window.

### Dialogs and the OSD

- {@link "@vestra-player/sdk"!Dialogs | Dialogs} are one call each: the promise resolves when the user answers. There is no time limit and no way to close a dialog from code. Playback continues while it is open; command key bindings pause.
- The OSD message is fire-and-forget; a newer message (from any plugin) replaces the current one. The info block is a handle: `set(text)` shows or changes it, `set(null)` hides it, disposing removes it.

## How Slint and TypeScript talk

The plugin process and the user interface run in different processes: your TypeScript runs in the plugin's Node.js process, the Slint files run inside the player. They exchange exactly two kinds of messages:

| Direction   | Slint side                               | TypeScript side                                                                              |
| ----------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| plugin → UI | `in property` or `in-out property`       | {@link "@vestra-player/sdk"!View.set set()} or {@link "@vestra-player/sdk"!View.bind bind()} |
| UI → plugin | `callback name(args);` returning nothing | {@link "@vestra-player/sdk"!View.on on("name", handler)}                                     |

A tool window ({@link "@vestra-player/sdk"!Window | Window}), a panel ({@link "@vestra-player/sdk"!Panel | Panel}) and a settings page ({@link "@vestra-player/sdk"!SettingsPage | SettingsPage}) all share this {@link "@vestra-player/sdk"!View | View} surface. Nothing else crosses: the plugin cannot call Slint functions or read a property back; a value the user changes reaches the plugin only through a callback.

### Where the properties live: component or global

- **A tool window file exports exactly one component**, usually `export component X inherits Window`. Its properties and callbacks are declared on that component. The window is yours, so the component is the window.
- **A panel or settings page file exports one component and one global.** The player composes your component into a window it owns (the main window, the floating sidebar window, the Options window), so the component instance is not a stable address: a new instance is made whenever the main window is rebuilt or the sidebar moves to or from its floating window. The **global** is the bridge: properties and callbacks are declared on it, the component reads and calls them (`ListBridge.rows`, `ListBridge.select(index)`), and the plugin talks to the global. The SDK finds the two names from the file's `export component` and `export global` lines.

{@includeCode ../../examples/panel-menu/ui/panel.slint}

Helper components without `export` are allowed in every file. The player appends a line that exports its palette to every plugin file, so do not declare anything named `VestraPalette`.

### Names and values

- Write names in camelCase or kebab-case in TypeScript: the SDK turns every capital letter into `-` plus the lower-case letter (`canMark` → `can-mark`, `strengthChanged` → `strength-changed`). Fields inside struct values are **not** converted, so spell struct fields exactly as the Slint struct does (and without `_`, which Slint treats as `-`).
- Values must be JSON: booleans, numbers, strings, arrays (Slint models) and objects (Slint structs). Two exceptions: an image from {@link "@vestra-player/sdk"!Ui.image | ui.image}, only as the **whole** value of an `image` property (nested in an array or object it is `invalid`), and a document from {@link "@vestra-player/sdk"!Ui.markdown | ui.markdown} wherever the Slint type is `[MarkdownBlock]`: the whole value, or (SDK 1.5.4, the player after 0.4.0) a field at any depth, such as the `body` of each message in a chat list.
- Every name must exist in the Slint file. Writing a property the file does not declare makes a tool window's `show()` or a panel's `ready` fail, and in a settings page it keeps the Options window from opening; for a tool window, so does a callback bound with `on()` that the file does not declare. Once the view is open, such writes are reported to {@link "@vestra-player/sdk"!Scope.onError | onError}.

### set, bind and the update pass

`set(props)` writes now. `bind(() => props)` declares that properties should _always_ equal a function of your state; the SDK re-evaluates every bound function in an **update pass** and sends only the values that changed.

|                  | `set({ x })`                                                                            | `bind(() => ({ x }))`                                                                 |
| ---------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| When it is sent  | Immediately (in the next write).                                                        | In every update pass, if `x` differs from the last value sent.                        |
| Same value again | Sent again. Use this to pull a control back to the model value after the user moved it. | Not sent. A field the user edited stays as the user left it until your value changes. |
| Write fails      | Retried with back-off (0.25 s doubling up to 30 s).                                     | Not repeated until the value changes.                                                 |
| Typical use      | One-off values: a document, a reset.                                                    | Everything derived from plugin state: labels, enabled flags, lists, status lines.     |

Update passes run:

- after every handler the SDK calls (a command's `run`, a view callback, an `onChange` listener) returns, and again when its promise settles;
- after player, subtitle, panel position, filter and export state changes;
- when you call {@link "@vestra-player/sdk"!Scope.update | plugin.update()}.

Several requests in the same microtask are merged into one pass, and each view has at most one write in flight: values that change meanwhile are merged into the next write. So binding a value that changes 60 times a second costs at most one write per round trip, never a queue.

The rule to remember: **state you change after an `await` inside a handler appears only when the handler finishes**, unless something else triggers a pass. Call `plugin.update()` right after changing it (see [Keep a slider responsive while dragging](../how-to/slider.md)).

### Two-way controls

A control whose value both the user and the plugin change (a slider, a switch, a text field, a combo box) needs a **two-way binding to an `in-out` property**:

```slint
in-out property <float> strength;
callback strength-changed(float);
Slider {
    value <=> root.strength;                          // two-way: never `value: root.strength`
    changed(value) => { root.strength-changed(value); }
}
```

A one-way binding (`value: root.strength`) is broken by Slint the first time the user moves the control; after that the plugin's writes no longer move it. In a panel or settings page the same applies to the global: `checked <=> MyBridge.enabled`.

## Theme and widgets

Plugin Slint files import the player's design tokens and widgets:

```slint
import { Theme } from "@vestra/theme.slint";
import { Icon } from "@vestra/icons.slint";
import { Button, Slider, ToolTipArea, UrlInputRow } from "@vestra/widgets.slint";
import { MarkdownView, MarkdownBlocks, MarkdownBlock } from "@vestra/markdown.slint";
```

- **Colours follow the player's palette.** The player has two palettes, `vestra` (dark, the default) and `vestra-light` (player 0.4.0, SDK 1.5), both drawn from the logo's colours: a magenta accent, cyan for what is playing, an amber → magenta → violet → cyan gradient for fills (see {@link "@vestra-player/sdk"!Appearance | plugin.appearance}). It sets the palette on every view before it appears and again when the user switches, so `Theme` colours change with it. Colours you hard-code do not. `Theme` properties are read-only.
- **The video area is dark in every palette** (`Theme.bg-video`). Text or icons you draw over the video (a backdrop, an overlay) use light colours, not `Theme.text`, which is dark in `vestra-light`.
- Colour tokens: `bg-bar`, `bg-video`, `bg-list`, `bg-panel`, `line`, `hover-bg`, `press-bg`, `selected-bg`, `text`, `text-dim`, `text-list`, `text-played`, `accent`, `accent-press`, `accent-disabled`, `icon-disabled`, `playing`, `button-bg`, `button-hover`, `button-press`, `button-disabled`, `accent-fill` (a gradient brush) and `danger` (errors and destructive actions: a failed status line, a Delete button; player 0.3.0, SDK 1.3).
- Fonts: every window uses the system UI font (Slint falls back per character for scripts it lacks, CJK included); `Theme.font-mono` is the system's monospace family (Menlo on macOS, Consolas on Windows). Sizes: `font-xs` 9px, `font-body` 11px, `font-tab` 12px, `font-title` 13px.
- Control sizes and spacing: `button-height` 21px, `input-height` 21px, `form-row-gap` 26px, `dialog-padding` 14px, `radius-control` 4px (controls, rows, hover plates), `radius-panel` 8px (menus, panels) and others; the full list is the SDK's read-only copy in [`slint/vestra/theme.slint`](https://github.com/vestrasys/vestra-player-sdk/blob/main/slint/vestra/theme.slint). Player 0.4.0 rounded the corners (3px and 6px before).
- **Icons** (player 0.4.0, SDK 1.5): `Icon { name: "play"; color: Theme.text; }` draws one icon of the player's own set: round-capped 1.5px lines (1.25px for small glyphs), never filled, in the icon's own box (its default size; set `width` and `height` to scale). Names: `play`, `pause`, `stop`, `back`, `forward`, `open`, `volume`, `mute`, `playlist`, `detach`, `attach`, `close`, `failed`, `move-top`, `move-up`, `move-down`, `move-bottom`, `search`, `chapter`, `bookmark`, `check-task`, `check-box`, `menu-check`, `submenu`, `scroll-up`, `scroll-down`, `caret-down`, `sort-asc`, `sort-desc`, `tag-remove`, `preview-play`, `add`, `remove`, `sort`; `Icons.commands(name)`, `Icons.box-width(name)`, `Icons.box-height(name)` and `Icons.line(name)` give the path data for your own `Path`. Plugins that use it set `"minPlayerVersion": "0.4.0"`.
- Every plugin file is compiled with Slint's `fluent-dark` style, so `std-widgets.slint` controls (`CheckBox`, `ComboBox`, `Switch`, `LineEdit`…) are dark too; in `vestra-light` the player switches them to their light colours (`Palette.color-scheme`) at run time. Do not set `Palette.color-scheme` yourself.
- **Markdown** (`@vestra/markdown.slint`): `MarkdownView` scrolls one document; `MarkdownBlocks` (SDK 1.5.4, the player after 0.4.0) draws one without scrolling, as tall as its content, for your own layout or a `ListView` row. Both take `blocks: [MarkdownBlock]`, report `link-clicked(url)`, and with `code-copy: true` (default `false`) put a 复制 button on code blocks that reports `copy-code(code)`; copy it with {@link "@vestra-player/sdk"!Clipboard | plugin.clipboard}. A chat window:

  ```slint
  import { ListView } from "std-widgets.slint";
  import { MarkdownBlocks, MarkdownBlock } from "@vestra/markdown.slint";
  export struct Message { id: string, role: string, body: [MarkdownBlock] }
  export component Chat inherits Window {
      in property <[Message]> messages;
      callback copy-code(string);
      ListView {
          for message in root.messages: VerticalLayout {
              padding: 8px;
              MarkdownBlocks {
                  blocks: message.body;
                  code-copy: true;
                  copy-code(code) => { root.copy-code(code); }
              }
          }
      }
  }
  ```

  Write the list with a document per row (`messages: [{ id, role, body: await plugin.ui.markdown(text) }]`). The player parses only the documents that changed and updates the list in place (rows added or removed at the end, a growing message's changed blocks), so re-sending the whole list on every streamed chunk keeps the scroll position and costs little.
- For editor support, point the Slint language server's `libraryPaths` at the copy in the SDK package: `{ "vestra": "node_modules/@vestra-player/sdk/slint/vestra" }`.

## Sizes

All sizes are logical pixels (Slint's `px`): one logical pixel is two physical pixels on a Retina display or at 200 % scaling.

| Surface          | Width                                                                                                                   | Height                                                                                                                                                         |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tool window      | The `Window` component's `width` (fixed, not resizable), or `preferred-width` (initial) within `min-width`/`max-width`. | Same with `height`. The title is the component's `title`.                                                                                                      |
| Bottom bar       | The video column's width.                                                                                               | The component's preferred height (within its minimum and maximum). It may draw above its slot into the video area (negative `y`); the player does not clip it. |
| Sidebar          | Set by the user with the splitter (at least 317; the video keeps at least 318).                                         | The window's full height.                                                                                                                                      |
| Floating sidebar | 300 by default, at least 300.                                                                                           | 408 by default, at least 250.                                                                                                                                  |
| Backdrop         | The whole video area.                                                                                                   | The whole video area.                                                                                                                                          |
| Settings page    | 440.                                                                                                                    | The component's height; the Options window scrolls taller pages.                                                                                               |

The operating system places a tool window when it opens; the player does not remember tool window positions or sizes, and the API cannot read or set them. To keep a tool window's _content_ across runs, see [Remember a window's state between runs](../how-to/window-state.md).

## Focus and keyboard

- **Command key bindings belong to the main window.** A binding from {@link "@vestra-player/sdk"!CommandOptions.bindings | CommandOptions.bindings} fires while the main window or the floating sidebar window has focus (and the key was not taken by a focused control, such as Space in a text field). It does **not** fire while a tool window or the Options window has focus. Keys inside your own window are Slint's job: use a `FocusScope` with `key-pressed`, or a button's default action.
- A binding with `focus: "panel"` fires only while this plugin's panel (docked or floating) has focus, and wins over global bindings there.
- **Standard close keys are not bindings.** ⌘W on macOS, Ctrl+W and Ctrl+F4 on Windows close a tool window, the floating sidebar or the Options window exactly like the title-bar button (a tool window's `onClose` runs). The player takes these keys before Slint sees them, even when a text field has focus, so neither your Slint handlers nor your bindings receive them. The main window does not react to them, so a `Ctrl+W` binding still fires there.
- While a menu or a system dialog is open, bindings pause.

## Platform differences

|                                                | macOS                                                                                 | Windows                                                                                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Close a tool window, floating sidebar, Options | ⌘W                                                                                    | Ctrl+W, Ctrl+F4                                                                                                                                                                       |
| `dialogs.confirm`                              | An `NSAlert` sheet on the active player window (the tool window that asked, usually). | A task dialog owned by the active player window, titled "Vestra Player"; `destructive` shows a warning icon; a `checkbox` is asked as a second yes/no dialog after the user confirms. |
| `Theme.font-mono`                              | Menlo                                                                                 | Consolas                                                                                                                                                                              |
| `DropModifiers.cmd`                            | ⌘                                                                                     | Ctrl                                                                                                                                                                                  |

The API is the same on both systems. Other systems answer `dialogs.confirm` with `unsupported`. When the player runs without a user interface (headless, as in some automated setups), opening windows, mounting panels, dialogs, the OSD and `settings.show` fail with `unavailable`.

## Common pitfalls

- **A window callback bound after the first `show()`.** It throws. Bind all callbacks right after `create()`; re-binding a name that already has a handler is fine.
- **A one-way binding on a control.** `value: root.x` stops following the plugin after the user touches the control. Use `in-out` and `<=>`.
- **`set()` inside a frequent loop.** `set` always sends, even an unchanged value; a periodic `set` of a slider value pulls the thumb back from under the user's pointer. Use `bind` for anything derived from state.
- **Changes after an `await` do not appear.** The update pass runs when the handler finishes; call `plugin.update()` for progress in between.
- **State only inside a panel component.** It is lost when the main window is rebuilt or the sidebar detaches. Keep anything that matters in bridge properties written by the plugin.
- **User edits the plugin does not record.** A settings page or tool window is rebuilt from the plugin's last written values; an `in-out` property the user changed without a callback updating your model reverts. Handle the callback and keep the value in your state (and `bind` it).
- **Hard-coded colours.** They do not follow the palette. Use `Theme.*`, and `Theme.danger` for errors.
- **A `Ctrl+W` default binding.** It never fires in tool windows and floating panels. Pick another key.
- **Two of a kind.** One panel per plugin, one backdrop per player, one OSD info block per plugin, one open dialog at a time (`busy`).
- **Slot state without `events`.** {@link "@vestra-player/sdk"!PanelSlot.state | PanelSlot.state}, {@link "@vestra-player/sdk"!Appearance.theme | appearance.theme} and their `onChange` listeners follow other plugins and the user only with the `events` capability.

## Testing

`TestHost` from `@vestra-player/sdk/testing` runs a plugin without the player and records its interface: `host.window(id)` (`props`, `callbacks`, `visible`, `emit(callback, ...args)`, `userClose()`), `host.mounted()` for the panel, `host.settingsPage(id)` and `host.settings`, `host.osd` (messages shown), `host.confirms` and `host.dialogAnswers`. Property names in `props` are the Slint (kebab-case) names. The test host does not compile Slint files; check them by running the plugin in the player.

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { Plugin } from "@vestra-player/sdk";
import { startPlugin } from "@vestra-player/sdk/testing";

async function activate(plugin: Plugin) {
  let count = 0;
  const window = plugin.windows.create("ui/counter.slint");
  window.bind(() => ({ label: `Clicked ${count} times` }));
  window.on("clicked", () => count++);
  await window.show();
}

test("the label counts clicks", async () => {
  const { host, stop } = await startPlugin(activate, {
    capabilities: ["ui.window"],
  });
  host.window("counter").emit("clicked");
  await host.settle();
  assert.equal(host.window("counter").props["label"], "Clicked 1 times");
  await stop();
});
```

## API on this page

- Tool windows: {@link "@vestra-player/sdk"!Windows | Windows}, {@link "@vestra-player/sdk"!Window | Window}
- Panels: {@link "@vestra-player/sdk"!Panels | Panels}, {@link "@vestra-player/sdk"!Panel | Panel}, {@link "@vestra-player/sdk"!PanelSlot | PanelSlot}, {@link "@vestra-player/sdk"!SidebarSlot | SidebarSlot}, {@link "@vestra-player/sdk"!BackdropSlot | BackdropSlot}, {@link "@vestra-player/sdk"!SlotState | SlotState}
- Settings pages: {@link "@vestra-player/sdk"!Settings | Settings}, {@link "@vestra-player/sdk"!SettingsPage | SettingsPage}, {@link "@vestra-player/sdk"!SettingsCategory | SettingsCategory}
- Shared view surface: {@link "@vestra-player/sdk"!View | View}, {@link "@vestra-player/sdk"!Props | Props}, {@link "@vestra-player/sdk"!PropValue | PropValue}, {@link "@vestra-player/sdk"!Ui | Ui}, {@link "@vestra-player/sdk"!ImageRef | ImageRef}, {@link "@vestra-player/sdk"!MarkdownRef | MarkdownRef}, {@link "@vestra-player/sdk"!MarkdownOptions | MarkdownOptions}
- Dialogs: {@link "@vestra-player/sdk"!Dialogs | Dialogs}, {@link "@vestra-player/sdk"!ConfirmOptions | ConfirmOptions}
- On-screen display: {@link "@vestra-player/sdk"!Osd | Osd}, {@link "@vestra-player/sdk"!OsdPanel | OsdPanel}
- Palette: {@link "@vestra-player/sdk"!Appearance | Appearance}, {@link "@vestra-player/sdk"!ThemeId | ThemeId}

Examples that use them: [blur](../examples/blur.md) (a tool window with a live slider), [bookmark](../examples/bookmark.md) (a tool window bound to playback state), [panel-menu](../examples/panel-menu.md) (a sidebar panel with a context menu), [theme-widgets](../examples/theme-widgets.md) (the theme and widgets) and [markdown](../examples/markdown.md) (the Markdown view).
