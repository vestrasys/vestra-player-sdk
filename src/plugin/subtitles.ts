/** Subtitle selection, external SRT resources and this plugin's style layer. */
import { createHash } from "node:crypto";
import type {
  SubtitleState,
  SubtitleStamp,
  SubtitleTrack as Target,
} from "../subtitles.ts";
import { isTextValue, textProblem } from "../i18n.ts";
import type { SourceState } from "../source.ts";
import { Latest } from "./latest.ts";
import { abortError, failure, sleep, uncertain } from "./errors.ts";
import { playerOf } from "./player.ts";
import type { Runtime } from "./runtime.ts";
import type { ScopeImpl } from "./scope.ts";
import type {
  SubtitleConditional,
  SubtitleStyle,
  SubtitleTrack,
  Subtitles,
  SubtitlesState,
} from "./types.ts";

/**
 * The player's limits on subtitle files a plugin loads with
 * {@link Subtitles.load}, which `TestHost` enforces with the player's codes.
 * The track counts are per source: opening another file starts from zero.
 * A file over `fileBytes` fails with `invalid`; every other limit fails with
 * `busy`, and nothing is loaded.
 *
 * @remarks
 * Each `load` uses a new resource on the source, and removing the track
 * frees its place among the live tracks (`tracksPerPlugin`, `tracks`,
 * `totalBytes`) but not among the loads (`loadsPerPlugin`, `loads`). So one
 * plugin loads at most 16 files into one source, with at most 4 of them
 * present at once.
 *
 * @example Replace the plugin's oldest subtitle when it has four
 * The plugin keeps the files it loaded, newest last, and removes the oldest
 * before a fifth would be refused with `busy`. A load the player still
 * refuses (the source holds 16 tracks of every plugin, or this plugin
 * already loaded 16 files into it) is reported on the OSD.
 * ```ts
 * import type { Plugin, PluginError, SubtitleTrack } from "@vestra-player/sdk";
 * declare const plugin: Plugin;
 * declare const bytes: Uint8Array;
 * // ---cut---
 * import { SUBTITLE_LIMITS } from "@vestra-player/sdk/testing";
 *
 * const loaded: SubtitleTrack[] = []; // this source's, newest last
 * if (loaded.length >= SUBTITLE_LIMITS.tracksPerPlugin)
 *   await plugin.subtitles.remove(loaded.shift()!);
 * try {
 *   loaded.push(await plugin.subtitles.load(bytes));
 * } catch (error) {
 *   if ((error as PluginError).code !== "busy") throw error;
 *   await plugin.osd.show("No room for another subtitle on this file.");
 * }
 * ```
 *
 * @since 1.5.34
 *
 * @category Testing
 */
export const SUBTITLE_LIMITS = Object.freeze({
  /** UTF-8 bytes of one file; a larger one fails with `invalid` (2 MiB). */
  fileBytes: 2 * 1024 * 1024,
  /** Tracks one plugin has loaded into the current source at the same time (4). */
  tracksPerPlugin: 4,
  /** Loaded tracks of every plugin in the current source at the same time (16). */
  tracks: 16,
  /** Bytes of the loaded tracks of every plugin in the current source together (16 MiB). */
  totalBytes: 16 * 1024 * 1024,
  /** Loads by one plugin into the current source, removed tracks included (16). */
  loadsPerPlugin: 16,
  /** Loads by every plugin into the current source, removed tracks included (128). */
  loads: 128,
  /** Loads of one plugin in progress at the same time (2). */
  uploadsPerPlugin: 2,
  /** Loads of every plugin in progress at the same time (8). */
  uploads: 8,
} as const);

const VTT_TIME = /^(?:(\d+):)?(\d{2}):(\d{2})\.(\d{3})$/;
const VTT_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  lrm: "‎",
  rlm: "‏",
};
/** A cue line longer than this (characters) leaves its cue out. */
const VTT_LINE_CHARS = 4096;

/**
 * WebVTT (`format: "vtt"`) as the SRT the player loads, so it passes the
 * player's SRT checks unchanged. Cue identifiers, settings (position,
 * alignment), `NOTE`, `STYLE` and `REGION` blocks are dropped; markup tags
 * (`<b>`, `<c.yellow>`, `<v Speaker>`, timestamps) are removed and entities
 * decoded, so the text shows as written: the player shows SRT text
 * literally (`<`, `>`, `{…}` included). An entity that stands for a control
 * character (a line break) becomes a space, so it cannot split a cue. A cue
 * with a bad timing line or an over-long line, one that ends before it
 * starts, or one whose text is empty once its tags are removed, is left out;
 * the rest are ordered by start time.
 */
export function webvttToSrt(bytes: Uint8Array): Uint8Array {
  if (bytes.length > SUBTITLE_LIMITS.fileBytes)
    throw failure("invalid", "WebVTT must contain at most 2097152 bytes");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw failure("invalid", "WebVTT must be UTF-8");
  }
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  if (!/^WEBVTT(?:[ \t].*)?$/.test(lines[0] ?? ""))
    throw failure("invalid", "WebVTT must start with a WEBVTT line");
  const millis = (time: string) => {
    const m = VTT_TIME.exec(time);
    if (!m || Number(m[2]) > 59 || Number(m[3]) > 59) return null;
    return (
      ((Number(m[1] ?? 0) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 +
      Number(m[4])
    );
  };
  // A control character (from an entity, or raw): a space, so no entity
  // makes a line break that would end the SRT cue.
  const visible = (char: string) => {
    const code = char.codePointAt(0)!;
    return code < 0x20 || (code >= 0x7f && code < 0xa0) ? " " : char;
  };
  const shown = (line: string) =>
    line
      // No `<` inside: linear on a line of `<` without `>`.
      .replace(/<[^<>]*>/g, "")
      .replace(
        /&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi,
        (entity, name: string) => {
          if (name[0] !== "#") return VTT_ENTITIES[name] ?? entity;
          const code =
            name[1] === "x" || name[1] === "X"
              ? parseInt(name.slice(2), 16)
              : Number(name.slice(1));
          return code > 0 &&
            code <= 0x10ffff &&
            (code < 0xd800 || code > 0xdfff)
            ? String.fromCodePoint(code)
            : entity;
        },
      )
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, visible)
      .trimEnd();
  const cues: { start: number; end: number; text: string[] }[] = [];
  let block: string[] = [];
  const flush = () => {
    const [first = "", second] = block;
    const at = first.includes("-->") ? 0 : second?.includes("-->") ? 1 : -1;
    // NOTE, STYLE, REGION and anything else without a timing line.
    if (at >= 0 && !/^(?:NOTE|STYLE|REGION)(?:[ \t]|$)/.test(first)) {
      const [from = "", rest = ""] = block[at]!.split("-->");
      const start = millis(from.trim());
      const end = millis(rest.trim().split(/[ \t]/)[0] ?? "");
      const raw = block.slice(at + 1);
      // A malformed cue is left out, not the whole file.
      if (
        start !== null &&
        end !== null &&
        end > start &&
        raw.every((line) => line.length <= VTT_LINE_CHARS)
      ) {
        const text = raw.map(shown).filter((line) => line.trim() !== "");
        if (text.length) cues.push({ start, end, text });
      }
    }
    block = [];
  };
  // Blocks are separated by blank lines; the first is the header, which a
  // cue may follow at once (a timing line ends it, as players accept).
  let header = true;
  for (const line of lines.slice(1)) {
    if (header && line.includes("-->")) header = false;
    if (line.trim() === "") {
      if (header) header = false;
      else if (block.length) flush();
      continue;
    }
    if (!header) block.push(line);
  }
  if (block.length) flush();
  if (!cues.length)
    throw failure("invalid", "WebVTT has no valid cue with text");
  cues.sort((a, b) => a.start - b.start);
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = (ms: number) =>
    `${two(Math.floor(ms / 3_600_000))}:${two(Math.floor(ms / 60_000) % 60)}:${two(Math.floor(ms / 1000) % 60)},${String(ms % 1000).padStart(3, "0")}`;
  const srt = cues
    .map(
      (cue, i) =>
        `${i + 1}\n${stamp(cue.start)} --> ${stamp(cue.end)}\n${cue.text.join("\n")}\n`,
    )
    .join("\n");
  return new TextEncoder().encode(srt);
}

/** The events the subtitle state follows (it has none of its own). */
const EVENTS = ["source.state", "playback.backend"];
const raws = new WeakMap<SubtitlesState, SubtitleState>();
const targets = new WeakMap<SubtitleTrack, Target>();
const CHUNK = 32 * 1024;

const targetId = (target: Target | null) =>
  !target
    ? ""
    : target.kind === "embedded"
      ? `embedded:${target.id}`
      : `external:${target.owner}:${target.resourceId}:${target.contentRevision}`;

class SubtitleService {
  readonly #runtime: Runtime;
  raw: SubtitleState | undefined;
  state: SubtitlesState | null = null;
  readonly owned = new Set<string>();
  readonly #watchers = new Set<() => void>();
  /** Selection, removal, style and commit share one operation book. */
  #operation = 0;
  #upload = 0;
  #styleRevision = 0;
  #source = "";
  readonly style: Latest<{
    style: SubtitleStyle | null;
    options?: SubtitleConditional;
  }>;
  constructor(runtime: Runtime) {
    this.#runtime = runtime;
    // No subtitle event exists: re-read when the source or backend changes.
    // Mirrors: a plugin listens through `watch` and bindings.
    runtime.on(
      "source.state",
      (data) => {
        const raw = data as SourceState;
        const source = `${raw.stamp.generation}:${raw.phase}`;
        if (source === this.#source) return;
        this.#source = source;
        void this.refresh().catch(() => {});
      },
      "held",
      true,
    );
    runtime.on(
      "playback.backend",
      () => void this.refresh().catch(() => {}),
      "held",
      true,
    );
    this.style = new Latest(async ({ style, options }) => {
      await this.inTurn(options, (expected) =>
        this.#mutate(++this.#operation, (operationId) =>
          runtime.host.subtitles.style({
            operationId,
            revision: ++this.#styleRevision,
            expected,
            style,
          }),
        ),
      );
    });
  }
  watch(watcher: () => void) {
    this.#watchers.add(watcher);
    const held = EVENTS.map((event) => this.#runtime.hold(event));
    return {
      dispose: async () => {
        this.#watchers.delete(watcher);
        for (const hold of held.splice(0)) await hold.dispose();
      },
    };
  }
  /** A binding that reads the state follows both events. */
  reading() {
    for (const event of EVENTS) this.#runtime.reading(event);
  }
  /** Keep the newest view: older generations and older revisions are dropped. */
  accept(raw: SubtitleState) {
    const old = this.raw;
    if (old) {
      if (raw.source.generation < old.source.generation) return;
      // While a new source loads, the host still reports the previous
      // source's selection stamp; once it is ready the selection restarts at
      // revision 0 of the new generation. Revisions compare within one
      // selection generation only.
      if (
        raw.source.generation === old.source.generation &&
        (raw.selection.stamp.generation < old.selection.stamp.generation ||
          (raw.selection.stamp.generation === old.selection.stamp.generation &&
            raw.selection.stamp.revision < old.selection.stamp.revision) ||
          raw.presentation.revision < old.presentation.revision)
      )
        return;
      if (JSON.stringify(raw) === JSON.stringify(old)) return;
    }
    this.raw = raw;
    this.state = this.#view(raw);
    for (const watcher of [...this.#watchers]) watcher();
    this.#runtime.invalidate();
  }
  /**
   * `subtitles.changed`'s state (SDK 1.11.0): taken into the copy when it
   * is newer, and handed to the listener as a {@link SubtitlesState} (the
   * copy's own when it holds the same state, so it works as `ifCurrent`).
   */
  event(raw: SubtitleState): SubtitlesState {
    this.accept(raw);
    return this.state && JSON.stringify(this.raw) === JSON.stringify(raw)
      ? this.state
      : this.#view(raw);
  }
  #view(raw: SubtitleState): SubtitlesState {
    const tracks = raw.tracks.map((track) => {
      const info: SubtitleTrack = Object.freeze({
        id: targetId(track.target),
        kind: track.target.kind,
        ...(track.target.kind === "embedded"
          ? { embeddedId: track.target.id }
          : {}),
        title: track.title,
        language: track.language,
        styleSupported: track.styleSupported,
        styleReason: track.styleReason,
        owned:
          track.target.kind === "external" &&
          this.owned.has(track.target.resourceId),
        codec: track.codec ?? null,
        text: track.text ?? false,
        streamIndex: track.streamIndex ?? null,
      });
      targets.set(info, track.target);
      return info;
    });
    const selected = targetId(raw.selection.target);
    const secondary = targetId(raw.selection.secondary ?? null);
    const state: SubtitlesState = Object.freeze({
      sourceId: raw.source.generation,
      phase: raw.source.phase,
      tracks,
      selected: tracks.find((track) => track.id === selected) ?? null,
      secondary: secondary
        ? (tracks.find((track) => track.id === secondary) ?? null)
        : null,
      fonts: raw.presentation.fonts.map((font) => ({
        id: font.id,
        family: font.family,
      })),
      style: raw.presentation.effective?.style ?? null,
      trackConfirmation: raw.confirmation,
      styleConfirmation: raw.presentation.confirmation,
      error: raw.error,
    });
    raws.set(state, raw);
    return state;
  }
  async refresh() {
    this.accept(await this.#runtime.host.subtitles.state());
    return this.state!;
  }
  /** Default: the selection as it is now. `ifCurrent` pins an older one. */
  async expected(options?: SubtitleConditional): Promise<SubtitleStamp> {
    const pinned = this.#pinned(options);
    if (pinned) return pinned;
    await this.refresh();
    return this.raw!.selection.stamp;
  }
  #pinned(options?: SubtitleConditional): SubtitleStamp | undefined {
    const pinned = options?.ifCurrent && raws.get(options.ifCurrent);
    return pinned ? pinned.selection.stamp : undefined;
  }
  /**
   * `send` with the selection stamp ({@link expected}), in its turn among
   * the plugin's calls on the source (`PlayerService.inTurn`): its first
   * request goes out in the same tick, or right after a read of the source
   * on its way for an earlier control.
   */
  inTurn<T>(
    options: SubtitleConditional | undefined,
    send: (expected: SubtitleStamp) => Promise<T>,
  ): Promise<T> {
    return playerOf(this.#runtime).inTurn(() => {
      const pinned = this.#pinned(options);
      return pinned ? send(pinned) : this.expected(options).then(send);
    });
  }
  nextOperation() {
    return ++this.#operation;
  }
  /**
   * Upload ids only need to increase within this owner: the host gives every
   * plugin load a new owner generation and drops its high-water mark on release.
   */
  nextUpload() {
    return ++this.#upload;
  }
  /** Mutations reply with the new state; a lost reply is read back by id. */
  async #mutate(id: number, send: (id: number) => Promise<SubtitleState>) {
    let result: SubtitleState;
    try {
      result = await send(id);
    } catch (error) {
      if (!uncertain(error)) throw error;
      result = await this.#recover(id);
    }
    this.accept(result);
    return this.state!;
  }
  mutate(send: (id: number) => Promise<SubtitleState>) {
    return this.#mutate(this.nextOperation(), send);
  }
  async #recover(id: number): Promise<SubtitleState> {
    for (;;) {
      let result;
      try {
        result = await this.#runtime.host.subtitles.operation(id);
      } catch (error) {
        if (!uncertain(error)) throw error;
        await sleep(100);
        continue;
      }
      if (result.status === "completed") return result.result;
      if (result.status === "failed")
        throw failure(result.error.code, result.error.message);
      // Ordered pipe: an unknown id was refused before admission.
      if (result.status === "unknown")
        throw failure("rejected", "字幕操作未被宿主接受");
      if (result.status === "unknownExpired") {
        await this.refresh().catch(() => {});
        throw failure("expired", "字幕操作结果已过期，请查看当前状态");
      }
      await sleep(100);
    }
  }
}

const serviceOf = (runtime: Runtime) =>
  runtime.service("subtitles", () => new SubtitleService(runtime));

function target(track: SubtitleTrack): Target {
  const found = targets.get(track);
  if (!found) throw failure("invalid", "unknown subtitle track");
  return found;
}

/** `subtitles.changed`'s data as the listener gets it (`ScopeImpl.fact`). */
export function subtitlesChanged(runtime: Runtime, data: unknown) {
  const { state } = data as { state: SubtitleState };
  return { state: serviceOf(runtime).event(state) };
}

export function subtitles(scope: ScopeImpl): Subtitles {
  const service = () => serviceOf(scope.runtime);
  const host = () => scope.runtime.host.subtitles;
  return {
    get state() {
      service().reading();
      return service().state;
    },
    onChange(listener) {
      const watch = service().watch(() => scope.run(listener, service().state));
      return scope.add({
        dispose: async () => {
          scope.forget(watch);
          await watch.dispose();
        },
      });
    },
    refresh: () => service().refresh(),
    async select(track, options) {
      const role = options?.role ?? "primary";
      if (role !== "primary" && role !== "secondary")
        throw failure("invalid", 'role must be "primary" or "secondary"');
      const chosen = track && target(track);
      return service().inTurn(options, (expected) =>
        service().mutate((id) => host().select(chosen, expected, id, role)),
      );
    },
    async load(bytes, options) {
      const asked = options?.format ?? "srt";
      if (asked !== "srt" && asked !== "ass" && asked !== "vtt")
        throw failure("invalid", "format must be srt, ass or vtt");
      // WebVTT goes to the player as SRT (its checks apply unchanged).
      const srt = asked === "vtt" ? webvttToSrt(bytes) : bytes;
      const format = asked === "vtt" ? "srt" : asked;
      const select = options?.select ?? "primary";
      if (select !== "primary" && select !== "secondary" && select !== "none")
        throw failure(
          "invalid",
          'select must be "primary", "secondary" or "none"',
        );
      const title = options?.title;
      // A text value (`plugin.i18n.text`) is checked here and its shown
      // length by the player.
      if (isTextValue(title)) {
        const problem = textProblem(title);
        if (problem) throw failure("invalid", `title: ${problem}`);
      } else if (
        title !== undefined &&
        (typeof title !== "string" ||
          [...title].length < 1 ||
          [...title].length > 200)
      )
        throw failure("invalid", "title needs 1–200 characters");
      const svc = service();
      // In its turn among the plugin's calls on the source.
      const current = await playerOf(scope.runtime).inTurn(() => svc.refresh());
      const expected = await svc.expected(options);
      const uploadId = svc.nextUpload();
      const resourceId = `external-${uploadId}`;
      let committing = false;
      try {
        // Cancellation is honoured between chunks and before the commit; a
        // commit already handed to the host may take effect, so it is final.
        const check = () => {
          if (options?.signal?.aborted) throw abortError();
        };
        check();
        await host().begin(
          uploadId,
          current.sourceId,
          srt.length,
          options?.signal,
        );
        for (let offset = 0; offset < srt.length; offset += CHUNK) {
          check();
          const chunk = Buffer.from(srt.subarray(offset, offset + CHUNK));
          await host().append(
            uploadId,
            offset,
            chunk.toString("base64"),
            options?.signal,
          );
        }
        const sha256 = createHash("sha256").update(srt).digest("hex");
        check();
        committing = true;
        svc.owned.add(resourceId);
        const state = await svc.mutate((operationId) =>
          host().commit({
            operationId,
            uploadId,
            resourceId,
            revision: 1,
            sha256,
            expected,
            // Defaults are left out: the request stays what older hosts accept.
            ...(format !== "srt" ? { format } : {}),
            ...(title !== undefined ? { title } : {}),
            ...(select !== "primary" ? { select } : {}),
          }),
        );
        const loaded = state.tracks.find(
          (track) =>
            track.owned &&
            target(track).kind === "external" &&
            (target(track) as { resourceId: string }).resourceId === resourceId,
        );
        if (!loaded) throw failure("missing", "已提交的字幕轨不在当前状态中");
        return loaded;
      } catch (error) {
        // Free the upload's slot (2 per plugin). Before the commit the
        // discard is awaited, as it always was (an abort resolves once the
        // upload is gone). After a refused commit the player still holds
        // the upload; after one that took effect it was consumed and the
        // discard is a harmless no-op. Sent, not awaited: the player handles
        // it before any later request of this plugin.
        const discard = host()
          .discard(uploadId)
          .catch(() => {});
        if (!committing) await discard;
        if (committing && (error as { code?: string }).code !== "missing")
          svc.owned.delete(resourceId);
        throw error;
      }
    },
    async remove(track, options) {
      const chosen = target(track);
      if (chosen.kind !== "external" || !service().owned.has(chosen.resourceId))
        throw failure("invalid", "只能移除本插件加载的字幕");
      const state = await service().inTurn(options, (expected) =>
        service().mutate((id) =>
          host().remove(chosen.resourceId, expected, id),
        ),
      );
      service().owned.delete(chosen.resourceId);
      return state;
    },
    async setStyle(style, options) {
      await service().style.push({ style, options });
      return service().state!;
    },
  };
}
