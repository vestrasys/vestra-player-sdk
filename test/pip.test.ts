import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin, WindowState } from "../src/plugin/index.ts";

const all = ["playback.read", "events", "window.control"];

async function started(host = new TestHost(), capabilities = all) {
  let plugin!: Plugin;
  const result = await startPlugin(
    (p: Plugin) => {
      plugin = p;
    },
    { capabilities, host },
  );
  return { ...result, plugin };
}

const rejects = async (promise: Promise<unknown>, code: string) =>
  assert.rejects(promise, (error: { code?: string }) => {
    assert.equal(error.code, code);
    return true;
  });

test("picture-in-picture: state, switching and the window's own close", async () => {
  const host = new TestHost();
  host.setSource({ phase: "ready", duration: 60 });
  const { plugin, stop } = await started(host);
  assert.deepEqual(plugin.window.state.pictureInPicture, {
    supported: true,
    active: false,
  });
  const seen: WindowState["pictureInPicture"][] = [];
  plugin.window.onChange((state) => seen.push(state.pictureInPicture));
  await host.settle();
  // From fullscreen: the player leaves fullscreen, then the window opens.
  host.setMainWindow({ fullscreen: true });
  await plugin.window.setPictureInPicture(true);
  assert.equal(plugin.window.state.pictureInPicture.active, true);
  assert.equal(plugin.window.state.fullscreen, false);
  assert.deepEqual(host.sent("window.setPictureInPicture"), [{ on: true }]);
  // On again: nothing changes.
  await plugin.window.setPictureInPicture(true);
  // The user closes the PiP window: the state follows.
  host.setMainWindow({
    pictureInPicture: { supported: true, active: false },
  });
  await host.settle();
  assert.equal(plugin.window.state.pictureInPicture.active, false);
  // Pushed with every window change (the first is leaving fullscreen).
  assert.deepEqual(
    seen.map((pip) => pip.active),
    [false, true, false],
  );
  await plugin.window.setPictureInPicture(false);
  await rejects(plugin.window.setPictureInPicture("yes" as never), "invalid");
  await stop();
});

test("picture-in-picture: unsupported systems and no video", async () => {
  const host = new TestHost();
  host.mainWindow.pictureInPicture = { supported: false, active: false };
  host.setSource({ phase: "ready", duration: 60 });
  const { plugin, stop } = await started(host);
  assert.equal(plugin.window.state.pictureInPicture.supported, false);
  await rejects(plugin.window.setPictureInPicture(true), "unsupported");
  // Turning off what is not on works everywhere.
  await plugin.window.setPictureInPicture(false);
  await stop();

  const audio = new TestHost();
  audio.setSource({ phase: "ready", hasVideo: false });
  const second = await started(audio);
  await rejects(second.plugin.window.setPictureInPicture(true), "unavailable");
  await second.stop();
});

test("picture-in-picture: an older player without the field reads as unsupported", async () => {
  const host = new TestHost();
  host.handle("window.state", () => ({
    fullscreen: false,
    videoArea: { width: 640, height: 360 },
  }));
  const { plugin, stop } = await started(host);
  assert.deepEqual(plugin.window.state.pictureInPicture, {
    supported: false,
    active: false,
  });
  await stop();
});
