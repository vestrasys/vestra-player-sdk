---
title: Publish a plugin
description: Submit a plugin to the official plugin repository by pull request, update or withdraw it, ask for a version to be revoked, and see what users see in the store.
---

# Publish a plugin

**Goal:** your plugin appears in the player's plugin store, where users install, update and uninstall it.

The store reads the official plugin repository, [vestrasys/vestra-player-plugins](https://github.com/vestrasys/vestra-player-plugins). Every change to it is a pull request to its `main` branch, and **a merge is a release**: there are no beta channels, and CI and revocation are the safety net. Every plugin in it is a third-party plugin; only the plugins built into the player are official. The repository's README ([Submit it to the store](https://github.com/vestrasys/vestra-player-plugins#submit-it-to-the-store)) and its [CONTRIBUTING](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md) checklist hold the full rules; this page is the author's path through them. To publish without the official repository, [host your own plugin store](own-store.md): users add its address, and its plugins come with an Unofficial mark.

Today a plugin gets into the store through a pull request that adds its source to the repository's `plugins/<name>/` (a **hosted** plugin). A maintainer has to agree to host a new plugin; the pull request is where that happens, so open an issue first if you want an answer before you write the plugin.

> [!NOTE]
> Registering a plugin whose source stays in your own repository is planned and not available yet. The repository's [MAINTAINING.md](https://github.com/vestrasys/vestra-player-plugins/blob/main/MAINTAINING.md#registered-third-party-plugins-planned) describes the planned format and flow.

## Steps

### Prepare the package

From the plugin folder:

```sh
npx vestra-plugin check   # the manifest and a strict type check
npx vestra-plugin test    # tests/*.test.ts, see Test a plugin
npx vestra-plugin pack    # dist/ and <id>-<version>.vxp
```

`build` writes `dist/`: the code with types stripped, the Slint and data files, the compiled translations and `dist/manifest.json` with the version. `pack` packs `dist/` into `<id>-<version>.vxp`. Install the `.vxp` in the player to try what users will get.

Next to `manifest.json` the store needs:

- the display fields in the manifest: `name`, `author`, `punchline`, `description`, `tags`, `license`, `sourceUrl`, optionally `icon`, and `minPlayerVersion`, the player you tested with ([Manifest](../reference/manifest.md) has the rules);
- `README.md` (what the plugin does, how to use it, what it needs, its limits) and `CHANGELOG.md`, at most 256 KiB each: the store shows both;
- tests under `tests/` that pass ([Test a plugin](testing.md));
- only the [capabilities](../reference/capabilities.md) the plugin uses: the store lists them on the plugin's page.

### Choose the id

The id is `<owner>.<name>`, where `<owner>` is the GitHub user or organization that maintains the plugin (you), recorded in the repository's `plugins/owners.toml`, and `<name>` is the plugin's folder name: `plugins/cool-visualizer/` owned by `someone` is `someone.cool-visualizer`. The owner is compared without case. Letters, digits, `.`, `-` and `_` only.

- `vestra` is reserved for the player's built-in plugins: neither the id nor the owner may use it.
- An id is unique in the repository, also with different case.
- A changed id is a new plugin to the store: the old id's version history is not carried over.

### Add the plugin to the repository

Fork the plugin repository and put your plugin folder in `plugins/<name>/`: `manifest.json`, the sources (`.ts`, `.slint`), `tests/`, `README.md` and `CHANGELOG.md`. Leave out `tsconfig*.json`, `node_modules` and `package.json`: the repository root provides the SDK, TypeScript and esbuild (a plugin that bundles npm packages follows CONTRIBUTING's rules for them). Add the line `<name> = "<owner>"` to `plugins/owners.toml`.

Then run the repository's checks from its root (Node.js 26 or later): `npm ci`, then the one command in CONTRIBUTING's [Run the checks](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md#run-the-checks). `npm run plugin -- check <name>` (and `test`, `build`, `pack`) checks one plugin at a time.

### Open the pull request

Title it `Add someone.cool-visualizer` and fill in the checklist of the pull request template ([Open the pull request](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md#open-the-pull-request)). On the pull request:

- **CI** runs the same checks on macOS, Windows and Linux: the id and the owner, the type check, the tests and the package, and the publish flow without publishing. It must pass.
- **Review:** a maintainer reads the source and merges, or answers in the pull request.

After the merge, the repository's publish workflow packs the plugin, releases it as `<id>-v<version>`, adds it to the signed index and deploys it; the store shows the plugin at its next refresh.

## Complete example

Publishing `someone.cool-visualizer`: check, test and pack in the plugin folder, copy it to `plugins/cool-visualizer/` in a fork of the plugin repository, add its owner, run the checks and open the pull request "Add someone.cool-visualizer".

```sh
npx vestra-plugin check && npx vestra-plugin test && npx vestra-plugin pack
```

```text
# plugins/owners.toml (the added line)
cool-visualizer = "someone"
```

## Update, withdraw, revoke

- **Update:** bump `version` in the manifest, add a `CHANGELOG.md` entry, and open a pull request titled `Update <id> to <version>` (CONTRIBUTING's [Update your plugin](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md#update-your-plugin)). A version is published once and never rebuilt: a change without a new version does not reach users, and a version is never reused or lowered.
- **Withdraw:** ask a maintainer to retire the plugin. Its folder is removed from `plugins/` and it drops out of the next index, so the store no longer offers it or checks it for updates; copies already installed stay installed (revocations still reach them), and the released packages stay downloadable.
- **Revoke:** for a version that is broken or harmful, the owner asks a maintainer for an entry in the repository's `revoked.json`: the plugin id, the versions (`1.2.0`, or a range such as `>=1.0.0 <1.2.0`) and a reason of up to 500 characters, shown to users. Entries are never removed or edited once merged, so fix a mistake with a new version. The store disables an installed version that matches, tells the user why, and offers the fixed version when there is one; a user who enables it again is asked to confirm the risk first.

## What users see in the store

The store shows the newest version's manifest fields, so what you write there is the plugin's page:

- **The list**: name and version, author and repository, the punchline. Search covers the name, id, author, punchline and tags; the list can be filtered by tag and sorted by name or by the date of the newest version. There are no download counts.
- **The plugin's page**: the icon, name, author, punchline and the buttons (install, update, uninstall). Three tabs show the README, the changelog and the version history (version, release date, `minPlayerVersion`, and whether the version is current, incompatible or revoked). The player keeps no previous version, and the Versions tab never installs a version older than the one installed from the same repository; to go back, a user uninstalls the plugin, then installs the older version from the Versions tab while the index still lists it, or its `.vxp`. A side column shows the version, the date, the license, a link to `sourceUrl` and the capabilities in plain words, the risky ones highlighted (the wording is the "Shown in the store as" column of [Capabilities](../reference/capabilities.md)), with a fixed note that capabilities limit only the player API, not file or network access.
- **Before installing**, the user confirms a dialog that lists the capabilities; an update that adds capabilities lists the new ones. A plugin whose every version needs a newer player shows "needs Vestra Player x.y.z or later" instead of an install button.
- **The README** is rendered as Markdown; relative links and images resolve against the README's own address, and remote images are shown for the official repository.

## See also

- [Host your own plugin store](own-store.md): publish from your own `index.json` instead, without review; users add it as an unofficial repository.
- [Manifest](../reference/manifest.md): the display fields and `minPlayerVersion`.
- [Capabilities](../reference/capabilities.md): the wording the store shows for each capability.
- [Test a plugin](testing.md) and [Command line](../reference/cli.md).
- The plugin repository's [README](https://github.com/vestrasys/vestra-player-plugins#submit-it-to-the-store), [CONTRIBUTING](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md) (the author's checklist) and [MAINTAINING](https://github.com/vestrasys/vestra-player-plugins/blob/main/MAINTAINING.md) (how the repository works inside).
