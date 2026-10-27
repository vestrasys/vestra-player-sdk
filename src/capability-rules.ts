/**
 * The capability rule, as data: which manifest capability a request needs
 * (the player's table, `HOST_CAPABILITIES`, synced from its
 * `src/host/capabilities.json`) and which requests each public member of the
 * plugin API sends (`API_REQUESTS`). `CAPABILITY_INFO`, `vestra-plugin check`
 * and the TypeScript language-service plugin are all built from these two
 * tables, so they and the player cannot disagree.
 *
 * @internal
 */
import { API_REQUESTS } from "./api-requests.ts";
import type { ApiRequest } from "./api-requests.ts";
import { HOST_CAPABILITIES } from "./host-capabilities.ts";

/**
 * What a request needs, as the player's `capabilities.json` writes it:
 * `null` (nothing), a capability name, a choice by a string parameter, or a
 * choice by whether the plugin declared a capability.
 *
 * @internal
 */
export type Needs =
  | null
  | string
  | {
      readonly param: string;
      readonly cases: Readonly<Record<string, string | null>>;
      readonly otherwise: string | null;
    }
  | {
      readonly ifDeclared: string;
      readonly then: string;
      readonly otherwise: string;
    };

/** @internal One RPC method of the player's table (`prefix.*` covers a prefix). */
export interface HostMethod {
  readonly name: string;
  readonly needs: Needs;
}

/** @internal One manifest capability of the player's table. */
export interface HostCapability {
  readonly name: string;
  readonly label: string;
  readonly risky: boolean;
  readonly requires: readonly string[];
  readonly residency: string;
  readonly methods: readonly HostMethod[];
}

/** @internal The player's `src/host/capabilities.json`. */
export interface HostCapabilities {
  readonly about: string;
  readonly apiVersion: string;
  readonly capabilities: readonly HostCapability[];
  readonly uncapable: readonly HostMethod[];
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
  const all = [
    ...host.capabilities.flatMap((capability) => capability.methods),
    ...host.uncapable,
  ];
  return (
    all.find((entry) => entry.name === method) ??
    all.find(
      (entry) =>
        entry.name.endsWith(".*") && method.startsWith(entry.name.slice(0, -1)),
    )
  );
}

/**
 * The capability one request needs, as the player decides it
 * (`capabilities::Route::needs`): `null` for none, `undefined` for a method
 * the player does not know.
 *
 * @param method - The wire method.
 * @param params - Its string parameters that a `Needs::Param` rule reads.
 * @param declared - Whether the plugin declared a capability.
 *
 * @internal
 */
export function requestNeeds(
  method: string,
  params: Readonly<Record<string, string>> | undefined,
  declared: (capability: string) => boolean,
  host: HostCapabilities = RULES.host,
): string | null | undefined {
  const entry = hostMethod(method, host);
  if (!entry) return undefined;
  const needs = entry.needs;
  if (needs === null || typeof needs === "string") return needs;
  if ("param" in needs) {
    const value = params?.[needs.param];
    return value !== undefined && Object.hasOwn(needs.cases, value)
      ? needs.cases[value]!
      : needs.otherwise;
  }
  return declared(needs.ifDeclared) ? needs.then : needs.otherwise;
}

/**
 * One capability a member needs: the request that needs it, and the
 * capability whose `requires` brought it in (absent when the request needs
 * it directly).
 *
 * @internal
 */
export interface MemberNeed {
  readonly capability: string;
  readonly method: string;
  readonly requiredBy?: string;
}

/**
 * Every capability a member of the plugin API needs with the given manifest:
 * those its requests need and, through `requires`, those they need in turn.
 * `undefined`: the member is not in the table (it needs none).
 *
 * @param api - The member as `Interface.member` (`Player.seek`).
 * @param capabilities - The manifest's capabilities.
 *
 * @internal
 */
export function memberNeeds(
  api: string,
  capabilities: readonly string[],
  rules: CapabilityRules = RULES,
): MemberNeed[] | undefined {
  const requests = rules.apis[api];
  if (!requests) return undefined;
  // An `ifDeclared` rule is decided last, as if the plugin had declared what
  // the member's other requests need: `Player.seek` needs `playback.control`
  // for `source.submit`, and with it `source.operation` needs nothing more.
  const declared = (name: string) =>
    capabilities.includes(name) ||
    needs.some((need) => need.capability === name);
  const conditional = (request: ApiRequest) => {
    const rule = hostMethod(request.method, rules.host)?.needs;
    return typeof rule === "object" && rule !== null && "ifDeclared" in rule;
  };
  const needs: MemberNeed[] = [];
  const add = (need: MemberNeed) => {
    if (needs.some((each) => each.capability === need.capability)) return;
    needs.push(need);
    const entry = rules.host.capabilities.find(
      (capability) => capability.name === need.capability,
    );
    for (const required of entry?.requires ?? [])
      add({
        capability: required,
        method: need.method,
        requiredBy: need.capability,
      });
  };
  for (const request of [
    ...requests.filter((request) => !conditional(request)),
    ...requests.filter(conditional),
  ]) {
    const capability = requestNeeds(
      request.method,
      request.params,
      declared,
      rules.host,
    );
    if (capability) add({ capability, method: request.method });
  }
  return needs;
}

/**
 * `CAPABILITY_INFO` from the tables: the label, highlight and requirements
 * from the player's table; the members from `API_REQUESTS` (every member a
 * request of which needs the capability, in the table's order; requests
 * marked `also` are left out, as they are documented at the member).
 *
 * @internal
 */
export function capabilityInfo(rules: CapabilityRules = RULES): Record<
  string,
  {
    apis: string[];
    requires: string[];
    label: string;
    risky: boolean;
  }
> {
  const info: ReturnType<typeof capabilityInfo> = {};
  for (const capability of rules.host.capabilities)
    info[capability.name] = {
      apis: [],
      requires: [...capability.requires],
      label: capability.label,
      risky: capability.risky,
    };
  for (const [api, requests] of Object.entries(rules.apis))
    for (const request of requests) {
      if (request.also) continue;
      const capability = requestNeeds(
        request.method,
        request.params,
        () => true,
        rules.host,
      );
      const entry = capability ? info[capability] : undefined;
      if (entry && !entry.apis.includes(api)) entry.apis.push(api);
    }
  return info;
}
