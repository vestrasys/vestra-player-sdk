/**
 * `<!-- generated:events -->`: every event a plugin can listen to by name
 * (`HostEvent`, then `SourceEvent`, then `FactEvent`, src/plugin/types/*.ts), in the
 * unions' order, with:
 *
 * - its payload: the type and summary of its member of `EventPayloads`
 *   (`SourceEventPayloads` for a `SourceEvent`, `FactEventPayloads` for a
 *   `FactEvent`);
 * - the SDK members that listen to it: the `events.subscribe` requests of
 *   `API_REQUESTS` (src/api-requests.ts) with that event name;
 * - whether the player wakes a stopped plugin for it (`WAKE_EVENTS`,
 *   src/plugin/connection.ts);
 * - whether the SDK's own copy of its state follows it only while a
 *   listener, a watcher or a stream holds it (`EVENT_NEEDS`,
 *   src/plugin/player/events.ts).
 *
 * Fails when a union and its payloads' members disagree, when
 * `SUBSCRIBED_EVENTS` is not the three unions, or when a payload has no
 * summary.
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

/**
 * The names of union `union` in order, each with its payload's type text
 * and summary from interface `interfaceName`.
 */
function namedEvents(union, interfaceName) {
  const names = unionLiterals(typeFile(union), union);
  const payloads = declaration(typeFile(interfaceName), interfaceName);
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
      `${union} and ${interfaceName} disagree: ${[...missing.map((n) => `no payload for ${n}`), ...extra.map((n) => `payload ${n} is no ${union}`)].join("; ")}`,
    );
  return names.map((name) => {
    const member = members.get(name);
    const doc = summary(docText(member));
    if (!doc) throw new Error(`${interfaceName}["${name}"] has no summary`);
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

/** `HostEvent`, then `SourceEvent`, then `FactEvent`, each with its payload. */
export function hostEvents() {
  return [
    ...namedEvents("HostEvent", "EventPayloads"),
    ...namedEvents("SourceEvent", "SourceEventPayloads"),
    ...namedEvents("FactEvent", "FactEventPayloads"),
  ];
}

export default async function events({ root, table }) {
  const load = (path) => import(pathToFileURL(join(root, path)));
  const { API_REQUESTS, SUBSCRIBED_EVENTS } = await load("src/api-requests.ts");
  const { WAKE_EVENTS } = await load("src/plugin/connection.ts");
  const { EVENT_NEEDS } = await load("src/plugin/player/events.ts");
  const list = hostEvents();
  const names = list.map((event) => event.name);
  if (JSON.stringify([...SUBSCRIBED_EVENTS]) !== JSON.stringify(names))
    throw new Error(
      "SUBSCRIBED_EVENTS differs from HostEvent, SourceEvent and FactEvent",
    );
  const listeners = (event) => {
    const own = [];
    for (const [member, requests] of Object.entries(API_REQUESTS))
      for (const request of requests)
        if (
          request.method === "events.subscribe" &&
          request.params?.event === event
        )
          own.push(member);
    return own;
  };

  return table(
    [
      "Event",
      "Payload",
      "SDK members that listen to it",
      "Wakes a stopped plugin",
      "Copy follows only while held",
    ],
    list.map(({ name, type, doc }) => {
      const members = memberLinks(listeners(name));
      return [
        `\`${name}\``,
        `\`${type}\`: ${doc}`,
        members || "none: `Player.on` only",
        WAKE_EVENTS.includes(name) ? "yes" : "no",
        EVENT_NEEDS[name] === "held" ? "yes" : "no",
      ];
    }),
  );
}
