/**
 * `<!-- generated:scan-categories -->`: the capability scan's categories
 * (capability-scan.json, hand-maintained): what each covers, its API
 * members and its requests of the player's protocol. `none` is not
 * printed: it is every other method.
 */
export default function scanCategories({ read, table }) {
  const scan = JSON.parse(read("capability-scan.json"));
  const code = (names) => names.map((name) => `\`${name}\``).join(", ") || "—";
  return table(
    ["Category", "Covers", "API members", "Requests by name"],
    Object.entries(scan.categories).map(([name, list]) => [
      `\`${name}\``,
      list.about,
      code(list.members),
      code(list.requests),
    ]),
  );
}
