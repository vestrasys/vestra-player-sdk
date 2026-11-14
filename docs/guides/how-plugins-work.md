---
title: How a plugin works
description: The rules behind every plugin, on one page, from the process and the update pass to values between TypeScript and Slint, commands, idle stops, processing and failures.
---

# How a plugin works

**Goal:** know the dozen rules that decide whether a plugin of any kind behaves, before writing one. Each guide covers one task; this page is what they all assume. For a method's parameters and errors, follow the links into the API.

## The process

- **A plugin is a Node.js process** the player starts, with the Node standard library, the file system and the network. The built-in plugins share one process; every other plugin has its own.
- **No declarations, a disclosure.** A manifest says who the plugin is, not what it may call. The plugin store shows the user what the code uses, from a scan of the package ([Capability scan](../reference/scan.md)). What a plugin follows is a call: `plugin.player.subscribe()` for the player's events, `await plugin.player.read()` for its state at start.
- **Types only.** Import `@vestra-player/sdk` with `import type`; the `plugin` object comes from the player's own copy of the SDK, so a built plugin holds only its own code.
- **No web storage.** `localStorage` does not exist. Settings go to {@link "@vestra-player/sdk"!Storage.json | plugin.storage.json} (debounced, atomic, a corrupt file moved aside), state that must outlive a restart of the plugin within one player run to {@link "@vestra-player/sdk"!Storage.session | plugin.storage.session}, credentials to {@link "@vestra-player/sdk"!Secrets | plugin.secrets}, other files to {@link "@vestra-player/sdk"!Plugin.dataDirectory | plugin.dataDirectory} (one per installation, kept across upgrades; write to a temporary name and rename).
- **One API on every system.** What a system cannot do fails with `unsupported` ([Platforms](../reference/platforms.md)). Build paths with `node:path`.

## Handles and scopes

Everything a plugin creates is a **handle** ({@link "@vestra-player/sdk"!Disposable | Disposable}): a command, a window, a panel, a filter chain, a stream, a job, every listener. Each belongs to the {@link "@vestra-player/sdk"!Scope | Scope} it was made through; `plugin` is the root scope, {@link "@vestra-player/sdk"!Scope.scope | plugin.scope()} makes a child with the same modules.

- Disposing a scope disposes its handles and child scopes in reverse order; stopping the plugin disposes everything. There is no cleanup function to return from `activate`.
- **Child scopes are for things that come and go together**: a menu that lists the current tracks, a window and the timer that feeds it. Titles and menu paths cannot change in place, so a changing menu is a child scope that is disposed and built again.
- The one handle that does not close on dispose is {@link "@vestra-player/sdk"!Media | Media}: the user is watching it; call `close()` when you mean it.

## The update pass

A plugin's state is plain variables. **Bindings** keep the player in step with them: {@link "@vestra-player/sdk"!View.bind | view.bind(() => props)} for a window, panel or settings page, and a command's `enabled`, `checked`, `busy` and `reason` given as functions. In an **update pass** the SDK calls the bindings, compares each result with what it sent last, and sends only what changed.

A full pass runs after every handler the SDK calls returns (a command's `run`, a view callback, a listener, an `mpv.observe` listener) and when its promise settles, after a window, panel, subtitle, filter or export state change, and on {@link "@vestra-player/sdk"!Scope.update | plugin.update()}. After a change of the player state only the bindings that read a changed field of `plugin.player.state` run; a full pass still follows at least once a second while media plays. The one handler without a full pass after it is a {@link "@vestra-player/sdk"!Player.on | player.on} listener, whose events can come with every position change: what it writes to {@link "@vestra-player/sdk"!Scope.state | plugin.state} re-runs only its readers, and `plugin.update()` re-runs everything. Requests within one tick merge into one pass, and each target has one write in flight, so a binding that changes 60 times a second costs one write per round trip.

|                  | `set({ x })`                                              | `bind(() => ({ x }))`                                                        |
| ---------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------- |
| When it is sent  | Now.                                                      | In every pass that evaluates it, when `x` differs from the value last sent.  |
| Same value again | Sent again: pulls a control back after the user moved it. | Not sent: a field the user edited stays until the plugin's value changes.    |
| A failed write   | Retried with back-off.                                    | Not repeated until the value changes; reported to `onError`.                 |
| Use for          | One-off values: a document, a reset.                      | Everything derived from state: labels, enabled flags, lists, status lines.   |

**The rule to remember:** state changed outside a handler, or after an `await` inside one, shows at the next pass, which may be a second away. Call `plugin.update()` right after such a change ([Keep a slider responsive while dragging](slider.md)).

## TypeScript and Slint

Your TypeScript runs in the plugin's process; the `.slint` files run inside the player. They exchange two things: **properties** out (`set`, `bind`) and **callbacks** in ({@link "@vestra-player/sdk"!View.on | on}).

- **A tool window file exports exactly one component**, which inherits `Window`; its `in` and `in-out` properties and callbacks are the plugin's side. **A panel or settings page file exports one component and one global**: the player composes the component into its own window, and the global is the bridge the plugin writes and the component reads.
- **Names:** write camelCase or kebab-case in TypeScript; the SDK writes `canMark` as `can-mark`. Fields inside struct values are passed as spelled, so spell them as the Slint struct does, without `_`.
- **Values are JSON plus two references.** The table says what the player accepts for each Slint type; anything else is refused with `wrong type` when the window opens or the panel is ready. The test host reads your `.slint` declarations and rejects a mistyped value the way the player does, so a plugin test catches it first.

| Slint type                           | Write from TypeScript                                                                              |
| ------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `bool`                               | a boolean                                                                                          |
| `int`, `float`, `length`, `duration`, `angle`, `percent` | a finite number                                                                 |
| `string`                             | a string, or a {@link "@vestra-player/sdk"!Text | Text} the player translates                      |
| `[T]` (a model)                      | an array; rows are structs                                                                         |
| a `struct`                           | an object with the struct's fields                                                                 |
| `image`                              | an {@link "@vestra-player/sdk"!ImageRef | ImageRef} from `plugin.ui.image`                         |
| `[MarkdownBlock]`                    | a {@link "@vestra-player/sdk"!MarkdownRef | MarkdownRef} from `plugin.ui.markdown`                 |
| `color`, `brush`, an `enum`          | **nothing**: declare a number or string and compute the colour or choice in Slint, or use a `Theme` token |

- **Every name must exist in the Slint file.** A property the file does not declare fails the window's `show()`, a panel's `ready` or the Options window; so does a callback bound with `on()` that the file does not declare. Bind every callback **before the first `show()`**.
- **Arrays are sent as row patches**: only the rows whose value changed in the plugin. Slint code must not write into a row (`rows[i].selected = true`); send a callback and change the row in the plugin. Draw long lists with `ListView`.
- **Two-way controls** (a slider, a switch, a field the user and the plugin both change) need an `in-out` property and a two-way binding, `value <=> root.strength;`. A one-way binding breaks the first time the user moves the control.
- **Life cycle.** `create()` makes a local handle; the first `show()` compiles the file and opens the window with the values bound so far. `close()` or the user destroys the instance, and the next `show()` opens a fresh one with the current properties; what the user typed and the plugin did not record is gone. Only a user close calls `onClose`. A panel's file is compiled on its own when the panel is first shown: one shown at once (the bottom bar, the backdrop, the current tab of an open column) at the mount, so a broken file rejects `ready` with `ui-prepare`; a tab mounted in the background when the user first shows it (or the adjust column opens), so its failure arrives at `onError` and the tab stays empty until the plugin mounts it again. Mounting or unmounting a panel leaves the other panels as they are. A panel gets a new instance when its place is made again (a column closed and opened, the fullscreen overlay, the floating sidebar); the player restores the bridge's properties, nothing kept only inside the Slint component.
- **Theme.** Plugin files compile with Slint's `fluent-dark` style; colours are `Theme` tokens, never values, so they follow the dark and light palettes; text the user sees is `@tr("English")` ([Design rules](design-rules.md), [Theme](../reference/theme.md)).

## Commands, menus and keys

{@link "@vestra-player/sdk"!Commands.add | plugin.commands.add} declares a command and returns its handle.

- **The id is the identity** (`<plugin id>/<id>`): the user's own key bindings are stored under it, so a title or menu move keeps them. **`path` puts it in the main menu**; a command without a path needs a `title` and lives in bindings or a panel menu.
- **State is declared, not pushed.** `enabled`, `checked`, `busy` and `reason` are values, functions evaluated in the update pass, or conditions from `plugin.when` that the player evaluates itself (which keeps the plugin from being woken for them). **The player calls `run` only when the command can run**; `reason` tells the user why not.
- **Titles and paths are fixed**; a changing menu is a child scope.
- **Menu paths are English source text and keys.** A built-in menu is named by id (`"@video"`); plugins that should meet in one submenu spell its key identically; each segment is shown translated by the plugin that declared it ([Commands, menus and bindings](../reference/commands.md) lists the menus, groups and keys in use).
- **Keys:** letters, digits and function keys with their modifiers (`"Shift+R"`, `"Ctrl+O"`; `Ctrl` is portable, `Cmd` is macOS only); a symbol as the character it types (`">"`, not `"Shift+."`). **Conflicts are not errors**: a binding the player or another plugin holds is logged and ignored. **A disabled command lets its key go**, which is how context-dependent keys work.

## What keeps a plugin running

The player stops a plugin that holds nothing only its process can serve after a while without use, and starts it again at its next use, like a browser's extension service workers.

- **What stays while it is stopped:** its menu items and keys with their last state, its settings pages, its resolvers and drop targets, its background sidebar tab. Using one starts the plugin and delivers the click.
- **What keeps it running:** a listener (`onChange`, `onEnd`), a binding that reads the player state, an open window, a bottom-bar or backdrop panel, the current sidebar tab, a filter chain, an mpv filter or observer, a stream, a job, busy work (a command in `busy`, a dialog). A plugin that holds any of these when it becomes ready stays running for the run. One that takes up a filter chain, an mpv filter or observer later stays running from then on for the rest of the run, also after it lets go of it: the player judges again at its next start. A listener added later keeps it running while the listener exists.
- **What does not keep it running:** work the player does not see. A `fetch`, a socket, a `setTimeout` or a promise the plugin awaits is lost when it is stopped. Declare the work, or keep what it needs in `storage.session` and pick it up in `activate`, which may therefore run more than once per player run.
- **While it starts**, clicks and callbacks are held and delivered when it is ready; an `activate` that waits for one of them never gets it and is stopped at the start deadline.

`TestHost.keepsRunning` and `TestHost.listening` show what a plugin holds ([Test a plugin](testing.md)).

## Video and audio processing

Four places change what the user sees or hears; choose by what must be changed and where it must reach.

| Place                                                      | Changes                                                  | Who may hold it                  | Reaches snapshots and exports | Needs the GPU renderer |
| ---------------------------------------------------------- | -------------------------------------------------------- | -------------------------------- | ----------------------------- | ---------------------- |
| **Filter chain** ({@link "@vestra-player/sdk"!VideoFilter | VideoFilter}, {@link "@vestra-player/sdk"!AudioFilter | AudioFilter}) | the decoded frames and samples: colour, blur, denoise, rotation, crop, volume, equalizer | every plugin its own; all joined | yes                           | no                     |
| **Display layer** ({@link "@vestra-player/sdk"!VideoView | VideoView}) | where the video sits: aspect, fit, zoom, pan            | one plugin at a time             | no                            | no                     |
| **Render options** ({@link "@vestra-player/sdk"!RenderOptions | RenderOptions}) | how the GPU draws: tone mapping, interpolation          | one plugin at a time             | no                            | yes                    |
| **Shaders** ({@link "@vestra-player/sdk"!VideoShaders | VideoShaders}) | the picture on the GPU, with your own mpv user shaders  | every plugin its own; all joined | no                            | yes                    |

- **A chain is a desired state.** `set(nodes)` says what the chain should be from now on; the last write wins, and the SDK applies it again to every new source. `[]` withdraws it. Nothing is sent before the first `set()`.
- **Each plugin owns its chain**; the player joins them in a stable order. Limits are shared ([Limits](../reference/limits.md)).
- **The nodes** are the members of {@link "@vestra-player/sdk"!VideoNode | VideoNode} and {@link "@vestra-player/sdk"!AudioNode | AudioNode}: ready-made ones (`eq`, `hue`, `gblur`, `sharpen`, `transform`…), a `convolution` kernel of your own, and `lut3d`, a `.cube` colour table from the plugin's package or data directory. Each field's range, which fields change **live** (in place while playing; any other field rebuilds the stage, with a one-frame stall) and the exact `.cube` format are in the node's documentation; a slider drives a live field.
- **Status, not exceptions.** A chain, the display layer and the render options report `waiting`, `applying`, `applied` or `failed` ({@link "@vestra-player/sdk"!FilterStatus | FilterStatus}); `failed` names its `error.code` and is not retried by itself. Without `plugin.player.subscribe()` the SDK never sees media become ready, and a chain stays `waiting`.

[Process video with a shader or a filter](filters.md) builds both kinds.

## Playback state and conditional controls

{@link "@vestra-player/sdk"!Player.state | plugin.player.state} is the last state the plugin saw. `sourceId` changes every time something is opened; `phase` says whether there is media (`"empty"` means none); `can` says what the source allows (pause, seek, rate, snapshot…). Enable controls from `state.can`, and expect `stale` from any control: the user or another plugin changed the source meanwhile, and the call did nothing ([Control playback](control-playback.md)).

## Failures

Every failure is an `Error` with a stable `code` ({@link "@vestra-player/sdk"!PluginError | PluginError}). **Branch on `code`, never on `message`.**

- A promise you await rejects. A handler the SDK calls that throws reports to {@link "@vestra-player/sdk"!Scope.onError | onError} of its scope, then the parent's, then the plugin log, so one `onError` that shows the problem is often enough. A refused property write or command registration reports there too.
- A lasting target (a chain, the display layer, render options) reports through its status instead.
- **A refusal did nothing**: `stale`, `busy`, `conflict`, `invalid`, `unavailable`, `unsupported` mean the call was not carried out, so show the reason and let the user try again.
- **No timeouts, no blind retries.** The SDK waits for the player's real answer, and never resends an operation that is not safe to repeat; only last-write-wins targets such as filter chains are sent again.

## See also

- [Tutorial](../tutorial/index.md): a first plugin and the three styles.
- [Design rules](design-rules.md): make it feel like part of the player.
- [Troubleshooting](troubleshooting.md): what each symptom usually means.
- [Error codes](../reference/errors.md), [Events](../reference/events.md), [Limits](../reference/limits.md).
