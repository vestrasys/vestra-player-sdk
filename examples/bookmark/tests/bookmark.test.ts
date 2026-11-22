import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url);

// #region mark-jump
test("mark the position, then jump back to it", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  host.setSource({ duration: 600, position: 42 });
  const { stop } = await startPlugin(activate, { directory, host });

  await host.command("bookmark.open").run();
  const bookmarkWindow = host.window("bookmark");
  bookmarkWindow.emit("mark");
  await host.settle();
  assert.equal(bookmarkWindow.props.label, "Bookmark: 42.0 s");

  host.setSource({ position: 300 }); // playback moves on
  bookmarkWindow.emit("jump");
  await host.settle();
  assert.equal(host.source.position, 42);
  await stop();
});
// #endregion mark-jump

test("the open window follows playback; closed, nothing keeps the plugin running", async () => {
  const host = new TestHost();
  const { stop } = await startPlugin(activate, { directory, host });
  const keepsRunning = () => host.keepsRunning;
  await host.settle();
  assert.deepEqual(keepsRunning(), []);

  await host.command("bookmark.open").run();
  await host.settle();
  const bookmarkWindow = host.window("bookmark");
  assert.equal(bookmarkWindow.props["can-mark"], false, "nothing open");
  host.openElsewhere("/movie.mp4"); // opened elsewhere: the stream follows
  host.setSource({ duration: 600, position: 5 });
  await host.settle();
  assert.equal(bookmarkWindow.props["can-mark"], true);
  assert.ok(keepsRunning().some((why) => why.includes("a stream")));

  bookmarkWindow.userClose(); // the user closes it
  await host.settle();
  assert.deepEqual(keepsRunning(), []);
  await stop();
});

test("the bookmark outlives a stop of the plugin", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  host.setSource({ duration: 600, position: 42 });
  const first = await startPlugin(activate, { directory, host });
  await host.command("bookmark.open").run();
  host.window("bookmark").emit("mark");
  await host.settle();
  await first.stop({ reason: "idle" }); // nothing used it: standby
  // Its next use starts it again within the same player session.
  const again = await startPlugin(activate, {
    directory,
    sessionStorage: host.sessionStorage,
  });
  await again.host.command("bookmark.open").run();
  await again.host.settle();
  assert.equal(again.host.window("bookmark").props.label, "Bookmark: 42.0 s");
  await again.stop();
});
