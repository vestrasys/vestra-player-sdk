---
title: Manifest
description: Every manifest.json field with its rules.
---

# Manifest

`manifest.json` sits at the root of the plugin directory and of the package. The player and every `vestra-plugin` command check it against the same rules: an unknown field, an unknown, retired or reserved capability, a field that breaks its rule, or a path that leaves the package (symbolic links included) is refused.

```json
{
  "id": "me.bookmark",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": [],
  "name": "Bookmark",
  "punchline": "Mark a moment and jump back to it.",
  "minPlayerVersion": "0.4.3"
}
```

## Fields

**Kind**: *required* fields every plugin has (`version` may come from `package.json` at build time); *display* fields are optional and shown by the plugin store and the plugin manager; *optional* changes how the player loads the plugin.

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
| `minPlayerVersion` | optional | `x.y.z`: the oldest player that loads the plugin, compared with `plugin.app.version` (the player release version). Set it to the player you tested with. An older player refuses the plugin with `versionMismatch` ("requires Vestra Player ≥ x.y.z") before it reads anything else. |

<!-- /generated -->

- `name`, `punchline`, `description` and `tags` are English source text; the player shows them translated with the plugin's own catalog ([Add settings and translations](../guides/i18n.md)) through {@link "@vestra-player/sdk"!PluginInfo | PluginInfo}.
- An `icon`, `readme` or `changelog` that is named but missing is refused. `vestra-plugin build` copies them (and a default `README.md` or `CHANGELOG.md`) into the package: the README is the plugin's page in the store, so write it for users.
- A call to a member whose capability is not declared fails with code `capability` ([Capabilities](capabilities.md)).

## Versions

Every 1.x release of the SDK implements `apiVersion` `vestra/1`: minor releases only add to it, and a breaking change gets a new `apiVersion` and a new major version. `@vestra-player/sdk/runtime` is the player's own entry point and is not covered by these rules. What changed in each SDK release is in the [CHANGELOG](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md).
