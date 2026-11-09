// Sources category: source resolvers.
// Re-exported by ../types.ts (`export type *`); see that file.
import type { ResolvedMedia } from "../../source-resolvers.ts";
import type { Disposable } from "./base.ts";
import type { Stream, StreamFrame } from "./playback.ts";
// Targets of {@link} in the doc comments only: imported so that typedoc
// resolves them to these declarations (not to DOM globals such as Window).
/* oxlint-disable no-unused-vars */
import type { Player, StreamOptions } from "./playback.ts";
/* oxlint-enable no-unused-vars */

// ---------------------------------------------------------------- source resolvers

/**
 * Declaration of {@link Resolvers.add}: a web resolver
 * ({@link WebResolverOptions}) or a file resolver ({@link FileResolverOptions}).
 *
 * @since 1.0.0
 * @category Sources
 */
export type ResolverOptions = WebResolverOptions | FileResolverOptions;

/**
 * A resolver for web pages: `https://host/…` to playable stream URLs.
 *
 * @since 1.0.0
 * @category Sources
 */
export interface WebResolverOptions {
  /** Local id, unique within the plugin. */
  id: string;
  /** URL schemes handled. */
  schemes: ("http" | "https")[];
  /** Exact host names. */
  hosts: string[];
  /** Turn a page URL into playable stream URLs. */
  resolve(url: string, signal: AbortSignal): Promise<ResolvedMedia>;
}

/**
 * A resolver for local files by extension: when anyone opens such a file with
 * {@link Player.open} (the Open dialog, the playlist, next / previous, the
 * recent list, a drop that calls `open`), the player asks this plugin for a
 * stream it generates instead of playing the file. Needs `source.resolve` and
 * `producer.av`.
 *
 * @remarks
 * The open keeps everything of the original call: its `ifCurrent`, its
 * operation (the opener's `open` and `media.ready()` settle as for any
 * file), `paused` (the stream starts paused), and its path as
 * `state.source`, with `state.kind` `"stream"`. A thrown error fails that
 * open: `phase` `"error"` with the error's message as `state.error`,
 * word for word. The stream belongs to this plugin, as with
 * {@link Player.openStream}.
 *
 * Cancellation: `signal` aborts when the open is replaced, closed
 * (`player.close()`, F4) or times out (30 seconds), or this resolver is
 * disposed. Cancelled after `resolve` returned but before the stream ran,
 * the SDK releases the stream and never calls `started`.
 *
 * One extension has one resolver: another plugin's resolver for it makes
 * {@link Resolver.ready} reject with `conflict` without failing activation
 * (the player shows a warning). When this plugin stops, its extensions are
 * free again and such files go to the player as before.
 *
 * @example Play CHIP-8 programs with the plugin's own emulator
 * Opening a `.ch8` file anywhere in the player (Open dialog, playlist,
 * recent list) runs it in the plugin's emulator instead of failing as an
 * unknown format. The player calls `resolve` with the path; the plugin
 * reads the program and returns a stream whose `frame()` the SDK pulls on
 * the audio clock, one 1/60 s frame per call. `started` runs once the
 * stream plays; `signal` aborts the read when the open is replaced or
 * closed.
 * ```ts
 * import { readFile } from "node:fs/promises";
 * // The plugin's own emulator (made up here): one frame per call.
 * declare function emulator(program: Uint8Array): () => StreamFrame;
 * // ---cut---
 * plugin.resolvers.add({
 *   id: "chip8",
 *   extensions: ["ch8"], // lower case, no dot; matches Game.CH8 too
 *   async resolve(path, signal) {
 *     const frame = emulator(await readFile(path, { signal }));
 *     return {
 *       kind: "stream",
 *       width: 64, // CHIP-8's display
 *       height: 32,
 *       frame,
 *       started: (stream) => stream.onStop((error) => error && plugin.osd.show(error.message)),
 *     };
 *   },
 * });
 * ```
 *
 * @since 1.5.3
 * @category Sources
 */
export interface FileResolverOptions {
  /** Local id, unique within the plugin. */
  id: string;
  /**
   * Lower case, without the dot: 1–16 entries of 1–16 lower-case letters or
   * digits (not `"folder"`). Only absolute local paths match, by their
   * extension in any case (`/roms/Game.NES`); URLs never do.
   */
  extensions: string[];
  /** Read the file and describe the stream to generate for it. */
  resolve(path: string, signal: AbortSignal): Promise<ResolvedStream>;
}

/**
 * What a file resolver returns: a stream, with the same frame contract as
 * {@link StreamOptions} (size limits, `frame()` on the audio clock).
 *
 * After `resolve` returns, the SDK starts the stream while the open waits.
 * If that fails, the open fails with the player's words instead of the
 * SDK's (the detail goes to the log): `device` "音频输出设备不可用",
 * `timeout` "启动超时", `busy` "播放器正忙，请稍后重试", other start-up
 * failures "无法启动播放". An error thrown by `frame()` keeps its message.
 * To give your own text for a file you can tell is unusable (a bad header),
 * check it in `resolve` and throw there.
 *
 * @since 1.5.3
 * @category Sources
 */
export interface ResolvedStream {
  /** Always `"stream"`. */
  kind: "stream";
  /** Frame width in pixels. */
  width: number;
  /** Frame height in pixels. */
  height: number;
  /** Produce the next frame. Never called concurrently or while paused. */
  frame(): StreamFrame;
  /**
   * Called with the running stream once the player plays it, synchronously
   * after activation and before any {@link Stream.onStop}. Not called when
   * the open was cancelled first. `stream.stop()` closes the source (if
   * still current); the plugin stopping stops it too.
   */
  started?(stream: Stream): void;
}

/**
 * A registered resolver. Disposing it unregisters it and aborts resolutions in flight.
 *
 * @remarks
 * A registered resolver, from {@link Resolvers.add}. Disposing it, its
 * scope or stopping the plugin unregisters it and aborts resolutions in
 * flight; the extensions or hosts are free again for other plugins.
 *
 * @capability source.resolve
 *
 * @example Report when another plugin already handles the format
 * The plugin tells the user when its `.ch8` resolver could not register
 * because another plugin holds that extension. `ready` rejects with
 * `conflict`; for another plugin's claim that does not fail activation, so
 * the plugin keeps running without the resolver.
 * ```ts
 * const resolver = plugin.resolvers.add({
 *   id: "chip8",
 *   extensions: ["ch8"],
 *   async resolve() {
 *     throw plugin.i18n.error("Not ready yet.");
 *   },
 * });
 * // Rejects with `conflict` when the extension is taken.
 * resolver.ready.catch((error: PluginError) => {
 *   if (error.code === "conflict") void plugin.osd.show("Another plugin plays .ch8 files");
 * });
 * ```
 *
 * @since 1.0.0
 * @category Sources
 */
export interface Resolver extends Disposable {
  /**
   * Resolves when the player registered it; rejects otherwise: `conflict`
   * when another resolver has the extension or the scheme + host (another
   * plugin's: activation goes on; this plugin's own: activation fails),
   * `invalid` for a malformed declaration (a player before 0.4.1 also for
   * `extensions`).
   *
   * @throws `conflict` (rejects) Another resolver has the extension or the
   *   scheme + host, or this plugin already registered this id.
   * @throws `busy` (rejects) The player already holds 16 resolvers.
   * @throws `invalid` (rejects) A malformed declaration.
   * @throws `capability` (rejects) The manifest does not declare
   *   `source.resolve`.
   */
  readonly ready: Promise<void>;
}

/**
 * `plugin.resolvers`: turn web page URLs into playable streams, or local
 * files into streams this plugin generates. Needs `source.resolve` (file
 * resolvers also `producer.av`).
 *
 * @example Play pages of a video site
 * Opening a `https://video.example.com/…` page plays its video. When the
 * user opens a URL whose scheme and host this resolver declares, the
 * player asks the plugin first; `resolve` returns the stream's address,
 * and `signal` aborts the lookup when the open is replaced or closed.
 * ```ts
 * plugin.resolvers.add({
 *   id: "example",
 *   schemes: ["https"],
 *   hosts: ["video.example.com"],
 *   async resolve(url, signal) {
 *     const response = await fetch(url, { signal }); // the site's JSON for the page
 *     if (!response.ok) throw new Error(`video.example.com answered ${response.status}`);
 *     const page = await response.json();
 *     return { kind: "media", originalUrl: url, title: page.title, primary: { url: page.stream } };
 *   },
 * });
 * ```
 *
 * @remarks
 * A resolver turns something the player cannot play by itself into
 * something it can: a web page address into stream URLs
 * ({@link WebResolverOptions}), or a local file of a format the plugin
 * understands into a stream the plugin generates
 * ({@link FileResolverOptions}). The player asks the resolver whenever
 * anyone opens a matching address or file (the Open dialog, the playlist,
 * another plugin), so the plugin does not intercept opens itself.
 *
 * @capability source.resolve (file resolvers also `producer.av`)
 * @see [Control playback](../../../docs/guides/control-playback.md)
 * @since 1.0.0
 * @category Sources
 */
export interface Resolvers {
  /**
   * Register a resolver. When anyone opens a matching URL or file the
   * player calls `resolve`; `signal` aborts when the open is cancelled or
   * replaced. One scheme + host pair, and one extension, has one resolver
   * (`conflict` otherwise). A rejected `resolve` fails the open with the
   * error's message.
   *
   * @capability source.resolve
   *
   * @example Play a site's pages through the plugin
   * Opening a `https://video.example.com/…` address plays the page's video.
   * `add` returns at once and registers in the background (`ready` reports
   * the answer); from then on the player calls `resolve` for every matching
   * open, and the error a rejected `resolve` carries is what the user sees.
   * ```ts
   * plugin.resolvers.add({
   *   id: "example",
   *   schemes: ["https"],
   *   hosts: ["video.example.com"], // exact host names
   *   async resolve(url, signal) {
   *     const response = await fetch(url, { signal });
   *     if (!response.ok) throw new Error(`the page answered ${response.status}`);
   *     const page = (await response.json()) as { title: string; stream: string };
   *     return { kind: "media", originalUrl: url, title: page.title, primary: { url: page.stream } };
   *   },
   * });
   * ```
   *
   * @since 1.0.0
   */
  add(options: ResolverOptions): Resolver;
}
