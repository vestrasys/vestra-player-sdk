/**
 * `<!-- generated:release-notes -->`: one row per release of CHANGELOG.md,
 * newest first: the version (linked to its entry), who must change, and the
 * migration guide the entry links, if any. "Who must change" is the text of
 * the entry's opening `**Who must change: …**`; entries from before that
 * convention give the first sentence of their first paragraph instead.
 */
const CHANGELOG =
  "https://github.com/vestrasys/vestra-player-sdk/blob/main/CHANGELOG.md";

/** A Markdown link to a docs page, made relative to docs/upgrading/. */
const fromUpgrading = (target) =>
  target.replace(/^docs\/upgrading\//, "").replace(/^docs\//, "../");

export default function releaseNotes({ read, table }) {
  const text = read("CHANGELOG.md").replace(/\r\n/g, "\n");
  const entries = [
    ...text.matchAll(/^## (\d+\.\d+\.\d+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm),
  ];
  if (entries.length < 10) throw new Error("CHANGELOG.md: too few entries");
  const rows = entries.map(([, version, body]) => {
    const first = body
      .trim()
      .split(/\n\s*\n/)[0]
      .replace(/\s*\n\s*/g, " ");
    // The "**Who must change: …**" paragraph, also when a note comes first.
    const paragraph =
      body
        .trim()
        .split(/\n\s*\n/)
        .map((p) => p.replace(/\s*\n\s*/g, " "))
        .find((p) => p.startsWith("**Who must change:")) ?? first;
    const who = /^\*\*Who must change: (.+?)\*\*\s*(.*)$/.exec(paragraph);
    let summary;
    if (who) {
      const rest = /^(.+?[.!?])(\s|$)/.exec(who[2])?.[1] ?? "";
      const name = who[1].replace(/\.$/, "");
      summary = `**${name[0].toUpperCase()}${name.slice(1)}.** ${rest}`.trim();
    } else {
      summary = /^(.+?[.!?])(\s|$)/.exec(first)?.[1] ?? first;
    }
    // Links inside a cell: keep their text only, except to the guides below.
    summary = summary.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
    const guides = [
      ...new Set(
        [
          ...body.matchAll(/\[([^\]]+)\]\((docs\/upgrading\/[\w-]+\.md)\)/g),
        ].map(([, title, path]) => `[${title}](${fromUpgrading(path)})`),
      ),
    ];
    return [
      `[${version}](${CHANGELOG}#${version.replace(/\./g, "")})`,
      summary,
      guides.join(", ") || "—",
    ];
  });
  return table(["Release", "Who must change", "Guide"], rows);
}
