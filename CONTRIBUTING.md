# Maintaining @vestra-player/sdk

## Build and test

```sh
npm ci              # install; `prepare` builds dist/
npm run check       # type check src/ and test/
npm run format:check
npm run build       # rebuild dist/ (compiled .js + .d.ts; comments are kept for editors)
npm test            # unit tests (run against src/)
npm run docs        # API documentation site in docs-site/ (TypeDoc)
npm pack --dry-run  # package contents: README.md, LICENSE, package.json, bin/, dist/, slint/
```

The package publishes compiled `.js` and `.d.ts` files, not `.ts` sources: Node does not strip types inside `node_modules`, and bundlers, older TypeScript versions and editors read `.js` + `.d.ts` directly.

## API documentation

- The reference is generated from the TSDoc comments in `src/` by TypeDoc (pinned in `devDependencies`, configured in `typedoc.json`). Entry points are the public entries `.` (`src/index.ts`) and `./testing` (`src/plugin/testing.ts`). `./runtime` and wire-level modules are internal and not documented.
- `docs/getting-started.md` is the guide page; `README.md` is the site's front page.
- `npm run docs` treats warnings as errors: every exported declaration and member must be documented, `{@link}` targets must resolve, and an internal type referenced by the public API must be listed in `intentionallyNotExported`. Mark members that only exist for the player with `@internal`.
- The output directory `docs-site/` is ignored by git and not part of the npm package.

### GitHub Pages

`.github/workflows/docs.yml` builds the site and deploys it to <https://vestrasys.github.io/vestra-player-sdk/> on every push to `main`, on every `v*` tag, and on manual runs.

One-time setup: in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. Without that, the deploy step fails.

GitHub Pages is not available for private repositories on the GitHub Free plan for organizations. If the deploy job fails with a Pages error while the repository is private, either make the repository public or upgrade the organization's plan (Team or Enterprise); the build job is unaffected.

## Releasing

1. Change `version` in `package.json` (and `package-lock.json`, e.g. with `npm version <x.y.z> --no-git-tag-version`), commit.
2. Tag `v<version>` (annotated) and push the commit and the tag.
3. `publish.yml` checks the tag against `package.json`, runs the checks and tests and runs `npm publish --access public`. It needs the secret `NPM_TOKEN` in the `vestra` environment and fails without it. `docs.yml` republishes the documentation for the tag.
4. The player then updates its dependency (`npm install @vestra-player/sdk@<version>`) and runs its full checks.

`1.x` corresponds to plugin `apiVersion` `vestra/1`: minor versions add backwards-compatible API only, a breaking change needs a new `apiVersion` and a new major version. `./runtime` is used only by the player, which pins an exact version.

## Kept in sync with the player

- **Slint widget copy.** `slint/palette.slint`, `slint/vestra/theme.slint` and `slint/vestra/widgets.slint` are read-only copies of the player's `@vestra/` library (`src/host/ui/palette.slint` and `src/host/ui/vestra/` in the `vestra-player` repository), used only to compile and preview plugin user interfaces in an editor. The player is the source: when it changes the library, copy the same files here and release. The player's consistency test checks that the installed SDK copy is byte-identical to its own.
- The capability table and `API_VERSION` (`src/capabilities.ts`) and the command limits (`src/commands.ts`, `COMMAND_LIMITS`) must match the player; its tests check that too.
