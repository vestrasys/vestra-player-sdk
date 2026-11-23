import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url);

test("the speeds are radio items in their own group", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4"); // a file is open, so the speed can change
  const { stop } = await startPlugin(activate, { directory, host });
  const half = host.command("rate-0.5").declaration;
  assert.ok("radio" in half && half.radio);
  assert.equal(half.group, "speeds");
  assert.equal(host.command("rate-1").state.checked, true);

  await host.command("rate-2").run();
  await host.settle();
  assert.equal(host.command("rate-2").state.checked, true);
  assert.equal(host.command("rate-1").state.checked, false);
  await stop();
});

test("the status item is added again with a new title", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  const { stop } = await startPlugin(activate, { directory, host });
  assert.deepEqual(host.command("speed").declaration.path, [
    "Examples",
    "Speed: 1×",
  ]);
  await host.command("rate-1.5").run();
  await host.settle();
  assert.deepEqual(host.command("speed").declaration.path, [
    "Examples",
    "Speed: 1.5×",
  ]);
  await stop();
});

test("the check marks follow a speed set elsewhere; nothing keeps the plugin running", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  const { stop } = await startPlugin(activate, { directory, host });
  const keepsRunning = () => host.keepsRunning;
  await host.settle();
  assert.deepEqual(keepsRunning(), []);
  host.setSource({ rate: 1.5 }); // the user changed the speed
  assert.equal(host.command("rate-1.5").state.checked, true);
  assert.equal(host.command("rate-1").state.checked, false);
  host.setSource({
    capabilities: { ...host.source.capabilities, rate: false }, // a live stream
  });
  assert.equal(host.command("rate-2").state.enabled, false);
  await stop();
});

// #region source-changes
// The user changes the source between the plugin's read in `activate` and
// the command. Each change advances the player's source stamp as the player
// does: `openElsewhere` starts a new generation (also for the same file),
// a core action is a new intent. A control the plugin makes with an older
// copy of the state is refused with `stale`, and a host error the test does
// not expect fails it (`host.strictErrors`).
const changes: [string, string | null, (host: TestHost) => Promise<void>][] = [
  [
    "a file opened after activation",
    null,
    async (host) => host.openElsewhere("/movie.mp4"),
  ],
  [
    "another file opened",
    "/movie.mp4",
    async (host) => host.openElsewhere("/other.mp4"),
  ],
  [
    "the same file opened again",
    "/movie.mp4",
    async (host) => host.openElsewhere("/movie.mp4"),
  ],
  [
    "the user paused (Space)",
    "/movie.mp4",
    (host) => host.coreAction("play-pause").run(),
  ],
];

for (const [change, atStart, act] of changes)
  test(
    `the speeds work after ${change}`,
    // TODO(stale controls): the plugin sets the speed with the copy it read
    // in `activate`, so the player refuses it with `stale`, as TestHost does.
    // Drop `todo` once the pending decision on the SDK's control semantics,
    // or a fix of this example, lands.
    { todo: "stale: the control carries the stamp of the plugin's old copy" },
    async () => {
      const host = new TestHost();
      if (atStart) host.openElsewhere(atStart);
      const { stop } = await startPlugin(activate, { directory, host });
      try {
        await act(host);
        await host.settle();
        for (const rate of [0.5, 1, 1.5, 2]) {
          await host.command(`rate-${rate}`).run();
          assert.equal(host.source.rate, rate);
        }
      } finally {
        await stop();
      }
    },
  );
// #endregion source-changes
