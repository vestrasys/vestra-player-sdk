---
title: Command line
description: The vestra-plugin commands and options, the rules of build and pack, and the vestra field of package.json.
---

# Command line

`vestra-plugin` comes with `@vestra-player/sdk` and works in any project that depends on it (`npx vestra-plugin …`, or an npm script). A plugin directory is a directory with `manifest.json`; the default is the current directory, and several can be given at once.

<!-- generated:cli usage -->

```text
usage: vestra-plugin <check|build|test|pack> [plugin-dir...] [--version x.y.z] [--out dir]
       vestra-plugin check [plugin-dir...] --json
       vestra-plugin i18n extract [plugin-dir...] [--locale <lang>]...
       vestra-plugin i18n check [plugin-dir...]
       vestra-plugin docs [path] [--page N]
       vestra-plugin docs --search <query> [--page N]
```

<!-- /generated -->

<!-- generated:cli commands -->

| Command | Does |
| --- | --- |
| `vestra-plugin check` | strict type check of the plugin's .ts files and tests/*.ts (then every use of an API member whose capability manifest.json does not declare: file:line, member, capability; fails on any; a plugin.wire.request or event listener whose name the check cannot read is listed as unchecked, without failing; --json prints the findings and the unchecked calls as JSON) |
| `vestra-plugin build` | check, then write dist/: .ts → .js with types stripped, other package files copied, dist/manifest.json with `version` |
| `vestra-plugin test` | node --test on tests/*.test.{ts,mjs} |
| `vestra-plugin pack` | build, then dist/ → <out>/<id>-<version>.vxp (a zip; default out: the current directory) with its sha256 and size |
| `vestra-plugin docs` | the SDK's documentation by path, for coding agents: `/` lists Overview, Guides and API, `/API/Media/Snapshot/dispose` is one member's whole documentation; --search <query> lists matching paths; at most 8 KB per answer, --page N for the rest |
| `vestra-plugin i18n extract` | find the texts to translate (@tr in .slint files, the texts handed to commands.add, osd.show, dialogs, settings and panel titles, the manifest's display fields), write locales/messages.pot and merge it into every locales/<lang>.po (translations kept, vanished ones marked obsolete); --locale <lang> starts a new language |
| `vestra-plugin i18n check` | coverage per language, placeholder and plural problems, a stale messages.pot, and texts that cannot be translated (composed in TypeScript, not literals, not English, Slint text without @tr) as warnings; fails (exit 1) on a stale messages.pot, a .po missing messages, an unreadable file |

<!-- /generated -->

Exit codes: 0 on success, 1 when a command failed for any of the directories (each one is still tried), 2 for an unknown command.

## Rules every command applies

- **The manifest first.** Every command checks `manifest.json` against the player's own rules ([Manifest](manifest.md)) before anything else. `check` also prints hints that do not fail, such as an id without the `<owner>.` prefix the official repository needs.
- **Type checking** extends the nearest `tsconfig.json` at or above the plugin directory, else built-in strict settings. Only the plugin's own files and `tests/` are checked, with the SDK's own TypeScript 5.x.
- **Capabilities.** `check` reports every use of a member whose capability `manifest.json` does not declare and fails; a call it cannot read is listed as `unchecked: …` and does not fail ([Capabilities](capabilities.md#catching-a-missing-capability)). `check --json` prints one JSON array with an entry per plugin directory: `directory`, `plugin`, `findings` (`file`, `line`, `column`, `start`, `length`, `api`, `capability`, `method`, `message`, `requiredBy`), `unchecked` (`file`, `line`, `column`, `start`, `length`, `api`, `message`) and `error` when the directory failed.
- **`import type` only.** A plugin never imports SDK code at run time; `build` fails when the output still refers to `@vestra-player/sdk`. Tests import `@vestra-player/sdk/testing` freely.
- **Translations.** With a `locales/` folder, `check` prints the `i18n check` problems as warnings and `build` compiles each `locales/<lang>.po` to `dist/locales/<lang>.json` ([Add settings and translations](../guides/i18n.md)).

## What build puts into dist/

- `.ts` files with the types stripped and relative imports changed to `.js`; `dist/manifest.json` with `entry` changed to `.js` and `version` written (from `--version`, the manifest or `package.json`).
- `.slint` and `.mjs` files, data files and `licenses/` as they are; the manifest's `icon`, `readme` and `changelog`, and `README.md` and `CHANGELOG.md` when present.
- Left out: `tests/`, `node_modules/`, `vendor/`, other `*.md`, `tsconfig*.json`, `package*.json`, `.po` and `.pot` files. Do not commit `dist/`.

`pack` runs `build` and writes `dist/` as `<id>-<version>.vxp` (a zip) to `--out`, printing its size and SHA-256. The same input gives the same bytes.

## The vestra field of package.json

A plugin with npm dependencies says how to package them in its own `package.json`:

```json
{
  "vestra": {
    "bundle": { "external": ["some-native-module"] },
    "assets": ["vendor"]
  }
}
```

- `"bundle": true` or `{ "external": [...] }` bundles the entry and its dependencies into one file with the plugin's own `esbuild` (a devDependency). **A plugin with runtime dependencies must bundle**: the package has no `node_modules`.
- `"assets": [...]` copies extra files or directories into the package as they are.
