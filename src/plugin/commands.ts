/** Menu commands: declaration, state sync (revisions hidden) and dispatch. */
import { Latest, quiet } from "./runtime.ts";
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
    const declaration = {
      title: options.title ?? options.path.at(-1) ?? options.id,
      path: options.path,
      shortcut: options.shortcut ?? null,
    };
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
