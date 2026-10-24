# Maintaining @vestra-player/sdk

The maintainers' handbook: building, documentation, CI, releases and keeping the SDK in sync with the player. Contributors start with [CONTRIBUTING.md](../CONTRIBUTING.md). This page is not part of the documentation site.

## Build and test

```sh
npm ci              # install; `prepare` builds dist/
npm run check       # type check src/ and test/
npm run format:check
npm run lint        # oxlint (.oxlintrc.json)
npm run build       # rebuild dist/ (compiled .js + .d.ts; comments are kept for editors)
npm test            # unit tests (run against src/)
npm run docs        # API documentation site in docs-site/ (TypeDoc)
npm run docs:check  # type check the ts code blocks in README.md, docs/ and @example comments; drift checks
npm run doc-lint    # documentation coverage report; fails when an enforced category is incomplete
npm run examples    # every examples/<name>: npm install, vestra-plugin check, test, pack (needs dist/)
npm pack --dry-run  # package contents: README.md, CHANGELOG.md, LICENSE, package.json, bin/, dist/, slint/
npm pack && npm run pack:check -- vestra-player-sdk-<version>.tgz   # allow list, exports, bin
npm run pack:smoke -- vestra-player-sdk-<version>.tgz               # install into a fresh project, tsc + vestra-plugin check/test
```

The package publishes compiled `.js` and `.d.ts` files, not `.ts` sources: Node does not strip types inside `node_modules`, and bundlers, older TypeScript versions and editors read `.js` + `.d.ts` directly.

## API documentation

- The reference is generated from the TSDoc comments in `src/` by TypeDoc (pinned in `devDependencies`, configured in `typedoc.json`). Entry points are the public entries `.` (`src/index.ts`) and `./testing` (`src/plugin/testing.ts`). `./runtime` and wire-level modules are internal and not documented.
- `README.md` is the site's front page (it must render on GitHub, npm and TypeDoc: absolute URLs for images and repository links, no `<picture>`, no GitHub alerts).
- The hand-written pages live in `docs/tutorials/`, `docs/concepts/`, `docs/how-to/` and `docs/examples/` (Diátaxis). Each folder's `index.md` comes first; `scripts/typedoc-plugin.mjs` puts every page in the navigation group of its folder (Tutorials, Concepts, How-to, Examples; the two entry points are "API"), so a new page needs only a `title` in its front matter. `docs/maintaining.md` (this page) is deliberately not on the site.
- Example walkthroughs (`docs/examples/<name>.md`) pull code from the example with `{@includeCode ../../examples/<name>/main.ts#region}` and `// #region name` / `// #endregion name` markers in the source; never paste example code into a page.
- Theme: `typedoc-github-theme`; `typedoc-plugin-mdn-links` links Node and Web types to MDN. Search covers comments and documents. `tsdoc.json` declares the custom block tags `@capability` and `@player`.
- `npm run docs` treats warnings as errors: every exported declaration and member must be documented, `{@link}` targets and relative links in documents must resolve, `{@includeCode}` regions must exist, and an internal type referenced by the public API must be listed in `intentionallyNotExported`. Mark members that only exist for the player with `@internal`.
- `npm run docs:check` (`scripts/check-docs.mjs`) extracts every ` ```ts ` block from `README.md` and `docs/**/*.md` and every ` ```ts ` block in an `@example` of `src/` and type checks them against `src/` (a block without imports gets `plugin: Plugin` and the SDK's exported types in scope, and may use `await` and `return`). Markdown blocks must compile, and so must the `@example` blocks of the categories listed in `scripts/doc-standard.mjs`; the other `@example` blocks are reported only, until the reference rewrite reaches them (`--strict` makes them fail). Mark an intentionally incomplete block ` ```ts nocheck `. It also checks for drift: the README Quick start equals `examples/hello`, and the Node.js version in the documents equals `engines.node`.
- `npm run doc-lint` (`scripts/doc-lint.mjs`) reports, per public declaration and member, a missing summary and the coverage of `@remarks`, `@example`, `@throws`, `@category`, `@since` and `@capability`, and compares the error codes in the `PluginError` table with the codes the SDK throws. That report only warns (`--strict` fails on missing summaries). The categories listed in `scripts/doc-standard.mjs` (so far `UI`) are enforced: a symbol of such a category that misses part of the standard below fails the run, and so does a declaration tagged with such a `@category` that the list does not name.
- The output directory `docs-site/` is ignored by git and not part of the npm package.
- `typedoc.json` sets `jsDocCompatibility.exampleTag: false`: the first line of an `@example` is its title and the rest is Markdown, so an example may be a `{@includeCode}` of an example file. Every `@example` therefore needs a code fence or an `{@includeCode}`; plain code without a fence renders as text.

### Reference comments

The standard every category reaches in its documentation round (the `UI` category is the model: `Windows`, `Window`, `Panels`, `Settings`, `Dialogs`, `Osd`, `Ui` in `src/plugin/types.ts`). Facts come from the code: the SDK in `src/plugin/` and, for what the player does, the player repository (`src/host/src/`), never from older documents alone.

````text
Summary: one sentence, starting with a verb for methods; it is reused in lists and search.

@remarks   What it is, when to use it and when to use something else; its life cycle;
           limits; platform differences (**macOS:** / **Windows:**). Methods: only what
           the summary and the tags below do not say. Long background goes to a concept page.
@capability  The manifest capability ("None." when there is none).
@player    The minimum player version, only when above the vestra/1 baseline.
@param     Meaning, unit, range, default. Inline option objects: one @param for
           `options`, and a summary on each field.
@returns   When it resolves and what has taken effect by then.
@throws    `code` (throws | rejects) Condition. One tag per code (or per condition);
           only codes from the PluginError table; a plain Error is "`Error` without a code".
@example   Title on the first line, then a ```ts block that compiles on its own
           (`plugin` and every SDK type are in scope) or {@includeCode ../../examples/…#region}.
@see       Related symbols and the concept page: [title](../../docs/concepts/<page>.md).
@since     The SDK version that added it (git tags; CHANGELOG).
@category  The API category (UI, Playback, …).
````

Modules and handles (`full` in `scripts/doc-standard.mjs`) carry all of it; their methods carry the summary, `@example`, `@capability`, `@since` and `@throws` (for a Promise). Data types (`data`) carry a summary, `@since`, `@category` and a summary per field with its unit and range. When a category is done, list its symbols in `scripts/doc-standard.mjs` so CI keeps it complete.

## Examples

`examples/<name>/` are complete plugins: `manifest.json` (id `examples.<name>`), `main.ts` (and further modules), `ui/*.slint`, `tests/*.test.ts`, a `package.json` (`"private": true`, `"type": "module"`, `"@vestra-player/sdk": "file:../.."`, scripts `check` / `build` / `test` / `pack`), a short `README.md` and a `screenshot.png`. `examples/tsconfig.json` holds the strict settings `vestra-plugin check` extends (the repository's own `tsconfig.json` is for `src/`). They are not part of the npm package (`files` and `scripts/check-pack.mjs`). `examples/hello` is the README Quick start, character for character.

Rules for pages that show examples (TypeDoc fails the build on its warnings):

- Link to an example folder with its absolute GitHub URL (`https://github.com/vestrasys/vestra-player-sdk/tree/main/examples/<name>`). A relative link to a directory (`../../examples/<name>/`) is not a file TypeDoc can resolve and fails `npm run docs`.
- A relative image (`../../examples/<name>/screenshot.png`) must exist, so every example commits a `screenshot.png` from the start: a placeholder until the real screenshot from the player replaces it (`npm run examples` warns when it is missing). Screenshots are about 1440 px wide (shown at 720), PNG, and are packed into the example's `.vxp` like any other package file, so keep them small.
- The README and `examples/README.md` use absolute URLs for everything except `LICENSE`, so they render on GitHub, npm and the site alike.

### GitHub Pages

`.github/workflows/main.yml` deploys the site to <https://vestrasys.github.io/vestra-player-sdk/> after every push to `main` whose checks pass. Tags do not deploy: the `github-pages` environment only allows `main`.

One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**.

## CI

The entry workflows only orchestrate; every check is written once in a reusable workflow (`_*.yml`) and runs the same way for branches, `main` and releases.

| Workflow      | Trigger                                                | Runs                                               |
| ------------- | ------------------------------------------------------ | -------------------------------------------------- |
| `ci.yml`      | push to any branch except `main`, pull request, manual | checks, `ci-ok`                                    |
| `main.yml`    | push to `main`, manual                                 | checks, Pages deploy, `ci-ok`                      |
| `release.yml` | tag `v*`                                               | tag check, checks without npm cache, `npm publish` |

```
ci.yml / main.yml
  static ─────▶ build ─────┬─▶ test   ubuntu, windows, macos × node 26 (unit tests, examples)
  _static.yml   _build.yml │   _test.yml (uses the dist artifact)
                           └─▶ docs   _docs.yml ──▶ deploy-docs (main.yml only, needs test)
  ci-ok   needs all; fails if any needed job failed or was cancelled

release.yml (tag v*)
  verify ─▶ static ─▶ build ─┬─▶ test ─┬─▶ publish  [environment vestra, id-token: write]
                             └─▶ docs ─┘
```

- `_static.yml`: `tsc` (src + test), Prettier, oxlint, typos; actionlint and zizmor on `.github/`.
- `_build.yml`: `npm run build`, `npm pack`, the tarball's allow list (`scripts/check-pack.mjs`), publint, `attw --profile esm-only` (the package is ESM only, Node >= 26), the install smoke test (`scripts/smoke-pack.mjs`). Uploads `dist` and `package` (the .tgz a release publishes unchanged).
- `_test.yml`: `npm test` on the matrix above, and an `examples` job: `npm run examples` (every example: install, check, test, pack) on the same matrix.
- `_docs.yml`: TypeDoc with warnings as errors, `docs:check` and the `doc-lint` report; on `main` also the Pages artifact.
- Make **`ci-ok`** the only required status check for `main` (branch protection or a ruleset).
- Hardening: `permissions: {}` at the top of every workflow, the minimum per job; actions pinned by commit SHA with the version in a comment (Dependabot, `.github/dependabot.yml`, keeps them current); checkouts without persisted credentials; `npm ci --ignore-scripts`; concurrency per branch (`ci.yml` cancels superseded runs, `main.yml` and `release.yml` queue); timeouts on every job. `.github/zizmor.yml` disables only zizmor's `self-repository` hint, because actionlint does not accept `uses: $/...` yet.

## Releasing

1. Change `version` in `package.json` (and `package-lock.json`, e.g. with `npm version <x.y.z> --no-git-tag-version`), add the CHANGELOG entry, commit, push `main` and wait for `main.yml` to pass.
2. Tag `v<version>` (annotated) and push the tag.
3. `release.yml` checks that the tag equals `v` + `package.json` version and that the version is not on npm yet, runs every check again on the tagged commit (no npm cache), then the `publish` job (environment `vestra`) publishes the tarball the build job packed and smoke-tested, with `npm publish <tgz> --provenance`.
4. The player then updates its dependency (`npm install @vestra-player/sdk@<version>`) and runs its full checks.

### npm Trusted Publishing

The `publish` job has `id-token: write` and runs npm >= 11.5.1 (bundled with Node 26), so npm publishes through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (OIDC, no stored token) as soon as it is configured, and falls back to the `NPM_TOKEN` secret of the `vestra` environment until then. Provenance is attached either way.

To switch to trusted publishing (npm account with publish rights on `@vestra-player/sdk`):

1. <https://www.npmjs.com/package/@vestra-player/sdk/access> → **Trusted Publisher** → **GitHub Actions**.
2. Organization or user: `vestrasys`; Repository: `vestra-player-sdk`; Workflow filename: `release.yml`; Environment name: `vestra`. Save.
3. Release once with the token still present and check that the version page on npm shows the provenance badge and the release run log shows no token use.
4. Then on the same page under **Publishing access**, choose **Require two-factor authentication and disallow tokens**, revoke the npm token, and delete the `NPM_TOKEN` secret from the `vestra` environment.

`1.x` corresponds to plugin `apiVersion` `vestra/1`: minor versions add backwards-compatible API only, a breaking change needs a new `apiVersion` and a new major version. `./runtime` is used only by the player, which pins an exact version.

## Kept in sync with the player

- **Slint widget copy.** `slint/palette.slint`, `slint/vestra/theme.slint`, `slint/vestra/widgets.slint` and `slint/vestra/markdown.slint` are read-only copies of the player's `@vestra/` library (`src/host/ui/palette.slint` and `src/host/ui/vestra/` in the `vestra-player` repository), used only to compile and preview plugin user interfaces in an editor. The player is the source: when it changes the library, copy the same files here and release. The player's consistency test checks that the installed SDK copy is byte-identical to its own.
- The capability table and `API_VERSION` (`src/capabilities.ts`) and the command limits (`src/commands.ts`, `COMMAND_LIMITS`) must match the player; its tests check that too.
