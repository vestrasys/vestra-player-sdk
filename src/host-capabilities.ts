/**
 * The player's capability table, copied from its `src/host/capabilities.json`
 * by `npm run capabilities:sync -- <player repository>`. Do not edit: change
 * the player's capability modules, regenerate its JSON and sync again.
 *
 * @internal
 */
import type { HostCapabilities } from "./capability-rules.ts";

/** @internal */
export const HOST_CAPABILITIES: HostCapabilities = {
  about:
    "Generated from src/host/src/capabilities/ (VESTRA_UPDATE_CAPABILITIES=1 cargo test capabilities); do not edit. capabilities: the closed list a manifest may declare; a reserved one is known and no method needs it yet. retired: names a manifest may no longer declare (the player refuses it), with the capability to declare instead (null: none). groups: every protocol method by the group that serves it; a method's needs is null (any plugin) or one capability name. A method name ending in .* covers the prefix's other methods.",
  apiVersion: "vestra/1",
  capabilities: [
    {
      label:
        "Change your player settings (shortcuts, theme, language, rendering) and restart the player",
      name: "player",
      reserved: false,
    },
    {
      label:
        "Install, uninstall and disable other plugins, and run any command, including theirs",
      name: "plugins",
      reserved: false,
    },
    {
      label: "Read and write the clipboard",
      name: "clipboard",
      reserved: false,
    },
    {
      label: "Keep sign-in details in the system keychain",
      name: "credentials",
      reserved: false,
    },
    { label: "Use the camera", name: "camera", reserved: true },
    { label: "Use the microphone", name: "microphone", reserved: true },
    { label: "Record the screen", name: "screen", reserved: true },
    {
      label: "Send system notifications",
      name: "notifications",
      reserved: true,
    },
  ],
  groups: [
    {
      methods: [
        { name: "producer.prepare", needs: null },
        { name: "producer.state", needs: null },
        { name: "producer.release", needs: null },
        { name: "producer.ack", needs: null },
        { name: "producer.declareInput", needs: null },
        { name: "producer.ackInput", needs: null },
      ],
      name: "producer.av",
      residency: "live",
      summary: "Provide audio and video it generates itself",
    },
    {
      methods: [
        { name: "source.state", needs: null },
        { name: "processing.state", needs: null },
        { name: "playback.stats", needs: null },
        { name: "player.chapters", needs: null },
        { name: "player.audioDevices", needs: null },
        { name: "timeline.marks", needs: null },
      ],
      name: "playback.read",
      residency: "none",
      summary: "Read what is playing and the position",
    },
    {
      methods: [
        { name: "playback.set", needs: null },
        { name: "source.submit", needs: null },
        { name: "source.operation", needs: null },
        { name: "audio.addTrack", needs: null },
        { name: "audio.selectTrack", needs: null },
        { name: "player.setLoop", needs: null },
        { name: "player.setAudioDevice", needs: null },
        { name: "player.step", needs: null },
        { name: "player.setStepSeek", needs: null },
        { name: "power.preventSleep", needs: null },
        { name: "sequence.set", needs: null },
        { name: "sequence.step", needs: null },
      ],
      name: "playback.control",
      residency: "live",
      summary: "Open media, control playback, keep the computer awake",
    },
    {
      methods: [
        { name: "sourceResolvers.register", needs: null },
        { name: "sourceResolvers.unregister", needs: null },
        { name: "sourceResolvers.respond", needs: null },
        { name: "sourceResolvers.*", needs: null },
      ],
      name: "source.resolve",
      residency: "recordable",
      summary: "Resolve online video addresses",
    },
    {
      methods: [
        { name: "events.subscribe", needs: null },
        { name: "events.unsubscribe", needs: null },
      ],
      name: "events",
      residency: "live",
      summary: "Receive playback changes as they happen",
    },
    {
      methods: [
        { name: "commands.register", needs: null },
        { name: "commands.update", needs: null },
        { name: "commands.unregister", needs: null },
        { name: "host.run", needs: null },
        { name: "commands.keys", needs: null },
      ],
      name: "commands",
      residency: "recordable",
      summary: "Add menu commands and shortcuts",
    },
    {
      methods: [
        { name: "ui.open", needs: null },
        { name: "ui.set", needs: null },
        { name: "ui.show", needs: null },
        { name: "ui.close", needs: null },
      ],
      name: "ui.window",
      residency: "live",
      summary: "Open tool windows",
    },
    {
      methods: [
        { name: "ui.mount", needs: null },
        { name: "ui.setMount", needs: null },
        { name: "ui.unmount", needs: null },
        { name: "ui.interaction", needs: null },
        { name: "ui.menu", needs: null },
        { name: "layout.state", needs: null },
        { name: "layout.set", needs: null },
      ],
      name: "ui.mount",
      residency: "live",
      summary: "Show panels in the bottom bar, the sidebar or behind the video",
    },
    {
      methods: [
        { name: "dialogs.open", needs: null },
        { name: "dialogs.confirm", needs: null },
      ],
      name: "ui.dialog",
      residency: "none",
      summary: "Show file pickers and confirmations",
    },
    {
      methods: [{ name: "packages.*", needs: "plugins" }],
      name: "plugins.manage",
      residency: "none",
      summary: "Install, uninstall and disable other plugins",
    },
    {
      methods: [
        { name: "processing.replace", needs: null },
        { name: "processing.operation", needs: null },
        { name: "video.view.set", needs: null },
        { name: "video.view.release", needs: null },
        { name: "video.render.set", needs: null },
        { name: "video.render.release", needs: null },
        { name: "video.shaders.set", needs: null },
      ],
      name: "processing",
      residency: "live",
      summary: "Process the picture and the sound (filters, shaders)",
    },
    {
      methods: [{ name: "subtitles.state", needs: null }],
      name: "subtitles.read",
      residency: "none",
      summary: "Read subtitles",
    },
    {
      methods: [{ name: "subtitles.*", needs: null }],
      name: "subtitles.control",
      residency: "live",
      summary: "Load and change subtitles",
    },
    {
      methods: [
        { name: "snapshot.state", needs: null },
        { name: "jobs.state", needs: null },
        { name: "jobs.operation", needs: null },
      ],
      name: "media.read",
      residency: "none",
      summary: "Take snapshots and export clips",
    },
    {
      methods: [
        { name: "snapshot.*", needs: null },
        { name: "jobs.*", needs: null },
      ],
      name: "media.control",
      residency: "live",
      summary: "Take snapshots and export clips",
    },
    {
      methods: [{ name: "media.sources.*", needs: null }],
      name: "media.sources",
      residency: "none",
      summary: "Remember videos you add and export from them later",
    },
    {
      methods: [
        { name: "osd.show", needs: null },
        { name: "osd.panel", needs: null },
      ],
      name: "ui.osd",
      residency: "live",
      summary: "Show messages on the video",
    },
    {
      methods: [
        { name: "clipboard.readText", needs: "clipboard" },
        { name: "clipboard.writeText", needs: "clipboard" },
        { name: "clipboard.writeImage", needs: "clipboard" },
      ],
      name: "clipboard",
      residency: "none",
      summary: "Read and write the clipboard",
    },
    {
      methods: [
        { name: "window.setVideoArea", needs: null },
        { name: "window.setAlwaysOnTop", needs: null },
        { name: "window.setCursorAutoHide", needs: null },
        { name: "window.setPictureInPicture", needs: null },
      ],
      name: "window.control",
      residency: "live",
      summary: "Adjust the main window (size, on top, picture-in-picture)",
    },
    {
      methods: [
        { name: "bindings.list", needs: "player" },
        { name: "bindings.set", needs: "player" },
        { name: "bindings.reset", needs: "player" },
      ],
      name: "bindings.manage",
      residency: "none",
      summary: "Read and change all shortcuts",
    },
    {
      methods: [
        { name: "timeline.set", needs: null },
        { name: "timeline.setRanges", needs: null },
      ],
      name: "timeline.marks",
      residency: "live",
      summary: "Show marks on the progress bar",
    },
    {
      methods: [
        { name: "drops.provide", needs: null },
        { name: "drops.withdraw", needs: null },
        { name: "drops.listen", needs: null },
      ],
      name: "ui.drop",
      residency: "recordable",
      summary: "Receive files dropped on the player",
    },
    {
      methods: [{ name: "settings.*", needs: null }],
      name: "ui.settings",
      residency: "recordable",
      summary: "Add pages to the Options window",
    },
    {
      methods: [
        { name: "appearance.set", needs: "player" },
        { name: "appearance.setLanguage", needs: "player" },
      ],
      name: "ui.theme",
      residency: "none",
      summary: "Change the player's palette and interface language",
    },
    {
      methods: [
        { name: "secrets.get", needs: "credentials" },
        { name: "secrets.set", needs: "credentials" },
        { name: "secrets.delete", needs: "credentials" },
      ],
      name: "secrets",
      residency: "none",
      summary: "Store sign-in details in the system keychain",
    },
    {
      methods: [
        { name: "rendering.setPreference", needs: "player" },
        { name: "rendering.restart", needs: "player" },
      ],
      name: "rendering.manage",
      residency: "none",
      summary: "Choose GPU or software rendering and restart the player",
    },
    {
      methods: [
        { name: "video.upscaling.state", needs: null },
        { name: "video.upscaling.set", needs: null },
      ],
      name: "video.upscaling",
      residency: "live",
      summary: "Upscale the video with the GPU's video upscaler",
    },
    {
      methods: [
        { name: "video.motion.state", needs: null },
        { name: "video.motion.set", needs: null },
      ],
      name: "video.motion",
      residency: "live",
      summary: "Smooth motion with the GPU's frame-rate converter",
    },
    {
      methods: [
        { name: "commands.list", needs: "plugins" },
        { name: "commands.run", needs: "plugins" },
      ],
      name: "commands.run",
      residency: "none",
      summary: "Run any player or plugin command",
    },
    {
      methods: [
        { name: "palette.lead.set", needs: null },
        { name: "palette.lead.clear", needs: null },
        { name: "palette.lead.done", needs: null },
      ],
      name: "palette.lead",
      residency: "recordable",
      summary: "Add the first row of the command palette",
    },
    {
      methods: [
        { name: "mpv.command", needs: "player" },
        { name: "mpv.get", needs: "player" },
        { name: "mpv.set", needs: "player" },
        { name: "mpv.observe", needs: "player" },
        { name: "mpv.unobserve", needs: "player" },
      ],
      name: "mpv",
      residency: "live",
      summary: "Send mpv commands and read, set and observe its properties",
    },
    {
      methods: [
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
      name: "general",
      residency: "none",
      summary:
        "Read the plugin list, the window and rendering state; open files and links with the system; keep values for this run",
    },
  ],
  retired: [
    { name: "producer.av", replacedBy: null },
    { name: "playback.read", replacedBy: null },
    { name: "playback.control", replacedBy: null },
    { name: "source.resolve", replacedBy: null },
    { name: "events", replacedBy: null },
    { name: "commands", replacedBy: null },
    { name: "ui.window", replacedBy: null },
    { name: "ui.mount", replacedBy: null },
    { name: "ui.dialog", replacedBy: null },
    { name: "plugins.manage", replacedBy: "plugins" },
    { name: "processing.video", replacedBy: null },
    { name: "processing.audio", replacedBy: null },
    { name: "subtitles.read", replacedBy: null },
    { name: "subtitles.control", replacedBy: null },
    { name: "media.read", replacedBy: null },
    { name: "media.control", replacedBy: null },
    { name: "media.sources", replacedBy: null },
    { name: "ui.osd", replacedBy: null },
    { name: "window.control", replacedBy: null },
    { name: "bindings.manage", replacedBy: "player" },
    { name: "timeline.marks", replacedBy: null },
    { name: "ui.drop", replacedBy: null },
    { name: "ui.settings", replacedBy: null },
    { name: "ui.theme", replacedBy: "player" },
    { name: "secrets", replacedBy: "credentials" },
    { name: "rendering.manage", replacedBy: "player" },
    { name: "video.upscaling", replacedBy: null },
    { name: "video.motion", replacedBy: null },
    { name: "commands.run", replacedBy: "plugins" },
    { name: "palette.lead", replacedBy: null },
  ],
};
