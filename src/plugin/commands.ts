/** Menu commands: declaration, state sync (revisions hidden) and dispatch. */
import { failure, Latest, quiet } from "./runtime.ts";
import { checkBindings } from "./bindings.ts";
import { BAR_BUTTON_ICONS, BAR_BUTTON_LIMITS, MENU_IDS } from "../commands.ts";
import { ImageHandle } from "./ui.ts";
import { isTextValue, textProblem } from "../i18n.ts";
import type {
  CommandDeclaration,
  CommandState as WireState,
} from "../commands.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  Bindable,
  Command,
  CommandButton,
  CommandOptions,
  CommandState,
  Commands,
} from "./types.ts";

type Spec = { [K in keyof CommandState]: Bindable<CommandState[K]> };
const value = <T>(item: Bindable<T>): T =>
  typeof item === "function" ? (item as () => T)() : item;

/** Validate options and build the wire declaration. */
function declare(options: CommandOptions): CommandDeclaration {
  const path = options.path ?? [];
  const title = options.title ?? path.at(-1);
  if (!title)
    throw failure("invalid", `command ${options.id}: title or path required`);
  if (path.length > 8)
    throw failure("invalid", `command ${options.id}: path has 1–8 segments`);
  for (const segment of [title, ...path])
    if (typeof segment !== "string") {
      const problem = isTextValue(segment)
        ? "$vestraList" in segment
          ? "a menu text is a string or a text, not a list"
          : textProblem(segment)
        : "title and path segments are strings or texts";
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
  readonly #pump: Latest<CommandState>;
  readonly #binding;
  constructor(scope: ScopeImpl, options: CommandOptions) {
    const runtime = scope.runtime;
    if (runtime.commands.has(options.id))
      throw failure("conflict", `command ${options.id} is already declared`);
    this.id = options.id;
    this.#scope = scope;
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
    this.#pump = new Latest(async (state) => {
      const revision = ++this.#revision;
      if (revision === 1) {
        await previous;
        await runtime.host.commands.register(
          this.id,
          1,
          declaration,
          state as WireState,
        );
        this.#registered = true;
      } else
        await runtime.host.commands.update(
          this.id,
          revision,
          state as WireState,
        );
    });
    const initial = this.#state();
    this.#last = JSON.stringify(initial);
    this.ready = quiet(
      runtime
        .starting(this.#pump.push(initial), (error) => scope.report(error))
        .then(() => {}),
    );
    runtime.commands.set(this.id, () => {
      if (!this.#disposed) scope.run(options.run);
    });
    this.#binding = runtime.bind(() => this.#sync());
    scope.add(this);
  }
  #state(): CommandState {
    const reason = value(this.#spec.reason);
    if (reason !== null && typeof reason !== "string") {
      const problem = isTextValue(reason)
        ? textProblem(reason)
        : "reason is a string, a text or null";
      if (problem) throw failure("invalid", `command ${this.id}: ${problem}`);
    }
    return {
      enabled: value(this.#spec.enabled),
      checked: value(this.#spec.checked),
      busy: value(this.#spec.busy),
      reason,
    };
  }
  #sync() {
    if (this.#disposed) return;
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

export const commands = (scope: ScopeImpl): Commands => ({
  add: (options) => new CommandHandle(scope, options),
});
