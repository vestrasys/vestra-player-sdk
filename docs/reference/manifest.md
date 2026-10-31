---
title: Manifest
description: Every manifest.json field with its rules, and the player version each newer part of the API needs.
---

# Manifest

`manifest.json` sits at the root of the plugin directory and of the package. The player and every `vestra-plugin` command check it against the same rules: an unknown field, an unknown capability, a field that breaks its rule, or a path that leaves the package (symbolic links included) is refused.

```json
{
  "id": "me.bookmark",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": ["commands", "ui.window"],
  "name": "Bookmark",
  "punchline": "Mark a moment and jump back to it.",
  "minPlayerVersion": "0.4.3"
}
```

## Fields

**Kind**: *required* fields every plugin has (`version` may come from `package.json` at build time); *display* fields are optional and shown by the plugin store and the plugin manager (player 0.2.0); *optional* changes how the player loads the plugin.

<!-- generated:manifest-fields -->

| Field | Kind | Rule |
| --- | --- | --- |
| `id` | required | 1–128 bytes of ASCII letters, digits and `.`, `-`, `_`. Ids `vestra` and `vestra.…` (any case) belong to the player's built-in plugins; installing one fails with `reserved`. A plugin in the official plugin repository is named `<GitHub user or organization>.<plugin>`; `vestra-plugin check` only hints at a missing prefix. |
| `version` | required in the package | `x.y.z`, three whole numbers. `vestra-plugin build` writes it into `dist/manifest.json` from `--version`, the manifest or `package.json`. |
| `apiVersion` | required | `vestra/1`. |
| `entry` | required | Path of the entry module inside the package: `.ts` while developing, `.js` after `build`. |
| `capabilities` | required | Capabilities from [Capabilities](capabilities.md), each at most once. |
| `name` | display | 1–64 characters, one line, no leading or trailing white space. English; translated with the plugin's catalog. |
| `author` | display | 1–64 characters, one line. |
| `punchline` | display | One-line summary, 1–120 characters. English; translated. |
| `description` | display | Plain text, 1–2000 characters; line breaks allowed. English; translated. |
| `tags` | display | At most 8 tags, each 1–24 characters on one line, unique ignoring case. English; translated. |
| `icon` | display | Package path of a PNG or JPEG (by content), at most 512 KiB and 1024 pixels per side; 256×256 recommended. |
| `readme` | display | Package path of a UTF-8 `.md` file of at most 256 KiB, shown on the store page. Default: `README.md` when the package has one. |
| `changelog` | display | The same rules; default `CHANGELOG.md` when present. |
| `sourceUrl` | display | An `https:` address of at most 2048 bytes. |
| `license` | display | 1–64 characters, preferably an SPDX expression such as `MIT`. |
| `minPlayerVersion` | optional | `x.y.z`: the oldest player that loads the plugin (compared with `plugin.app.version`, three numbers). An older player refuses it with `versionMismatch` ("requires Vestra Player ≥ x.y.z") before it reads anything else, so a manifest with newer fields fails with that, not with an unknown field. See [Player versions](#player-versions). |

<!-- /generated -->

- `name`, `punchline`, `description` and `tags` are English source text; the player shows them translated with the plugin's own catalog ([Translate a plugin](../how-to/i18n.md)) through {@link "@vestra-player/sdk"!PluginInfo | PluginInfo}.
- An `icon`, `readme` or `changelog` that is named but missing is refused. `vestra-plugin build` copies them (and a default `README.md` or `CHANGELOG.md`) into the package: the README is the plugin's page in the store, so write it for users.
- A call to a member whose capability is not declared fails with code `capability` ([Capabilities](capabilities.md)).

## Player versions

The SDK's major version follows the plugin API: every 1.x release implements `apiVersion` `vestra/1`, minor releases only add to it, and a breaking change gets a new `apiVersion` and a new major version. Some additions also need a newer player. A plugin that uses one sets `minPlayerVersion` to the highest version it needs; an older player then refuses it with `versionMismatch` instead of failing at the first call.

The table lists the API whose documentation names a player version, newest last:

<!-- generated:player-versions -->

| Player | API that needs it or changed with it |
| --- | --- |
| 0.2.0 | {@linkcode "@vestra-player/sdk"!Plugin.dataDirectory Plugin.dataDirectory}, {@linkcode "@vestra-player/sdk"!MarkdownRef MarkdownRef}, {@linkcode "@vestra-player/sdk"!Ui.markdown Ui.markdown}, {@linkcode "@vestra-player/sdk"!PackageManifest PackageManifest}, {@linkcode "@vestra-player/sdk"!Packages.validateArchive Packages.validateArchive} |
| 0.3.0 | {@linkcode "@vestra-player/sdk"!CommandOptions CommandOptions}, {@linkcode "@vestra-player/sdk/testing"!MENU_IDS MENU_IDS} |
| 0.4.0 | {@linkcode "@vestra-player/sdk"!ThemeId ThemeId} |
| 0.4.1 | {@linkcode "@vestra-player/sdk"!PluginError PluginError}, {@linkcode "@vestra-player/sdk"!FileResolverOptions FileResolverOptions}, {@linkcode "@vestra-player/sdk"!PackageCandidate.install PackageCandidate.install}, {@linkcode "@vestra-player/sdk"!PluginWarning.code PluginWarning.code}, {@linkcode "@vestra-player/sdk"!Packages.validate Packages.validate} |
| 0.4.2 | {@linkcode "@vestra-player/sdk"!Resolvers.fileTypes Resolvers.fileTypes}, {@linkcode "@vestra-player/sdk"!Resolvers.onFileTypesChange Resolvers.onFileTypesChange} |
| 0.4.3 | {@linkcode "@vestra-player/sdk"!CommandOptions.path CommandOptions.path}, {@linkcode "@vestra-player/sdk"!PropValue PropValue}, {@linkcode "@vestra-player/sdk"!View.set View.set}, {@linkcode "@vestra-player/sdk"!Appearance.setLanguage Appearance.setLanguage}, {@linkcode "@vestra-player/sdk"!TemplateArgs TemplateArgs}, {@linkcode "@vestra-player/sdk"!Text Text}, {@linkcode "@vestra-player/sdk"!ConfirmOptions.args ConfirmOptions.args}, {@linkcode "@vestra-player/sdk"!OsdPanel.set OsdPanel.set}, {@linkcode "@vestra-player/sdk"!OsdPanelOptions.maxColumns OsdPanelOptions.maxColumns}, {@linkcode "@vestra-player/sdk"!Osd.show Osd.show} |
| 0.5.1 | {@linkcode "@vestra-player/sdk"!ImageRef ImageRef}, {@linkcode "@vestra-player/sdk"!ImageOptions.maxSide ImageOptions.maxSide}, {@linkcode "@vestra-player/sdk"!PropValue PropValue}, {@linkcode "@vestra-player/sdk"!Ui.image Ui.image}, {@linkcode "@vestra-player/sdk"!Ui.remoteImage Ui.remoteImage}, {@linkcode "@vestra-player/sdk"!SlotState.reason SlotState.reason}, {@linkcode "@vestra-player/sdk"!Panel.setInteraction Panel.setInteraction}, {@linkcode "@vestra-player/sdk"!PlaybackStats.presentedFps PlaybackStats.presentedFps}, {@linkcode "@vestra-player/sdk"!Player.setStepSeek Player.setStepSeek}, {@linkcode "@vestra-player/sdk"!Host.run Host.run}, {@linkcode "@vestra-player/sdk"!Packages.reload Packages.reload} |
| 0.5.2 | {@linkcode "@vestra-player/sdk"!HostAction HostAction} |
| 0.5.3 | {@linkcode "@vestra-player/sdk"!Scrub.seek Scrub.seek} |
| 0.5.5 | {@linkcode "@vestra-player/sdk"!SessionStorage SessionStorage} |
| 0.5.10 | {@linkcode "@vestra-player/sdk"!CommandButton CommandButton}, {@linkcode "@vestra-player/sdk"!CommandOptions.button CommandOptions.button} |
| 0.5.12 | {@linkcode "@vestra-player/sdk"!SystemInfo.rendering SystemInfo.rendering} |
| 0.5.13 | {@linkcode "@vestra-player/sdk"!SystemInfo.renderingReason SystemInfo.renderingReason}, {@linkcode "@vestra-player/sdk"!RenderingMode RenderingMode}, {@linkcode "@vestra-player/sdk"!RenderingPreference RenderingPreference}, {@linkcode "@vestra-player/sdk"!RenderingReasonCode RenderingReasonCode}, {@linkcode "@vestra-player/sdk"!RenderingReason RenderingReason}, {@linkcode "@vestra-player/sdk"!RenderingState RenderingState}, {@linkcode "@vestra-player/sdk"!Rendering Rendering} |
| 0.5.16 | {@linkcode "@vestra-player/sdk"!UpscalingReasonCode UpscalingReasonCode}, {@linkcode "@vestra-player/sdk"!UpscalingReason UpscalingReason}, {@linkcode "@vestra-player/sdk"!UpscalingState UpscalingState}, {@linkcode "@vestra-player/sdk"!VideoUpscaling VideoUpscaling} |
| 0.5.21 | {@linkcode "@vestra-player/sdk"!Scope.when Scope.when}, {@linkcode "@vestra-player/sdk"!When When} |

<!-- /generated -->

The Slint library carries no version tags: `Theme.danger` needs player 0.3.0; `@vestra/icons.slint` and the palette `vestra-light` need 0.4.0 ([Theme](theme.md)).

`@vestra-player/sdk/runtime` is the player's own entry point and is not covered by these rules. What changed in each SDK release is in the [CHANGELOG](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md).
