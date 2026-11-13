// Plugin category, second part: `plugin.wire`, the direct messages to the
// player (style C of the SDK refactor, doc/specs/sdk-refactor.md §3.3 in the
// player repository). Re-exported by ../types.ts (`export type *`).
import type { Json, PropertyWrite, RowOp } from "../../wire.ts";
import type { Disposable } from "./base.ts";
import type { HostEvent } from "./playback.ts";
import type { View } from "./ui-content.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Scope } from "./base.ts";
import type { CommandOptions, Commands } from "./commands.ts";
import type { Player } from "./playback.ts";
import type { Panel, Window } from "./ui-layout.ts";
import type { SettingsPage } from "./ui-shell.ts";
/* oxlint-enable no-unused-vars */

/**
 * Direct messages to the player (`plugin.wire`): requests by method name,
 * raw events, property writes below the SDK's comparison and bare command
 * registrations. Experimental: the wire protocol is not semver; this member
 * changes with versions.
 *
 * @remarks
 * The plugin API wraps the player's protocol (JSON requests and events over
 * the plugin's standard input and output) in typed members that keep state,
 * compare values and recover from lost replies. `plugin.wire` is the layer
 * below them, for trying a player method the SDK does not wrap yet, or for
 * a plugin that wants to send exactly what it chooses. Prefer the typed
 * members: they are semver, `plugin.wire` is not. A method or event can
 * change or disappear with a player version, and members of `plugin.wire`
 * may change in any SDK release without a deprecation period.
 *
 * What the SDK still does at this level: `on` marks its subscription as a
 * listener with where it was added (so the player keeps the plugin running
 * and names the listener in its log), `view(v)` sends one write per property
 * at a time and splits large ones, and `commands.register` waits during
 * activation like `commands.add`. What it leaves to the plugin: the
 * parameters' shape, the value limits, revisions of `request`, retries.
 *
 * The [Tutorial](../../../docs/tutorial/index.md) shows `bind()` (the
 * default), {@link Player.on} with {@link View.set}, and `plugin.wire`
 * side by side, from examples/three-ways; the method and event names are in [Messages](../../../docs/reference/messages.md) and
 * [Events](../../../docs/reference/events.md).
 *
 * @example Show the speed with direct messages
 * A bottom panel shows the playback speed, written by the plugin itself
 * from the raw `source.state` event. The listener types the payload, which
 * is `unknown` here, and `view(bar).write` sends the text as a property
 * write; the SDK keeps no copy of the state and compares nothing.
 * ```ts
 * const bar = plugin.panels.mount("bottom", "ui/bar.slint");
 * const view = plugin.wire.view(bar);
 * plugin.wire.on("source.state", (data) => {
 *   const s = data as { rate: number }; // the plugin types the payload
 *   void view.write("rate", { value: `${s.rate.toFixed(2)}×` });
 * });
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export interface Wire {
  /**
   * Send one request to the player by its method name and get its answer.
   *
   * @remarks
   * Experimental: the wire protocol is not semver; this member changes with
   * versions. `method` and `params` go to the player as given; the answer is
   * the player's result, typed by the caller (`T`). The player's refusals
   * arrive with their own codes (`invalid`, `missing`, `stale`…).
   *
   * Nothing of the SDK's sits between: no value limits, no `seq` or
   * revision, no retry after a lost reply, no wait during activation. A
   * request that changes something the SDK keeps (a window the SDK opened,
   * a command added with {@link Commands.add}) leaves the SDK's copy out of
   * date. The subscriptions are guarded. For the events the SDK knows
   * ({@link HostEvent}) `events.subscribe` and `events.unsubscribe` are
   * refused: the player keeps one subscription per event name, with one
   * mark, and the SDK owns those (its copies of the state,
   * {@link Player.on}); listen with {@link Wire.on} and stop by disposing
   * what it returned. For any other event (a newer player's)
   * `events.subscribe` must say why the plugin listens, `why` (a list of
   * reasons for the player's log) or `mirror: true` (only a copy of the
   * state), so the player's decision to keep the plugin running is never
   * fooled; the SDK does not count such a subscription, the plugin
   * unsubscribes it itself.
   *
   * @param method - The player's method name (`"ui.setMount"`).
   * @param params - Its parameters, a JSON object (omitted: none).
   * @returns The player's result, once the player answered.
   *
   * @throws `invalid` (throws) `method` is not a non-empty string, it is
   *   `events.subscribe` or `events.unsubscribe` of a {@link HostEvent},
   *   or `events.subscribe` of another event without `why` (a non-empty
   *   list of strings) or `mirror: true`.
   * @throws `unsupported` (rejects) The player does not know the method.
   * @throws `disabled` (rejects) The plugin is stopping.
   *
   * @example Write a panel property without the SDK
   * The plugin's bottom panel shows "1.00×" in its `rate` property, written
   * with the player's own request. The parameters are the protocol's
   * (`property`, `value`); the player checks the value.
   * ```ts
   * const bar = plugin.panels.mount("bottom", "ui/bar.slint");
   * await bar.ready;
   * await plugin.wire.request("ui.setMount", { property: "rate", value: "1.00×" });
   * ```
   *
   * @experimental
   * @since 1.7.0
   */
  request<T = unknown>(method: string, params?: Json): Promise<T>;
  /**
   * Listen to one event of the player by its name, with its data as the
   * player sent it, untyped.
   *
   * @remarks
   * Experimental: the wire protocol is not semver; this member changes
   * with versions. For one of the {@link HostEvent} names the SDK subscribes
   * (`events.subscribe`) as for {@link Player.on}: once per name however
   * many listeners, always marked as a listener with where it was added
   * (`why`), never as a copy of the state (`mirror`), so the player keeps
   * the plugin running while it listens. As for `Player.on`, most of
   * them arrive only after {@link Player.subscribe}. Any other name is listened
   * to without a subscription: events the player sends unasked
   * (`commands.execute`, `ui.callback`, `ui.closed`), or an event of a newer
   * player that the plugin subscribed to itself with {@link Wire.request}.
   *
   * The listener gets a copy of the data, typed `unknown`: the plugin
   * checks its shape ({@link Player.on} types it for the known events). As
   * for `Player.on`, no update pass follows the listener, and its errors
   * go to {@link Scope.onError}.
   *
   * @param event - The event's name.
   * @param listener - Receives each event's data.
   * @returns A handle that stops listening; it is disposed with the scope.
   *
   * @throws `invalid` (throws) `event` is not a non-empty string, or
   *   `listener` is not a function.
   *
   * @example Log each command the player runs for this plugin
   * The listener hears the player's `commands.execute` event, which the
   * player sends unasked when the user picks one of this plugin's commands.
   * Its data names the command by its local id; the SDK still runs the
   * command's own `run` too.
   * ```ts
   * plugin.wire.on("commands.execute", (data) => {
   *   const { id } = data as { id: string };
   *   console.log(`the player ran ${id}`);
   * });
   * ```
   *
   * @experimental
   * @since 1.7.0
   */
  on(
    event: HostEvent | (string & {}),
    listener: (data: unknown) => void,
  ): Disposable;
  /**
   * Write a view's properties directly, below the SDK's comparison and
   * row patches.
   *
   * @remarks
   * Experimental: the wire protocol is not semver; this member changes
   * with versions. `view` is a {@link Window}, {@link Panel} or
   * {@link SettingsPage} of this plugin; the writes go to it as
   * `ui.set`, `ui.setMount` or `settings.set`. See {@link WireView}.
   *
   * @param view - A window, panel or settings page this plugin made.
   * @returns The view's direct writes.
   *
   * @throws `invalid` (throws) `view` is not a window, panel or settings
   *   page of this plugin.
   *
   * @example Write a list in rows
   * The sidebar shows a list the plugin keeps itself. The first write sends
   * the whole list; later changes are row operations on what the player
   * shows, sent as they are.
   * ```ts
   * const side = plugin.panels.mount("sidebar", "ui/list.slint");
   * await side.ready;
   * const rows = plugin.wire.view(side);
   * await rows.write("items", { value: [{ id: "a", label: "First" }] });
   * await rows.writeRows("items", [{ op: "insert", at: 1, rows: [{ id: "b", label: "Second" }] }]);
   * ```
   *
   * @experimental
   * @since 1.7.0
   */
  view(view: View): WireView;
  /** Bare command registrations, without state functions or update passes. */
  readonly commands: WireCommands;
}

/**
 * A view's properties written directly (`plugin.wire.view(v)`): whole
 * values or row operations as the player takes them, sent as given.
 * Experimental: the wire protocol is not semver; this member changes with
 * versions.
 *
 * @remarks
 * A property written here belongs to this track alone: `set()` or a
 * `bind()` that produces it throws `invalid` ("property `rows` is written
 * directly; bind it or write it, not both"; a binding's is reported to
 * {@link Scope.onError} once), and a property already set or bound cannot
 * be written here. That keeps the SDK's record of what the player shows
 * correct for the properties it compares.
 *
 * What the SDK does for these writes: one write in flight per property, in
 * order (a whole value drops the writes still waiting before it, which resolve
 * `false`); with a player that takes row patches a whole value without `seq`
 * gets one, a list larger than one request (512 KB of rows) goes in parts, and
 * row operations are numbered and split the same way. What it leaves to the
 * plugin: the value limits (the player refuses a value over them with `limit`),
 * Markdown documents and images in wire form, and a `stale` refusal of row
 * operations (the player shows something else than they apply on: write the
 * whole value). Property names are written in camelCase or as in Slint, as for
 * {@link View.set}.
 *
 * While the view does not show (a window before `show()`, a panel or
 * settings page before `ready`, a closed one) a write is refused with
 * `unavailable`, and so is one the player answers after the view closed
 * or showed its initial properties again. When a window shows its initial
 * properties again (shown after a close), a property written here shows
 * its Slint default: write its whole value again before any
 * {@link WireView.writeRows}. Disposing the view resolves the writes still
 * waiting with `false`.
 *
 * @example Push a status line from a timer
 * A window shows a status line that the plugin's own timer refreshes once
 * a second. Each write replaces the one still waiting, so a slow player
 * never queues stale text; the window's bound values are not involved.
 * ```ts
 * const status = plugin.windows.create("ui/status.slint");
 * await status.show();
 * const direct = plugin.wire.view(status); // writes below bind() and set()
 * const timer = setInterval(() => {
 *   void direct.write("line", { value: new Date().toLocaleTimeString() });
 * }, 1000);
 * plugin.onDispose(() => clearInterval(timer));
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export interface WireView {
  /**
   * Write one property: a whole value, or a row patch of the plugin's own.
   *
   * @remarks
   * Experimental: the wire protocol is not semver; this member changes with
   * versions. `{ value }` replaces the property; a player that takes row
   * patches gets it with a `seq` (the SDK numbers it unless given) and a list
   * over one request's size in parts with `more`.
   * `{ patch: { base, seq, ops } }` is sent as given: `base` is the `seq` of
   * the write it applies on. {@link WireView.writeRows} numbers patches for
   * you.
   *
   * @param property - The Slint property's name.
   * @param write - The write, as the player takes it.
   * @returns `true` once the player took it; `false` when a newer whole
   *   value replaced it before it was sent.
   *
   * @throws `invalid` (throws) `property` is empty or set or bound already
   *   on this view, or `write` has neither `value` nor `patch`.
   * @throws `unavailable` (rejects) The view does not show, or it closed
   *   or showed its initial properties again before the player answered.
   * @throws `limit` (rejects) The player refused a value over its limits.
   * @throws `stale` (rejects) A patch's `base` is not what the player
   *   shows.
   *
   * @example Show a frame counter
   * A panel shows how many frames the plugin produced, pushed from the
   * plugin's own loop. The write goes out at once; if the player is still
   * busy with the previous one, only the newest count waits.
   * ```ts
   * const bar = plugin.panels.mount("bottom", "ui/bar.slint");
   * await bar.ready;
   * const view = plugin.wire.view(bar);
   * let frames = 0;
   * const tick = setInterval(() => void view.write("frames", { value: ++frames }), 100); // newest waits
   * plugin.onDispose(() => clearInterval(tick));
   * ```
   *
   * @experimental
   * @since 1.7.0
   */
  write(property: string, write: PropertyWrite): Promise<boolean>;
  /**
   * Change a list property by row operations, numbered by the SDK.
   *
   * @remarks
   * Experimental: the wire protocol is not semver; this member changes with
   * versions. The operations apply, in order, on what the player shows for the
   * property after this view's last direct write of it since the view showed
   * its initial properties: `set` one row, `insert` rows, `remove` or `move` a
   * run of rows, by index. Without such a write (the property was never written
   * directly, or the window was shown again since) the player has no rows of
   * the plugin's for it: write the whole value with {@link WireView.write}
   * first. They go as one patch, or several applying on each other when they
   * exceed one request (1024 operations or 512 KB of rows). Needs a player that
   * takes row patches.
   *
   * @param property - The Slint property's name.
   * @param ops - The operations, applied in order.
   * @returns `true` once the player applied them; `false` when a whole
   *   value written later replaced them before they were sent.
   *
   * @throws `invalid` (throws) `property` is empty or set or bound already
   *   on this view, or `ops` is not an array.
   * @throws `unsupported` (rejects) The player takes no row patches.
   * @throws `stale` (rejects) No whole value was written directly since
   *   the view showed its initial properties (refused before sending), or
   *   the player shows something else than the operations apply on: write
   *   the whole value.
   * @throws `unavailable` (rejects) The view does not show.
   *
   * @player 0.6.0
   *
   * @example Append a row to a long list
   * A list of 20,000 entries gains one at its end. Only the new row crosses
   * to the player, as one `insert`; the plugin wrote the whole list once
   * before with `write`.
   * ```ts
   * declare const list: WireView;
   * declare const count: number;
   * // ---cut---
   * await list.writeRows("entries", [
   *   { op: "insert", at: count, rows: [{ id: `e${count}`, label: "New entry" }] },
   * ]);
   * ```
   *
   * @experimental
   * @since 1.7.0
   */
  writeRows(property: string, ops: readonly RowOp[]): Promise<boolean>;
}

/**
 * Bare command registrations (`plugin.wire.commands`): the player's
 * declaration as given, a state of values and a handler. Experimental: the
 * wire protocol is not semver; this member changes with versions.
 *
 * @remarks
 * {@link Commands.add} checks the options, builds the declaration and keeps
 * function fields current through the update passes. `register` sends a
 * declaration of the plugin's own making and leaves its state to explicit
 * {@link WireCommand.update} calls. The player checks the declaration and
 * refuses it as for `add`; during activation the registration is awaited
 * and a refusal is handled like `add`'s (logged and skipped by the player's
 * runner, failing `startPlugin` in tests).
 *
 * @example Register a menu item from a declaration
 * Playback ▸ Cycle Speed, bound to C, from a declaration written as the
 * player takes it. Picking it runs `run`, as for a command of `add`.
 * ```ts
 * plugin.wire.commands.register({
 *   id: "rate.cycle",
 *   declaration: {
 *     // the player's fields, as commands.register takes them
 *     title: "Cycle Speed",
 *     path: ["Playback", "Cycle Speed"],
 *     order: 0,
 *     group: "domain",
 *     radio: false,
 *     bindings: ["C"],
 *     focus: null,
 *     repeat: false,
 *   },
 *   run: () => plugin.player.setRate(1.5),
 * });
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export interface WireCommands {
  /**
   * Register a command with a declaration as the player takes it.
   *
   * @remarks
   * Experimental: the wire protocol is not semver; this member changes
   * with versions. `declaration` is `commands.register`'s: `title`, `path`,
   * `order`, `group`, `radio`, `bindings`, `focus`, `repeat`, `button`,
   * `category` and `home` (as in {@link CommandOptions}). The SDK adds the id,
   * the revision and the state and checks nothing in it: bindings must
   * already be in the player's canonical form (`Ctrl+H`).
   *
   * @param options - The id, the declaration, the first state and the
   *   handler.
   * @returns The command, owned by this scope.
   *
   * @throws `invalid` (throws) `id` is not a non-empty string, or
   *   `declaration` is not an object.
   * @throws `conflict` (throws) A command of this plugin already has the id.
   *
   * @example Register a command and turn it off later
   * The command starts enabled; once the plugin has nothing to export, it
   * greys it out with an explicit state. No update pass evaluates it.
   * ```ts
   * declare const declaration: { [field: string]: Json };
   * // ---cut---
   * const exporter = plugin.wire.commands.register({ id: "export", declaration });
   * await exporter.update({ enabled: false, reason: "Nothing to export" });
   * ```
   *
   * @experimental
   * @since 1.7.0
   */
  register(options: WireCommandOptions): WireCommand;
}

/**
 * What {@link WireCommands.register} takes: the command's local id, the
 * player's declaration, its first state and the handler.
 *
 * @remarks
 * Experimental: the wire protocol is not semver; this member changes with
 * versions.
 *
 * @example Declare a checked item
 * A toggle in the Video menu, shown checked from the start. The state
 * fields are the player's (`enabled`, `checked`, `busy`, `reason`).
 * ```ts
 * const options: WireCommandOptions = {
 *   id: "grid",
 *   declaration: { title: "Grid", path: ["Video", "Grid"], order: 0, group: "domain",
 *     radio: false, bindings: [], focus: null, repeat: false },
 *   state: { checked: true }, // the player's state fields
 * };
 * plugin.wire.commands.register(options);
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export interface WireCommandOptions {
  /** The command's local id, unique within the plugin (as {@link CommandOptions.id}). */
  readonly id: string;
  /** The declaration, as the player's `commands.register` takes it. */
  readonly declaration: { readonly [field: string]: Json };
  /**
   * The first state; omitted fields are enabled, unchecked (`null`), not
   * busy, no reason.
   */
  readonly state?: WireCommandState;
  /** The player's conditions for `enabled` and `checked`, in wire form. */
  readonly when?: Json;
  /** Runs when the user picks the command or presses its key. */
  readonly run?: () => unknown;
}

/**
 * A command's state as the player takes it: `enabled`, `checked` (`null`:
 * no check mark), `busy` and `reason` (a text, or `null`).
 *
 * @remarks
 * Experimental: the wire protocol is not semver; this member changes with
 * versions.
 *
 * @example Grey out a command with a reason
 * The menu shows the command disabled, with the reason as its tooltip.
 * ```ts
 * declare const command: WireCommand;
 * // ---cut---
 * const state: WireCommandState = { enabled: false, reason: "Open a file first" };
 * await command.update(state);
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export interface WireCommandState {
  /** The user can run it (default `true`). */
  readonly enabled?: boolean;
  /** A check mark: `true`, `false`, or `null` for none (default `null`). */
  readonly checked?: boolean | null;
  /** Shown as working (default `false`). */
  readonly busy?: boolean;
  /** Why it is disabled: source text or a text value in wire form, or `null` (default). */
  readonly reason?: Json;
}

/**
 * A command registered with {@link WireCommands.register}: its id, its
 * registration and explicit state updates. Experimental: the wire protocol
 * is not semver; this member changes with versions.
 *
 * @remarks
 * Its state changes only through {@link WireCommand.update}; nothing is
 * evaluated in the update passes. Disposing it (or its scope) removes it
 * from the menu and the binding table. The player sends a pick as
 * `commands.execute`; the SDK calls `run`, and {@link Wire.on} hears the
 * event too.
 *
 * @example Show work in progress on a command
 * The command shows busy while its export runs and normal again after. Each
 * update is one request, numbered by the SDK.
 * ```ts
 * declare const declaration: { [field: string]: Json };
 * declare function exportAll(): Promise<void>;
 * // ---cut---
 * const command = plugin.wire.commands.register({
 *   id: "export",
 *   declaration,
 *   run: async () => {
 *     await command.update({ busy: true }); // one commands.update each
 *     await exportAll().finally(() => command.update({ busy: false }));
 *   },
 * });
 * ```
 *
 * @experimental
 * @since 1.7.0
 * @category Plugin
 */
export interface WireCommand extends Disposable {
  /** The local id given in {@link WireCommandOptions.id}. */
  readonly id: string;
  /**
   * Resolves once the player registered it.
   *
   * @throws `invalid` (rejects) The player refused the declaration.
   * @throws `conflict` (rejects) Another command has this menu path.
   * @throws `limit` (rejects) Too many commands in this plugin or the
   *   player.
   */
  readonly ready: Promise<void>;
  /**
   * Send a new state, merged into the last one sent.
   *
   * @remarks
   * Experimental: the wire protocol is not semver; this member changes
   * with versions. One `commands.update` with the next revision, after the
   * registration; several calls are sent in order, the newest last. `when`
   * replaces the conditions (omitted: the last ones sent stay).
   *
   * @param state - The fields to change.
   * @param when - The player's conditions, in wire form.
   * @returns Once the player took the new state.
   *
   * @throws `invalid` (rejects) The player refused the state.
   * @throws `missing` (rejects) The command is not registered (refused, or
   *   disposed).
   *
   * @example Check a command after its action
   * The plugin turns its grid on and shows the check mark in the menu once
   * the player took the state.
   * ```ts
   * declare const grid: WireCommand;
   * // ---cut---
   * await grid.update({ checked: true });
   * ```
   *
   * @experimental
   * @since 1.7.0
   */
  update(state: WireCommandState, when?: Json): Promise<void>;
}
