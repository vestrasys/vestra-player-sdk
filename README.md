# @vestra-player/sdk

Types, an in-memory test host and the `vestra-plugin` command line tool for writing [Vestra Player](https://github.com/vestrasys) plugins (plugin API `vestra/1`).

**API documentation: <https://vestrasys.github.io/vestra-player-sdk/>**

## Install

```sh
npm i -D @vestra-player/sdk
```

Requires Node.js 22.18 or newer. The package brings its own TypeScript 5.x for `vestra-plugin`.

## A minimal plugin

`manifest.json`:

```json
{ "id": "me.hello", "version": "0.1.0", "apiVersion": "vestra/1", "entry": "main.ts", "capabilities": ["commands", "ui.osd"] }
```

`main.ts`:

```ts
import type { Plugin } from "@vestra-player/sdk";

export default async function activate(plugin: Plugin) {
  plugin.commands.add({ id: "hello", path: ["Tools", "Hello"], run: () => plugin.osd.show("Hello") });
}
```

Plugins import the SDK with `import type` only: the player passes the `plugin` object to `activate`, and a built plugin contains no SDK code. Tests use `@vestra-player/sdk/testing` (`startPlugin`, `TestHost`). The [Getting started](https://vestrasys.github.io/vestra-player-sdk/documents/Getting_started.html) guide covers the manifest, windows, tests and packaging.

## Command line

```text
vestra-plugin check [plugin-dir...]                              strict type check (including tests/)
vestra-plugin test  [plugin-dir...]                              node --test tests/*.test.{ts,mjs}
vestra-plugin build [plugin-dir...] [--version x.y.z]            write dist/ (types stripped, manifest versioned)
vestra-plugin pack  [plugin-dir...] [--version x.y.z] [--out d]  build, then zip dist/ as <id>-<version>.zip
```

## Entry points

| Import | Contents | For |
| --- | --- | --- |
| `@vestra-player/sdk` | The plugin API types (`Plugin`, `Scope`, `Player`, …) | plugins, with `import type` |
| `@vestra-player/sdk/testing` | `startPlugin`, `TestHost`, `HostError`, `COMMAND_LIMITS` | plugin tests |
| `@vestra-player/sdk/runtime` | The plugin runner's implementation | the player only; not covered by semver |

## Versions

| SDK | Plugin `apiVersion` |
| --- | --- |
| `1.x` | `vestra/1` |

Minor releases only add backwards-compatible API. A breaking change to the plugin API gets a new `apiVersion` and a new major version.

## License

[Apache-2.0](LICENSE).

## Maintainers

Building, testing, releasing and keeping the Slint copy in sync with the player: [CONTRIBUTING.md](https://github.com/vestrasys/vestra-player-sdk/blob/main/CONTRIBUTING.md).

The documentation site is built by `npm run docs` (TypeDoc) and deployed by `.github/workflows/docs.yml` on pushes to `main` and on `v*` tags. One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. GitHub Pages is not available for private repositories on the free organization plan: if the deploy job fails while the repository is private, make the repository public or upgrade the plan.
