/**
 * `plugin.state(initial)` (L2, the framework; refactor plan §3.5): plugin-owned
 * state the update passes follow like the SDK's own state copies. A read of a
 * field inside what a pass evaluates records `(store, field)` through
 * `Runtime.depends`, the mechanism `plugin.player.state` uses; a write of a
 * field that changes it (`Object.is`) reports
 * `Runtime.changed(store, [field])`, so the next pass is a precise one that
 * evaluates only that field's readers. One level: the value of a field is
 * compared by identity, nothing inside it is tracked. It belongs to the calling
 * scope: once that scope is disposed the object is a plain one, read and
 * written without tracking.
 */
import { failure } from "./errors.ts";
import type { ScopeImpl } from "./scope.ts";

/** Each store's key in the passes' field tracking (`state:1`, `state:2`…). */
let stores = 0;

/** A plain object: its prototype is `Object.prototype` or `null`. */
function plain(value: unknown): value is Record<PropertyKey, unknown> {
  if (value === null || typeof value !== "object") return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** `Scope.state`: a tracked copy of `initial`'s own fields. */
export function trackedState<T extends object>(
  scope: ScopeImpl,
  initial: T,
): T {
  if (!plain(initial))
    throw failure(
      "invalid",
      "state takes a plain object of fields and their first values",
    );
  const runtime = scope.runtime;
  const key = `state:${++stores}`;
  const target: Record<PropertyKey, unknown> = { ...initial };
  const live = () => !scope.disposed;
  const depends = (field?: string) => {
    if (live()) runtime.depends(key, field);
  };
  const changed = (field: string) => {
    if (live()) runtime.changed(key, [field]);
  };
  return new Proxy(target, {
    get(store, field, receiver) {
      if (typeof field === "string") depends(field);
      return Reflect.get(store, field, receiver) as unknown;
    },
    has(store, field) {
      if (typeof field === "string") depends(field);
      return Reflect.has(store, field);
    },
    ownKeys(store) {
      // The list of fields: any change of the store counts.
      depends();
      return Reflect.ownKeys(store);
    },
    set(store, field, value) {
      const had = Object.hasOwn(store, field);
      const before = store[field];
      store[field] = value;
      if (typeof field === "string" && (!had || !Object.is(before, value)))
        changed(field);
      return true;
    },
    deleteProperty(store, field) {
      const had = Object.hasOwn(store, field);
      delete store[field];
      if (typeof field === "string" && had) changed(field);
      return true;
    },
    defineProperty(store, field, descriptor) {
      const had = Object.hasOwn(store, field);
      const before = store[field];
      const done = Reflect.defineProperty(store, field, descriptor);
      if (
        done &&
        typeof field === "string" &&
        (!had || !Object.is(before, store[field]))
      )
        changed(field);
      return done;
    },
  }) as T;
}
