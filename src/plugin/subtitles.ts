/** Subtitle selection, external SRT resources and this plugin's style layer. */
import { createHash } from "node:crypto";
import type {
  SubtitleState,
  SubtitleStamp,
  SubtitleTrack as Target,
} from "../subtitles.ts";
import { isTextValue, textProblem } from "../i18n.ts";
import type { SourceState } from "../source.ts";
import { Latest, failure, sleep, uncertain } from "./runtime.ts";
import { abortError } from "./player.ts";
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
    runtime.on("source.state", (data) => {
      const raw = data as SourceState;
      const source = `${raw.stamp.generation}:${raw.phase}`;
      if (source === this.#source) return;
      this.#source = source;
      void this.refresh().catch(() => {});
    });
    runtime.on("playback.backend", () => void this.refresh().catch(() => {}));
    this.style = new Latest(async ({ style, options }) => {
      const expected = await this.expected(options);
      await this.#mutate(++this.#operation, (operationId) =>
        runtime.host.subtitles.style({
          operationId,
          revision: ++this.#styleRevision,
          expected,
          style,
        }),
      );
    });
  }
  watch(watcher: () => void) {
    this.#watchers.add(watcher);
    return {
      dispose: async () => {
        this.#watchers.delete(watcher);
      },
    };
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
    const pinned = options?.ifCurrent && raws.get(options.ifCurrent);
    if (pinned) return pinned.selection.stamp;
    await this.refresh();
    return this.raw!.selection.stamp;
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

export function subtitles(scope: ScopeImpl): Subtitles {
  const service = () => serviceOf(scope.runtime);
  const host = () => scope.runtime.host.subtitles;
  return {
    get state() {
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
      const expected = await service().expected(options);
      const chosen = track && target(track);
      return service().mutate((id) =>
        host().select(chosen, expected, id, role),
      );
    },
    async load(srt, options) {
      const format = options?.format ?? "srt";
      if (format !== "srt" && format !== "ass")
        throw failure("invalid", "format must be srt or ass");
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
      const current = await svc.refresh();
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
        await host().begin(uploadId, current.sourceId, srt.length);
        for (let offset = 0; offset < srt.length; offset += CHUNK) {
          check();
          const chunk = Buffer.from(srt.subarray(offset, offset + CHUNK));
          await host().append(uploadId, offset, chunk.toString("base64"));
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
      const expected = await service().expected(options);
      const state = await service().mutate((id) =>
        host().remove(chosen.resourceId, expected, id),
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
