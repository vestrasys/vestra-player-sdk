/**
 * Plugin commands and key bindings: `commands.*` and `bindings.*`, the
 * binding table, conflicts and the bar buttons.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import type { Json } from "../../wire.ts";
import {
  BAR_BUTTON_ICONS,
  BAR_BUTTON_LIMITS,
  BUILTIN_COMMANDS,
  COMMAND_LIMITS,
  MENU_IDS,
} from "../../commands.ts";
import { canonical, keyLabel } from "../bindings.ts";
import { evaluate } from "../when.ts";
import type { ConditionFacts } from "../when.ts";
import type { CommandWhen } from "../../commands.ts";
import { menuKeys, textKey } from "../../i18n.ts";
import type { FakeCommand, FakeBarButton, TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";
import {
  commandInvalid,
  commandConflict,
  commandText,
  menuTextKey,
  checkDeclaration,
} from "./declarations.ts";
import { declaredText, commandDisplay } from "./i18n.ts";

/** A command state's reason, refused as the player refuses it. */
export function checkReason(
  host: TestHost,
  inner: Internals,
  state: Json | undefined,
): string | null {
  const reason = (state as { reason?: unknown } | null)?.reason;
  return reason !== null && reason !== undefined
    ? declaredText(host, inner, reason, "reason")
    : null;
}

export function bindingClaims(host: TestHost, inner: Internals) {
  const claims = new Map<string, string[]>();
  // The player's own commands win a conflict, as in the binding table.
  for (const [id, { declaration }] of [
    ...host.coreCommands,
    ...host.commands,
  ]) {
    const scope = declaration.focus ? "panel" : "global";
    // The user overlay (`bindings.set`) replaces a command's own bindings.
    const overridden = host.bindings.overlay.get(bindingKey(host, inner, id));
    for (const binding of overridden ?? declaration.bindings ?? []) {
      const key = `${scope} ${binding}`;
      claims.set(key, [...(claims.get(key) ?? []), id]);
    }
  }
  return claims;
}

/** `host/<id>` for core commands, `<manifest id>/<id>` for the plugin's. */
export function bindingKey(host: TestHost, _inner: Internals, id: string) {
  return host.coreCommands.has(id) ? id : `${host.manifestId}/${id}`;
}

/**
 * `commands.keys` as the player answers it: each of the plugin's own
 * commands, and the player's core commands as `host/<id>` (SDK 1.6.16),
 * with the labels of the keys it holds now (the overlay, else its
 * defaults; not a key an earlier command holds), as menus write them on
 * `systemInfo.os`.
 */
export function commandKeys(
  host: TestHost,
  inner: Internals,
): { keys: Record<string, string[]>; revision: number } {
  const claims = bindingClaims(host, inner);
  const mac = host.systemInfo.os === "macos";
  const keys: Record<string, string[]> = {};
  for (const [id, { declaration }] of [
    ...host.commands,
    ...host.coreCommands,
  ]) {
    const scope = declaration.focus ? "panel" : "global";
    const current =
      host.bindings.overlay.get(bindingKey(host, inner, id)) ??
      declaration.bindings ??
      [];
    const labels: string[] = [];
    for (const input of current) {
      if (claims.get(`${scope} ${input}`)?.[0] !== id) continue;
      const label = keyLabel(input, mac);
      if (label !== null && !labels.includes(label)) labels.push(label);
    }
    keys[id] = labels;
  }
  return { keys, revision: inner.keysRevision };
}

/** Push `commands.keys` when the labels changed and the plugin listens. */
export function keysChanged(host: TestHost, inner: Internals) {
  inner.keysRevision++;
  if (!host.subscriptions.has("commands.keys")) return;
  const now = commandKeys(host, inner);
  const text = JSON.stringify(now.keys);
  if (text === inner.keysSent) return;
  inner.keysSent = text;
  host.emit("commands.keys", now);
}

export function splitCommandKey(
  _host: TestHost,
  _inner: Internals,
  key: string,
) {
  const at = key.indexOf("/");
  return { plugin: key.slice(0, at), command: key.slice(at + 1) };
}

export function bindingTable(host: TestHost, inner: Internals) {
  const claims = bindingClaims(host, inner);
  const commands = [...host.coreCommands, ...host.commands].map(
    ([id, { declaration }]) => {
      const key = bindingKey(host, inner, id);
      const scope = declaration.focus ? "panel" : "global";
      const current = host.bindings.overlay.get(key) ?? declaration.bindings;
      const shown = host.commands.get(id) ?? host.coreCommands.get(id);
      return {
        ...splitCommandKey(host, inner, key),
        // What the user sees, like the player's binding table.
        title: shown?.display.title ?? String(declaration.title),
        path: declaration.path?.length
          ? (shown?.display.path ?? declaration.path.map(String))
          : null,
        key: declaration.path?.length
          ? menuKeys(
              declaration.path.map((segment) =>
                typeof segment === "string" ? segment : textKey(segment),
              ),
            )
          : null,
        // Player 0.7.6: the category as shown, `null` without one.
        category: shown?.display.category ?? null,
        scope: scope as "panel" | "global",
        defaults: declaration.bindings,
        current,
        overridden: host.bindings.overlay.has(key),
        shadowed: current.flatMap((input) => {
          const winner = claims.get(`${scope} ${input}`)?.[0];
          return !winner || winner === id
            ? []
            : [
                {
                  input,
                  by: splitCommandKey(
                    host,
                    inner,
                    bindingKey(host, inner, winner),
                  ),
                },
              ];
        }),
        labels: [...current],
      };
    },
  );
  const declared = new Set(commands.map((c) => `${c.plugin}/${c.command}`));
  const orphans = [...host.bindings.overlay]
    .filter(([key]) => !declared.has(key))
    .map(([key, inputs]) => ({
      ref: splitCommandKey(host, inner, key),
      inputs,
    }));
  return { commands, orphans };
}

/** A command's state as the player shows it: its conditions evaluated. */
export function commandShown(
  host: TestHost,
  _inner: Internals,
  sent: FakeCommand["state"],
  when: CommandWhen | undefined,
): FakeCommand["state"] {
  if (!when) return sent;
  const source = host.source;
  const capabilities = source.capabilities;
  const facts: ConditionFacts = {
    phase: source.phase,
    paused: source.paused,
    kind: source.kind === "producer" ? "stream" : "media",
    can: {
      pause: capabilities.pause,
      seek: capabilities.seek,
      rate: capabilities.rate,
      restart: capabilities.restart,
      close: capabilities.close,
      snapshot: capabilities.snapshotSource,
      // As the player: the flags merged into the source state.
      next: source.sequence?.next === true,
      previous: source.sequence?.previous === true,
    },
    fullscreen: host.mainWindow.fullscreen,
    theme: host.appearance,
    language: host.language,
  };
  const shown = { ...sent };
  if (when.enabled) {
    shown.enabled = evaluate(when.enabled, facts);
    if (shown.enabled && !shown.busy) shown.reason = null;
  }
  if (when.checked) shown.checked = evaluate(when.checked, facts);
  return shown;
}

/** Implements `TestHost.press`. */
export async function press(
  host: TestHost,
  inner: Internals,
  binding: string,
  options: { panel?: boolean } = {},
): Promise<"ran" | "reason" | "passed"> {
  const claims = bindingClaims(host, inner);
  const ids = [
    ...(options.panel ? (claims.get(`panel ${binding}`) ?? []) : []),
    ...(claims.get(`global ${binding}`) ?? []),
  ];
  if (!ids.length) throw new Error(`test host: nothing is bound to ${binding}`);
  const command = (id: string) => host.coreCommands.get(id) ?? host.command(id);
  const enabled = ids.find((id) => command(id).state.enabled);
  if (enabled !== undefined) {
    await command(enabled).run();
    return "ran";
  }
  // Like the player: only the first disabled command counts; without a
  // reason the key goes on to the focused control.
  const first = ids[0]!;
  const reason = host.commands.has(first)
    ? command(first).display.reason
    : command(first).state.reason;
  if (typeof reason === "string" && reason !== "") {
    host.osd.push(reason);
    return "reason";
  }
  return "passed";
}

/** Implements `TestHost.barButtons`. */
export function barButtons(
  host: TestHost,
  _inner: Internals,
): readonly FakeBarButton[] {
  return [...host.commands]
    .filter(([, command]) => command.declaration.button !== undefined)
    .slice(0, BAR_BUTTON_LIMITS.perPlugin)
    .map(([id, command]): FakeBarButton => {
      const button = command.declaration.button!;
      const image = typeof button.icon !== "string";
      const reason = command.display.reason;
      const title = command.display.title.replace(/(…|\.\.\.)\s*$/, "");
      const enabled = command.state.enabled && !command.state.busy;
      return Object.freeze({
        command: id,
        icon: image
          ? String((button.icon as { $vestraImage?: unknown }).$vestraImage)
          : (button.icon as string),
        image,
        order: button.order,
        enabled,
        checked: command.state.checked === true,
        tooltip: !enabled && reason ? `${title}\n${reason}` : title,
        async click() {
          const current = host.commands.get(id);
          if (current !== command)
            throw new HostError("missing", `command ${id} is gone`);
          await current.run();
        },
      });
    });
}

/** The default handlers of this area's wire methods, by method name. */
export function commandsHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    "commands.register": (p) => {
      const id = String(p.id);
      // The player's checks, in its order (capabilities/commands.rs
      // `register`, then commands.rs `Registry::register`), with its codes
      // and messages.
      if (!Number.isInteger(p.revision) || Number(p.revision) <= 0)
        throw new HostError("invalid", "positive revision required");
      // The reason is checked (and shown) when it arrives.
      const reason = checkReason(host, inner, p.state);
      const declaration = p.declaration as FakeCommand["declaration"];
      const button = declaration.button as unknown;
      const maxOrder = BAR_BUTTON_LIMITS.maxOrder;
      // Player 0.5.10: a bar button is { icon, order }, its order 0–999,
      // its icon a name or an image of the plugin.
      if (button !== undefined && button !== null) {
        if (
          typeof button !== "object" ||
          Array.isArray(button) ||
          !Object.keys(button).every((key) => key === "icon" || key === "order")
        )
          throw new HostError("invalid", "button is { icon, order }");
        const { icon, order } = button as { icon?: Json; order?: unknown };
        if (!Number.isInteger(order) || +order! < 0 || +order! > maxOrder)
          throw new HostError(
            "invalid",
            `button order must be an integer 0–${maxOrder}`,
          );
        if (typeof icon !== "string" && host.imagePath(icon) === null)
          throw new HostError(
            "invalid",
            "button icon is an icon name or an image from plugin.ui.image",
          );
      }
      // Text values in the title and path are keyed by their English
      // rendering; the built-in menu ids (MENU_IDS) and the player's old
      // Chinese menu titles by the menus' keys.
      const title = menuTextKey(declaration.title);
      const declared = (declaration.path ?? []) as unknown[];
      if (!Array.isArray(declared))
        throw new HostError("invalid", "path is a list of menu texts");
      const keys = declared.map(menuTextKey);
      const menu = keys[0]?.startsWith("@") ? keys[0].slice(1) : null;
      if (menu !== null && !(MENU_IDS as readonly string[]).includes(menu))
        throw commandInvalid(
          `unknown menu id @${menu}; the built-in menus are ${MENU_IDS.map((known) => `@${known}`).join(", ")}`,
        );
      if (menu !== null && keys.length < 2)
        throw commandInvalid(`menu id @${menu} needs an item after it`);
      const path = menuKeys(keys);
      // Player 0.7.6: the category, keyed like a menu text.
      const category =
        declaration.category === undefined || declaration.category === null
          ? null
          : menuTextKey(declaration.category);
      checkDeclaration(id, title, path, declaration, category);
      if (button !== undefined && button !== null) {
        if (path.length === 0)
          throw commandInvalid(
            "button needs a menu path: a bar button is also a menu item",
          );
        const { icon } = button as { icon: unknown };
        if (
          typeof icon === "string" &&
          !(BAR_BUTTON_ICONS as readonly string[]).includes(icon)
        )
          throw commandInvalid(
            `unknown button icon ${JSON.stringify(icon)}: a name of @vestra/icons.slint (${BAR_BUTTON_ICONS.join(", ")}) or an image from plugin.ui.image`,
          );
      }
      // The binding table's `Table::canonical` (player 0.6.1): each binding
      // parsed, and each input once, compared parsed, before the reason,
      // conflicts and limits.
      const bindings = (declaration.bindings ?? []) as unknown[];
      const seen = new Set<string>();
      for (const binding of bindings.map(String)) {
        let input: string;
        try {
          input = canonical(binding);
        } catch (error) {
          throw commandInvalid((error as Error).message);
        }
        if (seen.has(input))
          throw commandInvalid(`binding ${binding} is listed twice`);
        seen.add(input);
      }
      if (reason !== null)
        commandText(reason, "reason", COMMAND_LIMITS.reasonBytes);
      if (host.commands.has(id))
        throw commandConflict("owner/localId already registered");
      // The player's own commands beside the core actions (host/actions.rs
      // `host_declarations`: Adjustments and Effects, Sidebar, Toggle
      // Fullscreen, Command Palette…, Quit and two outside the menu), which
      // take part in conflicts and the total like any other.
      const hostOnly = BUILTIN_COMMANDS.filter(
        (row) =>
          row.owner === "host" && !host.coreCommands.has(`host/${row.id}`),
      );
      // A path may not repeat another command's (the player's own
      // included) nor be a submenu of one, or one of its submenus.
      if (path.length > 0)
        for (const existing of [
          ...hostOnly.map((row) => row.path as readonly string[]),
          ...[...host.coreCommands.values()].map(
            (command) => command.declaration.path as string[],
          ),
          ...[...host.commands.values()].map((command) =>
            menuKeys(
              ((command.declaration.path ?? []) as unknown[]).map(menuTextKey),
            ),
          ),
        ]) {
          const shared = Math.min(existing.length, path.length);
          if (
            existing.length > 0 &&
            existing.slice(0, shared).every((s, i) => s === path[i])
          )
            throw commandConflict(
              "menu path duplicates a command or collides with a leaf/group",
            );
        }
      // The player's caps (COMMAND_LIMITS): the total counts all of the
      // player's own commands too.
      if (
        host.commands.size >= COMMAND_LIMITS.perPlugin ||
        host.commands.size + host.coreCommands.size + hostOnly.length >=
          COMMAND_LIMITS.total
      )
        throw new HostError("limit", "command registry limit reached");

      let sent = p.state as FakeCommand["state"];
      host.commands.set(id, {
        declaration,
        get display() {
          return commandDisplay(
            host,
            inner,
            declaration.path ?? [],
            declaration.title,
            this.state.reason,
            declaration.category ?? null,
          );
        },
        ...(p.when ? { when: p.when as CommandWhen } : {}),
        get state() {
          return commandShown(host, inner, sent, this.when);
        },
        set state(state) {
          sent = state;
        },
        revision: Number(p.revision),
        async run() {
          if (this.state.busy || !this.state.enabled)
            throw new HostError(
              "command",
              `${id} is ${this.state.busy ? "busy" : "disabled"}`,
            );
          host.emit("commands.execute", { id, revision: this.revision });
          await host.settle();
        },
      });
      // The player pushes the new command's keys after the answer.
      queueMicrotask(() => keysChanged(host, inner));
      return { revision: 1 };
    },
    "commands.unregister": (p) => {
      if (!host.commands.delete(String(p.id)))
        throw new HostError("missing", `command ${p.id} is not registered`);
      queueMicrotask(() => keysChanged(host, inner));
    },
    // Player 0.7.6: the labels of the plugin's own commands.
    "commands.keys": () => {
      const now = commandKeys(host, inner);
      inner.keysSent = JSON.stringify(now.keys);
      return now;
    },
    "commands.update": (p) => {
      // The request itself, as the player reads it (capabilities/commands.rs
      // `parsed`): `invalid`.
      if (!Number.isInteger(p.revision) || Number(p.revision) <= 0)
        throw new HostError("invalid", "positive revision required");
      const reason = checkReason(host, inner, p.state);
      // The registry's refusals of an update (commands.rs `Registry::update`)
      // all come back as `command`; the test host's one plugin is owner 1.
      const command = host.commands.get(String(p.id));
      if (!command)
        throw new HostError("command", `command missing: owner 1 / ${p.id}`);
      if (Number(p.revision) <= command.revision)
        throw new HostError(
          "command",
          `stale command revision ${p.revision}; current is ${command.revision}`,
        );
      if (reason !== null)
        try {
          commandText(reason, "reason", COMMAND_LIMITS.reasonBytes);
        } catch (error) {
          throw new HostError("command", (error as Error).message);
        }
      command.revision = Number(p.revision);
      command.state = p.state as FakeCommand["state"];
      if (p.when) command.when = p.when as CommandWhen;
      else delete command.when;
      return { revision: command.revision };
    },
    "bindings.list": () => bindingTable(host, inner),
    "bindings.set": (p) => {
      const key = `${p.plugin}/${p.command}`;
      const known = bindingTable(host, inner).commands.some(
        (c) => `${c.plugin}/${c.command}` === key,
      );
      if (!known && !host.bindings.overlay.has(key))
        throw new HostError("missing", `no command ${key}`);
      host.bindings.overlay.set(key, [...(p.inputs as string[])]);
      host.emit("bindings.changed", null);
      keysChanged(host, inner);
    },
    "bindings.reset": (p) => {
      if (p.plugin === undefined) host.bindings.overlay.clear();
      else host.bindings.overlay.delete(`${p.plugin}/${p.command}`);
      host.emit("bindings.changed", null);
      keysChanged(host, inner);
    },
  };
}
