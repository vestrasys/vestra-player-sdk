---
title: Process video with a shader or a filter
description: Blur the video with a kernel of your own, first as a GPU shader, then as a convolution node that also reaches snapshots, and finally with the ready-made gblur filter.
---

# Process video with a shader or a filter

**Goal:** the plugin changes the picture with a 3×3 blur kernel of your own, as a GPU shader and as a node of the player's filter chain, and you know when to use the ready-made `gblur` instead.

The kernel is nine weights: how much of each neighbouring pixel goes into the new one.

```text
1  2  1
2  4  2
1  2  1
```

The centre is the pixel itself, the edges its four direct neighbours, the corners the diagonal ones. The weights add up to 16, so the sum is divided by 16 (normalization): a flat grey area stays the same grey.

## Steps

### Capabilities

None: `plugin.video`, the filter chains and processed snapshots need no entry in the manifest's `capabilities`.

### Write the kernel as a shader

The player accepts mpv user shaders. Create `shaders/blur.glsl` in the plugin folder:

```glsl
//!HOOK MAIN
//!BIND HOOKED
//!DESC Blur 3x3

vec4 hook() {
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
    return sum / 16.0;
}
```

`//!HOOK MAIN` runs it on the main picture, after conversion to RGB and before scaling; `HOOKED_texOff(offset)` reads the pixel that many pixels away.

### Apply the shader

`plugin.video.shaders(name)` holds this plugin's list of shader files; `set` replaces it and `clear` empties it. Paths are absolute, and the player takes shaders only from the plugin's package or data directory. `import.meta.dirname` is the package directory, in development and installed. `set` never throws: listen with `onStatus`, where a shader that does not compile, a missing file, or software rendering (`unsupported`) shows as `failed`, and the player has dropped the list.

Shaders need GPU rendering ([GPU rendering](./gpu-rendering.md)) and act only on screen: not in snapshots or exports.

### Run the same kernel in the filter chain

A `convolution` node runs an integer kernel on every decoded frame, with either renderer, and reaches snapshots and exports. `planes` has one entry per plane of the decoded picture (brightness, then the two colour planes); a `null` or missing entry leaves that plane alone. `matrix` is the kernel row by row, 9, 25 or 49 whole numbers for a `square` kernel. `rdiv` multiplies the weighted sum; `0` means "divide by the sum of the matrix". `bias` is added afterwards. The node's value limits are in [Limits](../reference/limits.md#video-primitives); a value outside them fails with `invalid` in `filter.status`.

While a filter chain is on, the player decodes with copy-back instead of zero-copy.

### Make the blur wider

A larger binomial kernel blurs further: its rows are rows of Pascal's triangle. A square kernel stops at 7×7; beyond that, use a `row` node and then a `column` node, which give the same result at a fraction of the work:

```ts
declare const filter: VideoFilter;
// ---cut---
// Row n of Pascal's triangle: 1 4 6 4 1 for n = 4.
function binomial(n: number): number[] {
  const row = [1];
  for (let k = 1; k <= n; k++) row.push((row[k - 1]! * (n - k + 1)) / k);
  return row;
}
const taps = binomial(12); // 13 entries, the largest is 924
const across = { mode: "row", matrix: taps, rdiv: 0, bias: 0 } as const;
const down = { mode: "column", matrix: taps, rdiv: 0, bias: 0 } as const;
filter.set([
  { kind: "convolution", planes: [across, across, across] },
  { kind: "convolution", planes: [down, down, down] },
]);
```

A binomial kernel of `n + 1` entries blurs like a Gaussian with a sigma of √n ⁄ 2: about 1.7 pixels for 13 entries.

### Use gblur for an everyday blur

FFmpeg's `gblur` builds the kernel from one number. `sigma` is live: changing it moves the blur in place, which suits a slider ([Keep a slider responsive while dragging](./slider.md)), while changing a `convolution` matrix rebuilds that stage.

```ts
declare const filter: VideoFilter;
// ---cut---
filter.set([{ kind: "gblur", sigma: 1.7, steps: 3 }]);
```

Use `gblur` for a blur, a `convolution` for a kernel of your own (sharpen, emboss, edges), and a shader when the effect must run on the GPU and only on screen.

## Complete example

`manifest.json`:

```json
{
  "id": "me.blur-kernel",
  "version": "0.1.0",
  "apiVersion": "vestra/1",
  "entry": "main.ts",
  "capabilities": []
}
```

`main.ts`, with `shaders/blur.glsl` from the steps. **Video ▸ Blur (Shader)** and **Video ▸ Blur (Filter)** toggle the two blurs; **Video ▸ Save Blurred Frame** saves a processed snapshot, which is blurred by the filter and never by the shader:

```ts
import { join } from "node:path";
import type { ConvolutionPlane, Plugin } from "@vestra-player/sdk";

export default function activate(plugin: Plugin) {
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
  shaders.onStatus((status) => {
    if (status.state !== "failed") return;
    shaderOn = false; // the player dropped the list
    void plugin.osd.show("Blur shader: {}", [status.error.message]);
  });

  // The same kernel, row by row.
  const kernel3: ConvolutionPlane = {
    mode: "square",
    matrix: [1, 2, 1, 2, 4, 2, 1, 2, 1],
    rdiv: 1 / 16, // normalization
    bias: 0,
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
      filter.set(
        filterOn
          ? [{ kind: "convolution", planes: [kernel3, kernel3, kernel3] }]
          : [],
      );
    },
  });

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
}
```

## See also

- [Example: Blur](../examples/blur.md): a complete plugin around `gblur`, with a window and a live slider.
- [Limits](../reference/limits.md#video-primitives): shader count and size, kernel entries, `rdiv` and `bias`.
- {@link "@vestra-player/sdk"!VideoNode | VideoNode}, {@link "@vestra-player/sdk"!ConvolutionPlane | ConvolutionPlane}, {@link "@vestra-player/sdk"!VideoShaders | VideoShaders}
