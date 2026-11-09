// The test host checks the values a window, panel or settings page is given
// against the plugin's Slint declarations, as the player's Slint does
// (`ui_values::set`, `ui_types.rs` in the player): the same refusals, the
// same codes and words. Before SDK 1.7.3 such a plugin passed its tests and
// failed in the player when its window opened.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { startPlugin, TestHost } from "../src/plugin/testing.ts";
import type { Json } from "../src/wire.ts";
import type { Plugin, PluginError } from "../src/plugin/types.ts";

const WINDOW = `
import { ListView } from "std-widgets.slint";
import { MarkdownBlock } from "@vestra/markdown.slint";
import { Segment } from "parts/segment.slint";

/* A comment with { braces } and property <int> nothing; */
export struct Say { code: string, args: [string] }
export struct Row { id: string, n: int }
export struct Inner { x: float, tags: [string] }
export struct Outer { name: string, inner: Inner }
export struct Logo { key: string, icon: image }
export enum Mode { a, b }

component Part inherits Rectangle {
    in property <string> not-the-window;
}

export component W inherits Window {
    in property <Say> banner;
    in property <[Row]> rows: [{ id: "a", n: 1 }];
    in property <[Segment]> segments;
    in property <string> heading;
    in property <brush> high-tint;
    in property <color> accent;
    in property <Mode> mode;
    in property <int> count;
    in property <float> ratio;
    in property <length> gap;
    in property <image> cover;
    in property <[Logo]> logos;
    in property <Outer> outer;
    in property <[MarkdownBlock]> body;
    in property <[{ label: string, on: bool }]> flags;
    in-out property <string> draft: "a \\{ brace } in a string";
    out property <bool> busy;
    private property <int> hidden;
    property <int> also-hidden;
    in property <StandardListViewItem> item;
    callback act(string);
    Part {
        in property <int> nested-only;
    }
    for row in root.rows: Text { text: row.id; }
}
`;

const SEGMENT = `
export struct Segment { start: float, end: float, label: string }
`;

const PANEL = `
export struct Item { title: string, done: bool }
export global Bridge {
    in property <[Item]> items;
    in property <string> status;
    out property <int> picked;
    in property <bool> tabbed;
}
export component Panel inherits Rectangle {}
`;

function packageWith() {
  const directory = mkdtempSync(join(tmpdir(), "slint-types-"));
  mkdirSync(join(directory, "parts"));
  writeFileSync(join(directory, "w.slint"), WINDOW);
  writeFileSync(join(directory, "parts", "segment.slint"), SEGMENT);
  writeFileSync(join(directory, "panel.slint"), PANEL);
  writeFileSync(
    join(directory, "manifest.json"),
    JSON.stringify({
      id: "test.types",
      capabilities: ["ui.window", "ui.mount", "ui.settings"],
    }),
  );
  return directory;
}

async function started() {
  const host = new TestHost();
  const { stop } = await startPlugin(() => {}, {
    host,
    directory: packageWith(),
  });
  let n = 0;
  /** `ui.open` of w.slint with `properties`: its refusal, or null. */
  const open = async (properties: Record<string, Json>) => {
    try {
      await host.request("ui.open", {
        id: `w${++n}`,
        file: "w.slint",
        properties,
        callbacks: [],
      });
      return null;
    } catch (error) {
      return error as PluginError;
    }
  };
  return { host, stop, open };
}

const refused = (error: PluginError | null) =>
  error && { code: error.code, message: error.message };

test("the player's own cases: a field the struct does not declare, a row field, a number for a string, out and unknown properties", async () => {
  const { stop, open } = await started();
  assert.deepEqual(
    refused(await open({ banner: { code: "x", args: [], n: 0 } })),
    {
      code: "host",
      message:
        "banner: wrong type: banner.n is not a field of the declared struct (args, code)",
    },
  );
  // The default rows (an array literal) show the row type.
  assert.deepEqual(refused(await open({ rows: [{ id: "b", n: "2" }] })), {
    code: "host",
    message:
      "rows: wrong type: rows[0].n is a string where the declaration has a number",
  });
  assert.deepEqual(refused(await open({ heading: 3 })), {
    code: "host",
    message:
      "heading: wrong type: heading is a number where the declaration has a string",
  });
  assert.deepEqual(refused(await open({ busy: true })), {
    code: "host",
    message: "busy: not writable (an out property)",
  });
  assert.deepEqual(refused(await open({ nothing: 1 })), {
    code: "host",
    message: "nothing: no such property",
  });
  // Private properties and those of an inner element are not the window's.
  for (const name of ["hidden", "also-hidden", "nested-only", "not-the-window"])
    assert.equal(
      (await open({ [name]: 1 }))?.message,
      `${name}: no such property`,
    );
  // A struct may leave fields out (they take their defaults).
  assert.equal(await open({ banner: { code: "x" } }), null);
  assert.equal(await open({ banner: { code: "x", args: ["a"] } }), null);
  await stop();
});

test("a string for a brush or a color, an enum, null: refused as in the player", async () => {
  const { stop, open } = await started();
  assert.deepEqual(refused(await open({ "high-tint": "#ff0000" })), {
    code: "host",
    message:
      "high-tint: wrong type: high-tint is a string where the declaration has a brush",
  });
  assert.equal(
    (await open({ accent: "red" }))?.message,
    "accent: wrong type: accent is a string where the declaration has a brush",
  );
  assert.equal(
    (await open({ mode: "a" }))?.message,
    "mode: wrong type: mode is a string where the declaration has an enum value",
  );
  assert.equal(
    (await open({ heading: null }))?.message,
    "heading: wrong type: heading is null where the declaration has a string",
  );
  await stop();
});

test("a row whose struct does not match: the words follow what the property holds", async () => {
  const { host, stop, open } = await started();
  // 2026-11-09: an empty array shows no row type, so the words cannot say
  // where (the player's message, word for word).
  assert.deepEqual(
    refused(await open({ segments: [{ start: 0, end: 1, text: "x" }] })),
    {
      code: "host",
      message:
        "segments: wrong type: segments is an array that does not match the declared an array type",
    },
  );
  assert.equal(
    await open({ segments: [{ start: 0, end: 1.5, label: "intro" }] }),
    null,
  );
  // Once the window holds rows, a write names the field (`ui.set`: code ui).
  const id = "w2";
  await assert.rejects(
    host.request("ui.set", {
      id,
      property: "segments",
      value: [
        { start: 0, end: 1, label: "a" },
        { start: 1, end: 2, title: "b" },
      ],
    }),
    {
      code: "ui",
      message:
        "segments: wrong type: segments[1].title is not a field of the declared struct (end, label, start)",
    },
  );
  assert.deepEqual(host.window(id).props.segments, [
    { start: 0, end: 1.5, label: "intro" },
  ]);
  // An undeclared property: the player reads it first ("no such property").
  await assert.rejects(
    host.request("ui.set", { id, property: "nothing", value: 1 }),
    { code: "ui", message: "no such property" },
  );
  await stop();
});

test("numbers: int, float and length take any number, never a numeric string", async () => {
  const { stop, open } = await started();
  assert.equal(await open({ count: 1.5, ratio: 2, gap: -3 }), null);
  assert.equal(
    (await open({ count: "1" }))?.message,
    "count: wrong type: count is a string where the declaration has a number",
  );
  assert.equal(
    (await open({ ratio: true }))?.message,
    "ratio: wrong type: ratio is a bool where the declaration has a number",
  );
  await stop();
});

test("images: a reference for an image, nowhere else", async () => {
  const { stop, open } = await started();
  const icon = { $vestraImage: "/i.png", ref: 1, maxSide: 64 };
  assert.equal(await open({ cover: icon }), null);
  assert.equal(await open({ logos: [{ key: "a", icon }] }), null);
  assert.equal(
    (await open({ cover: "/i.png" }))?.message,
    "cover: wrong type: cover is a string where the declaration has an image",
  );
  assert.equal(
    (await open({ heading: icon }))?.message,
    "heading: wrong type: heading is an image where the declaration has a string",
  );
  assert.equal(
    (await open({ logos: [{ key: "a", icon: "/i.png" }] }))?.message,
    "logos: wrong type: logos is an array that does not match the declared an array type",
  );
  await stop();
});

test("null: an empty image in plain rows, refused anywhere else", async () => {
  const { stop, open } = await started();
  // In an array without documents the player reads null as an empty
  // picture (a row without a logo).
  assert.equal(await open({ logos: [{ key: "a", icon: null }] }), null);
  assert.equal(
    (await open({ rows: [{ id: null, n: 1 }] }))?.message,
    "rows: wrong type: rows[0].id is an image where the declaration has a string",
  );
  // Outside an array, or in one holding a document, null stays null.
  assert.equal(
    (await open({ outer: { name: null } }))?.message,
    "outer: wrong type: outer.name is null where the declaration has a string",
  );
  assert.equal(
    (await open({ cover: null }))?.message,
    "cover: wrong type: cover is null where the declaration has an image",
  );
  await stop();
});

test("nested structs, anonymous structs, imported and unknown types", async () => {
  const { stop, open } = await started();
  const outer = { name: "o", inner: { x: 1, tags: ["a"] } };
  assert.equal(await open({ outer }), null);
  assert.equal(
    (await open({ outer: { name: "o", inner: { x: "1" } } }))?.message,
    "outer: wrong type: outer.inner.x is a string where the declaration has a number",
  );
  assert.equal(
    (await open({ outer: { inner: { x: 1, tags: [1] } } }))?.message,
    "outer: wrong type: outer is a struct that does not match the declared a struct type",
  );
  assert.equal(
    (await open({ outer: { inner: { y: 1 } } }))?.message,
    "outer: wrong type: outer.inner.y is not a field of the declared struct (tags, x)",
  );
  assert.equal(await open({ flags: [{ label: "a", on: true }] }), null);
  assert.equal(
    (await open({ flags: [{ label: "a", on: 1 }] }))?.message,
    "flags: wrong type: flags is an array that does not match the declared an array type",
  );
  // A type of std-widgets.slint is not read: any value passes.
  assert.equal(await open({ item: { anything: 1 } }), null);
  // @vestra/markdown.slint resolves to the SDK's library; a document is rows.
  assert.equal(
    await open({ body: { $vestraMarkdown: { text: "# hi" }, ref: 1 } }),
    null,
  );
  assert.equal(
    (await open({ body: [{ nope: 1 }] }))?.message,
    "body: wrong type: body is an array that does not match the declared an array type",
  );
  await stop();
});

test("panels: initial values the panel cannot take are reported and left out, writes refused with host", async () => {
  const errors: PluginError[] = [];
  const { host, plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      plugin.panels.mount("sidebar", "panel.slint").set({
        items: [{ title: "a", done: "no" }],
        status: "ready",
        extra: 1,
      });
    },
    { directory: packageWith() },
  );
  assert.deepEqual(host.mounted().props, { status: "ready" });
  assert.deepEqual(
    errors.map((e) => [e.code, e.message]),
    [
      ["ui", "extra: no such property"],
      [
        "ui",
        "items: items: wrong type: items is an array that does not match the declared an array type",
      ],
    ],
  );
  await assert.rejects(
    host.request("ui.setMount", { property: "status", value: 1 }),
    {
      code: "host",
      message:
        "status: wrong type: status is a number where the declaration has a string",
    },
  );
  await assert.rejects(
    host.request("ui.setMount", { property: "picked", value: 1 }),
    { code: "host", message: "picked: not writable (an out property)" },
  );
  await assert.rejects(
    host.request("ui.setMount", { property: "extra", value: 1 }),
    { code: "host", message: "no such property" },
  );
  await host.request("ui.setMount", {
    property: "items",
    value: [{ title: "a", done: true }],
  });
  assert.deepEqual(host.mounted().props.items, [{ title: "a", done: true }]);
  void plugin;
  await stop();
});

test("settings pages: checked when written, code ui", async () => {
  const { host, stop } = await startPlugin(() => {}, {
    directory: packageWith(),
  });
  const page = {
    id: "p",
    category: "general",
    title: "P",
    file: "panel.slint",
    component: "Panel",
    global: "Bridge",
  };
  await assert.rejects(
    host.request("settings.register", {
      ...page,
      properties: { status: ["x"] },
    }),
    {
      code: "ui",
      message:
        "status: wrong type: status is an array where the declaration has a string",
    },
  );
  await host.request("settings.register", {
    ...page,
    properties: { status: "x" },
  });
  await assert.rejects(
    host.request("settings.set", { id: "p", property: "status", value: false }),
    {
      code: "ui",
      message:
        "status: wrong type: status is a bool where the declaration has a string",
    },
  );
  await assert.rejects(
    host.request("settings.set", { id: "p", property: "other", value: "" }),
    { code: "ui", message: "no such property" },
  );
  await stop();
});

test("a plugin's window that gives a wrong type fails to show, with the player's words", async () => {
  const { plugin, stop } = await startPlugin(() => {}, {
    directory: packageWith(),
  });
  const window = plugin.windows.create("w.slint", { id: "w" });
  window.set({ highTint: "#ff0000" });
  await assert.rejects(window.show(), {
    code: "host",
    message:
      "high-tint: wrong type: high-tint is a string where the declaration has a brush",
  });
  await stop();
});

// A refused 20,000-row write fails once: reported to the plugin, the panel
// keeps its last good value, nothing is sent again until the value changes.
// Only scalar assertions here: `assert.deepEqual` of a 20,000-row array
// against another value builds a diff that takes gigabytes.
test("a refused 20,000-row write fails once, promptly, with bounded memory", async () => {
  const directory = packageWith();
  writeFileSync(
    join(directory, "panel.slint"),
    "export global Bridge { in property <[int]> rows; in property <string> total; }\nexport component Panel inherits Rectangle {}\n",
  );
  const host = new TestHost();
  const errors: PluginError[] = [];
  let list: { id: string; label: string }[] = [];
  const { plugin, stop } = await startPlugin(
    (plugin: Plugin) => {
      plugin.onError((error) => errors.push(error));
      plugin.panels
        .mount("sidebar", "panel.slint")
        .bind(() => ({ rows: list, total: String(list.length) }));
    },
    { host, directory },
  );
  const before = process.memoryUsage().rss;
  const started = Date.now();
  const sent = host.calls.length;
  list = Array.from({ length: 20_000 }, (_, i) => ({
    id: `r${i}`,
    label: `row ${i}`.padEnd(200, "x"),
  }));
  plugin.update();
  await host.settle();
  // Past the first back-off: a bound value that failed is not sent again.
  await new Promise((resolve) => setTimeout(resolve, 600));
  await host.settle();
  const rows = host.calls
    .slice(sent)
    .filter(
      (call) =>
        call.method === "ui.setMount" &&
        (call.params as { property?: string }).property === "rows",
    );
  const last = rows.at(-1)!.params as { patch?: unknown; more?: boolean };
  assert.ok(last.patch !== undefined && last.more === undefined);
  assert.ok(rows.length < 30, `${rows.length} writes of rows`);
  assert.equal(errors.length, 1);
  assert.equal(
    errors[0]!.message,
    "rows: wrong type: rows is an array that does not match the declared an array type",
  );
  assert.equal((host.mounted().props.rows as Json[]).length, 0);
  assert.equal(host.mounted().props.total, "20000");
  assert.ok(Date.now() - started < 10_000);
  assert.ok(
    process.memoryUsage().rss - before < 1024 * 1024 * 1024,
    `rss grew by ${Math.round((process.memoryUsage().rss - before) / 1048576)} MB`,
  );
  await stop();
});
