/** Menu commands: declaration, state sync (revisions hidden) and dispatch. */
import { failure, Latest, quiet } from "./runtime.ts";
import { checkBindings } from "./bindings.ts";
import type {
  CommandDeclaration,
  LegacyCommandDeclaration,
} from "../commands.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  Bindable,
  Command,
  CommandOptions,
  CommandState,
  Commands,
} from "./types.ts";

type Spec = { [K in keyof CommandState]: Bindable<CommandState[K]> };
const value = <T>(item: Bindable<T>): T =>
  typeof item === "function" ? (item as () => T)() : item;

const fresh = [
  "order",
  "group",
  "radio",
  "bindings",
  "focus",
  "repeat",
] as const;

/** Validate options and build the wire declaration. */
function declare(
  options: CommandOptions,
): CommandDeclaration | LegacyCommandDeclaration {
  const path = options.path ?? [];
  const title = options.title ?? path.at(-1);
  if (!title)
    throw failure("invalid", `command ${options.id}: title or path required`);
  if (path.length > 8)
    throw failure("invalid", `command ${options.id}: path has 1–8 segments`);
  const order = options.order ?? 0;
  if (!Number.isInteger(order) || Math.abs(order) > 1_000_000)
    throw failure(
      "invalid",
      `command ${options.id}: order must be an integer within ±1000000`,
    );
  // Migration window (P1b–P3, removed in P4): a command that uses none of the
  // new fields keeps the old declaration shape, so unmigrated plugins and
  // their tests see no change.
  if (options.path && fresh.every((key) => options[key] === undefined))
    return { title, path, shortcut: options.shortcut ?? null };
  const bindings = [...(options.bindings ?? [])];
  if (options.shortcut !== undefined) bindings.push(options.shortcut);
  return {
    title,
    path,
    order,
    group: options.group ?? "domain",
    radio: options.radio ?? false,
    bindings: checkBindings(bindings),
    focus: options.focus ?? null,
    repeat: options.repeat ?? false,
  };
}

class CommandHandle implements Command {
  readonly id: string;
  readonly ready: Promise<void>;
  readonly #scope: ScopeImpl;
  readonly #spec: Spec;
  #revision = 0;
  #last = "";
  #disposed = false;
  readonly #pump: Latest<CommandState>;
  readonly #binding;
  constructor(scope: ScopeImpl, options: CommandOptions) {
    const runtime = scope.runtime;
    if (runtime.commands.has(options.id))
      throw new Error(`command ${options.id} is already declared`);
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
    this.#pump = new Latest(async (state) => {
      const revision = ++this.#revision;
      if (revision === 1)
        await runtime.host.commands.register(this.id, 1, declaration, state);
      else await runtime.host.commands.update(this.id, revision, state);
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
    return {
      enabled: value(this.#spec.enabled),
      checked: value(this.#spec.checked),
      busy: value(this.#spec.busy),
      reason: value(this.#spec.reason),
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
    this.#scope.runtime.commands.delete(this.id);
    await this.#binding.dispose();
    // The host has no unregister; a disposed command stays listed but disabled.
    await this.#pump
      .push({ enabled: false, checked: null, busy: false, reason: "已停用" })
      .catch(() => {});
    this.#pump.stop();
  }
}

export const commands = (scope: ScopeImpl): Commands => ({
  add: (options) => new CommandHandle(scope, options),
});
