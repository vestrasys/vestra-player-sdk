/**
 * The player's core actions (`host/<id>` commands): their enabled rules and
 * reasons, what running one does, stepping and sequences.
 *
 * Part of `TestHost` (`./index.ts`): functions over the host and its private
 * state (`Internals`, `./internals.ts`) that the class delegates to.
 * Internal to the SDK; not exported from `@vestra-player/sdk/testing`.
 */
import { HostError } from "../../wire.ts";
import { validStep } from "../player/rules.ts";
import type { CommandDeclaration } from "../../commands.ts";
import type { FakeCommand, TestHost } from "./index.ts";
import type { Handler, Internals } from "./internals.ts";
import { hostText } from "./i18n.ts";
import { sourceIntent, audioCondition } from "./media.ts";

export function coreFacts(host: TestHost, _inner: Internals) {
  const s = host.source;
  const ready = s.phase === "ready";
  const ended = s.phase === "ended";
  return {
    ready,
    ended,
    toggle:
      (s.capabilities.pause && ready) || (ended && s.capabilities.restart),
    // After the end too: the seek leaves the end and plays on (player
    // 2026-11-09).
    step: s.capabilities.seek && (ready || ended) && s.position !== null,
    rate: s.capabilities.rate && ready,
    close: s.capabilities.close && s.phase !== "empty",
  };
}

/** Why one frame that way is impossible (B07), or null; the player's rules. */
export function frameCheck(
  host: TestHost,
  inner: Internals,
  forward: boolean,
): string | null {
  const s = host.source;
  const unsupported = hostText(
    host,
    inner,
    "Not supported by the current source",
  );
  const noBack = hostText(
    host,
    inner,
    "The current source cannot step back a frame",
  );
  if (s.phase !== "ready" && s.phase !== "ended") return unsupported;
  if (s.kind !== "media") return forward ? unsupported : noBack;
  if (s.hasVideo === false) return hostText(host, inner, "No video");
  if (forward && s.phase !== "ready") return unsupported;
  if (!forward && !s.capabilities.seek) return noBack;
  return null;
}

/**
 * One frame step that `frameCheck` allowed, as the player runs it: recorded
 * in `steps`; back from the end an exact seek one frame (`stats` fps, else
 * 30) before the position that stays paused; on the first frame nothing
 * moves; any other step marks an end it reaches as keeping the pause.
 */
export function frameStep(host: TestHost, inner: Internals, forward: boolean) {
  host.steps.push({
    unit: "frame",
    direction: forward ? "forward" : "backward",
  });
  const s = host.source;
  if (!forward && s.position !== null && s.position <= 0.001) return;
  if (!forward && s.phase === "ended") {
    const fps = host.stats.video?.fps;
    const frame = 1 / (fps && Number.isFinite(fps) && fps > 0 ? fps : 30);
    inner.holdPause = true;
    sourceIntent(host, inner, {
      kind: "control",
      control: {
        kind: "seek",
        seconds: Math.max(0, (s.position ?? 0) - frame),
      },
    });
    return;
  }
  inner.stepped = true;
}

/** The same enabled rules and reasons as the player's core actions. */
export function coreState(host: TestHost, inner: Internals, action: string) {
  const f = coreFacts(host, inner);
  const s = host.source;
  const unsupported = hostText(
    host,
    inner,
    "Not supported by the current source",
  );
  const rule: Record<string, [boolean, boolean | null, string]> = {
    "play-pause": [f.toggle, f.ready ? s.paused : null, unsupported],
    stop: [f.close, null, unsupported],
    previous: [
      !!host.sequence?.canPrevious,
      null,
      hostText(host, inner, "No previous item"),
    ],
    next: [
      !!host.sequence?.canNext,
      null,
      hostText(host, inner, "No next item"),
    ],
    "frame-back": [
      !frameCheck(host, inner, false),
      null,
      frameCheck(host, inner, false) ?? unsupported,
    ],
    "frame-forward": [
      !frameCheck(host, inner, true),
      null,
      frameCheck(host, inner, true) ?? unsupported,
    ],
    "seek-backward": [f.step, null, unsupported],
    "seek-forward": [f.step, null, unsupported],
    "rate-normal": [f.rate, s.rate === 1, unsupported],
    "rate-down": [f.rate, null, unsupported],
    "rate-up": [f.rate, null, unsupported],
    "volume-up": [true, null, unsupported],
    "volume-down": [true, null, unsupported],
    mute: [true, s.output.muted, unsupported],
  };
  const [enabled, checked, reason] = rule[action]!;
  return { enabled, checked, busy: false, reason: enabled ? null : reason };
}

export function registerCoreActions(host: TestHost, inner: Internals) {
  // As the player declares them (host/src/core_actions.rs `declarations`,
  // player 0.7.6): title, menu path (empty: the command palette only), order,
  // group, default bindings, repeat, radio. Close and Play/Pause are in the
  // menu; the rest left it for the panels and the command palette (seek,
  // frame and speed with the playback plugin's panel, volume and mute with
  // the audio plugin's, Previous and Next with the slim menu).
  const table: [
    string,
    string,
    string[],
    number,
    string,
    string[],
    boolean,
    boolean?,
  ][] = [
    ["stop", "Close", ["Close"], 120, "open", ["F4"], false],
    [
      "play-pause",
      "Play/Pause",
      ["Play/Pause"],
      201,
      "domain",
      ["Space", "Mouse:LeftClick"],
      false,
    ],
    ["previous", "Previous", [], 0, "domain", ["PageUp", "Mouse:X2"], false],
    ["next", "Next", [], 0, "domain", ["PageDown", "Mouse:X1"], false],
    ["frame-back", "Previous Frame", [], 0, "domain", ["D"], true],
    ["frame-forward", "Next Frame", [], 0, "domain", ["F"], true],
    ["seek-backward", "Back 5 s", [], 0, "domain", ["ArrowLeft"], true],
    ["seek-forward", "Forward 5 s", [], 0, "domain", ["ArrowRight"], true],
    ["rate-normal", "Normal", [], 0, "domain", ["Z"], false, true],
    ["rate-down", "Slower 0.1", [], 0, "domain", ["X"], false],
    ["rate-up", "Faster 0.1", [], 0, "domain", ["C"], false],
    [
      "volume-up",
      "Volume +",
      [],
      0,
      "domain",
      ["ArrowUp", "Mouse:WheelUp"],
      true,
    ],
    [
      "volume-down",
      "Volume −",
      [],
      0,
      "domain",
      ["ArrowDown", "Mouse:WheelDown"],
      true,
    ],
    ["mute", "Mute", [], 0, "domain", ["M"], false],
  ];

  for (const [
    id,
    fixed,
    path,
    order,
    group,
    bindings,
    repeat,
    radio,
  ] of table) {
    // The seek items carry the step (`setStepSeek`): the player
    // registers them again when it changes (core_actions.rs `seek_title`).
    const seek =
      id === "seek-forward"
        ? "Forward"
        : id === "seek-backward"
          ? "Back"
          : null;
    const titleOf = () =>
      seek === null
        ? fixed
        : `${seek} ${String(Math.round(host.stepSeek * 1000) / 1000)} s`;
    const declaration = {
      path,
      order,
      group,
      radio: radio ?? false,
      bindings,
      repeat,
    } as unknown as CommandDeclaration;
    Object.defineProperties(declaration, {
      title: { get: titleOf, enumerable: true },
    });
    const command: FakeCommand = {
      declaration,
      // The player's own words in the player's language.
      get display() {
        const leaf = titleOf();
        const step = /^(Back|Forward) (\S+) s$/.exec(leaf);
        const title = step
          ? hostText(host, inner, `${step[1]} {} s`, [step[2]!])
          : hostText(host, inner, leaf);
        return {
          title,
          path: path.length
            ? [...path.slice(0, -1).map((s) => hostText(host, inner, s)), title]
            : [],
        };
      },
      get state() {
        return coreState(host, inner, id);
      },
      set state(_value) {},
      revision: 1,
      async run() {
        // Like the player's menu: a disabled or busy command does not run.
        const state = coreState(host, inner, id);
        if (state.busy || !state.enabled)
          throw new HostError(
            "command",
            `host/${id} is ${state.busy ? "busy" : "disabled"}`,
          );
        await host.request("host.run", { action: id });
        await host.settle();
      },
    };
    host.coreCommands.set(`host/${id}`, command);
  }
}

export function runCore(
  host: TestHost,
  inner: Internals,
  action: string,
  seconds?: number,
) {
  const state = coreState(host, inner, action);
  if (!state.enabled)
    throw new HostError("unavailable", state.reason ?? "unavailable");
  host.coreRuns.push(action);
  const s = host.source;
  const time = (t: number | null) => {
    if (t === null) return "--:--";
    const w = Math.max(0, Math.floor(t));
    const mm = String(Math.floor(w / 60) % 60).padStart(2, "0");
    const ss = String(w % 60).padStart(2, "0");
    return w >= 3600 ? `${Math.floor(w / 3600)}:${mm}:${ss}` : `${mm}:${ss}`;
  };
  const rateText = (r: number) => String(Math.round(r * 100) / 100);
  switch (action) {
    case "play-pause":
      if (s.phase === "ended") sourceIntent(host, inner, { kind: "restart" });
      else
        sourceIntent(host, inner, {
          kind: "control",
          control: { kind: "pause", paused: !s.paused },
        });
      host.osd.push(
        hostText(
          host,
          inner,
          s.phase !== "ended" && !s.paused ? "Paused" : "Playing",
        ),
      );
      return;
    case "stop":
      sourceIntent(host, inner, { kind: "close" });
      return;
    case "previous":
    case "next":
      host.emit("sequence.step", { direction: action });
      return;
    case "frame-back":
    case "frame-forward":
      frameStep(host, inner, action === "frame-forward");
      return;
    case "seek-backward":
    case "seek-forward": {
      const step = seconds ?? host.stepSeek;
      const delta = action === "seek-forward" ? step : -step;
      const base = s.position ?? 0;
      let target = Math.max(0, Math.min(s.duration ?? Infinity, base + delta));
      // Keyframe mode, as the player: forward on the first keyframe at or
      // after the target (none: the exact target), backward on the last at
      // or before it; only sources with moving video that can seek.
      const keyframes =
        host.stepSeekKeyframes &&
        s.phase === "ready" && // after the end: an exact seek
        host.keyframes !== null &&
        s.hasVideo !== false &&
        s.capabilities.seek;
      if (keyframes && target !== base) {
        const keys = host.keyframes!;
        target =
          delta > 0
            ? (keys.find((k) => k >= target) ?? target)
            : keys
                .filter((k) => k <= target)
                .reduce((a, k) => Math.max(a, k), 0);
      }
      sourceIntent(host, inner, {
        kind: "control",
        control: { kind: "seek", seconds: target },
      });
      host.coreSeeks.push({
        action,
        seconds: step,
        keyframes,
        landed: target,
      });
      host.osd.push(
        hostText(
          host,
          inner,
          delta < 0 ? "Back {} s: {} / {}" : "Forward {} s: {} / {}",
          [Math.abs(delta), time(target), time(s.duration)],
        ),
      );
      return;
    }
    case "rate-normal":
    case "rate-down":
    case "rate-up": {
      const rate =
        action === "rate-normal"
          ? 1
          : Math.max(
              0.25,
              Math.min(
                4,
                Math.round(
                  (s.rate + (action === "rate-up" ? 0.1 : -0.1)) * 100,
                ) / 100,
              ),
            );
      sourceIntent(host, inner, {
        kind: "control",
        control: { kind: "rate", rate },
      });
      host.osd.push(hostText(host, inner, "Speed: {}x", [rateText(rate)]));
      return;
    }
    case "volume-up":
    case "volume-down": {
      // Like the player: up stops at 100 (a louder volume set through
      // setOutput stays), down steps by 5 to 0.
      const volume =
        action === "volume-up"
          ? Math.max(
              s.output.volume,
              Math.min(100, Math.round(s.output.volume + 5)),
            )
          : Math.max(0, Math.min(200, Math.round(s.output.volume - 5)));
      host.setSource({ output: { volume, muted: false } });
      host.osd.push(hostText(host, inner, "Volume: {}%", [volume]));
      return;
    }
    case "mute":
      host.setSource({ output: { ...s.output, muted: !s.output.muted } });
      host.osd.push(
        hostText(host, inner, s.output.muted ? "Mute: Off" : "Mute: On"),
      );
      return;
  }
}

export function windowFacts(host: TestHost, _inner: Internals) {
  return {
    fullscreen: host.mainWindow.fullscreen,
    // Like player 0.6.3: never maximized while fullscreen.
    maximized: host.mainWindow.maximized && !host.mainWindow.fullscreen,
    videoArea: { ...host.mainWindow.videoArea },
    pictureInPicture: { ...host.mainWindow.pictureInPicture },
    appearance: host.appearance,
    fileTypes: host.fileTypes(),
    language: host.language,
    locale: host.locale,
  };
}

/** The default handlers of this area's wire methods, by method name. */
export function coreActionsHandlers(
  host: TestHost,
  inner: Internals,
): Record<string, Handler> {
  return {
    "player.setStepSeek": (p) => {
      if (!validStep(p.seconds))
        throw new HostError("invalid", "seconds must be 0.1..3600 in tenths");
      if (
        p.keyframes !== undefined &&
        p.keyframes !== null &&
        typeof p.keyframes !== "boolean"
      )
        throw new HostError("invalid", "keyframes must be a boolean");
      // Written as a pair, as the player does.
      host.stepSeek = p.seconds;
      host.stepSeekKeyframes = p.keyframes === true;
    },
    "player.step": (p) => {
      audioCondition(host, inner, p.expected);
      const s = host.source;
      const reason =
        p.unit === "keyframe"
          ? (s.phase === "ready" || s.phase === "ended") &&
            s.capabilities.seek &&
            s.hasVideo !== false
            ? null
            : hostText(host, inner, "Not supported by the current source")
          : frameCheck(host, inner, p.direction === "forward");
      if (reason) throw new HostError("unsupported", reason);
      if (p.unit === "frame") frameStep(host, inner, p.direction === "forward");
      else {
        host.steps.push({
          unit: String(p.unit),
          direction: String(p.direction),
        });
        // Like the player after the end: Previous Keyframe is a source seek
        // to the last keyframe before the position (1 ms back; the exact
        // target when no keyframes are modelled) that stays paused; Next
        // Keyframe goes nowhere (the plugin says so).
        if (s.phase === "ended" && p.direction === "backward") {
          const target = Math.max(0, (s.position ?? 0) - 0.001);
          const landed =
            host.keyframes === null
              ? target
              : host.keyframes
                  .filter((k) => k <= target)
                  .reduce((a, k) => Math.max(a, k), 0);
          inner.holdPause = true;
          sourceIntent(host, inner, {
            kind: "control",
            control: { kind: "seek", seconds: landed, keyframes: true },
          });
        }
      }
    },
    "sequence.set": (p) => {
      host.sequence = p.flags as TestHost["sequence"];
      host.setSource({
        sequence: {
          next: host.sequence?.canNext ?? false,
          previous: host.sequence?.canPrevious ?? false,
        },
      });
    },
    "sequence.step": (p) => {
      const direction = String(p.direction);
      const can =
        direction === "next"
          ? host.sequence?.canNext
          : host.sequence?.canPrevious;
      if (!can) throw new HostError("unavailable", `cannot go ${direction}`);
      host.emit("sequence.step", { direction });
    },
    "player.chapters": () => ({
      sourceId: host.source.stamp.generation,
      chapters:
        host.source.kind === "media" &&
        ["ready", "ended"].includes(host.source.phase)
          ? structuredClone(host.chapters)
          : [],
    }),
    "player.setLoop": (p) => {
      if (host.source.kind === "producer")
        throw new HostError("unsupported", "a generated stream cannot loop");
      audioCondition(host, inner, p.expected);
      const loop = p.loop as { a: number; b: number; count?: number } | null;
      if (loop && !host.source.capabilities.seek)
        throw new HostError("unsupported", "the source cannot seek");
      if (
        loop &&
        !(
          loop.a >= 0 &&
          loop.a < loop.b &&
          loop.b <= (host.source.duration ?? 0)
        )
      )
        throw new HostError("invalid", "loop needs 0 <= a < b <= duration");
      host.setSource({
        loop: loop && { a: loop.a, b: loop.b, count: loop.count ?? null },
      });
    },
  };
}
