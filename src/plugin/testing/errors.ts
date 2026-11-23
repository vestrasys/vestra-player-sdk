/**
 * Host errors the plugin logged (SDK 1.12.0): a refusal or failure with a
 * code (`HostError`, e.g. `stale`, `invalid`, `disabled`) that nothing in
 * the plugin handled, so it reached the plugin's log, as the player's log
 * would show it. Under `TestHost.strictErrors` (the default) such an error
 * fails the test at the next `settle()` (also `command(…).run()`) or at
 * `stop()`, unless the test expected it with `expectError(code)`.
 *
 * Part of `TestHost` (`./index.ts`). Internal to the SDK; not exported from
 * `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import type { TestHost } from "./index.ts";

/** One host's book of logged errors and expectations. */
export class ErrorBook {
  /** Every host error the plugin logged, expected or not, in order. */
  readonly logged: HostError[] = [];
  /** Logged errors no expectation covered, not yet thrown. */
  readonly unexpected: HostError[] = [];
  /** Codes the test expects, one entry per expected error. */
  readonly expected: string[] = [];
  /** Above 0 while `startPlugin` itself settles (activation, `stop`, `park`). */
  suspended = 0;
}

/** The book of each host (`TestHost` makes it in its constructor). */
export const errorBooks = new WeakMap<TestHost, ErrorBook>();

/**
 * The runtime's `logged` hook (`Connection.logged`): note an error that
 * reached the plugin's log. Errors without a code of the host's kind (a
 * `TypeError` in the plugin's code) are not counted.
 */
export function noteLogged(host: TestHost, error: unknown) {
  const book = errorBooks.get(host);
  if (!book || !(error instanceof HostError)) return;
  book.logged.push(error);
  const index = book.expected.indexOf(error.code);
  if (index >= 0) book.expected.splice(index, 1);
  else book.unexpected.push(error);
}

/** Why a host error fails a test, and how to expect it instead. */
function unexpectedMessage(host: TestHost, errors: readonly HostError[]) {
  const lines = errors.map((error) => `  ${error.code}: ${error.message}`);
  const code = errors[0]!.code;
  return [
    `${host.manifestId} logged ${errors.length === 1 ? "a host error" : `${errors.length} host errors`} the test did not expect:`,
    ...lines,
    `Nothing in the plugin handled ${errors.length === 1 ? "it" : "them"} (the player's log shows the same). If the test means it, call`,
    `host.expectError(${JSON.stringify(code)}) before the step that causes it; host.strictErrors = false only logs host errors.`,
  ].join("\n");
}

/**
 * Throw the unexpected host errors logged since the last check, once
 * (they are cleared), when the host is strict.
 */
export function checkErrors(host: TestHost) {
  const book = errorBooks.get(host);
  if (!book || book.suspended > 0 || !book.unexpected.length) return;
  const errors = book.unexpected.splice(0);
  if (!host.strictErrors) return;
  const error = new Error(unexpectedMessage(host, errors));
  (error as Error & { cause?: unknown }).cause = errors[0];
  throw error;
}

/** At `stop()`: the unexpected errors, then the expected ones that never came. */
export function checkErrorsAtStop(host: TestHost) {
  checkErrors(host);
  const book = errorBooks.get(host);
  if (!book || !book.expected.length) return;
  const missing = book.expected.splice(0);
  if (!host.strictErrors) return;
  throw new Error(
    `${host.manifestId}: the test expected ${missing.map((code) => `\`${code}\``).join(", ")} (host.expectError), but the plugin never logged ${missing.length === 1 ? "it" : "them"}`,
  );
}
