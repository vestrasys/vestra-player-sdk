# Contributing to the Vestra Player SDK

Thank you for helping. Bug reports, documentation fixes, new or better examples and sharper types are all welcome. This page is for contributors; the maintainers' handbook (releases, CI, GitHub Pages) is [docs/maintaining.md](https://github.com/vestrasys/vestra-player-sdk/blob/main/docs/maintaining.md).

## Questions and bug reports

- Open an [issue](https://github.com/vestrasys/vestra-player-sdk/issues/new/choose) and pick a template. Search the existing issues first.
- A bug report needs the SDK version, the Vestra Player version, your operating system and the smallest plugin or test that shows the problem. A failing test against `TestHost` is the best report there is.
- Describe what you observed (the error, its `code`, the output) rather than what you think the cause is.
- Security problems: do not open a public issue; use [private vulnerability reporting](https://github.com/vestrasys/vestra-player-sdk/security/advisories/new).

## Changes to the public API: discuss first

The SDK describes the plugin API `vestra/1`, which the player implements. A new or changed type, method, capability or error code needs a matching change in the player, so **open an issue with the "API proposal" template before you write code**. Pull requests that change the public API without an agreed proposal will be closed.

Documentation, examples, tests, the test host's fidelity and the `vestra-plugin` tool can be changed directly.

## Development

You need Node.js 26 or newer.

```sh
npm ci                 # install and build dist/
npm run check          # type check src/ and test/
npm run lint           # oxlint
npm run format:check   # Prettier (npm run format fixes it)
npm test               # unit tests
npm run docs           # documentation site in docs-site/ (warnings are errors)
npm run docs:check     # the code blocks in the documents compile
npm run examples       # every example in examples/: check, test, pack
```

The Slint files in `slint/` are read-only copies of the player's widget library. Do not edit them here; propose the change in the player instead.

## Pull requests

- One pull request, one change. Keep unrelated formatting and refactoring out of it.
- Write the title as a short imperative sentence, optionally with a scope: `testing: report dropped frames`.
- A behaviour change comes with tests. A change to anything exported comes with its TSDoc comment (summary, parameters, errors) and an entry under "Unreleased" in [CHANGELOG.md](CHANGELOG.md).
- New documentation pages and examples follow the layout in [docs/maintaining.md](https://github.com/vestrasys/vestra-player-sdk/blob/main/docs/maintaining.md#examples). Code shown in the documentation must compile: take it from an example with `{@includeCode}` or keep it in a checked ` ```ts ` block.
- All checks must pass; `ci-ok` is the required status. Pull requests are squash-merged.
- Write in English: code, comments, documentation, commit messages.

## AI-assisted contributions

You may use AI tools. You are responsible for every line you submit: you must understand it, have run it, and be able to explain it in review. Unreviewed generated code, tests that do not test anything and invented API facts will be closed.

## Code of conduct

Be kind, assume good intent and keep discussions about the work. This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Report unacceptable behaviour privately to a maintainer.

## License

By contributing you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), the license of this project (inbound = outbound). No separate agreement is needed.
