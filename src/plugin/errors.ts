/**
 * Error helpers shared by every part of the SDK (L1, refactor plan §2.2):
 * no state, no update passes. They lived in `runtime.ts` (`abortError` in
 * `player.ts`), so a module that needed one imported the pass scheduler
 * with it, and `stream.ts` and `player.ts` imported each other.
 */
import { HostError } from "../wire.ts";
import type { PluginError } from "./types.ts";

export const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export function toError(error: unknown): PluginError {
  if (error instanceof Error) {
    const coded = error as PluginError;
    if (typeof coded.code !== "string")
      Object.defineProperty(coded, "code", {
        value: error.name === "AbortError" ? "aborted" : "error",
        enumerable: false,
        writable: true,
      });
    return coded;
  }
  return new HostError("error", String(error));
}

export const failure = (code: string, message: string = code): PluginError =>
  new HostError(code, message);

/**
 * Host replies are definite; anything else (lost reply, client timeout) is
 * not. An abort is definite too: the SDK's request queue rejects a waiting
 * request with it, unsent (`request-queue.ts`).
 */
export const uncertain = (error: unknown) =>
  error instanceof HostError
    ? error.code === "timeout"
    : !(error instanceof Error && error.name === "AbortError");

/** Mark a promise as observed so an unused `ready` never crashes the runner. */
export function quiet<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => {});
  return promise;
}

export function abortError(): PluginError {
  const error = new Error("aborted") as PluginError;
  error.name = "AbortError";
  error.code = "aborted";
  return error;
}
