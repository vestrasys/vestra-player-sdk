/**
 * Player services: secrets, session storage, clipboard, system, tools,
 * power, dialogs, drops, settings pages, the main window and packages.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { statSync } from "node:fs";
import { HostError } from "../../wire.ts";
import type { PackageSource } from "../types.ts";
import type { Json, WireSystemInfo } from "../../wire.ts";
import { SESSION_STORAGE_LIMITS } from "../services.ts";
import { validStep } from "../player/rules.ts";
import type { FileDialogText, TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";
import { runCore, windowFacts } from "./core-actions.ts";
import { shownText, declaredText, shownValues, hostText } from "./i18n.ts";
import {
  resetWrites,
  writeProperty,
  initialValues,
  seeImages,
  kebab,
  typedView,
  checkType,
  inSetOrder,
} from "./layout.ts";

/** A `plugin.storage.session` key, checked as the player does. */
export function sessionKey(key: Json | undefined): string {
  if (
    typeof key !== "string" ||
    !key ||
    key.includes("\0") ||
    Buffer.byteLength(key) > SESSION_STORAGE_LIMITS.keyBytes
  )
    throw new HostError(
      "invalid",
      "session storage keys are 1–1024 bytes of text without NUL",
    );
  return key;
}

/** Code point (UTF-8 byte) order, as the player sorts session keys. */
export const byCodePoint = (a: string, b: string) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * A JSON value as the player hands it back: the player does not keep the
 * order of object properties, it sorts them.
 */
export function sortedJson(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort(byCodePoint)
        .map((key) => [key, sortedJson((value as Record<string, Json>)[key]!)]),
    );
  return value;
}

/** What one session entry counts towards the player's quota. */
export const sessionCost = (key: string, value: Json) =>
  Buffer.byteLength(key) +
  Buffer.byteLength(JSON.stringify(value)) +
  SESSION_STORAGE_LIMITS.entryBytes;

export function validatePackage(
  host: TestHost,
  _inner: Internals,
  path: string,
) {
  const manifest = host.candidates.get(path);
  if (!manifest) throw new HostError("missing", `no test package at ${path}`);
  return {
    token: path,
    digest: "0".repeat(64),
    apiVersion: "vestra/1",
    manifest: structuredClone(manifest),
    checks: ["manifest", "digest", "productionJavaScript", "slintCompile"],
    trustedExecution: true,
  };
}

/** Implements `TestHost.drop`. */
export function drop(
  host: TestHost,
  _inner: Internals,
  paths: string[],
  options: {
    target?: "video" | "panel";
    at?: { x: number; y: number };
    modifiers?: Partial<{ alt: boolean; shift: boolean; cmd: boolean }>;
  } = {},
) {
  const modifiers = {
    alt: false,
    shift: false,
    cmd: false,
    ...options.modifiers,
  };
  if (options.target === "panel" && host.panelDrops) {
    host.emit("drops.panel", {
      paths,
      at: options.at ?? { x: 0, y: 0 },
      modifiers,
    });
    return host.settle();
  }
  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const kind = statSync(path, { throwIfNoEntry: false })?.isDirectory()
      ? "folder"
      : (/\.([^./]+)$/.exec(path)?.[1]?.toLowerCase() ?? "");
    const provider = host.dropProviders.find((p) =>
      p.extensions.includes(kind),
    );
    if (provider)
      groups.set(provider.id, [...(groups.get(provider.id) ?? []), path]);
  }
  for (const [id, group] of groups)
    host.emit("drops.drop", { id, paths: group, modifiers });
  return host.settle();
}

/** Implements `TestHost.setMainWindow`. */
export function setMainWindow(
  host: TestHost,
  inner: Internals,
  patch: Partial<{
    fullscreen: boolean;
    maximized: boolean;
    videoArea: { width: number; height: number };
    pictureInPicture: { supported: boolean; active: boolean };
  }>,
) {
  const entering =
    patch.fullscreen !== undefined &&
    patch.fullscreen !== host.mainWindow.fullscreen;
  Object.assign(host.mainWindow, patch);
  // Like the player (reference §6.3): in fullscreen the attached columns
  // (the sidebar, the adjust column) start collapsed at the right edge;
  // leaving fullscreen docks them again.
  for (const column of [host.layout.sidebar, host.layout.adjust]) {
    if (entering && column && column.preferred && !column.detached) {
      column.effective = !host.mainWindow.fullscreen;
      column.reason = host.mainWindow.fullscreen ? "fullscreen" : null;
    }
  }
  host.emit("window.state", windowFacts(host, inner));
}

/** The default handlers of this area's wire methods, by method name. */
export function servicesHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    // The player validates again; these mirror what reaches it.
    "system.reveal": (p) =>
      void host.system.revealed.push(...(p.paths as string[])),
    "system.openPath": (p) => void host.system.opened.push(String(p.path)),
    "system.openUrl": (p) => void host.system.urls.push(String(p.url)),
    "secrets.get": (p) => host.secrets.get(String(p.name)) ?? null,
    "secrets.set": (p) => {
      const name = String(p.name);
      if (!host.secrets.has(name) && host.secrets.size >= 256)
        throw new HostError(
          "limit",
          "a plugin stores at most 256 secret names",
        );
      host.secrets.set(name, String(p.value));
    },
    "secrets.delete": (p) => void host.secrets.delete(String(p.name)),
    // As the player (src/host/src/session_storage.rs).
    "storage.session.get": (p) => {
      const key = sessionKey(p.key);
      return host.sessionStorage.has(key)
        ? { value: structuredClone(host.sessionStorage.get(key)) }
        : {};
    },
    "storage.session.set": (p) => {
      const key = sessionKey(p.key);
      if (!("value" in p))
        throw new HostError("invalid", "set needs a JSON value");
      let total = sessionCost(key, p.value!);
      for (const [other, value] of host.sessionStorage)
        if (other !== key) total += sessionCost(other, value);
      if (total > SESSION_STORAGE_LIMITS.bytes)
        throw new HostError(
          "limit",
          `session storage holds at most ${SESSION_STORAGE_LIMITS.bytes} bytes per plugin (keys, JSON values and ${SESSION_STORAGE_LIMITS.entryBytes} per key); this value would make ${total}`,
        );
      host.sessionStorage.set(key, sortedJson(p.value!));
    },
    "storage.session.delete": (p) =>
      void host.sessionStorage.delete(sessionKey(p.key)),
    "storage.session.keys": () =>
      [...host.sessionStorage.keys()].sort(byCodePoint),
    "app.system": (): WireSystemInfo => ({
      ...structuredClone(host.systemInfo),
      rendering: host.videoRender.gpu ? "gpu" : "software",
      renderingReason: { ...host.rendering.reason },
    }),
    "clipboard.readText": () => host.clipboard.text,
    "clipboard.writeText": (p) => {
      if (typeof p.text !== "string")
        throw new HostError("invalid", "text requires a string");
      if (Buffer.byteLength(p.text) > 1024 * 1024)
        throw new HostError("invalid", "text must be at most 1 MiB");
      host.clipboard.text = p.text;
    },
    "clipboard.writeImage": (p) => {
      const path = String(p.path);
      if (!path.startsWith("/"))
        throw new HostError("invalid", "image path must be absolute");
      if (!/\.(png|jpe?g)$/i.test(path))
        throw new HostError("invalid", "image must be PNG or JPEG");
      host.clipboard.images.push(path);
    },
    "host.run": (p) => {
      const actions = [
        "play-pause",
        "stop",
        "previous",
        "next",
        "frame-back",
        "frame-forward",
        "seek-backward",
        "seek-forward",
        "rate-down",
        "rate-up",
        "rate-normal",
        "volume-up",
        "volume-down",
        "mute",
        "fullscreen",
      ];
      if (!actions.includes(String(p.action)))
        throw new HostError("invalid", `unknown host action ${p.action}`);
      // SDK 1.5.19: one step seek of another step.
      let seconds: number | undefined;
      if (p.seconds !== undefined && p.seconds !== null) {
        if (p.action !== "seek-backward" && p.action !== "seek-forward")
          throw new HostError(
            "invalid",
            `seconds applies only to seek-backward and seek-forward, not ${p.action}`,
          );
        if (!validStep(p.seconds))
          throw new HostError("invalid", "seconds must be 0.1..3600 in tenths");
        seconds = p.seconds;
      }
      // SDK 1.5.21: the main window's Toggle Fullscreen, like Escape: in when
      // windowed, out when fullscreen, then `window.state`.
      if (p.action === "fullscreen") {
        host.coreRuns.push("fullscreen");
        host.setMainWindow({ fullscreen: !host.mainWindow.fullscreen });
        return;
      }
      runCore(host, inner, String(p.action), seconds);
    },
    "power.preventSleep": (p) => {
      if (p.mode !== "off" && p.mode !== "playing")
        throw new HostError("invalid", 'mode must be "off" or "playing"');
      host.power = p.mode;
    },
    "drops.provide": (p) => {
      const id = String(p.id);
      const index = host.dropProviders.findIndex((d) => d.id === id);
      if (index >= 0) host.dropProviders.splice(index, 1);
      host.dropProviders.push({ id, extensions: p.extensions as string[] });
    },
    "drops.withdraw": (p) => {
      const index = host.dropProviders.findIndex((d) => d.id === String(p.id));
      if (index >= 0) host.dropProviders.splice(index, 1);
    },
    "drops.listen": (p) => void (host.panelDrops = p.listen === true),
    "settings.register": (p) => {
      const id = String(p.id);
      if (host.settings.pages.has(id))
        throw new HostError("invalid", `page ${id} already exists`);
      if (host.settings.pages.size >= 8)
        throw new HostError("invalid", "a plugin has at most 8 settings pages");
      const properties = initialValues(
        host,
        inner,
        shownValues(host, inner, p.properties as Record<string, Json>),
      );
      // Stricter than the player, which sets a page's values when the
      // Options window shows it (and fails to show it, code `ui`): the
      // test host checks their types when they are written, so a test
      // need not open the window.
      const typed = typedView(
        host,
        String(p.file),
        String(p.global),
        "ui",
        true,
      );
      if (typed)
        for (const name of inSetOrder(properties))
          checkType(typed, name, properties[name]!, undefined);
      seeImages(host, inner, properties);
      resetWrites(host, inner, `$settings:${id}`);

      host.settings.pages.set(id, {
        category: String(p.category),
        title: host.translate(String(p.title)),
        order: Number(p.order ?? 0),
        file: String(p.file),
        component: String(p.component),
        global: String(p.global),
        props: { ...properties },
        emit(callback, ...args) {
          host.emit("ui.callback", {
            view: `$settings:${id}`,
            callback: kebab(callback),
            args,
          });
        },
      });
    },
    "settings.set": (p) => {
      const page = host.settings.pages.get(String(p.id));
      if (!page) throw new HostError("missing", "page not registered");
      const property = String(p.property);
      const next = writeProperty(
        host,
        inner,
        `$settings:${String(p.id)}`,
        property,
        p,
        page.props[property],
        typedView(host, page.file, page.global, "ui", true),
      );
      // A part of a value sent in parts is held until the last (player 0.6.0).
      if (next !== undefined) page.props[property] = next;
    },
    "settings.unregister": (p) => {
      host.settings.pages.delete(String(p.id));
      if (host.settings.current === String(p.id))
        host.settings.current = [...host.settings.pages.keys()][0] ?? null;
    },
    "settings.show": (p) => {
      const id = p.id === undefined ? null : String(p.id);
      if (id !== null && !host.settings.pages.has(id))
        throw new HostError("invalid", "not a settings page of this plugin");
      host.settings.shows.push(id);
      host.settings.open = true;
      host.settings.current =
        id ??
        (host.settings.current && host.settings.pages.has(host.settings.current)
          ? host.settings.current
          : ([...host.settings.pages.keys()][0] ?? null));
    },
    "dialogs.confirm": (p) => {
      host.confirms.push(p);
      const shown = (field: string, formatted = false) =>
        p[field] === undefined
          ? undefined
          : shownText(
              host,
              inner,
              p[field],
              formatted && typeof p[field] === "string" ? p.args : undefined,
              field,
            );
      host.confirmTexts.push({
        message: shown("message", true)!,
        ...(p.detail === undefined ? {} : { detail: shown("detail", true)! }),
        confirm: shown("confirm")!,
        cancel: shown("cancel") ?? hostText(host, inner, "Cancel"),
        ...(p.checkbox === undefined ? {} : { checkbox: shown("checkbox")! }),
      });
      const answer = host.dialogAnswers.shift();
      if (answer === undefined)
        throw new Error("test host: no dialog answer queued");
      if (answer === null || Array.isArray(answer))
        throw new Error("test host: a file dialog answer was queued");
      return { confirmed: answer.confirmed, checked: answer.checked };
    },
    "window.state": () => windowFacts(host, inner),
    "window.setVideoArea": (p) => {
      if (host.mainWindow.fullscreen)
        throw new HostError(
          "unavailable",
          hostText(host, inner, "Not available in fullscreen"),
        );
      const width = Math.max(318, Number(p.width));
      const height = Math.max(120, Number(p.height));
      const clamped = width !== p.width || height !== p.height;
      host.setMainWindow({ videoArea: { width, height } });
      return { width, height, clamped };
    },
    "window.setAlwaysOnTop": (p) =>
      void (host.mainWindow.onTop = p.onTop === true),
    "window.setCursorAutoHide": (p) => {
      if (p.mode !== "fullscreen" && p.mode !== "playing")
        throw new HostError("invalid", "mode is fullscreen or playing");
      host.mainWindow.cursorAutoHide = p.mode;
    },
    "window.setPictureInPicture": (p) => {
      if (typeof p.on !== "boolean")
        throw new HostError("invalid", "on requires a boolean");
      const pip = host.mainWindow.pictureInPicture;
      if (p.on === pip.active) return;
      if (p.on && !pip.supported)
        throw new HostError(
          "unsupported",
          hostText(
            host,
            inner,
            "Picture-in-picture is not supported on this system",
          ),
        );
      const video =
        host.source.phase !== "empty" && host.source.hasVideo !== false;
      if (p.on && !video)
        throw new HostError("unavailable", hostText(host, inner, "No video"));
      host.setMainWindow({
        // The player leaves fullscreen before the window opens.
        fullscreen: p.on ? false : host.mainWindow.fullscreen,
        pictureInPicture: { ...pip, active: p.on },
      });
    },
    "dialogs.open": (p) => {
      const title =
        p.title === undefined
          ? undefined
          : declaredText(host, inner, p.title, "title");
      // A string file name is data; a text is shown translated, a path
      // separator in the translation replaced.
      const fileName =
        p.fileName === undefined
          ? undefined
          : typeof p.fileName === "string"
            ? p.fileName
            : declaredText(host, inner, p.fileName, "fileName").replace(
                /[/\\]/g,
                "-",
              );
      host.fileDialogs.push({
        kind: String(p.kind) as FileDialogText["kind"],
        ...(title === undefined ? {} : { title }),
        ...(fileName === undefined ? {} : { fileName }),
      });
      const answer = host.dialogAnswers.shift();
      if (answer === undefined)
        throw new Error("test host: no dialog answer queued");
      if (answer !== null && !Array.isArray(answer))
        throw new Error("test host: a confirm answer was queued");
      return answer
        ? { cancelled: false, paths: answer }
        : { cancelled: true, paths: [] };
    },
    "packages.list": () => structuredClone(host.packages),
    "packages.setEnabled": (p) => {
      const id = String(p.id);
      if (id === host.manifestId && p.enabled === false)
        throw new HostError("invalid", "a plugin cannot disable itself");
      const entry = host.packages.find((each) => each.id === id);
      if (!entry) throw new HostError("missing", `no plugin ${id}`);
      // As the player (with SDK 1.5.18 on): users manage third-party plugins only.
      if (entry.builtin && p.enabled === false)
        throw new HostError(
          "unsupported",
          `${id} is a built-in plugin: built-in plugins cannot be disabled`,
        );
      host.packageCalls.push({
        method: "setEnabled",
        id,
        enabled: p.enabled === true,
      });
      entry.state = p.enabled === true ? "running" : "disabled";
      host.setPackages(host.packages);
    },
    // As the player (SDK 1.5.19): stop and start again, built-ins included;
    // `packages.changed` shows `starting`, then `running`.
    "packages.reload": (p) => {
      const id = String(p.id);
      if (id === host.manifestId)
        throw new HostError("invalid", "a plugin cannot reload itself");
      const entry = host.packages.find((each) => each.id === id);
      if (!entry) throw new HostError("missing", `no plugin ${id}`);
      if (entry.state === "starting")
        throw new HostError(
          "busy",
          "the package is being installed or reloaded",
        );
      if (entry.state === "disabled")
        throw new HostError(
          "invalid",
          `${id} is disabled: enable it instead of reloading it`,
        );
      host.packageCalls.push({ method: "reload", id });
      entry.state = "starting";
      entry.error = null;
      host.setPackages(host.packages);
      setTimeout(() => {
        entry.state = "running";
        host.setPackages(host.packages);
      }, 0);
    },
    "packages.validate": (p) =>
      validatePackage(host, inner, String(p.directory)),
    "packages.validateArchive": (p) =>
      validatePackage(host, inner, String(p.file)),
    "packages.install": (p) => {
      const manifest = host.candidates.get(String(p.token));
      if (!manifest) throw new HostError("stale", "unknown validation token");
      const source = (p.source as PackageSource | undefined) ?? {
        kind: "file",
      };
      if (source.kind === "bundled")
        throw new HostError("invalid", "source bundled is reserved");
      const replace = p.replace === true;
      // As player 0.6.4: `enabled` is a boolean, or absent (`null` too).
      const requested = p.enabled ?? undefined;
      if (requested !== undefined && typeof requested !== "boolean")
        throw new HostError("invalid", "enabled must be a boolean");
      const entry = host.packages.find((each) => each.id === manifest.id);
      if (entry?.builtin)
        throw new HostError(
          "unsupported",
          "built-in plugins are updated with the player",
        );
      const identity = (s: PackageSource | null | undefined) =>
        !s || s.kind === "link" || s.kind === "file"
          ? "manual"
          : s.kind === "repository"
            ? `repository ${s.url}`
            : s.kind;
      if (entry && identity(entry.source) !== identity(source) && !replace)
        throw new HostError(
          "conflict",
          `${manifest.id} is installed from another source`,
        );
      host.packageCalls.push({
        method: "install",
        id: manifest.id,
        source,
        replace,
        ...(requested === undefined ? {} : { enabled: requested }),
      });
      // As player 0.6.4: a first install runs; an update or reinstall (any
      // source, `replace` included) keeps a disabled plugin disabled unless
      // `enabled` is given. Players up to 0.6.3 run every install.
      const enabled = !host.installKeepsDisabled
        ? true
        : (requested ?? entry?.state !== "disabled");
      const next = {
        id: manifest.id,
        version: manifest.version,
        origin: "installed" as const,
        state: enabled ? ("running" as const) : ("disabled" as const),
        error: null,
        capabilities: [...manifest.capabilities],
        directory: `/test-host/packages/${manifest.id}`,
        builtin: false,
        source,
        dataDirectory: entry?.dataDirectory ?? null,
      };
      host.setPackages([
        ...host.packages.filter((each) => each.id !== manifest.id),
        next,
      ]);
      return { operationId: String(p.requestId), status: "committed" };
    },
    "packages.uninstall": (p) => {
      const id = String(p.id);
      const entry = host.packages.find((each) => each.id === id);
      if (!entry) throw new HostError("missing", `no plugin ${id}`);
      if (entry.builtin)
        throw new HostError(
          "unsupported",
          "built-in plugins cannot be uninstalled",
        );
      if (entry.origin !== "installed")
        throw new HostError(
          "unsupported",
          "only installed plugins can be uninstalled",
        );
      host.packageCalls.push({
        method: "uninstall",
        id,
        removeData: p.removeData === true,
      });
      host.setPackages(host.packages.filter((each) => each.id !== id));
      return { operationId: String(p.requestId), status: "committed" };
    },
    "packages.installed": (p) => ({
      revision: host.packages.some((each) => each.id === p.id) ? 1 : 0,
      current: null,
      previous: null,
    }),
  };
}
