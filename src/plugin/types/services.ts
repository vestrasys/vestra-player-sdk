// Services category: clipboard, power, tools, storage, system, secrets, rendering.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { Disposable } from "./base.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Plugin, SystemInfo } from "./base.ts";
import type { RenderOptions } from "./processing.ts";
/* oxlint-enable no-unused-vars */

// ---------------------------------------------------------------- shared services

/**
 * The system clipboard (`clipboard`). Unavailable without a user interface.
 *
 * Platforms: macOS writes text as UTF-8 and images as their original
 * PNG/JPEG bytes; Windows writes Unicode text and images as a bitmap plus
 * PNG. Other systems: `unsupported`. Failures: `invalid`, `missing`,
 * `unavailable`, `failed` (the system refused).
 *
 * @example Copy the current file and position
 * The clipboard holds "path @ seconds" for pasting into a note. The
 * player writes the system clipboard; it rejects with `unsupported` on
 * systems other than macOS and Windows and `failed` when the system
 * refuses, which the plugin reports.
 * ```ts
 * const { source, position } = plugin.player.state;
 * try {
 *   await plugin.clipboard.writeText(`${source} @ ${position}`); // data, not shown
 * } catch (error) {
 *   void plugin.osd.show("Could not copy: {}", [(error as PluginError).code]);
 * }
 * ```
 *
 * @remarks
 * The player reads and writes the system clipboard on the plugin's behalf.
 * Text is plain text; images are written from a PNG or JPEG file.
 *
 * @capability clipboard
 * @since 1.0.0
 * @category Services
 */
export interface Clipboard {
  /**
   * Plain text on the clipboard; `null` when it holds none.
   *
   * @capability clipboard
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   * @throws `failed` (rejects) The system refused (Windows).
   * @throws `capability` (rejects) The manifest does not declare
   *   `clipboard`.
   *
   * @example Open a URL the user copied
   * A "Paste and play" command opens the address on the clipboard. `readText`
   * resolves with the clipboard's text, or `null` when it holds none (an
   * image, nothing).
   * ```ts
   * const text = await plugin.clipboard.readText();
   * if (text?.startsWith("https://")) await plugin.player.open(text.trim());
   * ```
   *
   * @since 1.0.0
   */
  readText(): Promise<string | null>;
  /**
   * Replace the clipboard with text (at most 1 MiB of UTF-8).
   *
   * @capability clipboard
   * @throws `invalid` (rejects) More than 1 MiB of UTF-8.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   * @throws `failed` (rejects) The system refused.
   * @throws `capability` (rejects) The manifest does not declare
   *   `clipboard`.
   *
   * @example Copy the playing file's path
   * The path of the playing file is put on the clipboard, replacing what was
   * there. It resolves once the system has it.
   * ```ts
   * const { source } = plugin.player.state;
   * if (source) await plugin.clipboard.writeText(source);
   * ```
   *
   * @since 1.0.0
   */
  writeText(text: string): Promise<void>;
  /**
   * Replace the clipboard with a PNG or JPEG file (absolute path, at most 16 MB).
   *
   * @capability clipboard
   * @throws `missing` (rejects) The file does not exist.
   * @throws `invalid` (rejects) Not an absolute path, not PNG or JPEG, over
   *   16 MB, or (Windows) an image the system cannot decode.
   * @throws `unavailable` (rejects) The player runs without a user interface.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   * @throws `failed` (rejects) The system refused.
   * @throws `capability` (rejects) The manifest does not declare
   *   `clipboard`.
   *
   * @example Copy a snapshot to the clipboard
   * A frame the plugin saved as PNG is put on the clipboard, ready to paste
   * into another application. The player reads the file and writes the
   * image (macOS: its original bytes; Windows: a bitmap plus PNG).
   * ```ts
   * declare const pngPath: string;
   * // ---cut---
   * await plugin.clipboard.writeImage(pngPath); // absolute path, at most 16 MB
   * await plugin.osd.show("Snapshot copied");
   * ```
   *
   * @since 1.0.0
   */
  writeImage(path: string): Promise<void>;
}

/**
 * Keeping the computer awake.
 *
 * @remarks
 * A request, not a command: the player keeps the system awake while any
 * plugin asks for it and a source plays, and withdraws a plugin's request
 * when it stops.
 *
 * @capability None.
 *
 * @example Keep the display on while playing
 * The screen does not dim or sleep while a video plays, and may again when
 * it is paused or ends. The player takes the system's assertion only while
 * a source is ready and not paused.
 * ```ts
 * await plugin.power.preventSleep("playing"); // "off" withdraws the request
 * ```
 *
 * @since 1.0.0
 * @category Services
 */
export interface Power {
  /**
   * `"playing"`: while a source is ready and not paused, keep the display
   * (video) or the system (audio only) from sleeping. Any plugin asking is
   * enough; a stopped plugin's request is withdrawn.
   *
   * It only registers the request (`invalid` for a bad mode); failures to
   * take the system assertion are logged by the player, not reported.
   * macOS uses `caffeinate`, Windows the thread execution state; elsewhere
   * it has no effect.
   *
   * @capability None.
   * @throws `invalid` (rejects) A mode other than `"off"` or `"playing"`.
   *
   * @example Follow the plugin's own "Keep awake" setting
   * The plugin keeps the display awake during playback only while its
   * setting is on. Each call replaces this plugin's request; `"off"`
   * withdraws it, and other plugins' requests still count.
   * ```ts
   * const store = plugin.storage.json("power", { defaults: { keepAwake: true } });
   * await plugin.power.preventSleep(store.value.keepAwake ? "playing" : "off");
   * ```
   *
   * @since 1.0.0
   */
  preventSleep(mode: "off" | "playing"): Promise<void>;
}

/**
 * The output of {@link Tools.run}.
 *
 * @see {@link Tools.run}
 * @since 1.0.0
 * @category Services
 */
export interface ToolResult {
  /** Standard output (at most `maxOutput` bytes). */
  stdout: Uint8Array;
  /** The last 64 KiB of standard error. */
  stderr: string;
}

/**
 * `plugin.tools`: ffmpeg and ffprobe, run in this plugin's process. No
 * capability.
 *
 * @example Read a file's format with ffprobe
 * The plugin gets a media file's container details as JSON. `available`
 * says whether ffprobe can be found (`VESTRA_FFPROBE`, then `PATH`); `run`
 * starts it from the plugin's own process without a shell and resolves
 * with its output as bytes once it exits, or rejects when it fails
 * (`failed`, with the last stderr line) or takes longer than `timeoutMs`.
 * ```ts
 * declare const path: string;
 * // ---cut---
 * if (await plugin.tools.available("ffprobe")) {
 *   const { stdout } = await plugin.tools.run(
 *     "ffprobe",
 *     ["-v", "error", "-show_format", "-of", "json", path],
 *     { timeoutMs: 10_000 }, // give up on a stuck file after 10 s
 *   );
 *   const info = JSON.parse(new TextDecoder().decode(stdout));
 *   void info.format; // container, duration, bit rate…
 * }
 * ```
 *
 * @remarks
 * ffmpeg and ffprobe run as child processes of the plugin. When
 * `VESTRA_FFMPEG` / `VESTRA_FFPROBE` is set, only that path is used (an
 * invalid one means the tool is not found); otherwise the tool is searched
 * on `PATH`. A found path is kept for the plugin's run, a miss is looked up
 * again next time. Disposing the
 * scope ends a running process.
 *
 * @capability None.
 * @since 1.0.0
 * @category Services
 */
export interface Tools {
  /**
   * Run ffmpeg or ffprobe (`VESTRA_FFMPEG` / `VESTRA_FFPROBE` when set, else
   * found on `PATH`) without a shell. Rejects `unavailable` (not found), `timeout`,
   * `failed` (non-zero exit; `message` is the last stderr line), `invalid`
   * (output over `maxOutput`, default 16 MiB), `aborted` (`signal`). Timeout,
   * `signal` and disposing the scope end the process.
   *
   * Arguments are passed as-is (no quoting needed). On Windows `PATHEXT` is
   * honoured. Ending sends SIGTERM, then SIGKILL after 300 ms (immediate on
   * Windows).
   *
   * @capability None.
   * @throws `unavailable` (rejects) The tool was not found.
   * @throws `timeout` (rejects) It ran longer than `timeoutMs`; the process is
   *   ended.
   * @throws `failed` (rejects) A non-zero exit; `message` is the last stderr
   *   line.
   * @throws `invalid` (rejects) Bad arguments or options, or output over
   *   `maxOutput`.
   * @throws `aborted` (rejects) `signal` aborted, or the scope was disposed.
   *
   * @example Cut a clip without re-encoding
   * The plugin writes the first ten seconds of the file to a new file. `run`
   * starts ffmpeg without a shell (arguments pass as they are, no quoting)
   * and resolves with its output once it exits with 0; a failure rejects
   * with the last line ffmpeg printed.
   * ```ts
   * declare const input: string;
   * declare const output: string;
   * // ---cut---
   * await plugin.tools.run(
   *   "ffmpeg",
   *   ["-y", "-i", input, "-t", "10", "-c", "copy", output],
   *   { timeoutMs: 60_000 }, // give up after a minute
   * );
   * ```
   *
   * @since 1.0.0
   */
  run(
    tool: "ffmpeg" | "ffprobe",
    args: string[],
    options: { timeoutMs: number; maxOutput?: number; signal?: AbortSignal },
  ): Promise<ToolResult>;
  /**
   * Whether the tool can be found.
   *
   * @capability None.
   * @throws Never; it resolves `false` when the tool cannot be found.
   *
   * @example Grey out a command when ffmpeg is missing
   * The Export item is disabled with a reason when ffmpeg is not installed.
   * `available` looks the tool up (a found path is kept, a miss is looked
   * up again on the next call, so installing it later is noticed).
   * ```ts
   * const hasFfmpeg = await plugin.tools.available("ffmpeg");
   * plugin.commands.add({
   *   id: "export",
   *   path: ["@video", "Export…"],
   *   enabled: hasFfmpeg,
   *   // Shown with the greyed-out item.
   *   reason: hasFfmpeg ? null : "Install ffmpeg to export",
   *   run() {},
   * });
   * ```
   *
   * @since 1.0.0
   */
  available(tool: "ffmpeg" | "ffprobe"): Promise<boolean>;
}

/**
 * A JSON file `dataDirectory/<name>.json`, loaded once and saved debounced.
 *
 * @remarks
 * One JSON file, `<dataDirectory>/<name>.json`, made by
 * {@link Storage.json}. `value` is read once when the store is made;
 * `save` replaces it in memory at once and writes the file `debounceMs`
 * later (300 by default) through a temporary file and a rename, so a
 * crash never leaves half a file. Writes to one file run one at a time,
 * newest last. Disposing the store, its scope or stopping the plugin
 * writes a pending save first.
 *
 * @capability None.
 *
 * @example Count how often the plugin was started
 * The counter grows by one at every start and is kept in `stats.json`. The
 * store reads the file when it is made (the defaults when there is none),
 * and `save` writes the new count a moment later.
 * ```ts
 * const stats = plugin.storage.json("stats", { defaults: { starts: 0 } });
 * stats.save({ starts: stats.value.starts + 1 }); // written 300 ms later
 * ```
 *
 * @since 1.0.0
 * @category Services
 */
export interface JsonStore<T> extends Disposable {
  /** The loaded value, or `defaults` when the file was missing or broken. */
  readonly value: T;
  /**
   * Replace the value now and write it after `debounceMs`.
   * Only `save` writes: mutating `value` in place is not saved.
   *
   * @capability None.
   *
   * @example Save a slider value without writing on every move
   * Dragging the plugin's volume slider updates the stored value at once but
   * writes the file only once the user stops for 300 ms. Each `save`
   * replaces the value and restarts the debounce timer.
   * ```ts
   * declare const volumeWindow: Window;
   * // ---cut---
   * const store = plugin.storage.json("prefs", { defaults: { volume: 100 } });
   * volumeWindow.on("volumeChanged", (volume: number) => store.save({ ...store.value, volume }));
   * ```
   *
   * @since 1.0.0
   */
  save(next: T): void;
  /**
   * Write a pending save now.
   *
   * @capability None.
   * @throws `Error` (rejects) Node's file system error when the file cannot
   *   be written; its `code` is Node's (`ENOSPC`, `EACCES` and so on), not a
   *   player error code.
   *
   * @example Write the file now before copying it
   * Before exporting its settings, the plugin makes sure the file on disk has
   * the latest value. `flush` writes a pending save at once (or waits for
   * the write in progress) and resolves when the file is written.
   * ```ts
   * import { copyFile } from "node:fs/promises";
   * import { join } from "node:path";
   * declare const exportPath: string;
   * // ---cut---
   * const store = plugin.storage.json("settings", { defaults: { step: 5 } });
   * await store.flush(); // the file now has the newest value
   * await copyFile(join(plugin.dataDirectory, "settings.json"), exportPath);
   * ```
   *
   * @since 1.0.0
   */
  flush(): Promise<void>;
}

/**
 * `plugin.storage`: JSON settings files. No capability.
 *
 * @remarks
 * Two kinds of storage, both private to the plugin and needing no
 * capability. {@link Storage.json} keeps settings in JSON files in the
 * plugin's data directory: they last across player restarts and upgrades,
 * and are written by the plugin's own process. {@link Storage.session}
 * keeps values in the player's memory for one player run: they survive a
 * restart of the plugin's process but not of the player. Secrets belong in
 * {@link Secrets}, never in either.
 *
 * @capability None.
 *
 * @example Keep a setting across restarts and a queue for this run
 * The plugin's step size survives a restart of the player; its work queue
 * survives a reload of the plugin but starts empty with the next player
 * run. The JSON store reads its file at once and writes it shortly after
 * each `save`; session values live in the player process.
 * ```ts
 * const settings = plugin.storage.json("settings", { defaults: { step: 5 } });
 * const queue = (await plugin.storage.session.get<string[]>("queue")) ?? [];
 * void settings.value.step; // read synchronously, from the file or the defaults
 * void queue;
 * ```
 *
 * @see [Store a plugin's data](../../../docs/guides/store-data.md), [Open a tool window and remember its state](../../../docs/guides/windows.md)
 * @since 1.0.0
 * @category Services
 */
export interface Storage {
  /**
   * Open `<name>.json` (`name`: 1–64 of `a-z 0-9 -`). A file that cannot be
   * parsed or fails `validate` is renamed `<name>.json.bad-<timestamp>` and
   * `defaults` is used. Writes go to a temporary file, then a rename. Disposal
   * (and stopping the plugin) flushes first.
   *
   * The file is read synchronously on creation; `debounceMs` defaults to
   * 300. Files are created with mode 0600. `invalid` for a bad name.
   *
   * @example Keep settings and a recent list in a JSON file
   * The plugin remembers whether to resume and the last ten files across
   * restarts. `json` reads `settings.json` from the data directory at once
   * (or uses `defaults` when it is missing or fails `validate`); `save`
   * replaces the value and writes the file 300 ms later, and stopping the
   * plugin writes a pending save first.
   * ```ts
   * declare const path: string;
   * // ---cut---
   * type Settings = { resume: boolean; recent: string[] };
   * const store = plugin.storage.json<Settings>("settings", {
   *   defaults: { resume: true, recent: [] },
   *   validate: (v): v is Settings =>
   *     typeof v === "object" && v !== null && typeof (v as Settings).resume === "boolean",
   * });
   * // Only `save` writes: changing `store.value` in place is not saved.
   * store.save({ ...store.value, recent: [path, ...store.value.recent].slice(0, 10) });
   * ```
   *
   * @capability None.
   * @throws `invalid` (throws) A bad `name`, or a `debounceMs` that is not a
   *   non-negative number.
   * @since 1.0.0
   */
  json<T>(
    name: string,
    options: {
      defaults: T;
      validate?: (value: unknown) => value is T;
      debounceMs?: number;
    },
  ): JsonStore<T>;
  /**
   * Values the player keeps in its memory for this plugin until the player
   * quits: they survive a restart of the plugin's process (reload, upgrade,
   * crash, failed start) but not the player. See {@link SessionStorage}.
   *
   * @since 1.5.25
   */
  readonly session: SessionStorage;
}

/**
 * `plugin.storage.session`: JSON values that live as long as the **player**,
 * not as long as the plugin's process (like `chrome.storage.session`). No
 * capability.
 *
 * `activate` can run more than once in one player session: the player stops
 * and starts a plugin's process again when the plugin is reloaded (also a
 * development load with `--plugin`) or upgraded, and after a crash or a
 * failed start; the player also restarts plugins that share a process, and
 * stops an idle plugin after 30 s and starts it on its next use. Variables,
 * timers, `fetch` calls, sockets and pending promises do not survive that
 * (nor do they keep the plugin running): keep state that must survive a
 * restart here (or in {@link Storage.json | storage.json} when it must also
 * survive the player quitting) and pick it up again in `activate`.
 *
 * | | Values |
 * | --- | --- |
 * | The plugin's process restarts: reload, upgrade, crash | kept |
 * | The plugin failed to start or failed, and starts again | kept |
 * | The user, or a plugin with `plugins` (`packages.setEnabled(id, false)`), disables the plugin | cleared |
 * | An update or reinstall with `enabled: false` switches an enabled plugin off | cleared |
 * | The plugin is uninstalled | cleared |
 * | An earlier installation kept for a later reinstall (after a `replace`) is dropped because the player keeps only so many | cleared |
 * | The player quits | cleared |
 *
 * - **Per plugin.** A plugin sees only its own keys. Like
 *   {@link Plugin.dataDirectory | dataDirectory}, the values belong to the
 *   installation: a development load (`--plugin`) has its own.
 * - **JSON.** `set` stores what `JSON.stringify(value)` writes, and `get`
 *   returns that, parsed: `undefined` object properties are dropped, a `Date`
 *   comes back as a string, `NaN` as `null`. **The order of an object's
 *   properties is not kept**: they may come back in another order. A value
 *   `JSON.stringify` cannot write (`undefined`, a function, a cycle, a
 *   `BigInt`) or a string with a lone surrogate (`"\uD800"`) fails with
 *   `invalid`. The value is not checked when it comes back: after an upgrade
 *   an older version's value may be read, so check its shape when it matters.
 * - **Bounded.** Keys are 1–1024 bytes of text. A plugin holds at most 1 MiB,
 *   counting every key, its value as compact JSON and 128 bytes per key
 *   ({@link "@vestra-player/sdk/testing"!SESSION_STORAGE_LIMITS | SESSION_STORAGE_LIMITS}); a
 *   `set` beyond it fails with `limit` and changes nothing. One `set` is
 *   also one message to the player, at most 1 MiB with its key, so a single
 *   value is a little smaller than that; a larger one fails with `limit`.
 *   Split large state over several keys.
 * - **Each call is one request.** A `set` is kept once its promise
 *   resolves, so a crash right after loses nothing; there is no debounce.
 *   Calls answer in order.
 *
 * @example Keep a work queue across a plugin restart
 * A download queue survives the plugin being reloaded or crashing, and is
 * empty again when the player starts next time. Session storage lives in
 * the player process for one player run; each `set` is kept once its
 * promise resolves, so nothing is lost if the plugin dies right after.
 * ```ts
 * // A queue the plugin is working through: after a reload or a crash it
 * // goes on where it stopped, after the player quits it starts afresh.
 * const pending = (await plugin.storage.session.get<string[]>("queue")) ?? [];
 * pending.push("https://example.com/a.mkv");
 * await plugin.storage.session.set("queue", pending);
 * ```
 *
 * @since 1.5.25
 *
 * @remarks
 * The player keeps the values in its own memory, per plugin, until it
 * quits; the plugin's process may restart in between. Each call is one
 * request to the player, answered in order, with no debounce.
 *
 * @capability None.
 * @category Services
 */
export interface SessionStorage {
  /**
   * The value stored under `key`, or `undefined` when there is none.
   *
   * @capability None.
   * @throws `invalid` (rejects) A bad key (empty, over 1024 bytes, with NUL
   *   or a lone surrogate).
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   *
   * @example Pick up where the plugin stopped after a reload
   * After a reload the plugin resumes the item it was working on. `get`
   * asks the player and resolves with the value parsed from JSON, or
   * `undefined` when nothing is stored; the value is not checked, so its
   * shape is checked here.
   * ```ts
   * const current = await plugin.storage.session.get<{ url: string }>("current");
   * if (typeof current?.url === "string") await plugin.osd.show("Resuming {}", [current.url]);
   * ```
   *
   * @since 1.5.25
   */
  get<T = unknown>(key: string): Promise<T | undefined>;
  /**
   * Store or replace `value` under `key`. `invalid` for a bad key or a value
   * that is not JSON, `limit` when the plugin's values would be over 1 MiB
   * or the request over the 1 MiB message limit.
   *
   * @capability None.
   * @throws `invalid` (rejects) A bad key, or a value JSON cannot hold (or a
   *   string with a lone surrogate).
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   * @throws `limit` (rejects) The plugin's values would pass 1 MiB, or the
   *   request the 1 MiB message limit; nothing changes.
   *
   * @example Remember the item being worked on
   * The plugin records the URL it is processing, so a reload can continue
   * with it. The value is stored as `JSON.stringify` writes it, and is kept
   * once the promise resolves.
   * ```ts
   * await plugin.storage.session.set("current", { url: "https://example.com/a.mkv" });
   * ```
   *
   * @since 1.5.25
   */
  set(key: string, value: unknown): Promise<void>;
  /**
   * Remove a key; removing a missing one is fine.
   *
   * @capability None.
   * @throws `invalid` (rejects) A bad key.
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   *
   * @example Forget the item once it is done
   * When the work finishes, the plugin removes the entry so that a later
   * reload does not resume it. Removing a key that is not there is fine.
   * ```ts
   * await plugin.storage.session.delete("current");
   * ```
   *
   * @since 1.5.25
   */
  delete(key: string): Promise<void>;
  /**
   * The keys stored, in code point order.
   *
   * @capability None.
   * @throws `disabled` (rejects) The plugin is stopping.
   * @throws `unsupported` (rejects) A player before 0.5.5.
   *
   * @example Clear everything the plugin stored for this run
   * The plugin starts its session state over. `keys` lists the plugin's own
   * keys in code point order; each `delete` is a request of its own.
   * ```ts
   * const session = plugin.storage.session;
   * for (const key of await session.keys()) await session.delete(key);
   * ```
   *
   * @since 1.5.25
   */
  keys(): Promise<string[]>;
}

/**
 * `plugin.system`: files and links, executed by the player. No capability.
 * Other systems than macOS and Windows: `unsupported`.
 *
 * @example Show an exported file and open the help page
 * The file manager opens with the exported file selected, then the
 * browser opens the plugin's help page. The player performs both on the
 * plugin's behalf; they reject with `unsupported` on systems other than
 * macOS and Windows, which the plugin turns into a message.
 * ```ts
 * declare const exportedFile: string;
 * // ---cut---
 * try {
 *   await plugin.system.reveal(exportedFile);
 *   await plugin.system.openUrl("https://example.com/help");
 * } catch (error) {
 *   if ((error as PluginError).code !== "unsupported") throw error;
 *   await plugin.osd.show(`Saved to ${exportedFile}`); // no file manager to open
 * }
 * ```
 *
 * @remarks
 * The player opens files, folders and links with the system's own
 * applications for the plugin, so the plugin never runs `open`,
 * `explorer` or a shell itself.
 *
 * @capability None.
 * @since 1.0.0
 * @category Services
 */
export interface System {
  /**
   * Select files or folders in the file manager (macOS: one Finder window
   * for all, so several files of one folder are all highlighted; Windows:
   * one Explorer window per folder, selecting its first path). Paths that do
   * not exist are skipped; `missing` when none exists; at most 256.
   *
   * @capability None.
   * @throws `missing` (rejects) None of the paths exists.
   * @throws `invalid` (rejects) No paths, or more than 256.
   * @throws `failed` (rejects) The system refused.
   * @throws `timeout` (rejects) macOS did not answer within 10 s.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   *
   * @example Show the exported files in the file manager
   * After an export, the file manager opens with the new files selected.
   * Paths that no longer exist are skipped; the call rejects with `missing`
   * only when none of them exists.
   * ```ts
   * declare const exported: string[];
   * // ---cut---
   * await plugin.system.reveal(exported); // macOS: one Finder window for all
   * ```
   *
   * @since 1.0.0
   */
  reveal(paths: string | string[]): Promise<void>;
  /**
   * Open the file or folder with its default application. `missing` if absent.
   *
   * @capability None.
   * @throws `missing` (rejects) The path does not exist.
   * @throws `invalid` (rejects) An empty path.
   * @throws `failed` (rejects) The system refused.
   * @throws `timeout` (rejects) macOS did not answer within 10 s.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   *
   * @example Open the plugin's data folder
   * A "Show data folder" command opens the plugin's data directory in the
   * file manager, which is the default application for a folder.
   * ```ts
   * await plugin.system.openPath(plugin.dataDirectory);
   * ```
   *
   * @since 1.0.0
   */
  openPath(path: string): Promise<void>;
  /**
   * Open an http(s) address in the default browser. `invalid` for another
   * protocol or a malformed address; `timeout` after 10 s, `failed` otherwise.
   *
   * @capability None.
   * @throws `invalid` (rejects) Not an `http:` or `https:` address.
   * @throws `timeout` (rejects) macOS did not hand it to the browser within
   *   10 s.
   * @throws `failed` (rejects) The system refused.
   * @throws `unsupported` (rejects) A system other than macOS and Windows.
   *
   * @example Open the plugin's help page
   * A Help command opens the plugin's documentation in the default browser.
   * Only `http:` and `https:` addresses are opened.
   * ```ts
   * await plugin.system.openUrl("https://example.com/plugin/help");
   * ```
   *
   * @since 1.0.0
   */
  openUrl(url: string): Promise<void>;
}

/**
 * Per-plugin secrets (API keys, passwords) in the system's secret store:
 * the login keychain on macOS, the Credential Manager on Windows. Needs
 * `credentials`. `unsupported` on systems without a store, `unavailable` when
 * the store cannot be reached (no keychain, a read-only store, no logged-in
 * session on Windows): keep a fallback (or ask again).
 *
 * The user denying access and other system errors reject `failed`. Never
 * write secrets to settings files.
 *
 * @example Ask for an API token once and keep it in the keychain
 * The user types the token the first time; later runs read it from the
 * system's secret store. `get` resolves `null` when nothing is stored; a
 * store that is missing or refuses access rejects (`unsupported`,
 * `unavailable`, `failed`), and then the plugin keeps the token for this
 * run only and asks again next time.
 * ```ts
 * declare function askUser(): Promise<string | null>;
 * // ---cut---
 * let token: string | null = null;
 * try {
 *   token = await plugin.secrets.get("api-token");
 * } catch {
 *   // No usable store: fall through and ask.
 * }
 * if (token === null) {
 *   token = await askUser();
 *   if (token)
 *     await plugin.secrets.set("api-token", token).catch(() => {}); // best effort
 * }
 * ```
 *
 * @remarks
 * Values are stored by the player in the system's secret store under this
 * plugin's id: other plugins cannot read them. Names are 1–64 of
 * `a-z 0-9 . _ -`, values 1–1024 bytes of text, at most 256 names per
 * plugin (`SECRET_LIMITS`).
 *
 * @capability credentials
 * @since 1.0.0
 * @category Services
 */
export interface Secrets {
  /**
   * The stored value, `null` when there is none.
   *
   * @capability credentials
   * @throws `unsupported` (rejects) The system has no secret store.
   * @throws `unavailable` (rejects) The store cannot be reached (no keychain,
   *   a read-only store, no logged-in session on Windows).
   * @throws `failed` (rejects) The user denied access, or another system
   *   error.
   * @throws `capability` (rejects) The manifest does not declare `credentials`.
   * @throws `invalid` (rejects) A bad name.
   *
   * @example Read a stored token
   * The plugin uses the token the user saved earlier, or asks for one when
   * there is none. `get` resolves with the stored text or `null`.
   * ```ts
   * const token = await plugin.secrets.get("api-token");
   * if (token === null) await plugin.osd.show("Sign in first");
   * ```
   *
   * @since 1.0.0
   */
  get(name: string): Promise<string | null>;
  /**
   * Store or replace (`name`: 1–64 of `a-z 0-9 . _ -`; value 1–1024 bytes).
   * At most 256 different names per plugin: a new name beyond that rejects
   * `limit`. Uninstalling with `removeData` deletes them.
   *
   * @capability credentials
   * @throws `invalid` (rejects) A bad name, or a value that is empty, has NUL
   *   or is over 1024 bytes.
   * @throws `limit` (rejects) A new name beyond 256.
   * @throws `unsupported` (rejects) The system has no secret store.
   * @throws `unavailable` (rejects) The store cannot be reached (no keychain,
   *   a read-only store, no logged-in session on Windows).
   * @throws `failed` (rejects) The user denied access, or another system
   *   error.
   * @throws `capability` (rejects) The manifest does not declare `credentials`.
   *
   * @example Save the token the user entered
   * The token the user typed is kept in the system's secret store for later
   * runs. `set` stores or replaces it; the store can refuse, in which case
   * the plugin keeps the token for this run only.
   * ```ts
   * declare const token: string;
   * // ---cut---
   * await plugin.secrets.set("api-token", token).catch((error: PluginError) => {
   *   // No store, or access denied: the token is not kept for next time.
   *   void plugin.osd.show("The token could not be saved ({})", [error.code]);
   * });
   * ```
   *
   * @since 1.0.0
   */
  set(name: string, value: string): Promise<void>;
  /**
   * Remove; removing a missing secret is fine.
   *
   * @capability credentials
   * @throws `invalid` (rejects) A bad name.
   * @throws `unsupported` (rejects) The system has no secret store.
   * @throws `unavailable` (rejects) The store cannot be reached (no keychain,
   *   a read-only store, no logged-in session on Windows).
   * @throws `failed` (rejects) The user denied access, or another system
   *   error.
   * @throws `capability` (rejects) The manifest does not declare `credentials`.
   *
   * @example Sign out by removing the token
   * Signing out removes the stored token, so the next start asks again.
   * Removing a name that is not stored is fine.
   * ```ts
   * await plugin.secrets.delete("api-token");
   * ```
   *
   * @since 1.0.0
   */
  delete(name: string): Promise<void>;
}

/**
 * Which renderer draws the video: `"gpu"` (the GPU renderer, where
 * {@link RenderOptions | render options} apply) or `"software"` (they fail
 * with `unsupported`). The same values as {@link SystemInfo.rendering}.
 *
 * @example Tell the user which renderer draws the video
 * The plugin shows "Rendering: GPU" or "Rendering: software" on the
 * video. `state()` asks the player; `mode` is the renderer drawing now,
 * which can differ from the saved choice until the next start.
 * ```ts
 * const { mode } = await plugin.rendering.state();
 * const label: Record<RenderingMode, string> = { gpu: "GPU", software: "software" };
 * await plugin.osd.show("Rendering: {}", [label[mode]]);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export type RenderingMode = "gpu" | "software";

/**
 * The user's saved rendering choice: `"auto"` (the player decides: the GPU
 * where this system has a GPU renderer that is not ruled out, software
 * elsewhere), `"gpu"` or `"software"`. It applies from the next start.
 *
 * @example Describe the saved choice on a settings page
 * The plugin turns the saved choice into the words its settings page
 * shows. `preference` is what the user chose, not what draws now:
 * {@link RenderingState.nextMode} says what the next start will use.
 * ```ts
 * const { preference } = await plugin.rendering.state();
 * // One word per choice; the Record type makes sure none is missing.
 * const words: Record<RenderingPreference, string> = {
 *   auto: "Automatic",
 *   gpu: "GPU",
 *   software: "Software",
 * };
 * console.log(words[preference]);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export type RenderingPreference = "auto" | "gpu" | "software";

/**
 * Why the player renders the way it does, as a stable kebab-case code. A newer
 * player may add codes: compare with the ones you handle and show
 * {@link RenderingReason.message} for the rest. The codes:
 *
 * | Code | Meaning |
 * | --- | --- |
 * | `default` | Nothing ruled the GPU out; the platform's default (macOS: GPU; Windows since version 0.5.14: software until the user turns on GPU rendering). |
 * | `pending` | GPU rendering is starting. |
 * | `headless` | The player runs without a user interface. |
 * | `no-gpu-backend` | This player has no GPU renderer on this system (Linux today; Windows has one since version 0.5.14, off by default, which reports `default`). |
 * | `env` | The environment chose it (`VESTRA_RENDER`, `VESTRA_SOFTWARE_RENDER`). |
 * | `preference` | The user chose software rendering ({@link Rendering.setPreference}); GPU chosen and available reports `default`. |
 * | `denylist` | The graphics driver is on the player's denylist. |
 * | `previous-crash` | GPU rendering crashed at an earlier start; it is tried again after a driver or player update, or after 7 days. |
 * | `init-failed` | GPU rendering could not start. |
 * | `window-fallback` | A window could not show GPU frames; the player switched to software during the run. |
 *
 * @example Explain a driver problem differently from a user choice
 * The plugin adds advice only when the graphics driver is the cause.
 * `reason.code` is looked up among the codes the plugin knows; an unknown
 * code from a newer player falls through to the player's own message.
 * ```ts
 * const { reason } = await plugin.rendering.state();
 * // Advice for the codes this plugin knows; any other code shows the message.
 * const advice: Partial<Record<RenderingReasonCode, string>> = {
 *   denylist: "Update the graphics driver to use the GPU.",
 *   "previous-crash": "The GPU renderer crashed earlier; it is retried after an update.",
 * };
 * console.log(advice[reason.code] ?? reason.message);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export type RenderingReasonCode =
  | "default"
  | "pending"
  | "headless"
  | "no-gpu-backend"
  | "env"
  | "preference"
  | "denylist"
  | "previous-crash"
  | "init-failed"
  | "window-fallback"
  // Any other string: a newer player's code (the names above stay suggested).
  | (string & {});

/**
 * Why the player renders, or will render, the way it does: a stable
 * {@link RenderingReasonCode} to branch on and a sentence to show.
 *
 * @example Show why GPU rendering is off
 * The plugin logs the player's explanation when the video is drawn in
 * software. `message` is the player's English text and may name the
 * graphics adapter and driver version; `code` is for decisions.
 * ```ts
 * const { mode, reason } = await plugin.rendering.state();
 * if (mode === "software") console.log(`${reason.code}: ${reason.message}`);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export interface RenderingReason {
  /** The reason as a stable kebab-case code; branch on this. */
  readonly code: RenderingReasonCode;
  /**
   * The reason as English text for people, for example with the graphics
   * adapter's name and driver version; never branch on it.
   */
  readonly message: string;
}

/**
 * What {@link Rendering.state} and {@link Rendering.setPreference} report:
 * the renderer drawing now and why, the saved choice, what the next start
 * will use, and whether `"gpu"` can be chosen.
 *
 * @example Label a menu item while a change waits for a restart
 * The plugin adds "(Restart to Apply)" to its GPU item after the user
 * changed the choice. `restartPending` compares the mode the next start
 * will use with the mode this run started with, so it turns false again
 * when the user changes the choice back.
 * ```ts
 * const state = await plugin.rendering.state();
 * const title = state.restartPending
 *   ? "GPU Rendering (Experimental) (Restart to Apply)"
 *   : "GPU Rendering (Experimental)";
 * console.log(title, state.nextMode, state.nextReason.message);
 * ```
 *
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export interface RenderingState {
  /** The renderer drawing the video now; the same as {@link SystemInfo.rendering}. */
  readonly mode: RenderingMode;
  /** Why {@link RenderingState.mode} is what it is now. */
  readonly reason: RenderingReason;
  /** The saved choice; it applies from the next start. */
  readonly preference: RenderingPreference;
  /**
   * The renderer the next start will use, as far as the player knows now:
   * from the saved choice, the environment, the driver denylist and an
   * earlier GPU crash.
   */
  readonly nextMode: RenderingMode;
  /** Why the next start will use {@link RenderingState.nextMode}. */
  readonly nextReason: RenderingReason;
  /**
   * `true` while {@link RenderingState.nextMode} differs from the mode this
   * run started with, so a restart would change the renderer; `false` again
   * when the user changes the choice back.
   */
  readonly restartPending: boolean;
  /** Whether the user can choose `"gpu"` now. */
  readonly gpu: {
    /** `true` when `setPreference("gpu")` would be accepted. */
    readonly available: boolean;
    /**
     * Why `"gpu"` cannot be chosen (`no-gpu-backend`, `headless`,
     * `denylist`, `previous-crash`…); `null` while it is available.
     */
    readonly reason: RenderingReason | null;
  };
}

/**
 * `plugin.rendering`: the player's rendering choice, GPU or software.
 * Reading it needs no capability; changing the saved choice and restarting
 * the player need `player`.
 *
 * @remarks
 * The choice works like a browser's hardware acceleration switch: the
 * player saves it in its own settings at once, and the running player
 * keeps its renderer. The next start uses it, whether the user restarts
 * now through {@link Rendering.restartPlayer} or quits and starts the
 * player later. The player can still rule the GPU out at a start (an
 * environment variable, a graphics driver on its denylist, a GPU crash at
 * an earlier start); {@link RenderingState.nextMode} and
 * {@link RenderingState.nextReason} say what the next start will do.
 *
 * The renderer is a choice for the whole player and a restart stops every
 * plugin, so change it only when the user asks. A plugin that only needs
 * to know whether render options work reads {@link SystemInfo.rendering}.
 *
 * @example Offer GPU rendering as a menu item
 * Settings ▸ GPU Rendering (Experimental) carries a check mark while the
 * next start will draw on the GPU, is greyed out with the player's reason
 * where the GPU cannot be chosen, and saves the other choice when picked.
 * `state()` reads the player's view once; `setPreference` saves the choice
 * and resolves with the new state, which the item's bound values read
 * again after the handler. The how-to guide adds the restart.
 * ```ts
 * let state = await plugin.rendering.state();
 * plugin.commands.add({
 *   id: "gpu-rendering",
 *   path: ["@settings", "GPU Rendering (Experimental)"],
 *   checked: () => state.nextMode === "gpu", // also for "auto" on a GPU system
 *   enabled: () => state.gpu.available,
 *   reason: () => state.gpu.reason?.message ?? null, // shown while disabled
 *   run: async () => {
 *     const choice = state.nextMode === "gpu" ? "software" : "gpu";
 *     state = await plugin.rendering.setPreference(choice);
 *   },
 * });
 * ```
 *
 * @capability None to read the state; `player` to change the choice or restart
 *   the player.
 * @see [Offer a GPU rendering switch](../../../docs/guides/gpu-rendering.md)
 * @player 0.5.13
 * @since 1.5.35
 * @category Services
 */
export interface Rendering {
  /**
   * Read the renderer drawing now, the saved choice, what the next start
   * will use and whether `"gpu"` can be chosen. No capability.
   *
   * @capability None.
   * @throws `unsupported` (rejects) A player before 0.5.13, which does not
   *   know the request.
   *
   * @example Find out whether the GPU can be chosen
   * The plugin reads the state once while it starts and keeps it for its menu.
   * Each call asks the player; `gpu.available` is false, with a reason, where
   * this player has no GPU renderer, without a user interface, or when the
   * driver is ruled out.
   * ```ts
   * const state = await plugin.rendering.state().catch((error: PluginError) => {
   *   if (error.code === "unsupported") return null; // a player before 0.5.13
   *   throw error;
   * });
   * if (state && !state.gpu.available) console.log(state.gpu.reason?.message);
   * ```
   *
   * @since 1.5.35
   */
  state(): Promise<RenderingState>;
  /**
   * Save the user's rendering choice. The player writes it to its settings
   * at once; the running player keeps its renderer, and the next start
   * uses the choice whether or not the user restarts now. `"auto"` and
   * `"software"` are always accepted.
   *
   * @param preference - `"auto"`, `"gpu"` or `"software"`.
   * @returns The new state; {@link RenderingState.restartPending} tells
   *   whether a restart would change the renderer.
   *
   * @capability player
   * @throws `invalid` (rejects) `preference` is not `"auto"`, `"gpu"` or
   *   `"software"`.
   * @throws `unsupported` (rejects) `"gpu"` where this player has no GPU
   *   renderer on this system, or runs without a user interface; also any
   *   value on a player before 0.5.13.
   * @throws `unavailable` (rejects) `"gpu"` while it is ruled out: the
   *   graphics driver is on the player's denylist, or GPU rendering crashed
   *   at an earlier start. The message says which, with the adapter's name
   *   and the driver version.
   * @throws `failed` (rejects) The player could not write its settings file.
   * @throws `capability` (rejects) The manifest does not declare `player`.
   *
   * @example Switch back to the automatic choice
   * A Reset item returns the renderer to the player's own choice and tells
   * the user when it takes effect. `setPreference` saves the choice and
   * resolves with the new state; `restartPending` is true when the next
   * start will draw differently from this run. A refused save leaves the
   * old choice in place.
   * ```ts
   * try {
   *   const state = await plugin.rendering.setPreference("auto");
   *   if (state.restartPending) await plugin.osd.show("Applies after a restart");
   * } catch (error) {
   *   // `failed`: the player's settings file could not be written.
   *   await plugin.osd.show("Not saved ({})", [(error as PluginError).code]);
   * }
   * ```
   *
   * @since 1.5.35
   */
  setPreference(preference: RenderingPreference): Promise<RenderingState>;
  /**
   * Restart the player so that a changed choice applies now. Resolves once
   * the player has accepted; the player then quits normally, which stops
   * every plugin (this one included), and starts again with the same
   * plugins. A local file that was open continues at its position, paused
   * or playing as it was; a stream or another source that is not a file is
   * not reopened.
   *
   * @capability player
   * @throws `unsupported` (rejects) The player runs without a user
   *   interface; also a player before 0.5.13.
   * @throws `busy` (rejects) A restart is already under way, or this player
   *   was itself started by a restart less than 30 seconds ago (so a plugin
   *   that restarts on activation cannot make a loop).
   * @throws `failed` (rejects) The new player process could not be started;
   *   the player keeps running.
   * @throws `capability` (rejects) The manifest does not declare `player`.
   *
   * @example Restart after asking the user
   * After the user changed the renderer, the plugin offers to restart now.
   * `confirm` asks first, because a restart closes every window; once
   * `restartPlayer` resolves, the player is quitting and
   * will stop this plugin, so nothing else is started after it.
   * ```ts
   * const { confirmed } = await plugin.dialogs.confirm({
   *   message: "Restart the player now?",
   *   detail: "The new renderer is used from the restart on. The video continues where it is.",
   *   confirm: "Restart",
   * });
   * if (confirmed)
   *   await plugin.rendering.restartPlayer().catch((error: PluginError) => {
   *     // `failed`: the new player could not start; this one keeps running.
   *     void plugin.osd.show("Could not restart ({})", [error.code]);
   *   });
   * ```
   *
   * @since 1.5.35
   */
  restartPlayer(): Promise<void>;
}
