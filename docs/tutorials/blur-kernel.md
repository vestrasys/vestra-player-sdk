---
title: Write your own blur kernel
description: "A lesson on video processing: write a 3×3 blur kernel yourself, first as a GPU shader, then as a convolution node that also reaches snapshots, and finally meet the ready-made gblur filter."
---

# Write your own blur kernel

In this tutorial you blur the video with a kernel you write yourself: nine numbers that say how much of each neighbouring pixel goes into the new one. You run the kernel twice, first as a GPU shader and then in the player's filter chain, where it also applies to snapshots and exports. Only at the end do you meet the ready-made Gaussian blur, which does the same job in one line.

## Before you start

Finish [Getting started](getting-started.md), so you know the plugin folder, the manifest and `vestra-player --plugin <folder>`. You need Vestra Player 0.5.20 or newer and a video to play. The shader steps need GPU rendering: on macOS it is on unless something rules it out; on Windows turn on **Video ▸ GPU Rendering (Experimental)** and restart the player ([GPU and software rendering](../explanation/rendering.md)). Everything from step 4 on works with either renderer.

Start a new folder, `blur-kernel/`, set up as in Getting started, with this `manifest.json`:

```json
{
  "id": "me.blur-kernel",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "minPlayerVersion": "0.5.20",
  "capabilities": [
    "commands",
    "ui.osd",
    "processing.video",
    "playback.read",
    "events",
    "media.read",
    "media.control",
    "subtitles.read"
  ]
}
```

`processing.video` opens `plugin.video`, which also needs `playback.read` (and `events` for the filter chain, so it hears when a video becomes ready). `media.read` and `media.control` are for the snapshot in step 6; a processed snapshot also needs `subtitles.read`, because it can include the subtitle on screen. `0.5.20` is the first player with shader handles and the `convolution` node.

## 1. Understand the kernel

A blur replaces every pixel with a weighted average of itself and its neighbours. The weights form a small grid centred on the pixel, the **kernel**. Here is the one you will use:

```text
1  2  1
2  4  2
1  2  1
```

- **The centre, 4**, is the pixel itself. It has the largest weight, so the picture stays recognisable.
- **The edges, 2**, are the four direct neighbours (left, right, above, below). They are close, so they count half as much as the centre.
- **The corners, 1**, are the diagonal neighbours, a little further away, so they count least.
- **The sum is 16.** Dividing the weighted sum by 16 makes the weights add up to 1. That is **normalization**: a flat grey area stays the same grey, so the blur softens edges without making the picture brighter or darker. Divide by less and the picture brightens; by more and it darkens.

The rows are `1 2 1` multiplied by `1 2 1`: a small binomial kernel, the closest whole-number cousin of a Gaussian blur. Wider kernels in step 5 come from the same idea.

## 2. Write the kernel as a shader

A GPU shader runs once for every pixel on the graphics card. The player accepts mpv user shaders (`.glsl` files). Create `shaders/blur.glsl` in the plugin folder:

```glsl
//!HOOK MAIN
//!BIND HOOKED
//!DESC Blur 3x3 (tutorial)

vec4 hook() {
    // The kernel, row by row: each sample is the pixel at that offset
    // (in pixels) times its weight.
    vec4 sum = vec4(0.0);
    sum += 1.0 * HOOKED_texOff(vec2(-1.0, -1.0));
    sum += 2.0 * HOOKED_texOff(vec2( 0.0, -1.0));
    sum += 1.0 * HOOKED_texOff(vec2( 1.0, -1.0));
    sum += 2.0 * HOOKED_texOff(vec2(-1.0,  0.0));
    sum += 4.0 * HOOKED_texOff(vec2( 0.0,  0.0));
    sum += 2.0 * HOOKED_texOff(vec2( 1.0,  0.0));
    sum += 1.0 * HOOKED_texOff(vec2(-1.0,  1.0));
    sum += 2.0 * HOOKED_texOff(vec2( 0.0,  1.0));
    sum += 1.0 * HOOKED_texOff(vec2( 1.0,  1.0));
    // Normalization: the weights add up to 16.
    return sum / 16.0;
}
```

- `//!HOOK MAIN` runs the shader on the main picture, after it was converted to RGB and before it is scaled to the window.
- `//!BIND HOOKED` makes that picture readable as `HOOKED`; `HOOKED_texOff(offset)` reads the pixel `offset` pixels away from the current one.
- `hook()` returns the new colour of the current pixel.

The file belongs to the plugin: the player only takes shaders from the plugin's package directory or its data directory, at most 16 MiB each.

## 3. Apply the shader from a menu item

Write `main.ts`. A shader handle from `plugin.video.shaders()` holds this plugin's list of shader files; `set` replaces the list and `clear` empties it:

```ts
import { join } from "node:path";
// ConvolutionPlane is for step 4.
import type { ConvolutionPlane, Plugin } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
  // The package directory is where main.ts is.
  const shaderFile = join(import.meta.dirname, "shaders", "blur.glsl");
  const shaders = plugin.video.shaders("blur");
  let shaderOn = false;

  plugin.commands.add({
    id: "blur-shader",
    path: ["@video", "Blur (Shader)"],
    checked: () => shaderOn,
    run: () => {
      shaderOn = !shaderOn;
      if (shaderOn) shaders.set([shaderFile]);
      else shaders.clear();
    },
  });

  // A shader that does not compile, or software rendering, ends up here;
  // the player has dropped the list, so the item is unchecked again.
  shaders.onStatus((status) => {
    if (status.state !== "failed") return;
    shaderOn = false;
    void plugin.osd.show("Blur shader: {}", [status.error.message]);
  });
}
```

Run the player with `--plugin ./blur-kernel`, play a video and choose **Video ▸ Blur (Shader)**. The picture softens; choose it again and it is sharp.

- Paths are absolute. `import.meta.dirname` is the folder of the entry module: `main.ts` in development, the built `main.js` in the installed package. Both sit at the top of the package, so it is the package directory.
- `set` never throws: a refusal shows in `status`. `unsupported` means the player renders in software; `missing` means the file is not there; a shader with a syntax error is reported after it was accepted, which is why the plugin listens with `onStatus`. The player cannot tell whose shader failed to compile, so it tells every plugin that holds shaders: while another plugin's shaders are on too, the message may be about theirs. Under software rendering, or when the player switches to it, the status is `failed` with `unsupported` and the list is removed; that is why the listener unchecks the item.
- Other plugins may hold shaders at the same time; the player runs every plugin's list, at most 16 shaders in all ([Limits](../reference/limits.md#video-primitives)).

Shaders act only where the picture is drawn on the GPU. They are not part of snapshots or exports, and they do nothing under software rendering. The next steps run the same kernel where both work.

## 4. Write the kernel as a convolution node

First choose **Video ▸ Blur (Shader)** again so it is unchecked; otherwise you would see two blurs on top of each other. The player's filter chain processes every decoded frame on the CPU before it is drawn. A `convolution` node runs your own integer kernel there (FFmpeg's `convolution` filter). Add to the end of `activate`:

```ts
// The same kernel, row by row: 9 entries make a 3×3 square.
const kernel3: ConvolutionPlane = {
  mode: "square",
  matrix: [
    1, 2, 1,
    2, 4, 2,
    1, 2, 1,
  ],
  rdiv: 1 / 16, // normalization: multiply the weighted sum by 1/16
  bias: 0, // nothing added afterwards
};
const filter = plugin.video.filter("blur");
let filterOn = false;

plugin.commands.add({
  id: "blur-filter",
  path: ["@video", "Blur (Filter)"],
  checked: () => filterOn,
  run: () => {
    filterOn = !filterOn;
    // One kernel for each plane: brightness and the two colour planes.
    filter.set(filterOn ? [{ kind: "convolution", planes: [kernel3, kernel3, kernel3] }] : []);
  },
});
```

Choose **Video ▸ Blur (Filter)**: the same softening as the shader, now with either renderer.

- **`planes`** has one entry per plane of the decoded picture. Most video is YUV: plane 0 is the brightness (luma), planes 1 and 2 are the colour (chroma). A `null` entry, or a missing one, leaves that plane alone, so `[kernel3]` alone would blur only the brightness.
- **`matrix`** is the kernel row by row, whole numbers only. A `square` kernel has 9, 25 or 49 entries: 3×3, 5×5 or 7×7.
- **`rdiv`** multiplies the weighted sum; it is the normalization the shader did with `/ 16.0`. `0` means "divide by the sum of the matrix", so `rdiv: 0` is the same here, and keeps working when you change the numbers.
- **`bias`** is added after the multiplication, in the plane's sample units. A blur needs none; an edge-detection kernel, whose weights add up to 0, uses 128 to put "no edge" at mid grey in 8-bit video.
- Each output is clipped to the sample range, so a kernel that is not normalized saturates instead of wrapping around.

The player checks the node as it is set: entries are integers from −1024 to 1024, `rdiv` is 0–256 and `bias` 0–65535 (`VIDEO_PROCESSING_LIMITS`, in [Limits](../reference/limits.md#video-primitives)); anything else fails with `invalid` and shows in `filter.status`.

A filter chain needs the frames in memory, so while it is on the player decodes with copy-back instead of zero-copy. That is the price of a chain that also reaches snapshots and exports.

## 5. Make the blur wider

A 3×3 kernel reaches one pixel in each direction. To blur more, use a larger binomial kernel. Its rows are the rows of Pascal's triangle, and a square kernel is a row multiplied by itself:

```ts
// Row n of Pascal's triangle: 1 4 6 4 1 for n = 4.
function binomial(n: number): number[] {
  const row = [1];
  for (let k = 1; k <= n; k++) row.push((row[k - 1]! * (n - k + 1)) / k);
  return row;
}
const row5 = binomial(4); // 1 4 6 4 1, sum 16
const kernel5: ConvolutionPlane = {
  mode: "square",
  matrix: row5.flatMap((a) => row5.map((b) => a * b)), // 25 entries, sum 256
  rdiv: 0, // divide by the sum
  bias: 0,
};
```

Use `kernel5` in place of `kernel3` in the **Blur (Filter)** command and run it again: the blur reaches two pixels in each direction. The entries are the products of the row with itself, from 1 in the corners to 36 in the centre; with `rdiv: 0` the player divides by their sum, 256.

A square kernel stops at 7×7. For a wider blur use two nodes, a `row` kernel and then a `column` kernel. Blurring across and then down gives the same result as the square kernel, apart from rounding between the two passes, at a fraction of the work, and `row` and `column` take any odd number of entries up to 49:

```ts
function binomial(n: number): number[] {
  const row = [1];
  for (let k = 1; k <= n; k++) row.push((row[k - 1]! * (n - k + 1)) / k);
  return row;
}
const filter = plugin.video.filter("blur");
// ---cut---
const taps = binomial(12); // 13 entries, the largest is 924
const across = { mode: "row", matrix: taps, rdiv: 0, bias: 0 } as const;
const down = { mode: "column", matrix: taps, rdiv: 0, bias: 0 } as const;
filter.set([
  { kind: "convolution", planes: [across, across, across] },
  { kind: "convolution", planes: [down, down, down] },
]);
```

Put this chain in the command's `filter.set` instead of the single node. The limit on entries decides how far this goes: `binomial(12)` has 924 in the middle, while `binomial(14)` would need 3432, more than the 1024 the player accepts. A binomial kernel of `n + 1` entries blurs like a Gaussian with a sigma of √n ⁄ 2: about 0.7 pixels for 3 entries, 1 for 5 and 1.7 for 13. The colour planes are often half the size of the brightness plane, so the same kernel blurs the colour twice as far; that is normal for YUV video.

## 6. Check that snapshots include it

Because the convolution runs in the filter chain, a **processed** snapshot contains it, which the shader never does. Add a command that saves the current frame with this plugin's effects:

```ts
import { join } from "node:path";
// ---cut---
plugin.commands.add({
  id: "save-blurred",
  path: ["@video", "Save Blurred Frame"],
  run: async () => {
    const snapshot = await plugin.media.capture({
      ifCurrent: plugin.player.state,
      processed: true, // with this plugin's filter chain
      subtitles: false,
    });
    try {
      const destination = join(plugin.dataDirectory, "blurred.png");
      const job = await snapshot.export({ format: "png", destination });
      await job.done;
      await plugin.osd.show("Saved {}", [destination]);
    } finally {
      await snapshot.dispose();
    }
  },
});
```

With **Blur (Filter)** on, the saved PNG is blurred; with only **Blur (Shader)** on, it is sharp. Exports of clips work the same way.

## 7. Take the shortcut: gblur

You now know what a blur kernel does. For everyday use the filter chain has a ready-made Gaussian blur, FFmpeg's `gblur`, which builds the kernel for you from one number:

Replace the chain in the **Blur (Filter)** command's `filter.set(...)` with this one:

```ts
const filter = plugin.video.filter("blur");
// ---cut---
// sigma 0–10: the blur's radius, the same measure as in step 5.
filter.set([{ kind: "gblur", sigma: 1.7, steps: 3 }]);
```

- `sigma` is live: changing it moves the blur in place without rebuilding the chain, which makes it the right choice for a slider ([Keep a slider responsive while dragging](../how-to/slider.md)). Changing a `convolution` matrix rebuilds that stage, which may stall the picture for one frame.
- `steps` is always 3.
- Like the convolution, it runs in the filter chain, so it reaches snapshots and exports.

Use `gblur` when you want a blur; write a `convolution` when you want a kernel of your own (sharpen, emboss, edges, a directional blur); write a shader when the effect must run on the GPU and only on screen.

## Next

- [Example: Blur](../examples/blur.md): a complete plugin around `gblur`, with a window and a live slider.
- [Video and audio processing](../explanation/processing.md): how plugins' chains join, live fields, the view and render options.
- {@link "@vestra-player/sdk"!VideoNode | VideoNode}, {@link "@vestra-player/sdk"!ConvolutionPlane | ConvolutionPlane} and {@link "@vestra-player/sdk"!VideoShaders | VideoShaders} in the API reference.
