---
title: Publish a plugin
description: Submit a plugin to the official plugin repository, update or withdraw it, ask for a version to be revoked, and see what users see in the store.
---

# Publish a plugin

**Goal:** your plugin appears in the player's plugin store, where users install, update and roll it back.

The store reads the official plugin repository, [vestrasys/vestra-player-plugins](https://github.com/vestrasys/vestra-player-plugins). Every change to it is a pull request to its `main` branch, and **a merge is a release**: there are no beta channels, and CI, the user's rollback and revocation are the safety net. Every plugin in it is a third-party plugin; only the plugins built into the player are official. The repository's [README](https://github.com/vestrasys/vestra-player-plugins#contributing-a-plugin) and [CONTRIBUTING](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md) hold the full rules; this page is the author's path through them.

## Two ways in

- **Registered** (the usual way): the source stays in your own public GitHub repository, and you register it with one file in the repository's `registry/`. CI builds the package from the commit you name, as Flathub does.
- **Hosted**: the source lives in the repository's `plugins/<name>/`, and every change is a pull request there. It needs a maintainer's agreement: open an issue first.

> [!IMPORTANT]
> Building registered plugins from source is not implemented yet. The registration format, the id rule and the owner check are final and checked by CI, but a registration pull request cannot be merged until the build lands (the repository's README shows the status).

## 1. Prepare the package

From the plugin folder:

```sh
npx vestra-plugin check   # the manifest and a strict type check
npx vestra-plugin test    # tests/*.test.ts, see Test a plugin
npx vestra-plugin pack    # dist/ and <id>-<version>.vxp
```

Next to `manifest.json` the store needs:

- the display fields in the manifest: `name`, `author`, `punchline`, `description`, `tags`, `license`, `sourceUrl`, optionally `icon`, and `minPlayerVersion` when the plugin needs a newer player than the first one ([Manifest](../reference/manifest.md) has the rules and the version table);
- `README.md` (what the plugin does, how to use it, what it needs, its limits) and `CHANGELOG.md`, at most 256 KiB each: the store shows both;
- tests under `tests/` that pass ([Test a plugin](testing.md));
- only the [capabilities](../reference/capabilities.md) the plugin uses: the store lists them on the plugin's page.

## 2. Choose the id

The id is `<owner>.<name>`, where `<owner>` is the GitHub user or organization that owns the source repository (for a hosted plugin, the owner recorded in the repository's `plugins/owners.toml`), compared without case: `https://github.com/someone/cool-visualizer` publishes ids that start with `someone.`. Letters, digits, `.`, `-` and `_` only.

- `vestra.` is reserved for the player's built-in plugins.
- An id is unique in the repository, also against a hosted plugin's and also with different case.
- A changed id is a new plugin to the store: the old id's version history is not carried over.

## 3. Register the plugin

Push the plugin to your public repository (it may live in a subdirectory) and note the full 40-character id of the commit to publish; a tag such as `v1.0.0` is good practice, but the registration pins the commit. Then fork the plugin repository and add `registry/<id>.toml`:

```text
# registry/someone.cool-visualizer.toml
repository = "https://github.com/someone/cool-visualizer"
commit = "3f2a9c1d4b5e6f708192a3b4c5d6e7f8091a2b3c"
path = "."            # optional, default "."
owners = ["someone"]
```

| Key | Rule |
| --- | --- |
| file name | the plugin id plus `.toml`; equals `id` in the manifest |
| `repository` | `https://github.com/<owner>/<repo>`, no trailing `/` or `.git`; `<owner>` is the id's prefix |
| `commit` | the full 40-digit lowercase commit id to build |
| `path` | the folder that holds `manifest.json`, relative, no `..` |
| `owners` | the GitHub logins allowed to change or remove this file later; must include you |

No other keys. `npm ci && npm run registry` in the plugin repository checks the file.

A hosted plugin instead adds its folder under `plugins/` (manifest, sources, `tests/`, `README.md`, `CHANGELOG.md`) and its owner to `plugins/owners.toml`, after the maintainers agreed in the issue; `npm run plugin -- check <name>` (and `test`, `pack`) run the checks there.

## 4. Open the pull request

Title it `Add someone.cool-visualizer` (or `Update someone.cool-visualizer to 1.2.0`) and fill in the pull request checklist. On the pull request:

- **Registry owners** checks that you are in `owners` of a new registration, or already an owner of the one you change. It runs the base branch's script and never runs your code.
- **CI** validates the file and runs the publish flow without publishing; for a hosted plugin it also type checks, tests and packs the plugin on macOS, Windows and Linux.
- **Review:** a maintainer reads the source at the registered commit (for an update, the diff since the previous one) and merges, or answers in the pull request.

After the merge, the repository's publish workflow builds the package, releases it as `<id>-v<version>`, signs the index and deploys it; the store shows the plugin at its next refresh.

## Update, withdraw, revoke

- **Update:** bump `version` in the manifest, add a `CHANGELOG.md` entry, commit, and open a pull request that changes `commit` (a hosted plugin: the pull request with the change). A version is published once and never rebuilt: a change without a new version does not reach users, and a version is never reused or lowered.
- **Owners:** after the first merge only an owner listed on `main` may change or remove the registration, including the list of owners; a maintainer can step in for an abandoned one.
- **Withdraw:** an owner opens a pull request that deletes the registration file. The plugin drops out of the next index, so the store no longer offers it or checks it for updates; copies already installed stay installed (revocations still reach them), and the released packages stay downloadable.
- **Revoke:** for a version that is broken or harmful, an owner asks a maintainer for an entry in the repository's `revoked.json`: the plugin id, the versions (`1.2.0`, or a range such as `>=1.0.0 <1.2.0`) and a reason of up to 500 characters, shown to users. Entries are never removed or edited once merged, so fix a mistake with a new version. The store disables an installed version that matches, tells the user why, and offers the fixed version when there is one; a user who enables it again is asked to confirm the risk first.

## What users see in the store

The store shows the newest version's manifest fields, so what you write there is the plugin's page:

- **The list**: name and version, author and repository, the punchline. Search covers the name, id, author, punchline and tags; the list can be filtered by tag and sorted by name or by the date of the newest version. There are no download counts.
- **The plugin's page**: the icon, name, author, punchline and the buttons (install, update, roll back, uninstall). Three tabs show the README, the changelog and the version history (version, release date, `minPlayerVersion`, and whether the version is current, incompatible or revoked; an older compatible version can be installed from there). A side column shows the version, the date, the license, a link to `sourceUrl` and the capabilities in plain words, the risky ones highlighted (the wording is the "Shown in the store as" column of [Capabilities](../reference/capabilities.md)), with a fixed note that capabilities limit only the player API, not file or network access.
- **Before installing**, the user confirms a dialog that lists the capabilities; an update that adds capabilities lists the new ones. A plugin whose every version needs a newer player shows "needs Vestra Player x.y.z or later" instead of an install button.
- **The README** is rendered as Markdown; relative links and images resolve against the README's own address, and remote images are shown for the official repository.
