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

// #region source-changes
// The user changes the source after the plugin read the state, then jumps
// to the bookmark. Each change advances the player's source stamp as the
// player does: `openElsewhere` starts a new generation (also for the same
// file), a core action is a new intent. A control the plugin makes with an
// older copy of the state is refused with `stale`, and a host error the
// test does not expect fails it (`host.strictErrors`).
const changes: [string, (host: TestHost) => Promise<void>][] = [
  ["another file opened", async (host) => host.openElsewhere("/other.mp4")],
  [
    "the same file opened again",
    async (host) => host.openElsewhere("/movie.mp4"),
  ],
  ["the user paused (Space)", (host) => host.coreAction("play-pause").run()],
];

for (const [change, act] of changes)
  for (const reopen of [false, true])
    test(`jump after ${change}, the window ${reopen ? "closed meanwhile" : "open"}`, async () => {
      const host = new TestHost();
      host.openElsewhere("/movie.mp4");
      host.setSource({ duration: 600, position: 42 });
      const { stop } = await startPlugin(activate, { directory, host });
      try {
        await host.command("bookmark.open").run();
        host.window("bookmark").emit("mark");
        await host.settle();
        if (reopen) {
          host.window("bookmark").userClose(); // nothing follows the state
          await host.settle();
        }
        await act(host);
        host.setSource({ duration: 600, position: 300 });
        await host.settle();
        if (reopen) await host.command("bookmark.open").run();
        host.window("bookmark").emit("jump");
        await host.settle();
        assert.equal(host.source.position, 42);
      } finally {
        await stop();
      }
    });
// #endregion source-changes
