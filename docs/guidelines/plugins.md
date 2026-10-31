---
title: Plugin rules
description: The rules every plugin follows, in the official plugin repository or not, so that plugins stay independent of each other and portable.
---

# Plugin rules

Every plugin, in the official plugin repository or not, follows these rules. They keep plugins independent of each other and portable.

- **Only the public SDK.** Import `@vestra-player/sdk` with `import type` only (a runtime import fails `vestra-plugin build`) and `@vestra-player/sdk/testing` only in tests. `@vestra-player/sdk/runtime` and the SDK's internal modules are for the player.
- **No other plugins.** Do not import another plugin's code, read its directory or data directory, or talk to it privately (shared files, sockets, messages). A plugin must load, run and stop while no other plugin is installed. Plugins share only what the API makes public: player state, timeline marks, menus, settings pages.
- **No system commands.** Do not run `open`, `sips`, `plutil`, `security`, `cmd`, `powershell` or similar. Use the API (`plugin.system` to open files and links, `plugin.clipboard`, `plugin.secrets`, `plugin.tools` for ffmpeg and ffprobe) or portable Node.js code. If the API lacks something every system needs, ask for it in the SDK repository.
- **macOS and Windows.** The same code runs on both: build paths with `node:path`, write package paths with `/`, and handle `unsupported` where a method documents a platform difference.
- **Your own id.** `<owner>.<name>`, where the owner is your GitHub user or organization. `vestra` and `vestra.*` are reserved for the plugins built into the player.

The store's own requirements for a published plugin (display fields, README, changelog, tests) are in [Publish a plugin](../how-to/publish.md).
