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
