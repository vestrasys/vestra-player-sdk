/**
 * The mpv pass-through's rules, as data: what `plugin.mpv` may not send, by
 * category, and its limits. The player applies the same table (its
 * agreement test compares them); the SDK refuses early with it and
 * `TestHost` models it.
 *
 * The channel is the SDK's contract; the command and property names and
 * what they do are mpv's (https://mpv.io/manual/stable/#list-of-input-commands,
 * https://mpv.io/manual/stable/#properties, https://mpv.io/manual/stable/#options).
 */

/**
 * Why `plugin.mpv` refuses a command or a property: the boundary it would
 * cross. A key of `MPV_RULES.categories`.
 *
 * @internal
 */
export type MpvRefusalCategory =
  | "process"
  | "code"
  | "clients"
  | "files"
  | "quit"
  | "input"
  | "clipboard"
  | "managed"
  | "filters";

/**
 * The limits of `plugin.mpv`, the same values as the player's (its
 * agreement test checks that they agree). Internal: exported from
 * `@vestra-player/sdk/runtime` only; [mpv](../docs/reference/mpv.md) shows
 * them.
 *
 * @internal
 */
export const MPV_LIMITS = Object.freeze({
  /** Elements of one command, its name included (32). */
  args: 32,
  /** Characters of a command or property name (128). */
  nameChars: 128,
  /** Characters of a filter label, after the `@` (64). */
  labelChars: 64,
  /** Different properties one plugin observes at the same time (64). */
  observed: 64,
  /** A property's changes reach an observer at most this often; the newest value wins (100 ms). */
  observeIntervalMs: 100,
});

/**
 * What `plugin.mpv` refuses, as data: the same table as the player's. A
 * command or property not named here goes to mpv as it is.
 *
 * - `categories`: one sentence per category, the end of the refusal's
 *   message.
 * - `commands`: mpv commands by name.
 * - `properties`: mpv properties and options by name (the part before the
 *   first `/`, after an `options/` or `file-local-options/` prefix);
 *   `propertyPrefixes`: by the start of the name, checked after
 *   `properties`. A write is refused; a read too for the categories of
 *   `reads`.
 * - `writers`: commands that write the property their first argument
 *   names (`cycle-values` after an optional `!reverse`); they are checked
 *   as a write of it.
 * - `filterCommands`: the filter chain commands and the operations a
 *   plugin may use, on its own labelled filters only; `filterMessages`:
 *   commands whose first argument is a filter label, which must be the
 *   plugin's own; `reservedLabel`: the start of the player's own labels.
 *
 * Internal: exported from `@vestra-player/sdk/runtime` only; the tables of
 * [mpv](../docs/reference/mpv.md) are generated from it.
 *
 * @internal
 */
export const MPV_RULES: {
  readonly categories: Readonly<Record<MpvRefusalCategory, string>>;
  readonly commands: Readonly<Record<string, MpvRefusalCategory>>;
  readonly properties: Readonly<Record<string, MpvRefusalCategory>>;
  readonly propertyPrefixes: Readonly<Record<string, MpvRefusalCategory>>;
  readonly reads: readonly MpvRefusalCategory[];
  readonly writers: readonly string[];
  readonly filterCommands: Readonly<Record<string, readonly string[]>>;
  readonly filterMessages: readonly string[];
  readonly reservedLabel: string;
} = Object.freeze({
  categories: Object.freeze({
    process: "it starts a program (a plugin starts its own with Node)",
    code: "it loads scripts or configuration into the player",
    clients:
      "it opens a control channel to the player or talks to its other clients",
    files:
      "it makes the player write or delete files (a plugin writes its own with Node)",
    quit: "it ends the player",
    input:
      "the keyboard and the mouse are the player's (plugin.commands, plugin.bindings)",
    clipboard: "the clipboard has its own capability (plugin.clipboard)",
    managed:
      "the player manages it and keeps its own state of it (use the plugin API's member for it)",
    filters:
      "a plugin changes only its own labelled filters (vf/af add, pre, toggle or remove of @label:…, a label not starting with vestra-)",
  }),
  commands: Object.freeze({
    // Programs.
    run: "process",
    subprocess: "process",
    // Scripts and configuration.
    "load-script": "code",
    "load-config-file": "code",
    "load-input-conf": "code",
    "apply-profile": "code",
    // Other clients of the player.
    "script-message": "clients",
    "script-message-to": "clients",
    "script-binding": "clients",
    // Files the player would write or delete.
    screenshot: "files",
    "screenshot-to-file": "files",
    "write-watch-later-config": "files",
    "delete-watch-later-config": "files",
    "dump-cache": "files",
    "ab-loop-dump-cache": "files",
    // The player's process.
    quit: "quit",
    "quit-watch-later": "quit",
    // Input.
    keypress: "input",
    keydown: "input",
    keyup: "input",
    keybind: "input",
    mouse: "input",
    "enable-section": "input",
    "disable-section": "input",
    "define-section": "input",
    "begin-vo-dragging": "input",
    "context-menu": "input",
    // The clipboard.
    "update-clipboard": "clipboard",
    // What plays and the playlist: plugin.player.open, provideSequence.
    loadfile: "managed",
    loadlist: "managed",
    stop: "managed",
    "playlist-next": "managed",
    "playlist-prev": "managed",
    "playlist-next-playlist": "managed",
    "playlist-prev-playlist": "managed",
    "playlist-play-index": "managed",
    "playlist-clear": "managed",
    "playlist-remove": "managed",
    "playlist-move": "managed",
    "playlist-shuffle": "managed",
    "playlist-unshuffle": "managed",
    // The position: plugin.player.seek, step, setLoop.
    seek: "managed",
    "revert-seek": "managed",
    "sub-seek": "managed",
    "frame-step": "managed",
    "frame-back-step": "managed",
    "ab-loop": "managed",
    "ab-loop-align-cache": "managed",
    // Tracks: plugin.player.addAudioTrack, plugin.subtitles.
    "sub-add": "managed",
    "sub-remove": "managed",
    "sub-reload": "managed",
    "audio-add": "managed",
    "audio-remove": "managed",
    "audio-reload": "managed",
    "video-add": "managed",
    "video-remove": "managed",
    "video-reload": "managed",
    "rescan-external-files": "managed",
    // The picture's overlays and snapshots: plugin.osd, plugin.media.
    "screenshot-raw": "managed",
    "overlay-add": "managed",
    "overlay-remove": "managed",
    "osd-overlay": "managed",
    "show-text": "managed",
    "show-progress": "managed",
  }),
  properties: Object.freeze({
    // Programs (the ytdl hook runs one).
    ytdl: "process",
    "ytdl-format": "process",
    "ytdl-raw-options": "process",
    // Scripts and configuration.
    scripts: "code",
    script: "code",
    "script-opts": "code",
    include: "code",
    profile: "code",
    config: "code",
    "config-dir": "code",
    osc: "code",
    // Control channels.
    wid: "clients",
    // Files the player would write.
    "stream-record": "files",
    "stream-dump": "files",
    "record-file": "files",
    "log-file": "files",
    "dump-stats": "files",
    o: "files",
    "ao-pcm-file": "files",
    "cache-dir": "files",
    "demuxer-cache-dir": "files",
    "icc-cache": "files",
    "icc-cache-dir": "files",
    "gpu-shader-cache": "files",
    "gpu-shader-cache-dir": "files",
    "save-position-on-quit": "files",
    // The player's process and window.
    idle: "quit",
    "keep-open": "quit",
    "keep-open-pause": "quit",
    "force-window": "quit",
    "cursor-autohide": "input",
    // The clipboard.
    clipboard: "clipboard",
    // Playback state: plugin.player.
    pause: "managed",
    speed: "managed",
    volume: "managed",
    mute: "managed",
    "time-pos": "managed",
    "playback-time": "managed",
    "percent-pos": "managed",
    chapter: "managed",
    edition: "managed",
    start: "managed",
    end: "managed",
    length: "managed",
    loop: "managed",
    "loop-file": "managed",
    "loop-playlist": "managed",
    "ab-loop-a": "managed",
    "ab-loop-b": "managed",
    "ab-loop-count": "managed",
    "audio-device": "managed",
    "audio-delay": "managed",
    "stop-screensaver": "managed",
    // Tracks and their files: plugin.player, plugin.subtitles.
    aid: "managed",
    vid: "managed",
    sid: "managed",
    "secondary-sid": "managed",
    audio: "managed",
    video: "managed",
    sub: "managed",
    "audio-files": "managed",
    "audio-file-auto": "managed",
    "external-files": "managed",
    "cover-art-auto": "managed",
    "cover-art-files": "managed",
    "audio-display": "managed",
    embeddedfonts: "managed",
    // The filter chains (as a whole), the output and the decoder.
    vf: "managed",
    af: "managed",
    vo: "managed",
    ao: "managed",
    hwdec: "managed",
    "hwdec-software-fallback": "managed",
    "gpu-api": "managed",
    "gpu-context": "managed",
    deinterlace: "managed",
    framedrop: "managed",
    "audio-stream-silence": "managed",
    // The renderer's options: plugin.video.render(), plugin.video.shaders().
    "glsl-shaders": "managed",
    "video-sync": "managed",
    "display-fps-override": "managed",
    "tone-mapping": "managed",
    "gamut-mapping-mode": "managed",
    "hdr-compute-peak": "managed",
    "target-peak": "managed",
    // The display layer: plugin.video.view().
    "video-zoom": "managed",
    "video-pan-x": "managed",
    "video-pan-y": "managed",
    "video-aspect-override": "managed",
    // The window: plugin.window.
    fullscreen: "managed",
    fs: "managed",
    ontop: "managed",
    border: "managed",
    title: "managed",
    geometry: "managed",
    "window-scale": "managed",
    "window-minimized": "managed",
    "window-maximized": "managed",
  }),
  propertyPrefixes: Object.freeze({
    "input-ipc-": "clients",
    "input-": "input",
    "load-": "code",
    "clipboard-": "clipboard",
    "screenshot-": "files",
    "watch-later-": "files",
    "playlist-": "managed",
    autofit: "managed",
    // Subtitle selection, files and style: plugin.subtitles.
    "sub-": "managed",
    "secondary-sub-": "managed",
  }),
  reads: Object.freeze(["clipboard"] as const),
  writers: Object.freeze([
    "set",
    "del",
    "add",
    "multiply",
    "cycle",
    "cycle-values",
    "change-list",
  ]),
  filterCommands: Object.freeze({
    vf: Object.freeze(["add", "pre", "toggle", "remove"]),
    af: Object.freeze(["add", "pre", "toggle", "remove"]),
  }),
  filterMessages: Object.freeze(["vf-command", "af-command"]),
  reservedLabel: "vestra-",
});

/** A command or property name as mpv writes one. */
const NAME = /^[a-z0-9][a-z0-9/_-]*$/i;
const LABEL = /^[A-Za-z0-9._-]+$/;

/** The rule's name of a property: without an options prefix and sub-path. */
function propertyKey(name: string) {
  const bare = name.replace(/^(?:file-local-options|options)\//, "");
  return bare.split("/")[0]!;
}

/** The category that refuses a property, for a read or a write; else `null`. */
function propertyCategory(
  name: string,
  write: boolean,
): MpvRefusalCategory | null {
  const key = propertyKey(name);
  let category: MpvRefusalCategory | undefined = Object.hasOwn(
    MPV_RULES.properties,
    key,
  )
    ? MPV_RULES.properties[key]
    : undefined;
  if (!category)
    for (const [prefix, each] of Object.entries(MPV_RULES.propertyPrefixes))
      if (key.startsWith(prefix)) {
        category = each;
        break;
      }
  if (!category) return null;
  return write || MPV_RULES.reads.includes(category) ? category : null;
}

const refusal = (what: string, category: MpvRefusalCategory) =>
  `${what} is refused: ${MPV_RULES.categories[category]}`;

/**
 * What is wrong with a property name, as the player words it (`invalid`);
 * `null` when nothing is.
 *
 * @internal
 */
export function mpvNameProblem(name: unknown): string | null {
  return typeof name === "string" &&
    name.length <= MPV_LIMITS.nameChars &&
    NAME.test(name)
    ? null
    : `a property name is 1–${MPV_LIMITS.nameChars} characters of letters, digits, "-", "_" and "/"`;
}

/**
 * What is wrong with a command's shape, as the player words it (`invalid`);
 * `null` when nothing is. The first element is the command's name, the
 * others its arguments: strings, numbers or booleans.
 *
 * @internal
 */
export function mpvCommandProblem(args: unknown): string | null {
  if (!Array.isArray(args) || args.length < 1 || args.length > MPV_LIMITS.args)
    return `a command is an array of 1–${MPV_LIMITS.args} elements, its name first`;
  const [name, ...rest] = args as unknown[];
  if (
    typeof name !== "string" ||
    name.length > MPV_LIMITS.nameChars ||
    !NAME.test(name)
  )
    return "a command's first element is its name (no prefixes such as no-osd or async)";
  for (const each of rest)
    if (
      typeof each !== "string" &&
      typeof each !== "boolean" &&
      !(typeof each === "number" && Number.isFinite(each))
    )
      return "a command's arguments are strings, finite numbers or booleans";
  return null;
}

/**
 * Why the pass-through refuses a property (`refused`), as the player words
 * it; `null` when it does not.
 *
 * @param name - The property, as given.
 * @param write - A write (`set`); a read is refused only for the
 *   categories of `MPV_RULES.reads`.
 *
 * @internal
 */
export function mpvPropertyRefusal(
  name: string,
  write: boolean,
): string | null {
  const category = propertyCategory(name, write);
  return category
    ? refusal(`mpv property ${JSON.stringify(name)}`, category)
    : null;
}

/** The label of a filter value: `@label` or `@label:…`; `null` without one. */
function filterLabel(value: unknown): string | null {
  if (typeof value !== "string" || !value.startsWith("@")) return null;
  const label = value.slice(1).split(":")[0]!;
  return label.length >= 1 &&
    label.length <= MPV_LIMITS.labelChars &&
    LABEL.test(label) &&
    !label.startsWith(MPV_RULES.reservedLabel)
    ? label
    : null;
}

/**
 * Why the pass-through refuses a command (`refused`), as the player words
 * it; `null` when it does not. The command's shape is checked first
 * ({@link mpvCommandProblem}).
 *
 * What only the player can tell is left to it: whether a label belongs to
 * another plugin, and whether a filter value holds more than the one
 * labelled filter (it compares the chain before and after).
 *
 * @internal
 */
export function mpvCommandRefusal(
  args: readonly (string | number | boolean)[],
): string | null {
  const name = String(args[0]);
  const shown = `mpv command ${JSON.stringify(name)}`;
  if (Object.hasOwn(MPV_RULES.commands, name))
    return refusal(shown, MPV_RULES.commands[name]!);
  if (MPV_RULES.writers.includes(name)) {
    const target =
      name === "cycle-values" && args[1] === "!reverse" ? args[2] : args[1];
    return typeof target === "string" ? mpvPropertyRefusal(target, true) : null;
  }
  if (Object.hasOwn(MPV_RULES.filterCommands, name))
    return MPV_RULES.filterCommands[name]!.includes(String(args[1])) &&
      filterLabel(args[2]) !== null
      ? null
      : refusal(shown, "filters");
  if (MPV_RULES.filterMessages.includes(name))
    return filterLabel(`@${String(args[1])}`) !== null
      ? null
      : refusal(shown, "filters");
  return null;
}

/**
 * The label a filter command adds or removes, for the owner's book:
 * `["vf", "add", "@smooth:…"]` → `{ stage: "vf", operation: "add", label:
 * "smooth" }`; `null` for any other command.
 *
 * @internal
 */
export function mpvFilterChange(
  args: readonly (string | number | boolean)[],
): { stage: string; operation: string; label: string } | null {
  const stage = String(args[0]);
  if (!Object.hasOwn(MPV_RULES.filterCommands, stage)) return null;
  const label = filterLabel(args[2]);
  return label === null ? null : { stage, operation: String(args[1]), label };
}
