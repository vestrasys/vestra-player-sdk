// TestHost refuses a command declaration the way the player does
// (host/src/commands.rs `Registry::register`, capabilities/commands.rs):
// the same checks, codes and messages, so a plugin's tests fail where the
// player would refuse its menu.
import assert from "node:assert/strict";
import test from "node:test";
import type { CommandOptions, Plugin } from "../src/index.ts";
import {
  COMMAND_LIMITS,
  HostError,
  startPlugin,
} from "../src/plugin/testing.ts";

const TEXT = "requires 1..=%d bytes, no controls or surrounding whitespace";
const rule = (label: string, limit: number) =>
  `invalid command: ${label} ${TEXT.replace("%d", String(limit))}`;

/** Activation with this command fails with `code` and `message`. */
async function refused(
  options: Omit<CommandOptions, "run">,
  code: string,
  message: string,
) {
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({ ...options, run() {} });
      },
      { capabilities: ["commands"] },
    ),
    (error: HostError) => {
      assert.equal(error.code, code, JSON.stringify(options));
      assert.equal(error.message, message, JSON.stringify(options));
      return true;
    },
  );
}

async function accepted(options: Omit<CommandOptions, "run">) {
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({ ...options, run() {} });
    },
    { capabilities: ["commands"] },
  );
  try {
    assert.ok(host.commands.has(options.id));
  } finally {
    await stop();
  }
}

test("path segments: 1–80 bytes, no controls, no surrounding whitespace", async () => {
  const segment = rule("path segment", COMMAND_LIMITS.segmentBytes);
  // A bad leaf is checked as the title first (the title defaults to it).
  const bad = (text: string) => ({
    id: "a",
    path: ["Tools", text],
    title: "A",
  });
  await refused(bad(""), "invalid", segment);
  await refused(bad("x".repeat(81)), "invalid", segment);
  // 27 three-byte characters: 81 bytes.
  await refused(bad("视".repeat(27)), "invalid", segment);
  await refused(bad(" Tools"), "invalid", segment);
  // Unicode White_Space, as Rust's trim: a no-break and an ideographic space.
  await refused(bad(`Tools${String.fromCharCode(0xa0)}`), "invalid", segment);
  await refused(bad(`${String.fromCharCode(0x3000)}Tools`), "invalid", segment);
  // Controls anywhere: C0, DEL and C1.
  await refused(bad("A\tB"), "invalid", segment);
  await refused(bad("A\u007fB"), "invalid", segment);
  await refused(bad("A\u0085B"), "invalid", segment);
  await refused(
    { id: "a", path: ["Tools", "A\tB"] },
    "invalid",
    rule("title", COMMAND_LIMITS.titleBytes),
  );
  await accepted({ id: "a", path: ["Tools", "x".repeat(80)] });
  await accepted({ id: "a", path: ["Tools", "视".repeat(26)] });
  // Not White_Space in Rust: U+FEFF at an end is kept (JavaScript's trim
  // would remove it).
  await accepted({
    id: "a",
    path: ["Tools", `A${String.fromCharCode(0xfeff)}`],
  });
});

test("a text value segment is checked on its English rendering", async () => {
  const segment = rule("path segment", COMMAND_LIMITS.segmentBytes);
  const text = (source: string, args: unknown[]) =>
    ({ $vestraText: source, args }) as never;
  await refused(
    { id: "a", path: [text("Track {}", ["2".repeat(80)]), "A"] },
    "invalid",
    segment,
  );
  await refused(
    { id: "a", path: [text("{}", [" padded"]), "A"] },
    "invalid",
    segment,
  );
  await accepted({ id: "a", path: ["Tools", text("Track {}", [2])] });
});

test("title, group, depth and order follow the player's limits", async () => {
  await refused(
    { id: "a", title: "x".repeat(129) },
    "invalid",
    rule("title", COMMAND_LIMITS.titleBytes),
  );
  await refused(
    { id: "a", title: "A", group: " tools" },
    "invalid",
    rule("group", COMMAND_LIMITS.groupBytes),
  );
  await refused(
    { id: "a", title: "A", group: "" },
    "invalid",
    rule("group", COMMAND_LIMITS.groupBytes),
  );
  await accepted({ id: "a", title: "x".repeat(128), group: "g".repeat(80) });
});

test("local ids: 1–128 bytes of ASCII letters, digits, '.', '_' and '-'", async () => {
  await refused(
    { id: "track 2", title: "A" },
    "invalid",
    "invalid command: localId permits ASCII letters, digits, '.', '_' and '-'",
  );
  await refused(
    { id: "x".repeat(129), title: "A" },
    "invalid",
    rule("localId", COMMAND_LIMITS.idBytes),
  );
  await accepted({ id: "track.2_a-b", title: "A" });
});

test("a reason over 512 bytes is refused, at registration and update", async () => {
  await refused(
    { id: "a", title: "A", enabled: false, reason: "x".repeat(513) },
    "invalid",
    rule("reason", COMMAND_LIMITS.reasonBytes),
  );
  let errors: unknown[] = [];
  const { host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      const command = plugin.commands.add({ id: "a", title: "A", run() {} });
      setTimeout(() => command.set({ enabled: false, reason: "Not now " }));
    },
    { capabilities: ["commands"] },
  );
  try {
    await host.settle(50);
    assert.equal((errors[0] as HostError | undefined)?.code, "command");
    assert.equal(
      (errors[0] as HostError).message,
      rule("reason", COMMAND_LIMITS.reasonBytes),
    );
  } finally {
    errors = [];
    await stop();
  }
});

test("a path that repeats or nests in another command's conflicts", async () => {
  const conflict =
    "command conflict: menu path duplicates a command or collides with a leaf/group";
  // The player's own Playback ▸ Speed submenu, by id and by key.
  await refused(
    { id: "a", path: ["@playback", "Speed"] },
    "conflict",
    conflict,
  );
  await refused(
    { id: "a", path: ["Audio", "Mute", "Twice"] },
    "conflict",
    conflict,
  );
  await assert.rejects(
    startPlugin(
      (plugin: Plugin) => {
        plugin.commands.add({ id: "a", path: ["Tools", "A"], run() {} });
        plugin.commands.add({ id: "b", path: ["Tools", "A", "B"], run() {} });
      },
      { capabilities: ["commands"] },
    ),
    { code: "conflict", message: conflict },
  );
  await accepted({ id: "a", path: ["@playback", "Speed", "Very slow"] });
});

test("raw registrations get the player's answers", async () => {
  const { host, stop } = await startPlugin(() => {}, {
    capabilities: ["commands"],
  });
  const register = (declaration: Record<string, unknown>, id = "raw") =>
    host.request("commands.register", {
      id,
      revision: 1,
      declaration: { title: "Raw", ...declaration },
      state: { enabled: true, checked: null, busy: false, reason: null },
    } as never);
  try {
    await assert.rejects(register({ path: Array(9).fill("A") }), {
      code: "invalid",
      message: "invalid command: menu path allows at most 8 segments",
    });
    await assert.rejects(register({ order: 1_000_001 }), {
      code: "invalid",
      message: "invalid command: order must be within ±1000000",
    });
    await assert.rejects(register({ bindings: ["Shift+Ctrl+A"] }), {
      code: "invalid",
      message:
        "invalid command: binding Shift+Ctrl+A: modifiers go in the order Ctrl, Alt, Shift, Cmd, once each",
    });
    await assert.rejects(register({ bindings: ["F3", "F3"] }), {
      code: "invalid",
      message: "invalid command: binding F3 is listed twice",
    });
    await assert.rejects(register({ path: ["@tools", "A"] }), {
      code: "invalid",
      message:
        "invalid command: unknown menu id @tools; the built-in menus are @open, @playback, @subtitles, @video, @audio, @screen, @settings",
    });
    await assert.rejects(register({ path: ["@video"] }), {
      code: "invalid",
      message: "invalid command: menu id @video needs an item after it",
    });
    await register({ path: ["Raw"] });
    await assert.rejects(register({ path: ["Other"] }), {
      code: "conflict",
      message: "command conflict: owner/localId already registered",
    });
  } finally {
    await stop();
  }
});

test("the player's own Toggle Fullscreen and Quit take part in conflicts", async () => {
  const conflict =
    "command conflict: menu path duplicates a command or collides with a leaf/group";
  await refused({ id: "a", path: ["Quit"] }, "conflict", conflict);
  await refused(
    { id: "a", path: ["Toggle Fullscreen", "X"] },
    "conflict",
    conflict,
  );
  await accepted({ id: "a", path: ["Quit Later"] });
});

test("the seek items follow setStepSeek, as the player registers them again", async () => {
  const { host, stop } = await startPlugin(() => {}, {
    capabilities: ["commands"],
  });
  const register = (id: string, path: string[]) =>
    host.request("commands.register", {
      id,
      revision: 1,
      declaration: { title: path.at(-1)!, path },
      state: { enabled: true, checked: null, busy: false, reason: null },
    } as never);
  try {
    await host.request("player.setStepSeek", { seconds: 2.5 });
    assert.deepEqual(host.coreAction("seek-backward").declaration.path, [
      "Playback",
      "Seek",
      "Back 2.5 s",
    ]);
    assert.equal(
      host.coreAction("seek-forward").declaration.title,
      "Forward 2.5 s",
    );
    assert.equal(host.coreAction("seek-forward").display.title, "前进2.5秒");
    await assert.rejects(register("a", ["Playback", "Seek", "Back 2.5 s"]), {
      code: "conflict",
    });
    await register("b", ["Playback", "Seek", "Back 5 s"]);
  } finally {
    await stop();
  }
});

test("updates get the player's answers", async () => {
  const { host, stop } = await startPlugin(() => {}, {
    capabilities: ["commands"],
  });
  const state = { enabled: true, checked: null, busy: false, reason: null };
  try {
    await assert.rejects(
      host.request("commands.update", { id: "nope", revision: 2, state }),
      { code: "command", message: "command missing: owner 1 / nope" },
    );
    await assert.rejects(
      host.request("commands.update", { id: "nope", revision: 0, state }),
      { code: "invalid", message: "positive revision required" },
    );
  } finally {
    await stop();
  }
});

test("a binding listed twice is refused as the player's binding table does, before the reason, conflicts and limits", async () => {
  const { host, stop } = await startPlugin(() => {}, {
    capabilities: ["commands"],
  });
  const register = (
    id: string,
    declaration: Record<string, unknown>,
    reason: string | null = null,
  ) =>
    host.request("commands.register", {
      id,
      revision: 1,
      declaration: { title: id, ...declaration },
      state: { enabled: reason === null, checked: null, busy: false, reason },
    } as never);
  const twice = (binding: string) => ({
    code: "invalid",
    message: `invalid command: binding ${binding} is listed twice`,
  });
  try {
    // Compared as parsed inputs, in order: the repeat is found before a
    // later binding that does not parse.
    await assert.rejects(
      register("a", { bindings: ["Ctrl+K", "F2", "Ctrl+K", "Ctrl+k"] }),
      twice("Ctrl+K"),
    );
    await assert.rejects(register("a", { bindings: ["F3", "Shift+Ctrl+A"] }), {
      code: "invalid",
      message:
        "invalid command: binding Shift+Ctrl+A: modifiers go in the order Ctrl, Alt, Shift, Cmd, once each",
    });
    // Before the reason.
    await assert.rejects(
      register("a", { bindings: ["F3", "F3"] }, "x".repeat(513)),
      twice("F3"),
    );
    // Before the id and path conflicts.
    await register("taken", { path: ["Tools", "Taken"] });
    await assert.rejects(
      register("taken", { bindings: ["F4", "F4"] }),
      twice("F4"),
    );
    await assert.rejects(
      register("other", { path: ["Tools", "Taken"], bindings: ["F4", "F4"] }),
      twice("F4"),
    );
    // Before the limit.
    for (let i = 1; i < COMMAND_LIMITS.perPlugin; i++)
      await register(`c${i}`, {});
    await assert.rejects(register("over", {}), { code: "limit" });
    await assert.rejects(
      register("over", { bindings: ["F5", "F5"] }),
      twice("F5"),
    );
  } finally {
    await stop();
  }
});
