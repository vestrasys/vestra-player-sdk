/** Menu commands: declaration, state sync (revisions hidden) and dispatch. */
import { failure, Latest, quiet } from "./runtime.ts";
import { checkBindings } from "./bindings.ts";
import type { CommandDeclaration } from "../commands.ts";
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

/** Validate options and build the wire declaration. */
function declare(options: CommandOptions): CommandDeclaration {
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
  const bindings = [...(options.bindings ?? [])];
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
    const previous = removing(runtime).get(this.id);
    this.#pump = new Latest(async (state) => {
      const revision = ++this.#revision;
      if (revision === 1) {
        await previous;
        await runtime.host.commands.register(this.id, 1, declaration, state);
        this.#registered = true;
      } else await runtime.host.commands.update(this.id, revision, state);
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
