/**
 * The capability rule, as data: which manifest capability a request needs
 * (the player's table, `HOST_CAPABILITIES`, synced from its
 * `src/host/capabilities.json`) and which requests each public member of the
 * plugin API sends (`API_REQUESTS`). `CAPABILITY_INFO`, `vestra-plugin check`
 * and the TypeScript language-service plugin are all built from these two
 * tables, so they and the player cannot disagree.
 *
 * Since 1.8.0 the rule is flat: a request needs nothing or one capability of
 * the closed list. (Until then a need could depend on a parameter or on
 * what else the manifest declared, and a capability could require others.)
 *
 * @internal
 */
import { API_REQUESTS } from "./api-requests.ts";
import type { ApiRequest } from "./api-requests.ts";
import { HOST_CAPABILITIES } from "./host-capabilities.ts";

/**
 * @internal One RPC method of the player's table (`prefix.*` covers a
 * prefix) and what it needs: `null` (any plugin may call it) or a
 * capability name.
 */
export interface HostMethod {
  readonly name: string;
  readonly needs: string | null;
}

/** @internal One manifest capability of the player's table. */
export interface HostCapability {
  readonly name: string;
  /** The store's and the install confirmation's wording. */
  readonly label: string;
  /** A name kept for a later player API (`camera`): no method needs it yet. */
  readonly reserved: boolean;
}

/**
 * @internal A capability name of SDK 1.7 and earlier and the name that
 * replaced it (`null`: what it opened needs no declaration now).
 */
export interface HostRetired {
  readonly name: string;
  readonly replacedBy: string | null;
}

/**
 * @internal The methods one part of the player serves (playback control,
 * panels, the clipboard…), with what they mean for standby (`residency`).
 */
export interface HostGroup {
  readonly name: string;
  readonly summary: string;
  readonly residency: string;
  readonly methods: readonly HostMethod[];
}

/** @internal The player's `src/host/capabilities.json`. */
export interface HostCapabilities {
  readonly about: string;
  readonly apiVersion: string;
  readonly capabilities: readonly HostCapability[];
  readonly retired: readonly HostRetired[];
  readonly groups: readonly HostGroup[];
}

/** @internal Both tables; tests pass their own. */
export interface CapabilityRules {
  readonly host: HostCapabilities;
  readonly apis: Readonly<Record<string, readonly ApiRequest[]>>;
}

/** @internal The SDK's rules: the synced player table and `API_REQUESTS`. */
export const RULES: CapabilityRules = {
  host: HOST_CAPABILITIES,
  apis: API_REQUESTS,
};

/**
 * The capability names of SDK 1.7 and earlier that 1.8.0 retired, each with
 * the name that replaced it; `null`: what it opened needs no declaration
 * now. From the player's table. The player knows none of them as a
 * capability: a manifest that still lists one is refused, and
 * `vestra-plugin check` says what to write instead.
 *
 * @internal
 */
export function retiredCapabilities(
  host: HostCapabilities = RULES.host,
): Record<string, string | null> {
  return Object.fromEntries(
    host.retired.map((entry) => [entry.name, entry.replacedBy]),
  );
}

/**
 * The player's entry for a method, as the player routes it: the exact name
 * first, then the first `prefix.*` entry whose prefix it starts with.
 * `undefined`: the player does not know the method.
 *
 * @internal
 */
export function hostMethod(
  method: string,
  host: HostCapabilities = RULES.host,
): HostMethod | undefined {
  const all = host.groups.flatMap((group) => group.methods);
  return (
    all.find((entry) => entry.name === method) ??
    all.find(
      (entry) =>
        entry.name.endsWith(".*") && method.startsWith(entry.name.slice(0, -1)),
    )
  );
}

/**
 * The capability one request needs, as the player decides it: `null` for
 * none, `undefined` for a method the player does not know.
 *
 * @internal
 */
export function requestNeeds(
  method: string,
  host: HostCapabilities = RULES.host,
): string | null | undefined {
  const entry = hostMethod(method, host);
  return entry ? entry.needs : undefined;
}

/** @internal One capability a member needs, and the request that needs it. */
export interface MemberNeed {
  readonly capability: string;
  readonly method: string;
}

/**
 * Every capability a member of the plugin API needs: those its requests
 * need. `undefined`: the member is not in the table (it needs none).
 *
 * @param api - The member as `Interface.member` (`Bindings.set`).
 *
 * @internal
 */
export function memberNeeds(
  api: string,
  rules: CapabilityRules = RULES,
): MemberNeed[] | undefined {
  const requests = rules.apis[api];
  if (!requests) return undefined;
  return requestsNeed(requests, rules);
}

/**
 * The request of a call to a member of `ARGUMENT_APIS`
 * (`plugin.wire.request`), given its method name. `undefined`: a method the
 * player's table does not know (not checked).
 *
 * @param name - The method name.
 *
 * @internal
 */
export function argumentRequests(
  name: string,
  rules: CapabilityRules = RULES,
): ApiRequest[] | undefined {
  if (!hostMethod(name, rules.host)) return undefined;
  return [{ method: name }];
}

/**
 * Every capability a list of requests needs, each once, with the first
 * request that needs it (see {@link memberNeeds}).
 *
 * @internal
 */
export function requestsNeed(
  requests: readonly ApiRequest[],
  rules: CapabilityRules = RULES,
): MemberNeed[] {
  const needs: MemberNeed[] = [];
  for (const request of requests) {
    const capability = requestNeeds(request.method, rules.host);
    if (capability && !needs.some((need) => need.capability === capability))
      needs.push({ capability, method: request.method });
  }
  return needs;
}

/**
 * `CAPABILITY_INFO` from the tables: the label and the reserved mark from
 * the player's table; the members from `API_REQUESTS` (every member a
 * request of which needs the capability, in the table's order; requests
 * marked `also` are left out).
 *
 * @internal
 */
export function capabilityInfo(
  rules: CapabilityRules = RULES,
): Record<string, { apis: string[]; label: string; reserved: boolean }> {
  const info: ReturnType<typeof capabilityInfo> = {};
  for (const capability of rules.host.capabilities)
    info[capability.name] = {
      apis: [],
      label: capability.label,
      reserved: capability.reserved,
    };
  for (const [api, requests] of Object.entries(rules.apis))
    for (const request of requests) {
      if (request.also) continue;
      const capability = requestNeeds(request.method, rules.host);
      const entry = capability ? info[capability] : undefined;
      if (entry && !entry.apis.includes(api)) entry.apis.push(api);
    }
  return info;
}
