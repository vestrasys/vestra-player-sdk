---
title: Who must change, release by release
description: For every SDK release, whether a plugin has to change and the migration guide when it does, taken from the CHANGELOG.
---

# Who must change, release by release

## Who must change

Every SDK release's CHANGELOG entry opens with who must change and what happens to a plugin that does not. This table collects those openings, newest first, so you can see at a glance what lies between the SDK your plugin was built with and the current one. Additions never require a change; a plugin that uses one sets `minPlayerVersion` to the player the entry names. The full entries are in the [CHANGELOG](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md).

## Releases

<!-- generated:release-notes -->

| Release | Who must change | Guide |
| --- | --- | --- |
| [1.6.15](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1615) | **Nobody.** A plugin may now mount one panel per slot (player 0.7.6) instead of one panel in all; plugins with one panel work as before, and `apiVersion` stays `vestra/1`. | — |
| [1.6.14](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1614) | **Nobody.** A data refresh: `BUILTIN_COMMANDS` lists the built-in capture plugin's commands as the player registers them since its capture tab; no API change, `apiVersion` stays `vestra/1`. | — |
| [1.6.13](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1613) | **Plugin tests that toggle a column in fullscreen.** In fullscreen `toggle()` now only switches the column on or off (user ruling 2026-11-08); a test that asserted `effective: true` after toggling a column on in fullscreen now sees `effective: false`, `reason: "fullscreen"` (on, revealed by the right edge). | — |
| [1.6.12](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1612) | **Nobody.** Superseded by 1.6.13 for `toggle` in fullscreen: this release's rule is withdrawn, and no released player shipped it. | — |
| [1.6.11](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1611) | **Nobody.** Additions only: a mount slot, a panel position, a button icon and `TestHost` support; `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.6.10](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1610) | **Nobody.** Additions only: a clip format, optional export fields, two optional `JobState` fields, an error code and a `TestHost` field. | — |
| [1.6.9](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#169) | **Nobody.** Additions only: timeline ranges, OSD messages with action buttons, a limits constant, a wire method and `TestHost` support, and documentation of a bottom bar's `content-full-width`. | — |
| [1.6.8](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#168) | **Nobody; authors of a bottom bar should move to `content-min-width`.** Documentation, a read-only Slint property and a removed CLI warning: no change to the TypeScript API, the wire or `TestHost`, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.6.7](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#167) | **Nobody.** The 1.6.6 release below, published again under a new number: its npm publish failed (the provenance transparency log returned 500, then 409 for the same tarball), so 1.6.6 never reached npm. | — |
| [1.6.6](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#166) | **Nobody.** Additions only: two members of `plugin.commands`, a wire method and event, two Slint widget additions and a `TestHost` method. | — |
| [1.6.5](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#165) | **Nobody, but run `vestra-plugin i18n extract` again if a command sets a `category`.** A fix in the plugin CLI only: no change to the TypeScript API, the wire or `TestHost`, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.6.4](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#164) | **Nobody, but check tests that compare whole `bindings.list()` entries.** Additions only: two optional `CommandOptions` fields, one optional `BindingInfo` field, a `COMMAND_LIMITS` entry and a new built-in command. | — |
| [1.6.3](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#163) | **Nobody.** Documentation only: no change to the TypeScript API, the wire or `TestHost`, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.6.2](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#162) | **Nobody, but check `TestHost` tests of a full sidebar or of `keepsRunning` with a background tab.** No change to the TypeScript API or the wire, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.6.1](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#161) | **Nobody.** Docs only: no change to the TypeScript API, the wire or `TestHost`, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.6.0](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#160) | **Nobody.** No change to the TypeScript API, the wire or `TestHost`, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.5.58](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1558) | **Nobody.** Documentation only: no change to the TypeScript API, the wire or `TestHost`, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.5.57](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1557) | **Nobody.** The first npm release with 1.5.56's fix: no change to the TypeScript API or the wire, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.5.56](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1556) | **Nobody.** A fix: no change to the TypeScript API or the wire, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.5.55](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1555) | **Nobody, but check `TestHost` tests that update a disabled plugin.** Additive: `InstallOptions` gains `enabled` and `TestHost` gains `installKeepsDisabled`, `apiVersion` stays `vestra/1`, no new capability, and existing code still compiles. | — |
| [1.5.54](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1554) | **Nobody, but check cleanup functions passed directly to `onDispose`.** Additive: `Plugin.stopReason`, the types `StopReason` and `DisposeInfo`, an optional argument for `onDispose` cleanups, `TestHost.previousCrash`, an optional `code` for `TestHost.failVideoShaders` and `stop({ reason })` / `disconnect()` from `startPlugin`; `apiVersion` stays `vestra/1`, no new capability, and existing code still compiles. | — |
| [1.5.53](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1553) | **Nobody.** No changes to the TypeScript API, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.5.52](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1552) | **Nobody.** Additive: `WindowState` gains `maximized`, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.5.51](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1551) | **Nobody.** Additive: `MENU_IDS` and `MenuId` gain `reset`, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.5.50](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1550) | **Tools that read `llms-full.txt`.** It is removed (approved by the maintainer, 2026-11-01): from the package (`@vestra-player/sdk/llms-full.txt`), from the documentation site and from the generators. | — |
| [1.5.49](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1549) | **Nobody.** No changes to the plugin API (`@vestra-player/sdk/runtime` gains the additive `RuntimeOptions` and an optional sixth `createPlugin` argument), `apiVersion` stays `vestra/1`, no new capability, no player version needed, and the player's runner needs no change. | — |
| [1.5.48](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1548) | **Nobody, but plugin tests may now fail.** No changes to the TypeScript API beyond new fields of `COMMAND_LIMITS`, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.5.47](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1547) | **Nobody.** No changes to the TypeScript API, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.5.46](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1546) | **Nobody.** No changes to the TypeScript API, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.5.45](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1545) | **Nobody.** No changes to the TypeScript API, `apiVersion` stays `vestra/1`, no new capability, no player version needed. | — |
| [1.5.44](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1544) | **Nobody.** No changes to the TypeScript API, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.5.43](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1543) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.5.42](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1542) | **Nobody.** Documentation only: no API changes, `apiVersion` stays `vestra/1`, no player version needed. | — |
| [1.5.41](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1541) | **Nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. | — |
| [1.5.40](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1540) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`. | — |
| [1.5.39](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1539) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`, no new capability. | — |
| [1.5.38](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1538) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`. | — |
| [1.5.37](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1537) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`. | — |
| [1.5.36](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1536) | **Nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. | — |
| [1.5.35](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1535) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`. | — |
| [1.5.34](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1534) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`. | — |
| [1.5.33](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1533) | **Nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. | — |
| [1.5.31](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1531) | **Nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. | — |
| [1.5.30](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1530) | **Nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. | — |
| [1.5.29](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1529) | **Nobody.** Additions only, `apiVersion` stays `vestra/1`. | — |
| [1.5.28](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1528) | **Nobody.** No API changes, `apiVersion` stays `vestra/1`. | — |
| [1.5.27](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1527) | **Nobody.** No API changes, `apiVersion` stays `vestra/1`, no player version needed. | — |
| [1.5.26](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1526) | **Authors whose plugin uses a member without one of the capabilities it needs, and only to `check`, `build` or `pack` again.** No API changes, `apiVersion` stays `vestra/1`, no player version needed, and packages already built keep running as before: the player decides at run time exactly as it did. | — |
| [1.5.25](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1525) | **Nobody.** Plugins built on earlier SDKs keep working unchanged: `plugin.storage.json` and every other API do what they did. | — |
| [1.5.24](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1524) | **Nobody.** Plugins built on earlier SDKs keep working unchanged: `when: "interlaced"` and `when: "all"` do what they did. | — |
| [1.5.23](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1523) | **Nobody.** Republishes 1.5.22 with a clean API documentation build; 1.5.22 was tagged but never published to npm: TypeDoc treats warnings as errors and failed on two `{@link}` labels in _Playback_ that contained a brace (`Scrub.seek(seconds, { keyframes })`). | — |
| [1.5.22](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1522) | **Nobody.** Plugins built on earlier SDKs keep working unchanged: a scrub without the new option seeks exactly, as before. | — |
| [1.5.21](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1521) | **Nobody.** Plugins built on earlier SDKs keep working unchanged; the additions need player 0.5.2. | — |
| [1.5.20](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1520) | Republishes 1.5.19, which was tagged but never published: its API documentation build failed (an example title and four undocumented `IMAGE_LIMITS` fields). | — |
| [1.5.19](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1519) | Images in list rows, restarting a plugin, and keyframe step seeks (player 0.5.1). | — |
| [1.5.18](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1518) | Fixes for Windows and for a vendored SDK, and built-ins that can no longer be disabled. | — |
| [1.5.17](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1517) | **Package rollback is removed**, as announced in 1.5.16: the player keeps no previous plugin version. | [Migrating off package rollback](rollback-migration.md) |
| [1.5.16](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1516) | **Package rollback is deprecated: the player keeps no previous plugin version.** `apiVersion` stays `vestra/1`; code still compiles, and plugins that do not manage other plugins need no change. | [Migrating off package rollback](rollback-migration.md) |
| [1.5.15](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1515) | **How many frames really reach the screen, and how the video is decoded** (player 0.5.1); every player error code documented; the fullscreen bottom bar's new behaviour. | — |
| [1.5.14](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1514) | **The documentation site in seven groups, with generated reference tables.** A documentation release; `apiVersion` stays `vestra/1`, and plugins need no change. | — |
| [1.5.13](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1513) | **`i18n extract` keeps the translator's comments and writes the right number of plural forms.** A fix; `apiVersion` stays `vestra/1`. | — |
| [1.5.12](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1512) | **Keys of disabled commands pass on; `i18n check` fails on stale catalogs; translator notes in tables; the Button follows its text.** A fix release; `apiVersion` stays `vestra/1`. | — |
| [1.5.11](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1511) | **Text values: words mixed with data, translated by the player** (player 0.4.3). | — |
| [1.5.10](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#1510) | **Property value limits: documented, higher, enforced by `TestHost`, reported loudly** (player 0.4.3). | — |
| [1.5.9](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#159) | **Translations** (player 0.4.3). | [Migrate a plugin to English source text](i18n-migration.md) |
| [1.5.8](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#158) | **Trial loading is removed; `resolvers.fileTypes`; the CLI under `--permission`.** `apiVersion` stays `vestra/1`. | — |
| [1.5.7](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#157) | **Replaced or closed streams stop with `null`.** A fix; no API change, `apiVersion` stays `vestra/1`, any player. | — |
| [1.5.6](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#156) | **A reference for AI assistants.** Documentation and packaging only; no API change, `apiVersion` stays `vestra/1`. | — |
| [1.5.5](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#155) | **Reserved `vestra.` ids** (player 0.4.1). | — |
| [1.5.4](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#154) | **Markdown in list rows** (the player after 0.4.0). | — |
| [1.5.3](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#153) | **File resolvers: local files as generated streams** (player 0.4.1). | — |
| [1.5.2](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#152) | **Sidebar tabs** (the player after 0.4.0). | — |
| [1.5.1](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#151) | Fix; no API or type changes. | — |
| [1.5.0](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#150) | **Own visual identity: the Aurora palettes and the V-Line icons** (player 0.4.0). | — |
| [1.4.1](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#141) | Documentation only; no code or type changes. | — |
| [1.4.0](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#140) | **One palette.** `ThemeId` is now `"vestra"` only: the second palette that earlier versions listed is gone from the player. | — |
| [1.3.0](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#130) | Fixes and additions found by the blur and signal-generator examples (player 0.3.0). | — |
| [1.2.0](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#120) | For the player's packaged builds, which ship their own Node 26 and run every plugin on it (users no longer install Node). | — |
| [1.1.3](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#113) | For the player's switch to the system default font, per-system monospace font and standard close keys. | — |
| [1.1.2](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#112) | For the player's upgrade to Slint 1.18.1. | — |
| [1.1.1](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#111) | Fixes found in the player's GUI review of the Markdown view (player 0.2.0 with these fixes). | — |
| [1.1.0](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#110) | Additions for the plugin store (player 0.2.0; plugins that use them set `"minPlayerVersion": "0.2.0"`). | — |
| [1.0.1](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#101) | Documentation: README in English, maintainer notes in CONTRIBUTING.md, API documentation site. | — |
| [1.0.0](https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md#100) | First release: plugin API `vestra/1`. | — |

<!-- /generated -->
