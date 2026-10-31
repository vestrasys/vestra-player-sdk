---
title: Video and audio processing
description: Filter chains and how plugins' chains are joined, live parameter changes, and the display layer and render options that change how video is shown but not the frames.
---

# Video and audio processing

A plugin can change what the user sees and hears in three different places. They look alike in the API (each is a handle with `set`, a `status` and `onStatus`), but they act at different stages and have different owners, so choosing the right one matters:

| | Changes | Owner | In snapshots and exports | API |
| --- | --- | --- | --- | --- |
| **Filter chain** | The decoded frames and samples: colour, blur, denoise, rotation, crop, volume, equalizer, delay… | Every plugin has its own chains; all are joined | Yes | {@link "@vestra-player/sdk"!VideoFilter | VideoFilter}, {@link "@vestra-player/sdk"!AudioFilter | AudioFilter} |
| **Display layer** | Where the video sits in the video area: aspect, fit, zoom, pan | One plugin at a time | No | {@link "@vestra-player/sdk"!VideoView | VideoView} |
| **Render options** | How the GPU renderer draws: HDR tone mapping, user shaders, motion interpolation | One plugin at a time | No | {@link "@vestra-player/sdk"!RenderOptions | RenderOptions} |

```text
 decoder ─▶ plugin A's chain ─▶ plugin B's chain ─▶ … ─▶ (frameBlend) ─▶ renderer ─▶ video area
            └──────────── filter chains: part of the picture ──────────┘    │          │
                         snapshots and exports use the same chain      render options  display layer
                                                                       (display only)  (display only)
```

All three need `processing.video` (or `processing.audio`) and `playback.read`; filter chains also need `events`, because the SDK must see each new source to apply the chain again.

## Filter chains

{@link "@vestra-player/sdk"!Scope.video | plugin.video.filter(id)} and `plugin.audio.filter(id)` give the plugin a chain of its own: a list of nodes ({@link "@vestra-player/sdk"!VideoNode | VideoNode}, {@link "@vestra-player/sdk"!AudioNode | AudioNode}) that the player turns into FFmpeg filters.

```ts
const picture = plugin.video.filter("picture");
picture.set([{ kind: "eq", brightness: 0.1, contrast: 1.1, saturation: 1, gamma: 1 }]);
```

- **A chain is a desired state.** `set(nodes)` says what the chain should be from now on; the last write wins. The SDK applies it to the current media, and **applies it again to every new source**, so the plugin does not react to file changes itself.
- **Each plugin owns its own chains.** The player joins the chains of all plugins in a stable order. Setting or disposing a chain changes only that plugin's contribution; an empty chain (`[]`, or for audio no nodes and no delay) withdraws it and leaves the others alone.
- **Nothing is sent until the first `set()`**, and disposing a chain that was applied withdraws it.
- **Limits are shared.** All plugins together have at most 64 nodes, one `frameBlend` and a bounded audio delay ([Reference: limits](../reference/limits.md#limits-documented-at-their-api)); a value out of a node's range fails with `invalid`.
- **The same chain is the picture.** A processed snapshot or an export ({@link "@vestra-player/sdk"!MediaCapture | plugin.media}) goes through the same chains, so it matches what plays.

### Status

A chain reports where it stands in {@link "@vestra-player/sdk"!FilterStatus | FilterStatus}:

```text
 set(nodes)
   │ no ready media ──▶ waiting ── media ready ──┐
   ▼                                             ▼
 applying ──────────────────────────────────▶ applied
   │
   └──▶ failed (error.code) ── retry() / next set() / new source ──▶ applying
```

- `waiting` keeps the value until there is media to apply it to; without `events` the SDK never sees the media become ready, so the chain stays there.
- `applied` means the player accepted the chain, not that the next frame already shows it.
- `failed` is not retried by itself. Its `error.code` says why: `invalid` (a value out of range), `unsupported` (the source is a generated stream, which the player does not decode; the chain is applied again once a decoded source plays), `backend-uncertain` (the player's backend blocked that stage; call `retry()`).

### Live parameters

A slider that drives a filter calls `set` on every move. That is fine: one request is in flight at a time and only the newest value is sent ([Keep a slider responsive while dragging](../how-to/slider.md)).

How smoothly the change shows depends on the field. Some fields, marked **live** on {@link "@vestra-player/sdk"!VideoNode | VideoNode} and {@link "@vestra-player/sdk"!AudioNode | AudioNode} (brightness and contrast, blur strength, hue, volume, equalizer gain…), change in place while playing. Changing any other field rebuilds that stage of the chain: the picture may stall for a frame and an audio filter's internal state starts over. Put the live fields on the controls users drag, and the others on switches and lists.

### Ordering and side effects

- Video nodes act on the picture after the player has applied the container's rotation, so a portrait video is upright before a plugin's `transform` rotates it.
- `frameBlend` (frame-rate conversion by blending) always runs **last**, after every plugin's chain, wherever it is written, so temporal filters such as denoise and deinterlace still see the original frames. It changes the frame rate of exports too, and costs a lot of CPU: decide from `stats()` whether to offer it.
- Filters need frames in memory. While any plugin has a video chain, the player decodes in hardware with a copy back to memory instead of zero-copy decoding; when the last chain is removed it switches back. The decoder restarts at each switch, so the picture may pause briefly. {@link "@vestra-player/sdk"!PlaybackStats | stats().video.hwdec} shows the decoder in use. The one exception is the next item.
- `{ kind: "deinterlace", when: "auto", output: "field" }` (player 0.5.4) is not a filter in the chain but the player's own deinterlacer. The player decides per frame: frames flagged interlaced are deinterlaced, at one frame per field, by the decoder's hardware deinterlacer where frames stay on the GPU (BWDIF otherwise); progressive frames pass untouched. It needs no frames in memory, so a chain with only this node keeps zero-copy decoding: this is the node for an "Auto" setting that must cost nothing on progressive files. It runs **first**, before every plugin's chain, wherever it is written, and it is shared: it stays on while any plugin's chain has one. `output: "frame"` fails with `invalid`, and so does another `deinterlace` node in the same chain; use `when: "interlaced"` (BWDIF in the chain, with a copy back to memory) for frame-rate output. Snapshots and exports deinterlace the same frames with BWDIF at field rate.

## The display layer

{@link "@vestra-player/sdk"!Scope.video | plugin.video.view()} returns the {@link "@vestra-player/sdk"!VideoView | VideoView}: aspect override, fit (keep with bars, stretch, fill and crop), zoom and pan. It changes only how the frames are placed in the video area. Snapshots, exports and filters do not see it.

- **One owner.** The first plugin to call `view()` owns the display layer. Another plugin's handle reports `failed` with `conflict` and tries again on each `set`, so it takes over once the owner disposes its view or stops. When the owner lets go, the player restores the defaults.
- **Writes merge.** `set({ zoom: 1.5 })` changes only the zoom; the other fields keep their values.
- **Values stay across sources**, as in mpv. A plugin that wants "reset zoom for every new file" does that itself when `player.state.sourceId` changes.

## Render options

{@link "@vestra-player/sdk"!Scope.video | plugin.video.render()} returns the {@link "@vestra-player/sdk"!RenderOptions | RenderOptions} of the GPU renderer: HDR to SDR tone mapping and the display's brightness, user shaders (`.glsl` files) and motion interpolation. Like the display layer they act at display time only, have one owner (independent of the display layer's owner) and merge writes.

- **Only the GPU renderer has them.** Under software rendering every `set` fails with `unsupported`; see [Reference: platforms](../reference/platforms.md) for where the player renders on the GPU. Treat `unsupported` as "hide these settings", not as an error. To know before creating the handle, read {@link "@vestra-player/sdk"!SystemInfo.rendering | rendering} from `plugin.app.system()` (player 0.5.12, no capability): `"gpu"` or `"software"`.
- A shader that does not compile is reported later: the status first becomes `applied`, then `failed` with code `failed` and the compiler's first error line once mpv first uses the shader.

## The GPU's video upscaler

{@link "@vestra-player/sdk"!VideoUpscaling | plugin.video.upscaling} (capability `video.upscaling`, player 0.5.16) turns on the GPU's AI upscaler, NVIDIA RTX Video Super Resolution on Windows. It is not a handle: `set(true)` is the plugin's request, and the player keeps the upscaler last in the filter chain, after every plugin's chain, while any plugin has it on and it can work, scaled to the area the video is shown in. Like render options it acts at display time only.

- **Ask when needed.** The player checks the GPU at the first `state()` or `set(true)` and keeps the answer; the check wakes a sleeping discrete GPU, so ask on the first pick of the item, not while the plugin starts. `set(false)` never checks.
- **It needs GPU rendering on the upscaler's GPU, with the video decoded there.** A filter chain that needs the frames in memory switches decoding to copy-back, and the upscaler waits (`decoding`) until it is gone.
- **No sign that it runs.** `requested` says the player asked the driver; on Windows the user must also turn on Super Resolution in the NVIDIA app, which no program can read.

## API on this page

- Filter chains: {@link "@vestra-player/sdk"!VideoFilter | VideoFilter}, {@link "@vestra-player/sdk"!AudioFilter | AudioFilter}, {@link "@vestra-player/sdk"!VideoNode | VideoNode}, {@link "@vestra-player/sdk"!AudioNode | AudioNode}, {@link "@vestra-player/sdk"!FilterStatus | FilterStatus}
- Display layer: {@link "@vestra-player/sdk"!VideoView | VideoView}, {@link "@vestra-player/sdk"!ViewSettings | ViewSettings}
- Render options: {@link "@vestra-player/sdk"!RenderOptions | RenderOptions}, {@link "@vestra-player/sdk"!RenderSettings | RenderSettings}
- The video upscaler: {@link "@vestra-player/sdk"!VideoUpscaling | VideoUpscaling}, {@link "@vestra-player/sdk"!UpscalingState | UpscalingState}, {@link "@vestra-player/sdk"!UpscalingReasonCode | UpscalingReasonCode}
- Snapshots and exports with the same chains: {@link "@vestra-player/sdk"!MediaCapture | MediaCapture}, {@link "@vestra-player/sdk"!Snapshot | Snapshot}

Examples: [blur](../examples/blur.md) (a live video filter driven by a slider).
