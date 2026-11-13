/**
 * `<!-- generated:events -->`: every event a plugin can listen to by name
 * (`HostEvent`, src/plugin/types/*.ts), in the union's order, with:
 *
 * - its payload: the type and summary of its member of `EventPayloads`;
 * - the SDK members that listen to it: the `events.subscribe` requests of
 *   `API_REQUESTS` (src/api-requests.ts) with that event name, the same
 *   table the capability check reads (`also` ones in parentheses);
 * - whether the player wakes a stopped plugin for it (`WAKE_EVENTS`,
 *   src/plugin/connection.ts).
 *
 * No event needs a capability (`events.subscribe` is open to every plugin).
 *
 * Fails when the union, the
 * `EventPayloads` members and `SUBSCRIBED_EVENTS` disagree, or when a
 * payload has no summary.
 */
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import {
  declaration,
  docText,
  summary,
  typeFile,
  unionLiterals,
} from "./lib/source.mjs";
import { memberLinks } from "./messages.mjs";

/** `HostEvent` in order, each with its payload's type text and summary. */
export function hostEvents() {
  const names = unionLiterals(typeFile("HostEvent"), "HostEvent");
  const payloads = declaration(typeFile("EventPayloads"), "EventPayloads");
  const members = new Map(
    payloads.members.map((member) => [
      member.name.getText().replace(/^"(.*)"$/, "$1"),
      member,
    ]),
  );
  const missing = names.filter((name) => !members.has(name));
  const extra = [...members.keys()].filter((name) => !names.includes(name));
  if (missing.length || extra.length)
    throw new Error(
      `HostEvent and EventPayloads disagree: ${[...missing.map((n) => `no payload for ${n}`), ...extra.map((n) => `payload ${n} is no HostEvent`)].join("; ")}`,
    );
  return names.map((name) => {
    const member = members.get(name);
    const doc = summary(docText(member));
    if (!doc) throw new Error(`EventPayloads["${name}"] has no summary`);
    return {
      name,
      // The fields' own doc comments (shown by the API pages) are left out.
      type: member.type
        .getText()
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\s+/g, " ")
        .replace(/;\s*}/g, " }"),
      doc,
    };
  });
}

export default async function events({ root, table }) {
  const load = (path) => import(pathToFileURL(join(root, path)));
  const { API_REQUESTS, SUBSCRIBED_EVENTS } = await load("src/api-requests.ts");
  const { WAKE_EVENTS } = await load("src/plugin/connection.ts");
  const list = hostEvents();
  const names = list.map((event) => event.name);
  if (JSON.stringify([...SUBSCRIBED_EVENTS]) !== JSON.stringify(names))
    throw new Error("SUBSCRIBED_EVENTS differs from HostEvent");
  const listeners = (event) => {
    const own = [];
    const also = [];
    for (const [member, requests] of Object.entries(API_REQUESTS))
      for (const request of requests)
        if (
          request.method === "events.subscribe" &&
          request.params?.event === event
        )
          (request.also ? also : own).push(member);
    return { own, also };
  };

  return table(
    [
      "Event",
      "Payload",
      "SDK members that listen to it",
      "Wakes a stopped plugin",
    ],
    list.map(({ name, type, doc }) => {
      const { own, also } = listeners(name);
      const members = [
        memberLinks(own),
        also.length ? `(${memberLinks(also)})` : "",
      ]
        .filter(Boolean)
        .join(" ");
      return [
        `\`${name}\``,
        `\`${type}\`: ${doc}`,
        members || "none: `Player.on` only",
        WAKE_EVENTS.includes(name) ? "yes" : "no",
      ];
    }),
  );
}
