// plugin.commands.keys and onKeysChange (SDK 1.6.6, player 0.7.6): the key
// labels of the plugin's own commands as the menus write them, always the
// current binding (the user's keys, a cleared key, a key another command
// holds), pushed as `commands.keys` when they change; a view bound to them
// follows. Needs only `commands`.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { Plugin } from "../src/index.ts";
import { keyLabel } from "../src/plugin/bindings.ts";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";

function picturePackage() {
  const directory = mkdtempSync(join(tmpdir(), "command-keys-"));
  writeFileSync(
    join(directory, "picture.slint"),
    "export component Picture inherits Window { in property <string> brightness-down; in property <string> brightness-up; }\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "test.keys",
      capabilities: ["commands", "ui.window"],
    }),
  );
  return directory;
}

function activate(plugin: Plugin) {
  plugin.commands.add({
    id: "brightness.down",
    path: ["@video", "Brightness −"],
    bindings: ["W", "Mouse:WheelDown", "Ctrl+ArrowDown"],
    run() {},
  });
  plugin.commands.add({
    id: "brightness.up",
    path: ["@video", "Brightness +"],
    bindings: ["E"],
    run() {},
  });
  // The player's own Mute holds M: the plugin's command shows no key.
  plugin.commands.add({
    id: "mute-too",
    title: "Mute too",
    bindings: ["M"],
    run() {},
  });
  const pictureWindow = plugin.windows.create("picture.slint");
  pictureWindow.bind(() => ({
    brightnessDown: plugin.commands.keys("brightness.down")[0] ?? "",
    brightnessUp: plugin.commands.keys("brightness.up")[0] ?? "",
  }));
  void pictureWindow.show();
}

test("labels as the menus write them, per system", () => {
  assert.equal(keyLabel("Ctrl+Shift+S", false), "Ctrl+Shift+S");
  assert.equal(keyLabel("Ctrl+Shift+S", true), "⇧⌘S");
  assert.equal(keyLabel("Ctrl+Cmd+F", true), "⌃⌘F");
  assert.equal(keyLabel("Cmd+Q", false), null);
  assert.equal(keyLabel("Cmd+Q", true), "⌘Q");
  assert.equal(keyLabel("Alt+ArrowLeft", false), "Alt+←");
  assert.equal(keyLabel("Alt+ArrowLeft", true), "⌥←");
  assert.equal(keyLabel("Numpad5", false), "Num5");
  assert.equal(keyLabel("Escape", true), "Esc");
  assert.equal(keyLabel("Plus", false), "+");
  assert.equal(keyLabel(">", false), ">");
  assert.equal(keyLabel("Mouse:WheelUp", true), null);
});

test("keys follow rebinding, clearing and Ignore Default Shortcuts; a view bound to them follows", async () => {
  const host = new TestHost();
  host.systemInfo.os = "windows";
  const { plugin, stop } = await startPlugin(activate, {
    directory: picturePackage(),
    host,
  });
  try {
    await host.settle();
    assert.deepEqual(plugin.commands.keys("brightness.down"), ["W", "Ctrl+↓"]);
    assert.deepEqual(plugin.commands.keys("brightness.up"), ["E"]);
    assert.deepEqual(plugin.commands.keys("mute-too"), []);
    // Not a command of this plugin: nothing, never another plugin's keys.
    assert.deepEqual(plugin.commands.keys("mute"), []);
    assert.throws(() => plugin.commands.keys(7 as never), { code: "invalid" });
    const props = () => host.window("picture").props;
    assert.equal(props()["brightness-down"], "W");
    assert.equal(props()["brightness-up"], "E");
    // The same labels are the same array.
    assert.equal(
      plugin.commands.keys("brightness.up"),
      plugin.commands.keys("brightness.up"),
    );

    let heard = 0;
    plugin.commands.onKeysChange(() => heard++);
    await host.settle();
    host.rebind("brightness.down", ["Shift+W"]);
    await host.settle();
    assert.deepEqual(plugin.commands.keys("brightness.down"), ["Shift+W"]);
    assert.equal(props()["brightness-down"], "Shift+W");
    assert.equal(heard, 1);

    // Cleared (Ignore Default Shortcuts writes [] for every default).
    host.rebind("brightness.up", []);
    await host.settle();
    assert.deepEqual(plugin.commands.keys("brightness.up"), []);
    assert.equal(props()["brightness-up"], "");
    assert.equal(heard, 2);

    // Back to the defaults; a change elsewhere in the table that leaves
    // the labels as they are pushes nothing.
    host.rebind("brightness.up", null);
    await host.settle();
    assert.equal(props()["brightness-up"], "E");
    assert.equal(heard, 3);
    host.rebind("mute-too", ["M"]);
    await host.settle();
    assert.equal(heard, 3);
    // A command added later brings its keys.
    plugin.commands.add({
      id: "late",
      title: "Late",
      bindings: ["L"],
      run() {},
    });
    await host.settle();
    assert.deepEqual(plugin.commands.keys("late"), ["L"]);
    assert.equal(heard, 4);
  } finally {
    await stop();
  }
});

test("macOS writes ⌘ and ⌃; Cmd bindings show only there", async () => {
  const host = new TestHost();
  host.systemInfo.os = "macos";
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({
        id: "open",
        title: "Open",
        bindings: ["Cmd+O", "Ctrl+O", "Ctrl+Cmd+F"],
        run() {},
      });
    },
    { capabilities: ["commands"], host },
  );
  try {
    void plugin.commands.keys("open");
    await host.settle();
    // Cmd+O and Ctrl+O are both ⌘O: shown once.
    assert.deepEqual(plugin.commands.keys("open"), ["⌘O", "⌃⌘F"]);
  } finally {
    await stop();
  }
});

test("only `commands` is needed: one read and a mirror subscription, a listener while one exists", async () => {
  const { plugin, host, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({
        id: "hello",
        title: "Hello",
        bindings: ["H"],
        run() {},
      });
    },
    { capabilities: ["commands"] },
  );
  try {
    assert.deepEqual(plugin.commands.keys("hello"), []); // before the answer
    await host.settle();
    assert.deepEqual(plugin.commands.keys("hello"), ["H"]);
    assert.equal(
      host.calls.filter((c) => c.method === "commands.keys").length,
      1,
    );
    assert.ok(host.subscriptions.has("commands.keys"));
    assert.deepEqual([...host.listening], []);
    const listener = plugin.commands.onKeysChange(() => {});
    await host.settle();
    assert.deepEqual([...host.listening], ["commands.keys"]);
    await listener.dispose();
    await host.settle();
    assert.deepEqual([...host.listening], []);
  } finally {
    await stop();
  }
});

test("without `commands` every command reads [] and nothing is asked", async () => {
  const { plugin, host, stop } = await startPlugin(() => {}, {
    capabilities: [],
  });
  try {
    assert.deepEqual(plugin.commands.keys("anything"), []);
    plugin.commands.onKeysChange(() => {});
    await host.settle();
    assert.ok(!host.calls.some((c) => c.method === "commands.keys"));
    assert.ok(!host.subscriptions.has("commands.keys"));
  } finally {
    await stop();
  }
});

test("an answer older than an event it crossed is dropped", async () => {
  const host = new TestHost();
  // The player pushed a newer change while the answer was on its way.
  host.handle("commands.keys", () => {
    host.emit("commands.keys", { keys: { a: ["B"] }, revision: 9 });
    return { keys: { a: ["A"] }, revision: 5 };
  });
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.commands.add({ id: "a", title: "A", bindings: ["A"], run() {} });
    },
    { capabilities: ["commands"], host },
  );
  try {
    void plugin.commands.keys("a");
    await host.settle();
    assert.deepEqual(plugin.commands.keys("a"), ["B"]);
  } finally {
    await stop();
  }
});

test("the player's own commands' keys read as host/<id> and follow their rebinding (SDK 1.6.16)", async () => {
  const host = new TestHost();
  host.systemInfo.os = "windows";
  const { plugin, stop } = await startPlugin(activate, {
    directory: picturePackage(),
    host,
  });
  try {
    await host.settle();
    // Mute holds M; Volume + has a mouse binding too, left out as in menus.
    assert.deepEqual(plugin.commands.keys("host/mute"), ["M"]);
    const volumeUp = host.coreCommands.get("host/volume-up")!;
    const shown = (volumeUp.declaration.bindings ?? [])
      .map((input) => keyLabel(input, false))
      .filter((label) => label !== null);
    assert.ok(shown.length);
    assert.deepEqual(plugin.commands.keys("host/volume-up"), shown);
    assert.deepEqual(plugin.commands.keys("host/no-such"), []);
    let heard = 0;
    plugin.commands.onKeysChange(() => heard++);
    await host.settle();
    host.rebind("host/mute", ["Ctrl+M"]);
    await host.settle();
    assert.deepEqual(plugin.commands.keys("host/mute"), ["Ctrl+M"]);
    assert.equal(heard, 1);
    // The player's key freed, the plugin's own command that wanted M has it.
    assert.deepEqual(plugin.commands.keys("mute-too"), ["M"]);
  } finally {
    await stop();
  }
});
