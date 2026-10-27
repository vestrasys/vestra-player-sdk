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
npm run docs:check  # type check the ts code blocks in README.md, docs/ and @example comments; drift, structure and generated-table checks
npm run docs:tables # rewrite the generated tables in docs/ (scripts/doc-tables.mjs)
npm run doc-lint    # documentation coverage report; fails when an enforced category is incomplete
npm run docs:llms   # regenerate llms.txt and llms-full.txt (`-- --check`: fail when they are stale)
npm run examples    # every examples/<name>: npm install, vestra-plugin check, test, pack (needs dist/)
npm pack --dry-run  # package contents: README.md, CHANGELOG.md, LICENSE, llms.txt, llms-full.txt, package.json, bin/, dist/, slint/, ts-plugin/
npm pack && npm run pack:check -- vestra-player-sdk-<version>.tgz   # allow list, exports, bin
npm run pack:smoke -- vestra-player-sdk-<version>.tgz               # install into a fresh project, tsc + vestra-plugin check/test
```

The package publishes compiled `.js` and `.d.ts` files, not `.ts` sources: Node does not strip types inside `node_modules`, and bundlers, older TypeScript versions and editors read `.js` + `.d.ts` directly.

## API documentation

- The reference is generated from the TSDoc comments in `src/` by TypeDoc (pinned in `devDependencies`, configured in `typedoc.json`). Entry points are the public entries `.` (`src/index.ts`) and `./testing` (`src/plugin/testing.ts`). `./runtime` and wire-level modules are internal and not documented.
- `README.md` is the site's front page (it must render on GitHub, npm and TypeDoc: absolute URLs for images and repository links, no `<picture>`, no GitHub alerts).
- The hand-written pages live in one folder per navigation group under `docs/` (see [Documentation structure](#documentation-structure)). `scripts/typedoc-plugin.mjs` puts every page in the group of its folder, in the order of `scripts/doc-structure.mjs`; the two entry points are "API". `docs/maintaining.md` (this page) is deliberately not on the site.
- Example walkthroughs (`docs/examples/<name>.md`) pull code from the example with `{@includeCode ../../examples/<name>/main.ts#region}` and `// #region name` / `// #endregion name` markers in the source; never paste example code into a page.
- Theme: `typedoc-github-theme`; `typedoc-plugin-mdn-links` links Node and Web types to MDN. Search covers comments and documents. `tsdoc.json` declares the custom block tags `@capability` and `@player`.
- `npm run docs` treats warnings as errors: every exported declaration and member must be documented, `{@link}` targets and relative links in documents must resolve, `{@includeCode}` regions must exist, and an internal type referenced by the public API must be listed in `intentionallyNotExported`. Mark members that only exist for the player with `@internal`.
- `npm run docs:check` (`scripts/check-docs.mjs`) extracts every ` ```ts ` block from `README.md` and `docs/**/*.md` and every ` ```ts ` block in an `@example` of `src/` and type checks them against `src/` (a block without imports gets `plugin: Plugin` and the SDK's exported types in scope, and may use `await` and `return`). Markdown blocks must compile, and so must the `@example` blocks of the categories listed in `scripts/doc-standard.mjs`; the other `@example` blocks are reported only, until the reference rewrite reaches them (`--strict` makes them fail). Mark an intentionally incomplete block ` ```ts nocheck `. It also checks for drift: the README Quick start equals `examples/hello`, and the Node.js version in the documents equals `engines.node`.
- `npm run doc-lint` (`scripts/doc-lint.mjs`) reports, per public declaration and member, a missing summary and the coverage of `@remarks`, `@example`, `@throws`, `@category`, `@since` and `@capability`, and compares the error codes in the `PluginError` table with the codes the SDK throws. That report only warns (`--strict` fails on missing summaries). The categories listed in `scripts/doc-standard.mjs` (so far `UI`) are enforced: a symbol of such a category that misses part of the standard below fails the run, and so does a declaration tagged with such a `@category` that the list does not name.
- **llms.txt and llms-full.txt** ([llmstxt.org](https://llmstxt.org)) are the reference for language models, such as Vestra Player AI writing a plugin. `scripts/llms.mjs` generates both from the sources: the declarations from an in-memory declaration emit of `src/` (`stripInternal`; doc comments reduced to the description and `@capability`, `@player`, `@param`, `@returns`, `@throws`, `@deprecated`), every page of the groups in `scripts/doc-structure.mjs` except Examples (Tutorials, Concepts, How-to, Guidelines, Reference; index pages left out), the examples' READMEs, walkthroughs and complete source from `examples/` and `docs/examples/`, and the short index (rules, manifest, capabilities, test, command line, error codes, line numbers into the full file) from `docs/tutorials/getting-started.md`, the generated tables of `docs/reference/capabilities.md` and `docs/reference/cli.md`, the `PluginError` table, `src/manifest.ts`, `src/commands.ts` and `src/capabilities.ts`. Never edit the two files by hand: change the source and run `npm run docs:llms`, then commit them. CI (`_static.yml`) runs `npm run docs:llms -- --check`; `pack:check` checks that the packed files name the package version. They are published in the package (`files`, and the exports `./llms.txt`, `./llms-full.txt`) and copied to the site's root by `scripts/typedoc-plugin.mjs`. The script fails when a source it reads changes shape: the generated capability table must list exactly `CAPABILITIES`, `examples/README.md` every example folder, and llms.txt must stay at most 9 KB (shorten the index, not the full file).
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
@example   Task title (3+ words), a lead saying what it does and how it works, then a
           ```ts block that compiles on its own (`plugin` and every SDK type are in
           scope; hidden setup above `// ---cut---`) or {@includeCode ../../examples/…#region};
           see "Examples in reference comments" below.
@see       Related symbols and the concept page: [title](../../docs/concepts/<page>.md).
@since     The SDK version that added it (git tags; CHANGELOG).
@category  The API category (UI, Playback, …).
````

Modules and handles (`full` in `scripts/doc-standard.mjs`) carry all of it; their methods carry the summary, `@example`, `@capability`, `@since` and `@throws` (for a Promise). Data types (`data`) carry a summary, `@since`, `@category` and a summary per field with its unit and range. When a category is done, list its symbols in `scripts/doc-standard.mjs` so CI keeps it complete.

### Examples in reference comments

The reference is read by people who want to get a task done and by the plugin workshop's model, which sees the examples in `llms-full.txt` and copies them. An example therefore teaches the task, not only the call.

**Which symbols have one.** Every method of a module or handle, every module entry type (a `Plugin` / `Scope` property), every `TestHost` method and `startPlugin` has its own `@example`. An option or data type (`CommandOptions`, `StreamOptions`, `PlayerState`) has one example on the type, and its fields get a summary with unit and range only. A trivial sibling (`Window.close` next to `Window.hide`) may instead point at its sibling's example with a marker (below), for at most 20 % of a declaration's methods.

**What an example contains**, in this order:

1. **A task title** on the `@example` line, at least 3 words, phrased as what the reader wants to do: `@example Pause playback from a menu item`, not `@example pause()`.
2. **A lead** of 1–3 sentences under the title, before the code, saying both:
   - **what it does**: what the user sees or what the plugin achieves;
   - **how it works**: which calls do what and in what order, and the mechanism the reader must understand to use them correctly. For example: "`run` is called when the user picks the item or presses its key; `checked` is evaluated again after every handler", "`player.state` is a snapshot the SDK keeps current from player events; `onChange` fires after it updates", "the request goes to the player process; it rejects with `stale` if the source changed meanwhile", "frames are pulled on the audio clock, so `frame()` may run several times back to back".
3. **Code that compiles on its own** (checked by `docs:check`). A block without `import`/`export` runs inside an async function with `plugin: Plugin` and every SDK type in scope (and the values of `@vestra-player/sdk/testing`); a block with imports is a module and declares what it uses. Setup the reader does not need goes above a `// ---cut---` line (the convention of TypeScript's twoslash): those lines are type checked but not shown on the site or in `llms-full.txt`. In a block without its own imports they sit at module level, so they may `import` and `declare` (`declare const host: TestHost;`); in a module block keep the imports the reader copies below the line.
4. **Comments on the key lines** (required when more than 5 lines are shown): units, why a value was chosen, which line does the step the lead names.
5. **Error handling** for promise-returning calls whose failure the user can cause (`stale`, `busy`, `capability`, `limit`, a cancelled dialog): catch the code, say what the plugin does instead.

Do not invent mechanisms: every claim in a lead is checked against the SDK in `src/` and, for what the player does, the player's `src/host/src/` before it is written.

**Reference markers.** `@example See Window.hide` with `{@link Window.hide}` on the next line (TypeDoc takes the title line literally, so the link cannot go on it) stands for the sibling's example; the sibling must have one of its own.

**Stale references.** `STALE_REFERENCES` in `scripts/doc-standard.mjs` lists ids and names examples must not use any more (removed built-ins such as `vestra.nes`, a resolver for `.nes` files the store plugin VestraNES owns). Add an entry when a release removes or hands over something examples may still name.

**Checks.** `npm run doc-lint` applies `example-lead` (title, lead, comments), `stale-refs` and the marker rules, and prints per `@category` the share of methods with an explained example. In the categories of `scripts/doc-standard.mjs` they fail the run; elsewhere they are reported (`doc-lint --list example-lead`, `--list stale-refs`). Violations that predate the rules are listed in `EXAMPLE_BASELINE` and reported as warnings; an entry that no longer fails is an error, so the list only shrinks, and the round that fixes a category removes its entries. `docs:check` type checks every block (with its hidden lines); `scripts/typedoc-plugin.mjs` and `scripts/llms.mjs` drop the hidden lines.

**Known gap:** only `UI` has reached the standard so far, so the API reference still shows most symbols of `@vestra-player/sdk` under "Other" and `@vestra-player/sdk/testing` by kind. Giving every symbol a business `@category` (Plugin, Commands, Playback, UI, Processing, Subtitles, Media, Sources, Packages, Services, Text, Testing) is a later round, one category per patch release.

## Documentation structure

The site has seven fixed groups, in this order; a new group needs a change to this section first.

| Group | Folder | Holds | Size limit per page |
| --- | --- | --- | --- |
| Tutorials | `docs/tutorials/` | Step-by-step lessons for a newcomer that can be followed to the end. | 350 lines |
| Concepts | `docs/concepts/` | What something is, why it works that way and what it relates to, across several modules; no member lists. | 350 lines, 4500 words |
| How-to | `docs/how-to/` | One page answers one "how do I do X?"; assumes Getting started. | 200 lines |
| Guidelines | `docs/guidelines/` | Normative rules (should / should not) for interface and menu consistency. They prescribe, so they are not concepts; they are not tasks either. | 200 lines |
| Examples | `docs/examples/` | Walkthroughs of the complete plugins in `examples/`. | 200 lines |
| Reference | `docs/reference/` | Lookup tables across symbols (capabilities, manifest and versions, limits, menu and binding names, platforms, theme, CLI), generated where possible. A fact about one symbol belongs in its TSDoc, not here. | 150 hand-written lines |
| API | (TypeDoc entry points) | The per-symbol reference from the TSDoc in `src/`. | — |

Every group's `index.md` comes first and is limited to 120 lines. Errors and testing have no group of their own: the error codes live in the `PluginError` table, the test helpers on `TestHost`.

Rules, all checked by `npm run docs:check`:

- **One topic per page.** Front matter has a `title` and a one-sentence `description` (what the page is for). Lines are counted without the front matter and without generated blocks; above the limit the check warns, more than 25 % above it fails.
- **Navigation depth 2** (group → page): no folders inside a group folder, no `children` front matter, and no `group` front matter (the folder decides the group).
- **The page list is a table.** `scripts/doc-structure.mjs` lists the groups and, per group, its pages in navigation order, each with `why` it is a page of its own rather than a section of an existing page (a different topic, or as a section it would push that page over its limit or blur its focus). The Markdown files under `docs/` must be exactly the listed pages (plus this page), so adding, renaming or removing a page changes the table and shows in review.
- **Index pages link only to pages that exist**, and every page is linked from its group's index (no orphans). No "coming soon" or "being written" entries: a page that is not written yet is an SDK issue, not a line on the site.
- **One fact, one place.** Constants, lists, limits and the capability table are generated from the code (below); pages link to each other instead of repeating. The README keeps a summary and links.
- `typedoc.json` must agree: `groupOrder` is the groups above followed by `API` and `*`, and `projectDocuments` includes every group folder.

**Generated tables.** A page marks a generated block with `<!-- generated:<name> [arguments] -->` and `<!-- /generated -->`; `npm run docs:tables` (`scripts/doc-tables.mjs`) replaces what is between them with the output of `scripts/doc-tables/<name>.mjs` (a module whose default export returns the block's Markdown; the script's header comment describes its arguments). Never edit a generated block by hand: change the source and run `npm run docs:tables`, then commit. `docs:check` runs `doc-tables.mjs --check` and fails when a block is stale, has no generator, or is not closed.

**Pending pages during a documentation round.** A round may list a page before it exists (`new: true`) and give each page it creates or reworks a `pending: "<package>"` mark. A pending page's violations, and a missing `new` page, are warnings instead of errors, so the parts of a round can land one by one. This only holds while `package.json` is at or below `PENDING_UNTIL` in `scripts/doc-structure.mjs`; from the next version on, every remaining `pending` or `new` mark is itself an error. The release that ends the round removes all marks, and the check is strict again; a later round that needs the allowance sets `PENDING_UNTIL` to the version it starts from.

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
- `_build.yml`: `npm run build`, `npm pack`, the tarball's allow list (`scripts/check-pack.mjs`), publint, `attw --profile esm-only` (the package is ESM only, Node >= 26; the text exports `llms.txt` and `llms-full.txt` are excluded), the install smoke test (`scripts/smoke-pack.mjs`). Uploads `dist` and `package` (the .tgz a release publishes unchanged).
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
- **Capability table.** `src/host-capabilities.ts` (`HOST_CAPABILITIES`) is a copy of the player's generated `src/host/capabilities.json` (which request needs which capability, the labels, `requires`); write it with `npm run capabilities:sync -- <player repository>` and check it with `npm run capabilities:sync -- <player repository> --check`. `src/api-requests.ts` (`API_REQUESTS`) is the SDK's half: the requests each public member sends. `CAPABILITY_INFO`, `vestra-plugin check` and the TypeScript plugin (`ts-plugin/`, `src/ts-plugin.ts`, `src/capability-check.ts`) are built from the two (`src/capability-rules.ts`). A new member that needs a capability gets a line in `API_REQUESTS`; `test/capability-check.test.ts` checks every method and parameter against the copy. The player's agreement test compares the installed SDK's `HOST_CAPABILITIES` with its JSON, so a player change to its capabilities fails there until the SDK is synced and released.
- `API_VERSION` (`src/capabilities.ts`) and the command limits (`src/commands.ts`, `COMMAND_LIMITS`) must match the player; its tests check that too.
- `THEME_PALETTES` (`src/palettes.ts`): the colours of `vestra` and `vestra-light`, copied from the player's `src/host/src/theme.rs`. `slint/palette.slint` holds only the `vestra` defaults, so the `vestra-light` values exist in the SDK only here; the unit tests check `vestra` against `palette.slint`, and the player's agreement test must check both against `theme.rs`.
