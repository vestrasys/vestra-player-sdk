---
title: Host your own plugin store
description: Publish your plugins from a store of your own, an index.json on any https host such as GitHub Pages, that users add to the player's store as an unofficial repository.
---

# Host your own plugin store

**Goal:** users add your store's address to the player and install and update your plugins from it, without the official plugin repository.

A store is any **https address that serves an `index.json`**: the list of your plugins and their versions, each pointing at a `.vxp` package with its size and sha256. GitHub Pages works, and so does any other https host. The player's store reads it like the official repository's index, with two differences: only the official index is signed (a store of your own is not, and cannot be), and every plugin from it is marked **Unofficial** and installed only after a warning. To have your plugin reviewed and listed in the official repository instead, see [Publish a plugin](publish.md).

## Steps

### Choose ids

Use the id rule of the official repository, so that your plugin can move there later without a new id: `<owner>.<name>`, where `<owner>` is your GitHub user or organization, with letters, digits, `.`, `-` and `_`. `vestra.` is reserved for the player's built-in plugins: the store refuses such an id from any repository or package. Nothing else checks the owner in your own store, and two stores may list the same id: the store asks before replacing a plugin installed from somewhere else.

### Write the index

`index.json` has `schema: 1`, a `name` (the store shows it with your host: `Someone's plugins (someone.github.io)`) and the `plugins`. A plugin's display fields come from its manifest; `versions` lists each version with its package:

- `version`, `apiVersion` (`vestra/1`), `minPlayerVersion` (or `null`) and `capabilities`, copied from the version's `manifest.json`. The store refuses a downloaded package whose id, version or capabilities differ from the entry.
- `downloadUrl` (https), `sha256` (lowercase hex) and `size` (bytes, at most 64 MiB) of the `.vxp`; the store installs it only when both match.
- `published`: a date (ISO 8601). The store sorts `versions` itself, newest first.
- `iconUrl`, `readmeUrl`, `changelogUrl`, each with its `…Sha256` and `…Size`, or all three `null`. Icon PNG or JPEG, at most 512 KiB; README and changelog at most 256 KiB. Keep them on the same host as `index.json`: from an unofficial store the store loads no icon from another host, and loads a README there only when the user asks.
- Optional: `author`, `punchline`, `description`, `tags`, `license`, `sourceUrl`, `translations` (the display fields per language, as in the [official index](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md#indexjson)) and `revoked`: versions the store disables on users' machines, with a reason. Only your store can revoke what was installed from it.

The store ignores unknown keys and drops an entry it cannot use (a bad version, a missing digest) on its own. It reads at most 4 MiB of index, 2,000 plugins and 200 versions each. `official: true` in your index changes nothing: only the address built into the player is official.

### Build it with GitHub Actions and Pages

The official repository's publishing is tied to its signing key, so it is not a template. A small script is enough: keep each plugin in `plugins/<name>/`, let `vestra-plugin pack` build the packages into the Pages folder, and write the index next to them (the [complete example](#complete-example)). In the repository's settings, set **Pages ▸ Source** to **GitHub Actions**; the repository must be public. Each push to `main` then tests and packs every plugin and publishes `https://<owner>.github.io/<repo>/index.json`.

A version is published once: bump `version` in the manifest for every change, or users never see it. The script below publishes the current version of each plugin only; to keep older ones installable, add their entries (and packages) to the index from the previous run, as the official repository does with GitHub Releases.

### Test it before you share it

Build with the local address (`STORE_URL=http://localhost:8080/ node scripts/build-index.ts`), serve `site/` on this machine (`npx http-server site`, say) and add `http://localhost:8080/` as a repository. Plain http is accepted only for `localhost`, `127.0.0.1` and `[::1]`, with a note that it is a test repository on this machine, without encryption.

### Tell users how to add it

In the store, **⚙ ▸ Repositories…** (or **Options ▸ Plugins ▸ Plugin Store**) adds an address. The root of the site is enough: `https://someone.github.io/my-plugins/` becomes `…/my-plugins/index.json`. The store reads the index and asks:

> Add the unofficial repository “Someone's plugins”?
>
> Address: https://someone.github.io/my-plugins/index.json
>
> Its plugins are not reviewed by Vestra Player and may read your files or use the network. The store shows this repository's plugins but does not judge for you whether they can be trusted.

A user can add up to 16 repositories besides the official one. Your plugins are then listed with "Unofficial: Someone's plugins (someone.github.io)", and their page says "Unofficial repository: not reviewed by Vestra Player; plugins may read your files or use the network". Installing asks "Install “Cool Visualizer” 1.0.0 from an unofficial repository?", with "Repository: Someone's plugins (someone.github.io). This repository is not reviewed by Vestra Player; its plugins may read your files or use the network. Only install plugins from authors you trust." above the list of permissions. Remote images in your README stay hidden until the user clicks Show Images.

The store offers updates of a plugin only from the repository it was installed from. It reads your index again when the store opens (if its copy is older than 10 minutes) and at its automatic check, 30 seconds after the player starts and then every 24 hours; it never installs on its own.

## Complete example

A repository `someone/my-plugins` with `package.json` (`"type": "module"`, `@vestra-player/sdk` in `devDependencies`), `plugins/<name>/` per plugin (manifest, sources, `tests/`, `README.md`, `CHANGELOG.md`) and two files. `scripts/build-index.ts` packs the plugins into `site/` and writes `site/index.json`:

```ts
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

// The Pages address (a local one to test: STORE_URL=http://localhost:8080/).
const BASE = process.env.STORE_URL ?? "https://someone.github.io/my-plugins/";
const site = "site";
const digest = (path: string) => {
  const bytes = readFileSync(path);
  return { sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length };
};
const plugins = [];
for (const name of readdirSync("plugins").sort()) {
  const dir = join("plugins", name);
  // dist/ and <id>-<version>.vxp; on Windows npx needs a shell
  execFileSync("npx", ["vestra-plugin", "pack", dir, "--out", join(site, "packages")], {
    stdio: "inherit",
    shell: process.platform === "win32",
  });
  const manifest = JSON.parse(readFileSync(join(dir, "dist", "manifest.json"), "utf8"));
  const file = `${manifest.id}-${manifest.version}.vxp`;
  const assets: Record<string, string | number | null> = {};
  const shown: [string, string | undefined][] = [
    ["readme", "README.md"],
    ["changelog", "CHANGELOG.md"],
    ["icon", manifest.icon],
  ];
  for (const [field, source] of shown) {
    const from = source && join(dir, source);
    if (!from || !existsSync(from)) {
      Object.assign(assets, { [`${field}Url`]: null, [`${field}Sha256`]: null, [`${field}Size`]: null });
      continue;
    }
    const published = `assets/${manifest.id}/${field}${extname(from)}`;
    mkdirSync(join(site, "assets", manifest.id), { recursive: true });
    copyFileSync(from, join(site, published));
    const { sha256, size } = digest(from);
    Object.assign(assets, { [`${field}Url`]: BASE + published, [`${field}Sha256`]: sha256, [`${field}Size`]: size });
  }
  plugins.push({
    id: manifest.id,
    name: manifest.name ?? manifest.id,
    author: manifest.author ?? null,
    punchline: manifest.punchline ?? null,
    description: manifest.description ?? null,
    tags: manifest.tags ?? [],
    license: manifest.license ?? null,
    sourceUrl: manifest.sourceUrl ?? null,
    ...assets,
    versions: [
      {
        version: manifest.version,
        apiVersion: manifest.apiVersion,
        minPlayerVersion: manifest.minPlayerVersion ?? null,
        capabilities: manifest.capabilities,
        downloadUrl: `${BASE}packages/${file}`,
        ...digest(join(site, "packages", file)),
        published: new Date().toISOString(),
      },
    ],
  });
}
const index = { schema: 1, name: "Someone's plugins", plugins, revoked: [] };
writeFileSync(join(site, "index.json"), `${JSON.stringify(index, null, 2)}\n`);
```

`.github/workflows/publish.yml` runs it on every push to `main` and deploys `site/` to Pages:

```yaml
name: Publish
on:
  push:
    branches: [main]
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version: "26"
      - run: npm ci
      - run: npx vestra-plugin test plugins/*
      - run: node scripts/build-index.ts
      - uses: actions/upload-pages-artifact@v5
        with:
          path: site
  deploy:
    needs: build
    runs-on: ubuntu-latest
    permissions:
      pages: write
      id-token: write
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

## See also

- [Publish a plugin](publish.md): the official repository, its review and its signed index.
- [Manifest](../reference/manifest.md): the display fields and `minPlayerVersion` the index copies.
- [Command line](../reference/cli.md): `vestra-plugin pack` and `test`.
- The official repository's [`index.json` format](https://github.com/vestrasys/vestra-player-plugins/blob/main/CONTRIBUTING.md#indexjson), the reference for the fields above.
