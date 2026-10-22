import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { HostError, startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url); // reads manifest.json

// #region helpers
/** Start the plugin with a video playing (unless `ready` is false). */
async function start(
  options: { ready?: boolean; dataDirectory?: string } = {},
) {
  const host = new TestHost();
  if (options.ready !== false) host.setSource({ phase: "ready", duration: 60 });
  const started = await startPlugin(activate, {
    directory,
    host,
    ...(options.dataDirectory ? { dataDirectory: options.dataDirectory } : {}),
  });
  return started;
}

/** The video chain the player holds for this plugin (`[]` when withdrawn). */
function chain(host: TestHost) {
  const own = [...host.processing.resources.values()].find(
    (resource) => resource.stage === "video",
  );
  return own?.nodes ?? [];
}

/** Open the Blur window through its menu command. */
async function openWindow(host: TestHost) {
  await host.command("controls").run();
  return host.window("window");
}
// #endregion helpers

// #region test-toggle
test("Video ▸ Blur and Ctrl+Shift+B toggle the gblur node", async () => {
  const { host, stop } = await start();
  const toggle = host.command("toggle");
  assert.deepEqual(toggle.declaration.path, ["Video", "Blur"]);
  assert.equal(toggle.state.checked, false);
  assert.deepEqual(chain(host), []);

  await toggle.run();
  assert.equal(host.command("toggle").state.checked, true);
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 4, steps: 3 }]);
  assert.equal(host.osd.at(-1), "Blur on (strength 4.0)");

  await host.press("Ctrl+Shift+B");
  assert.equal(host.command("toggle").state.checked, false);
  assert.deepEqual(chain(host), []);
  assert.equal(host.osd.at(-1), "Blur off");
  await stop();
});
// #endregion test-toggle

// #region test-drag
test("dragging the slider previews live and sends only the latest value", async () => {
  const { host, stop } = await start();
  await host.command("toggle").run();
  const window = await openWindow(host);
  const before = host.sent("processing.replace").length;

  // Ten mouse moves arrive faster than the player answers.
  for (let i = 1; i <= 10; i++) window.emit("strength-changed", i * 0.7);
  await host.settle();

  const sent = host.sent("processing.replace").slice(before);
  // One request in flight at a time: the first move, then the newest value.
  assert.equal(sent.length, 2);
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 7, steps: 3 }]);
  assert.equal(window.props["strength"], 7);
  assert.equal(window.props["status"], "Applied");

  // Releasing the mouse confirms on screen; it sends nothing new.
  window.emit("strength-released", 7);
  await host.settle();
  assert.equal(host.osd.at(-1), "Blur strength 7.0");
  await stop();
});
// #endregion test-drag

test("strength is clamped to the gblur range", async () => {
  const { host, stop } = await start();
  await host.command("toggle").run();
  const window = await openWindow(host);
  window.emit("strength-changed", 42);
  await host.settle();
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 10, steps: 3 }]);
  await stop();
});

// #region test-presets
test("presets set the strength; Custom snaps back; Reset restores 4", async () => {
  const { host, stop } = await start();
  await host.command("toggle").run();
  const window = await openWindow(host);
  assert.deepEqual(window.props["presets"], [
    "Light",
    "Medium",
    "Strong",
    "Custom",
  ]);
  assert.equal(window.props["preset-index"], 3, "4 is not a preset: Custom");

  window.emit("preset-chosen", 2);
  await host.settle();
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 9, steps: 3 }]);
  assert.equal(window.props["preset-index"], 2);

  // "Custom": the value did not change, so bind() would send nothing;
  // set() writes it anyway and pulls the drop-down back to Strong.
  const writes = host.sent("ui.set").length;
  window.emit("preset-chosen", 3);
  await host.settle();
  assert.deepEqual(
    host
      .sent("ui.set")
      .slice(writes)
      .map((p) => [p["property"], p["value"]]),
    [["preset-index", 2]],
  );

  window.emit("reset");
  await host.settle();
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 4, steps: 3 }]);
  assert.equal(window.props["strength"], 4);
  assert.equal(host.osd.at(-1), "Blur strength reset to 4.0");
  await stop();
});
// #endregion test-presets

// #region test-persistence
test("strength is remembered; blur comes back on only when the page says so", async () => {
  const data = mkdtempSync(join(tmpdir(), "blur-data-"));
  try {
    const first = await start({ dataDirectory: data });
    await first.host.command("toggle").run();
    const window = await openWindow(first.host);
    window.emit("strength-changed", 6.5);
    await first.host.settle();
    await first.stop(); // flushes blur.json

    // Restart: the strength is back, blur is off (restore is off by default).
    const second = await start({ dataDirectory: data });
    assert.equal(second.host.command("toggle").state.checked, false);
    assert.deepEqual(chain(second.host), []);
    await second.host.command("toggle").run();
    assert.deepEqual(chain(second.host), [
      { kind: "gblur", sigma: 6.5, steps: 3 },
    ]);

    // Options ▸ Video ▸ Blur: turn on "Turn blur back on…".
    const page = second.host.settingsPage("blur");
    assert.equal(page.category, "video");
    assert.equal(page.props["restore-on-start"], false);
    page.emit("restore-toggled", true);
    await second.host.settle();
    assert.equal(page.props["restore-on-start"], true);
    await second.stop();

    const third = await start({ dataDirectory: data });
    assert.equal(third.host.command("toggle").state.checked, true);
    assert.deepEqual(chain(third.host), [
      { kind: "gblur", sigma: 6.5, steps: 3 },
    ]);
    await third.stop();
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
// #endregion test-persistence

test("on-screen messages can be turned off on the options page", async () => {
  const { host, stop } = await start();
  host.settingsPage("blur").emit("messages-toggled", false);
  await host.settle();
  await host.command("toggle").run();
  assert.deepEqual(host.osd, []);
  await stop();
});

// #region test-status
test("the window shows waiting, then applied once a video plays", async () => {
  const { host, stop } = await start({ ready: false });
  await host.command("toggle").run();
  const window = await openWindow(host);
  assert.equal(window.props["status"], "Waiting for a video to play");
  assert.deepEqual(chain(host), [], "nothing sent without media");

  host.setSource({ phase: "ready", duration: 60 });
  await host.settle();
  assert.equal(window.props["status"], "Applied");
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 4, steps: 3 }]);
  await stop();
});

test("a failure is shown in the window and on screen; Retry applies again", async () => {
  const { host, stop } = await start();
  host.handle("processing.replace", () => {
    throw new HostError("failed", "the video backend refused gblur");
  });
  await host.command("toggle").run();
  const window = await openWindow(host);
  assert.equal(window.props["failed"], true);
  assert.equal(
    window.props["status"],
    "Failed: the video backend refused gblur",
  );
  assert.equal(host.osd.at(-1), "Blur failed: the video backend refused gblur");

  host.reset("processing.replace");
  window.emit("retry");
  await host.settle();
  assert.equal(window.props["failed"], false);
  assert.equal(window.props["status"], "Applied");
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 4, steps: 3 }]);
  await stop();
});
// #endregion test-status

// #region test-dispose
test("stopping the plugin withdraws its blur", async () => {
  const { host, stop } = await start();
  await host.command("toggle").run();
  assert.deepEqual(chain(host), [{ kind: "gblur", sigma: 4, steps: 3 }]);
  await stop();
  assert.deepEqual(chain(host), []);
});
// #endregion test-dispose
