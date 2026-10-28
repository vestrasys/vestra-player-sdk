---
title: Load subtitles from a plugin
description: List and select subtitle tracks, upload a subtitle file the plugin found or converted, and style the subtitles without fighting other plugins.
---

# Load subtitles from a plugin

**Goal:** your plugin finds subtitles for the playing file (on disk, on a website, by converting another format), adds them as a track, selects them, and optionally styles them.

## Capabilities

```json
{
  "capabilities": ["subtitles.read", "subtitles.control", "events"]
}
```

`subtitles.read` reads the tracks and the selection; `subtitles.control` changes them (and needs `subtitles.read` too, because every change reads the current selection first); `events` makes the SDK read `plugin.subtitles.state` again when the source or its phase changes. The player has no subtitle event: a selection the user or another plugin changes shows only after `refresh()`.

## Read the tracks

`plugin.subtitles.state` is `null` until first read; `refresh()` reads it from the player. Each track has an `id` (compare tracks by id), a `kind` (`embedded` in the file or `external`, loaded from a file), a `title` and a `language`.

```ts
const state = plugin.subtitles.state ?? (await plugin.subtitles.refresh());
for (const track of state.tracks)
  console.log(track.id, track.kind, track.language ?? "?", track.title);
// The primary and the secondary subtitle; null when off.
console.log(state.selected?.id, state.secondary?.id);
```

## Select a track, and handle `stale`

Without options a change reads the newest state itself and applies to it, so it almost never fails. Embedded tracks are chosen by number, though: a `select` after another file opened would pick that file's track with the same number. Pass the state you looked at as `ifCurrent`; then the change fails with `stale`, and does nothing, when the user picked another track or another file opened in between:

```ts
const state = await plugin.subtitles.refresh();
const english = state.tracks.find((track) => track.language === "en");
if (english)
  await plugin.subtitles.select(english, { ifCurrent: state }).catch((error: PluginError) => {
    if (error.code !== "stale") throw error; // the user changed it meanwhile
  });
```

`select(track, { role: "secondary" })` sets the second line shown together with the primary one (a text track other than the primary); `select(null)` turns a role off. A new source clears the secondary subtitle.

## Upload a file

`load` takes the file's bytes: UTF-8 SRT, or ASS/SSA with `format: "ass"`, at most 2 MiB (SRT up to 10,000 cues, ASS up to 20,000 `Dialogue:` lines). Convert other formats (WebVTT, SAMI) to SRT first. The player adds an `external` track to the current source only, selects it unless `select: "none"`, and resolves with the track once the upload is committed.

```ts
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
declare const path: string;
// ---cut---
const bytes = await readFile(path);
const track = await plugin.subtitles.load(bytes, {
  format: path.endsWith(".ass") ? "ass" : "srt",
  title: basename(path), // data: shown as it is
  select: "primary",
  signal: AbortSignal.timeout(30_000), // discards the upload if not committed in time
});
await plugin.osd.show("Loaded {}", [track.title]);
```

A title that mixes words with data is a text value the player translates: `title: plugin.i18n.text("{} · {}", [plugin.i18n.text("Downloaded"), name])`. `remove(track)` takes away a track this plugin loaded; the next source removes it anyway.

## Style the subtitles

`setStyle` sets this plugin's style layer: font (one of `state.fonts`), size at the 1080p reference height, colour, outline, margin, timing offset, box. Each plugin has one layer and its newest call replaces it. When several plugins set a layer, the player shows the one whose **manifest id sorts last**, whatever the order of the calls; `setStyle(null)` takes yours off.

```ts
const { fonts } = await plugin.subtitles.refresh();
if (fonts.length)
  await plugin.subtitles.setStyle({
    fontId: fonts[0]!.id,
    fontSize: 40,
    color: "white",
    outline: 2,
    marginPercent: 5,
    offsetMs: 0, // positive shows them later
  });
```

## See also

- The API reference: `Subtitles`, `SubtitlesState`, `SubtitleTrack`, `SubtitleStyle`.
- [Translate a plugin](i18n.md) for text values in titles.
