/**
 * The player's capability table, copied from its `src/host/capabilities.json`
 * by `npm run capabilities:sync -- <player repository>`. Do not edit: change
 * the player's capability modules, regenerate its JSON and sync again.
 *
 * @internal
 */
import type { HostCapabilities } from "./capability-rules.ts";

// "then" is a field of the player's IfDeclared rule, not a thenable.
/* oxlint-disable unicorn/no-thenable */

/** @internal */
export const HOST_CAPABILITIES: HostCapabilities = {
  about:
    "Generated from src/host/src/capabilities/ (VESTRA_UPDATE_CAPABILITIES=1 cargo test capabilities); do not edit. A method's needs: null (none), a capability name, {param, cases, otherwise} (by a string parameter) or {ifDeclared, then, otherwise}. A method name ending in .* covers the prefix's other methods.",
  apiVersion: "vestra/1",
  capabilities: [
    {
      label: "Provide audio and video it generates itself",
      methods: [
        { name: "producer.prepare", needs: "producer.av" },
        { name: "producer.state", needs: "producer.av" },
        { name: "producer.release", needs: "producer.av" },
        { name: "producer.ack", needs: "producer.av" },
        { name: "producer.declareInput", needs: "producer.av" },
        { name: "producer.ackInput", needs: "producer.av" },
      ],
      name: "producer.av",
      requires: ["playback.control"],
      residency: "live",
      risky: false,
    },
    {
      label: "Read what is playing and the position",
      methods: [
        { name: "source.state", needs: "playback.read" },
        { name: "processing.state", needs: "playback.read" },
        { name: "playback.stats", needs: "playback.read" },
        { name: "player.chapters", needs: "playback.read" },
        { name: "player.audioDevices", needs: "playback.read" },
        { name: "timeline.marks", needs: "playback.read" },
      ],
      name: "playback.read",
      requires: [],
      residency: "none",
      risky: false,
    },
    {
      label: "Open media, control playback, keep the computer awake",
      methods: [
        { name: "playback.set", needs: "playback.control" },
        { name: "source.submit", needs: "playback.control" },
        {
          name: "source.operation",
          needs: {
            ifDeclared: "playback.control",
            otherwise: "playback.read",
            then: "playback.control",
          },
        },
        { name: "audio.addTrack", needs: "playback.control" },
        { name: "audio.selectTrack", needs: "playback.control" },
        { name: "player.setLoop", needs: "playback.control" },
        { name: "player.setAudioDevice", needs: "playback.control" },
        { name: "player.step", needs: "playback.control" },
        { name: "player.setStepSeek", needs: "playback.control" },
        { name: "power.preventSleep", needs: "playback.control" },
        { name: "sequence.set", needs: "playback.control" },
        { name: "sequence.step", needs: "playback.control" },
      ],
      name: "playback.control",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Resolve online video addresses",
      methods: [
        { name: "sourceResolvers.register", needs: "source.resolve" },
        { name: "sourceResolvers.unregister", needs: "source.resolve" },
        { name: "sourceResolvers.respond", needs: "source.resolve" },
        { name: "sourceResolvers.*", needs: "source.resolve" },
      ],
      name: "source.resolve",
      requires: [],
      residency: "recordable",
      risky: false,
    },
    {
      label: "Receive playback changes as they happen",
      methods: [
        {
          name: "events.subscribe",
          needs: {
            cases: {
              "bindings.changed": "bindings.manage",
              "packages.changed": null,
            },
            otherwise: "events",
            param: "event",
          },
        },
        {
          name: "events.unsubscribe",
          needs: {
            cases: {
              "bindings.changed": "bindings.manage",
              "packages.changed": null,
            },
            otherwise: "events",
            param: "event",
          },
        },
      ],
      name: "events",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Add menu commands and shortcuts",
      methods: [
        { name: "commands.register", needs: "commands" },
        { name: "commands.update", needs: "commands" },
        { name: "commands.unregister", needs: "commands" },
        { name: "host.run", needs: "commands" },
      ],
      name: "commands",
      requires: [],
      residency: "recordable",
      risky: false,
    },
    {
      label: "Open tool windows",
      methods: [
        { name: "ui.open", needs: "ui.window" },
        { name: "ui.set", needs: "ui.window" },
        { name: "ui.show", needs: "ui.window" },
        { name: "ui.close", needs: "ui.window" },
      ],
      name: "ui.window",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Show panels in the bottom bar, the sidebar or behind the video",
      methods: [
        { name: "ui.mount", needs: "ui.mount" },
        { name: "ui.setMount", needs: "ui.mount" },
        { name: "ui.unmount", needs: "ui.mount" },
        { name: "ui.interaction", needs: "ui.mount" },
        { name: "ui.menu", needs: "ui.mount" },
        { name: "layout.state", needs: "ui.mount" },
        { name: "layout.set", needs: "ui.mount" },
      ],
      name: "ui.mount",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Show file pickers and confirmations",
      methods: [
        { name: "dialogs.open", needs: "ui.dialog" },
        { name: "dialogs.confirm", needs: "ui.dialog" },
      ],
      name: "ui.dialog",
      requires: [],
      residency: "none",
      risky: false,
    },
    {
      label: "Install, uninstall and disable other plugins",
      methods: [{ name: "packages.*", needs: "plugins.manage" }],
      name: "plugins.manage",
      requires: [],
      residency: "none",
      risky: true,
    },
    {
      label: "Process the picture (filters, shaders)",
      methods: [
        {
          name: "processing.replace",
          needs: {
            cases: { video: "processing.video" },
            otherwise: "processing.audio",
            param: "stage",
          },
        },
        {
          name: "processing.operation",
          needs: {
            cases: { video: "processing.video" },
            otherwise: "processing.audio",
            param: "stage",
          },
        },
        { name: "video.view.set", needs: "processing.video" },
        { name: "video.view.release", needs: "processing.video" },
        { name: "video.render.set", needs: "processing.video" },
        { name: "video.render.release", needs: "processing.video" },
      ],
      name: "processing.video",
      requires: ["playback.read"],
      residency: "live",
      risky: false,
    },
    {
      label: "Process the sound",
      methods: [],
      name: "processing.audio",
      requires: ["playback.read", "events"],
      residency: "live",
      risky: false,
    },
    {
      label: "Read subtitles",
      methods: [{ name: "subtitles.state", needs: "subtitles.read" }],
      name: "subtitles.read",
      requires: [],
      residency: "none",
      risky: false,
    },
    {
      label: "Load and change subtitles",
      methods: [{ name: "subtitles.*", needs: "subtitles.control" }],
      name: "subtitles.control",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Take snapshots and export clips",
      methods: [
        { name: "snapshot.state", needs: "media.read" },
        { name: "jobs.state", needs: "media.read" },
        { name: "jobs.operation", needs: "media.read" },
      ],
      name: "media.read",
      requires: ["media.control"],
      residency: "none",
      risky: false,
    },
    {
      label: "Take snapshots and export clips",
      methods: [
        { name: "snapshot.*", needs: "media.control" },
        { name: "jobs.*", needs: "media.control" },
      ],
      name: "media.control",
      requires: ["media.read"],
      residency: "live",
      risky: false,
    },
    {
      label: "Show messages on the video",
      methods: [
        { name: "osd.show", needs: "ui.osd" },
        { name: "osd.panel", needs: "ui.osd" },
      ],
      name: "ui.osd",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Read and write the clipboard",
      methods: [
        { name: "clipboard.readText", needs: "clipboard" },
        { name: "clipboard.writeText", needs: "clipboard" },
        { name: "clipboard.writeImage", needs: "clipboard" },
      ],
      name: "clipboard",
      requires: [],
      residency: "none",
      risky: true,
    },
    {
      label: "Adjust the main window (size, on top, picture-in-picture)",
      methods: [
        { name: "window.setVideoArea", needs: "window.control" },
        { name: "window.setAlwaysOnTop", needs: "window.control" },
        { name: "window.setCursorAutoHide", needs: "window.control" },
        { name: "window.setPictureInPicture", needs: "window.control" },
      ],
      name: "window.control",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Change all shortcuts",
      methods: [
        { name: "bindings.list", needs: "bindings.manage" },
        { name: "bindings.set", needs: "bindings.manage" },
        { name: "bindings.reset", needs: "bindings.manage" },
      ],
      name: "bindings.manage",
      requires: [],
      residency: "none",
      risky: true,
    },
    {
      label: "Show marks on the progress bar",
      methods: [{ name: "timeline.set", needs: "timeline.marks" }],
      name: "timeline.marks",
      requires: [],
      residency: "live",
      risky: false,
    },
    {
      label: "Receive files dropped on the player",
      methods: [
        { name: "drops.provide", needs: "ui.drop" },
        { name: "drops.withdraw", needs: "ui.drop" },
        { name: "drops.listen", needs: "ui.drop" },
      ],
      name: "ui.drop",
      requires: [],
      residency: "recordable",
      risky: false,
    },
    {
      label: "Add pages to the Options window",
      methods: [{ name: "settings.*", needs: "ui.settings" }],
      name: "ui.settings",
      requires: [],
      residency: "recordable",
      risky: false,
    },
    {
      label: "Change the player's palette",
      methods: [
        { name: "appearance.set", needs: "ui.theme" },
        { name: "appearance.setLanguage", needs: "ui.theme" },
      ],
      name: "ui.theme",
      requires: [],
      residency: "none",
      risky: false,
    },
    {
      label: "Store sign-in details in the system keychain",
      methods: [
        { name: "secrets.get", needs: "secrets" },
        { name: "secrets.set", needs: "secrets" },
        { name: "secrets.delete", needs: "secrets" },
      ],
      name: "secrets",
      requires: [],
      residency: "none",
      risky: true,
    },
    {
      label: "Choose GPU or software rendering and restart the player",
      methods: [
        { name: "rendering.setPreference", needs: "rendering.manage" },
        { name: "rendering.restart", needs: "rendering.manage" },
      ],
      name: "rendering.manage",
      requires: [],
      residency: "none",
      risky: true,
    },
  ],
  uncapable: [
    { name: "packages.list", needs: null },
    { name: "window.state", needs: null },
    { name: "system.reveal", needs: null },
    { name: "system.openPath", needs: null },
    { name: "system.openUrl", needs: null },
    { name: "app.system", needs: null },
    { name: "ui.markdownScan", needs: null },
    { name: "storage.session.get", needs: null },
    { name: "storage.session.set", needs: null },
    { name: "storage.session.delete", needs: null },
    { name: "storage.session.keys", needs: null },
    { name: "rendering.state", needs: null },
  ],
};
