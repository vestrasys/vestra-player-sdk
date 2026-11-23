// SDK 1.11.0: once the player sent `runtime.stop`, the SDK neither sends
// nor queues a request of the plugin: it is refused with `disabled`. This
// covers the store's repositories page, whose `settings.set` written after
// an idle stop the player dropped without a word (blackboard 11-21).
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Plugin, PluginError } from "../src/plugin/index.ts";

function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "late-"));
  writeFileSync(
    join(directory, "page.slint"),
    "export global Repos { in property <int> count; }\nexport component Page inherits Rectangle {}\n",
  );
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({ id: "test.late" }),
  );
  return directory;
}

test("after runtime.stop a settings page's write and the plugin's own requests are refused, not sent", async () => {
  const host = new TestHost();
  const outcomes: string[] = [];
  let late: (() => Promise<unknown>) | undefined;
  const { stop } = await startPlugin(
    async (plugin: Plugin) => {
      const st = plugin.state({ count: 1 });
      const page = plugin.settings.page("page.slint", {
        id: "repos",
        category: "plugins",
        title: "Repositories",
      });
      page.bind(() => ({ count: st.count }));
      await page.ready;
      // What the store did: its cleanup (or a timer) changes what the page
      // shows while the plugin stops, and asks the player something.
      plugin.onDispose(() => {
        st.count = 2;
        late = () => plugin.clipboard.writeText("late");
      });
    },
    { host, directory: packageWith() },
  );
  const before = host.calls.length;
  await stop();
  await late!().then(
    () => outcomes.push("sent"),
    (error: PluginError) => outcomes.push(`${error.code}: ${error.message}`),
  );
  await host.settle();
  assert.deepEqual(outcomes, [
    "disabled: clipboard.writeText not sent: the plugin is stopping (the player sent runtime.stop)",
  ]);
  const after = host.calls.slice(before).map((call) => call.method);
  assert.ok(!after.includes("settings.set"), `nothing written: ${after}`);
  assert.ok(!after.includes("clipboard.writeText"), `${after}`);
});
