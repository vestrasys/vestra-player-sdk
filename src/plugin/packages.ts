/** Package validation, trial loading and install/rollback (`plugins.manage`). */
import { randomUUID } from "node:crypto";
import type {
  PackageOperation,
  PackageTrial as TrialRecord,
} from "../index.ts";
import { failure, sleep, uncertain } from "./runtime.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  PackageChange,
  PackageChangeStatus,
  PackageTrial,
  Packages,
} from "./types.ts";

const TERMINAL: PackageChangeStatus[] = [
  "committed",
  "cancelled",
  "failed",
  "failedDegraded",
  "tooLate",
];
const STARTING = ["preparing", "activating", "starting"];

class TrialHandle implements PackageTrial {
  readonly #scope: ScopeImpl;
  #record: TrialRecord;
  #stopped: Promise<void> | undefined;
  constructor(scope: ScopeImpl, record: TrialRecord) {
    this.#scope = scope;
    this.#record = record;
    scope.add(this);
  }
  get status() {
    return this.#record.status;
  }
  stop() {
    const host = this.#scope.runtime.host.packages;
    this.#stopped ??= (async () => {
      this.#record = await host.stopTrial(this.#record.trialId);
      while (
        !this.#record.cleanupConfirmed &&
        this.#record.status !== "stopped" &&
        this.#record.status !== "failed"
      ) {
        await sleep(250);
        this.#record = await host.trialState(this.#record.trialId);
      }
      if (!this.#record.cleanupConfirmed)
        throw failure(
          "cleanup",
          `trial cleanup not confirmed: ${this.#record.status}`,
        );
    })();
    return this.#stopped;
  }
  async dispose() {
    this.#scope.forget(this);
    await this.stop().catch(() => {});
  }
}

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

/** Install and rollback reuse the request id as the operation id after a lost reply. */
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

async function trial(scope: ScopeImpl, runtime: Runtime, token: string) {
  const host = runtime.host.packages;
  const requestId = randomUUID();
  let record: TrialRecord;
  try {
    record = await host.trial(token, requestId);
  } catch (error) {
    if (!uncertain(error)) throw error;
    record = await host.trialStateByRequest(requestId);
  }
  while (STARTING.includes(record.status)) {
    await sleep(250);
    record = await host.trialState(record.trialId);
  }
  return new TrialHandle(scope, record);
}

export const packages = (scope: ScopeImpl): Packages => ({
  async validate(directory) {
    const runtime = scope.runtime;
    const checked = await runtime.host.packages.validate(directory);
    return {
      directory,
      digest: checked.digest,
      manifest: checked.manifest,
      checks: checked.checks,
      trial: () => trial(scope, runtime, checked.token),
      install: () =>
        change(
          scope,
          (requestId, revision) =>
            runtime.host.packages.install(checked.token, revision, requestId),
          checked.manifest.id,
        ),
    };
  },
  rollback: (id) =>
    change(
      scope,
      (requestId, revision) =>
        scope.runtime.host.packages.rollback(id, revision, requestId),
      id,
    ),
});
