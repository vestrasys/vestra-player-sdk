/**
 * The source and what plays: `source.*` intents and resolvers, playback,
 * subtitles and audio.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { extname, isAbsolute } from "node:path";
import { HostError } from "../../wire.ts";
import type { Json } from "../../wire.ts";
import { SUBTITLE_LIMITS } from "../subtitles.ts";
import type { SourceState, SourceStamp } from "../../source.ts";
import type { SubtitleState } from "../../subtitles.ts";
import { isTextValue } from "../../i18n.ts";
import type { TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";
import { taken } from "./transport.ts";
import { declaredText, hostText } from "./i18n.ts";
import { timelineChanged } from "./layout.ts";

export function initialSource(): SourceState {
  return {
    kind: "media",
    container: null,
    audioTracks: null,
    stamp: { generation: 0, intentVersion: 0 },
    cycle: 0,
    eventSequence: 0,
    phase: "empty",
    source: null,
    loadingOwner: null,
    terminalReason: null,
    paused: false,
    position: null,
    duration: null,
    capabilities: {
      pause: false,
      seek: false,
      rate: false,
      restart: false,
      close: false,
      snapshotSource: false,
    },
    output: { volume: 100, muted: false },
    rate: 1,
  };
}

export const readyCapabilities = {
  pause: true,
  seek: true,
  rate: true,
  restart: true,
  close: true,
  snapshotSource: true,
};

export function sourceIntent(
  host: TestHost,
  inner: Internals,
  intent: Record<string, Json>,
): { ticket: Json } {
  // Both flags cover this intent only, whatever becomes of it (a stale
  // one too, as in the player).
  const hold = inner.holdPause;
  inner.holdPause = false;
  inner.stepped = false;
  const expected = intent.expected as SourceStamp | undefined;
  const stamp = host.source.stamp;
  if (
    expected &&
    (expected.generation !== stamp.generation ||
      expected.intentVersion !== stamp.intentVersion)
  )
    throw new HostError("stale", "stale");
  // A new load, a restart or Close: the end that was kept is gone.
  if (intent.kind !== "control") inner.endKeepsPause = false;
  const next = {
    ...host.source,
    stamp: { ...stamp, intentVersion: stamp.intentVersion + 1 },
    eventSequence: host.source.eventSequence + 1,
  };
  if (intent.kind === "open" || intent.kind === "openProvider") {
    next.stamp.generation++;
    next.cycle++;
    next.kind = intent.kind === "open" ? "media" : "producer";
    next.source =
      intent.kind === "open"
        ? String(intent.source)
        : `producer://${intent.producerId}`;
    next.phase = intent.kind === "open" ? "loading" : "ready";
    next.paused = intent.startPaused === true;
    next.position = null;
    next.duration = null;
    next.terminalReason = null;
    next.capabilities = { ...readyCapabilities };
    next.loop = null; // a new source clears the A-B loop
    if (host.timeline.layers.size || host.timeline.rangeLayers.size) {
      host.timeline.layers.clear(); // and every timeline layer
      host.timeline.rangeLayers.clear();
      queueMicrotask(() => timelineChanged(host, inner));
    }
  } else if (intent.kind === "close") {
    if (!host.source.source) throw new HostError("invalid", "noSource");
    Object.assign(next, {
      phase: "empty",
      source: null,
      position: null,
      duration: null,
      terminalReason: "stopped",
    });
  } else if (intent.kind === "restart") {
    next.cycle++;
    Object.assign(next, {
      phase: "ready",
      position: 0,
      paused: false,
      terminalReason: null,
    });
  } else if (intent.kind === "control") {
    if (!host.source.source) throw new HostError("invalid", "noSource");
    const control = intent.control as Record<string, Json>;
    if (control.kind === "pause") next.paused = control.paused === true;
    if (control.kind === "seek") {
      if (atEndAlready(host, Number(control.seconds))) {
        // Goes nowhere; keep-open holds the end paused.
        next.paused = true;
      } else {
        next.position = Number(control.seconds);
        // Like the player (2026-11-09): a seek leaves the end and plays on,
        // except a step back from the end, or after an end reached while
        // paused or by frame stepping. Leaving the end starts a new cycle
        // (session.rs `confirm_seek_from_end`), so the next end is new.
        if (host.source.phase === "ended") {
          next.cycle++;
          next.phase = "ready";
          next.terminalReason = null;
          next.paused = hold || inner.endKeepsPause;
        }
      }
    }
    if (control.kind === "rate") next.rate = Number(control.rate);
  }
  // Like the player: the selected producer is retired as soon as another
  // source replaces it or the source closes.
  if (["open", "openProvider", "close"].includes(String(intent.kind)))
    retireSelected(
      host,
      inner,
      intent.kind === "openProvider" ? Number(intent.producerId) : null,
    );
  if (intent.kind === "openProvider")
    inner.selected = Number(intent.producerId);
  if (intent.kind === "open" || intent.kind === "close") inner.selected = null;
  host.source = next;
  host.subtitles.source = {
    generation: next.stamp.generation,
    phase: next.phase,
  };
  host.emit("source.state", host.source);
  cancelResolutions(host, inner);
  return { ticket: { stamp: next.stamp, cycle: next.cycle, owner: 1 } };
}

/**
 * Like the player: after the end, a seek at or past the end (the smaller of
 * the position and the duration, 0.5 ms slack) goes nowhere. It is accepted;
 * the source stays ended and paused.
 */
export function atEndAlready(host: TestHost, seconds: number): boolean {
  const s = host.source;
  if (s.phase !== "ended") return false;
  const end =
    s.position !== null && s.duration !== null
      ? Math.min(s.position, s.duration)
      : (s.position ?? s.duration);
  return end !== null && seconds >= end - 0.0005;
}

/** The file resolver of this plugin that claims `source`, if any. */
export function fileResolver(
  host: TestHost,
  _inner: Internals,
  source: string,
): string | null {
  if (source.includes("://") || !isAbsolute(source)) return null;
  const extension = extname(source).slice(1).toLowerCase();
  if (!extension) return null;
  for (const [id, declaration] of host.resolvers) {
    const extensions = (declaration as { extensions?: string[] }).extensions;
    if (extensions?.includes(extension)) return id;
  }
  return null;
}

/** Retire the producer that is the player's source, unless it is `keep`. */
export function retireSelected(
  host: TestHost,
  inner: Internals,
  keep: number | null,
) {
  for (const producer of host.producers.values())
    if (
      producer.id !== keep &&
      !producer.retired &&
      isCurrentProducer(host, inner, producer.id)
    )
      producer.retired = true;
}

/** Whether producer `id` is the player's source. */
export function isCurrentProducer(
  host: TestHost,
  inner: Internals,
  id: number,
) {
  return (
    host.source.kind === "producer" &&
    (inner.selected === id || host.source.source === `producer://${id}`)
  );
}

/** Start resolving `source` for the open just made; its request id, or null. */
export function startResolution(
  host: TestHost,
  inner: Internals,
  source: string,
  paused: boolean,
  operation?: number,
): number | null {
  const resolverId = fileResolver(host, inner, source);
  if (resolverId === null) return null;
  const requestId = ++inner.next.resolution;
  host.resolutions.set(requestId, { resolverId, source, paused });
  inner.resolving.set(requestId, {
    stamp: { ...host.source.stamp },
    ...(operation === undefined ? {} : { operation }),
  });
  host.emit("source.resolveRequest", { requestId, resolverId, url: source });
  return requestId;
}

/** Settle a resolution's open; `error` fails it. */
export function settleResolution(
  host: TestHost,
  inner: Internals,
  requestId: number,
  error?: string,
) {
  const operation = inner.resolving.get(requestId)?.operation;
  host.resolutions.delete(requestId);
  inner.resolving.delete(requestId);
  if (operation === undefined) return;
  const entry = inner.sourceBook.get(operation) as
    { ticket?: Json } | undefined;
  inner.sourceBook.set(
    operation,
    error === undefined
      ? { status: "completed", ticket: entry?.ticket ?? null }
      : { status: "failed", error: { backend: error } },
  );
}

/** Resolutions whose open is no longer the source (or whose resolver left). */
export function cancelResolutions(host: TestHost, inner: Internals) {
  const stamp = host.source.stamp;
  for (const [requestId, resolution] of [...host.resolutions]) {
    const pending = inner.resolving.get(requestId)!;
    if (
      pending.stamp.generation === stamp.generation &&
      pending.stamp.intentVersion === stamp.intentVersion &&
      host.resolvers.has(resolution.resolverId)
    )
      continue;
    settleResolution(
      host,
      inner,
      requestId,
      "source resolution cancelled, expired or superseded",
    );
    host.emit("source.resolveCancel", {
      requestId,
      resolverId: resolution.resolverId,
    });
  }
}

/** `sourceResolvers.register`: the player's rules for both forms. */
export function registerResolver(
  host: TestHost,
  inner: Internals,
  p: Record<string, Json>,
) {
  const id = String(p.id);
  const extensions = p.extensions as string[] | undefined;
  if (host.resolvers.has(id))
    throw new HostError("conflict", "resolver id already registered");
  if (extensions !== undefined) {
    if (
      p.schemes !== undefined ||
      p.hosts !== undefined ||
      !Array.isArray(extensions) ||
      extensions.length < 1 ||
      extensions.length > 16 ||
      extensions.some(
        (e) =>
          typeof e !== "string" ||
          !/^[a-z0-9]{1,16}$/.test(e) ||
          e === "folder",
      )
    )
      throw new HostError(
        "invalid",
        "file resolvers take 1–16 file extensions (lower case, no dot, not folder)",
      );
  }
  const claims = (other: {
    extensions?: string[];
    schemes?: string[];
    hosts?: string[];
  }) =>
    extensions?.find((e) => other.extensions?.includes(e)) ??
    (other.hosts?.some((h) => (p.hosts as string[] | undefined)?.includes(h)) &&
    other.schemes?.some((x) => (p.schemes as string[] | undefined)?.includes(x))
      ? "host"
      : undefined);
  for (const own of host.resolvers.values())
    if (claims(own as never))
      throw new HostError("conflict", "already registered by this plugin");
  for (const other of host.otherResolvers) {
    const what = claims(other);
    if (what) {
      const target =
        what === "host"
          ? hostText(host, inner, "this site")
          : hostText(host, inner, "File type .{}", [what]);
      throw taken(
        hostText(host, inner, "{} is resolved by {}", [target, other.owner]),
      );
    }
  }
  host.resolvers.set(id, p);
}

/** `sourceResolvers.respond` for a simulated file resolution. */
export function respondResolution(
  host: TestHost,
  inner: Internals,
  p: Record<string, Json>,
) {
  const requestId = Number(p.requestId);
  const resolution = host.resolutions.get(requestId);
  if (!resolution) {
    // Web resolutions are not simulated: their answers are only recorded.
    if (requestId > inner.next.resolution) return null;
    throw new HostError("stale", "resolution no longer pending");
  }
  const fail = (message: string): never => {
    settleResolution(host, inner, requestId, message);
    host.setSource({
      phase: "error",
      terminalReason: { failed: message },
    } as Partial<SourceState>);
    throw new HostError("resolution", message);
  };
  // A text value (`plugin.i18n.error`) is shown translated, like the player.
  const error = isTextValue(p.error)
    ? declaredText(host, inner, p.error, "error")
    : p.error;
  if (typeof error === "string")
    fail(error.trim() ? [...error].slice(0, 2048).join("") : "resolver failed");
  const result = (p.result ?? {}) as { kind?: string; producerId?: number };
  const producer = host.producers.get(Number(result.producerId));
  if (result.kind !== "stream") fail("invalid resolved stream descriptor");
  if (!producer || producer.released || producer.retired)
    fail("unavailable: producer absent");
  // Like openProvider, but the source keeps the path and `startPaused`.
  retireSelected(host, inner, producer!.id);
  inner.selected = producer!.id;
  producer!.active = true;
  producer!.acknowledged = false;
  producer!.pending = {
    producerId: producer!.id,
    epoch: producer!.epoch + 1,
    baseSample: producer!.receivedFrames,
    paused: resolution.paused,
  };
  settleResolution(host, inner, requestId);
  host.setSource({
    kind: "producer",
    phase: "ready",
    paused: resolution.paused,
    capabilities: {
      pause: true,
      seek: false,
      rate: false,
      restart: false,
      close: true,
      snapshotSource: false,
    },
  } as Partial<SourceState>);
  return { stamp: { ...host.source.stamp } };
}

/** Audio track calls need ready media and the source the caller saw. */
export function audioCondition(
  host: TestHost,
  _inner: Internals,
  expected: Json | undefined,
) {
  const want = expected as SourceStamp | undefined;
  const stamp = host.source.stamp;
  if (
    want &&
    (want.generation !== stamp.generation ||
      want.intentVersion !== stamp.intentVersion)
  )
    throw new HostError("stale", "source changed");
  if (
    host.source.kind !== "media" ||
    !["ready", "ended"].includes(host.source.phase)
  )
    throw new HostError("unavailable", "audio tracks need ready media");
}

/** `stale` unless `expected` is the current subtitle stamp. */
export function subtitleExpected(
  host: TestHost,
  _inner: Internals,
  expected: Json,
) {
  const stamp = host.subtitles.selection.stamp;
  const want = expected as { generation: number; revision: number };
  if (want.generation !== stamp.generation || want.revision !== stamp.revision)
    throw new HostError("stale", "subtitle selection changed");
}

export function loadedSubtitles(host: TestHost, inner: Internals) {
  const generation = host.source.stamp.generation;
  if (inner.subtitleResources.generation !== generation)
    inner.subtitleResources = { generation, bytes: new Map() };
  return inner.subtitleResources.bytes;
}

/**
 * The player's `SUBTITLE_LIMITS` for a new resource (`busy`, as the
 * player reports them). External tracks in `subtitles.tracks` that this
 * plugin did not load count as other plugins'. `totalBytes` is not
 * modelled: one plugin's 4 files of at most 2 MiB stay below it, and the
 * bytes of other plugins' tracks are unknown.
 */
export function subtitleRoom(
  host: TestHost,
  inner: Internals,
  resourceId: string,
) {
  const loaded = loadedSubtitles(host, inner);
  if (loaded.has(resourceId)) return;
  const external = host.subtitles.tracks.filter(
    (t) => t.target.kind === "external",
  );
  const own = external.filter(
    (t) => t.target.kind === "external" && loaded.has(t.target.resourceId),
  );
  const others = external.length - own.length;
  if (
    loaded.size >= SUBTITLE_LIMITS.loadsPerPlugin ||
    loaded.size + others >= SUBTITLE_LIMITS.loads ||
    own.length >= SUBTITLE_LIMITS.tracksPerPlugin ||
    external.length >= SUBTITLE_LIMITS.tracks
  )
    throw new HostError("busy", "subtitle resource or counter limit exceeded");
}

export function subtitleChange(
  host: TestHost,
  inner: Internals,
  expected: Json,
) {
  subtitleExpected(host, inner, expected);
  const stamp = host.subtitles.selection.stamp;
  host.subtitles.selection.stamp = {
    generation: host.source.stamp.generation,
    revision: stamp.revision + 1,
  };
}

/** Implements `TestHost.setSource`. */
export function setSource(
  host: TestHost,
  inner: Internals,
  patch: Partial<SourceState>,
) {
  // The end keeps the pause when reached while paused or by a frame step
  // (the player reads this as the end arrives).
  if (patch.phase === "ended" && host.source.phase !== "ended")
    inner.endKeepsPause = inner.stepped || host.source.paused;
  host.source = {
    ...host.source,
    ...patch,
    eventSequence: host.source.eventSequence + 1,
  };
  if (patch.phase && patch.phase !== "empty" && !patch.capabilities)
    host.source.capabilities = { ...readyCapabilities };
  host.subtitles.source = {
    generation: host.source.stamp.generation,
    phase: host.source.phase,
  };
  host.emit("source.state", host.source);
  // Like the player (reference §6.3): loading shows the backdrop.
  if (patch.phase === "loading" && host.backdrop && !host.backdrop.effective)
    host.setBackdropEffective(true);
}

/** The default handlers of this area's wire methods, by method name. */
export function mediaHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    "playback.stats": () => host.stats,
    "audio.addTrack": (p) => {
      audioCondition(host, inner, p.expected);
      const path = String(p.path);
      if (!path.startsWith("/") || path.includes("://"))
        throw new HostError(
          "invalid",
          "path must be an existing absolute file",
        );
      const tracks = host.source.audioTracks ?? [];
      const track = {
        trackId: Math.max(0, ...tracks.map((t) => t.trackId)) + 1,
        streamIndex: null,
        selected: p.select !== false,
        external: true,
        codec: null,
        title: path.split("/").pop() ?? null,
        language: null,
      };
      host.setSource({
        audioTracks: [
          ...tracks.map((t) => ({
            ...t,
            selected: track.selected ? false : t.selected,
          })),
          track,
        ],
      });
      return track;
    },
    "audio.selectTrack": (p) => {
      audioCondition(host, inner, p.expected);
      const tracks = host.source.audioTracks ?? [];
      if (!tracks.some((t) => t.trackId === p.id))
        throw new HostError("invalid", "no such audio track");
      host.setSource({
        audioTracks: tracks.map((t) => ({
          ...t,
          selected: t.trackId === p.id,
        })),
      });
    },
    "source.state": () => host.source,
    "source.submit": (p) => {
      const intent = p.intent as Record<string, Json>;
      const control = intent.control as Record<string, Json> | undefined;
      if (intent.kind === "control" && control?.kind === "seek") {
        if (
          control.keyframes !== undefined &&
          typeof control.keyframes !== "boolean"
        )
          throw new HostError("invalid", "keyframes must be a boolean");
        host.seeks.push({
          seconds: Number(control.seconds),
          keyframes: control.keyframes === true,
        });
      }
      const ticket = sourceIntent(host, inner, intent);
      const operation = Number(p.operationId);
      // A file this plugin's file resolver claims: pending until it answers.
      if (
        intent.kind === "open" &&
        startResolution(
          host,
          inner,
          String(intent.source),
          intent.startPaused === true,
          operation,
        ) !== null
      ) {
        const pending = { status: "pending", ...ticket };
        inner.sourceBook.set(operation, pending);
        return pending;
      }
      const result = { status: "completed", ...ticket };
      inner.sourceBook.set(operation, result);
      // Selecting a provider asks it to acknowledge a start control.
      const producer = host.producers.get(Number(intent.producerId));
      if (intent.kind === "openProvider" && producer) {
        producer.acknowledged = false;
        producer.pending = {
          producerId: producer.id,
          epoch: producer.epoch + 1,
          baseSample: producer.receivedFrames,
          paused: false,
        };
      }
      return result;
    },
    // The player's `media.sources.open`: the token's file opened as a
    // `source.submit` open under the plugin's operation id, at `start`.
    "media.sources.open": (p) => {
      const reference = host.sourceReferences.get(String(p.token));
      if (!reference)
        throw new HostError("missing", "no such source reference");
      const file = host.mediaFiles.get(reference.path) ?? {};
      if (file.status === "missing")
        throw new HostError("source-missing", "the file is missing");
      if (
        file.status === "changed" ||
        (file.version ?? 0) !== (reference.version ?? 0)
      )
        throw new HostError(
          "source-changed",
          "the file changed since it was remembered",
        );
      const start = p.start === undefined ? 0 : Number(p.start);
      const duration = file.duration ?? host.source.duration ?? 60;
      if (!(start >= 0 && start < duration))
        throw new HostError("invalid", "start must be before the file's end");
      const intent = {
        kind: "open",
        source: reference.path,
        startPaused: false,
      };
      host.sourceOpens.push({ token: String(p.token), start });
      const ticket = sourceIntent(host, inner, intent);
      // Loaded at once, at the start (the player's `start=`).
      host.setSource({ phase: "ready", duration, position: start });
      const result = { status: "completed", ...ticket };
      inner.sourceBook.set(Number(p.operationId), result);
      return result;
    },
    "source.operation": (p) => {
      const result = inner.sourceBook.get(Number(p.operationId));
      if (!result) throw new HostError("unknown-expired", "UnknownExpired");
      return result;
    },
    "playback.set": (p) => {
      if (p.property === "volume")
        host.source.output = { ...host.source.output, volume: Number(p.value) };
      if (p.property === "muted")
        host.source.output = { ...host.source.output, muted: p.value === true };
      host.source = {
        ...host.source,
        eventSequence: host.source.eventSequence + 1,
      };
    },
    "subtitles.state": () => structuredClone(host.subtitles),
    "subtitles.select": (p) => {
      const target = p.target as SubtitleState["selection"]["target"];
      const same = (a: unknown, b: unknown) =>
        a != null && JSON.stringify(a) === JSON.stringify(b);
      if (p.role === "secondary") {
        if (same(target, host.subtitles.selection.target))
          throw new HostError("invalid", "secondary equals the primary");
        const track = host.subtitles.tracks.find((t) => same(t.target, target));
        if (track && track.text === false)
          throw new HostError(
            "invalid",
            "a bitmap subtitle cannot be secondary",
          );
        subtitleChange(host, inner, p.expected!);
        host.subtitles.selection.secondary = target;
        return structuredClone(host.subtitles);
      }
      if (same(target, host.subtitles.selection.secondary))
        throw new HostError("invalid", "primary equals the secondary");
      subtitleChange(host, inner, p.expected!);
      host.subtitles.selection.target = target;
      return structuredClone(host.subtitles);
    },
    "player.audioDevices": () => structuredClone(host.audioDevices),
    "player.setAudioDevice": (p) => {
      const requested = p.id === null ? null : String(p.id);
      const present = host.audioDevices.some((d) => d.id === requested);
      host.setSource({
        audioOutput: { requested, active: present ? requested : null },
      });
    },
    "subtitles.style": (p) => {
      subtitleChange(host, inner, p.expected!);
      host.subtitles.presentation.revision++;
      host.subtitles.presentation.effective = p.style
        ? {
            owner: 1,
            manifestId: host.manifestId,
            revision: Number(p.revision),
            style: p.style as never,
          }
        : null;
      return structuredClone(host.subtitles);
    },
    "subtitles.upload.begin": (p) => {
      if (p.generation !== host.source.stamp.generation)
        throw new HostError("stale", "source generation changed");
      const expectedBytes = Number(p.expectedBytes);
      if (
        !Number.isSafeInteger(expectedBytes) ||
        expectedBytes < 1 ||
        expectedBytes > SUBTITLE_LIMITS.fileBytes
      )
        throw new HostError(
          "invalid",
          `a subtitle file has 1..${SUBTITLE_LIMITS.fileBytes} bytes`,
        );
      // Like the player: a new source drops the old one's uploads. A commit
      // the player refused leaves its upload for `subtitles.upload.discard`,
      // which the SDK sends after any failed load.
      for (const [id, upload] of host.uploads)
        if (
          upload.generation !== undefined &&
          upload.generation !== host.source.stamp.generation
        )
          host.uploads.delete(id);
      if (host.uploads.size >= SUBTITLE_LIMITS.uploadsPerPlugin)
        throw new HostError(
          "busy",
          "upload memory, owner or active-token limit reached",
        );
      host.uploads.set(Number(p.uploadId), {
        bytes: [],
        expected: expectedBytes,
        generation: host.source.stamp.generation,
      });
      return {
        generation: p.generation!,
        expectedBytes: p.expectedBytes!,
        receivedBytes: 0,
        complete: false,
      };
    },
    "subtitles.upload.append": (p) => {
      const upload = host.uploads.get(Number(p.uploadId));
      if (!upload) throw new HostError("missing", "upload");
      upload.bytes.push(Buffer.from(String(p.base64), "base64"));
      return {};
    },
    "subtitles.upload.discard": (p) =>
      void host.uploads.delete(Number(p.uploadId)),
    "subtitles.commit": (p) => {
      // The player's order: the request's own fields, then `stale`, then
      // the upload and its content, then the limits.
      const format = p.format === "ass" ? "ass" : "srt";
      const select =
        p.select === "none"
          ? "none"
          : p.select === "secondary"
            ? "secondary"
            : "primary";
      const title = isTextValue(p.title)
        ? declaredText(host, inner, p.title, "title")
        : typeof p.title === "string"
          ? p.title
          : null;
      if (title !== null && ([...title].length < 1 || [...title].length > 200))
        throw new HostError(
          "invalid",
          "subtitle title needs 1..200 characters",
        );
      subtitleExpected(host, inner, p.expected!);
      const upload = host.uploads.get(Number(p.uploadId));
      if (!upload) throw new HostError("missing", "upload");
      const bytes = Buffer.concat(upload.bytes);
      if (
        format === "ass" &&
        !(
          /\[Script Info\]/i.test(bytes.toString()) &&
          /\[Events\]/i.test(bytes.toString())
        )
      )
        throw new HostError(
          "invalid",
          "ASS requires [Script Info] and [Events] sections",
        );
      subtitleRoom(host, inner, String(p.resourceId));
      subtitleChange(host, inner, p.expected!);
      loadedSubtitles(host, inner).set(String(p.resourceId), bytes.length);
      const target = {
        kind: "external" as const,
        owner: 1,
        resourceId: String(p.resourceId),
        contentRevision: 1,
      };
      host.subtitles.tracks.push({
        target,
        title:
          title ??
          hostText(
            host,
            inner,
            format === "ass" ? "External ASS" : "External SRT",
          ),
        language: null,
        styleSupported: true,
        styleReason: null,
        codec: format === "ass" ? "ass" : "webvtt",
        text: true,
        streamIndex: null,
      });
      if (select === "primary") host.subtitles.selection.target = target;
      if (select === "secondary") host.subtitles.selection.secondary = target;
      host.subtitleLoads.push({ format, title, select, bytes });
      host.uploads.delete(Number(p.uploadId));
      return structuredClone(host.subtitles);
    },
    "subtitles.remove": (p) => {
      subtitleChange(host, inner, p.expected!);
      host.subtitles.tracks = host.subtitles.tracks.filter(
        (t) =>
          t.target.kind !== "external" || t.target.resourceId !== p.resourceId,
      );
      const selected = host.subtitles.selection.target;
      if (selected?.kind === "external" && selected.resourceId === p.resourceId)
        host.subtitles.selection.target = null;
      const secondary = host.subtitles.selection.secondary;
      if (
        secondary?.kind === "external" &&
        secondary.resourceId === p.resourceId
      )
        host.subtitles.selection.secondary = null;
      return structuredClone(host.subtitles);
    },
    "subtitles.operation": () => ({ status: "unknown" }),
    "sourceResolvers.register": (p) => {
      registerResolver(host, inner, p);
      host.updateFileTypes();
    },
    "sourceResolvers.unregister": (p) => {
      host.resolvers.delete(String(p.id));
      cancelResolutions(host, inner);
      host.updateFileTypes();
    },
    "sourceResolvers.respond": (p) => respondResolution(host, inner, p),
  };
}
