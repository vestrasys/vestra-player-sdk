/** Menu commands: declaration, state sync (revisions hidden) and dispatch. */
import { Latest } from "./latest.ts";
import { failure, quiet, uncertain } from "./errors.ts";
import { checkBindings } from "./bindings.ts";
import { BAR_BUTTON_ICONS, BAR_BUTTON_LIMITS, MENU_IDS } from "../commands.ts";
import { ImageHandle } from "./view/image.ts";
import { isTextValue, textProblem } from "../i18n.ts";
import { conditionJson, isCondition } from "./when.ts";
import type {
  CommandDeclaration,
  CommandKeys,
  CommandState as WireState,
  CommandWhen,
} from "../commands.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  Bindable,
  Command,
  CommandButton,
  CommandOptions,
  CommandState,
  Commands,
  Condition,
} from "./types.ts";

type Spec = {
  enabled: Bindable<boolean> | Condition;
  checked: Bindable<boolean | null> | Condition;
  busy: Bindable<boolean>;
  reason: Bindable<CommandState["reason"]>;
};
const value = <T>(item: Bindable<T>): T =>
  typeof item === "function" ? (item as () => T)() : item;
/** What a command sends: its state, and its conditions (`plugin.when`). */
type Sent = { state: CommandState; when?: CommandWhen };
/** A field's value, or `fallback` (and its condition noted) for a condition. */
function field<T>(
  item: Bindable<T> | Condition,
  fallback: T,
  name: "enabled" | "checked",
  when: CommandWhen,
): T {
  if (!isCondition(item)) return value(item);
  when[name] = conditionJson(item);
  return fallback;
}
/** How the player's log names a command: its title, else its id. */
const label = (options: CommandOptions) => {
  const title = options.title ?? options.path?.at(-1);
  return `command "${typeof title === "string" ? title : options.id}"`;
};

/** Validate options and build the wire declaration. */
function declare(options: CommandOptions): CommandDeclaration {
  const path = options.path ?? [];
  const title = options.title ?? path.at(-1);
  if (!title)
    throw failure("invalid", `command ${options.id}: title or path required`);
  if (path.length > 8)
    throw failure("invalid", `command ${options.id}: path has 1–8 segments`);
  const category = options.category;
  for (const segment of [
    title,
    ...path,
    ...(category === undefined ? [] : [category]),
  ])
    if (typeof segment !== "string") {
      const problem = isTextValue(segment)
        ? "$vestraList" in segment
          ? "a menu text is a string or a text, not a list"
          : textProblem(segment)
        : "title, path segments and category are strings or texts";
      if (problem)
        throw failure("invalid", `command ${options.id}: ${problem}`);
    }
  const first = path[0];
  const menu =
    typeof first === "string" && first.startsWith("@") ? first.slice(1) : null;
  if (menu !== null && !(MENU_IDS as readonly string[]).includes(menu))
    throw failure(
      "invalid",
      `command ${options.id}: unknown menu id @${menu}; the built-in menus are ${MENU_IDS.map((id) => `@${id}`).join(", ")}`,
    );
  if (menu !== null && path.length < 2)
    throw failure(
      "invalid",
      `command ${options.id}: menu id @${menu} needs an item after it`,
    );
  const order = options.order ?? 0;
  if (!Number.isInteger(order) || Math.abs(order) > 1_000_000)
    throw failure(
      "invalid",
      `command ${options.id}: order must be an integer within ±1000000`,
    );
  const bindings = [...(options.bindings ?? [])];
  const declaration: CommandDeclaration = {
    title: title as CommandDeclaration["title"],
    path: path as CommandDeclaration["path"],
    order,
    group: options.group ?? "domain",
    radio: options.radio ?? false,
    bindings: checkBindings(bindings),
    focus: options.focus ?? null,
    repeat: options.repeat ?? false,
  };
  // Only when set: players before 0.5.10 refuse the field.
  if (options.button !== undefined)
    declaration.button = button(options.id, options.button, path.length > 0);
  // Only when set: players before 0.7.6 refuse the fields.
  if (category !== undefined)
    declaration.category = category as CommandDeclaration["title"];
  if (options.home !== undefined) {
    if (typeof options.home !== "string")
      throw failure("invalid", `command ${options.id}: home is a command id`);
    declaration.home = options.home;
  }
  return declaration;
}

/** `CommandOptions.button`, checked as the player checks it, in wire form. */
function button(
  id: string,
  value: CommandButton,
  inMenu: boolean,
): NonNullable<CommandDeclaration["button"]> {
  const fail = (problem: string) =>
    failure("invalid", `command ${id}: ${problem}`);
  if (value === null || typeof value !== "object")
    throw fail("button is { icon, order }");
  if (!inMenu)
    throw fail("button needs a menu path: a bar button is also a menu item");
  const { icon, order } = value;
  if (
    !Number.isInteger(order) ||
    order < 0 ||
    order > BAR_BUTTON_LIMITS.maxOrder
  )
    throw fail(
      `button order must be an integer 0–${BAR_BUTTON_LIMITS.maxOrder}`,
    );
  if (icon instanceof ImageHandle) {
    if (icon.released)
      throw fail(
        `button image ${icon.path} was released with the scope that created it`,
      );
    return { icon: icon.toJSON(), order };
  }
  if (
    typeof icon !== "string" ||
    !(BAR_BUTTON_ICONS as readonly string[]).includes(icon)
  )
    throw fail(
      `unknown button icon ${JSON.stringify(icon)}: a name of @vestra/icons.slint (BAR_BUTTON_ICONS) or an image from plugin.ui.image`,
    );
  return { icon, order };
}

/** Unregistrations in flight per plugin: re-adding an id waits for its removal. */
const removals = new WeakMap<object, Map<string, Promise<void>>>();
const removing = (runtime: object) => {
  let map = removals.get(runtime);
  if (!map) removals.set(runtime, (map = new Map()));
  return map;
};

class CommandHandle implements Command {
  readonly id: string;
  readonly ready: Promise<void>;
  readonly #scope: ScopeImpl;
  readonly #spec: Spec;
  #revision = 0;
  #last = "";
  #disposed = false;
  #registered = false;
  /** Its entry in `runtime.commands` (a later handle may own the id). */
  #run: () => void = () => {};
  /** The player refused the declaration: no state updates follow. */
  #refused = false;
  readonly #pump: Latest<Sent>;
  readonly #label: string;
  /** Where the plugin added it, for the player's log. */
  readonly #where: () => string | undefined;
  readonly #binding;
  constructor(scope: ScopeImpl, options: CommandOptions) {
    const runtime = scope.runtime;
    this.#where = runtime.callSite();
    if (runtime.commands.has(options.id))
      throw failure("conflict", `command ${options.id} is already declared`);
    this.id = options.id;
    this.#scope = scope;
    this.#label = label(options);
    this.#spec = {
      enabled: options.enabled ?? true,
      checked: options.checked ?? null,
      busy: options.busy ?? false,
      reason: options.reason ?? null,
    };
    const declaration = declare(options);
    // The host requires a strictly increasing revision per update; the
    // registration itself is revision 1, so every later state follows it.
    const previous = removing(runtime).get(this.id);
    this.#pump = new Latest(async ({ state, when }) => {
      if (this.#refused) return;
      const revision = ++this.#revision;
      if (revision === 1) {
        await previous;
        try {
          await runtime.host.commands.register(
            this.id,
            1,
            declaration,
            state as WireState,
            when,
          );
        } catch (error) {
          // A definite refusal: the player has no such command to update.
          if (!uncertain(error)) this.#refused = true;
          throw error;
        }
        this.#registered = true;
      } else
        await runtime.host.commands.update(
          this.id,
          revision,
          state as WireState,
          when,
        );
    });
    const initial = this.#state();
    this.#last = JSON.stringify(initial);
    this.ready = quiet(
      runtime
        .declaring(this.#pump.push(initial), `command ${this.id}`, (error) =>
          scope.report(error),
        )
        .then(() => {}),
    );
    this.#run = () => {
      if (!this.#disposed) scope.run(options.run);
    };
    runtime.commands.set(this.id, this.#run);
    this.#binding = runtime.bind(() => this.#sync());
    scope.add(this);
  }
  /**
   * The state to send. A condition field is sent as a placeholder with the
   * condition in `when`: the player evaluates it. Each function field is
   * evaluated under its own name, so what it reads is reported as this
   * command's (`Runtime.reader`).
   */
  #state(): Sent {
    const runtime = this.#scope.runtime;
    const spec = this.#spec;
    const as = <T>(name: string, read: () => T) =>
      runtime.reader(
        `${this.#label} ${name}`,
        this.#where,
        read,
        name === "enabled" || name === "checked",
      );
    // enabled and checked first: what they read is reported as theirs
    // (a condition can replace them), not as the reason's.
    const when: CommandWhen = {};
    const enabled = as("enabled", () =>
      field(spec.enabled, true, "enabled", when),
    );
    const checked = as("checked", () =>
      field<boolean | null>(spec.checked, false, "checked", when),
    );
    const reason = as("reason", () => value(spec.reason));
    if (reason !== null && typeof reason !== "string") {
      const problem = isTextValue(reason)
        ? textProblem(reason)
        : "reason is a string, a text or null";
      if (problem) throw failure("invalid", `command ${this.id}: ${problem}`);
    }
    const state = {
      enabled,
      checked,
      busy: as("busy", () => value(spec.busy)),
      reason,
    };
    return Object.keys(when).length ? { state, when } : { state };
  }
  #sync() {
    if (this.#disposed || this.#refused) return;
    const state = this.#state();
    const encoded = JSON.stringify(state);
    if (encoded === this.#last) return;
    this.#last = encoded;
    this.#pump.push(state).catch((error) => this.#scope.report(error));
  }
  set(state: Partial<Spec>) {
    Object.assign(this.#spec, state);
    this.#scope.update();
  }
  async dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#scope.forget(this);
    const runtime = this.#scope.runtime;
    if (runtime.commands.get(this.id) === this.#run)
      runtime.commands.delete(this.id);
    this.#pump.stop();
    // Removed from the menu once registered. Recorded before any await, so an
    // immediate re-add of the same id registers after this removal.
    const pending = removing(runtime);
    const removal = (async () => {
      await this.#binding.dispose();
      await this.ready.catch(() => {});
      if (this.#registered)
        await runtime.host.commands.unregister(this.id).catch(() => {});
    })();
    pending.set(this.id, removal);
    await removal;
    if (pending.get(this.id) === removal) pending.delete(this.id);
  }
}

const NONE: readonly string[] = Object.freeze([]);
const KEYS = "commands.keys";

/**
 * One per plugin: the SDK's copy of the key labels of the plugin's own
 * commands (player 0.7.6). Started by the first `keys` read or
 * `onKeysChange`: it subscribes to `commands.keys` (a mirror, unless a
 * listener or a binding holds it), then asks once; the player pushes every
 * later change. Answers and events carry the binding table's revision, and
 * an older one than what the copy has is dropped.
 */
class KeysService {
  readonly #runtime: Runtime;
  #keys = new Map<string, readonly string[]>();
  #revision = -1;
  #started = false;
  readonly #listeners = new Set<() => void>();
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
  }
  start() {
    if (this.#started) return;
    this.#started = true;
    const runtime = this.#runtime;
    // Without `commands` the plugin has no commands: every read is [].
    if (!runtime.can("commands")) return;
    runtime.on(KEYS, (data) => this.#accept(data), "commands", true);
    // Subscribed first: a change after this answer comes as an event.
    runtime.host.commands.keys().then(
      (answer) => this.#accept(answer),
      // An older player (`unsupported`): no keys, as without a binding.
      () => {},
    );
  }
  #accept(data: unknown) {
    const answer = data as Partial<CommandKeys> | null;
    const revision = answer?.revision;
    const keys = answer?.keys;
    if (typeof revision !== "number" || !keys || typeof keys !== "object")
      return;
    if (revision < this.#revision) return;
    this.#revision = revision;
    const next = new Map<string, readonly string[]>();
    for (const [id, labels] of Object.entries(keys))
      if (Array.isArray(labels) && labels.length)
        next.set(id, Object.freeze(labels.map(String)));
    const changed: string[] = [];
    for (const id of new Set([...this.#keys.keys(), ...next.keys()])) {
      const before = this.#keys.get(id) ?? NONE;
      const after = next.get(id) ?? NONE;
      if (
        before.length !== after.length ||
        before.some((label, at) => label !== after[at])
      )
        changed.push(id);
      // The same labels keep the same array.
      else if (after !== NONE) next.set(id, before);
    }
    this.#keys = next;
    if (!changed.length) return;
    this.#runtime.changed(KEYS, changed);
    for (const listener of [...this.#listeners]) listener();
  }
  get(id: string): readonly string[] {
    return this.#keys.get(id) ?? NONE;
  }
  watch(listener: () => void) {
    this.#listeners.add(listener);
    const held = this.#runtime.hold(KEYS);
    return {
      dispose: async () => {
        this.#listeners.delete(listener);
        await held.dispose();
      },
    };
  }
}

const keysOf = (runtime: Runtime) =>
  runtime.service("commands.keys", () => new KeysService(runtime));

export const commands = (scope: ScopeImpl): Commands => ({
  add: (options) => new CommandHandle(scope, options),
  keys(id) {
    if (typeof id !== "string")
      throw failure("invalid", "keys takes a command id of this plugin");
    const service = keysOf(scope.runtime);
    service.start();
    scope.runtime.reading(KEYS);
    scope.runtime.depends(KEYS, id);
    return service.get(id);
  },
  onKeysChange(listener) {
    const service = keysOf(scope.runtime);
    service.start();
    const watch = service.watch(() => scope.run(listener));
    return scope.add({
      dispose: async () => {
        scope.forget(watch);
        await watch.dispose();
      },
    });
  },
});
