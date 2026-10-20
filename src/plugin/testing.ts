/**
 * An in-memory host for plugin tests. It speaks the real wire protocol, so the
 * SDK's own logic (revisions, CAS, recovery, coalescing) runs unchanged.
 * Semantics are simplified: no media decoding, no Slint, no native windows.
 *
 *   const { host } = await startPlugin(activate, { directory: new URL("..", import.meta.url) });
 *   await host.command("video.picture").run();
 *   host.window("picture").emit("adjust", "brightness", 40);
 *   await host.settle();
 */
import { readFileSync } from "node:fs";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HostError } from "../wire.ts";
import type {
  Json,
  LayoutSlot,
  LocalServices,
  PlaybackStats,
  Transport,
} from "../wire.ts";
import type { CommandDeclaration } from "../commands.ts";
import type { SourceState, SourceStamp } from "../source.ts";
import type { SubtitleState } from "../subtitles.ts";
import { nodeProblem } from "../processing.ts";
import type { MediaJob } from "../media.ts";
import { createPlugin } from "./index.ts";
import type { Plugin } from "./types.ts";

/** Throw one of these from `host.handle(...)` to simulate a definite refusal. */
export { HostError };

type Handler = (params: Record<string, Json>) => unknown;
type Call = { method: string; params: Record<string, Json> };

export interface FakeWindow {
  file: string;
  visible: boolean;
  props: Record<string, Json>;
  callbacks: string[];
  /** Fire a Slint callback (kebab or camelCase name). */
  emit(callback: string, ...args: Json[]): void;
}

export interface FakeCommand {
  declaration: CommandDeclaration;
  state: {
    enabled: boolean;
    checked: boolean | null;
    busy: boolean;
    reason: string | null;
  };
  revision: number;
  /** Execute it like the menu would (refused when disabled or busy). */
  run(): Promise<void>;
}

export interface FakeProducer {
  id: number;
  receivedFrames: number;
  videoFrames: number;
  released: boolean;
}

const kebab = (name: string) =>
  name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

function initialSource(): SourceState {
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

const readyCapabilities = {
  pause: true,
  seek: true,
  rate: true,
  restart: true,
  close: true,
  snapshotSource: true,
};

export class TestHost implements Transport {
  /** Every request in order, for assertions. */
  readonly calls: Call[] = [];
  readonly subscriptions = new Set<string>();
  source: SourceState = initialSource();
  readonly windows = new Map<string, FakeWindow>();
  panel:
    | (Omit<FakeWindow, "callbacks"> & {
        slot: string;
        component: string;
        locks: Json;
      })
    | null = null;
  readonly commands = new Map<string, FakeCommand>();
  /** Both panel positions as `layout.state` reports them. */
  readonly layout: { bottom: LayoutSlot | null; sidebar: LayoutSlot | null } = {
    bottom: null,
    sidebar: null,
  };
  /** Every `osd.show` text, newest last. */
  readonly osd: string[] = [];
  /** The text of this plugin's osd panel, `null` when hidden. */
  osdPanel: string | null = null;
  /** The sequence provider's flags, `null` without a provider. */
  sequence: { canNext: boolean; canPrevious: boolean } | null = null;
  /** What `player.stats()` returns. */
  stats: PlaybackStats = {
    backend: "test",
    session: 0,
    framesShown: 0,
    framesDropped: 0,
    video: null,
    audio: null,
    avSyncMs: null,
    cacheSeconds: null,
  };
  /** Every `subtitles.load`: its options and bytes, newest last. */
  readonly subtitleLoads: {
    format: "srt" | "ass";
    title: string | null;
    select: "primary" | "none";
    bytes: Buffer;
  }[] = [];
  /** The fake clipboard: preset `text` to test `readText`; written images by path. */
  readonly clipboard: { text: string | null; images: string[] } = {
    text: null,
    images: [],
  };
  /** The effective `power.preventSleep` mode. */
  power: "off" | "playing" = "off";
  /**
   * External tools: `handle("ffprobe", (args) => ({ stdout: "…" }))` makes the
   * tool available and answers each run (throw a HostError to fail it);
   * without a handler the tool is `unavailable`. `calls` records every run.
   */
  readonly tools = {
    calls: [] as { tool: string; args: string[] }[],
    handlers: new Map<
      string,
      (
        args: string[],
      ) =>
        | { stdout?: Uint8Array | string; stderr?: string }
        | Promise<{ stdout?: Uint8Array | string; stderr?: string }>
    >(),
    handle(
      tool: "ffmpeg" | "ffprobe",
      handler: (
        args: string[],
      ) =>
        | { stdout?: Uint8Array | string; stderr?: string }
        | Promise<{ stdout?: Uint8Array | string; stderr?: string }>,
    ) {
      this.handlers.set(tool, handler);
    },
  };
  /** Paths given to `system.reveal` / `system.openPath`, newest last. */
  readonly system = { revealed: [] as string[], opened: [] as string[] };
  /** Local processes, faked: see `tools` and `system`. */
  readonly local: LocalServices = {
    locate: async (tool) =>
      this.tools.handlers.has(tool) ? `/test-host/${tool}` : null,
    run: async (path, args, options) => {
      const tool = path.split("/").pop()!;
      const handler = this.tools.handlers.get(tool);
      if (!handler) throw new HostError("unavailable", `${tool} was not found`);
      this.tools.calls.push({ tool, args });
      if (options.signal.aborted) {
        const error = new HostError("aborted", "aborted");
        error.name = "AbortError";
        throw error;
      }
      const result = await handler(args);
      const stdout =
        typeof result.stdout === "string"
          ? new Uint8Array(Buffer.from(result.stdout))
          : (result.stdout ?? new Uint8Array());
      if (stdout.length > options.maxOutput)
        throw new HostError(
          "invalid",
          `output exceeds ${options.maxOutput} bytes`,
        );
      return { stdout, stderr: result.stderr ?? "" };
    },
    open: async (path, reveal) => {
      (reveal ? this.system.revealed : this.system.opened).push(path);
    },
  };
  /** Every `panel.showMenu`, newest last. */
  readonly menus: { items: (string | null)[]; x: number; y: number }[] = [];
  readonly processing = {
    configurationRevision: 0,
    backendUncertain: {} as Partial<Record<"video" | "audio", string>>,
    resources: new Map<
      string,
      { stage: string; revision: number; nodes: Json; offsetMs?: number }
    >(),
    book: new Map<
      string,
      {
        status: "completed" | "failed";
        result?: Json;
        error?: { code: string; message: string };
      }
    >(),
  };
  subtitles: SubtitleState;
  readonly uploads = new Map<number, { bytes: Buffer[]; expected: number }>();
  readonly snapshots = new Map<number, Json>();
  readonly jobs = new Map<number, MediaJob>();
  readonly producers = new Map<
    number,
    FakeProducer & {
      server: Server;
      path: string;
      epoch: number;
      pending: Json | null;
      acknowledged: boolean;
      active: boolean;
    }
  >();
  readonly resolvers = new Map<string, Json>();
  /** Answers for `dialogs.open`, consumed in order; `null` means cancelled. */
  readonly dialogAnswers: (string[] | null)[] = [];
  readonly #overrides = new Map<string, Handler>();
  readonly #listeners = new Map<string, Set<(data: unknown) => void>>();
  #inFlight = 0;
  #next = { snapshot: 0, job: 0, producer: 0, source: 0 };
  #sourceBook = new Map<number, Json>();
  readonly #scratch = mkdtempSync(join(tmpdir(), "vestra-test-host-"));
  /** `plugin.dataDirectory`: empty, removed with the host on `stop()`. */
  readonly dataDirectory = join(this.#scratch, "data");
  manifestId = "test.plugin";

  constructor() {
    this.subtitles = {
      presentation: {
        revision: 1,
        referenceHeight: 1080,
        layers: [],
        effective: null,
        confirmation: "applied",
        fonts: [
          {
            id: "sans",
            family: "Sans",
            resolution: "fixedFace",
            snapshotEligible: true,
            digest: "0",
            faceIndex: 0,
          },
        ],
        actualFont: {
          fontId: "sans",
          family: "Sans",
          postscript: "Sans",
          faceIndex: 0,
          digest: "0",
          sizeBytes: 0,
        },
        snapshotEligible: true,
        coverageCheckedOnCapture: true,
      },
      source: { generation: 0, phase: "empty" },
      confirmation: "applied",
      error: null,
      selection: { stamp: { generation: 0, revision: 0 }, target: null },
      tracks: [],
      resources: [],
    };
  }

  // ------------------------------------------------------------ transport

  async request<T>(method: string, params: Json = {}): Promise<T> {
    const record = (params ?? {}) as Record<string, Json>;
    this.calls.push({ method, params: record });
    this.#inFlight++;
    try {
      await tick();
      const handler = this.#overrides.get(method) ?? this.#defaults[method];
      if (!handler)
        throw new HostError("unsupported", `test host has no ${method}`);
      return (await handler(record)) as T;
    } finally {
      this.#inFlight--;
    }
  }
  on(event: string, listener: (data: unknown) => void) {
    const group = this.#listeners.get(event) ?? new Set();
    group.add(listener);
    this.#listeners.set(event, group);
    return () => {
      group.delete(listener);
    };
  }

  // ------------------------------------------------------------ test controls

  /** Replace one method's behaviour (throw a HostError to simulate a refusal). */
  handle(method: string, handler: Handler) {
    this.#overrides.set(method, handler);
  }
  /** Restore the default behaviour of a method. */
  reset(method: string) {
    this.#overrides.delete(method);
  }
  /** Deliver a host event (only if the plugin subscribed, like the real host). */
  emit(event: string, data: unknown) {
    if (
      ["source.state", "playback.backend", "window.state"].includes(event) &&
      !this.subscriptions.has(event)
    )
      return;
    for (const listener of [...(this.#listeners.get(event) ?? [])])
      listener(data);
  }
  /** Change source facts (e.g. `{ phase: "ready", duration: 60 }`) and broadcast them. */
  setSource(patch: Partial<SourceState>) {
    this.source = {
      ...this.source,
      ...patch,
      eventSequence: this.source.eventSequence + 1,
    };
    if (patch.phase && patch.phase !== "empty" && !patch.capabilities)
      this.source.capabilities = { ...readyCapabilities };
    this.subtitles.source = {
      generation: this.source.stamp.generation,
      phase: this.source.phase,
    };
    this.emit("source.state", this.source);
  }
  /** Simulate another plugin opening a source. */
  openElsewhere(source: string, phase: SourceState["phase"] = "ready") {
    this.#intent({ kind: "open", source, startPaused: false });
    this.setSource({ phase });
  }
  /**
   * Press a binding like the host's table would: panel-focus bindings first
   * when `panel` is true, then global ones; the earliest registration wins a
   * conflict. Resolves after the command ran; rejects when nothing is bound
   * or the command is disabled or busy.
   */
  async press(binding: string, options: { panel?: boolean } = {}) {
    const claims = this.#claims();
    const id =
      (options.panel ? claims.get(`panel ${binding}`)?.[0] : undefined) ??
      claims.get(`global ${binding}`)?.[0];
    if (!id) throw new Error(`test host: nothing is bound to ${binding}`);
    await this.command(id).run();
  }
  /** Bindings declared by more than one command: `[binding, winner, ...ignored]`. */
  get conflicts(): string[][] {
    return [...this.#claims()]
      .filter(([, ids]) => ids.length > 1)
      .map(([key, ids]) => [key.split(" ")[1]!, ...ids]);
  }
  #claims() {
    const claims = new Map<string, string[]>();
    for (const [id, { declaration }] of this.commands) {
      const scope = declaration.focus ? "panel" : "global";
      for (const binding of declaration.bindings) {
        const key = `${scope} ${binding}`;
        claims.set(key, [...(claims.get(key) ?? []), id]);
      }
    }
    return claims;
  }
  /** Simulate another plugin calling `player.next()` / `previous()`. */
  step(direction: "next" | "previous") {
    return this.request("sequence.step", { direction });
  }
  command(id: string): FakeCommand {
    const command = this.commands.get(id);
    if (!command) throw new Error(`command ${id} is not registered`);
    return command;
  }
  window(id: string): FakeWindow {
    const window = this.windows.get(id);
    if (!window) throw new Error(`window ${id} was never opened`);
    return window;
  }
  mounted() {
    if (!this.panel) throw new Error("no panel mounted");
    return this.panel;
  }
  /** Calls of one method, newest last. */
  sent(method: string) {
    return this.calls
      .filter((call) => call.method === method)
      .map((call) => call.params);
  }
  /** Wait until no request is in flight and timers due within `ms` have run. */
  async settle(ms = 0) {
    const deadline = Date.now() + ms;
    for (let idle = 0; idle < 3;) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 1));
      idle = this.#inFlight === 0 && Date.now() >= deadline ? idle + 1 : 0;
    }
  }
  close() {
    for (const producer of this.producers.values()) producer.server.close();
    rmSync(this.#scratch, { recursive: true, force: true });
  }

  // ------------------------------------------------------------ simulated host

  #intent(intent: Record<string, Json>): { ticket: Json } {
    const expected = intent.expected as SourceStamp | undefined;
    const stamp = this.source.stamp;
    if (
      expected &&
      (expected.generation !== stamp.generation ||
        expected.intentVersion !== stamp.intentVersion)
    )
      throw new HostError("stale", "stale");
    const next = {
      ...this.source,
      stamp: { ...stamp, intentVersion: stamp.intentVersion + 1 },
      eventSequence: this.source.eventSequence + 1,
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
    } else if (intent.kind === "close") {
      if (!this.source.source) throw new HostError("invalid", "noSource");
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
      if (!this.source.source) throw new HostError("invalid", "noSource");
      const control = intent.control as Record<string, Json>;
      if (control.kind === "pause") next.paused = control.paused === true;
      if (control.kind === "seek") next.position = Number(control.seconds);
      if (control.kind === "rate") next.rate = Number(control.rate);
    }
    this.source = next;
    this.subtitles.source = {
      generation: next.stamp.generation,
      phase: next.phase,
    };
    this.emit("source.state", this.source);
    return { ticket: { stamp: next.stamp, cycle: next.cycle, owner: 1 } };
  }

  #processingState() {
    const list = (stage: string) =>
      [...this.processing.resources]
        .filter(([, value]) => value.stage === stage)
        .map(([key, value]) => ({
          owner: 1,
          revision: value.revision,
          resource: {
            manifestId: this.manifestId,
            resourceId: key.split(":")[1]!,
            nodes: value.nodes,
          },
          ...(stage === "audio" ? { offsetMs: value.offsetMs ?? 0 } : {}),
        }));
    return {
      configurationRevision: this.processing.configurationRevision,
      audioOffsetMs: 0,
      source: {
        generation: this.source.stamp.generation,
        phase: this.source.phase,
        load: null,
        stages: {},
      },
      video: list("video"),
      audio: list("audio"),
      backendUncertain: this.processing.backendUncertain,
    };
  }

  /** Audio track calls need ready media and the source the caller saw. */
  #audioCondition(expected: Json | undefined) {
    const want = expected as SourceStamp | undefined;
    const stamp = this.source.stamp;
    if (
      want &&
      (want.generation !== stamp.generation ||
        want.intentVersion !== stamp.intentVersion)
    )
      throw new HostError("stale", "source changed");
    if (
      this.source.kind !== "media" ||
      !["ready", "ended"].includes(this.source.phase)
    )
      throw new HostError("unavailable", "audio tracks need ready media");
  }

  #subtitleChange(expected: Json) {
    const stamp = this.subtitles.selection.stamp;
    const want = expected as { generation: number; revision: number };
    if (
      want.generation !== stamp.generation ||
      want.revision !== stamp.revision
    )
      throw new HostError("stale", "subtitle selection changed");
    this.subtitles.selection.stamp = {
      generation: this.source.stamp.generation,
      revision: stamp.revision + 1,
    };
  }

  readonly #defaults: Record<string, Handler> = {
    "events.subscribe": (p) => void this.subscriptions.add(String(p.event)),
    "events.unsubscribe": (p) =>
      void this.subscriptions.delete(String(p.event)),
    "commands.register": (p) => {
      const id = String(p.id);
      if (this.commands.has(id))
        throw new HostError("command", "owner/localId already registered");
      const host = this;
      this.commands.set(id, {
        declaration: p.declaration as FakeCommand["declaration"],
        state: p.state as FakeCommand["state"],
        revision: Number(p.revision),
        async run() {
          if (this.state.busy || !this.state.enabled)
            throw new HostError(
              "command",
              `${id} is ${this.state.busy ? "busy" : "disabled"}`,
            );
          host.emit("commands.execute", { id, revision: this.revision });
          await host.settle();
        },
      });
      return { revision: 1 };
    },
    "commands.unregister": (p) => {
      if (!this.commands.delete(String(p.id)))
        throw new HostError("missing", `command ${p.id} is not registered`);
    },
    "commands.update": (p) => {
      const command = this.command(String(p.id));
      if (Number(p.revision) <= command.revision)
        throw new HostError("command", `stale command revision ${p.revision}`);
      command.revision = Number(p.revision);
      command.state = p.state as FakeCommand["state"];
      return { revision: command.revision };
    },
    "ui.open": (p) => {
      const id = String(p.id);
      if (this.windows.has(id))
        throw new HostError("conflict", "view already exists");
      const host = this;
      this.windows.set(id, {
        file: String(p.file),
        visible: true,
        props: { ...(p.properties as Record<string, Json>) },
        callbacks: p.callbacks as string[],
        emit(callback, ...args) {
          const name = kebab(callback);
          if (!this.callbacks.includes(name))
            throw new Error(`window ${id} did not register callback ${name}`);
          host.emit("ui.callback", { view: id, callback: name, args });
        },
      });
    },
    "ui.set": (p) => {
      const window = this.windows.get(String(p.id));
      if (!window) throw new HostError("missing", "view not found");
      window.props[String(p.property)] = p.value!;
    },
    "ui.show": (p) => {
      const window = this.windows.get(String(p.id));
      if (!window) throw new HostError("missing", "view not found");
      window.visible = p.visible === true;
    },
    "ui.close": (p) => {
      if (!this.windows.delete(String(p.id)))
        throw new HostError("missing", "view not found");
    },
    "ui.mount": (p) => {
      if (this.panel) throw new HostError("conflict", "owner already mounted");
      const host = this;
      this.panel = {
        slot: String(p.slot),
        file: String(p.file),
        component: String(p.component),
        visible: true,
        props: { ...(p.properties as Record<string, Json>) },
        locks: null,
        emit(callback, ...args) {
          host.emit("ui.callback", {
            view: "$mount",
            callback: kebab(callback),
            args,
          });
        },
      };
      const slot = String(p.slot) as "bottom" | "sidebar";
      this.layout[slot] = {
        owner: 1,
        preferred: true,
        effective: true,
        reason: null,
        detached: false,
      };
      return { status: "ready", prepareMs: 0, shellGeneration: 1 };
    },
    "ui.unmount": () => {
      if (this.panel)
        this.layout[this.panel.slot as "bottom" | "sidebar"] = null;
      this.panel = null;
    },
    "ui.menu": (p) => {
      if (!this.panel) throw new HostError("unavailable", "panel not shown");
      const items = p.items as (string | null)[];
      for (const id of items)
        if (id !== null && !this.commands.has(id))
          throw new HostError("missing", `command ${id} not registered`);
      this.menus.push({ items, x: Number(p.x), y: Number(p.y) });
    },
    "layout.state": () => this.layout,
    "layout.set": (p) => {
      const slot = String(p.slot) as "bottom" | "sidebar";
      const state = this.layout[slot];
      if (!state) throw new HostError("missing", "no panel at this position");
      if (p.detached !== undefined && slot === "bottom")
        throw new HostError("invalid", "the bottom bar cannot be detached");
      if (typeof p.visible === "boolean") {
        state.preferred = p.visible;
        state.effective = p.visible;
        state.reason = p.visible ? null : "userHidden";
        if (this.panel?.slot === slot) this.panel.visible = p.visible;
      }
      if (typeof p.detached === "boolean") state.detached = p.detached;
    },
    "osd.show": (p) => {
      const text = String(p.text);
      if (!text || [...text].length > 200)
        throw new HostError("invalid", "osd text needs 1..200 characters");
      this.osd.push(text);
    },
    "osd.panel": (p) =>
      void (this.osdPanel = p.text === null ? null : String(p.text)),
    "playback.stats": () => this.stats,
    "audio.addTrack": (p) => {
      this.#audioCondition(p.expected);
      const path = String(p.path);
      if (!path.startsWith("/") || path.includes("://"))
        throw new HostError(
          "invalid",
          "path must be an existing absolute file",
        );
      const tracks = this.source.audioTracks ?? [];
      const track = {
        trackId: Math.max(0, ...tracks.map((t) => t.trackId)) + 1,
        streamIndex: null,
        selected: p.select !== false,
        external: true,
        codec: null,
        title: path.split("/").pop() ?? null,
        language: null,
      };
      this.setSource({
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
      this.#audioCondition(p.expected);
      const tracks = this.source.audioTracks ?? [];
      if (!tracks.some((t) => t.trackId === p.id))
        throw new HostError("invalid", "no such audio track");
      this.setSource({
        audioTracks: tracks.map((t) => ({
          ...t,
          selected: t.trackId === p.id,
        })),
      });
    },
    "clipboard.readText": () => this.clipboard.text,
    "clipboard.writeText": (p) => {
      if (typeof p.text !== "string")
        throw new HostError("invalid", "text requires a string");
      if (Buffer.byteLength(p.text) > 1024 * 1024)
        throw new HostError("invalid", "text must be at most 1 MiB");
      this.clipboard.text = p.text;
    },
    "clipboard.writeImage": (p) => {
      const path = String(p.path);
      if (!path.startsWith("/"))
        throw new HostError("invalid", "image path must be absolute");
      if (!/\.(png|jpe?g)$/i.test(path))
        throw new HostError("invalid", "image must be PNG or JPEG");
      this.clipboard.images.push(path);
    },
    "power.preventSleep": (p) => {
      if (p.mode !== "off" && p.mode !== "playing")
        throw new HostError("invalid", 'mode must be "off" or "playing"');
      this.power = p.mode;
    },
    "sequence.set": (p) => {
      this.sequence = p.flags as TestHost["sequence"];
      this.setSource({
        sequence: {
          next: this.sequence?.canNext ?? false,
          previous: this.sequence?.canPrevious ?? false,
        },
      });
    },
    "sequence.step": (p) => {
      const direction = String(p.direction);
      const can =
        direction === "next"
          ? this.sequence?.canNext
          : this.sequence?.canPrevious;
      if (!can) throw new HostError("unavailable", `cannot go ${direction}`);
      this.emit("sequence.step", { direction });
    },
    "ui.setMount": (p) =>
      void (this.mounted().props[String(p.property)] = p.value!),
    "ui.interaction": (p) => void (this.mounted().locks = p),
    "dialogs.open": () => {
      const answer = this.dialogAnswers.shift();
      if (answer === undefined)
        throw new Error("test host: no dialog answer queued");
      return answer
        ? { cancelled: false, paths: answer }
        : { cancelled: true, paths: [] };
    },
    "source.state": () => this.source,
    "source.submit": (p) => {
      const intent = p.intent as Record<string, Json>;
      const result = { status: "completed", ...this.#intent(intent) };
      this.#sourceBook.set(Number(p.operationId), result);
      // Selecting a provider asks it to acknowledge a start control.
      const producer = this.producers.get(Number(intent.producerId));
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
    "source.operation": (p) => {
      const result = this.#sourceBook.get(Number(p.operationId));
      if (!result) throw new HostError("unknown-expired", "UnknownExpired");
      return result;
    },
    "playback.set": (p) => {
      if (p.property === "volume")
        this.source.output = { ...this.source.output, volume: Number(p.value) };
      if (p.property === "muted")
        this.source.output = { ...this.source.output, muted: p.value === true };
      this.source = {
        ...this.source,
        eventSequence: this.source.eventSequence + 1,
      };
    },
    "processing.state": () => this.#processingState(),
    "processing.replace": (p) => {
      const stage = String(p.stage);
      const key = `${stage}:${p.resourceId}`;
      const token = `${key}:${p.revision}`;
      const finish = (outcome: {
        status: "completed" | "failed";
        result?: Json;
        error?: { code: string; message: string };
      }) => {
        this.processing.book.set(token, outcome);
        if (outcome.error)
          throw new HostError(outcome.error.code, outcome.error.message);
        return outcome.result;
      };
      if (this.processing.backendUncertain[stage as "video"])
        return finish({
          status: "failed",
          error: {
            code: "backend-uncertain",
            message: this.processing.backendUncertain[stage as "video"]!,
          },
        });
      // The same node and delay rules as the player.
      const problem = nodeProblem(
        stage as "video" | "audio",
        (p.nodes ?? []) as { kind: string }[],
      );
      const offset = Number(p.offsetMs ?? 0);
      const delay =
        stage === "audio" &&
        (!Number.isInteger(offset) ||
          Math.abs(offset) > 10_000 ||
          offset % 10 !== 0)
          ? "audio offsetMs must be -10000..10000 in 10ms increments"
          : null;
      if (problem || delay)
        return finish({
          status: "failed",
          error: { code: "invalid", message: (problem ?? delay)! },
        });
      if (this.source.phase !== "ready")
        return finish({
          status: "failed",
          error: { code: "unavailable", message: "source must be ready" },
        });
      if (p.expectedGeneration !== this.source.stamp.generation)
        return finish({
          status: "failed",
          error: { code: "stale", message: "source generation changed" },
        });
      const old = this.processing.resources.get(key);
      if (old && Number(p.revision) <= old.revision)
        return finish({
          status: "failed",
          error: { code: "stale", message: "resource revision must increase" },
        });
      this.processing.resources.set(key, {
        stage,
        revision: Number(p.revision),
        nodes: p.nodes!,
        ...(stage === "audio" ? { offsetMs: Number(p.offsetMs ?? 0) } : {}),
      });
      this.processing.configurationRevision++;
      return finish({
        status: "completed",
        result: {
          stage,
          revision: p.revision!,
          generation: this.source.stamp.generation,
          status: "applied",
        },
      });
    },
    "processing.operation": (p) =>
      this.processing.book.get(`${p.stage}:${p.resourceId}:${p.revision}`) ?? {
        status: "unknown",
      },
    "subtitles.state": () => structuredClone(this.subtitles),
    "subtitles.select": (p) => {
      this.#subtitleChange(p.expected!);
      this.subtitles.selection.target =
        p.target as SubtitleState["selection"]["target"];
      return structuredClone(this.subtitles);
    },
    "subtitles.style": (p) => {
      this.#subtitleChange(p.expected!);
      this.subtitles.presentation.revision++;
      this.subtitles.presentation.effective = p.style
        ? {
            owner: 1,
            manifestId: this.manifestId,
            revision: Number(p.revision),
            style: p.style as never,
          }
        : null;
      return structuredClone(this.subtitles);
    },
    "subtitles.upload.begin": (p) => {
      if (p.generation !== this.source.stamp.generation)
        throw new HostError("stale", "source generation changed");
      this.uploads.set(Number(p.uploadId), {
        bytes: [],
        expected: Number(p.expectedBytes),
      });
      return {
        generation: p.generation!,
        expectedBytes: p.expectedBytes!,
        receivedBytes: 0,
        complete: false,
      };
    },
    "subtitles.upload.append": (p) => {
      const upload = this.uploads.get(Number(p.uploadId));
      if (!upload) throw new HostError("missing", "upload");
      upload.bytes.push(Buffer.from(String(p.base64), "base64"));
      return {};
    },
    "subtitles.upload.discard": (p) =>
      void this.uploads.delete(Number(p.uploadId)),
    "subtitles.commit": (p) => {
      const upload = this.uploads.get(Number(p.uploadId));
      if (!upload) throw new HostError("missing", "upload");
      const format = p.format === "ass" ? "ass" : "srt";
      const select = p.select === "none" ? "none" : "primary";
      const title = typeof p.title === "string" ? p.title : null;
      if (title !== null && ([...title].length < 1 || [...title].length > 200))
        throw new HostError(
          "invalid",
          "subtitle title needs 1..200 characters",
        );
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
      this.#subtitleChange(p.expected!);
      const target = {
        kind: "external" as const,
        owner: 1,
        resourceId: String(p.resourceId),
        contentRevision: 1,
      };
      this.subtitles.tracks.push({
        target,
        title: title ?? (format === "ass" ? "外部 ASS" : "外部 SRT"),
        language: null,
        styleSupported: true,
        styleReason: null,
        codec: format === "ass" ? "ass" : "webvtt",
        text: true,
        streamIndex: null,
      });
      if (select === "primary") this.subtitles.selection.target = target;
      this.subtitleLoads.push({ format, title, select, bytes });
      this.uploads.delete(Number(p.uploadId));
      return structuredClone(this.subtitles);
    },
    "subtitles.remove": (p) => {
      this.#subtitleChange(p.expected!);
      this.subtitles.tracks = this.subtitles.tracks.filter(
        (t) =>
          t.target.kind !== "external" || t.target.resourceId !== p.resourceId,
      );
      const selected = this.subtitles.selection.target;
      if (selected?.kind === "external" && selected.resourceId === p.resourceId)
        this.subtitles.selection.target = null;
      return structuredClone(this.subtitles);
    },
    "subtitles.operation": () => ({ status: "unknown" }),
    "snapshot.capture": (p) => {
      const expected = p.expected as SourceStamp;
      if (
        expected.generation !== this.source.stamp.generation ||
        expected.intentVersion !== this.source.stamp.intentVersion
      )
        throw new HostError("stale", "source changed");
      const snapshotId = ++this.#next.snapshot;
      const snapshot = {
        snapshotId,
        kind: p.mode === "processed" ? "processed" : "raw",
        sourceStamp: expected,
        time: Number(p.time ?? this.source.position ?? 0),
        source: this.source.source ?? "",
        duration: this.source.duration ?? 0,
        audio: null,
        ...(p.mode === "processed"
          ? {
              presentation: { width: 1920, height: 1080 },
              processing: { revision: this.processing.configurationRevision },
            }
          : {}),
      };
      this.snapshots.set(snapshotId, snapshot);
      return snapshot;
    },
    "snapshot.state": (p) => this.snapshots.get(Number(p.snapshotId)) ?? null,
    "snapshot.release": (p) => void this.snapshots.delete(Number(p.snapshotId)),
    "jobs.start": (p) => {
      if (!this.snapshots.has(Number(p.snapshotId)))
        throw new HostError("missing", "snapshot released");
      const jobId = ++this.#next.job;
      this.jobs.set(jobId, {
        jobId,
        status: "queued",
        publicationStarted: false,
        facts: null,
        outcome: null,
      });
      return { jobId, status: "queued", snapshotId: p.snapshotId! };
    },
    // Each read advances a job one step: queued → running → completed.
    "jobs.state": (p) => {
      const job = this.jobs.get(Number(p.jobId));
      if (!job) throw new HostError("missing", "job");
      const current = structuredClone(job);
      if (job.status === "queued") job.status = "running";
      else if (job.status === "running")
        Object.assign(job, {
          status: "completed",
          publicationStarted: true,
          outcome: { destination: "/tmp/output" },
        });
      else if (job.status === "cancelling")
        Object.assign(job, {
          status: "cancelled",
          outcome: { cancelled: true },
        });
      return current;
    },
    "jobs.cancel": (p) => {
      const job = this.jobs.get(Number(p.jobId));
      if (!job) throw new HostError("missing", "job");
      if (["completed", "failed", "cancelled"].includes(job.status))
        return { jobId: job.jobId, cancel: "terminal" };
      job.status = "cancelling";
      return { jobId: job.jobId, cancel: "requested" };
    },
    "jobs.operation": () => ({ status: "unknown" }),
    "sourceResolvers.register": (p) => void this.resolvers.set(String(p.id), p),
    "sourceResolvers.unregister": (p) =>
      void this.resolvers.delete(String(p.id)),
    "sourceResolvers.respond": () => null,
    "producer.prepare": () => {
      const id = ++this.#next.producer;
      const path = join(this.#scratch, `producer-${id}.sock`);
      const producer = {
        id,
        receivedFrames: 0,
        videoFrames: 0,
        released: false,
        path,
        epoch: 1,
        pending: null as Json | null,
        acknowledged: true,
        active: false,
        server: createServer(),
      };
      producer.server.on("connection", (socket) => {
        let buffer: Buffer = Buffer.alloc(0);
        socket.on("data", (data: Buffer) => {
          buffer = Buffer.concat([buffer, data]);
          while (buffer.length >= 32) {
            const length = buffer.readUInt32LE(24);
            if (buffer.length < 32 + length) break;
            if (buffer[4] === 1) producer.receivedFrames += length / 8;
            else producer.videoFrames++;
            buffer = buffer.subarray(32 + length);
          }
        });
        socket.on("error", () => {});
      });
      producer.server.listen(path);
      this.producers.set(id, producer);
      return {
        producerId: id,
        socket: path,
        epoch: 1,
        sampleRate: 48000,
        channels: 2,
        sampleFormat: "f32le",
        videoFormat: "rgba8",
        maxAudioFrames: 4800,
        audioCapacityFrames: 9600,
        videoCapacity: 8,
      };
    },
    "producer.state": (p) => {
      const producer = this.producers.get(Number(p.producerId));
      if (!producer) throw new HostError("missing", "producer");
      const current =
        this.source.kind === "producer" &&
        this.source.source === `producer://${producer.id}`;
      return {
        input: null,
        pendingControl: producer.pending,
        producerId: producer.id,
        epoch: producer.epoch,
        acknowledged: producer.acknowledged,
        paused: this.source.paused,
        // The fake device consumes everything immediately.
        consumedFrames: producer.receivedFrames,
        underrunFrames: 0,
        deviceErrors: 0,
        health: "ok",
        xrunEvents: 0,
        deviceChangeEvents: 0,
        errorDetails: [],
        errorOverflow: 0,
        buffer: {},
        receivedFrames: producer.receivedFrames,
        hasVideo: producer.videoFrames > 0,
        error: null,
        active: producer.active && current,
      };
    },
    "producer.ack": (p) => {
      const control = (p.control ?? {}) as Record<string, Json>;
      const producer = this.producers.get(Number(control.producerId));
      if (!producer) throw new HostError("missing", "producer");
      producer.pending = null;
      producer.acknowledged = true;
      producer.epoch = Number(control.epoch);
      producer.active = true;
      return { status: "acknowledged", control };
    },
    "producer.ackInput": () => ({ status: "acknowledged", sequence: 0 }),
    "producer.release": (p) => {
      const producer = this.producers.get(Number(p.producerId));
      if (!producer) return;
      producer.released = true;
      producer.server.close();
    },
  };
}

/** Start a plugin's default-exported `activate` against a fresh test host. */
export async function startPlugin(
  activate: (plugin: Plugin) => unknown,
  options: {
    directory?: string | URL;
    id?: string;
    capabilities?: string[];
    host?: TestHost;
    /** Use an existing directory as `plugin.dataDirectory` (to test a restart). */
    dataDirectory?: string;
  } = {},
) {
  const host = options.host ?? new TestHost();
  const directory =
    options.directory instanceof URL
      ? fileURLToPath(options.directory)
      : (options.directory ?? process.cwd());
  let manifest = {
    id: options.id ?? "test.plugin",
    capabilities: options.capabilities ?? [],
  };
  if (options.directory && !options.capabilities) {
    const read = JSON.parse(
      readFileSync(join(directory, "manifest.json"), "utf8"),
    );
    manifest = { id: read.id, capabilities: read.capabilities };
  }
  host.manifestId = manifest.id;
  const data = options.dataDirectory ?? host.dataDirectory;
  mkdirSync(data, { recursive: true });
  const instance = await createPlugin(host, manifest, directory, data);
  await activate(instance.plugin);
  await instance.activated();
  await host.settle();
  return {
    host,
    plugin: instance.plugin,
    async stop() {
      await instance.dispose();
      await host.settle();
      host.close();
    },
  };
}
