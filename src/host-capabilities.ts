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
      name: "player",
      label:
        "Change your player settings (shortcuts, theme, language, rendering) and restart the player",
      reserved: false,
    },
    {
      name: "plugins",
      label:
        "Install, uninstall and disable other plugins, and run any command, including theirs",
      reserved: false,
    },
    {
      name: "clipboard",
      label: "Read and write the clipboard",
      reserved: false,
    },
    {
      name: "credentials",
      label: "Keep sign-in details in the system keychain",
      reserved: false,
    },
    { name: "camera", label: "Use the camera", reserved: true },
    { name: "microphone", label: "Use the microphone", reserved: true },
    { name: "screen", label: "Record the screen", reserved: true },
    {
      name: "notifications",
      label: "Send system notifications",
      reserved: true,
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
  groups: [
    {
      name: "producer.av",
      summary: "Provide audio and video it generates itself",
      residency: "live",
      methods: [
        { name: "producer.prepare", needs: null },
        { name: "producer.state", needs: null },
        { name: "producer.release", needs: null },
        { name: "producer.ack", needs: null },
        { name: "producer.declareInput", needs: null },
        { name: "producer.ackInput", needs: null },
      ],
    },
    {
      name: "playback.read",
      summary: "Read what is playing and the position",
      residency: "none",
      methods: [
        { name: "source.state", needs: null },
        { name: "processing.state", needs: null },
        { name: "playback.stats", needs: null },
        { name: "player.chapters", needs: null },
        { name: "player.audioDevices", needs: null },
        { name: "timeline.marks", needs: null },
      ],
    },
    {
      name: "playback.control",
      summary: "Open media, control playback, keep the computer awake",
      residency: "live",
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
    },
    {
      name: "source.resolve",
      summary: "Resolve online video addresses",
      residency: "recordable",
      methods: [
        { name: "sourceResolvers.register", needs: null },
        { name: "sourceResolvers.unregister", needs: null },
        { name: "sourceResolvers.respond", needs: null },
        { name: "sourceResolvers.*", needs: null },
      ],
    },
    {
      name: "events",
      summary: "Receive playback changes as they happen",
      residency: "live",
      methods: [
        { name: "events.subscribe", needs: null },
        { name: "events.unsubscribe", needs: null },
      ],
    },
    {
      name: "commands",
      summary: "Add menu commands and shortcuts",
      residency: "recordable",
      methods: [
        { name: "commands.register", needs: null },
        { name: "commands.update", needs: null },
        { name: "commands.unregister", needs: null },
        { name: "host.run", needs: null },
        { name: "commands.keys", needs: null },
      ],
    },
    {
      name: "ui.window",
      summary: "Open tool windows",
      residency: "live",
      methods: [
        { name: "ui.open", needs: null },
        { name: "ui.set", needs: null },
        { name: "ui.show", needs: null },
        { name: "ui.close", needs: null },
      ],
    },
    {
      name: "ui.mount",
      summary: "Show panels in the bottom bar, the sidebar or behind the video",
      residency: "live",
      methods: [
        { name: "ui.mount", needs: null },
        { name: "ui.setMount", needs: null },
        { name: "ui.unmount", needs: null },
        { name: "ui.interaction", needs: null },
        { name: "ui.menu", needs: null },
        { name: "layout.state", needs: null },
        { name: "layout.set", needs: null },
      ],
    },
    {
      name: "ui.dialog",
      summary: "Show file pickers and confirmations",
      residency: "none",
      methods: [
        { name: "dialogs.open", needs: null },
        { name: "dialogs.confirm", needs: null },
      ],
    },
    {
      name: "plugins.manage",
      summary: "Install, uninstall and disable other plugins",
      residency: "none",
      methods: [{ name: "packages.*", needs: "plugins" }],
    },
    {
      name: "processing",
      summary: "Process the picture and the sound (filters, shaders)",
      residency: "live",
      methods: [
        { name: "processing.replace", needs: null },
        { name: "processing.operation", needs: null },
        { name: "video.view.set", needs: null },
        { name: "video.view.release", needs: null },
        { name: "video.render.set", needs: null },
        { name: "video.render.release", needs: null },
        { name: "video.shaders.set", needs: null },
      ],
    },
    {
      name: "subtitles.read",
      summary: "Read subtitles",
      residency: "none",
      methods: [{ name: "subtitles.state", needs: null }],
    },
    {
      name: "subtitles.control",
      summary: "Load and change subtitles",
      residency: "live",
      methods: [{ name: "subtitles.*", needs: null }],
    },
    {
      name: "media.read",
      summary: "Take snapshots and export clips",
      residency: "none",
      methods: [
        { name: "snapshot.state", needs: null },
        { name: "jobs.state", needs: null },
        { name: "jobs.operation", needs: null },
      ],
    },
    {
      name: "media.control",
      summary: "Take snapshots and export clips",
      residency: "live",
      methods: [
        { name: "snapshot.*", needs: null },
        { name: "jobs.*", needs: null },
      ],
    },
    {
      name: "media.sources",
      summary: "Remember videos you add and export from them later",
      residency: "none",
      methods: [{ name: "media.sources.*", needs: null }],
    },
    {
      name: "ui.osd",
      summary: "Show messages on the video",
      residency: "live",
      methods: [
        { name: "osd.show", needs: null },
        { name: "osd.panel", needs: null },
      ],
    },
    {
      name: "clipboard",
      summary: "Read and write the clipboard",
      residency: "none",
      methods: [
        { name: "clipboard.readText", needs: "clipboard" },
        { name: "clipboard.writeText", needs: "clipboard" },
        { name: "clipboard.writeImage", needs: "clipboard" },
      ],
    },
    {
      name: "window.control",
      summary: "Adjust the main window (size, on top, picture-in-picture)",
      residency: "live",
      methods: [
        { name: "window.setVideoArea", needs: null },
        { name: "window.setAlwaysOnTop", needs: null },
        { name: "window.setCursorAutoHide", needs: null },
        { name: "window.setPictureInPicture", needs: null },
      ],
    },
    {
      name: "bindings.manage",
      summary: "Read and change all shortcuts",
      residency: "none",
      methods: [
        { name: "bindings.list", needs: "player" },
        { name: "bindings.set", needs: "player" },
        { name: "bindings.reset", needs: "player" },
      ],
    },
    {
      name: "timeline.marks",
      summary: "Show marks on the progress bar",
      residency: "live",
      methods: [
        { name: "timeline.set", needs: null },
        { name: "timeline.setRanges", needs: null },
      ],
    },
    {
      name: "ui.drop",
      summary: "Receive files dropped on the player",
      residency: "recordable",
      methods: [
        { name: "drops.provide", needs: null },
        { name: "drops.withdraw", needs: null },
        { name: "drops.listen", needs: null },
      ],
    },
    {
      name: "ui.settings",
      summary: "Add pages to the Options window",
      residency: "recordable",
      methods: [{ name: "settings.*", needs: null }],
    },
    {
      name: "ui.theme",
      summary: "Change the player's palette and interface language",
      residency: "none",
      methods: [
        { name: "appearance.set", needs: "player" },
        { name: "appearance.setLanguage", needs: "player" },
      ],
    },
    {
      name: "secrets",
      summary: "Store sign-in details in the system keychain",
      residency: "none",
      methods: [
        { name: "secrets.get", needs: "credentials" },
        { name: "secrets.set", needs: "credentials" },
        { name: "secrets.delete", needs: "credentials" },
      ],
    },
    {
      name: "rendering.manage",
      summary: "Choose GPU or software rendering and restart the player",
      residency: "none",
      methods: [
        { name: "rendering.setPreference", needs: "player" },
        { name: "rendering.restart", needs: "player" },
      ],
    },
    {
      name: "video.upscaling",
      summary: "Upscale the video with the GPU's video upscaler",
      residency: "live",
      methods: [
        { name: "video.upscaling.state", needs: null },
        { name: "video.upscaling.set", needs: null },
      ],
    },
    {
      name: "video.motion",
      summary: "Smooth motion with the GPU's frame-rate converter",
      residency: "live",
      methods: [
        { name: "video.motion.state", needs: null },
        { name: "video.motion.set", needs: null },
      ],
    },
    {
      name: "commands.run",
      summary: "Run any player or plugin command",
      residency: "none",
      methods: [
        { name: "commands.list", needs: "plugins" },
        { name: "commands.run", needs: "plugins" },
      ],
    },
    {
      name: "palette.lead",
      summary: "Add the first row of the command palette",
      residency: "recordable",
      methods: [
        { name: "palette.lead.set", needs: null },
        { name: "palette.lead.clear", needs: null },
        { name: "palette.lead.done", needs: null },
      ],
    },
    {
      name: "general",
      summary:
        "Read the plugin list, the window and rendering state; open files and links with the system; keep values for this run",
      residency: "none",
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
    },
  ],
};
