import assert from "node:assert/strict";
import test from "node:test";
import { startPlugin, TestHost } from "@vestra-player/sdk/testing";
import activate from "../main.ts";

const directory = new URL("..", import.meta.url);

test("the panel is a tab of the adjust column, which starts closed", async () => {
  const { host, stop } = await startPlugin(activate, { directory });
  const panel = host.mounted();
  assert.equal(panel.slot, "adjust");
  assert.equal(host.layout.adjust?.panels?.[0]?.title, "Speed");
  assert.equal(host.layout.adjust?.preferred, false);
  await stop();
});

test("Alt+5 opens the column at this tab, and closes it again", async () => {
  const host = new TestHost();
  host.mountOther("adjust", "vestra.video", { title: "Picture" });
  const { stop } = await startPlugin(activate, { directory, host });
  host.selectTab("vestra.video");
  await host.settle();
  await host.command("speed").run();
  await host.settle();
  assert.equal(host.layout.adjust?.preferred, true);
  assert.equal(host.layout.adjust?.owner, 1, "this plugin's tab is current");
  await host.command("speed").run();
  await host.settle();
  assert.equal(host.layout.adjust?.preferred, false);
  await stop();
});

test("while the tab is shown, the panel follows a file opened elsewhere", async () => {
  const { host, stop } = await startPlugin(activate, { directory });
  const panel = host.mounted();
  await host.command("speed").run(); // the column opens at this tab
  await host.settle();
  assert.equal(panel.props.enabled, false, "nothing to change the speed of");
  host.openElsewhere("/movie.mp4");
  host.setSource({ duration: 600, position: 10, rate: 1.25 });
  await host.settle();
  assert.equal(panel.props.enabled, true);
  assert.equal(panel.props.rate, 1.25);
  await stop();
});

test("the slider and the reset change the speed", async () => {
  const host = new TestHost();
  host.openElsewhere("/movie.mp4");
  host.setSource({ duration: 600, position: 10 });
  const { stop } = await startPlugin(activate, { directory, host });
  const panel = host.mounted();
  panel.emit("rate-changed", 1.5);
  await host.settle();
  assert.equal(host.source.rate, 1.5);
  assert.equal(panel.props.rate, 1.5);
  await host.command("speed-reset").run();
  await host.settle();
  assert.equal(host.source.rate, 1);
  assert.equal(host.command("speed-reset").declaration.home, "speed");
  await stop();
});

test("Normal Speed follows the player with no stream open", async () => {
  const { host, stop } = await startPlugin(activate, { directory });
  assert.equal(host.command("speed-reset").state.enabled, false);
  host.openElsewhere("/movie.mp4"); // the player evaluates when.can("rate")
  assert.equal(host.command("speed-reset").state.enabled, true);
  await stop();
});

test("only the shown tab keeps the plugin running", async () => {
  const { host, stop } = await startPlugin(activate, { directory });
  const keepsRunning = () => host.keepsRunning;
  await host.settle();
  assert.deepEqual(keepsRunning(), [], "the column is closed");
  await host.command("speed").run(); // opens the column at this tab
  await host.settle();
  assert.ok(keepsRunning().includes("its adjust tab is the current tab"));
  assert.ok(keepsRunning().some((why) => why.includes("a stream")));
  await host.command("speed").run(); // closes it
  await host.settle();
  assert.deepEqual(keepsRunning(), []);
  await stop();
});

// #region source-changes
// The user changes the source between the plugin's read in `activate` and
// Normal Speed. Each change advances the player's source stamp as the
// player does: `openElsewhere` starts a new generation (also for the same
// file), a core action is a new intent. A control the plugin makes with an
// older copy of the state is refused with `stale`, and a host error the
// test does not expect fails it (`host.strictErrors`).
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

/** Start with `atStart` open at 1.5×, make the change, run Normal Speed. */
async function normalSpeedAfter(
  atStart: string | null,
  act: (host: TestHost) => Promise<void>,
  shown: boolean,
) {
  const host = new TestHost();
  if (atStart) host.openElsewhere(atStart);
  const { stop } = await startPlugin(activate, { directory, host });
  try {
    if (shown) await host.command("speed").run(); // a stream follows the state
    await act(host);
    host.setSource({ rate: 1.5 });
    await host.settle();
    await host.command("speed-reset").run();
    assert.equal(host.source.rate, 1);
  } finally {
    await stop();
  }
}

for (const [change, atStart, act] of changes) {
  test(
    `Normal Speed works after ${change}, the column closed`,
    // TODO(stale controls): with the column closed nothing follows the
    // state, so the plugin sets the speed with the copy it read in
    // `activate` and the player refuses it with `stale`, as TestHost does.
    // Drop `todo` once the pending decision on the SDK's control semantics,
    // or a fix of this example, lands.
    { todo: "stale: the control carries the stamp of the plugin's old copy" },
    () => normalSpeedAfter(atStart, act, false),
  );
  test(`Normal Speed works after ${change}, the tab shown`, () =>
    normalSpeedAfter(atStart, act, true));
}
// #endregion source-changes
