/**
 * Views, panels and tabs: `ui.*` windows and mounts, `layout.*`, property
 * writes with row patches and parts, images, and the timeline layer.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import type { Json, LayoutPanel } from "../../wire.ts";
import { TIMELINE_LIMITS } from "../timeline.ts";
import { UI_VALUE_LIMITS, valueLimitProblem } from "../values.ts";
import { applyOps, PATCH_OPS } from "../patch.ts";
import { isTextValue } from "../../i18n.ts";
import type { FakePanel, TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";
import { taken } from "./transport.ts";
import { windowFacts } from "./core-actions.ts";
import { declaredText, shownValues, hostText } from "./i18n.ts";
import {
  packageDirectories,
  refusal,
  spellingProblem,
  viewTypes,
} from "./slint-types.ts";
import type { Refusal, ViewTypes } from "./slint-types.ts";

export const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export const SLOT_LABELS: Record<string, string> = {
  bottom: "bottom bar",
  sidebar: "sidebar",
  backdrop: "video backdrop",
  adjust: "adjust column",
};

/** The view a panel's writes are kept under (the player's, per slot). */
export const mountView = (slot: string) =>
  slot === "bottom" ? "$mount" : `$mount:${slot}`;

/** The positions that hold tabs: any number of plugins, one tab each. */
export type TabSlot = "bottom" | "sidebar" | "adjust";

export type WireRowOp =
  | { op: "set"; at: number; row: Json }
  | { op: "insert"; at: number; rows: Json[] }
  | { op: "remove"; at: number; count: number }
  | { op: "move"; from: number; count: number; to: number };

/**
 * A patch's ops checked against an array of `length` rows, as the player
 * checks them (`ui_patch.rs`): in order, each on the result of the ones
 * before; at most {@link PATCH_OPS}; the result at most
 * `UI_VALUE_LIMITS.arrayRows` rows.
 */
/** The player takes no Markdown documents in parts of a value (`invalid`). */
export function noMarkdownParts(rows: Json[]) {
  if (JSON.stringify(rows).includes('"$vestraMarkdown"'))
    throw new HostError(
      "invalid",
      "a value sent in parts holds no Markdown documents",
    );
}

export function patchOps(ops: unknown, length: number): WireRowOp[] {
  if (!Array.isArray(ops))
    throw new HostError("invalid", "patch.ops requires an array");
  if (ops.length > PATCH_OPS)
    throw new HostError(
      "limit",
      `a patch carries at most ${PATCH_OPS} operations`,
    );
  const index = (op: Record<string, unknown>, key: string) => {
    const value = op[key];
    if (!Number.isInteger(value) || (value as number) < 0)
      throw new HostError(
        "invalid",
        `patch op ${key} requires a non-negative integer`,
      );
    return value as number;
  };
  const count = (op: Record<string, unknown>) => {
    const value = index(op, "count");
    if (value === 0)
      throw new HostError("invalid", "patch op count must be at least 1");
    return value;
  };
  const past = (what: string) =>
    new HostError("invalid", `${what} is past the end of the list`);
  let len = length;
  return ops.map((raw): WireRowOp => {
    const op = (raw ?? {}) as Record<string, unknown>;
    switch (op.op) {
      case "set": {
        const at = index(op, "at");
        if (at >= len) throw past(`set at ${at}`);
        if (!("row" in op))
          throw new HostError("invalid", "patch op set requires row");
        return { op: "set", at, row: op.row as Json };
      }
      case "insert": {
        const at = index(op, "at");
        const rows = op.rows;
        if (!Array.isArray(rows) || rows.length === 0)
          throw new HostError("invalid", "patch op insert requires rows");
        if (at > len) throw past(`insert at ${at}`);
        len += rows.length;
        if (len > UI_VALUE_LIMITS.arrayRows)
          throw new HostError(
            "limit",
            `UI array exceeds ${UI_VALUE_LIMITS.arrayRows} rows`,
          );
        return { op: "insert", at, rows: rows as Json[] };
      }
      case "remove": {
        const at = index(op, "at");
        const n = count(op);
        if (at + n > len) throw past(`remove ${n} at ${at}`);
        len -= n;
        return { op: "remove", at, count: n };
      }
      case "move": {
        const from = index(op, "from");
        const n = count(op);
        const to = index(op, "to");
        if (from + n > len || to + n > len)
          throw past(`move ${n} from ${from} to ${to}`);
        return { op: "move", from, count: n, to };
      }
      default:
        throw new HostError(
          "invalid",
          "patch op must be set, insert, remove or move",
        );
    }
  });
}

export function timelineChanged(host: TestHost, _inner: Internals) {
  host.emit("timeline.changed", {
    marks: host.timeline.marks,
    ranges: host.timeline.ranges,
  });
}

export function resetWrites(_host: TestHost, inner: Internals, view: string) {
  for (const slot of [...inner.writes.keys()])
    if (slot.startsWith(`${view}\u0000`)) inner.writes.delete(slot);
  for (const slot of [...inner.parts.keys()])
    if (slot.startsWith(`${view}\u0000`)) inner.parts.delete(slot);
}

/**
 * A property write as the player takes it, returning the value the
 * property shows after it: a whole `value`, or a `patch` of the array
 * `current` applying on the write numbered `base` (code `stale`
 * otherwise). The result is checked against the value limits whole: the
 * player counts the rows a patch keeps too.
 */
export function writeProperty(
  host: TestHost,
  inner: Internals,
  view: string,
  property: string,
  p: Record<string, Json>,
  current: Json | undefined,
  typed: TypedView | null = null,
): Json | undefined {
  const slot = `${view}\u0000${property}`;
  // The value the view shows after the write: its type is checked once
  // the value is whole, as the player sets it then.
  const shown = (value: Json) => {
    checkSpelling(property, value);
    if (typed) checkType(typed, property, value, current);
  };
  const patch = p.patch as
    { base?: unknown; seq?: unknown; ops?: unknown } | undefined;
  // A whole array sent in parts (player 0.6.0, SDK 1.5.46): every part but
  // the last carries `more`; the player holds them and writes the whole
  // value at the last, as here (`undefined`: held, nothing shown yet).
  const more = p.more === true;
  const held = inner.parts.get(slot);
  inner.parts.delete(slot);
  if (more && patch === undefined) {
    const rows = shownValues(host, inner, p.value!);
    if (!Array.isArray(rows))
      throw new HostError("invalid", "a value sent in parts is an array");
    noMarkdownParts(rows);
    checkValues(host, inner, { [property]: rows });
    inner.parts.set(slot, {
      seq: typeof p.seq === "number" ? p.seq : 0,
      rows,
    });
    return undefined;
  }
  if (patch !== undefined && held && patch.base === held.seq) {
    const ops = patchOps(patch.ops, held.rows.length);
    const resolved = ops.map((op) =>
      op.op === "set"
        ? { ...op, row: shownValues(host, inner, op.row) }
        : op.op === "insert"
          ? { ...op, rows: op.rows.map((row) => shownValues(host, inner, row)) }
          : op,
    );
    noMarkdownParts(
      resolved.flatMap((op) =>
        op.op === "set" ? [op.row] : op.op === "insert" ? op.rows : [],
      ),
    );
    const rows = applyOps(held.rows, resolved);
    checkValues(host, inner, { [property]: rows });
    if (more) {
      inner.parts.set(slot, { seq: patch.seq as number, rows });
      return undefined;
    }
    shown(rows);
    seeImages(host, inner, [rows]);
    inner.writes.set(slot, patch.seq as number);
    return rows;
  }
  if (patch !== undefined && more)
    throw new HostError(
      "stale",
      "the property changed since the write this patch applies on; send the whole value",
    );
  if (patch === undefined) {
    const value = shownValues(host, inner, p.value!);
    checkValues(host, inner, { [property]: value });
    shown(value);
    seeImages(host, inner, [value]);
    inner.writes.set(slot, typeof p.seq === "number" ? p.seq : 0);
    return value;
  }
  const { base, seq } = patch;
  if (
    !Number.isInteger(base) ||
    !Number.isInteger(seq) ||
    (base as number) < 0 ||
    (seq as number) < 1
  )
    throw new HostError(
      "invalid",
      "patch.base and patch.seq require non-negative integers (seq ≥ 1)",
    );
  const stale = () =>
    new HostError(
      "stale",
      "the property changed since the write this patch applies on; send the whole value",
    );
  if ((inner.writes.get(slot) ?? 0) !== base || !Array.isArray(current))
    throw stale();
  const ops = patchOps(patch.ops, current.length);
  const resolved = ops.map((op) =>
    op.op === "set"
      ? { ...op, row: shownValues(host, inner, op.row) }
      : op.op === "insert"
        ? { ...op, rows: op.rows.map((row) => shownValues(host, inner, row)) }
        : op,
  );
  const value = applyOps(current, resolved);
  checkValues(host, inner, { [property]: value });
  shown(value);
  seeImages(
    host,
    inner,
    resolved.flatMap((op) =>
      op.op === "set" ? [op.row] : op.op === "insert" ? op.rows : [],
    ),
  );
  inner.writes.set(slot, seq as number);
  return value;
}

/**
 * Refuse property values over the player's limits ({@link UI_VALUE_LIMITS})
 * with `limit`, naming the property, as the player does.
 */
export function checkValues(
  _host: TestHost,
  _inner: Internals,
  values: Record<string, Json>,
) {
  for (const [property, value] of Object.entries(values)) {
    const problem = valueLimitProblem(value);
    if (problem) throw new HostError("limit", `${property}: ${problem}`);
  }
}

/**
 * A view's declared property types, with how the player words a refusal
 * there: the error `code`, and `bare` when it reads the property before it
 * writes it (`ui.set`, `ui.setMount`, `settings.set`, a panel's or settings
 * page's initial values), so that an unknown one is refused as "no such
 * property" without its name. Those writes compare first
 * (`ui_values::reconcile_in`): a value equal to what the property holds
 * does nothing, on an `out` property too. `fresh`: the property shows its
 * default although a value is stored (a panel's initial value it could
 * not take).
 */
export interface TypedView {
  types: ViewTypes;
  code: string;
  bare: boolean;
  fresh?: boolean;
}

/**
 * The declared types of the view in `file` of the plugin's package: its
 * exported component, or `global` (a panel's or settings page's). `null`
 * (nothing checked) when the host runs no package or the file cannot be
 * read.
 */
export function typedView(
  host: TestHost,
  file: string,
  global: string | undefined,
  code: string,
  bare: boolean,
): TypedView | null {
  const directory = packageDirectories.get(host);
  const types =
    directory === undefined ? null : viewTypes(directory, file, global);
  return types && { types, code, bare };
}

/** A refusal in the player's words, for a write that reads the property first (`bare`) or not. */
export const refusalText = (found: Refusal, bare: boolean) =>
  bare && found.why === "missing" ? "no such property" : found.message;

/**
 * Refuse a value the player's Slint refuses for `property` (a value of
 * another type than declared, an undeclared or `out` property), with the
 * player's code and words. `current`: what the property shows now (none:
 * its default), which the words describe the declared type by.
 */
export function checkType(
  typed: TypedView,
  property: string,
  value: Json,
  current: Json | undefined,
) {
  const found = refusal(
    typed.types,
    property,
    value,
    typed.fresh ? undefined : current,
    { reconciles: typed.bare },
  );
  if (found) throw new HostError(typed.code, refusalText(found, typed.bare));
}

/**
 * Refuse a struct field name the player's conversion refuses (not in
 * Slint's canonical spelling), whatever the view declares: code `host`,
 * the property named.
 */
export function checkSpelling(property: string, value: Json) {
  const problem = spellingProblem(value);
  if (problem) throw new HostError("host", `${property}: ${problem}`);
}

/** Property names in the order the player sets them (a `BTreeMap`). */
export const inSetOrder = (values: Record<string, Json>) =>
  Object.keys(values).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * A panel's or settings page's initial properties, as the player keeps
 * them: one over the limits is left out (the property keeps its default)
 * and reported with `ui.error`, the request itself succeeds.
 */
export function initialValues(
  host: TestHost,
  _inner: Internals,
  values: Record<string, Json>,
): Record<string, Json> {
  const kept: Record<string, Json> = {};
  for (const [property, value] of Object.entries(values)) {
    const problem = valueLimitProblem(value);
    if (problem)
      host.emit("ui.error", {
        code: "limit",
        message: `${property}: ${problem}`,
      });
    else kept[property] = value;
  }
  return kept;
}

export function seeImages(
  host: TestHost,
  _inner: Internals,
  values: Record<string, Json> | Json[],
) {
  const see = (value: Json) => {
    const path = host.imagePath(value);
    if (path !== null) {
      const { ref, maxSide } = value as { ref?: number; maxSide?: number };
      host.images.push({
        path,
        ref: Number(ref),
        ...(maxSide === undefined ? {} : { maxSide }),
      });
    } else if (value !== null && typeof value === "object")
      for (const item of Object.values(value)) see(item);
  };
  for (const value of Object.values(values)) see(value);
}

export function addPanel(
  host: TestHost,
  _inner: Internals,
  slot: TabSlot,
  panel: LayoutPanel,
) {
  const state = host.layout[slot];
  if (state) state.panels = [...(state.panels ?? []), panel];
  else {
    // The adjust column starts hidden, as the player's.
    const shown = slot !== "adjust";
    host.layout[slot] = {
      owner: panel.owner,
      preferred: shown,
      effective: shown,
      reason: shown ? null : "userHidden",
      detached: false,
      panels: [panel],
    };
  }
}

export function removePanel(
  host: TestHost,
  _inner: Internals,
  slot: TabSlot,
  owner: number,
) {
  const state = host.layout[slot];
  if (!state) return;
  const panels = state.panels ?? [];
  const index = panels.findIndex((panel) => panel.owner === owner);
  const rest = panels.filter((panel) => panel.owner !== owner);
  if (rest.length === 0) {
    host.layout[slot] = null;
    return;
  }
  state.panels = rest;
  if (state.owner === owner)
    state.owner = (rest[index] ?? rest[rest.length - 1]!).owner;
}

/** The panel a request is about: its `slot`, else the only one. */
export function panelFor(
  host: TestHost,
  _inner: Internals,
  p: Record<string, unknown>,
): FakePanel {
  const slot = typeof p.slot === "string" ? p.slot : undefined;
  const panel = slot ? host.panels.get(slot) : host.panel;
  if (!panel) throw new HostError("missing", "owner has no ready mount");
  return panel;
}

/** Implements `TestHost.mountOther`. */
export function mountOther(
  host: TestHost,
  inner: Internals,
  slot: "bottom" | "sidebar" | "adjust" | "backdrop",
  plugin: string,
  options: { title?: string } = {},
) {
  if (inner.others.has(plugin))
    throw new Error(`${plugin} already has a panel`);
  const owner = inner.nextOwner++;
  if (slot === "backdrop") {
    if (host.backdrop) throw new Error("the backdrop is taken");
    host.backdrop = { owner: plugin, effective: true };
  } else {
    if (slot === "bottom" && host.layout.bottom)
      throw new Error("the bottom bar is taken");
    addPanel(host, inner, slot, {
      owner,
      plugin,
      title: options.title ?? plugin,
    });
  }
  inner.others.set(plugin, { slot, owner });
  host.emit("window.state", windowFacts(host, inner));
}

/** Implements `TestHost.unmountOther`. */
export function unmountOther(host: TestHost, inner: Internals, plugin: string) {
  const other = inner.others.get(plugin);
  if (!other) throw new Error(`${plugin} has no panel`);
  inner.others.delete(plugin);
  if (other.slot === "backdrop") host.backdrop = null;
  else removePanel(host, inner, other.slot as TabSlot, other.owner);
  host.emit("window.state", windowFacts(host, inner));
}

/** Implements `TestHost.mounted`. */
export function mounted(
  host: TestHost,
  _inner: Internals,
  slot?: "bottom" | "sidebar" | "adjust" | "backdrop",
): FakePanel {
  if (slot !== undefined) {
    const panel = host.panels.get(slot);
    if (!panel) throw new Error(`no panel mounted in the ${slot}`);
    return panel;
  }
  if (host.panels.size > 1)
    throw new Error(
      `panels are mounted in ${[...host.panels.keys()].join(", ")}: name the slot`,
    );
  if (!host.panel) throw new Error("no panel mounted");
  return host.panel;
}

/** Implements `TestHost.setTimelineRanges`. */
export function setTimelineRanges(
  host: TestHost,
  inner: Internals,
  pluginId: string,
  ranges: {
    start: number;
    end: number;
    style: string;
    title?: string | null;
  }[],
) {
  if (ranges.length)
    host.timeline.rangeLayers.set(
      pluginId,
      ranges.map((r) => ({
        start: r.start,
        end: r.end,
        style: r.style,
        title: r.title ?? null,
      })),
    );
  else host.timeline.rangeLayers.delete(pluginId);
  timelineChanged(host, inner);
}

/** Implements `TestHost.setTimelineLayer`. */
export function setTimelineLayer(
  host: TestHost,
  inner: Internals,
  pluginId: string,
  marks: { time: number; kind: string; title?: string | null }[],
) {
  if (marks.length)
    host.timeline.layers.set(
      pluginId,
      marks.map((m) => ({
        time: m.time,
        kind: m.kind,
        title: m.title ?? null,
      })),
    );
  else host.timeline.layers.delete(pluginId);
  timelineChanged(host, inner);
}

/** The default handlers of this area's wire methods, by method name. */
export function layoutHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    "ui.open": (p) => {
      const id = String(p.id);
      if (host.windows.has(id))
        throw new HostError("conflict", "view already exists");
      resetWrites(host, inner, `w:${id}`);
      const properties = shownValues(
        host,
        inner,
        p.properties as Record<string, Json>,
      );
      checkValues(host, inner, properties);
      // Converted, then set one by one on the new component: the first
      // one refused fails the open (code `host`, the property named).
      for (const name of inSetOrder(properties))
        checkSpelling(name, properties[name]!);
      const typed = typedView(host, String(p.file), undefined, "host", false);
      if (typed)
        for (const name of inSetOrder(properties))
          checkType(typed, name, properties[name]!, undefined);
      seeImages(host, inner, properties);

      host.windows.set(id, {
        file: String(p.file),
        visible: true,
        props: { ...properties },
        callbacks: p.callbacks as string[],
        userClose() {
          host.windows.delete(id);
          host.emit("ui.closed", { view: id });
        },
        emit(callback, ...args) {
          const name = kebab(callback);
          if (!this.callbacks.includes(name))
            throw new Error(`window ${id} did not register callback ${name}`);
          host.emit("ui.callback", { view: id, callback: name, args });
        },
      });
    },
    "ui.set": (p) => {
      const window = host.windows.get(String(p.id));
      if (!window) throw new HostError("missing", "view not found");
      const property = String(p.property);
      const next = writeProperty(
        host,
        inner,
        `w:${String(p.id)}`,
        property,
        p,
        window.props[property],
        typedView(host, window.file, undefined, "ui", true),
      );
      // A part of a value sent in parts is held until the last (player 0.6.0).
      if (next !== undefined) window.props[property] = next;
    },
    "ui.show": (p) => {
      const window = host.windows.get(String(p.id));
      if (!window) throw new HostError("missing", "view not found");
      window.visible = p.visible === true;
    },
    "ui.close": (p) => {
      if (!host.windows.delete(String(p.id)))
        throw new HostError("missing", "view not found");
    },
    "ui.mount": (p) => {
      if (!(String(p.slot) in SLOT_LABELS))
        throw new HostError("invalid", "unknown mount slot");
      // One panel per slot and plugin (player 0.7.6).
      if (host.panels.has(String(p.slot)))
        throw new HostError(
          "conflict",
          "this plugin already has a panel in this slot",
        );
      // Like the player: one panel in the bottom bar and the backdrop, any
      // number of tabs in the sidebar (player 0.7.3; 0.4.x to 0.7.2 took 8)
      // and in the adjust column (player 0.7.6).
      const holder =
        p.slot === "backdrop"
          ? host.backdrop?.owner
          : p.slot === "bottom"
            ? host.layout.bottom?.panels?.[0]?.plugin
            : undefined;
      if (holder !== undefined || (p.slot === "bottom" && host.layout.bottom))
        throw taken(
          hostText(host, inner, "The {} is used by {}", [
            hostText(host, inner, SLOT_LABELS[String(p.slot)]!),
            String(holder),
          ]),
        );
      const properties = initialValues(
        host,
        inner,
        shownValues(host, inner, p.properties as Record<string, Json>),
      );
      const panelSlot = String(p.slot);
      const global = typeof p.global === "string" ? p.global : undefined;
      inner.globals.set(panelSlot, global);
      // A value the panel cannot take is reported with `ui.error` as the
      // player reports it when it builds the panel: first those it cannot
      // convert, then those the panel refuses (named before the refusal).
      // The panel shows its default for them; the value stays stored, as
      // in the player, and a patch applies on it.
      const view = mountView(panelSlot);
      for (const key of [...inner.unshown])
        if (key.startsWith(`${view}\u0000`)) inner.unshown.delete(key);
      const unconverted = new Set<string>();
      for (const name of inSetOrder(properties)) {
        const problem = spellingProblem(properties[name]!);
        if (!problem) continue;
        unconverted.add(name);
        inner.unshown.add(`${view}\u0000${name}`);
        host.emit("ui.error", { code: "host", message: `${name}: ${problem}` });
      }
      const typed =
        global === undefined
          ? null
          : typedView(host, String(p.file), global, "ui", true);
      if (typed)
        for (const name of inSetOrder(properties)) {
          if (unconverted.has(name)) continue;
          const found = refusal(
            typed.types,
            name,
            properties[name]!,
            undefined,
            { reconciles: true },
          );
          if (!found) continue;
          inner.unshown.add(`${view}\u0000${name}`);
          host.emit("ui.error", {
            code: "ui",
            message: `${name}: ${refusalText(found, true)}`,
          });
        }
      seeImages(host, inner, properties);
      resetWrites(host, inner, mountView(panelSlot));

      host.panels.set(panelSlot, {
        slot: panelSlot,
        file: String(p.file),
        component: String(p.component),
        visible: true,
        props: { ...properties },
        locks: null,
        emit(callback, ...args) {
          host.emit("ui.callback", {
            view: "$mount",
            slot: panelSlot,
            callback: kebab(callback),
            args,
          });
        },
      });
      if (p.slot === "backdrop") {
        host.backdrop = { owner: host.manifestId, effective: true };
        return { status: "ready", prepareMs: 0, shellGeneration: 1 };
      }
      const slot = String(p.slot) as TabSlot;
      addPanel(host, inner, slot, {
        owner: 1,
        plugin: host.manifestId,
        title:
          typeof p.title === "string" && p.title
            ? host.translate(p.title)
            : host.manifestId,
      });
      return { status: "ready", prepareMs: 0, shellGeneration: 1 };
    },
    "ui.unmount": (p) => {
      // The slot's panel, or without one every panel (as the player).
      const slots =
        typeof p.slot === "string" ? [p.slot] : [...host.panels.keys()];
      for (const slot of slots) {
        if (!host.panels.delete(slot)) continue;
        if (slot === "backdrop") host.backdrop = null;
        else removePanel(host, inner, slot as TabSlot, 1);
      }
    },
    "ui.menu": (p) => {
      if (!host.panels.size)
        throw new HostError("unavailable", "panel not shown");
      const panel = panelFor(host, inner, p);
      const tabs =
        panel.slot === "sidebar" || panel.slot === "adjust"
          ? host.layout[panel.slot]
          : null;
      if (tabs && tabs.owner !== 1)
        throw new HostError(
          "unavailable",
          "the panel's tab is not the current one",
        );
      const items = p.items as (string | null)[];
      for (const id of items)
        if (id !== null && !host.commands.has(id))
          throw new HostError("missing", `command ${id} not registered`);
      host.menus.push({ items, x: Number(p.x), y: Number(p.y) });
    },
    "layout.state": () => ({
      ...host.layout,
      backdrop: host.backdrop && {
        owner: 1,
        effective: host.backdrop.effective,
      },
    }),
    "layout.set": (p) => {
      const slot = String(p.slot) as TabSlot;
      if (!["bottom", "sidebar", "adjust"].includes(slot))
        throw new HostError("invalid", "unknown slot");
      const state = host.layout[slot];
      if (!state) throw new HostError("missing", "no panel at this position");
      if (p.detached !== undefined && slot === "bottom")
        throw new HostError("invalid", "the bottom bar cannot be detached");
      if (p.detached === true && slot === "adjust")
        throw new HostError("invalid", "the adjust column cannot be detached");
      if (p.active !== undefined && p.active !== null) {
        const panel = state.panels?.find((entry) => entry.plugin === p.active);
        if (!panel)
          throw new HostError(
            "missing",
            `${String(p.active)} has no panel at this position`,
          );
        state.owner = panel.owner;
      }
      if (typeof p.visible === "boolean") {
        const out = state.preferred && state.effective;
        state.preferred = p.visible;
        // In fullscreen a column switched on by a toggle (`reveal: false`)
        // stays collapsed at the edge; `show()` and `setVisible` pop it out.
        const collapsed =
          p.visible &&
          p.reveal === false &&
          slot !== "bottom" &&
          host.mainWindow.fullscreen &&
          !state.detached &&
          !out;
        state.effective = p.visible && !collapsed;
        state.reason = !p.visible
          ? "userHidden"
          : collapsed
            ? "fullscreen"
            : null;
        const panel = host.panels.get(slot);
        if (panel) panel.visible = p.visible;
      }
      if (typeof p.detached === "boolean") state.detached = p.detached;
    },
    "ui.setMount": (p) => {
      const panel = panelFor(host, inner, p);
      const property = String(p.property);
      const global = inner.globals.get(panel.slot);
      const unshown = `${mountView(panel.slot)}\u0000${property}`;
      const typed =
        global === undefined
          ? null
          : typedView(host, panel.file, global, "host", true);
      if (typed) typed.fresh = inner.unshown.has(unshown);
      const next = writeProperty(
        host,
        inner,
        mountView(panel.slot),
        property,
        p,
        panel.props[property],
        typed,
      );
      // A part of a value sent in parts is held until the last (player 0.6.0).
      if (next !== undefined) {
        panel.props[property] = next;
        inner.unshown.delete(unshown);
      }
    },
    "timeline.marks": () => ({
      marks: host.timeline.marks,
      ranges: host.timeline.ranges,
    }),
    "timeline.set": (p) => {
      if (
        p.sourceId !== undefined &&
        p.sourceId !== host.source.stamp.generation
      )
        return { applied: false };
      const sent = p.marks as { time: Json; kind: Json; title?: Json }[];
      const duration = host.source.duration;
      if (!Array.isArray(sent) || sent.length > 1000)
        throw new HostError("invalid", "a layer holds at most 1000 marks");
      const marks = sent.map((mark) => ({ ...mark }));
      for (const mark of marks) {
        const time = mark.time;
        if (
          typeof time !== "number" ||
          !Number.isFinite(time) ||
          time < 0 ||
          (duration !== null && time > duration)
        )
          throw new HostError("invalid", `time ${time} is outside the media`);
        if (!["chapter", "bookmark", "marker"].includes(String(mark.kind)))
          throw new HostError("invalid", "kind is chapter, bookmark or marker");
        // A text value is shown translated (`plugin.i18n.text`).
        if (isTextValue(mark.title))
          mark.title = declaredText(host, inner, mark.title, "title");
        if (
          mark.title !== undefined &&
          mark.title !== null &&
          (typeof mark.title !== "string" || [...mark.title].length > 100)
        )
          throw new HostError("invalid", "title must be ≤ 100 characters");
      }
      host.setTimelineLayer(
        host.manifestId,
        marks.map((m) => ({
          time: m.time as number,
          kind: String(m.kind),
          title: (m.title as string | undefined) ?? null,
        })),
      );
      return { applied: true };
    },
    // Player 0.7.6: the layer's ranges, replaced on their own.
    "timeline.setRanges": (p) => {
      if (
        p.sourceId !== undefined &&
        p.sourceId !== host.source.stamp.generation
      )
        return { applied: false };
      const sent = p.ranges as {
        start: Json;
        end: Json;
        style: Json;
        title?: Json;
      }[];
      const duration = host.source.duration;
      if (!Array.isArray(sent) || sent.length > TIMELINE_LIMITS.ranges)
        throw new HostError(
          "invalid",
          `a layer holds at most ${TIMELINE_LIMITS.ranges} ranges`,
        );
      const ranges = sent.map((range) => ({ ...range }));
      for (const range of ranges) {
        const { start, end } = range;
        const time = (t: Json) =>
          typeof t === "number" && Number.isFinite(t) && t >= 0;
        if (!time(start) || !time(end))
          throw new HostError("invalid", "start and end must be numbers ≥ 0");
        if ((end as number) <= (start as number))
          throw new HostError(
            "invalid",
            `end ${end} must be after start ${start}`,
          );
        // As the player (timeline.rs): 1e-6 s of rounding past the end is allowed.
        if (duration !== null && (end as number) > duration + 1e-6)
          throw new HostError(
            "invalid",
            `end ${end} is after the end of the media`,
          );
        if (!["selection", "region"].includes(String(range.style)))
          throw new HostError("invalid", "style is selection or region");
        if (isTextValue(range.title))
          range.title = declaredText(host, inner, range.title, "title");
        if (
          range.title !== undefined &&
          range.title !== null &&
          (typeof range.title !== "string" ||
            [...range.title].length > TIMELINE_LIMITS.titleChars)
        )
          throw new HostError(
            "invalid",
            `title must be ≤ ${TIMELINE_LIMITS.titleChars} characters`,
          );
      }
      host.setTimelineRanges(
        host.manifestId,
        ranges.map((r) => ({
          start: r.start as number,
          end: r.end as number,
          style: String(r.style),
          title: (r.title as string | undefined) ?? null,
        })),
      );
      return { applied: true };
    },
    "ui.interaction": (p) => {
      const { slot: _, ...locks } = p;
      panelFor(host, inner, p).locks = locks as Json;
    },
    "ui.markdownScan": (p) => {
      const text = String(p.text);
      const images = [
        ...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g),
      ].map((m) => m[1]!);
      return { images: [...new Set(images)].slice(0, 64) };
    },
  };
}
