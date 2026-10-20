/**
 * The real local services: child processes of the plugin process itself.
 * No shell is involved; arguments go to the executable as they are.
 */
import { spawn } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import type { LocalServices } from "../wire.ts";
import { failure } from "./runtime.ts";
import { abortError } from "./player.ts";

/** SIGTERM first, SIGKILL if the process is still there after this long. */
const KILL_AFTER_MS = 300;
const OPEN_TIMEOUT_MS = 10_000;

const lastLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";

async function executable(path: string) {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

/** Run to completion, collecting at most `maxOutput` bytes of stdout. */
function run(
  path: string,
  args: string[],
  options: { timeoutMs: number; maxOutput: number; signal: AbortSignal },
): Promise<{ stdout: Uint8Array; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (options.signal.aborted) return reject(abortError());
    const child = spawn(path, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let size = 0;
    let errSize = 0;
    let ended: Error | undefined;
    let killer: NodeJS.Timeout | undefined;
    const stop = (reason: Error) => {
      if (ended) return;
      ended = reason;
      child.kill("SIGTERM");
      killer = setTimeout(() => child.kill("SIGKILL"), KILL_AFTER_MS);
      killer.unref?.();
    };
    const timer = setTimeout(
      () =>
        stop(
          failure("timeout", `${path} ran longer than ${options.timeoutMs} ms`),
        ),
      options.timeoutMs,
    );
    const abort = () => stop(abortError());
    options.signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > options.maxOutput)
        stop(failure("invalid", `output exceeds ${options.maxOutput} bytes`));
      else out.push(chunk);
    });
    // Keep the tail of stderr only; tools can be chatty.
    child.stderr.on("data", (chunk: Buffer) => {
      err.push(chunk);
      errSize += chunk.length;
      while (errSize > 64 * 1024 && err.length > 1)
        errSize -= err.shift()!.length;
    });
    const finish = (error?: Error) => {
      clearTimeout(timer);
      options.signal.removeEventListener("abort", abort);
      if (error) reject(error);
    };
    child.on("error", (error) =>
      finish(failure("unavailable", `${path}: ${error.message}`)),
    );
    child.on("close", (code, signal) => {
      clearTimeout(killer);
      const stderr = Buffer.concat(err).toString("utf8");
      if (ended) return finish(ended);
      if (code !== 0)
        return finish(
          failure(
            "failed",
            lastLine(stderr) || `${path} exited with ${code ?? signal}`,
          ),
        );
      finish();
      resolve({ stdout: new Uint8Array(Buffer.concat(out)), stderr });
    });
  });
}

export const systemServices: LocalServices = {
  run,
  async locate(tool) {
    const override =
      process.env[tool === "ffmpeg" ? "VESTRA_FFMPEG" : "VESTRA_FFPROBE"];
    if (override)
      return isAbsolute(override) && (await executable(override))
        ? override
        : null;
    for (const directory of (process.env.PATH ?? "").split(delimiter)) {
      if (!directory) continue;
      const candidate = join(directory, tool);
      if (await executable(candidate)) return candidate;
    }
    return null;
  },
  async open(paths, reveal) {
    await run("/usr/bin/open", reveal ? ["-R", ...paths] : paths, {
      timeoutMs: OPEN_TIMEOUT_MS,
      maxOutput: 64 * 1024,
      signal: new AbortController().signal,
    });
  },
  async openUrl(url) {
    await run("/usr/bin/open", [url], {
      timeoutMs: OPEN_TIMEOUT_MS,
      maxOutput: 64 * 1024,
      signal: new AbortController().signal,
    });
  },
};
