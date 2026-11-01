// A command declaration the player refuses during activation (`invalid`,
// `conflict`, `limit`) is skipped in the player's runner: logged, reported
// to `onError`, the rest of the plugin activates (SDK 1.5.49). TestHost's
// `startPlugin` stays strict so a plugin's tests show the refusal.
import assert from "node:assert/strict";
import test, { mock } from "node:test";
import type { Plugin, PluginError } from "../src/index.ts";
import type { Json } from "../src/wire.ts";
import { createPlugin } from "../src/plugin/index.ts";
import {
  COMMAND_LIMITS,
  HostError,
  startPlugin,
  TestHost,
} from "../src/plugin/testing.ts";

const CONFLICT =
  "command conflict: menu path duplicates a command or collides with a leaf/group";
const LONG_REASON = `invalid command: reason requires 1..=${COMMAND_LIMITS.reasonBytes} bytes, no controls or surrounding whitespace`;

/** The player's runner path: `createPlugin` over a transport, not strict. */
async function runner(host: TestHost, capabilities: string[]) {
  host.manifestId = "test.runner";
  return createPlugin(
    host,
    { id: "test.runner", capabilities },
    process.cwd(),
    host.dataDirectory,
  );
}

test("a refused command declaration is skipped: the plugin activates, the others register, onError hears it, it is logged", async () => {
  const host = new TestHost();
  const logged: string[] = [];
  const log = mock.method(console, "error", (...args: unknown[]) => {
    logged.push(args.map(String).join(" "));
  });
  try {
    const instance = await runner(host, ["commands", "settings"]);
    const { plugin } = instance;
    const errors: PluginError[] = [];
    const before = plugin.commands.add({
      id: "before",
      path: ["Tools", "Before"],
      run() {},
    });
    // The player's own Audio ▸ Mute is a leaf: nesting under it conflicts.
    const nested = plugin.commands.add({
      id: "nested",
      path: ["Audio", "Mute", "Twice"],
      run() {},
    });
    const wordy = plugin.commands.add({
      id: "wordy",
      title: "Wordy",
      enabled: false,
      reason: "x".repeat(COMMAND_LIMITS.reasonBytes + 1),
      run() {},
    });
    const after = plugin.commands.add({
      id: "after",
      path: ["Tools", "After"],
      run() {},
    });
    // An onError added later in activate (after an await) still hears it.
    await Promise.resolve();
    plugin.onError((error) => errors.push(error));
    await instance.activated();

    assert.ok(host.commands.has("before"));
    assert.ok(host.commands.has("after"));
    assert.ok(!host.commands.has("nested"));
    assert.ok(!host.commands.has("wordy"));
    await before.ready;
    await after.ready;
    await assert.rejects(nested.ready, { code: "conflict", message: CONFLICT });
    await assert.rejects(wordy.ready, {
      code: "invalid",
      message: LONG_REASON,
    });

    assert.deepEqual(
      errors.map((error) => [error.code, error.message]),
      [
        ["conflict", CONFLICT],
        ["invalid", LONG_REASON],
      ],
    );
    assert.ok(
      logged.some(
        (line) =>
          line.includes("[test.runner] command nested skipped") &&
          line.includes(CONFLICT),
      ),
      logged.join("\n"),
    );
    assert.ok(
      logged.some(
        (line) =>
          line.includes("[test.runner] command wordy skipped") &&
          line.includes(LONG_REASON),
      ),
      logged.join("\n"),
    );

    // A refused command sends no updates: nothing more is reported.
    wordy.set({ reason: "Later" });
    nested.set({ enabled: false });
    await host.settle();
    assert.equal(errors.length, 2);
    assert.ok(!host.commands.has("wordy"));
    // The skipped id can be declared again once disposed.
    await nested.dispose();
    const again = plugin.commands.add({
      id: "nested",
      path: ["Tools", "Nested"],
      run() {},
    });
    await again.ready;
    assert.ok(host.commands.has("nested"));
    await instance.dispose();
  } finally {
    log.mock.restore();
    await host.settle();
    host.close();
  }
});

test("other start-up failures still fail activation in the runner", async () => {
  for (const code of ["host", "timeout"]) {
    const host = new TestHost();
    host.manifestId = "test.runner";
    // Not a refusal of the declaration: an error of the player, or no
    // definite answer.
    const transport = {
      request<T>(method: string, params?: Json): Promise<T> {
        if (method === "commands.register")
          return Promise.reject(new HostError(code, `${code} failure`));
        return host.request<T>(method, params);
      },
      on: (event: string, listener: (data: unknown) => void) =>
        host.on(event, listener),
    };
    const instance = await createPlugin(
      transport,
      { id: "test.runner", capabilities: ["commands"] },
      process.cwd(),
      host.dataDirectory,
    );
    instance.plugin.commands.add({ id: "a", title: "A", run() {} });
    await assert.rejects(instance.activated(), { code });
    await instance.dispose();
    host.close();
  }
});

test("a refusal after activation goes to onError as before", async () => {
  const host = new TestHost();
  const instance = await runner(host, ["commands"]);
  const errors: PluginError[] = [];
  instance.plugin.onError((error) => errors.push(error));
  await instance.activated();
  const late = instance.plugin.commands.add({
    id: "late",
    path: ["Audio", "Mute", "Twice"],
    run() {},
  });
  await assert.rejects(late.ready, { code: "conflict" });
  await host.settle();
  assert.deepEqual(
    errors.map((error) => error.code),
    ["conflict"],
  );
  await instance.dispose();
  host.close();
});

test("TestHost's startPlugin stays strict: a refused declaration fails it", async () => {
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({ id: "ok", path: ["Tools", "Ok"], run() {} });
        plugin.commands.add({
          id: "nested",
          path: ["Audio", "Mute", "Twice"],
          run() {},
        });
      },
      { capabilities: ["commands"] },
    ),
    (error: HostError) => {
      assert.equal(error.code, "conflict");
      assert.equal(error.message, CONFLICT);
      return true;
    },
  );
});
