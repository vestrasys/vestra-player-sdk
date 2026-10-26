/**
 * The real local services: child processes of the plugin process itself.
 * No shell is involved; arguments go to the executable as they are.
 *
 * This is the SDK's one platform file (community workflow §1.5): what
 * differs between systems on the Node side stays here. Showing and opening
 * files and links is the player's (`system.*` requests), not this file's.
 */
import { spawn } from "node:child_process";
import { access, constants, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import type { LocalServices } from "../wire.ts";
import { failure } from "./runtime.ts";
import { abortError } from "./player.ts";

/** SIGTERM first, SIGKILL if the process is still there after this long. */
const KILL_AFTER_MS = 300;

const lastLine = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) ?? "";

/**
 * The file names a tool can have: `ffmpeg` on macOS and Linux; on Windows
 * `ffmpeg` with each `PATHEXT` extension (`ffmpeg.exe` first by default).
 */
export function executableNames(
  tool: string,
  platform: NodeJS.Platform = process.platform,
  pathext = process.env.PATHEXT,
): string[] {
  if (platform !== "win32") return [tool];
  const extensions = (pathext || ".EXE;.CMD;.BAT;.COM")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.startsWith("."));
  return [...new Set(extensions)].map((extension) => tool + extension);
}

/**
 * Where a local stream listens: a Unix socket file `<name>.sock` in
 * `directory` on macOS and Linux; on Windows a named pipe
 * (`\\.\pipe\<directory's name>-<name>`), which Node's `net` listens on and
 * connects to by that path (a socket file there fails with `EACCES`).
 */
export function localSocketPath(
  directory: string,
  name: string,
  platform: NodeJS.Platform = process.platform,
): string {
  if (platform !== "win32") return join(directory, `${name}.sock`);
  const scope = directory.split(/[\\/]/).filter(Boolean).at(-1) ?? "vestra";
  return `\\\\.\\pipe\\${scope}-${name}`;
}

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
    // windowsHide: no console window for the tool on Windows, whatever
    // started the plugin (the player starts it without one).
    const child = spawn(path, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
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
      for (const name of executableNames(tool)) {
        const candidate = join(directory, name);
        if (await executable(candidate)) return candidate;
      }
    }
    return null;
  },
};
