# Maintaining @vestra-player/sdk

The maintainers' handbook: building, documentation, CI, releases and keeping the SDK in sync with the player. Contributors start with [CONTRIBUTING.md](../CONTRIBUTING.md). This page is not part of the documentation site.

## Build and test

```sh
npm ci              # install; `prepare` builds dist/
npm run check       # type check src/ and test/, then the layer rule (scripts/check-layers.mjs, see Layers)
npm run format:check
npm run lint        # oxlint (.oxlintrc.json)
npm run build       # rebuild dist/ (compiled .js + .d.ts; comments are kept for editors) and dist/docs-tree.json.gz
npm test            # unit tests (run against src/)
npm run docs        # API documentation site in docs-site/ (TypeDoc)
npm run docs:check  # type check the ts code blocks in README.md, docs/ and @example comments; drift, structure and generated-table checks
npm run docs:tables # rewrite the generated tables in docs/ (scripts/doc-tables.mjs)
npm run doc-lint    # documentation coverage report; fails when an enforced category is incomplete
npm run docs:llms   # regenerate llms.txt (`-- --check`: fail when it is stale)
npm run api-surface -- --check   # dist/ declarations against test/fixtures/api-surface.txt (`--update` rewrites it; see Characterisation tests)
npm run bench       # framework benchmark, medians of 5 runs (see Characterisation tests)
npm run examples    # every examples/<name>: npm install, vestra-plugin check, test, pack (needs dist/)
npm pack --dry-run  # package contents: README.md, CHANGELOG.md, LICENSE, llms.txt, package.json, bin/, dist/ (with docs-tree.json.gz), slint/, ts-plugin/
npm pack && npm run pack:check -- vestra-player-sdk-<version>.tgz   # allow list, exports, bin
npm run pack:smoke -- vestra-player-sdk-<version>.tgz               # install into a fresh project, tsc + vestra-plugin check/test
```

The package publishes compiled `.js` and `.d.ts` files, not `.ts` sources: Node does not strip types inside `node_modules`, and bundlers, older TypeScript versions and editors read `.js` + `.d.ts` directly.

### Characterisation tests

Added before the SDK refactor (the player repository's `doc/specs/sdk-refactor.md` §4.0): a step that only moves code must leave all three unchanged; a release that changes one of them on purpose rewrites the fixture and says why in the CHANGELOG.

- **Golden wire traces** (`test/golden-traces.test.ts`, fixtures `test/fixtures/traces/<group>-<name>.json`). Each of the ten examples, and the plan's speed display in style A and style B (`test/plugins/speed-a`, `speed-b`, scenarios `styles/…`; style B must run no update pass, a test checks it), runs one fixed script against `TestHost`: start → `openElsewhere("/movie.mp4")` → `setSource` `rate` 1.5, `paused`, `position` 30 → one command (`EXAMPLES` in the test names it) → dispose. The fixture holds, per phase, the `(method, params)` sequence and the update-pass counts (`Runtime.counts`: passes, full passes, binding evaluations, view bind functions evaluated/skipped), plus every `events.subscribe` line in order (with `mirror`/`why`). Normalisation rules are listed at the top of the test (paths become `<plugin>`/`<data>`/`<tmp>`, `why` loses line numbers, `producer.state` polls are left out and listed under `polled`, `producer.ack`'s `baseSample` becomes `<samples>`, a drive root becomes `/`; image `ref` numbers are renumbered per scenario; a run in which the once-a-second safety pass fired (`counts.safetyPasses`) is repeated instead of compared). The six built-ins the plan names (playback, playlist, info, subtitles, video, workshop) run from `VESTRA_PLAYER=<player checkout>/src/plugins/<name>` and are skipped without that variable (CI has no player checkout; run them locally before a refactor release). Each built-in fixture records the player commit it came from (`playerCommit`); when `VESTRA_PLAYER`'s HEAD is another commit those tests skip with the two hashes, so a player change does not pass for an SDK regression. Use a clean player worktree checked out at that commit; `UPDATE_TRACES=1` re-records and re-pins to the current HEAD. `UPDATE_TRACES=1 npm test -- test/golden-traces.test.ts` rewrites the fixtures. Eight host scenarios in the same test (fixtures `host-<name>.json`) pin the test host's own edges a reorganisation of `src/plugin/testing/` could move: `disconnect()` with requests in flight, `commands.register` and the queued `commands.keys` push against `settle()`, `press` through a binding, `handle()`/`reset()`, a stream producer's socket and temporary directory, `startPlugin` with a `taken` conflict, the `VESTRA_PLUGIN_RESIDENCY=1` line, and a host made and never started; each records a timeline of requests, answers, refusals and events, error codes and messages, and facts about the temporary files (no paths, so the same on every platform).
- **API surface snapshot** (`scripts/api-surface.mjs`, `test/api-surface.test.ts`, fixture `test/fixtures/api-surface.txt`): every exported declaration of the public entries `.` and `./testing` (the declaration files their package.json `exports` name, `dist/index.d.ts` and `dist/plugin/testing/index.d.ts`) with each member's signature, comments dropped, sorted; re-exports are followed, so moving a type between files leaves the file unchanged. Needs `npm run build`; the test skips when `dist/` is missing.
- **Benchmark** (`scripts/bench.mjs`, `npm run bench`): (a) a 20,000-row keyed list through the diff engine alone and end to end through a window bind in `TestHost`, with 1 % and 10 % of the rows changed; (b) 1,000 full passes over 50 bound windows and 100 commands with an `enabled()` function; (c) the latency from `host.setSource({ position })` to the `ui.set` request leaving the SDK. Medians of 5 runs. The numbers decide the inventory's batch H (move planning, field-level dependencies) and show whether a step slowed anything down.

Baseline, 2026-11-08, SDK 1.6.16 sources (`fb5bfdb` plus the counters), Node v26.12.1, Windows 11 x64 (the user's development machine, see the player repository's `C:\vestra\env.ps1` notes; other machines differ, compare only against runs on the same one):

| Measurement                                                                          |   Median |
| ------------------------------------------------------------------------------------ | -------: |
| (a) diff engine, 20,000 keyed rows, 1 % changed (200 `set` ops)                      |  1.02 ms |
| (a) diff engine, 20,000 keyed rows, 10 % changed (2,000 `set` ops)                   |  0.83 ms |
| (a) end to end, initial write of 20,000 rows (`ui.open` and its parts)               |   201 ms |
| (a) end to end, 1 % changed: `update()` → pass → encode + diff → `ui.set` applied    |    75 ms |
| (a) end to end, 10 % changed: same                                                   |    75 ms |
| (b) 1,000 full passes, 50 bound windows, 100 commands with `enabled()`               |   609 ms |
| (c) `player.state` change → precise pass → `ui.set` handed to the transport          |  0.03 ms |

Reading: the diff itself is negligible; the end-to-end cost of a changed list is encoding 20,000 rows to JSON and the host applying the patch, the same for 1 % and 10 %. A full pass over 150 bound things costs about 0.6 ms.

### Layers

The SDK is built in three layers (the player repository's `doc/specs/sdk-refactor.md` §2.1): the protocol (L0: `src/wire.ts` and the per-domain clients), the primitives (L1: `src/plugin/connection.ts` with the transport, subscriptions and activation, the helpers `errors.ts` and `latest.ts`, the services such as `services/dialogs.ts`, a view's write path `view/writer.ts`, the image values `view/image.ts`, `plugin.player.on` in `player/events.ts` and the player's control rules in `player/rules.ts`) and the framework (L2: the update passes in `src/plugin/passes.ts`, `Runtime` in `runtime.ts` that adds them to the connection, the view binder `view/binder.ts`, the player's state copy in `player.ts`, `plugin.state` in `state.ts`, bindings and the other state copies). Since Step 2 (1.7.0) the framework is used only by what needs it: a view joins the passes on its first `bind()` (`view/base.ts` reserves its place in the order of evaluation when the view is made, `Passes.slot`), a command only when a state field is a function, the player's state copy subscribes at start whenever the manifest declares `events` (as before; without `events` it starts on first use and subscribes nothing), and no pass runs while nothing is bound. A chain of passes that each changed what they read (a `bind` function writing `plugin.state` it reads) stops at `MAX_CHAINED_PASSES` (100) with one `limit` report; the limit counts passes, not loops, so a legitimate chain deeper than 100 (bindings each writing a field the next reads) is cut too, and what the dropped pass would have evaluated waits for the next full pass; `player.on` listeners run through `ScopeImpl.runQuiet`, with no full pass after them. Pending: `player.provideSequence` still joins every pass even with constant flags (a follow-up). `view/writer.ts` has two modes: until the view's first `bind()` it sends `set()` values whole (limits, one write in flight, `more` parts) and keeps no row-patch base, except that an initial list cut to one request's size (`wired`, `#cut`) is completed by inserts on the rows the open carried (`#rest`, base 0) when the value, compared at send time with the rows shown, still begins with them (`track()` drops `#rest`; a `stale` answer falls back to the whole value); once bound (`track()`) it compares and plans row patches with `patch.ts` (`diff`, `keyOf`, `replay`). Patch planning stays in the writer because it needs what was sent and the player's base for each property, which are the writer's. A primitive that changed or read plugin-visible state tells the framework through the connection, never by importing it: `connection.signals` (`read`, `changed`, `invalidate`; `Runtime` installs the passes there) and `connection.rereads` (a state copy registers how to read its state again, `plugin.host.run` asks for `source.state`); `openStream` depends on its own `StreamSource` shape, which `PlayerService` fills.

`scripts/check-layers.mjs`, run by `npm run check`, fails when an L0/L1 file imports a framework file (`passes.ts`, `runtime.ts`, `view/binder.ts`, `player.ts`, `state.ts`), even as a type, loads one of them through any chain of value imports (the first framework file reached is named), calls the passes by name (rule 6: `.update()` and `.passes` on any object, `invalidate`, `depends`, `reading`, `part`, `observe`, `reader`, `needsFull` on any object but `signals`, `runtime.bind`/`runtime.changed`; a textual check that does not see destructured aliases; running plugin code with `scope.run` is allowed), when value imports under `src/` form a cycle not listed in `KNOWN_CYCLES` (today only the test host's `core-actions` → `media` → `layout`; a listed cycle that disappears fails too), or when a relative import does not name a `.ts` file under `src/` (so nothing escapes the check). Its file lists name the files as they are; a change that moves or splits one updates them. `PENDING` (edges the rules cannot see yet, printed as a note, failing once stale) is empty since 1.7.0. `view/base.ts`, `view/window.ts`, `view/panel.ts`, `view/layout.ts` and `scope.ts` compose both layers and are in neither list. The spec's second rule (`src/plugin/**` reaches the wire only through `connection.ts`) is checked once `src/wire/` exists. Rule 7 keeps the protocol in one hand: under `src/plugin/` only `wire-facade.ts` (and `connection.ts`, which defines it, and the test host) calls a `request(` method, so no other primitive sends a request by a method name it was given; they use the typed clients (`runtime.host.*`).

`plugin.wire` (Step 3, 1.7.0) is the facade `src/plugin/wire-facade.ts` (L1, in `LOWER`), not to be confused with the L0 code `src/wire.ts` (later `src/wire/`). `request` is `Connection.request`, the transport as is, with the subscriptions refused (`invalid`): `events.subscribe`/`events.unsubscribe` of a `HostEvent` (the player keeps one subscription and one mark per name, and the SDK owns those; `on` covers them) and `events.subscribe` of another event without `why` or `mirror: true` (the player's lazy-activation classification would be fooled); a marked subscription to another event is the plugin's, not counted by the SDK; `on` is `Connection.on` for a `HostEvent` (always a listener with its `why`, never a mirror) and `Connection.raw` for any other name; `view(v)` reaches the view writer's third track (`ViewWriter.direct`/`directRows`) through the `DIRECT` symbol of `view/writer.ts`, so the facade loads no view class and no binder; `commands.register` sends the plugin's own declaration through `Connection.declaring` (`strictDeclarations` applies) and shares `Connection.removals` with `commands.add`, so re-adding an id either way waits for its removal. Direct writes are sent through `#writeNow`, which keeps the generation the job started in: a failure after the view closed or showed its initial properties again becomes `unavailable`, and a write answered for an earlier generation is no base, so `writeRows` without a whole direct write since the view showed is refused with `stale` before sending (a direct property is never an initial property, the player has no rows of it). One track per property: the writer refuses `set()`/`assign()` of a property written directly and a direct write of a property it holds, with `invalid` and the message of `bothTracks`. Every member's doc comment carries `@experimental` and the sentence "the wire protocol is not semver; this member changes with versions"; `doc-lint` and `docs-tree` read a method's signature comment when its own comment holds only that modifier tag. The capability check maps the calls whose capability depends on an argument (`ARGUMENT_APIS` in `src/api-requests.ts`: `Player.on`, `Wire.on` by event name, `Wire.request` by method name and the string fields of its parameters) when the argument's type fixes the name to one string (`argumentRequests`, `checkCapabilities`), and reports the others as unchecked (a computed name, a union of several, the member destructured or taken as a value) (a CLI note, an editor warning `CAPABILITY_UNCHECKED`, never a failure). The player version of each wire method, which the message table of the documentation refactor (spec §5.1) needs, has no source in this repository: the SDK's player-version table (`manifest.md`) is by API member and lists the version a member needs or changed with, not the one a method appeared in, and the L0 clients' comments mix methods and parameters. Proposal (agreed 2026-11-08, needs a host change, carried out with the documentation task):

- **Player**: `Method` in `src/host/src/capabilities/mod.rs` gains `since: &'static str` (the player release version that first served the method, `"x.y.z"`; `"0.1.0"` for the methods of the `vestra/1` baseline), set in each capability module's method table (`Method::this`/`Method::free` take it), and the generated `src/host/capabilities.json` writes it on every method entry, after `needs`: `{ "name": "ui.setMount", "needs": "ui.mount", "since": "0.1.0" }`, in `capabilities[].methods[]` and `uncapable[]` alike (a `prefix.*` entry carries the version of its oldest method). The capabilities test (`VESTRA_UPDATE_CAPABILITIES=1 cargo test capabilities`) fails on a method without one, and `about` names the field. The values come from the player's history once, by hand, and are reviewed; from then on a new method is added with its version.
- **SDK**: `HostMethod` in `src/capability-rules.ts` gains `readonly since?: string` (optional, so a player JSON without it still syncs); `scripts/capabilities-sync.mjs` copies the JSON unchanged as today, so `HOST_CAPABILITIES` carries `since` with no change to the script; its `--check` and the player's `tests/sdk/host-agreement.test.ts` compare the field like the rest.
- **Docs**: the message-table generator (`scripts/doc-tables/messages.mjs`) reads `since` from `HOST_CAPABILITIES` for its player-version column, and the event table takes an event's version from its `events.subscribe` case the same way (a `since` per `cases` entry, same format). A method without `since` (an older player JSON) shows "vestra/1 or later, not recorded".

**TestHost and capabilities (batch D)**: `TestHost` answers every request without checking the manifest's capabilities, typed or raw (`plugin.wire.request`), where the player refuses an undeclared one with `capability`. Making it refuse, from `HOST_CAPABILITIES` and the manifest `startPlugin` read, would change what existing plugin tests see, so it is left to batch D (the rules shared by the runtime and `TestHost`), with an opt-out or a CHANGELOG line for plugins whose tests rely on it; until then `vestra-plugin check` is what catches a missing capability before the player does.

## API documentation

- The reference is generated from the TSDoc comments in `src/` by TypeDoc (pinned in `devDependencies`, configured in `typedoc.json`). Entry points are the public entries `.` (`src/index.ts`), `./testing` (`src/plugin/testing/index.ts`; the class `TestHost` delegates to the area modules beside it) and `./docs` (`src/docs.ts`, the documentation tree's reader). `./runtime` and wire-level modules are internal and not documented.
- `README.md` is the site's front page (it must render on GitHub, npm and TypeDoc: absolute URLs for images and repository links, no `<picture>`, no GitHub alerts).
- The hand-written pages live in one folder per navigation group under `docs/` (see [Documentation structure](#documentation-structure)). `scripts/typedoc-plugin.mjs` puts every page in the group of its folder, in the order of `scripts/doc-structure.mjs`; the two entry points are "API". `docs/maintaining.md` (this page) is deliberately not on the site.
- Example walkthroughs (`docs/examples/<name>.md`) pull code from the example with `{@includeCode ../../examples/<name>/main.ts#region}` and `// #region name` / `// #endregion name` markers in the source; never paste example code into a page.
- Theme: `typedoc-github-theme`; `typedoc-plugin-mdn-links` links Node and Web types to MDN. Search covers comments and documents. `tsdoc.json` declares the custom block tags `@capability` and `@player`.
- `npm run docs` treats warnings as errors: every exported declaration and member must be documented, `{@link}` targets and relative links in documents must resolve, `{@includeCode}` regions must exist, and an internal type referenced by the public API must be listed in `intentionallyNotExported`. Mark members that only exist for the player with `@internal`.
- The plugin API types live in `src/plugin/types/*.ts`, one file per `@category` (UI in four: `ui-content`, `ui-layout`, `ui-locale`, `ui-shell`), and `src/plugin/types.ts` re-exports them with `export type *`; the scripts find a declaration by name (`typeFile()` in `scripts/doc-tables/lib/source.mjs`), not by file. TypeDoc orders by file path, then position (`sort: source-order`), so add a declaration to its category's file where the reference should show it; a file split keeps the reference's order only if a category's files sort in reference order and an interface's parent (`extends`) sits in a file that sorts before the child's (hence `base.ts` for the Plugin category, which holds `Disposable`, and `snapshots.ts` after `playback.ts` for `CaptureOptions extends Conditional`). Import every `{@link}` target with `import type` (link-only names go in the block marked `oxlint-disable no-unused-vars`): without the import TypeScript resolves names such as `Window`, `Text` or `Storage` to the DOM's globals. tsc drops those imports from the declarations, so `scripts/build.mjs` copies the block into `dist/plugin/types/*.d.ts`; `test/dist-links.test.ts` checks every link there, and `test/types-layout.test.ts` the file rules above.
- `npm run docs:check` (`scripts/check-docs.mjs`) extracts every ` ```ts ` block from `README.md` and `docs/**/*.md` and every ` ```ts ` block in an `@example` of `src/` and type checks them against `src/` (a block without imports gets `plugin: Plugin` and the SDK's exported types in scope, and may use `await` and `return`). Markdown blocks must compile, and so must the `@example` blocks of the categories listed in `scripts/doc-standard.mjs`; the other `@example` blocks are reported only, until the reference rewrite reaches them (`--strict` makes them fail). Mark an intentionally incomplete block ` ```ts nocheck `. It also checks for drift: the README Quick start equals `examples/hello`, and the Node.js version in the documents equals `engines.node`.
- `npm run doc-lint` (`scripts/doc-lint.mjs`) reports, per public declaration and member, a missing summary and the coverage of `@remarks`, `@example`, `@throws`, `@category`, `@since` and `@capability`, and compares the error codes in the `PluginError` table with the codes the SDK throws. That report only warns (`--strict` fails on missing summaries). The categories listed in `scripts/doc-standard.mjs` (so far `UI`) are enforced: a symbol of such a category that misses part of the standard below fails the run, and so does a declaration tagged with such a `@category` that the list does not name.
- **The documentation tree** (`@vestra-player/sdk/docs`, `vestra-plugin docs`) is the reference for coding agents, such as Vestra Player AI writing a plugin: the site's pages and API as a tree of small nodes read by path (`/API/Media/Snapshot/dispose`, `/Guides/How-to/Test a plugin`), with search, every answer at most 8 KB. `scripts/docs-tree.mjs` builds it from the same TypeDoc conversion as the site (typedoc.json and `scripts/typedoc-plugin.mjs`, so the guides' groups and order and the removed hidden example lines are the site's) and `npm run build` writes it to `dist/docs-tree.json.gz`; `src/docs.ts` reads it. A node's one-line summary is the site's: a page's `description`, a declaration's first paragraph. `test/docs-tree.test.ts` checks that every page and every declaration the site shows is a node. There is no single file with all of it (llms-full.txt was removed in SDK 1.5.50): an agent reads what it needs.
- **llms.txt** ([llmstxt.org](https://llmstxt.org)) is the short entry for language models: what the SDK is, how to read the tree, and the tree's top levels. `scripts/llms.mjs` generates it from the tree; never edit it by hand: run `npm run docs:llms` and commit it. CI (`_static.yml`) runs `npm run docs:llms -- --check`; `pack:check` checks that it names the package version. It is in the package (`files`, the export `./llms.txt`), copied to the site's root by `scripts/typedoc-plugin.mjs`, and stays at most 10 KB, 10,240 bytes.
- The output directory `docs-site/` is ignored by git and not part of the npm package.
- `typedoc.json` sets `jsDocCompatibility.exampleTag: false`: the first line of an `@example` is its title and the rest is Markdown, so an example may be a `{@includeCode}` of an example file. Every `@example` therefore needs a code fence or an `{@includeCode}`; plain code without a fence renders as text.

### Reference comments

The standard every category reaches in its documentation round (the `UI` category is the model: `Windows`, `Window`, `Panels`, `Settings`, `Dialogs`, `Osd`, `Ui` in `src/plugin/types/`). Facts come from the code: the SDK in `src/plugin/` and, for what the player does, the player repository (`src/host/src/`), never from older documents alone.

````text
Summary: one sentence, starting with a verb for methods; it is reused in lists and search.

@remarks   What it is, when to use it and when to use something else; its life cycle;
           limits; platform differences (**macOS:** / **Windows:**). Methods: only what
           the summary and the tags below do not say. Long background goes to an explanation page.
@capability  The manifest capability ("None." when there is none).
@player    The minimum player version, only when above the vestra/1 baseline.
           Prose "player x.y.z" also counts for Reference: manifest › Player versions;
           a change in what existing API does that needs no newer player is written
           "behaviour from player x.y.z" (or "behaviour change in/since") and gets no row.
@param     Meaning, unit, range, default. Inline option objects: one @param for
           `options`, and a summary on each field.
@returns   When it resolves and what has taken effect by then.
@throws    `code` (throws | rejects) Condition. One tag per code (or per condition);
           only codes from the PluginError table; a plain Error is "`Error` without a code".
@example   Task title (3+ words), a lead saying what it does and how it works, then a
           ```ts block that compiles on its own (`plugin` and every SDK type are in
           scope; hidden setup above `// ---cut---`) or {@includeCode ../../examples/…#region};
           see "Examples in reference comments" below.
@see       Related symbols and the explanation page: [title](../../docs/explanation/<page>.md).
@since     The SDK version that added it (git tags; CHANGELOG).
@category  The API category (UI, Playback, …).
````

Modules and handles (`full` in `scripts/doc-standard.mjs`) carry all of it; their methods carry the summary, `@example`, `@capability`, `@since` and `@throws` (for a Promise). Data types (`data`) carry a summary, `@since`, `@category` and a summary per field with its unit and range. When a category is done, list its symbols in `scripts/doc-standard.mjs` so CI keeps it complete.

### Examples in reference comments

The reference is read by people who want to get a task done and by the plugin workshop's model, which reads the examples in the documentation tree and copies them. An example therefore teaches the task, not only the call.

**Which symbols have one.** Every method of a module or handle, every module entry type (a `Plugin` / `Scope` property), every `TestHost` method and `startPlugin` has its own `@example`. An option or data type (`CommandOptions`, `StreamOptions`, `PlayerState`) has one example on the type, and its fields get a summary with unit and range only. A trivial sibling (`Window.close` next to `Window.hide`) may instead point at its sibling's example with a marker (below), for at most 20 % of a declaration's methods, rounded down (one marker per declaration is always allowed).

**What an example contains**, in this order:

1. **A task title** on the `@example` line, at least 3 words, phrased as what the reader wants to do: `@example Pause playback from a menu item`, not `@example pause()`.
2. **A lead** of 1–3 sentences under the title, before the code, saying both:
   - **what it does**: what the user sees or what the plugin achieves;
   - **how it works**: which calls do what and in what order, and the mechanism the reader must understand to use them correctly. For example: "`run` is called when the user picks the item or presses its key; `checked` is evaluated again after every handler", "`player.state` is a snapshot the SDK keeps current from player events; `onChange` fires after it updates", "the request goes to the player process; it rejects with `stale` if the source changed meanwhile", "frames are pulled on the audio clock, so `frame()` may run several times back to back".
3. **Code that compiles on its own** (checked by `docs:check`). A block without `import`/`export` runs inside an async function with `plugin: Plugin` and every SDK type in scope (and the values of `@vestra-player/sdk/testing`); a block with imports is a module and declares what it uses. Setup the reader does not need goes above a `// ---cut---` line (the convention of TypeScript's twoslash): those lines are type checked but not shown on the site or in the documentation tree. In a block without its own imports they sit at module level, so they may `import` and `declare` (`declare const host: TestHost;`); in a module block keep the imports the reader copies below the line.
4. **Comments on the key lines** (required when more than 5 lines are shown): units, why a value was chosen, which line does the step the lead names.
5. **Error handling** for promise-returning calls whose failure the user can cause (`stale`, `busy`, `capability`, `limit`, a cancelled dialog): catch the code, say what the plugin does instead.

Do not invent mechanisms: every claim in a lead is checked against the SDK in `src/` and, for what the player does, the player's `src/host/src/` before it is written.

**Reference markers.** `@example See Window.hide` with `{@link Window.hide}` on the next line (TypeDoc takes the title line literally, so the link cannot go on it) stands for the sibling's example; the link must resolve and the sibling must have an example of its own.

**Stale references.** `STALE_REFERENCES` in `scripts/doc-standard.mjs` lists ids and names examples must not use any more (removed built-ins such as `vestra.nes`, a resolver for `.nes` files the store plugin VestraNES owns). Add an entry when a release removes or hands over something examples may still name.

**Checks.** `npm run doc-lint` applies `example-lead` (title, lead, comments, at most one `// ---cut---` per block), `stale-refs` and the marker rules to every `@example` of the API and every Markdown code block, and fails the run on any problem; it prints per `@category` the share of methods with an explained example (`--list example-lead` lists what fails, `--list explained` the methods without an explained example). `EXAMPLE_BASELINE` (empty since SDK 1.5.30) is for the day a rule is tightened: it lists the old violations, one entry per problem (`example-lead Osd.show#1 lead`; `doc-lint --baseline` prints the keys of new problems), reported as warnings. An entry that no longer fails is an error, and `test/doc-baseline.test.ts` pins the largest size the list may have, so it only shrinks: the change that fixes entries removes them and lowers that number. `docs:check` type checks every block (with its hidden lines) and fails on any error (`--lenient` reports errors in examples outside the strict categories as warnings, for work in progress); `scripts/typedoc-plugin.mjs` drops the hidden lines, for the site and the documentation tree.

**State:** since SDK 1.5.33 every exported declaration of `@vestra-player/sdk` and `@vestra-player/sdk/testing` is in a category of `STRICT_CATEGORIES` (Plugin, Commands, Playback, UI, Processing, Subtitles, Media, Sources, Packages, Services, Testing), so CI keeps the whole reference at the standard. A new declaration needs its `@category` and an entry in `scripts/doc-standard.mjs`, or `doc-lint` fails. Callback fields of option types (`CommandOptions.run`, `StreamOptions.frame`, a resolver's `resolve`…) are fields: a summary, with the example on the owning type; `npm run doc-lint -- --list explained` lists them.

## Documentation structure

The site has eight fixed groups, in this order; a new group needs a change to this section first.

| Group | Folder | Holds | Size limit per page |
| --- | --- | --- | --- |
| Tutorials | `docs/tutorials/` | Step-by-step lessons for a newcomer that can be followed to the end. | 350 lines |
| How-to | `docs/how-to/` | One page answers one "how do I do X?"; assumes Getting started. | 200 lines |
| Reference | `docs/reference/` | Lookup tables across symbols (capabilities, manifest and versions, limits, menu and binding names, platforms, theme, CLI), generated where possible. A fact about one symbol belongs in its TSDoc, not here. | 150 hand-written lines |
| Explanation | `docs/explanation/` | What something is, why it works that way and what it relates to, across several modules; no member lists. Named "Concepts" until the Diátaxis restructure; `REDIRECTS` in `scripts/doc-structure.mjs` keeps the old address. | 350 lines, 4500 words |
| Guidelines | `docs/guidelines/` | Normative rules (should / should not) for interface and menu consistency. They prescribe, so they are not explanation; they are not tasks either. | 200 lines |
| Examples | `docs/examples/` | Walkthroughs of the complete plugins in `examples/`. | 200 lines |
| Upgrading | `docs/upgrading/` | What to change in a plugin when a release deprecates, removes or changes something: one checklist per change, linked from the CHANGELOG entry. | 200 lines |
| API | (TypeDoc entry points) | The per-symbol reference from the TSDoc in `src/`. | — |

Every group's `index.md` comes first and is limited to 120 lines. Error codes and the test host have reference pages (`reference/errors.md`, `reference/testing.md`) whose tables are generated from the `PluginError` table and the `TestHost` declaration; the troubleshooting page is in the How-to group with a shape of its own.

Rules, all checked by `npm run docs:check`:

- **One topic per page.** Front matter has a `title` and a one-sentence `description` (what the page is for). Lines are counted without the front matter and without generated blocks; above the limit the check warns, more than 25 % above it fails.
- **Navigation depth 2** (group → page): no folders inside a group folder, no `children` front matter, and no `group` front matter (the folder decides the group).
- **The page list is a table.** `scripts/doc-structure.mjs` lists the groups and, per group, its pages in navigation order, each with `why` it is a page of its own rather than a section of an existing page (a different topic, or as a section it would push that page over its limit or blur its focus). The Markdown files under `docs/` must be exactly the listed pages (plus this page), so adding, renaming or removing a page changes the table and shows in review.
- **Index pages link only to pages that exist**, and every page is linked from its group's index (no orphans). No "coming soon" or "being written" entries: a page that is not written yet is an SDK issue, not a line on the site.
- **One fact, one place.** Constants, lists, limits and the capability table are generated from the code (below); pages link to each other instead of repeating. The README keeps a summary and links.
- `typedoc.json` must agree: `groupOrder` is the groups above followed by `API` and `*`, and `projectDocuments` includes every group folder.

**Page shapes (Diátaxis).** Each group holds one kind of content, and `docs:check` checks every page except the index pages against the shape of its kind (`SHAPES` and `shapeProblems` in `scripts/doc-structure.mjs`; a page entry may name another `shape`):

| Kind | Shape |
| --- | --- |
| tutorial | `## Before you start` first; numbered steps `## 1. …`, `## 2. …` in order (at least two); `## Next` last. Steps only; explanation links to Explanation. |
| how-to | A first paragraph starting `**Goal:**`; `## Steps` first (one `###` per step, unnumbered so anchors stay stable); a `## Complete example` with code; `## See also` last. Rules and formats go to Reference. |
| troubleshooting | At least three `##` symptom sections; `## See also` last; no steps section. |
| reference | Lookup only: no numbered, `Steps`, `Next` or `Before you start` sections, no `**Goal:**`. Generated where possible. |
| explanation | No numbered sections, no `Steps`, `Next`, `Testing`, `Common pitfalls` or `FAQ` sections, no numbered lists. A closing `## In the reference` paragraph links the API instead of listing members. |
| guideline | Rules only: no tables, colour values (`#rrggbb`), sizes (`12px`, `41×40`, any number of three or more digits) or generated blocks outside code blocks; values live in the Reference and the rule links them. A small count (`at most 8`), a code point (`U+2026`), a version, a date, a status code (`HTTP 404`), a count with thousands separators (`1,000,000`) and link targets (`](…)`, `{@link …}`) are not values. |
| example | A `## What it demonstrates` section that links the tutorial or how-to guide teaching it. |
| upgrading | `## Who must change` first. |

No page has a `## API on this page` section any more. **Diagrams are Mermaid** (a ` ```mermaid ` block, every edge written out as `A --> B`), not ASCII box art: `scripts/typedoc-plugin.mjs` draws them on the site: its small loader script is on every page and fetches the pinned Mermaid build only when the page has a diagram, and the documentation tree carries the source, which a language model reads as it is. Labels are plain text: `docs:check` rejects a Markdown link, a web address or a backtick inside a Mermaid block (`mermaidProblems`), which Mermaid would show as "Unsupported markdown". Draw a transition that works from every state once, from an `any state` node, not once per state. Plain-text templates stay in ` ```text ` blocks. A title is the page's address on the site (`documents/<title>.html`): renaming a page's title, or a heading that other repositories link (see `git grep "vestra-player-sdk/documents/"` in the player repository), needs an entry in `REDIRECTS` (`scripts/doc-structure.mjs`), which `scripts/typedoc-plugin.mjs` turns into a redirecting page, or a kept heading.

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
  verify ─▶ static ─▶ build ─┬─▶ test  ubuntu, windows ─┬─▶ publish  [environment vestra, id-token: write]
                             ├─▶ docs ──────────────────┘
                             └─▶ test-macos  macos (runs, does not gate publish)
```

- `_static.yml`: `tsc` (src + test), Prettier, oxlint, typos; actionlint and zizmor on `.github/`.
- `_build.yml`: `npm run build`, `npm pack`, the tarball's allow list (`scripts/check-pack.mjs`), publint, `attw --profile esm-only` (the package is ESM only, Node >= 26; the text export `llms.txt` is excluded), the install smoke test (`scripts/smoke-pack.mjs`). Uploads `dist` and `package` (the .tgz a release publishes unchanged).
- `_test.yml`: `npm test` on the matrix above, and an `examples` job: `npm run examples` (every example: install, check, test, pack) on the same matrix. The `os` input (a JSON array of runner labels, all three by default) lets `release.yml` call it twice: Ubuntu and Windows as `test`, macOS as `test-macos`.
- `_docs.yml`: TypeDoc with warnings as errors, `docs:check` and the `doc-lint` report; on `main` also the Pages artifact.
- Make **`ci-ok`** the only required status check for `main` (branch protection or a ruleset).
- Hardening: `permissions: {}` at the top of every workflow, the minimum per job; actions pinned by commit SHA with the version in a comment (Dependabot, `.github/dependabot.yml`, keeps them current); checkouts without persisted credentials; `npm ci --ignore-scripts`; concurrency per branch (`ci.yml` cancels superseded runs, `main.yml` and `release.yml` queue); timeouts on every job. `.github/zizmor.yml` disables only zizmor's `self-repository` hint, because actionlint does not accept `uses: $/...` yet.

## Releasing

1. Change `version` in `package.json` (and `package-lock.json`, e.g. with `npm version <x.y.z> --no-git-tag-version`), add the CHANGELOG entry, commit, push `main` and wait for `main.yml` to pass.
2. Tag `v<version>` (annotated) and push the tag.
3. `release.yml` checks that the tag equals `v` + `package.json` version and that the version is not on npm yet, runs every check again on the tagged commit (no npm cache), then the `publish` job (environment `vestra`) publishes the tarball the build job packed and smoke-tested, with `npm publish <tgz> --provenance`. `publish` waits for `verify`, `static`, `build`, `docs` and the Ubuntu and Windows tests and examples, not for macOS (product-owner ruling, 2026-11-02): GitHub-hosted macOS runners are often short of capacity, and runner capacity must never block a release (1.5.56 was tagged but never published because its macOS jobs got no runner). `test-macos` still runs on every release; a macOS failure marks the run as failed after the publish, so look at it and follow up with a fix release.
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
- `THEME_PALETTES` (`src/palettes.ts`): the colours of `vestra` and `vestra-light`, copied from the player's `src/host/src/ui/theme.rs`. `slint/palette.slint` holds only the `vestra` defaults, so the `vestra-light` values exist in the SDK only here; the unit tests check `vestra` against `palette.slint`, and the player's agreement test must check both against `theme.rs`.
