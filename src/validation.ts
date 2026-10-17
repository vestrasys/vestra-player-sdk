// 实验边界校验；与最终产品契约可能相差很大。
import type { PlaybackState } from "./types.ts";
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("expected object");
  return value as Record<string, unknown>;
}
export function assertSerializable(
  value: unknown,
  seen = new Set<object>(),
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("non-finite JSON number");
    return;
  }
  if (typeof value !== "object")
    throw new Error(`non-JSON value: ${typeof value}`);
  if (seen.has(value)) throw new Error("cyclic JSON value");
  seen.add(value);
  for (const item of Object.values(value)) assertSerializable(item, seen);
  seen.delete(value);
}
export function playbackState(value: unknown): PlaybackState {
  const state = record(value);
  if (state.path !== null && typeof state.path !== "string")
    throw new Error("invalid playback path");
  if (
    typeof state.paused !== "boolean" ||
    typeof state.gaussianEnabled !== "boolean"
  )
    throw new Error("invalid playback booleans");
  for (const key of ["position", "sigma"])
    if (typeof state[key] !== "number" || !Number.isFinite(state[key]))
      throw new Error(`invalid ${key}`);
  if (
    state.duration !== null &&
    (typeof state.duration !== "number" || !Number.isFinite(state.duration))
  )
    throw new Error("invalid duration");
  if (state.sessionId !== undefined && typeof state.sessionId !== "string")
    throw new Error("invalid session");
  if (
    state.sourceKind !== undefined &&
    !["file", "external", "none"].includes(String(state.sourceKind))
  )
    throw new Error("invalid source kind");
  return {
    path: state.path,
    paused: state.paused,
    position: Number(state.position),
    duration: state.duration === null ? null : Number(state.duration),
    gaussianEnabled: state.gaussianEnabled,
    sigma: Number(state.sigma),
    ...(typeof state.sessionId === "string"
      ? { sessionId: state.sessionId }
      : {}),
    ...(state.sourceKind === "file" ||
    state.sourceKind === "external" ||
    state.sourceKind === "none"
      ? { sourceKind: state.sourceKind }
      : {}),
  };
}
