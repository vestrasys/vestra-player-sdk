# Maintaining @vestra-player/sdk

## Build and test

```sh
npm ci              # install; `prepare` builds dist/
npm run check       # type check src/ and test/
npm run format:check
npm run lint        # oxlint (.oxlintrc.json)
npm run build       # rebuild dist/ (compiled .js + .d.ts; comments are kept for editors)
npm test            # unit tests (run against src/)
npm run docs        # API documentation site in docs-site/ (TypeDoc)
npm pack --dry-run  # package contents: README.md, CHANGELOG.md, LICENSE, package.json, bin/, dist/, slint/
npm pack && npm run pack:check -- vestra-player-sdk-<version>.tgz   # allow list, exports, bin
npm run pack:smoke -- vestra-player-sdk-<version>.tgz               # install into a fresh project, tsc + vestra-plugin check/test
```

The package publishes compiled `.js` and `.d.ts` files, not `.ts` sources: Node does not strip types inside `node_modules`, and bundlers, older TypeScript versions and editors read `.js` + `.d.ts` directly.

## API documentation

- The reference is generated from the TSDoc comments in `src/` by TypeDoc (pinned in `devDependencies`, configured in `typedoc.json`). Entry points are the public entries `.` (`src/index.ts`) and `./testing` (`src/plugin/testing.ts`). `./runtime` and wire-level modules are internal and not documented.
- `docs/getting-started.md` is the guide page; `README.md` is the site's front page.
- `npm run docs` treats warnings as errors: every exported declaration and member must be documented, `{@link}` targets must resolve, and an internal type referenced by the public API must be listed in `intentionallyNotExported`. Mark members that only exist for the player with `@internal`.
- The output directory `docs-site/` is ignored by git and not part of the npm package.

### GitHub Pages

`.github/workflows/main.yml` deploys the site to <https://vestrasys.github.io/vestra-player-sdk/> after every push to `main` whose checks pass. Tags do not deploy: the `github-pages` environment only allows `main`.

One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

## CI

The entry workflows only orchestrate; every check is written once in a reusable workflow (`_*.yml`) and runs the same way for branches, `main` and releases.

| Workflow | Trigger | Runs |
| --- | --- | --- |
| `ci.yml` | push to any branch except `main`, pull request, manual | checks, `ci-ok` |
| `main.yml` | push to `main`, manual | checks, Pages deploy, `ci-ok` |
| `release.yml` | tag `v*` | tag check, checks without npm cache, `npm publish` |

```
ci.yml / main.yml
  static ─────▶ build ─────┬─▶ test   ubuntu × node 22.18, 24 · windows × 24 · macos × 24
  _static.yml   _build.yml │   _test.yml (uses the dist artifact)
                           └─▶ docs   _docs.yml ──▶ deploy-docs (main.yml only, needs test)
  ci-ok   needs all; fails if any needed job failed or was cancelled

release.yml (tag v*)
  verify ─▶ static ─▶ build ─┬─▶ test ─┬─▶ publish  [environment vestra, id-token: write]
                             └─▶ docs ─┘
```

- `_static.yml`: `tsc` (src + test), Prettier, oxlint, typos; actionlint and zizmor on `.github/`.
- `_build.yml`: `npm run build`, `npm pack`, the tarball's allow list (`scripts/check-pack.mjs`), publint, `attw --profile esm-only` (the package is ESM only, Node >= 22.18), the install smoke test (`scripts/smoke-pack.mjs`). Uploads `dist` and `package` (the .tgz a release publishes unchanged).
- `_test.yml`: `npm test` on the matrix above.
- `_docs.yml`: TypeDoc with warnings as errors; on `main` also the Pages artifact.
- Make **`ci-ok`** the only required status check for `main` (branch protection or a ruleset).
- Hardening: `permissions: {}` at the top of every workflow, the minimum per job; actions pinned by commit SHA with the version in a comment (Dependabot, `.github/dependabot.yml`, keeps them current); checkouts without persisted credentials; `npm ci --ignore-scripts`; concurrency per branch (`ci.yml` cancels superseded runs, `main.yml` and `release.yml` queue); timeouts on every job. `.github/zizmor.yml` disables only zizmor's `self-repository` hint, because actionlint does not accept `uses: $/...` yet.

## Releasing

1. Change `version` in `package.json` (and `package-lock.json`, e.g. with `npm version <x.y.z> --no-git-tag-version`), add the CHANGELOG entry, commit, push `main` and wait for `main.yml` to pass.
2. Tag `v<version>` (annotated) and push the tag.
3. `release.yml` checks that the tag equals `v` + `package.json` version and that the version is not on npm yet, runs every check again on the tagged commit (no npm cache), then the `publish` job (environment `vestra`) publishes the tarball the build job packed and smoke-tested, with `npm publish <tgz> --provenance`.
4. The player then updates its dependency (`npm install @vestra-player/sdk@<version>`) and runs its full checks.

### npm Trusted Publishing

The `publish` job has `id-token: write` and runs npm >= 11.5.1 (bundled with Node 24), so npm publishes through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored token) as soon as it is configured, and falls back to the `NPM_TOKEN` secret of the `vestra` environment until then. Provenance is attached either way.

To switch to trusted publishing (npm account with publish rights on `@vestra-player/sdk`):

1. <https://www.npmjs.com/package/@vestra-player/sdk/access> → **Trusted Publisher** → **GitHub Actions**.
2. Organization or user: `vestrasys`; Repository: `vestra-player-sdk`; Workflow filename: `release.yml`; Environment name: `vestra`. Save.
3. Release once with the token still present and check that the version page on npm shows the provenance badge and the release run log shows no token use.
4. Then on the same page under **Publishing access**, choose **Require two-factor authentication and disallow tokens**, revoke the npm token, and delete the `NPM_TOKEN` secret from the `vestra` environment.

`1.x` corresponds to plugin `apiVersion` `vestra/1`: minor versions add backwards-compatible API only, a breaking change needs a new `apiVersion` and a new major version. `./runtime` is used only by the player, which pins an exact version.

## Kept in sync with the player

- **Slint widget copy.** `slint/palette.slint`, `slint/vestra/theme.slint`, `slint/vestra/widgets.slint` and `slint/vestra/markdown.slint` are read-only copies of the player's `@vestra/` library (`src/host/ui/palette.slint` and `src/host/ui/vestra/` in the `vestra-player` repository), used only to compile and preview plugin user interfaces in an editor. The player is the source: when it changes the library, copy the same files here and release. The player's consistency test checks that the installed SDK copy is byte-identical to its own.
- The capability table and `API_VERSION` (`src/capabilities.ts`) and the command limits (`src/commands.ts`, `COMMAND_LIMITS`) must match the player; its tests check that too.
