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

test("activated before a file is open, the panel follows the file opened later", async () => {
  const { host, stop } = await startPlugin(activate, { directory });
  const panel = host.mounted();
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
