// plugin.storage.session (SDK 1.5.25, player 0.5.5): values that outlive
// the plugin's process but not the player.
import assert from "node:assert/strict";
import test from "node:test";
import { SESSION_STORAGE_LIMITS, startPlugin } from "../src/plugin/testing.ts";
import type { PluginError } from "../src/plugin/index.ts";

const code = (expected: string) => (error: unknown) =>
  (error as PluginError).code === expected;

test("values round-trip as JSON, without a capability", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: [],
  });
  try {
    const session = plugin.storage.session;
    assert.equal(await session.get("missing"), undefined);
    assert.deepEqual(await session.keys(), []);
    await session.set("null", null);
    assert.equal(await session.get("null"), null);
    const when = new Date(0);
    await session.set("queue", {
      items: ["a.mkv", "b.mkv"],
      when,
      skipped: undefined,
      ratio: Number.NaN,
    });
    // What JSON.stringify writes: the Date as a string, NaN as null.
    assert.deepEqual(await session.get("queue"), {
      items: ["a.mkv", "b.mkv"],
      when: when.toJSON(),
      ratio: null,
    });
    await session.set("https://example.com/a?b", 1);
    assert.deepEqual(await session.keys(), [
      "https://example.com/a?b",
      "null",
      "queue",
    ]);
    await session.delete("null");
    await session.delete("null");
    assert.deepEqual([...host.sessionStorage.keys()].sort(), [
      "https://example.com/a?b",
      "queue",
    ]);
    // A value changed after set is not changed in the store.
    const list = ["x"];
    await session.set("list", list);
    list.push("y");
    assert.deepEqual(await session.get("list"), ["x"]);
  } finally {
    await stop();
  }
});

test("bad keys and values that are not JSON are invalid", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: [],
  });
  try {
    const session = plugin.storage.session;
    const long = "k".repeat(SESSION_STORAGE_LIMITS.keyBytes + 1);
    for (const key of ["", "a\0b", long, 7 as unknown as string]) {
      await assert.rejects(session.get(key), code("invalid"));
      await assert.rejects(session.set(key, 1), code("invalid"));
      await assert.rejects(session.delete(key), code("invalid"));
    }
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [undefined, () => 1, cycle, 1n])
      await assert.rejects(session.set("k", value), code("invalid"));
    assert.equal(host.sessionStorage.size, 0);
    // Multi-byte keys count bytes.
    await session.set("é".repeat(SESSION_STORAGE_LIMITS.keyBytes / 2), 1);
    await assert.rejects(
      session.set("é".repeat(SESSION_STORAGE_LIMITS.keyBytes / 2 + 1), 1),
      code("invalid"),
    );
  } finally {
    await stop();
  }
});

test("the quota counts keys and compact JSON; a refused set changes nothing", async () => {
  const { plugin, stop } = await startPlugin(() => {}, { capabilities: [] });
  try {
    const session = plugin.storage.session;
    // "k" + "\"…\"": 1 + 2 + n bytes.
    const fill = "x".repeat(SESSION_STORAGE_LIMITS.bytes - 3);
    await session.set("k", fill);
    await assert.rejects(session.set("j", 0), code("limit"));
    assert.deepEqual(await session.keys(), ["k"]);
    // Replacing counts the new value instead of the old one.
    await assert.rejects(session.set("k", `${fill}x`), code("limit"));
    assert.equal(((await session.get("k")) as string).length, fill.length);
    await session.delete("k");
    await session.set("j", 0);
  } finally {
    await stop();
  }
});

test("values survive a restart within the session and not a new session", async () => {
  const activate = () => {};
  const first = await startPlugin(activate, { capabilities: [] });
  await first.plugin.storage.session.set("queue", ["a.mkv"]);
  const kept = first.host.sessionStorage;
  await first.stop();

  const second = await startPlugin(activate, {
    capabilities: [],
    sessionStorage: kept,
  });
  assert.deepEqual(await second.plugin.storage.session.get("queue"), ["a.mkv"]);
  await second.stop();

  const fresh = await startPlugin(activate, { capabilities: [] });
  assert.equal(await fresh.plugin.storage.session.get("queue"), undefined);
  await fresh.stop();
});
