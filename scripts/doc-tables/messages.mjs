/**
 * `<!-- generated:messages -->`: every request method of the player's
 * protocol that the SDK sends, one table per area (the method's first
 * segment, `source` for `source.state`), areas and methods in name order,
 * with:
 *
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
 * Fails when a method the SDK sends is named by neither table, or when
 * `WRAPPED_BY` names a member the API does not declare.
 */
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { declaration, docText, tags, ts, typeFile } from "./lib/source.mjs";

/**
 * The public members that send a request without being listed in
 * `API_REQUESTS` (which lists the request a member sends to do its work):
 * the handles' own requests (a window's `set`, a command's
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

/** A member as `Interface.member`, linked. `Plugin.x` is declared on Scope. */
export const memberLink = (api) =>
  `{@linkcode "@vestra-player/sdk"!${api.replace(/^Plugin\./, "Scope.").replace(/^(Scope\.\w+)\..*$/, "$1")} ${api}}`;

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
  const { API_REQUESTS } = await load("src/api-requests.ts");
  const calls = clientCalls(root);

  const sentBy = new Map();
  for (const [member, requests] of Object.entries(API_REQUESTS))
    for (const request of requests)
      if (!member.startsWith("Wire"))
        sentBy.set(request.method, [
          ...new Set([...(sentBy.get(request.method) ?? []), member]),
        ]);
  for (const [method, members] of Object.entries(WRAPPED_BY)) {
    for (const member of members)
      if (!findMember(member))
        throw new Error(`WRAPPED_BY["${method}"]: no API member ${member}`);
    sentBy.set(method, [...(sentBy.get(method) ?? []), ...members]);
  }
  for (const method of calls.keys())
    if (!sentBy.has(method))
      throw new Error(
        `${method}: sent by ${calls.get(method).file}, but no public member is named for it; add it to WRAPPED_BY in scripts/doc-tables/messages.mjs`,
      );

  const row = (method) => {
    const call = calls.get(method);
    const members = sentBy.get(method) ?? [];
    const codes = documentedCodes(members);
    return [
      `\`${method}\``,
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
    "Params",
    "Result",
    "Errors (documented)",
    "Stability",
  ];
  const areas = new Map();
  for (const method of [
    ...new Set([...calls.keys(), ...sentBy.keys()]),
  ].sort()) {
    const area = method.split(".")[0];
    areas.set(area, [...(areas.get(area) ?? []), method]);
  }
  return [...areas]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([area, methods]) =>
        `### \`${area}\`\n\n${table(header, methods.map(row))}`,
    )
    .join("\n\n");
}
