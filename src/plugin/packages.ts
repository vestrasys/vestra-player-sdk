/** Package validation, install and uninstall (`plugins.manage`). */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import type {
  PackageInfo as WirePlugin,
  PackageOperation,
  PackageValidation,
  WireSource,
} from "../wire.ts";
import { failure, sleep, uncertain } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  InstallOptions,
  PackageCandidate,
  PackageChange,
  PackageChangeStatus,
  PackageManifest,
  Packages,
  PluginInfo,
} from "./types.ts";

const TERMINAL: PackageChangeStatus[] = [
  "committed",
  "cancelled",
  "failed",
  "failedDegraded",
  "tooLate",
];

class ChangeHandle implements PackageChange {
  readonly #scope: ScopeImpl;
  readonly #id: string;
  #operation: PackageOperation;
  readonly #listeners = new Set<(status: PackageChangeStatus) => void>();
  readonly done: Promise<PackageChangeStatus>;
  constructor(scope: ScopeImpl, operation: PackageOperation) {
    this.#scope = scope;
    this.#id = operation.operationId;
    this.#operation = operation;
    this.done = this.#poll();
    this.done.catch(() => {});
  }
  get status() {
    return this.#operation.status;
  }
  get message() {
    return this.#operation.message ?? null;
  }
  onChange(listener: (status: PackageChangeStatus) => void) {
    this.#listeners.add(listener);
    return this.#scope.onDispose(() => {
      this.#listeners.delete(listener);
    });
  }
  #accept(operation: PackageOperation) {
    const changed = operation.status !== this.#operation.status;
    this.#operation = operation;
    if (!changed) return;
    for (const listener of this.#listeners)
      this.#scope.run(listener, operation.status);
    this.#scope.update();
  }
  async #poll() {
    const host = this.#scope.runtime.host.packages;
    while (!TERMINAL.includes(this.#operation.status)) {
      await sleep(400);
      try {
        this.#accept(await host.operation(this.#id));
      } catch (error) {
        // Keep asking about the same id; never resubmit an install.
        if (!uncertain(error)) throw error;
      }
    }
    return this.#operation.status;
  }
  async cancel() {
    this.#accept(await this.#scope.runtime.host.packages.cancel(this.#id));
  }
}

/** Install and uninstall reuse the request id as the operation id after a lost reply. */
async function change(
  scope: ScopeImpl,
  submit: (
    requestId: string,
    expectedRevision: number,
  ) => Promise<PackageOperation>,
  id: string,
) {
  const host = scope.runtime.host.packages;
  const installed = await host.installed(id);
  const requestId = randomUUID();
  let operation: PackageOperation;
  try {
    operation = await submit(requestId, installed.revision);
  } catch (error) {
    if (!uncertain(error)) throw error;
    operation = { operationId: requestId, status: "preparing" };
  }
  return new ChangeHandle(scope, operation);
}

function installOptions(options: InstallOptions | undefined) {
  if (options === undefined) return {};
  if (typeof options !== "object" || options === null)
    throw failure("invalid", "install options must be an object");
  const { source, replace } = options;
  if (replace !== undefined && typeof replace !== "boolean")
    throw failure("invalid", "replace must be a boolean");
  if (source !== undefined) {
    const kinds = ["repository", "link", "file", "workshop"];
    if (
      typeof source !== "object" ||
      source === null ||
      !kinds.includes(source.kind)
    )
      throw failure(
        "invalid",
        "source.kind must be repository, link, file or workshop",
      );
    if (
      (source.kind === "repository" || source.kind === "link") &&
      !/^https?:\/\//i.test(String(source.url))
    )
      throw failure("invalid", "source.url must be an http(s) address");
  }
  return {
    ...(source === undefined ? {} : { source: { ...source } as WireSource }),
    ...(replace ? { replace: true } : {}),
  };
}

function candidate(
  scope: ScopeImpl,
  directory: string,
  checked: PackageValidation,
): PackageCandidate {
  const runtime = scope.runtime;
  return {
    directory,
    digest: checked.digest,
    manifest: checked.manifest as unknown as PackageManifest,
    checks: checked.checks,
    install: async (options) => {
      const wire = installOptions(options);
      return change(
        scope,
        (requestId, revision) =>
          runtime.host.packages.install(
            checked.token,
            revision,
            requestId,
            wire,
          ),
        checked.manifest.id,
      );
    },
  };
}

export const packages = (scope: ScopeImpl): Packages => ({
  async validate(directory) {
    const checked = await scope.runtime.host.packages.validate(directory);
    return candidate(scope, directory, checked);
  },
  async validateArchive(file) {
    if (typeof file !== "string" || !file)
      throw failure("invalid", "validateArchive needs a .vxp file path");
    const path = resolve(file);
    const checked = await scope.runtime.host.packages.validateArchive(path);
    return candidate(scope, path, checked);
  },
  list: async () => (await scope.runtime.host.packages.list()).map(info),
  onChange(listener) {
    const watch = scope.runtime.on(
      "packages.changed",
      (data) => scope.run(listener, (data as WirePlugin[]).map(info)),
      null,
    );
    return scope.add({
      dispose: async () => {
        scope.forget(watch);
        await watch.dispose();
      },
    });
  },
  async setEnabled(id, enabled) {
    if (typeof id !== "string" || !id || typeof enabled !== "boolean")
      throw failure("invalid", "setEnabled takes an id and a boolean");
    await scope.runtime.host.packages.setEnabled(id, enabled);
  },
  uninstall: (id, options = {}) =>
    change(
      scope,
      (requestId, revision) =>
        scope.runtime.host.packages.uninstall(
          id,
          options.removeData === true,
          revision,
          requestId,
        ),
      id,
    ),
});

const info = (plugin: WirePlugin): PluginInfo =>
  Object.freeze({
    id: plugin.id,
    version: plugin.version,
    origin: plugin.origin,
    state: plugin.state,
    error: plugin.error,
    capabilities: [...plugin.capabilities],
    directory: plugin.directory,
    builtin: plugin.builtin === true,
    source: plugin.source ? Object.freeze({ ...plugin.source }) : null,
    dataDirectory: plugin.dataDirectory ?? null,
    warnings: Object.freeze(
      (plugin.warnings ?? []).map((warning) =>
        Object.freeze({
          code: warning.code,
          ...(warning.slot === undefined ? {} : { slot: warning.slot }),
          ...(warning.owner === undefined ? {} : { owner: warning.owner }),
        }),
      ),
    ),
    ...(plugin.display
      ? {
          display: Object.freeze({
            name: plugin.display.name ?? null,
            punchline: plugin.display.punchline ?? null,
            description: plugin.display.description ?? null,
            tags: Object.freeze([...(plugin.display.tags ?? [])]),
          }),
        }
      : {}),
  });
