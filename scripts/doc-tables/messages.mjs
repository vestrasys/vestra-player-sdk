/**
 * `<!-- generated:messages -->`: every request method of the player's
 * protocol, one table per group of the player's table in its order (what
 * one part of the player serves, with its residency), with:
 *
 * - the capability it needs, or none: the player's table
 *   (`HOST_CAPABILITIES`, src/host-capabilities.ts, synced from its
 *   capabilities.json);
 * - its parameters and result: the SDK's typed clients, the
 *   `transport.request<Result>("method", params)` calls in src/*.ts, read
 *   with the TypeScript checker (parameters as field names, `?` when
 *   optional; the result as the client writes it);
 * - the error codes the SDK members that send it document (`@throws` in
 *   src/plugin/types/*.ts);
 * - its stability: the public members that send it (`API_REQUESTS` of
 *   src/api-requests.ts, then `WRAPPED_BY` below for the requests a handle
 *   sends on its own, such as `ui.set` for `Window.set`), otherwise
 *   "`plugin.wire` only".
 *
 * A method name ending in `.*` covers the prefix's other methods: the ones
 * the SDK sends get a row each, and the wildcard keeps a row of its own.
 *
 * Fails when a method the SDK sends is named by neither table, when
 * `WRAPPED_BY` names a method the player does not have or a member the API
 * does not declare, or when a client calls a method the player's table
 * does not list.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { memberLink } from "./capabilities.mjs";
import { declaration, docText, tags, ts, typeFile } from "./lib/source.mjs";

/**
 * The public members that send a request without being listed in
 * `API_REQUESTS` (which lists only the request that decides a member's
 * capability): the handles' own requests (a window's `set`, a command's
 * `set`), clean-up on `dispose`, and the requests of the members that need
 * no capability. Keep it complete: the generator fails on a method the SDK
 * sends that neither table names.
 */
export const WRAPPED_BY = {
  "producer.state": ["Player.openStream"],
  "producer.release": ["Stream.stop"],
  "producer.ack": ["Player.openStream"],
  "producer.declareInput": ["Player.openStream"],
  "producer.ackInput": ["Player.openStream"],
  "processing.state": ["Plugin.video.filter", "Plugin.audio.filter"],
  "processing.operation": ["Plugin.video.filter", "Plugin.audio.filter"],
  "sourceResolvers.respond": ["Resolvers.add"],
  "sourceResolvers.unregister": ["Resolvers.add"],
  "events.unsubscribe": ["Player.on", "Player.onChange"],
  "commands.update": ["Command.set"],
  "commands.unregister": ["Command.dispose"],
  "palette.lead.clear": ["PaletteLead.dispose"],
  "palette.lead.done": ["PaletteLead.done"],
  "ui.set": ["Window.set", "Window.bind"],
  "ui.show": ["Window.show", "Window.hide"],
  "ui.close": ["Window.close"],
  "ui.setMount": ["Panel.set", "Panel.bind"],
  "ui.unmount": ["Panel.dispose"],
  "ui.interaction": ["Panel.setInteraction"],
  "ui.menu": ["Panel.showMenu"],
  "ui.markdownScan": ["Ui.markdown"],
  "layout.set": [
    "PanelSlot.setVisible",
    "PanelSlot.toggle",
    "Panel.show",
    "Panel.toggle",
  ],
  "settings.set": ["SettingsPage.set", "SettingsPage.bind"],
  "settings.unregister": ["SettingsPage.dispose"],
  "snapshot.release": ["Snapshot.dispose"],
  "jobs.operation": ["Snapshot.export"],
  "jobs.cancel": ["ExportJob.cancel"],
  "packages.install": ["PackageCandidate.install"],
  "packages.installed": ["PackageCandidate.install"],
  "packages.operation": ["PackageCandidate.install"],
  "packages.cancel": ["PackageChange.cancel"],
  "storage.session.get": ["SessionStorage.get"],
  "storage.session.set": ["SessionStorage.set"],
  "storage.session.delete": ["SessionStorage.delete"],
  "storage.session.keys": ["SessionStorage.keys"],
  "subtitles.commit": ["Subtitles.load"],
  "subtitles.operation": [
    "Subtitles.select",
    "Subtitles.load",
    "Subtitles.remove",
    "Subtitles.setStyle",
  ],
  "subtitles.upload.append": ["Subtitles.load"],
  "subtitles.upload.discard": ["Subtitles.load"],
  "system.reveal": ["System.reveal"],
  "system.openPath": ["System.openPath"],
  "system.openUrl": ["System.openUrl"],
  "app.system": ["App.system"],
  "video.view.release": ["Plugin.video.view"],
  "video.render.release": ["Plugin.video.render"],
  "window.state": ["MainWindow.state"],
  "drops.withdraw": ["Drops.provide"],
  "mpv.unobserve": ["Mpv.observe"],
};

/** What a group's residency (capabilities.json) means for standby. */
const RESIDENCY = {
  live: "Residency `live`: what these methods open (a view, a listener, a stream) keeps the plugin running.",
  recordable:
    "Residency `recordable`: the player records the registrations and keeps them while the plugin stands by.",
  none: "Residency `none`: no effect on standby.",
};

/** Members as links into the API reference, comma separated. */
export const memberLinks = (members) =>
  [...new Set(members)].map(link).join(", ");

/**
 * A member linked into the API reference. TypeDoc does not resolve a
 * member through a type alias (`SettingsPage` is `View & {…}`), so those
 * link the alias.
 */
function link(member) {
  const owner = member.split(".")[0];
  let alias = false;
  try {
    alias = ts.isTypeAliasDeclaration(declaration(typeFile(owner), owner));
  } catch {
    // Not a declaration of the types files (`Plugin.…`): memberLink's rule.
  }
  return alias
    ? `{@linkcode "@vestra-player/sdk"!${owner} ${member}}`
    : memberLink(member);
}

/** A method's `needs` in words: `null` none, or its capability. */
export function capabilityRule(needs) {
  return needs === null ? "none" : `\`${needs}\``;
}

/** The TypeScript program of the SDK's top-level modules (the clients). */
function clientProgram(root) {
  const files = readdirSync(join(root, "src"))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => join(root, "src", name));
  return ts.createProgram(files, {
    target: ts.ScriptTarget.Latest,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowImportingTsExtensions: true,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
}

/** Field names of an object type (or a union of them), `?` when optional. */
function fields(checker, type) {
  const parts = type.isUnion() ? type.types : [type];
  const objects = parts.filter(
    (part) => part.flags & ts.TypeFlags.Object && !checker.isArrayType(part),
  );
  if (!objects.length || objects.length !== parts.length) return null;
  if (objects.some((part) => checker.getIndexInfosOfType(part).length))
    return null;
  const seen = new Map();
  for (const part of objects)
    for (const property of checker.getPropertiesOfType(part)) {
      const optional = !!(property.flags & ts.SymbolFlags.Optional);
      const entry = seen.get(property.name) ?? { count: 0, optional: false };
      entry.count++;
      entry.optional ||= optional;
      seen.set(property.name, entry);
    }
  return [...seen].map(
    ([name, { count, optional }]) =>
      `${name}${optional || count < objects.length ? "?" : ""}`,
  );
}

/**
 * Every `*.request("method", params)` call of the clients, first call site
 * per method (files sorted, then source order): `{ file, params, result }`.
 */
export function clientCalls(root) {
  const program = clientProgram(root);
  const checker = program.getTypeChecker();
  const src = join(root, "src").replace(/\\/g, "/");
  const calls = new Map();
  const files = program
    .getSourceFiles()
    .filter((file) => {
      const name = file.fileName.replace(/\\/g, "/");
      return (
        name.startsWith(`${src}/`) && !name.slice(src.length + 1).includes("/")
      );
    })
    .sort((a, b) => a.fileName.localeCompare(b.fileName));
  for (const file of files) {
    const visit = (node) => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === "request" &&
        node.arguments[0] &&
        ts.isStringLiteralLike(node.arguments[0])
      ) {
        const method = node.arguments[0].text;
        if (!calls.has(method)) {
          const argument = node.arguments[1];
          let params = "—";
          if (argument) {
            const type = checker.getTypeAtLocation(argument);
            const names = fields(checker, type);
            params = names
              ? names.length
                ? `{ ${names.join(", ")} }`
                : "{}"
              : `\`${checker.typeToString(type)}\``;
            if (names) params = `\`${params}\``;
          }
          const typeArgument = node.typeArguments?.[0];
          let result = "—";
          if (typeArgument) {
            const text = typeArgument.getText().replace(/\s+/g, " ");
            const names =
              text.length > 48
                ? fields(checker, checker.getTypeFromTypeNode(typeArgument))
                : null;
            result = names ? `\`{ ${names.join(", ")} }\`` : `\`${text}\``;
          }
          calls.set(method, {
            file: file.fileName.slice(src.length + 1),
            params,
            result,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  return calls;
}

/**
 * The declaration of `Interface.member` (`Plugin.x…` is a `Scope`
 * property), found on the interface, its `extends` parents or the parts of
 * an intersection type alias; `null` when there is none.
 */
function findMember(member) {
  const [owner, name] = member.replace(/^Plugin\./, "Scope.").split(".");
  const seen = new Set();
  const inMembers = (members) =>
    members?.find((m) => m.name?.getText() === name) ?? null;
  const inType = (type) => {
    if (!type) return null;
    if (ts.isTypeLiteralNode(type)) return inMembers(type.members);
    if (ts.isIntersectionTypeNode(type))
      for (const part of type.types) {
        const found = inType(part);
        if (found) return found;
      }
    if (ts.isTypeReferenceNode(type)) return search(type.typeName.getText());
    return null;
  };
  const search = (iface) => {
    if (seen.has(iface)) return null;
    seen.add(iface);
    let node;
    try {
      node = declaration(typeFile(iface), iface);
    } catch {
      return null;
    }
    if (ts.isTypeAliasDeclaration(node)) return inType(node.type);
    const own = inMembers(node.members);
    if (own) return own;
    for (const clause of node.heritageClauses ?? [])
      for (const parent of clause.types) {
        const found = search(parent.expression.getText());
        if (found) return found;
      }
    return null;
  };
  return search(owner);
}

/** The error codes in the `@throws` tags of members' doc comments. */
function documentedCodes(members) {
  const codes = new Set();
  for (const member of members) {
    const found = findMember(member);
    if (!found) continue;
    for (const text of tags(docText(found), "throws")) {
      const code = /^`(\w+)`/.exec(text)?.[1];
      if (code) codes.add(code);
    }
  }
  return [...codes];
}

export default async function messages({ root, table }) {
  const load = (path) => import(pathToFileURL(join(root, path)));
  const { HOST_CAPABILITIES } = await load("src/host-capabilities.ts");
  const { API_REQUESTS } = await load("src/api-requests.ts");
  const calls = clientCalls(root);

  const sentBy = new Map();
  for (const [member, requests] of Object.entries(API_REQUESTS))
    for (const request of requests)
      if (!request.also && !member.startsWith("Wire"))
        sentBy.set(request.method, [
          ...(sentBy.get(request.method) ?? []),
          member,
        ]);
  for (const [method, members] of Object.entries(WRAPPED_BY)) {
    for (const member of members)
      if (!findMember(member))
        throw new Error(`WRAPPED_BY["${method}"]: no API member ${member}`);
    sentBy.set(method, [...(sentBy.get(method) ?? []), ...members]);
  }

  const groups = [
    // One section per group of the player's table, titled by what the
    // group is for; the Capability column says what each method needs.
    // Two groups may share a summary (snapshots and exports: their reads
    // and their changes): those say their residency in the title.
    ...HOST_CAPABILITIES.groups
      .filter((group) => group.methods.length)
      .map((group, _, all) => ({
        title:
          all.filter((each) => each.summary === group.summary).length > 1
            ? `${group.summary} (residency \`${group.residency}\`)`
            : group.summary,
        lead: RESIDENCY[group.residency],
        methods: group.methods,
      })),
  ];
  const listed = new Set(groups.flatMap((g) => g.methods.map((m) => m.name)));
  const wildcards = [...listed].filter((name) => name.endsWith(".*"));
  const covered = (method) =>
    wildcards.find((w) => method.startsWith(w.slice(0, -1)));
  for (const method of [...calls.keys(), ...Object.keys(WRAPPED_BY)])
    if (!listed.has(method) && !covered(method))
      throw new Error(
        `${method}: the SDK sends it, the player's capability table does not list it`,
      );
  for (const method of calls.keys())
    if (!sentBy.has(method))
      throw new Error(
        `${method}: sent by ${calls.get(method).file}, but no public member is named for it; add it to WRAPPED_BY in scripts/doc-tables/messages.mjs`,
      );

  const row = (method, needs) => {
    const call = calls.get(method);
    const members = sentBy.get(method) ?? [];
    const codes = documentedCodes(members);
    return [
      `\`${method}\``,
      capabilityRule(needs),
      call?.params ?? "—",
      call?.result ?? "—",
      codes.map((code) => `\`${code}\``).join(", ") || "—",
      members.length
        ? `SDK member: ${memberLinks(members)}`
        : "`plugin.wire` only",
    ];
  };
  const header = [
    "Method",
    "Capability",
    "Params",
    "Result",
    "Errors (documented)",
    "Stability",
  ];
  const sections = [];
  for (const group of groups) {
    const rows = [];
    for (const { name, needs } of group.methods) {
      if (!name.endsWith(".*")) {
        rows.push(row(name, needs));
        continue;
      }
      const prefix = name.slice(0, -1);
      const known = [...new Set([...calls.keys(), ...sentBy.keys()])]
        .filter((method) => method.startsWith(prefix) && !listed.has(method))
        .sort();
      for (const method of known) rows.push(row(method, needs));
      rows.push([
        `\`${name}\` (any other)`,
        capabilityRule(needs),
        "—",
        "—",
        "—",
        "`plugin.wire` only",
      ]);
    }
    sections.push(
      `### ${group.title}\n\n${group.lead}\n\n${table(header, rows)}`,
    );
  }
  return sections.join("\n\n");
}
