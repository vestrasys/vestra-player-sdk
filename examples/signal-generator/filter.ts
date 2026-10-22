/**
 * The player-side audio filter: a chain of nodes the player runs inside its
 * own audio pipeline, in contrast to the tone this plugin computes itself.
 */
import type { AudioNode, FilterStatus } from "@vestra-player/sdk";
import type { FilterChoice } from "./controls.ts";

// #region nodes
/** The chain for each choice in the window. Every node is from the player's fixed list. */
export function nodesFor(choice: FilterChoice): AudioNode[] {
  switch (choice) {
    case "off":
      return []; // an empty chain withdraws this plugin's effect
    case "mono":
      return [{ kind: "channels", mode: "mono" }];
    case "swap":
      return [{ kind: "channels", mode: "swap" }];
    case "treble":
      return [{ kind: "treble", frequency: 3000, slope: 0.5, gainDb: 6 }];
  }
}
// #endregion nodes

// #region status
/** One line for the window: what the player did with the chain. */
export function describeFilter(
  choice: FilterChoice,
  status: FilterStatus,
): string {
  if (choice === "off") return "Off";
  switch (status.state) {
    case "waiting":
      return "Waiting for media";
    case "applying":
      return "Applying…";
    case "applied":
      return "Applied by the player";
    case "failed":
      // The chain runs in the pipeline that decodes media. A generated
      // stream's audio goes from frame() straight to the audio device, so
      // the player answers `unsupported`; the SDK applies the kept chain
      // again by itself once the player plays a file.
      if (status.error.code === "unsupported")
        return "Not applied to this stream: the player filters media it decodes";
      return `Failed (${status.error.code}): ${status.error.message}`;
  }
}
// #endregion status
