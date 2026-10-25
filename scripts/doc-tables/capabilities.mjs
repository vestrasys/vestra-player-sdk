/**
 * `<!-- generated:capabilities -->`: every capability of `CAPABILITY_INFO`
 * (src/capabilities.ts), in the player's order, with the members it opens
 * (linked to the API reference), the capabilities they also need and the
 * plugin store's wording.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";

/** A member as `Interface.member`, linked. `Plugin.x` is declared on Scope. */
export const memberLink = (api) =>
  `{@linkcode "@vestra-player/sdk"!${api.replace(/^Plugin\./, "Scope.").replace(/^(Scope\.\w+)\..*$/, "$1")} ${api}}`;

export default async function capabilities({ root, table }) {
  const { CAPABILITY_INFO } = await import(
    pathToFileURL(join(root, "src/capabilities.ts"))
  );
  return table(
    [
      "Capability",
      "Opens",
      "Also needs",
      "Shown in the store as",
      "Highlighted",
    ],
    Object.entries(CAPABILITY_INFO).map(([name, info]) => [
      `\`${name}\``,
      info.apis.map(memberLink).join(", "),
      info.requires.map((needed) => `\`${needed}\``).join(", ") || "—",
      info.label,
      info.risky ? "yes" : "",
    ]),
  );
}
