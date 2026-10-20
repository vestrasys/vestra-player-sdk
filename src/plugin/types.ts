/**
 * SDK v2 public types. A plugin module default-exports
 * `async function activate(plugin: Plugin)`; everything it creates is a
 * handle owned by `plugin` (or a sub-scope) and is released automatically.
 *
 * Plugins import these names as types only. The runner supplies the object,
 * so a production package has no runtime dependency on this repository.
 */
import type { Json } from "../wire.ts";
import type { AudioNode, VideoNode } from "../processing.ts";
import type { SubtitleStyle } from "../subtitles.ts";
import type { ResolvedMedia } from "../source-resolvers.ts";
import type { MediaJob } from "../media.ts";

export type { Json, AudioNode, VideoNode, SubtitleStyle, ResolvedMedia };

/** Anything that owns host or local resources. Disposing twice is harmless. */
export interface Disposable {
  dispose(): Promise<void>;
}

/** Failures reject with an ordinary Error carrying a stable `code`. */
export type PluginError = Error & { code: string };

/**
 * A group of handles released together. `Plugin` is the root scope; create a
 * child with `scope()` for a feature that can be torn down on its own.
 */
export interface Scope extends Disposable {
  readonly commands: Commands;
  readonly windows: Windows;
  readonly panels: Panels;
  readonly dialogs: Dialogs;
  readonly player: Player;
  readonly video: { filter(id: string): VideoFilter };
  readonly audio: { filter(id: string): AudioFilter };
  readonly subtitles: Subtitles;
  readonly media: MediaCapture;
  readonly resolvers: Resolvers;
  readonly packages: Packages;
  readonly osd: Osd;
  readonly host: Host;
  readonly clipboard: Clipboard;
  readonly power: Power;
  /** ffmpeg / ffprobe, run by this plugin's process. */
  readonly tools: Tools;
  /** JSON settings files in `dataDirectory`. */
  readonly storage: Storage;
  /** Show or open files with the Finder. */
  readonly system: System;
  /** A child scope; disposing it releases only what was created through it. */
  scope(): Scope;
  /** Adopt an existing handle or a cleanup function. */
  add<T extends Disposable>(item: T): T;
  onDispose(cleanup: () => void | Promise<void>): Disposable;
  /**
   * Errors thrown by handlers that the SDK invoked (command `run`, window and
   * panel callbacks, `onChange` listeners) in this scope. Without a listener
   * they go to the parent scope, and finally to the plugin log.
   */
  onError(listener: (error: PluginError) => void): Disposable;
  /**
   * Re-evaluate every bound value (`bind()` functions and command state
   * functions) and send what changed. The SDK already does this after each
   * handler it invokes and when that handler's promise settles; call it after
   * changing state from your own timers or between awaits of a long task.
   */
  update(): void;
}

export interface Plugin extends Scope {
  /** The manifest id. */
  readonly id: string;
  /**
   * A writable directory for this plugin's own files (settings, remembered
   * folders). Kept across restarts, disabling and upgrades; a trial gets a
   * temporary one. Write files atomically: to a temporary name, then rename.
   * Throws `unavailable` when the player provided none.
   */
  readonly dataDirectory: string;
}

// ---------------------------------------------------------------- commands

export interface CommandState {
  enabled: boolean;
  /** `null` means the menu item has no check mark. */
  checked: boolean | null;
  busy: boolean;
  /** Shown when the command is disabled or busy. */
  reason: string | null;
}

/** A value, or a function the SDK re-evaluates on every update pass. */
export type Bindable<T> = T | (() => T);

export interface CommandOptions {
  /** Local id, unique within the plugin. */
  id: string;
  /**
   * Menu path including the leaf, 1–8 segments, e.g. `["视频", "画面调节…"]`;
   * one segment is a top-level item. Omit it for a command that is not in the
   * main menu (bindings and panel menus only); `title` is then required.
   */
  path?: string[];
  /** Menu label; defaults to the last path segment. */
  title?: string;
  /**
   * Sibling order in the menu, ascending (integer, default 0). A submenu sits
   * where its first command sits. Equal orders: plugin id, then declaration order.
   */
  order?: number;
  /** Separator label: a line is drawn between adjacent items of different groups. Default `"domain"`. */
  group?: string;
  /** Draw `checked` as a radio dot instead of a check mark. */
  radio?: boolean;
  /**
   * Default input bindings, e.g. `["Space"]`, `["Ctrl+O", "F3"]`, `["Mouse:WheelUp"]`.
   * Syntax and conflict rules: API reference §4.
   */
  bindings?: string[];
  /** `"panel"`: the bindings apply only while this plugin's panel has focus. */
  focus?: "panel";
  /** Fire again on keyboard auto-repeat while the key is held. Default false. */
  repeat?: boolean;
  enabled?: Bindable<boolean>;
  checked?: Bindable<boolean | null>;
  busy?: Bindable<boolean>;
  reason?: Bindable<string | null>;
  run(): unknown;
}

export interface Command extends Disposable {
  readonly id: string;
  /** Replace some state fields (values or functions). Last write wins. */
  set(
    state: Partial<{ [K in keyof CommandState]: Bindable<CommandState[K]> }>,
  ): void;
  /** Resolves when the host has registered the command. */
  readonly ready: Promise<void>;
}

export interface Commands {
  /**
   * Declare a command. It is registered and kept in sync; `dispose()` removes
   * it from the menu and the binding table, and the id may be added again.
   */
  add(options: CommandOptions): Command;
}

// ---------------------------------------------------------------- windows and panels

/** Property map using camelCase names; the SDK converts to Slint kebab-case. */
export type Props = Record<string, Json>;

/** Shared by tool windows and docked panels. */
export interface View {
  /**
   * Handle a Slint callback (`toggle-effect` may be written `toggleEffect`).
   * Window handlers must be bound before the first `show()`.
   */
  on<A extends Json[]>(
    callback: string,
    handler: (...args: A) => unknown,
  ): Disposable;
  /**
   * Write properties now; each written value is sent once even if unchanged,
   * so this also pulls a control the user moved back to the model value.
   */
  set(props: Props): void;
  /**
   * Keep properties equal to `props()`; re-evaluated on every update pass and
   * sent only when the value changes, so user edits of in-out properties stay.
   */
  bind(props: () => Props): Disposable;
}

export interface Window extends View, Disposable {
  /** Open the window (first call) or bring it back. Concurrent calls share one open. */
  show(): Promise<void>;
  hide(): Promise<void>;
  /** Close it; a later `show()` opens a fresh instance with the current properties. */
  close(): Promise<void>;
  readonly opened: boolean;
}

export interface Windows {
  /** A tool window from a `.slint` file in the package. Nothing opens until `show()`. */
  create(file: string, options?: { id?: string }): Window;
}

/** The state of the bottom bar or sidebar position, whoever mounted it. */
export interface SlotState {
  /** The user's choice (menu check mark). */
  preferred: boolean;
  /** Whether it is on screen right now (docked, or in its floating window). */
  effective: boolean;
  reason: "userHidden" | "space" | "fullscreen" | "idle" | null;
  /** The sidebar is a floating window; always false for the bottom bar. */
  detached: boolean;
}

export interface PanelSlot {
  /** `null` while no plugin has a panel there. */
  readonly state: SlotState | null;
  onChange(listener: (state: SlotState | null) => void): Disposable;
  /** Set the user's preference. Rejects with `missing` when the position is empty. */
  setVisible(visible: boolean): Promise<void>;
  /** Flip the user's preference using the host's current value. */
  toggle(): Promise<void>;
}

export interface SidebarSlot extends PanelSlot {
  /** Float the sidebar panel in its own window, or attach it back. */
  setDetached(detached: boolean): Promise<void>;
}

export interface Panel extends View, Disposable {
  /** Resolves once the host has mounted the panel. */
  readonly ready: Promise<void>;
  /** Keep the panel from auto-hiding while the user works in it. Merged, last write wins. */
  setInteraction(
    locks: Partial<{ focused: boolean; dragging: boolean; popupOpen: boolean }>,
  ): void;
  /**
   * Pop up a one-level menu of this plugin's commands (`null` = separator) in
   * the window that shows the panel, styled like the main menu. `at` is in
   * window coordinates: in Slint, `self.absolute-position` plus the pointer.
   */
  showMenu(
    items: (Command | null)[],
    at: { x: number; y: number },
  ): Promise<void>;
}

export interface Panels {
  /**
   * Dock a Slint component in the bottom bar or the sidebar. The component and
   * its bridge global are found from the file's `export component` and
   * `export global`; pass them only if the file exports several. `title` names
   * the floating window when the sidebar is detached.
   */
  mount(
    slot: "bottom" | "sidebar",
    file: string,
    options?: { component?: string; global?: string; title?: string },
  ): Panel;
  /** The bottom bar position; any plugin may read and toggle it. */
  readonly bottom: PanelSlot;
  /** The sidebar position, including its floating state. */
  readonly sidebar: SidebarSlot;
}

export interface Dialogs {
  /** `null` when cancelled. */
  openFile(options?: { title?: string }): Promise<string | null>;
  /** Empty when cancelled. */
  openFiles(options?: { title?: string }): Promise<string[]>;
  openDirectory(options?: { title?: string }): Promise<string | null>;
  saveFile(options?: {
    title?: string;
    fileName?: string;
  }): Promise<string | null>;
}

// ---------------------------------------------------------------- player

export interface AudioTrack {
  id: number;
  selected: boolean;
  /** True for an external track; such tracks cannot be exported. */
  external: boolean;
  /** False when the track is not inside the source container. */
  exportable: boolean;
  codec: string | null;
  title: string | null;
  language: string | null;
}

/** An immutable view of the player. Keep one to make a later call conditional on it. */
export interface PlayerState {
  /** Changes every time a source is opened, even the same file again. */
  readonly sourceId: number;
  readonly kind: "media" | "stream";
  readonly phase: "empty" | "loading" | "ready" | "ended" | "error";
  /** Path or URL. */
  readonly source: string | null;
  readonly paused: boolean;
  readonly position: number | null;
  readonly duration: number | null;
  readonly rate: number;
  readonly volume: number;
  readonly muted: boolean;
  /** Why the last playthrough stopped. */
  readonly endReason: "natural" | "stopped" | "replaced" | "unknown" | null;
  /** Load failure text when `phase` is `error`. */
  readonly error: string | null;
  readonly can: {
    pause: boolean;
    seek: boolean;
    rate: boolean;
    restart: boolean;
    close: boolean;
    snapshot: boolean;
    /** A sequence provider exists and can go forward / back (`player.next()`). */
    next: boolean;
    previous: boolean;
  };
  readonly audioTracks: AudioTrack[] | null;
}

/**
 * Controls act on the state you are looking at: by default `player.state`.
 * If another plugin or the user changed the source in between, the call fails
 * with code `stale` and nothing happens. Pass `ifCurrent` to bind the call to
 * an older snapshot instead (for example the state when a drag started).
 */
export interface Conditional {
  ifCurrent?: PlayerState;
}

/** A source this plugin opened. */
export interface Media {
  /** Still the player's source (a restart keeps it current). */
  readonly current: boolean;
  /**
   * Resolves when it is playing. Rejects with code `failed` (load error),
   * `replaced` (another source took over) or `ended`; with `AbortError` when
   * the signal aborts, after closing the media.
   */
  ready(options?: { signal?: AbortSignal }): Promise<void>;
  /** Called once each time a playthrough of this media ends naturally. */
  onEnd(listener: (state: PlayerState) => void): Disposable;
  /** Close it if it is still the player's source; otherwise do nothing. */
  close(): Promise<void>;
}

/** A drag gesture: each seek is conditional on the previous one, latest value wins. */
export interface Scrub {
  /**
   * Resolves `true` when this exact target was applied, `false` when a newer
   * target superseded it or the gesture ended. Rejects on a host failure.
   */
  seek(seconds: number): Promise<boolean>;
  /** False once anyone else changed the source; later seeks are ignored. */
  readonly active: boolean;
  end(): void;
}

/** Frames a stream supplies on demand: RGBA pixels and 48 kHz stereo f32 PCM. */
export interface StreamFrame {
  video: Uint8Array;
  audio: Float32Array;
}

export interface StreamOptions {
  width: number;
  height: number;
  /** Produce the next frame. Never called concurrently or while paused. */
  frame(): StreamFrame;
  signal?: AbortSignal;
}

/**
 * `openStream` start-up timeouts: code `timeout` with the step that ran out
 * of time, the first buffers (`prefill`) or the host's activation.
 */
export type StreamStartError = PluginError & {
  stage: "prefill" | "activation";
};

export interface Stream extends Disposable {
  readonly running: boolean;
  /** `error` is null when another source replaced the stream or it was closed. */
  onStop(listener: (error: PluginError | null) => void): Disposable;
  /** Stop producing and close the stream if it is still the player's source. */
  stop(): Promise<void>;
}

/** The plugin that owns "next / previous" (a playlist). */
export interface SequenceProvider {
  next(): unknown;
  previous(): unknown;
  canNext: Bindable<boolean>;
  canPrevious: Bindable<boolean>;
}

export interface PlaybackStats {
  /** For example "libmpv · 软件渲染". */
  backend: string;
  session: number;
  /** Frames the host has shown. */
  framesShown: number;
  framesDropped: number | null;
  /** Every field is the backend's own value, `null` when it has none. */
  video: {
    codec: string | null;
    width: number | null;
    height: number | null;
    fps: number | null;
    /** Short decoder name, e.g. "h264". */
    decoder: string | null;
    /** e.g. "yuv420p". */
    pixelFormat: string | null;
    /** Colour matrix, e.g. "bt.709". */
    colorspace: string | null;
    /** Size after aspect correction and filters. */
    displayWidth: number | null;
    displayHeight: number | null;
    /** Measured display refresh; only with display-synced output (usually null). */
    displayFps: number | null;
    /** Bits per second, updated per keyframe. */
    bitrate: number | null;
  } | null;
  audio: {
    codec: string | null;
    sampleRate: number | null;
    channels: number | null;
    decoder: string | null;
    /** Sample format, e.g. "floatp". */
    format: string | null;
    /** Readable layout, e.g. "stereo", "5.1(side)". */
    channelLayout: string | null;
    bitrate: number | null;
  } | null;
  /** Last audio/video difference in milliseconds (signed). */
  avSyncMs: number | null;
  /** Seconds of media buffered ahead by the demuxer. */
  cacheSeconds: number | null;
}

export interface Player {
  /** Latest state; always newer than anything delivered before. */
  readonly state: PlayerState;
  onChange(listener: (state: PlayerState) => void): Disposable;
  refresh(): Promise<PlayerState>;
  /** True if nothing changed the source since `state` was observed. */
  isCurrent(state: PlayerState): boolean;
  /**
   * Open a path or URL, replacing the current source (unless `ifCurrent` no
   * longer holds). Resolves when the host accepted the load.
   */
  open(
    source: string,
    options?: { paused?: boolean; signal?: AbortSignal } & Conditional,
  ): Promise<Media>;
  /** Start a source whose frames this plugin generates (`producer.av`). */
  openStream(options: StreamOptions): Promise<Stream>;
  setPaused(paused: boolean, options?: Conditional): Promise<void>;
  seek(seconds: number, options?: Conditional): Promise<void>;
  setRate(rate: number, options?: Conditional): Promise<void>;
  restart(options?: Conditional): Promise<void>;
  close(options?: Conditional): Promise<void>;
  /** Start a drag gesture from the current state. */
  scrub(): Scrub;
  /**
   * Device output; last write wins and volume is applied before mute.
   * Resolves `true` when this request was applied, `false` if superseded.
   */
  setOutput(output: { volume?: number; muted?: boolean }): Promise<boolean>;
  /**
   * Become the sequence provider (one at a time; another provider rejects with
   * `conflict` through the scope's `onError`, or fails activation). Dispose to stop.
   */
  provideSequence(provider: SequenceProvider): Disposable;
  /** Ask the provider to go forward / back. Rejects `unavailable` when it cannot. */
  next(): Promise<void>;
  previous(): Promise<void>;
  /** Codec, size, frame counts and backend of the current playback. */
  stats(): Promise<PlaybackStats>;
  /**
   * Add an external audio file (absolute local path) to the current media and,
   * unless `select: false`, select it. Resolves with the new track (`external`,
   * not exportable). It stays until the source changes. Rejects `invalid` for a
   * bad path, `unavailable` without ready media, `backend` when it cannot load.
   */
  addAudioTrack(
    path: string,
    options?: { select?: boolean } & Conditional,
  ): Promise<AudioTrack>;
  /** Select one of `state.audioTracks` by id; `invalid` for an unknown id. */
  selectAudioTrack(id: number, options?: Conditional): Promise<PlayerState>;
  /**
   * One frame or to the next / previous keyframe (pauses for frames). Rejects
   * `unsupported` without moving video (audio only, cover art, a generated
   * stream) or when backwards needs a seekable source.
   */
  step(
    unit: "frame" | "keyframe",
    direction: "backward" | "forward",
    options?: Conditional,
  ): Promise<void>;
  /**
   * The core's first-tier relative seek (`seek-backward` / `seek-forward`,
   * ← / →): 0.1–3600 seconds in tenths, default 5. The newest call of any
   * plugin wins; it reverts when that plugin stops.
   */
  setStepSeek(options: { seconds: number }): Promise<void>;
}

/** The core's basic playback actions (menu commands owned by the player). */
export type HostAction =
  | "play-pause"
  | "stop"
  | "previous"
  | "next"
  | "frame-back"
  | "frame-forward"
  | "seek-backward"
  | "seek-forward"
  | "rate-down"
  | "rate-up"
  | "rate-normal"
  | "volume-up"
  | "volume-down"
  | "mute";

export interface Host {
  /**
   * Run a core action exactly like its menu item or key: same checks, same
   * on-screen text. Resolves when it finished (or was dropped because the
   * same action is still running). Rejects `unavailable` when disabled,
   * `invalid` for an unknown id. Needs `commands`.
   */
  run(action: HostAction): Promise<void>;
}

// ---------------------------------------------------------------- on-screen display

/** A read-only text block over the top-left of the video. */
export interface OsdPanel extends Disposable {
  /** Multi-line text; `null` hides it. Last write wins. */
  set(text: string | null): void;
}

export interface Osd {
  /** One line at the top-left of the video for 2 seconds; replaces the previous one. */
  show(text: string): Promise<void>;
  /** This plugin's information block (one per plugin). */
  panel(): OsdPanel;
}

// ---------------------------------------------------------------- video and audio filters

export type FilterStatus =
  /** No ready media; the value is kept and applied when media is ready. */
  | { state: "waiting" }
  | { state: "applying" }
  /** The backend accepted it (not a visible-frame guarantee). */
  | { state: "applied" }
  /** Not applied. `retry()` or the next `set()` tries again. */
  | { state: "failed"; error: PluginError };

interface Filter<T> extends Disposable {
  /** Desired chain; last write wins. An empty chain removes this plugin's effect. */
  set(value: T): void;
  readonly status: FilterStatus;
  onStatus(listener: (status: FilterStatus) => void): Disposable;
  /** Re-check the host and apply the current value again. */
  retry(): void;
}

/** This plugin's own video processing chain, re-applied for every new source. */
export type VideoFilter = Filter<VideoNode[]>;
/** This plugin's own audio chain plus its audio delay in 10 ms steps. */
export type AudioFilter = Filter<{ nodes: AudioNode[]; delayMs?: number }>;

// ---------------------------------------------------------------- subtitles

export interface SubtitleTrack {
  /** Stable while the track exists; compare tracks by id. */
  id: string;
  kind: "embedded" | "external";
  /** The container's subtitle track number, for embedded tracks only. */
  embeddedId?: number;
  title: string;
  language: string | null;
  styleSupported: boolean;
  styleReason: string | null;
  /** Loaded by this plugin, so `remove()` may delete it. */
  owned: boolean;
  /** The backend's codec name, e.g. "subrip", "ass", "hdmv_pgs_subtitle". */
  codec: string | null;
  /** Text cues (subrip, ass, ssa, webvtt, mov_text, text), not bitmaps. */
  text: boolean;
  /**
   * The container stream number (`ffmpeg -map 0:<n>`) of an embedded track,
   * when the player can vouch for it; `null` for external tracks and network sources.
   */
  streamIndex: number | null;
}

export interface SubtitlesState {
  readonly sourceId: number;
  readonly phase: string;
  readonly tracks: SubtitleTrack[];
  readonly selected: SubtitleTrack | null;
  readonly fonts: { id: string; family: string }[];
  /** The effective style, from whichever plugin set it last. */
  readonly style: SubtitleStyle | null;
  readonly trackConfirmation: "waiting" | "applied" | "uncertain";
  readonly styleConfirmation: "waiting" | "applied" | "uncertain";
  readonly error: string | null;
}

/** Subtitle calls act on the selection you see; pass `ifCurrent` to pin an older one. */
export interface SubtitleConditional {
  ifCurrent?: SubtitlesState;
}

export interface Subtitles {
  /** `null` until first read. */
  readonly state: SubtitlesState | null;
  onChange(listener: (state: SubtitlesState) => void): Disposable;
  refresh(): Promise<SubtitlesState>;
  select(
    track: SubtitleTrack | null,
    options?: SubtitleConditional,
  ): Promise<SubtitlesState>;
  /**
   * Upload a subtitle file's bytes (UTF-8 SRT, or ASS/SSA with
   * `format: "ass"`) for the current source; select it unless
   * `select: "none"`. `title` (1–200 characters) names the track. Aborting
   * `signal` before the commit discards the upload (rejects with AbortError);
   * once the commit was sent it completes.
   */
  load(
    bytes: Uint8Array,
    options?: SubtitleConditional & {
      format?: "srt" | "ass";
      title?: string;
      select?: "primary" | "none";
      signal?: AbortSignal;
    },
  ): Promise<SubtitleTrack>;
  /** Remove a track this plugin loaded. */
  remove(
    track: SubtitleTrack,
    options?: SubtitleConditional,
  ): Promise<SubtitlesState>;
  /** This plugin's style layer; `null` removes it. Last write wins. */
  setStyle(
    style: SubtitleStyle | null,
    options?: SubtitleConditional,
  ): Promise<SubtitlesState>;
}

// ---------------------------------------------------------------- capture and export

export interface CaptureOptions extends Conditional {
  /** Source time; defaults to the current position at the moment of capture. */
  at?: number;
  /** Include this plugin set's effects (and subtitles unless `subtitles: false`). */
  processed?: boolean;
  subtitles?: boolean;
  /** Audio to freeze with the snapshot: the selected track, none, or a track id. */
  audio?: "selected" | "none" | number;
}

/** A frozen, immutable input for exports. Dispose to release it. */
export interface Snapshot extends Disposable {
  readonly kind: "raw" | "processed";
  readonly time: number;
  readonly source: string;
  readonly duration: number;
  readonly audioTrack: number | null;
  /** Processed snapshots: output size and the frozen processing revision. */
  readonly presentation: { width: number; height: number } | null;
  readonly processingRevision: number | null;
  /** Start exporting; the job runs in the host's offline worker. */
  export(
    options:
      | { format: "png"; destination: string; sampleTime?: number }
      | { format: "mp4"; destination: string; end: number },
  ): Promise<ExportJob>;
}

export type JobState = Omit<MediaJob, "jobId">;

export interface ExportJob extends Disposable {
  readonly state: JobState;
  onChange(listener: (state: JobState) => void): Disposable;
  /** Resolves with the terminal state (completed, failed or cancelled). */
  readonly done: Promise<JobState>;
  cancel(): Promise<"requested" | "tooLate" | "terminal">;
  refresh(): Promise<JobState>;
}

export interface MediaCapture {
  capture(options?: CaptureOptions): Promise<Snapshot>;
}

// ---------------------------------------------------------------- source resolvers

export interface ResolverOptions {
  id: string;
  schemes: ("http" | "https")[];
  /** Exact host names. */
  hosts: string[];
  /** Turn a page URL into playable stream URLs. */
  resolve(url: string, signal: AbortSignal): Promise<ResolvedMedia>;
}

export interface Resolver extends Disposable {
  readonly ready: Promise<void>;
}

export interface Resolvers {
  add(options: ResolverOptions): Resolver;
}

// ---------------------------------------------------------------- packages (plugins.manage)

export interface PackageManifest {
  id: string;
  version: string;
  apiVersion: string;
  entry: string;
  capabilities: string[];
}

export interface PackageCandidate {
  readonly directory: string;
  readonly digest: string;
  readonly manifest: PackageManifest;
  readonly checks: string[];
  /** Load it temporarily alongside the installed plugins. */
  trial(): Promise<PackageTrial>;
  /** Install it, replacing the installed version of the same id. */
  install(): Promise<PackageChange>;
}

export interface PackageTrial extends Disposable {
  readonly status: string;
  /**
   * Stop and wait until the host confirmed cleanup. Rejects with code
   * `cleanup` when the host stopped the trial without confirming cleanup;
   * calling `stop()` again then asks the host again.
   */
  stop(): Promise<void>;
}

export type PackageChangeStatus =
  | "preparing"
  | "activating"
  | "restoring"
  | "committed"
  | "cancelled"
  | "failed"
  | "failedDegraded"
  | "tooLate";

export interface PackageChange {
  readonly status: PackageChangeStatus;
  readonly message: string | null;
  onChange(listener: (status: PackageChangeStatus) => void): Disposable;
  readonly done: Promise<PackageChangeStatus>;
  cancel(): Promise<void>;
}

export interface Packages {
  validate(directory: string): Promise<PackageCandidate>;
  rollback(id: string): Promise<PackageChange>;
}

// ---------------------------------------------------------------- shared services

/** The system clipboard (`clipboard`). Unavailable without a user interface. */
export interface Clipboard {
  /** Plain text on the clipboard; `null` when it holds none. */
  readText(): Promise<string | null>;
  /** Replace the clipboard with text (at most 1 MiB of UTF-8). */
  writeText(text: string): Promise<void>;
  /** Replace the clipboard with a PNG or JPEG file (absolute path, at most 16 MB). */
  writeImage(path: string): Promise<void>;
}

/** Keeping the computer awake (`playback.control`). */
export interface Power {
  /**
   * `"playing"`: while a source is ready and not paused, keep the display
   * (video) or the system (audio only) from sleeping. Any plugin asking is
   * enough; a stopped plugin's request is withdrawn.
   */
  preventSleep(mode: "off" | "playing"): Promise<void>;
}

export interface ToolResult {
  stdout: Uint8Array;
  stderr: string;
}

export interface Tools {
  /**
   * Run ffmpeg or ffprobe (found through `VESTRA_FFMPEG` / `VESTRA_FFPROBE`,
   * then `PATH`) without a shell. Rejects `unavailable` (not found), `timeout`,
   * `failed` (non-zero exit; `message` is the last stderr line), `invalid`
   * (output over `maxOutput`, default 16 MiB), `aborted` (`signal`). Timeout,
   * `signal` and disposing the scope end the process.
   */
  run(
    tool: "ffmpeg" | "ffprobe",
    args: string[],
    options: { timeoutMs: number; maxOutput?: number; signal?: AbortSignal },
  ): Promise<ToolResult>;
  available(tool: "ffmpeg" | "ffprobe"): Promise<boolean>;
}

/** A JSON file `dataDirectory/<name>.json`, loaded once and saved debounced. */
export interface JsonStore<T> extends Disposable {
  /** The loaded value, or `defaults` when the file was missing or broken. */
  readonly value: T;
  /** Replace the value now and write it after `debounceMs`. */
  save(next: T): void;
  /** Write a pending save now. */
  flush(): Promise<void>;
}

export interface Storage {
  /**
   * Open `<name>.json` (`name`: 1–64 of `a-z 0-9 -`). A file that cannot be
   * parsed or fails `validate` is renamed `<name>.json.bad-<timestamp>` and
   * `defaults` is used. Writes go to a temporary file, then a rename. Disposal
   * (and stopping the plugin) flushes first.
   */
  json<T>(
    name: string,
    options: {
      defaults: T;
      validate?: (value: unknown) => value is T;
      debounceMs?: number;
    },
  ): JsonStore<T>;
}

export interface System {
  /**
   * Select files or folders in the Finder (one `open -R` for all, so several
   * files of one folder are all highlighted). Paths that do not exist are
   * skipped; `missing` when none exists; at most 256.
   */
  reveal(paths: string | string[]): Promise<void>;
  /** Open the file or folder with its default application. `missing` if absent. */
  openPath(path: string): Promise<void>;
  /**
   * Open an http(s) address in the default browser. `invalid` for another
   * protocol or a malformed address; `timeout` after 10 s, `failed` otherwise.
   */
  openUrl(url: string): Promise<void>;
}
