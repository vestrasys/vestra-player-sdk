import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs, { existsSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import { TestHost } from "../src/plugin/testing.ts";
import { startPlugin } from "./explicit.ts";

/** Runs `body` with `console.warn` captured. */
async function warnings(body: () => unknown) {
  const said: string[] = [];
  const warn = console.warn;
  console.warn = (...args: unknown[]) => said.push(args.join(" "));
  try {
    await body();
  } finally {
    console.warn = warn;
  }
  return said;
}

test("close() retries the removal and never fails a test for a leftover temporary directory", async () => {
  const host = new TestHost();
  const { stop } = await startPlugin(() => {}, { host });
  const scratch = dirname(host.dataDirectory);
  const real = fs.rmSync;
  const calls: unknown[] = [];
  // What Windows CI saw: a handle still closing in the directory.
  fs.rmSync = ((path: string, options: unknown) => {
    calls.push(options);
    throw Object.assign(
      new Error(`ENOTEMPTY, Directory not empty: '${path}'`),
      {
        code: "ENOTEMPTY",
      },
    );
  }) as typeof fs.rmSync;
  syncBuiltinESMExports();
  let said: string[];
  try {
    said = await warnings(() => stop());
  } finally {
    fs.rmSync = real;
    syncBuiltinESMExports();
  }
  assert.deepEqual(calls, [
    { recursive: true, force: true, maxRetries: 5, retryDelay: 100 },
  ]);
  assert.equal(said.length, 1);
  assert.match(said[0]!, /TestHost: left .*vestra-test-host-.*\(ENOTEMPTY\)/);
  assert.ok(existsSync(scratch));
  rmSync(scratch, { recursive: true, force: true });
});

test(
  "close() with a file another process holds open (Windows): no throw, the directory is left",
  {
    skip:
      process.platform !== "win32" &&
      "a held file blocks removal on Windows only",
  },
  async () => {
    const host = new TestHost();
    const scratch = dirname(host.dataDirectory);
    const file = join(scratch, "held.bin");
    writeFileSync(file, "x");
    // A handle without FILE_SHARE_DELETE (Node always shares delete, so
    // another process opens it), held until stdin closes.
    const holder = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `$f = [IO.File]::Open('${file}', 'Open', 'Read', 'None'); 'held'; [Console]::In.ReadToEnd() | Out-Null; $f.Close()`,
      ],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        holder.stdout.on("data", (data: Buffer) => {
          if (data.toString().includes("held")) resolve();
        });
        holder.on("exit", (code) => reject(new Error(`holder exited ${code}`)));
      });
      const said = await warnings(() => host.close());
      assert.equal(said.length, 1);
      assert.match(said[0]!, /TestHost: left .*\((EBUSY|EPERM|ENOTEMPTY)\)/);
      assert.ok(existsSync(file));
    } finally {
      holder.stdin.end();
      if (holder.exitCode === null)
        await new Promise((resolve) => holder.on("exit", resolve));
      rmSync(scratch, { recursive: true, force: true, maxRetries: 5 });
    }
  },
);
